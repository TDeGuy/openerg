/**
 * Workout / plan database (expo-sqlite). Lazy singleton open with user_version migrations.
 * If SQLite cannot be opened (e.g. web without the wasm worker), falls back to an
 * in-memory store so the app keeps working for the session.
 */
import * as SQLite from 'expo-sqlite';
import { create } from 'zustand';
import { forgetUploads } from '@/integrations/store';
import type { WorkoutListItem, WorkoutPlan, WorkoutRecord } from '@/core/types';
import { SUMMARY_COLUMNS, recordToParams, rowToListItem, rowToRecord, toListItem, type WorkoutRow } from './codec';

/* ───────────── change counter ───────────── */

const useDbVersionStore = create<{ v: number }>(() => ({ v: 0 }));

export function useDbVersion(): number {
  return useDbVersionStore((s) => s.v);
}

function bump() {
  useDbVersionStore.setState((s) => ({ v: s.v + 1 }));
}

/* ───────────── open + migrations ───────────── */

const DB_NAME = 'openerg.db';
/** Web falls back to memory and may hang on open; phones must not, so they fail loudly instead. */
const WEB = typeof document !== 'undefined';

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS workouts (
     id TEXT PRIMARY KEY NOT NULL,
     started_at INTEGER NOT NULL,
     ended_at INTEGER NOT NULL,
     title TEXT NOT NULL,
     machine_type TEXT NOT NULL,
     workout_type TEXT NOT NULL,
     elapsed_ms REAL, distance_m REAL, avg_pace REAL, avg_watts REAL, avg_rate REAL,
     avg_hr REAL, max_hr REAL, calories REAL, stroke_count INTEGER, avg_drag REAL, total_rest_ms REAL,
     erg_name TEXT, erg_serial TEXT, notes TEXT, tags TEXT,
     simulated INTEGER NOT NULL DEFAULT 0,
     verified INTEGER NOT NULL DEFAULT 0,
     plan TEXT,
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_workouts_started ON workouts(started_at DESC);
   CREATE INDEX IF NOT EXISTS idx_workouts_distance ON workouts(distance_m);
   CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS favorites (plan_id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);`,
];

let opening: Promise<SQLite.SQLiteDatabase | null> | null = null;

const mem = {
  workouts: new Map<string, WorkoutRecord>(),
  plans: new Map<string, WorkoutPlan>(),
  favs: new Set<string>(),
};

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync('PRAGMA journal_mode = WAL;');
  } catch {
    /* not supported everywhere (web) */
  }
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[i]);
      await db.execAsync(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

const OPEN_TIMEOUT_MS = 3000;

function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (!opening) {
    const open = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })();
    // A hung open (a web worker that never loads gives no error) must not stall a save forever.
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`open timed out after ${OPEN_TIMEOUT_MS} ms`)), OPEN_TIMEOUT_MS));
    // A failure is not cached: the next call tries again, so one slow start cannot lose later workouts.
    opening = Promise.race([open, timeout]).catch((e) => {
      console.warn('[db] SQLite unavailable', e);
      opening = null;
      return null;
    });
  }
  return opening;
}

/* ───────────── workouts ───────────── */

export async function saveWorkouts(records: WorkoutRecord[]): Promise<void> {
  const db = await getDb();
  if (!db) {
    // Phones keep nothing in memory: the caller keeps the workout and retries, instead of losing it on exit.
    if (!WEB) throw new Error('The workout database could not be opened. The workout was not saved.');
    for (const r of records) mem.workouts.set(r.id, r);
  } else {
    await db.withTransactionAsync(async () => {
      for (const r of records) {
        await db.runAsync(
          `INSERT OR REPLACE INTO workouts (${SUMMARY_COLUMNS}, data) VALUES ($id, $started_at, $ended_at, $title, $machine_type,
           $workout_type, $elapsed_ms, $distance_m, $avg_pace, $avg_watts, $avg_rate, $avg_hr, $max_hr, $calories,
           $stroke_count, $avg_drag, $total_rest_ms, $erg_name, $erg_serial, $notes, $tags, $simulated, $verified, $plan, $data)`,
          recordToParams(r),
        );
      }
    });
  }
  bump();
}

export const saveWorkout = (record: WorkoutRecord) => saveWorkouts([record]);

export async function getWorkout(id: string): Promise<WorkoutRecord | null> {
  const db = await getDb();
  if (!db) return mem.workouts.get(id) ?? null;
  const row = await db.getFirstAsync<WorkoutRow & { data: string }>(`SELECT ${SUMMARY_COLUMNS}, data FROM workouts WHERE id = ?`, [id]);
  return row ? rowToRecord(row) : null;
}

export async function listWorkouts(opts: { limit?: number; offset?: number; search?: string } = {}): Promise<WorkoutListItem[]> {
  const limit = opts.limit ?? -1;
  const offset = opts.offset ?? 0;
  const search = opts.search?.trim().toLowerCase() ?? '';
  const db = await getDb();
  if (!db) {
    let items = [...mem.workouts.values()].map(toListItem).sort((a, b) => b.startedAt - a.startedAt);
    if (search) {
      items = items.filter((w) =>
        [w.title, w.notes ?? '', (w.tags ?? []).join(' '), w.ergName ?? ''].join(' ').toLowerCase().includes(search),
      );
    }
    return items.slice(offset, limit < 0 ? undefined : offset + limit);
  }
  const where = search
    ? `WHERE lower(title) LIKE $q ESCAPE '\\' OR lower(IFNULL(notes,'')) LIKE $q ESCAPE '\\' OR lower(IFNULL(tags,'')) LIKE $q ESCAPE '\\' OR lower(IFNULL(erg_name,'')) LIKE $q ESCAPE '\\'`
    : '';
  const params: Record<string, string | number> = { $limit: limit, $offset: offset };
  if (search) params.$q = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.getAllAsync<WorkoutRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM workouts ${where} ORDER BY started_at DESC LIMIT $limit OFFSET $offset`,
    params,
  );
  return rows.map(rowToListItem);
}

