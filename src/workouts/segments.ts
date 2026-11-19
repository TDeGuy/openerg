/** Segment lookup for continuous pieces with target changes (pure). */
import type { PlanSegment, WorkoutPlan } from '@/core/types';

export interface SegmentPos {
  index: number;
  segment: PlanSegment;
  /** Time (ms) or distance (m) left in this segment; 0 once past the listed segments. */
  remaining: number;
  /** The segment that follows, or null in the last one. */
  next: PlanSegment | null;
}

/** Does this plan carry segments the app should track? */
export function hasSegments(plan: WorkoutPlan | null | undefined): plan is WorkoutPlan & { segments: PlanSegment[] } {
  return (plan?.kind === 'single-time' || plan?.kind === 'single-distance') && !!plan.segments?.length;
}

/** Sum of segment durations (ms or metres). */
export function segmentsTotal(segments: PlanSegment[] | undefined): number {
  return (segments ?? []).reduce((a, s) => a + s.duration, 0);
}

/** `done` is elapsed ms (time piece) or metres rowed (distance piece). The last segment extends to the end. */
export function segmentLookup(plan: WorkoutPlan | null | undefined, done: number): SegmentPos | null {
  if (!hasSegments(plan)) return null;
  const segs = plan.segments;
  let start = 0;
  for (let i = 0; i < segs.length; i++) {
    const end = start + segs[i]!.duration;
    if (done < end || i === segs.length - 1) return { index: i, segment: segs[i]!, remaining: Math.max(0, end - done), next: segs[i + 1] ?? null };
    start = end;
  }
  return null;
}

/** Progress along the piece that segments are measured in. */
export function segmentProgress(plan: WorkoutPlan, m: { elapsedMs: number; distanceM: number }): number {
  return plan.kind === 'single-time' ? m.elapsedMs : m.distanceM;
}

/**
 * Repeat buttons (×2/×3/×4): the first press makes `n` copies of the block, later presses add `n` more.
 * `block` is the segment group being repeated; pass null to start from the current list.
 */
export function addRepeats(segs: PlanSegment[], block: PlanSegment[] | null, n: number): { segments: PlanSegment[]; block: PlanSegment[] } {
  const b = block && block.length && segs.length % block.length === 0 ? block : segs;
  const copies = segs.length === b.length ? n - 1 : n;
  return { segments: [...segs, ...Array.from({ length: copies }, () => b.map((s) => ({ ...s }))).flat()], block: b };
}
