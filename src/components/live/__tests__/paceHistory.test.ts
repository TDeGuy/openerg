import { describe, expect, it } from 'vitest';

import type { WorkoutPlan } from '@/core/types';

import { buildPaceHistory, downsample } from '../paceHistory';

const stroke = (d: number, pace: number) => ({ elapsedMs: d * 300, distanceM: d, paceMsPer500: pace });

describe('buildPaceHistory', () => {
  const plan: WorkoutPlan = {
    id: 'p', name: 'p', kind: 'single-distance', value: 2000,
    pacePlan: { strategy: 'custom', goalPaceMsPer500: 110000, segments: [
      { startFraction: 0, endFraction: 0.5, targetPaceMsPer500: 112000, label: 'a' },
      { startFraction: 0.5, endFraction: 1, targetPaceMsPer500: 108000, label: 'b' },
    ] },
  };
  it('spans the planned piece with a stepped target', () => {
    const h = buildPaceHistory({ strokes: [stroke(100, 111000), stroke(200, 111000)], plan, flatTargetMsPer500: null });
    expect(h.xMax).toBe(2000);
    expect(h.target).toEqual([[0, 112000], [1000, 112000], [1000, 108000], [2000, 108000]]);
    expect(h.targetNow).toBe(112000);
    expect(h.yMin).toBeLessThan(108000);
  });
  it('uses a flat target and auto-extends without a plan', () => {
    const h = buildPaceHistory({ strokes: [stroke(100, 120000)], plan: null, flatTargetMsPer500: 115000 });
    expect(h.xUnit).toBe('time');
    expect(h.xMax).toBe(30000);
    expect(h.target).toEqual([[0, 115000], [30000, 115000]]);
  });
  it('downsamples long rows', () => {
    const pts = Array.from({ length: 5000 }, (_, i) => [i, 100000] as [number, number]);
    expect(downsample(pts, 100).length).toBe(100);
  });
});
