import { describe, expect, it } from 'vitest';
import { emptyMetrics } from '@/core/defaults';
import type { WorkoutPlan } from '@/core/types';
import { METRICS, type MetricContext } from '../metrics';

const ctx = (m: Partial<ReturnType<typeof emptyMetrics>>, plan: WorkoutPlan | null = null) =>
  ({ m: { ...emptyMetrics(), ...m }, plan, profile: {} as never, forceUnit: 'N' }) as unknown as MetricContext;

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
