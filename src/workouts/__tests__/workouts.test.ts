import { describe, expect, it } from 'vitest';
import type { SplitSummary, WorkoutPlan } from '@/core/types';
import { BUILT_IN_WORKOUTS, describePlan, newPlan, planTitle, planTotals, titleFromPm, validatePlan } from '..';

const iv8x500: WorkoutPlan = { id: 'a', name: 'x', kind: 'intervals', intervals: Array.from({ length: 8 }, () => ({ type: 'distance' as const, value: 500, restMs: 120000 })) };

describe('library', () => {
  it('has 40+ valid built-ins with unique ids across categories', () => {
    expect(BUILT_IN_WORKOUTS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(BUILT_IN_WORKOUTS.map((p) => p.id)).size).toBe(BUILT_IN_WORKOUTS.length);
    for (const p of BUILT_IN_WORKOUTS) {
      expect(validatePlan(p), p.id).toEqual([]);
      expect(p.id.startsWith('builtin-') && p.builtIn).toBe(true);
      expect(p.description!.length).toBeGreaterThan(30);
    }
    const cats = new Set(BUILT_IN_WORKOUTS.map((p) => p.category));
    for (const c of ['test', 'steady-state', 'threshold', 'vo2max', 'sprint', 'technique', 'warmup']) expect(cats.has(c as never)).toBe(true);
  });
});

describe('titles and totals', () => {
  it('formats titles', () => {
    expect(planTitle({ id: '', name: '', kind: 'single-distance', value: 2000 })).toBe('2000m');
    expect(planTitle({ id: '', name: '', kind: 'single-time', value: 1800000 })).toBe('30:00');
    expect(planTitle(iv8x500)).toBe('8 × 500m / 2:00r');
    expect(planTitle({ id: '', name: '', kind: 'intervals', intervals: [60000, 120000, 60000].map((v) => ({ type: 'time' as const, value: v, restMs: 60000 })) })).toBe('v1:00/2:00/1:00');
    expect(describePlan(iv8x500)).toContain('4,000m');
  });
  it('totals exclude the final rest', () => {
    expect(planTotals(iv8x500)).toEqual({ distanceM: 4000, durationMs: null, restMs: 7 * 120000 });
  });
  it('titles from PM data', () => {
    const split = (i: number): SplitSummary => ({ index: i, type: 'distance', elapsedMs: 0, distanceM: 0, splitTimeMs: 100000, splitDistanceM: 500, restTimeMs: 120000, restDistanceM: 0, avgPaceMsPer500: 100000, avgWatts: 0, avgStrokeRate: 0, avgHeartRate: null, restHeartRate: null, avgDragFactor: 0, calories: 0, strokeCount: 0 });
    expect(titleFromPm('fixed-distance-interval', { distanceM: 4000, elapsedMs: 0 }, Array.from({ length: 8 }, (_, i) => split(i)))).toBe('8 × 500m / 2:00r');
    expect(titleFromPm('fixed-time-splits', { distanceM: 7000, elapsedMs: 1800000 }, [])).toBe('30:00');
    expect(titleFromPm('just-row-splits', { distanceM: 5123.4, elapsedMs: 1 }, [])).toBe('5123m');
  });
  it('new plans are valid', () => {
    for (const k of ['just-row', 'single-distance', 'single-time', 'single-calorie', 'intervals'] as const) expect(validatePlan(newPlan(k))).toEqual([]);
  });
});

describe('validation', () => {
  it('enforces PM5 limits', () => {
    expect(validatePlan({ id: 'a', name: 'x', kind: 'single-distance', value: 50 })).toHaveLength(1);
    expect(validatePlan({ id: 'a', name: 'x', kind: 'single-time', value: 10000 })).toHaveLength(1);
    expect(validatePlan({ id: 'a', name: 'x', kind: 'single-distance', value: 10000, splitValue: 200 })[0]).toMatch(/30 splits/);
    expect(validatePlan({ ...iv8x500, intervals: Array.from({ length: 51 }, () => ({ type: 'distance' as const, value: 500, restMs: 60000 })) })[0]).toMatch(/50 intervals/);
    expect(validatePlan({ ...iv8x500, intervals: [{ type: 'time', value: 60000, restMs: 600000 }] })[0]).toMatch(/9:55/);
  });
});
