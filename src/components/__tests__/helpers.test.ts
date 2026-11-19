import { describe, expect, it } from 'vitest';

import {
  bestSoFar,
  elapsedAtDistance,
  estimateMaxHr,
  groupByMonth,
  moveItem,
  paceZone,
  parseEvent,
  solveTimeDistancePace,
  streaks,
  timeInHrZones,
} from '../analysis/helpers';
import { downsample, nearestIndex, niceTicks, padDomain } from '../charts/util';
import type { StrokeSample, TrainingZone, WorkoutListItem } from '@/core/types';

const item = (id: string, startedAt: number, distanceM = 2000, elapsedMs = 450000) =>
  ({ id, startedAt, distanceM, elapsedMs, calories: 0, workoutType: 'fixed-distance-splits', plan: null, avgPaceMsPer500: 112500 }) as unknown as WorkoutListItem;

describe('chart util', () => {
  it('downsamples keeping endpoints', () => {
    const pts = Array.from({ length: 4000 }, (_, i) => ({ x: i, y: i % 7 }));
    const d = downsample(pts, 200);
    expect(d.length).toBeLessThanOrEqual(200);
    expect(d[0]).toEqual(pts[0]);
    expect(d[d.length - 1]).toEqual(pts[3999]);
  });
  it('nice ticks and padding', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    const [lo, hi] = padDomain(5, 5);
    expect(hi).toBeGreaterThan(lo);
    expect(nearestIndex([{ x: 0, y: 0 }, { x: 10, y: 0 }], 7)).toBe(1);
  });
});

describe('analysis helpers', () => {
  it('groups by month newest first with totals', () => {
    const s = groupByMonth([item('a', new Date(2026, 0, 5).getTime()), item('b', new Date(2026, 1, 2).getTime()), item('c', new Date(2026, 1, 9).getTime())]);
    expect(s.map((x) => x.data.length)).toEqual([2, 1]);
    expect(s[0].metres).toBe(4000);
  });
  it('computes streaks', () => {
    const d = (n: number) => new Date(2026, 10, n, 9).getTime();
    expect(streaks([item('a', d(10)), item('b', d(11)), item('c', d(13)), item('d', d(14)), item('e', d(15))], d(16))).toEqual({ current: 3, longest: 3 });
    expect(streaks([item('a', d(1))], d(16)).current).toBe(0);
  });
  it('parses events', () => {
    expect(parseEvent('2000m')).toEqual({ type: 'distance', value: 2000 });
    expect(parseEvent('30:00')).toEqual({ type: 'time', value: 1800000 });
    expect(parseEvent('1:00')).toEqual({ type: 'time', value: 60000 });
  });
  it('solves time/distance/pace', () => {
    expect(solveTimeDistancePace('time', NaN, 2000, 120000)).toBe(480000);
    expect(solveTimeDistancePace('distance', 480000, NaN, 120000)).toBe(2000);
    expect(solveTimeDistancePace('pace', 480000, 2000, NaN)).toBe(120000);
    expect(solveTimeDistancePace('pace', NaN, 2000, NaN)).toBeNaN();
  });
  it('zones and HR', () => {
    expect(timeInHrZones([{ elapsedMs: 0, bpm: 100 }, { elapsedMs: 5000, bpm: 150 }, { elapsedMs: 60000, bpm: 150 }], (b) => (b > 140 ? 3 : 1))).toEqual([0, 0, 15000, 0, 0]);
    const zones = [
      { zone: 1, paceMinMsPer500: 140000, paceMaxMsPer500: 130000 },
      { zone: 2, paceMinMsPer500: 130000, paceMaxMsPer500: 125000 },
    ] as TrainingZone[];
    expect(paceZone(127000, zones)).toBe(2);
    expect(paceZone(150000, zones)).toBe(1);
    expect(estimateMaxHr(1990, new Date(2026, 0, 1).getTime())).toBe(183);
  });
  it('interpolates elapsed at distance, best so far, moveItem', () => {
    const s = [{ distanceM: 10, elapsedMs: 2000 }, { distanceM: 20, elapsedMs: 4000 }] as StrokeSample[];
    expect(elapsedAtDistance(s, 15)).toBe(3000);
    expect(bestSoFar([{ x: 1, y: 5 }, { x: 2, y: 6 }, { x: 3, y: 4 }]).map((p) => p.y)).toEqual([5, 5, 4]);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
});
