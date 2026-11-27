import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/defaults';
import { mergeLedger, mergeRestoredSettings, planRestore, type SettingsGroup } from '../restore';
import { parseLogbookCsv, parseTcx, skipDuplicates } from '../import/parse';
import { toSummaryCsv, toTcx } from '../formats';
import { zipWrite } from '../zip';
import { buildBackup, parseBackup } from '../backup';

const none: Record<SettingsGroup, boolean> = { coxswain: false, layouts: false, display: false, profile: false, services: false, devices: false };

describe('restore options', () => {
  it('adds new only vs updates existing', () => {
    const inc = [{ id: 'a' }, { id: 'b' }];
    expect(planRestore(['a'], inc, 'new')).toMatchObject({ added: 1, updated: 0, unchanged: 1 });
    expect(planRestore(['a'], inc, 'update')).toMatchObject({ added: 1, updated: 1, unchanged: 0 });
    expect(planRestore(['a'], inc, 'none').toSave).toEqual([]);
  });
  it('only takes chosen settings groups', () => {
    const phone = { ...DEFAULT_SETTINGS, lastErgId: 'phone-erg', theme: 'phone' };
    const bk = { ...DEFAULT_SETTINGS, lastErgId: 'old-erg', theme: 'backup', coxswain: { ...DEFAULT_SETTINGS.coxswain, enabled: false } };
    const out = mergeRestoredSettings(phone, bk, { ...none, coxswain: true });
    expect(out.coxswain.enabled).toBe(false);
    expect(out.theme).toBe('phone');
    expect(out.lastErgId).toBe('phone-erg');
  });
  it('merges the upload ledger with the phone winning', () => {
    const cur = { w1: { strava: { state: 'done', at: 2 } } };
    const bk = { w1: { strava: { state: 'failed', at: 1 }, concept2: { state: 'done', at: 1 } }, w2: { strava: { state: 'done', at: 1 } } };
    const m = mergeLedger(cur, bk);
    expect(m.w1.strava).toEqual({ state: 'done', at: 2 });
    expect(m.w1.concept2).toBeDefined();
    expect(m.w2).toBeDefined();
  });
  it('backup carries the ledger', () => {
    const text = JSON.stringify(buildBackup({ settings: null, plans: [], favoritePlanIds: [], workouts: [], uploads: { w: { strava: { state: 'done', at: 1 } } } }));
    expect(parseBackup(text).uploads.w).toBeDefined();
  });
});

const CSV = `Log ID,Date,Description,Work Time (Formatted),Work Time (Seconds),Rest Time (Formatted),Rest Time (Seconds),Work Distance,Rest Distance,Stroke Rate/Cadence,Stroke Count,Pace,Avg Watts,Cal/Hour,Total Cal,Avg Heart Rate,Drag Factor,Age,Weight,Type,Ranked,Comments,Date Entered\r
123,2026-03-12 08:00:00,2000m,7:30.0,450.0,0:00.0,0,2000,0,24,180,1:52.5,215,900,112,150,120,40,80,RowErg,Yes,"nice, steady",2026-03-12 09:00:00\r
`;

describe('imports', () => {
  it('parses a Concept2 logbook CSV', () => {
    const [w] = parseLogbookCsv(CSV);
    expect(w.distanceM).toBe(2000);
    expect(w.elapsedMs).toBe(450_000);
    expect(w.startedAt).toBe(new Date(2026, 2, 12, 8).getTime());
    expect(w.title).toBe('2000m');
    expect(w.notes).toBe('nice, steady');
    expect(w.avgHeartRate).toBe(150);
    expect(w.avgWatts).toBe(215);
    expect(() => parseLogbookCsv('a,b\n1,2')).toThrow();
  });
  it('round-trips our TCX export', () => {
    const rec = { ...parseLogbookCsv(CSV)[0], title: 'Test <1>' };
    const [back] = parseTcx(toTcx({ ...rec, strokes: [], splits: [] }));
    expect(back.startedAt).toBe(rec.startedAt);
    expect(back.title).toBe('Test <1>');
  });
  it('skips duplicates by start time and distance', () => {
    const [w] = parseLogbookCsv(CSV);
    expect(skipDuplicates([{ startedAt: w.startedAt, distanceM: 2000 }], [w]).fresh).toEqual([]);
    expect(skipDuplicates([], [w, w])).toMatchObject({ duplicates: 1 });
    expect(skipDuplicates([{ startedAt: w.startedAt, distanceM: 1999 }], [w]).fresh).toHaveLength(1);
  });
});

describe('export all', () => {
  it('builds a summary csv and a valid zip', async () => {
    const [w] = parseLogbookCsv(CSV);
    expect(toSummaryCsv([w]).split('\r\n')).toHaveLength(3);
    const parts: Uint8Array[] = [];
    await zipWrite([{ name: 'a.txt', text: 'hello' }], (b) => parts.push(b));
    expect(Array.from(parts[0].slice(0, 4))).toEqual([0x50, 0x4b, 3, 4]);
    const end = parts[parts.length - 1];
    expect(new DataView(end.buffer, end.byteOffset, end.byteLength).getUint32(0, true)).toBe(0x06054b50);
  });
});

describe('delete all workouts', () => {
  it('uses one transaction and optionally removes plans', async () => {
    vi.resetModules();
    const calls: string[] = [];
    const db = {
      execAsync: async () => {}, getFirstAsync: async () => ({ user_version: 1 }),
      runAsync: async (sql: string) => void calls.push(sql),
      withTransactionAsync: async (fn: () => Promise<void>) => { calls.push('BEGIN'); await fn(); calls.push('COMMIT'); },
    };
    vi.doMock('expo-sqlite', () => ({ openDatabaseAsync: async () => db }));
    const { deleteAllWorkouts } = await import('../db');
    await deleteAllWorkouts(false);
    expect(calls).toEqual(['BEGIN', 'DELETE FROM workouts', 'COMMIT']);
    calls.length = 0;
    await deleteAllWorkouts(true);
    expect(calls).toEqual(['BEGIN', 'DELETE FROM workouts', 'DELETE FROM plans', 'DELETE FROM favorites', 'COMMIT']);
  });
});
