/** Pure backup (de)serialisation and validation. */
import type { AppSettings, WorkoutPlan, WorkoutRecord } from '@/core/types';

export const BACKUP_VERSION = 1;

/** Upload ledger: workout id -> service -> status (see integrations store). */
export type UploadLedger = Record<string, Record<string, unknown>>;

export interface BackupFile {
  app: 'OpenErg';
  version: number;
  exportedAt: number;
  settings: AppSettings | null;
  plans: WorkoutPlan[];
  favoritePlanIds: string[];
  workouts: WorkoutRecord[];
  uploads?: UploadLedger;
}

export function buildBackup(args: {
  settings: AppSettings | null;
  plans: WorkoutPlan[];
  favoritePlanIds: string[];
  workouts: WorkoutRecord[];
  uploads?: UploadLedger;
  now?: number;
}): BackupFile {
  return {
    app: 'OpenErg',
    version: BACKUP_VERSION,
    exportedAt: args.now ?? Date.now(),
    settings: args.settings,
    plans: args.plans,
    favoritePlanIds: args.favoritePlanIds,
    workouts: args.workouts,
    uploads: args.uploads ?? {},
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const PLAN_KINDS = ['just-row', 'single-distance', 'single-time', 'single-calorie', 'intervals'];

/** Returns a normalised record, or null if the value is not a plausible WorkoutRecord. */
export function normalizeRecord(v: unknown): WorkoutRecord | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== 'string' || !v.id) return null;
  if (!isNum(v.startedAt) || !isNum(v.elapsedMs) || !isNum(v.distanceM)) return null;
  if (!Array.isArray(v.strokes) || !Array.isArray(v.splits)) return null;
  const r = v as unknown as WorkoutRecord;
  return {
    ...r,
    endedAt: isNum(v.endedAt) ? v.endedAt : r.startedAt + r.elapsedMs,
    machineType: typeof v.machineType === 'string' ? r.machineType : 'rower',
    plan: isObj(v.plan) ? r.plan : null,
    title: typeof v.title === 'string' ? r.title : 'Workout',
    workoutType: typeof v.workoutType === 'string' ? r.workoutType : 'unknown',
    avgPaceMsPer500: isNum(v.avgPaceMsPer500) ? r.avgPaceMsPer500 : 0,
    avgWatts: isNum(v.avgWatts) ? r.avgWatts : 0,
    avgStrokeRate: isNum(v.avgStrokeRate) ? r.avgStrokeRate : 0,
    avgHeartRate: isNum(v.avgHeartRate) ? r.avgHeartRate : null,
    maxHeartRate: isNum(v.maxHeartRate) ? r.maxHeartRate : null,
    calories: isNum(v.calories) ? r.calories : 0,
    strokeCount: isNum(v.strokeCount) ? r.strokeCount : r.strokes.length,
    avgDragFactor: isNum(v.avgDragFactor) ? r.avgDragFactor : 0,
    totalRestMs: isNum(v.totalRestMs) ? r.totalRestMs : 0,
    strokes: r.strokes.map((s) => ({ ...s, forceCurve: Array.isArray(s.forceCurve) ? s.forceCurve : [] })),
    heartRate: Array.isArray(v.heartRate) ? r.heartRate : [],
    coxCalls: Array.isArray(v.coxCalls) ? r.coxCalls : [],
  };
}

export function isPlan(v: unknown): v is WorkoutPlan {
  return isObj(v) && typeof v.id === 'string' && !!v.id && typeof v.name === 'string' && PLAN_KINDS.includes(v.kind as string);
}

export interface ParsedBackup {
  version: number;
  settings: unknown;
  plans: WorkoutPlan[];
  favoritePlanIds: string[];
  workouts: WorkoutRecord[];
  uploads: UploadLedger;
  /** Workouts in the file (also when they are streamed rather than held in `workouts`). */
  workoutCount: number;
  /** Set for streamed (line-per-workout) backups: re-reads the file and yields records in small batches. */
  batches?: () => AsyncGenerator<WorkoutRecord[]>;
  /** Entries that failed validation. */
  skipped: number;
}

