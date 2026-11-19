/** Pure builders for the "over the piece" graphs: smoothed series, plan target line, change markers, axis span. */
import { segmentAt } from '@/coach/pacePlan';
import type { PacePlan, StrokeSample, WorkoutPlan } from '@/core/types';
import { formatPace } from '@/core/units';
import { hasSegments } from '@/workouts/segments';

type Stroke = Pick<StrokeSample, 'elapsedMs' | 'distanceM' | 'paceMsPer500'> & Partial<Pick<StrokeSample, 'intervalCount'>>;

/** Window shown when the piece has no planned length (Just Row, calories): the last 10 minutes. */
export const ROLLING_MS = 600000;

export interface PaceHistoryInput {
  strokes: readonly Stroke[];
  plan: WorkoutPlan | null;
  /** Current interval index, for interval workouts. */
  rep?: number | null;
  /** Flat fallback target (current interval / plan target). */
  flatTargetMsPer500: number | null;
  boatPaceMsPer500?: number | null;
  avgPaceMsPer500?: number | null;
  /** false hides the plan target and its markers. Default true. */
  showPlan?: boolean;
  maxPoints?: number;
}

export interface PlanMarker {
  x: number;
  label: string;
}

export interface Piece {
  xUnit: 'distance' | 'time';
  /** Planned piece length (0 = unknown, rolling view). */
  planned: number;
  /** Axis start: 0 for a planned piece, else the rolling window start. */
  xMin: number;
  /** Axis end: the planned finish (or the data when it overruns); rolling window end otherwise. */
  xMax: number;
  /** Smoothed [x, value] points, ascending x. */
  points: [number, number][];
  current: [number, number] | null;
}

