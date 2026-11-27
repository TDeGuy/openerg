import { describe, expect, it } from 'vitest';
import type { SplitSummary } from '@/core/types';
import { planFromSplits } from '../recorder';

const split = (p: Partial<SplitSummary>): SplitSummary => ({
  index: 0, type: 'distance', elapsedMs: 0, distanceM: 0, splitTimeMs: 0, splitDistanceM: 0, restTimeMs: 0, restDistanceM: 0,
  avgPaceMsPer500: 0, avgWatts: 0, avgStrokeRate: 0, avgHeartRate: null, restHeartRate: null, avgDragFactor: 0, strokeCount: 0, calories: 0, ...p,
} as SplitSummary);

describe('planFromSplits', () => {
  it('rebuilds PM-set intervals, folding rest splits into the rep before them', () => {
    const plan = planFromSplits('variable-interval', [
      split({ type: 'distance', splitDistanceM: 500, splitTimeMs: 120_000 }),
      split({ type: 'rest', restTimeMs: 60_000 }),
      split({ type: 'distance', splitDistanceM: 1000, splitTimeMs: 250_000 }),
    ]);
    expect(plan?.kind).toBe('intervals');
    expect(plan?.intervals).toEqual([
      { type: 'distance', value: 500, restMs: 60_000 },
      { type: 'distance', value: 1000, restMs: 0 },
    ]);
  });

  it('is null for non-interval workouts and when no reps were reported', () => {
    expect(planFromSplits('fixed-distance-splits', [split({ splitDistanceM: 500, splitTimeMs: 1 })])).toBeNull();
    expect(planFromSplits('variable-interval', [])).toBeNull();
  });
});
