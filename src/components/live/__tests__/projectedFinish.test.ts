import { describe, expect, it } from 'vitest';
import { emptyMetrics } from '@/core/defaults';
import type { WorkoutPlan } from '@/core/types';
import { METRICS, type MetricContext } from '../metrics';

const finish = (m: Partial<ReturnType<typeof emptyMetrics>>, plan: WorkoutPlan | null = null) =>
  METRICS.projectedFinish.compute({ m: { ...emptyMetrics(), avgPaceMsPer500: 120_000, ...m }, plan, profile: {} as never, forceUnit: 'N' } as unknown as MetricContext);

describe('projected finish', () => {
  it('shows a time for a distance piece set on the PM, with no app plan', () => {
    expect(finish({ workoutType: 'fixed-distance-no-splits', workoutDistanceM: 2000 }).value).toBe('8:00');
  });

  it('shows a distance for a time piece set on the PM, with no app plan', () => {
    const v = finish({ workoutType: 'fixed-time-no-splits', workoutDurationMs: 600_000 });
    expect(v.value).toBe('2,500');
    expect(v.unit).toBe('m');
  });
});