export interface PaceHistory extends Piece {
  /** Target as stepped [x, pace] vertices (empty when no target). */
  target: [number, number][];
  /** Where the plan changes. */
  markers: PlanMarker[];
  boat: [number, number][];
  avg: [number, number][];
  /** Faster (lower) bound is yMin; plotted at the top. */
  yMin: number;
  yMax: number;
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

/** One stretch of the plan: [from, to) in axis units at a target pace. */
interface Leg {
  from: number;
  to: number;
  pace: number;
  rate?: number;
}

/** Stepped line across the piece for a pace plan (fractions of the piece), as plan legs. */
function paceLegs(pp: PacePlan, len: number): Leg[] {
  const segs = [...pp.segments].sort((a, b) => a.startFraction - b.startFraction);
  const f = (v: number) => Math.min(1, Math.max(0, v)) * len;
  return segs.map((s) => ({ from: f(s.startFraction), to: f(s.endFraction), pace: segmentAt(pp, s.startFraction).targetPaceMsPer500, rate: s.targetStrokeRate }));
}

/** Legs of a continuous piece's target changes (durations in axis units); the last one runs to `len`. */
function segmentLegs(plan: WorkoutPlan & { segments: NonNullable<WorkoutPlan['segments']> }, len: number): Leg[] {
  const legs: Leg[] = [];
  let at = 0;
  let pace = plan.target?.paceMsPer500 ?? 0;
  plan.segments.forEach((s, i) => {
    pace = s.paceMsPer500 ?? pace;
    const to = i === plan.segments.length - 1 ? Math.max(len, at + s.duration) : at + s.duration;
    if (pace > 0) legs.push({ from: at, to, pace, rate: s.strokeRate });
    at += s.duration;
  });
  return legs;
}

/** Stepped [x, pace] vertices for a pace plan across [0, xMax] (kept for callers and tests). */
export function targetSteps(pp: PacePlan, xMax: number): [number, number][] {
  const legs = paceLegs(pp, xMax);
  return legs.length === 0 ? [[0, pp.goalPaceMsPer500], [xMax, pp.goalPaceMsPer500]] : steps(legs);
}

const steps = (legs: Leg[]): [number, number][] => legs.flatMap((l) => [[l.from, l.pace], [l.to, l.pace]] as [number, number][]);

function markersOf(legs: Leg[]): PlanMarker[] {
  return legs
    .slice(1)
    .filter((l, i) => l.pace !== legs[i]!.pace || l.rate !== legs[i]!.rate)
    .map((l) => ({ x: l.from, label: `${l.rate ? `r${l.rate} ` : ''}${formatPace(l.pace)}` }));
}

/** Axis for a plan: which unit, how long, and which strokes belong to the piece (current interval only). */
function pieceOf(plan: WorkoutPlan | null, rep: number | null | undefined) {
  let xUnit: 'distance' | 'time' = 'time';
  let planned = 0;
  let inRep = false;
  if (plan?.kind === 'single-distance' || plan?.kind === 'single-time') {
    xUnit = plan.kind === 'single-distance' ? 'distance' : 'time';
    planned = plan.value && plan.value > 0 ? plan.value : 0;
  } else if (plan?.kind === 'intervals' && rep != null) {
    const def = plan.intervals?.[plan.repeatForever ? 0 : Math.min(rep, (plan.intervals?.length ?? 1) - 1)];
    if (def && def.type !== 'calorie') {
      xUnit = def.type;
      planned = def.value > 0 ? def.value : 0;
      inRep = true;
    }
  }
  return { xUnit, planned, inRep };
}

/** Points of one series over the piece, with the axis span (full piece when its length is known, else rolling). */
export function buildPiece<T extends Stroke>(input: { strokes: readonly T[]; plan: WorkoutPlan | null; rep?: number | null; value: (s: T) => number; maxPoints?: number }): Piece {
  const { xUnit, planned, inRep } = pieceOf(input.plan, input.rep);
  const rows = inRep ? input.strokes.filter((s) => s.intervalCount === input.rep) : input.strokes;
  const key = (s: T) => (xUnit === 'distance' ? s.distanceM : s.elapsedMs);
  const x0 = inRep && rows.length ? key(rows[0]!) : 0;
  const raw: [number, number][] = [];
  for (const s of rows) {
    const v = input.value(s);
    if (v > 0 && Number.isFinite(v)) raw.push([Math.max(0, key(s) - x0), v]);
  }
  const lastRaw = raw.length ? raw[raw.length - 1]![0] : 0;
  const xMax = planned ? Math.max(planned, lastRaw) : Math.max(ROLLING_MS, lastRaw);
  const xMin = planned ? 0 : xMax - ROLLING_MS;
  const points = downsample(planned ? raw : raw.filter((p) => p[0] >= xMin), input.maxPoints ?? 160);
  return { xUnit, planned, xMin, xMax, points, current: points[points.length - 1] ?? null };
}

export function buildPaceHistory(input: PaceHistoryInput): PaceHistory {
  const { plan } = input;
  const base = buildPiece({ strokes: input.strokes, plan, rep: input.rep, value: (s) => s.paceMsPer500, maxPoints: input.maxPoints });
  const { planned, xMin, xMax, points, current } = base;
  const line = (v: number | null | undefined): [number, number][] => (v && v > 0 ? [[xMin, v], [xMax, v]] : []);

  let legs: Leg[] = [];
  if (input.showPlan !== false && planned && plan) {
    if (plan.pacePlan && plan.kind !== 'intervals') legs = paceLegs(plan.pacePlan, planned);
    else if (hasSegments(plan)) legs = segmentLegs(plan, planned);
  }
  let target: [number, number][] = legs.length ? steps(legs) : [];
  if (!legs.length && input.showPlan !== false) {
    // Pace plan without segments, else the flat fallback.
    target = plan?.pacePlan && planned && plan.kind !== 'intervals' ? targetSteps(plan.pacePlan, planned) : line(input.flatTargetMsPer500);
  }
  const boat = line(input.boatPaceMsPer500);
  const avg = line(input.avgPaceMsPer500);

  const all = [...points.map((p) => p[1]), ...target.map((p) => p[1]), ...boat.map((p) => p[1]), ...avg.map((p) => p[1])];
  let yMin = all.length ? Math.min(...all) : 0;
  let yMax = all.length ? Math.max(...all) : 0;
  if (yMax - yMin < 2000) {
    const mid = (yMin + yMax) / 2;
    yMin = mid - 1000;
    yMax = mid + 1000;
  }
  const pad = (yMax - yMin) * 0.1;

  let targetNow: number | null = null;
  if (target.length && current) targetNow = (legs.find((l) => current[0] >= l.from && current[0] < l.to) ?? legs[legs.length - 1])?.pace ?? target[0]![1];
  return { ...base, target, markers: markersOf(legs), boat, avg, yMin: yMin - pad, yMax: yMax + pad, targetNow };
}

/** Value range padded 10%, at least `minSpan` wide. */
export function valueRange(vals: number[], minSpan: number): { yMin: number; yMax: number } {
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 0;
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.1;
  return { yMin: lo - pad, yMax: hi + pad };
}
