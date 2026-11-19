import { describe, expect, it } from 'vitest';

import { currentTarget } from '@/components/live/progress';
import { emptyMetrics } from '@/core/defaults';
import { addRepeats, BUILT_IN_WORKOUTS, segmentLookup, validatePlan } from '@/workouts';

const ladder = BUILT_IN_WORKOUTS.find((p) => p.id === 'builtin-rate-ladder')!;

describe('segment lookup', () => {
  it('finds the segment, countdown and next from elapsed time', () => {
    const at = segmentLookup(ladder, 5 * 60000)!;
    expect(at.index).toBe(1);
    expect(at.segment.strokeRate).toBe(20);
    expect(at.remaining).toBe(3 * 60000);
    expect(at.next?.strokeRate).toBe(22);
  });

  it('extends the last segment and ignores plans without segments', () => {
    const last = segmentLookup(ladder, 99 * 60000)!;
    expect(last.index).toBe(5);
    expect(last.next).toBeNull();
    expect(segmentLookup({ ...ladder, segments: undefined }, 0)).toBeNull();
  });

  it('drives the live target and passes validation', () => {
    expect(validatePlan(ladder)).toEqual([]);
    const t = currentTarget(ladder, { ...emptyMetrics(), elapsedMs: 3 * 60000 + 50000 }, null);
    expect(t.strokeRate).toBe(18);
    expect(t.next).toBe('r20 in 0:10');
    expect(validatePlan({ ...ladder, segments: [{ duration: 25 * 60000, strokeRate: 20 }] })).toContain('Segments are longer than the piece.');
  });
});

describe('addRepeats', () => {
  const a = { duration: 60000, strokeRate: 20 };
  const b = { duration: 60000, strokeRate: 24 };
  it('first press makes n copies, later presses add n more', () => {
    let r = addRepeats([a], null, 2);
    expect(r.segments).toHaveLength(2);
    r = addRepeats(r.segments, r.block, 2);
    expect(r.segments).toHaveLength(4);
    r = addRepeats(r.segments, r.block, 2);
    expect(r.segments).toHaveLength(6);
  });
  it('repeats a multi-segment block and starts over after manual edits break the pattern', () => {
    let r = addRepeats([a, b], null, 3);
    expect(r.segments.map((s) => s.strokeRate)).toEqual([20, 24, 20, 24, 20, 24]);
    r = addRepeats([...r.segments, a], r.block, 2); // 7 is not a multiple of the 2-segment block
    expect(r.segments).toHaveLength(14);
  });
});
