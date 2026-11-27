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

  it('shows a dash for a time piece, which has no finish time', () => {
    expect(finish({ workoutType: 'fixed-time-no-splits', workoutDurationMs: 600_000 }).value).toBe('–');
  });
});
