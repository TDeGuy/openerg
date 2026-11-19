/** Pace plans (pure). Segment fractions are of distance (distance pieces) or of time (time pieces). */
import type { PacePlan, PacePlanSegment, PaceStrategy } from '@/core/types';

/** Sensible steady rating for a piece of this expected duration. */
export function baseRateFor(durationMs: number): number {
  const min = durationMs / 60000;
  if (min <= 2) return 36;
  if (min <= 8) return 32;
  if (min <= 20) return 28;
  if (min <= 40) return 24;
  return 22;
}

interface Draft {
  start: number;
  end: number;
  /** Offset from goal pace in ms/500 for a ~1:50 athlete (scaled by goal). */
  delta: number;
  rateDelta: number;
  label: string;
}

function drafts(strategy: PaceStrategy, durationMs: number): Draft[] {
  switch (strategy) {
    case 'negative-split':
      return [
        { start: 0, end: 0.5, delta: 1500, rateDelta: -1, label: 'Controlled first half' },
        { start: 0.5, end: 0.75, delta: -500, rateDelta: 0, label: 'Build' },
        { start: 0.75, end: 1, delta: -2500, rateDelta: 2, label: 'Push home' },
      ];
    case 'fast-start-settle-sprint': {
      // Very short pieces get a proportionally longer start.
      const startEnd = durationMs < 120000 ? 0.1 : 0.05;
      return [
        { start: 0, end: startEnd, delta: -5000, rateDelta: 6, label: 'Start' },
        { start: startEnd, end: 0.5, delta: 1000, rateDelta: 0, label: 'Settle' },
        { start: 0.5, end: 0.8, delta: -500, rateDelta: 1, label: 'Build' },
        { start: 0.8, end: 1, delta: -2000, rateDelta: 4, label: 'Sprint' },
      ];
    }
    case 'even':
      return [{ start: 0, end: 1, delta: 0, rateDelta: 0, label: 'Even pace' }];
    case 'custom':
    default:
      return [{ start: 0, end: 1, delta: 0, rateDelta: 0, label: 'Goal pace' }];
  }
}

/**
 * Average pace actually produced by a plan.
 * Distance pieces: distance-weighted mean of pace. Time pieces: time-weighted harmonic mean.
 */
export function planAveragePace(segments: PacePlanSegment[], kind: 'distance' | 'time'): number {
  if (segments.length === 0) return 0;
  if (kind === 'distance') {
    let t = 0;
    let w = 0;
    for (const s of segments) {
      const f = s.endFraction - s.startFraction;
      t += f * s.targetPaceMsPer500;
      w += f;
    }
    return w > 0 ? t / w : 0;
  }
  let d = 0;
  let w = 0;
  for (const s of segments) {
    const f = s.endFraction - s.startFraction;
    d += f / s.targetPaceMsPer500;
    w += f;
  }
  return d > 0 ? w / d : 0;
}

function solveOffset(kind: 'distance' | 'time', ds: Draft[], deltas: number[], goal: number): number {
  const w = ds.map((d) => d.end - d.start);
  let c = -deltas.reduce((acc, d, i) => acc + d * w[i]!, 0);
  if (kind === 'distance') return c;
  // Time pieces: sum(w / (goal + delta + c)) = 1 / goal  (Newton's method; monotone, converges fast).
  for (let iter = 0; iter < 60; iter++) {
    let f = -1 / goal;
    let df = 0;
    for (let i = 0; i < w.length; i++) {
      const p = goal + deltas[i]! + c;
      f += w[i]! / p;
      df -= w[i]! / (p * p);
    }
    if (Math.abs(f) < 1e-15 || df === 0) break;
    c -= f / df;
  }
  return c;
}

export function buildPacePlan(args: {
  kind: 'distance' | 'time';
  value: number;
  goalPaceMsPer500: number;
  strategy: PaceStrategy;
}): PacePlan {
  const { kind, value, goalPaceMsPer500: goal, strategy } = args;
  const durationMs = kind === 'distance' ? (value / 500) * goal : value;
  const base = baseRateFor(durationMs);
  const scale = goal / 110000;
  const ds = drafts(strategy, durationMs);
  const deltas = ds.map((d) => d.delta * scale);
  const c = solveOffset(kind, ds, deltas, goal);
  const segments: PacePlanSegment[] = ds.map((d, i) => ({
    startFraction: d.start,
    endFraction: d.end,
    targetPaceMsPer500: goal + deltas[i]! + c,
    targetStrokeRate: base + d.rateDelta,
    label: d.label,
  }));
  return { strategy, goalPaceMsPer500: goal, segments };
}

/** Segment covering `fraction` (0..1) of the piece; clamps outside the range. */
export function segmentAt(plan: PacePlan, fraction: number): PacePlanSegment {
  const segs = [...plan.segments].sort((a, b) => a.startFraction - b.startFraction);
  if (segs.length === 0) {
    return { startFraction: 0, endFraction: 1, targetPaceMsPer500: plan.goalPaceMsPer500, label: 'Goal pace' };
  }
  const f = Number.isFinite(fraction) ? fraction : 0;
  if (f <= segs[0]!.startFraction) return segs[0]!;
  for (const s of segs) if (f >= s.startFraction && f < s.endFraction) return s;
  // Past the end or inside a gap → the last segment that started before f.
  let best = segs[0]!;
  for (const s of segs) if (s.startFraction <= f) best = s;
  return best;
}