/** Throws a user-readable Error when the text is not an OpenErg backup. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  // A single exported workout (JSON export) is accepted too.
  const single = normalizeRecord(data);
  if (single) return { version: BACKUP_VERSION, settings: null, plans: [], favoritePlanIds: [], workouts: [single], workoutCount: 1, uploads: {}, skipped: 0 };

  if (!isObj(data) || !isNum(data.version) || !Array.isArray(data.workouts)) {
    throw new Error('This file is not an OpenErg backup.');
  }
  if (data.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of OpenErg.');
  let skipped = 0;
  const workouts: WorkoutRecord[] = [];
  for (const w of data.workouts) {
    const r = normalizeRecord(w);
    if (r) workouts.push(r);
    else skipped++;
  }
  const plans: WorkoutPlan[] = [];
  for (const p of Array.isArray(data.plans) ? data.plans : []) {
    if (isPlan(p)) plans.push(p);
    else skipped++;
  }
  const favoritePlanIds = Array.isArray(data.favoritePlanIds)
    ? data.favoritePlanIds.filter((x): x is string => typeof x === 'string')
    : [];
  return { version: data.version, settings: isObj(data.settings) ? data.settings : null, workoutCount: workouts.length, plans, favoritePlanIds, workouts, uploads: isObj(data.uploads) ? (data.uploads as UploadLedger) : {}, skipped };
}

/*
 * Streamed layout: still one valid JSON document (older versions can read it), but the header, each
 * workout and the tail sit on their own lines so neither writing nor restoring holds every stroke in memory.
 *   {"app":...,"uploads":{...},"workouts":[
 *   {workout},
 *   {workout}
 *   ]}
 */
const HEAD_END = '"workouts":[';
const TAIL = ']}';
export const RESTORE_BATCH = 10;

/** First line of a streamed backup (workouts follow, see backupWorkoutLines). */
export function backupHead(args: Omit<Parameters<typeof buildBackup>[0], 'workouts'>): string {
  const { workouts: _w, ...rest } = buildBackup({ ...args, workouts: [] });
  return `${JSON.stringify(rest).slice(0, -1)},${HEAD_END}\n`;
}
/** Text for one batch of workouts; `first` is true only for the very first batch. */
export function backupWorkoutLines(batch: WorkoutRecord[], first: boolean): string {
  return batch.map((w, i) => (first && i === 0 ? '' : ',\n') + JSON.stringify(w)).join('');
}
export const backupTail = (): string => `\n${TAIL}\n`;

/** Splits UTF-8 chunks into lines without ever holding more than the current line plus one chunk. */
export async function* linesOf(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let rest = '';
  for await (const c of chunks) {
    rest += dec.decode(c, { stream: true });
    let i: number;
    while ((i = rest.indexOf('\n')) >= 0) {
      yield rest.slice(0, i).replace(/\r$/, '');
      rest = rest.slice(i + 1);
    }
  }
  rest += dec.decode();
  if (rest) yield rest;
}

/** Reads any supported backup: the streamed layout in bounded memory, anything else (older backups, a single workout) whole. */
export async function parseBackupStream(open: () => AsyncIterable<Uint8Array>): Promise<ParsedBackup> {
  const lines = linesOf(open());
  const first = await lines.next();
  if (first.done) throw new Error('The selected file is not valid JSON.');
  if (!first.value.endsWith(HEAD_END)) {
    let text = first.value;
    for await (const l of lines) text += '\n' + l;
    return parseBackup(text);
  }
  const head = parseBackup(first.value + TAIL);
  const record = (line: string): WorkoutRecord | null | undefined => {
    const t = line.endsWith(',') ? line.slice(0, -1) : line;
    if (!t || t === TAIL) return undefined;
    try {
      return normalizeRecord(JSON.parse(t));
    } catch {
      return null;
    }
  };
  let workoutCount = 0;
  let skipped = head.skipped;
  for await (const l of lines) {
    const r = record(l);
    if (r) workoutCount++;
    else if (r === null) skipped++;
  }
  async function* batches() {
    let batch: WorkoutRecord[] = [];
    const it = linesOf(open());
    await it.next();
    for await (const l of it) {
      const r = record(l);
      if (r) batch.push(r);
      if (batch.length >= RESTORE_BATCH) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length) yield batch;
  }
  return { ...head, workoutCount, skipped, batches };
}