/** All full records (used by backup). */
export async function getAllWorkouts(): Promise<WorkoutRecord[]> {
  const db = await getDb();
  if (!db) return [...mem.workouts.values()].sort((a, b) => b.startedAt - a.startedAt);
  const rows = await db.getAllAsync<WorkoutRow & { data: string }>(
    `SELECT ${SUMMARY_COLUMNS}, data FROM workouts ORDER BY started_at DESC`,
  );
  return rows.map(rowToRecord);
}

/** One page of full records, newest first (backup streams these instead of loading everything). */
export async function getWorkoutBatch(offset: number, limit: number): Promise<WorkoutRecord[]> {
  const db = await getDb();
  if (!db) return [...mem.workouts.values()].sort((a, b) => b.startedAt - a.startedAt).slice(offset, offset + limit);
  const rows = await db.getAllAsync<WorkoutRow & { data: string }>(
    `SELECT ${SUMMARY_COLUMNS}, data FROM workouts ORDER BY started_at DESC, id LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map(rowToRecord);
}

export async function getWorkoutIds(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [...mem.workouts.keys()];
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM workouts');
  return rows.map((r) => r.id);
}

export async function deleteWorkouts(ids: readonly string[]): Promise<void> {
  const db = await getDb();
  if (!db) for (const id of ids) mem.workouts.delete(id);
  else {
    await db.withTransactionAsync(async () => {
      for (const id of ids) await db.runAsync('DELETE FROM workouts WHERE id = ?', [id]);
    });
  }
  bump();
  await forgetUploads(ids);
}

export const deleteWorkout = (id: string) => deleteWorkouts([id]);

/** Deletes every workout (and optionally custom plans + favourites) in one transaction: all or nothing. */
export async function deleteAllWorkouts(includePlans = false): Promise<void> {
  const db = await getDb();
  if (!db) {
    mem.workouts.clear();
    if (includePlans) {
      mem.plans.clear();
      mem.favs.clear();
    }
  } else {
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM workouts');
      if (includePlans) {
        await db.runAsync('DELETE FROM plans');
        await db.runAsync('DELETE FROM favorites');
      }
    });
  }
  bump();
  await forgetUploads();
}

/** Deletes every workout, custom plan and favourite. */
export const deleteAllData = () => deleteAllWorkouts(true);

export async function updateWorkoutMeta(id: string, patch: { title?: string; notes?: string; tags?: string[] }): Promise<void> {
  const db = await getDb();
  if (!db) {
    const r = mem.workouts.get(id);
    if (r) mem.workouts.set(id, { ...r, ...patch });
  } else {
    const sets: string[] = [];
    const params: Record<string, string | null> = { $id: id };
    if (patch.title !== undefined) {
      sets.push('title = $title');
      params.$title = patch.title;
    }
    if (patch.notes !== undefined) {
      sets.push('notes = $notes');
      params.$notes = patch.notes || null;
    }
    if (patch.tags !== undefined) {
      sets.push('tags = $tags');
      params.$tags = patch.tags.length ? JSON.stringify(patch.tags) : null;
    }
    if (!sets.length) return;
    await db.runAsync(`UPDATE workouts SET ${sets.join(', ')} WHERE id = $id`, params);
  }
  bump();
}

/* ───────────── plans + favourites ───────────── */

export async function listCustomPlans(): Promise<WorkoutPlan[]> {
  const db = await getDb();
  const favs = new Set(await getFavoritePlanIds());
  let plans: WorkoutPlan[];
  if (!db) {
    plans = [...mem.plans.values()];
  } else {
    const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM plans ORDER BY updated_at DESC');
    plans = [];
    for (const r of rows) {
      try {
        plans.push(JSON.parse(r.data) as WorkoutPlan);
      } catch {
        /* skip corrupt row */
      }
    }
  }
  return plans.map((p) => ({ ...p, builtIn: false, favorite: favs.has(p.id) }));
}

export async function savePlan(plan: WorkoutPlan): Promise<void> {
  const { favorite: _f, ...rest } = plan;
  const stored: WorkoutPlan = { ...rest, builtIn: false };
  const db = await getDb();
  if (!db) mem.plans.set(plan.id, stored);
  else {
    await db.runAsync('INSERT OR REPLACE INTO plans (id, data, updated_at) VALUES (?, ?, ?)', [
      plan.id,
      JSON.stringify(stored),
      Date.now(),
    ]);
  }
  bump();
}

export async function deletePlan(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    mem.plans.delete(id);
    mem.favs.delete(id);
  } else {
    await db.runAsync('DELETE FROM plans WHERE id = ?', [id]);
    await db.runAsync('DELETE FROM favorites WHERE plan_id = ?', [id]);
  }
  bump();
}

export async function getFavoritePlanIds(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [...mem.favs];
  const rows = await db.getAllAsync<{ plan_id: string }>('SELECT plan_id FROM favorites ORDER BY created_at');
  return rows.map((r) => r.plan_id);
}

export async function setPlanFavorite(id: string, favorite: boolean): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (favorite) mem.favs.add(id);
    else mem.favs.delete(id);
  } else if (favorite) {
    await db.runAsync('INSERT OR IGNORE INTO favorites (plan_id, created_at) VALUES (?, ?)', [id, Date.now()]);
  } else {
    await db.runAsync('DELETE FROM favorites WHERE plan_id = ?', [id]);
  }
  bump();
}
