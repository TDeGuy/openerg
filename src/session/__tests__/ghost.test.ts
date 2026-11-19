import { describe, expect, it } from 'vitest';
import type { WorkoutRecord } from '@/core/types';
import { buildGhost, computeGhostBoat, planOfRecord } from '../ghost';

const rec = (p: Partial<WorkoutRecord>) =>
  ({ id: 'a', startedAt: 0, strokes: [], splits: [], plan: null, title: 'x', workoutType: 'unknown', distanceM: 0, elapsedMs: 0, avgPaceMsPer500: 0, ...p }) as WorkoutRecord;

describe('buildGhost without strokes (imported workout)', () => {
  it('paces evenly over the totals', () => {
    const g = buildGhost(rec({ distanceM: 2000, elapsedMs: 480_000, avgPaceMsPer500: 120_000 }))!;
    expect(g).not.toBeNull();
    expect(computeGhostBoat(g, 240_000, 1000).gapM).toBeCloseTo(0);
  });
  it('is null with no totals', () => expect(buildGhost(rec({}))).toBeNull());
});

describe('planOfRecord', () => {
  it('keeps an existing plan', () => {
    const plan = { id: 'p', name: 'p', kind: 'just-row' as const };
    expect(planOfRecord(rec({ plan }))).toBe(plan);
  });
  it('derives distance and time pieces from totals', () => {
    expect(planOfRecord(rec({ workoutType: 'fixed-distance-splits', distanceM: 5000 }))).toMatchObject({ kind: 'single-distance', value: 5000 });
    expect(planOfRecord(rec({ workoutType: 'fixed-time-no-splits', elapsedMs: 1_200_000 }))).toMatchObject({ kind: 'single-time', value: 1_200_000 });
  });
  it('is null for just-row, intervals and unknown', () => {
    for (const t of ['just-row-splits', 'variable-interval', 'fixed-distance-interval', 'unknown'] as const) expect(planOfRecord(rec({ workoutType: t, distanceM: 1000, elapsedMs: 1000 }))).toBeNull();
  });
});
