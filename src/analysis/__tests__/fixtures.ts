import type { SplitSummary, StrokeSample, WorkoutListItem, WorkoutRecord } from '@/core/types';
import { paceToWatts } from '@/core/units';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Beta-like hump peaking at p; k controls width (higher = narrower). */
export function hump(p: number, k = 2, n = 24, peak = 500): number[] {
  const a = k * p;
  const b = k * (1 - p);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    out.push(x <= 0 || x >= 1 ? 0 : peak * Math.exp(a * Math.log(x / p) + b * Math.log((1 - x) / (1 - p))));
  }
  return out;
}

export type ShapeKind = 'ideal' | 'front' | 'back' | 'double' | 'flat' | 'spiky' | 'jerky' | 'weakFinish';

export function curve(kind: ShapeKind, opts: { n?: number; peak?: number; noise?: number; seed?: number } = {}): number[] {
  const n = opts.n ?? 24;
  const peak = opts.peak ?? 500;
  let c: number[];
  const xs = Array.from({ length: n }, (_, i) => i / (n - 1));
  const g = (x: number, mu: number, s: number) => Math.exp(-((x - mu) ** 2) / (2 * s * s));
  switch (kind) {
    case 'ideal':
      c = hump(0.4, 2, n, peak);
      break;
    case 'front':
      c = hump(0.18, 2.5, n, peak);
      break;
    case 'back':
      c = hump(0.7, 2, n, peak);
      break;
    case 'double':
      c = xs.map((x) => peak * (g(x, 0.25, 0.1) + 0.9 * g(x, 0.65, 0.12)));
      break;
    case 'flat':
      c = xs.map((x) => (x < 0.08 ? (x / 0.08) * peak : x < 0.85 ? peak : peak * (1 - ((x - 0.85) / 0.15) * 0.4)));
      break;
    case 'spiky':
      c = xs.map((x) => peak * g(x, 0.4, 0.07));
      break;
    case 'jerky':
      c = hump(0.4, 2, n, peak).map((v, i) => v * (1 + (i % 2 ? 0.2 : -0.2)));
      break;
    case 'weakFinish': {
      const up = hump(0.38, 2, n, peak);
      c = xs.map((x, i) => (x <= 0.38 ? up[i] : x >= 0.7 ? 0 : peak * (1 - (x - 0.38) / 0.32)));
      break;
    }
  }
  if (opts.noise) {
    const r = rng(opts.seed ?? 1);
    c = c.map((v) => Math.max(0, v + (r() * 2 - 1) * opts.noise! * peak));
  }
  return c;
}

export function stroke(i: number, partial: Partial<StrokeSample> = {}): StrokeSample {
  return {
    strokeNumber: i,
    elapsedMs: i * 2500,
    distanceM: i * 10,
    paceMsPer500: 110000,
    watts: paceToWatts(110000),
    strokeRate: 24,
    heartRate: 150,
    driveLengthM: 1.45,
    driveTimeMs: 800,
    recoveryTimeMs: 1700,
    strokeDistanceM: 10,
    peakForceN: 500,
    avgForceN: 330,
    workPerStrokeJ: 480,
    intervalCount: 0,
    forceCurve: curve('ideal'),
    ...partial,
  };
}

/**
 * Builds a single-piece record whose pace follows paceAt(fraction of distance).
 * Strokes every 10 m; optional splits of `splitM` metres; HR rises with `hrDrift` bpm over the piece.
 */
export function makeRecord(opts: {
  distanceM?: number;
  paceAt: (f: number) => number;
  withStrokes?: boolean;
  splitM?: number;
  hr?: number;
  hrDrift?: number;
  workoutType?: WorkoutRecord['workoutType'];
}): WorkoutRecord {
  const D = opts.distanceM ?? 2000;
  const strokes: StrokeSample[] = [];
  let t = 0;
  let d = 0;
  let i = 0;
  const hr0 = opts.hr ?? 160;
  while (d < D - 1e-6) {
    const step = Math.min(10, D - d);
    const pace = opts.paceAt((d + step / 2) / D);
    t += (pace / 500) * step;
    d += step;
    i++;
    strokes.push(
      stroke(i, {
        elapsedMs: t,
        distanceM: d,
        paceMsPer500: pace,
        watts: paceToWatts(pace),
        heartRate: Math.round(hr0 + (opts.hrDrift ?? 0) * (d / D)),
        strokeDistanceM: step,
      }),
    );
  }
  const splits: SplitSummary[] = [];
  if (opts.splitM) {
    let prevT = 0;
    let prevD = 0;
    for (const s of strokes) {
      if (s.distanceM - prevD >= opts.splitM - 1e-6 || s === strokes[strokes.length - 1]) {
        const dd = s.distanceM - prevD;
        const tt = s.elapsedMs - prevT;
        splits.push(split(splits.length, dd, tt, { elapsedMs: s.elapsedMs, distanceM: s.distanceM, avgHeartRate: s.heartRate }));
        prevT = s.elapsedMs;
        prevD = s.distanceM;
      }
    }
  }
  const total = strokes[strokes.length - 1].elapsedMs;
  return record({
    distanceM: D,
    elapsedMs: total,
    avgPaceMsPer500: (total / D) * 500,
    strokes: opts.withStrokes === false ? [] : strokes,
    splits,
    workoutType: opts.workoutType ?? 'fixed-distance-splits',
  });
}

export function split(index: number, distM: number, timeMs: number, partial: Partial<SplitSummary> = {}): SplitSummary {
  const pace = (timeMs / distM) * 500;
  return {
    index,
    type: 'distance',
    elapsedMs: timeMs,
    distanceM: distM,
    splitTimeMs: timeMs,
    splitDistanceM: distM,
    restTimeMs: 0,
    restDistanceM: 0,
    avgPaceMsPer500: pace,
    avgWatts: paceToWatts(pace),
    avgStrokeRate: 24,
    avgHeartRate: 160,
    restHeartRate: null,
    avgDragFactor: 125,
    calories: 30,
    strokeCount: 50,
    ...partial,
  };
}

export function record(partial: Partial<WorkoutRecord> = {}): WorkoutRecord {
  return {
    id: 'w1',
    startedAt: new Date(2026, 10, 2, 9).getTime(),
    endedAt: new Date(2026, 10, 2, 10).getTime(),
    machineType: 'rower',
    plan: null,
    title: '2000m',
    workoutType: 'fixed-distance-splits',
    elapsedMs: 420000,
    distanceM: 2000,
    avgPaceMsPer500: 105000,
    avgWatts: 0,
    avgStrokeRate: 30,
    avgHeartRate: 170,
    maxHeartRate: 185,
    calories: 120,
    strokeCount: 210,
    avgDragFactor: 125,
    totalRestMs: 0,
    splits: [],
    strokes: [],
    heartRate: [],
    coxCalls: [],
    ...partial,
  };
}

export function listItem(partial: Partial<WorkoutListItem> = {}): WorkoutListItem {
  const { strokes: _s, heartRate: _h, coxCalls: _c, splits: _sp, ...rest } = record();
  return { ...rest, ...partial };
}

/** Recursively finds NaN / ±Infinity numbers; returns their paths. */
export function badNumbers(v: unknown, path = '$', out: string[] = []): string[] {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(path);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => badNumbers(x, `${path}[${i}]`, out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) badNumbers(x, `${path}.${k}`, out);
  }
  return out;
}
