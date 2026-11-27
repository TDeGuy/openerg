import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutRecord } from '@/core/types';

const store = new Map<string, string>();
vi.mock('@/storage/kv', () => ({
  kv: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

import { forgetUploads, useIntegrations } from '@/integrations/store';
import { backupHead, backupTail, backupWorkoutLines, buildBackup, parseBackupStream } from '../backup';

const rec = (id: string): WorkoutRecord =>
  ({ id, startedAt: 1000, elapsedMs: 60000, distanceM: 250, strokes: [{ strokeNumber: 1 }], splits: [], title: `W ${id}` }) as unknown as WorkoutRecord;

const chunked = (text: string, size: number) =>
  (async function* () {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
  })();

describe('chunked backup', () => {
  const ids = Array.from({ length: 25 }, (_, i) => `w${i}`);
  const uploads = { w1: { strava: { state: 'done', at: 1 } } };
  const text =
    backupHead({ settings: null, plans: [], favoritePlanIds: ['p1'], uploads }) +
    backupWorkoutLines(ids.slice(0, 10).map(rec), true) +
    backupWorkoutLines(ids.slice(10).map(rec), false) +
    backupTail();

  it('stays one valid JSON document older versions can read', () => {
    expect((JSON.parse(text) as { workouts: unknown[] }).workouts).toHaveLength(25);
  });

  it('round-trips through the streaming reader in batches, even with tiny chunks', async () => {
    const p = await parseBackupStream(() => chunked(text, 7));
    expect(p.workoutCount).toBe(25);
    expect(p.favoritePlanIds).toEqual(['p1']);
    expect(p.uploads).toEqual(uploads);
    const got: string[] = [];
    let max = 0;
    for await (const b of p.batches!()) {
      max = Math.max(max, b.length);
      got.push(...b.map((w) => w.id));
    }
    expect(got).toEqual(ids);
    expect(max).toBeLessThanOrEqual(10);
  });

  it('writes an empty backup', async () => {
    const p = await parseBackupStream(() => chunked(backupHead({ settings: null, plans: [], favoritePlanIds: [] }) + backupTail(), 5));
    expect(p.workoutCount).toBe(0);
  });

  it('reads an old single-string backup and a single exported workout', async () => {
    const old = JSON.stringify(buildBackup({ settings: null, plans: [], favoritePlanIds: [], workouts: [rec('a'), rec('b')], uploads }));
    const p = await parseBackupStream(() => chunked(old, 11));
    expect(p.workoutCount).toBe(2);
    expect(p.workouts.map((w) => w.id)).toEqual(['a', 'b']);
    expect(p.batches).toBeUndefined();
    const one = await parseBackupStream(() => chunked(JSON.stringify(rec('solo')), 50));
    expect(one.workouts[0]?.id).toBe('solo');
  });

  it('counts unreadable entries without failing', async () => {
    const bad = text.replace('"id":"w3"', '"id":3');
    expect((await parseBackupStream(() => chunked(bad, 64))).skipped).toBe(1);
  });
});

describe('upload ledger cleanup', () => {
  beforeEach(() => {
    store.clear();
    useIntegrations.setState({ loaded: false, uploads: {} });
  });
  it('removes deleted workouts and keeps the rest', async () => {
    useIntegrations.getState().patch({ uploads: { a: { concept2: { state: 'done', at: 1 } }, b: { concept2: { state: 'done', at: 1 } }, c: {} } });
    await forgetUploads(['a', 'c']);
    expect(Object.keys(useIntegrations.getState().uploads)).toEqual(['b']);
    expect(JSON.parse(store.get('openerg.integrations.v1')!).uploads).toHaveProperty('b');
  });
  it('clears everything for delete-all', async () => {
    useIntegrations.getState().patch({ uploads: { a: {} , b: { concept2: { state: 'done', at: 1 } } } });
    await forgetUploads();
    expect(useIntegrations.getState().uploads).toEqual({});
  });
});
