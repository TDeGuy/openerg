/**
 * Pure helpers that turn a stroke list into a monotonic workout timeline.
 *
 * The PM5 may report stroke elapsed time / distance either cumulatively across the whole
 * workout or reset at the start of every interval. This normalises both styles into:
 *  - t: ms since workout start (work + rest)
 *  - w: work-only ms since start
 *  - d: cumulative work metres
 */
import type { SplitSummary, StrokeSample } from '@/core/types';

export interface TimelinePoint {
  t: number;
  w: number;
  d: number;
}

export function strokeTimeline(strokes: StrokeSample[], splits: SplitSummary[] = []): TimelinePoint[] {
  const byIndex = new Map<number, SplitSummary>();
  for (const s of splits) byIndex.set(s.index, s);
  const restAfter = (i: number) => byIndex.get(i)?.restTimeMs ?? 0;

  const out: TimelinePoint[] = [];
  let offT = 0;
  let offW = 0;
  let offD = 0;
  let restCum = 0;
  let prev: StrokeSample | null = null;

  for (const s of strokes) {
    if (prev) {
      const timeReset = s.elapsedMs + 1000 < prev.elapsedMs;
      const distReset = s.distanceM + 5 < prev.distanceM;
      const split = byIndex.get(prev.intervalCount);
      if (timeReset) {
        const work = Math.max(split?.splitTimeMs ?? 0, prev.elapsedMs);
        offT += work + restAfter(prev.intervalCount);
        offW += work;
      } else if (s.intervalCount > prev.intervalCount) {
        // Continuous clock: the rest of each passed interval is inside elapsedMs.
        for (let i = prev.intervalCount; i < s.intervalCount; i++) restCum += restAfter(i);
      }
      if (distReset) offD += Math.max(split?.splitDistanceM ?? 0, prev.distanceM);
    }
    out.push({
      t: offT + s.elapsedMs,
      w: Math.max(0, offW + s.elapsedMs - restCum),
      d: offD + s.distanceM,
    });
    prev = s;
  }
  return out;
}
