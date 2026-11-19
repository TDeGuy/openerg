/** Small numeric helpers shared by the analysis module. Pure. */
import type { StrokeSample } from '@/core/types';

/** Returns `x` if it is a finite number, else `fallback`. */
export function fin(x: unknown, fallback = 0): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

/** Positive finite number or 0. */
export function pos(x: unknown): number {
  const v = fin(x);
  return v > 0 ? v : 0;
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) s += x;
  const m = s / xs.length;
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / xs.length);
}

export function round(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

export function safeDiv(a: number, b: number, fallback = 0): number {
  const r = a / b;
  return Number.isFinite(r) ? r : fallback;
}

/** Interval workout detection from the PM workout type / plan. */
export function isIntervalWorkout(w: { workoutType: string; plan?: { kind: string } | null }): boolean {
  return /interval/.test(w.workoutType ?? '') || w.plan?.kind === 'intervals';
}

export interface TrackPoint {
  /** Cumulative work time, ms. */
  t: number;
  /** Cumulative distance, m. */
  d: number;
  s: StrokeSample | null;
}

/**
 * Converts strokes into a monotonic cumulative (time, distance) track. Interval workouts where
 * the PM resets distance / time per rep are stitched together. A (0,0) origin is prepended.
 */
export function strokeTrack(strokes: StrokeSample[] | undefined): TrackPoint[] {
  const out: TrackPoint[] = [{ t: 0, d: 0, s: null }];
  if (!Array.isArray(strokes)) return out;
  let offD = 0;
  let offT = 0;
  let prevRawD = 0;
  let prevRawT = 0;
  let lastD = 0;
  let lastT = 0;
  for (const s of strokes) {
    if (!s) continue;
    const rd = pos(s.distanceM);
    const rt = pos(s.elapsedMs);
    if (rd + 1 < prevRawD) offD += prevRawD;
    if (rt + 1 < prevRawT) offT += prevRawT;
    prevRawD = rd;
    prevRawT = rt;
    const d = Math.max(lastD, rd + offD);
    const t = Math.max(lastT, rt + offT);
    lastD = d;
    lastT = t;
    out.push({ t, d, s });
  }
  return out;
}

/** Time at a cumulative distance on a track (linear interpolation). `hint` speeds sequential lookups. */
export function timeAtDistance(track: TrackPoint[], dist: number, hint = { i: 0 }): number {
  const n = track.length;
  if (n === 0) return 0;
  let i = Math.min(Math.max(hint.i, 0), n - 1);
  if (track[i].d > dist) i = 0;
  while (i + 1 < n && track[i + 1].d < dist) i++;
  hint.i = i;
  if (i + 1 >= n) return track[n - 1].t;
  const a = track[i];
  const b = track[i + 1];
  const span = b.d - a.d;
  if (span <= 0) return b.t;
  const f = Math.min(1, Math.max(0, (dist - a.d) / span));
  return a.t + (b.t - a.t) * f;
}

/** Centered moving average. */
export function movingAverage(xs: number[], window: number): number[] {
  const n = xs.length;
  const half = Math.max(0, Math.floor(window / 2));
  const out = new Array<number>(n);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const wantLo = Math.max(0, i - half);
    const wantHi = Math.min(n - 1, i + half);
    while (hi < wantHi) sum += xs[++hi];
    while (lo < wantLo) sum -= xs[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}
