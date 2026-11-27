import { describe, expect, it } from 'vitest';
import { emptyMetrics } from '@/core/defaults';
import type { WorkoutPlan } from '@/core/types';
import { METRICS, type MetricContext } from '../metrics';
import { computeProgress } from '../progress';

const ctx = (m: Partial<ReturnType<typeof emptyMetrics>>, plan: WorkoutPlan | null = null, progress: ReturnType<typeof computeProgress> = null) =>
  ({ m: { ...emptyMetrics(), ...m }, plan, progress, profile: {} as never, forceUnit: 'N' }) as unknown as MetricContext;

describe('interval tile', () => {
  it('shows the count alone when the PM runs intervals with no set number', () => {
    expect(METRICS.interval.compute(ctx({ workoutType: 'variable-interval', intervalCount: 2 }))).toEqual({ value: '3' });
  });

  it('shows "of N" when the plan fixes the count', () => {
    const plan: WorkoutPlan = { id: 'p', name: 'p', kind: 'intervals', intervals: [{ type: 'distance', value: 500, restMs: 60000 }, { type: 'distance', value: 500, restMs: 60000 }] };
    expect(METRICS.interval.compute(ctx({ workoutType: 'fixed-distance-splits', intervalCount: 1 }, plan))).toEqual({ value: '2', unit: 'of 2' });
  });

  it('shows a dash on a piece with no intervals', () => {
    expect(METRICS.interval.compute(ctx({ workoutType: 'just-row-splits' })).value).toBe('–');
  });
});

describe('erg-set piece countdown', () => {
  it('counts distance down on a distance piece with no app plan', () => {
    const m = { ...emptyMetrics(), workoutType: 'fixed-distance-no-splits' as const, workoutDistanceM: 2000, distanceM: 500 };
    expect(METRICS.distance.compute(ctx(m, null, computeProgress(null, { ...emptyMetrics(), ...m }, [])))).toMatchObject({ label: 'Distance left', value: '1,500' });
  });
});
