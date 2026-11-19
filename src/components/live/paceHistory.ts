/** Pure builder for the "Split over piece" graph: smoothed pace series + target line. */
import { segmentAt } from '@/coach/pacePlan';
import type { PacePlan, StrokeSample, WorkoutPlan } from '@/core/types';

export interface PaceHistoryInput {
  strokes: readonly Pick<StrokeSample, 'elapsedMs' | 'distanceM' | 'paceMsPer500'>[];
  plan: WorkoutPlan | null;
  /** Flat fallback target (current interval / plan target, then pace-boat target). */
  flatTargetMsPer500: number | null;
  maxPoints?: number;
}

export interface PaceHistory {
  xUnit: 'distance' | 'time';
  /** Axis end: planned piece length when known, else the data extent (min 1). */
  xMax: number;
  /** Smoothed [x, pace] points, ascending x. */
  points: [number, number][];
  /** Target as stepped [x, pace] vertices (empty when no target). */
  target: [number, number][];
  /** Faster (lower) bound is yMin; plotted at the top. */
  yMin: number;
  yMax: number;
  current: [number, number] | null;
  targetNow: number | null;
}

const SMOOTH = 5;

/** Average strokes into at most `max` x-buckets, then a short moving average. */
export function downsample(pts: [number, number][], max: number): [number, number][] {
  let out = pts;
  if (pts.length > max && max > 1) {
    const size = pts.length / max;
    out = [];
    for (let b = 0; b < max; b++) {
      const lo = Math.floor(b * size);
      const hi = Math.max(lo + 1, Math.floor((b + 1) * size));
      let sx = 0;
      let sy = 0;
      for (let i = lo; i < hi; i++) {
        sx += pts[i]![0];
        sy += pts[i]![1];
      }
      out.push([sx / (hi - lo), sy / (hi - lo)]);
    }
  }
  return out.map(([x], i) => {
    const a = Math.max(0, i - (SMOOTH >> 1));
    const b = Math.min(out.length - 1, i + (SMOOTH >> 1));
    let s = 0;
    for (let k = a; k <= b; k++) s += out[k]![1];
    return [x, s / (b - a + 1)] as [number, number];
  });
}

/** Stepped line across [0, xMax] for a pace plan (fractions of the piece). */
export function targetSteps(pp: PacePlan, xMax: number): [number, number][] {
  const segs = [...pp.segments].sort((a, b) => a.startFraction - b.startFraction);
  if (segs.length === 0) return [[0, pp.goalPaceMsPer500], [xMax, pp.goalPaceMsPer500]];
  const out: [number, number][] = [];
  for (const s of segs) {
    const p = segmentAt(pp, s.startFraction).targetPaceMsPer500;
    out.push([Math.min(1, Math.max(0, s.startFraction)) * xMax, p], [Math.min(1, Math.max(0, s.endFraction)) * xMax, p]);
  }
  return out;
}

export function buildPaceHistory(input: PaceHistoryInput): PaceHistory {
  const { plan, strokes } = input;
  const xUnit: 'distance' | 'time' = plan?.kind === 'single-distance' ? 'distance' : 'time';
  const planned = plan && plan.value && plan.value > 0 && (plan.kind === 'single-distance' || plan.kind === 'single-time') ? plan.value : 0;
  const raw: [number, number][] = [];
  for (const s of strokes) {
    if (s.paceMsPer500 > 0 && Number.isFinite(s.paceMsPer500)) raw.push([xUnit === 'distance' ? s.distanceM : s.elapsedMs, s.paceMsPer500]);
  }
  const points = downsample(raw, input.maxPoints ?? 160);
  const last = points[points.length - 1] ?? null;
  const xMax = Math.max(1, planned || (last ? last[0] : 0));

  let target: [number, number][] = [];
  if (planned && plan?.pacePlan) target = targetSteps(plan.pacePlan, xMax);
  else if (input.flatTargetMsPer500 && input.flatTargetMsPer500 > 0) target = [[0, input.flatTargetMsPer500], [xMax, input.flatTargetMsPer500]];

  const all = [...points.map((p) => p[1]), ...target.map((p) => p[1])];
  let yMin = all.length ? Math.min(...all) : 0;
  let yMax = all.length ? Math.max(...all) : 0;
  if (yMax - yMin < 2000) {
    const mid = (yMin + yMax) / 2;
    yMin = mid - 1000;
    yMax = mid + 1000;
  }
  const pad = (yMax - yMin) * 0.1;

  let targetNow: number | null = null;
  if (target.length && last) {
    targetNow = planned && plan?.pacePlan ? segmentAt(plan.pacePlan, last[0] / xMax).targetPaceMsPer500 : target[0]![1];
  }
  return { xUnit, xMax, points, target, yMin: yMin - pad, yMax: yMax + pad, current: last, targetNow };
}
