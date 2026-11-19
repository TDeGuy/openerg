import { describe, expect, it } from 'vitest';

import type { WorkoutPlan } from '@/core/types';

import { buildPaceHistory, buildPiece, downsample, ROLLING_MS } from '../paceHistory';

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
    expect(h.xMax).toBe(ROLLING_MS);
    expect(h.xMin).toBe(0);
    expect(h.target).toEqual([[0, 115000], [ROLLING_MS, 115000]]);
  });
  it('marks where the plan changes', () => {
    const h = buildPaceHistory({ strokes: [stroke(100, 111000)], plan, flatTargetMsPer500: null });
    expect(h.markers.map((m) => m.x)).toEqual([1000]);
  });
  it('overlays continuous-piece segments, filling missing paces from the plan target', () => {
    const seg: WorkoutPlan = { id: 's', name: 's', kind: 'single-time', value: 600000, target: { paceMsPer500: 120000 }, segments: [{ duration: 300000 }, { duration: 300000, paceMsPer500: 110000, strokeRate: 28 }] };
    const h = buildPaceHistory({ strokes: [stroke(100, 119000)], plan: seg, flatTargetMsPer500: null });
    expect(h.xMax).toBe(600000);
    expect(h.target).toEqual([[0, 120000], [300000, 120000], [300000, 110000], [600000, 110000]]);
    expect(h.markers).toHaveLength(1);
    expect(h.markers[0]!.label).toContain('r28');
  });
  it('shows an interval target over the current rep only', () => {
    const iv: WorkoutPlan = { id: 'i', name: 'i', kind: 'intervals', intervals: [{ type: 'distance', value: 500, restMs: 0 }, { type: 'distance', value: 500, restMs: 0 }] };
    const strokes = [{ ...stroke(100, 100000), intervalCount: 0 }, { ...stroke(700, 101000), intervalCount: 1 }, { ...stroke(800, 102000), intervalCount: 1 }];
    const h = buildPaceHistory({ strokes, plan: iv, rep: 1, flatTargetMsPer500: 105000 });
    expect(h.xMax).toBe(500);
    expect(h.xMin).toBe(0);
    expect(h.points).toHaveLength(2);
    expect(h.target).toEqual([[0, 105000], [500, 105000]]);
  });
  it('hides the plan when asked and keeps the full axis', () => {
    const h = buildPaceHistory({ strokes: [stroke(100, 111000)], plan, flatTargetMsPer500: null, showPlan: false, boatPaceMsPer500: 109000 });
    expect(h.target).toEqual([]);
    expect(h.markers).toEqual([]);
    expect(h.xMax).toBe(2000);
    expect(h.boat).toEqual([[0, 109000], [2000, 109000]]);
  });
  it('Just Row rolls the last window; a long piece never shrinks the axis', () => {
    const late = buildPiece({ strokes: [stroke(100, 1)].map((s) => ({ ...s, elapsedMs: 900000 })), plan: null, value: (s) => s.paceMsPer500 });
    expect(late.xMax - late.xMin).toBe(ROLLING_MS);
    expect(late.xMax).toBe(900000);
    const over = buildPiece({ strokes: [stroke(2100, 1)], plan: { id: 'x', name: 'x', kind: 'single-distance', value: 2000 }, value: (s) => s.paceMsPer500 });
    expect(over.xMax).toBe(2100);
  });
  it('downsamples long rows', () => {
    const pts = Array.from({ length: 5000 }, (_, i) => [i, 100000] as [number, number]);
    expect(downsample(pts, 100).length).toBe(100);
  });
});
