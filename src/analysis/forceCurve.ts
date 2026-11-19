/**
 * Force-curve analysis (per stroke and per session). Pure, allocation-light: analyzeForceCurve
 * runs in a few microseconds, so it is safe to call on every stroke.
 *
 * Biomechanical model of an effective drive:
 *  - quick rise at the catch (legs hook up): 70 % of peak reached in ≲ 18 % of the drive;
 *  - one smooth peak at ~35–45 % of the drive (legs + back connected);
 *  - controlled taper through the finish (≈ 50 % of peak still on the handle at 65–90 %).
 */
import type { ForceCurveAnalysis, ForceCurveShape, ForceSessionAnalysis, Insight, StrokeSample, TechniqueFlag } from '@/core/types';
import { clamp } from '@/core/units';
import { FLAG_COPY, SHAPE_COPY } from './describe';
import { fin, pos } from './util';

export interface ForceCurveContext {
  driveTimeMs?: number;
  recoveryTimeMs?: number;
  driveLengthM?: number;
  strokeRate?: number;
  heightCm?: number | null;
}

export const CURVE_POINTS = 32;
/** Target peak position of the ideal curve (fraction of the drive). */
export const IDEAL_PEAK_POSITION = 0.4;
/** Curve shape exponents: f(x) ∝ x^A (1-x)^B, peak at A/(A+B) = 0.4, fullness ≈ 0.65. */
const IDEAL_A = 0.8;
const IDEAL_B = 1.2;
/** Fewer samples than this, or a lower peak, is not analysable. */
export const MIN_CURVE_SAMPLES = 5;
export const MIN_PEAK_N = 10;

/* Classification thresholds (fractions of the drive / of peak force). */
const FRONT_PEAK_MAX = 0.28;
const BACK_PEAK_MIN = 0.55;
const SLOW_RISE = 0.28;
const DIP_DOUBLE = 0.1;
const SPIKY_WIDTH = 0.35;
const FLAT_FULLNESS = 0.82;
const WEAK_FINISH = 0.28;
const FADE_FINISH = 0.35;
const JERKY_SMOOTHNESS = 0.7;

function clean(v: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Linear resample of a curve to `points` evenly spaced samples. Empty curve → zeros. */
export function resampleCurve(curve: number[], points: number = CURVE_POINTS): number[] {
  const n = Number.isFinite(points) && points > 0 ? Math.floor(points) : CURVE_POINTS;
  const out = new Array<number>(n).fill(0);
  const len = Array.isArray(curve) ? curve.length : 0;
  if (len === 0) return out;
  if (len === 1 || n === 1) {
    let s = 0;
    for (let i = 0; i < len; i++) s += clean(curve[i]);
    out.fill(len === 1 ? clean(curve[0]) : s / len);
    return out;
  }
  const scale = (len - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const p = i * scale;
    const lo = Math.floor(p);
    const hi = lo + 1 < len ? lo + 1 : len - 1;
    const f = p - lo;
    out[i] = clean(curve[lo]) * (1 - f) + clean(curve[hi]) * f;
  }
  return out;
}

/** Target overlay: smooth single hump peaking at 40 % of the drive, scaled so max = peakForceN. */
export function idealForceCurve(peakForceN: number, points: number = CURVE_POINTS): number[] {
  const n = Number.isFinite(points) && points > 0 ? Math.floor(points) : CURVE_POINTS;
  const out = new Array<number>(n).fill(0);
  const peak = pos(peakForceN);
  if (peak === 0 || n < 2) return n === 1 ? [peak] : out;
  const p = IDEAL_PEAK_POSITION;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const v = x <= 0 || x >= 1 ? 0 : Math.exp(IDEAL_A * Math.log(x / p) + IDEAL_B * Math.log((1 - x) / (1 - p)));
    out[i] = v;
    if (v > max) max = v;
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] = (out[i] / max) * peak;
  return out;
}

/** Expected [min, max] recovery:drive ratio for a stroke rate (ratio norms tighten as rate rises). */
export function recoveryRatioBounds(strokeRate: number): [number, number] {
  const r = pos(strokeRate) || 24;
  return [clamp(1.8 - (r - 20) * 0.075, 0.9, 1.9), clamp(3.8 - (r - 20) * 0.15, 1.8, 4.2)];
}

/** Drive-length bounds (metres): from height when known (68–90 % of height), else 1.15–1.70 m. */
export function driveLengthBounds(heightCm: number | null | undefined): [number, number] {
  const h = fin(heightCm);
  if (h >= 120 && h <= 230) return [0.68 * (h / 100), 0.9 * (h / 100)];
  return [1.15, 1.7];
}

function contextFlags(ctx: ForceCurveContext, avgForceN: number): TechniqueFlag[] {
  const flags: TechniqueFlag[] = [];
  const dl = pos(ctx.driveLengthM);
  if (dl > 0) {
    const [lo, hi] = driveLengthBounds(ctx.heightCm);
    if (dl < lo) flags.push('short-stroke');
    else if (dl > hi) flags.push('overreaching');
  }
  const drive = pos(ctx.driveTimeMs);
  const rec = pos(ctx.recoveryTimeMs);
  const rate = pos(ctx.strokeRate) || (drive + rec > 0 && drive > 0 && rec > 0 ? 60000 / (drive + rec) : 0);
  if (drive > 0 && rec > 0 && rate > 0) {
    const ratio = rec / drive;
    const [lo, hi] = recoveryRatioBounds(rate);
    if (ratio < lo) flags.push('rushed-recovery');
    else if (ratio > hi) flags.push('slow-recovery');
  }
  if (dl > 0 && avgForceN > 0 && rate >= 24) {
    const workJ = avgForceN * dl;
    if (workJ < 200) flags.push('low-power-per-stroke');
  }
  return flags;
}

function invalid(ctx: ForceCurveContext, peak: number, avg: number): ForceCurveAnalysis {
  return {
    valid: false,
    peakForceN: peak,
    avgForceN: avg,
    peakPosition: 0,
    fullness: 0,
    smoothness: 0,
    riseFraction: 0,
    impulseNs: 0,
    shape: 'flat',
    flags: contextFlags(ctx, avg),
    score: 0,
  };
}

// Scratch buffers reused across calls (analysis is synchronous, so this is safe).
const R = new Array<number>(CURVE_POINTS).fill(0);
const S = new Array<number>(CURVE_POINTS).fill(0);
const L = new Array<number>(CURVE_POINTS).fill(0);
const RM = new Array<number>(CURVE_POINTS).fill(0);

/**
 * Analyse one drive's force curve. Non-curve flags (stroke length, recovery ratio, power per
 * stroke) come from `ctx`. A curve with < 5 samples or a peak < 10 N returns valid:false
 * (context flags are still reported). `impulseNs` is 0 when ctx.driveTimeMs is unknown.
 */
export function analyzeForceCurve(curve: number[], ctx: ForceCurveContext = {}): ForceCurveAnalysis {
  const raw = Array.isArray(curve) ? curve : [];
  const len = raw.length;
  ctx = ctx ?? {};
  let peakRaw = 0;
  let sumRaw = 0;
  let tv = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const c = clean(raw[i]);
    sumRaw += c;
    if (c > peakRaw) peakRaw = c;
    if (i > 0) tv += Math.abs(c - prev);
    prev = c;
  }
  const avgRaw = len > 0 ? sumRaw / len : 0;
  if (len < MIN_CURVE_SAMPLES || peakRaw < MIN_PEAK_N) return invalid(ctx, peakRaw, avgRaw);

  const N = CURVE_POINTS;
  const scale = (len - 1) / (N - 1);
  for (let i = 0; i < N; i++) {
    const p = i * scale;
    const lo = Math.floor(p);
    const hi = lo + 1 < len ? lo + 1 : len - 1;
    const f = p - lo;
    R[i] = clean(raw[lo]) * (1 - f) + clean(raw[hi]) * f;
  }
  // Light [1 2 1]/4 smoothing for robust peak / dip detection.
  let sMax = 0;
  let sMaxIdx = 0;
  let sSum = 0;
  for (let i = 0; i < N; i++) {
    const a = R[i > 0 ? i - 1 : 0];
    const b = R[i < N - 1 ? i + 1 : N - 1];
    const v = (a + 2 * R[i] + b) / 4;
    S[i] = v;
    sSum += v;
    if (v > sMax) {
      sMax = v;
      sMaxIdx = i;
    }
  }
  if (!(sMax > 0)) return invalid(ctx, peakRaw, avgRaw);

  // Peak position with parabolic refinement (stable stroke to stroke).
  let peakIdx = sMaxIdx;
  if (sMaxIdx > 0 && sMaxIdx < N - 1) {
    const y0 = S[sMaxIdx - 1];
    const y2 = S[sMaxIdx + 1];
    const denom = y0 - 2 * sMax + y2;
    if (denom < 0) peakIdx += clamp((0.5 * (y0 - y2)) / denom, -0.5, 0.5);
  }
  const peakPosition = clamp(peakIdx / (N - 1), 0, 1);

  // Rise: first crossing of 70 % of peak.
  const thr = 0.7 * sMax;
  let riseFraction = 0;
  for (let i = 0; i < N; i++) {
    if (S[i] >= thr) {
      if (i > 0) {
        const d = S[i] - S[i - 1];
        riseFraction = (i - 1 + (d > 0 ? (thr - S[i - 1]) / d : 1)) / (N - 1);
      }
      break;
    }
  }

  // Smoothness: ideal total variation of a single hump vs actual (raw samples).
  const idealTv = 2 * peakRaw - clean(raw[0]) - clean(raw[len - 1]);
  const smoothness = tv > 0 ? clamp(idealTv / tv, 0, 1) : 0;

  // Mid-drive dip: deepest valley between two maxima that are both ≥ 50 % of peak.
  for (let i = 0; i < N; i++) L[i] = i === 0 ? S[0] : Math.max(L[i - 1], S[i]);
  for (let i = N - 1; i >= 0; i--) RM[i] = i === N - 1 ? S[i] : Math.max(RM[i + 1], S[i]);
  let dip = 0;
  const dLo = Math.round(0.12 * (N - 1));
  const dHi = Math.round(0.88 * (N - 1));
  for (let i = dLo; i <= dHi; i++) {
    const m = L[i] < RM[i] ? L[i] : RM[i];
    if (m >= 0.5 * sMax) {
      const depth = (m - S[i]) / sMax;
      if (depth > dip) dip = depth;
    }
  }

  // Width above half-peak, finish ratio.
  let above = 0;
  let finSum = 0;
  let finN = 0;
  for (let i = 0; i < N; i++) {
    if (S[i] >= 0.5 * sMax) above++;
    const x = i / (N - 1);
    if (x >= 0.65 && x <= 0.9) {
      finSum += S[i];
      finN++;
    }
  }
  const width = above / N;
  const finishRatio = finN > 0 ? finSum / finN / sMax : 0;
  const sFull = sSum / N / sMax;
  const fullness = clamp(avgRaw / peakRaw, 0, 1);

  let shape: ForceCurveShape;
  if (dip >= DIP_DOUBLE) shape = 'double-peak';
  else if (width < SPIKY_WIDTH) shape = 'spiky';
  else if (sFull >= FLAT_FULLNESS) shape = 'flat';
  else if (peakPosition < FRONT_PEAK_MAX) shape = 'front-loaded';
  else if (peakPosition > BACK_PEAK_MIN) shape = 'back-loaded';
  else shape = 'ideal';

  const flags: TechniqueFlag[] = [];
  if (shape !== 'flat') {
    if (riseFraction > SLOW_RISE) flags.push('slow-catch');
    const fade = peakPosition < FRONT_PEAK_MAX && finishRatio < FADE_FINISH;
    if (fade) flags.push('early-peak-fade');
    if (peakPosition > BACK_PEAK_MIN) flags.push('late-peak');
    if (shape === 'double-peak') flags.push('double-peak');
    if (!fade && finishRatio < WEAK_FINISH) flags.push('weak-finish');
  } else {
    flags.push('soft-drive');
  }
  if (smoothness < JERKY_SMOOTHNESS || shape === 'spiky') flags.push('jerky-drive');
  const ctxFlags = contextFlags(ctx, avgRaw);
  for (const f of ctxFlags) flags.push(f);

  // Continuous penalties → stable, monotonic score.
  let pen = 0;
  if (shape !== 'flat') pen += Math.min(35, 120 * Math.max(0, Math.abs(peakPosition - IDEAL_PEAK_POSITION) - 0.05));
  pen += Math.min(25, 120 * Math.max(0, riseFraction - 0.18));
  pen += Math.min(40, 250 * Math.max(0, dip - 0.02));
  pen += Math.min(30, 70 * Math.max(0, 0.95 - smoothness));
  pen += Math.min(30, 150 * Math.max(0, 0.45 - width));
  if (sFull < 0.55) pen += Math.min(25, 150 * (0.55 - sFull));
  if (sFull > 0.8) pen += Math.min(40, 250 * (sFull - 0.8));
  pen += Math.min(20, 80 * Math.max(0, 0.35 - finishRatio));
  pen += 4 * ctxFlags.length;
  const score = Math.round(clamp(100 - pen, 0, 100));

  const driveMs = pos(ctx.driveTimeMs);
  return {
    valid: true,
    peakForceN: peakRaw,
    avgForceN: avgRaw,
    peakPosition,
    fullness,
    smoothness,
    riseFraction: clamp(riseFraction, 0, 1),
    impulseNs: driveMs > 0 ? (avgRaw * driveMs) / 1000 : 0,
    shape,
    flags,
    score,
  };
}

/* ───────────────────────── Session aggregation ───────────────────────── */

const FLAG_PRIORITY: Record<TechniqueFlag, number> = {
  'double-peak': 1,
  'slow-catch': 0.95,
  'early-peak-fade': 0.9,
  overreaching: 0.85,
  'rushed-recovery': 0.85,
  'late-peak': 0.8,
  'short-stroke': 0.75,
  'soft-drive': 0.7,
  'weak-finish': 0.7,
  'jerky-drive': 0.7,
  'inconsistent-strokes': 0.65,
  'low-power-per-stroke': 0.6,
  'slow-recovery': 0.5,
  'rate-too-high': 0.4,
  'rate-too-low': 0.4,
};

function meanCurve(curves: number[][]): number[] {
  const out = new Array<number>(CURVE_POINTS).fill(0);
  if (curves.length === 0) return out;
  for (const c of curves) for (let i = 0; i < CURVE_POINTS; i++) out[i] += c[i];
  for (let i = 0; i < CURVE_POINTS; i++) out[i] /= curves.length;
  return out;
}

function emptySession(): ForceSessionAnalysis {
  return {
    strokesAnalysed: 0,
    averageCurve: [],
    curveStdDev: [],
    consistency: 0,
    avgPeakForceN: 0,
    avgPeakPosition: 0,
    avgFullness: 0,
    avgSmoothness: 0,
    avgScore: 0,
    dominantShape: 'ideal',
    shapeDistribution: {},
    flagFrequency: {},
    earlyCurve: [],
    lateCurve: [],
    scoreSeries: [],
    insights: [
      {
        severity: 'info',
        title: 'No force curve data',
        detail: 'The monitor did not send force curves for this workout, so stroke technique could not be analysed.',
      },
    ],
  };
}

/**
 * Aggregate force-curve analysis for a session. Strokes without a usable curve are skipped.
 * `flagFrequency['inconsistent-strokes']` = fraction of strokes whose curve deviates from the
 * session mean by > 15 % of mean peak (RMS). Consistency = 1 − 2·(mean point σ / mean force).
 */
export function analyzeForceSession(strokes: StrokeSample[]): ForceSessionAnalysis {
  if (!Array.isArray(strokes) || strokes.length === 0) return emptySession();
  const analyses: ForceCurveAnalysis[] = [];
  const curves: number[][] = [];
  for (const s of strokes) {
    if (!s || !Array.isArray(s.forceCurve)) continue;
    const a = analyzeForceCurve(s.forceCurve, {
      driveTimeMs: s.driveTimeMs,
      recoveryTimeMs: s.recoveryTimeMs,
      driveLengthM: s.driveLengthM,
      strokeRate: s.strokeRate,
    });
    if (!a.valid) continue;
    analyses.push(a);
    curves.push(resampleCurve(s.forceCurve, CURVE_POINTS));
  }
  const n = analyses.length;
  if (n === 0) return emptySession();

  const avg = meanCurve(curves);
  const sd = new Array<number>(CURVE_POINTS).fill(0);
  for (const c of curves) for (let i = 0; i < CURVE_POINTS; i++) sd[i] += (c[i] - avg[i]) ** 2;
  for (let i = 0; i < CURVE_POINTS; i++) sd[i] = Math.sqrt(sd[i] / n);
  let avgMean = 0;
  let sdMean = 0;
  for (let i = 0; i < CURVE_POINTS; i++) {
    avgMean += avg[i] / CURVE_POINTS;
    sdMean += sd[i] / CURVE_POINTS;
  }
  const consistency = n < 2 ? 1 : clamp(1 - 2 * (avgMean > 0 ? sdMean / avgMean : 1), 0, 1);

  const meanOf = (f: (a: ForceCurveAnalysis) => number) => analyses.reduce((s, a) => s + f(a), 0) / n;
  const avgPeak = meanOf((a) => a.peakForceN);

  const shapeCounts: Partial<Record<ForceCurveShape, number>> = {};
  const flagCounts: Partial<Record<TechniqueFlag, number>> = {};
  for (const a of analyses) {
    shapeCounts[a.shape] = (shapeCounts[a.shape] ?? 0) + 1;
    for (const f of a.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  }
  // Per-stroke inconsistency.
  if (n >= 5 && avgPeak > 0) {
    let inc = 0;
    for (const c of curves) {
      let ss = 0;
      for (let i = 0; i < CURVE_POINTS; i++) ss += (c[i] - avg[i]) ** 2;
      if (Math.sqrt(ss / CURVE_POINTS) / avgPeak > 0.15) inc++;
    }
    if (inc > 0) flagCounts['inconsistent-strokes'] = inc;
  }

  const shapeDistribution: Partial<Record<ForceCurveShape, number>> = {};
  let dominantShape: ForceCurveShape = 'ideal';
  let best = -1;
  for (const k of Object.keys(shapeCounts) as ForceCurveShape[]) {
    const c = shapeCounts[k] ?? 0;
    shapeDistribution[k] = c / n;
    if (c > best) {
      best = c;
      dominantShape = k;
    }
  }
  const flagFrequency: Partial<Record<TechniqueFlag, number>> = {};
  for (const k of Object.keys(flagCounts) as TechniqueFlag[]) flagFrequency[k] = (flagCounts[k] ?? 0) / n;

  const third = n >= 3 ? Math.floor(n / 3) : n;
  const earlyCurve = meanCurve(curves.slice(0, third));
  const lateCurve = meanCurve(curves.slice(n - third));
  const avgScore = meanOf((a) => a.score);

  const insights = sessionInsights({
    n,
    flagFrequency,
    consistency,
    avgScore,
    dominantShape,
    early: analyses.slice(0, third),
    late: analyses.slice(n - third),
  });

  return {
    strokesAnalysed: n,
    averageCurve: avg,
    curveStdDev: sd,
    consistency,
    avgPeakForceN: avgPeak,
    avgPeakPosition: meanOf((a) => a.peakPosition),
    avgFullness: meanOf((a) => a.fullness),
    avgSmoothness: meanOf((a) => a.smoothness),
    avgScore,
    dominantShape,
    shapeDistribution,
    flagFrequency,
    earlyCurve,
    lateCurve,
    scoreSeries: analyses.map((a) => a.score),
    insights,
  };
}

function sessionInsights(a: {
  n: number;
  flagFrequency: Partial<Record<TechniqueFlag, number>>;
  consistency: number;
  avgScore: number;
  dominantShape: ForceCurveShape;
  early: ForceCurveAnalysis[];
  late: ForceCurveAnalysis[];
}): Insight[] {
  const out: { i: Insight; w: number }[] = [];
  for (const f of Object.keys(a.flagFrequency) as TechniqueFlag[]) {
    const freq = a.flagFrequency[f] ?? 0;
    if (freq < 0.25) continue;
    const copy = FLAG_COPY[f];
    out.push({
      w: 1 + FLAG_PRIORITY[f] * freq,
      i: {
        severity: freq >= 0.5 ? 'warn' : 'info',
        title: copy.title,
        detail: `${copy.detail} Seen on ${Math.round(freq * 100)} % of strokes.`,
        flag: f,
        drill: copy.drill,
      },
    });
  }
  const m = (xs: ForceCurveAnalysis[], f: (x: ForceCurveAnalysis) => number) =>
    xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0;
  if (a.n >= 9) {
    const ep = m(a.early, (x) => x.peakForceN);
    const lp = m(a.late, (x) => x.peakForceN);
    const drop = ep > 0 ? (ep - lp) / ep : 0;
    if (drop > 0.08) {
      out.push({
        w: 1.5,
        i: {
          severity: 'warn',
          title: 'Power faded late in the session',
          detail: `Peak force dropped ${Math.round(drop * 100)} % from the first to the last third. Fatigue is changing your stroke.`,
          drill: 'Build endurance with longer steady pieces at r18–20, and in hard pieces focus on a sharp catch when tired rather than pulling harder with the arms.',
        },
      });
    }
    const shift = m(a.late, (x) => x.peakPosition) - m(a.early, (x) => x.peakPosition);
    if (Math.abs(shift) > 0.06) {
      out.push({
        w: 1.3,
        i: {
          severity: 'info',
          title: shift > 0 ? 'Peak moved later as you tired' : 'Peak moved earlier as you tired',
          detail:
            shift > 0
              ? 'Later in the session the legs contributed less and the back and arms took over.'
              : 'Later in the session the stroke got shorter: force came early and died away.',
          drill: 'In the last third, refocus on the catch: legs first, keep the arms long until the legs are nearly down.',
        },
      });
    }
  }
  if (a.consistency < 0.75 && a.n >= 5) {
    const c = FLAG_COPY['inconsistent-strokes'];
    out.push({
      w: 1.2,
      i: {
        severity: 'info',
        title: c.title,
        detail: `${c.detail} Consistency ${Math.round(a.consistency * 100)} %.`,
        flag: 'inconsistent-strokes',
        drill: c.drill,
      },
    });
  } else if (a.consistency >= 0.85 && a.n >= 5) {
    out.push({
      w: 0.5,
      i: { severity: 'good', title: 'Very consistent strokes', detail: `Your curves overlay closely (${Math.round(a.consistency * 100)} % consistency). Great rhythm.` },
    });
  }
  if (a.avgScore >= 80) {
    out.push({
      w: 0.6,
      i: {
        severity: 'good',
        title: 'Strong, efficient drive',
        detail: `Average stroke score ${Math.round(a.avgScore)}. ${SHAPE_COPY[a.dominantShape].title}: ${SHAPE_COPY[a.dominantShape].detail}`,
      },
    });
  } else if (out.length === 0) {
    out.push({
      w: 0.4,
      i: { severity: 'info', title: SHAPE_COPY[a.dominantShape].title, detail: SHAPE_COPY[a.dominantShape].detail },
    });
  }
  const rank = (s: Insight['severity']) => (s === 'warn' ? 2 : s === 'info' ? 1 : 0);
  out.sort((x, y) => rank(y.i.severity) - rank(x.i.severity) || y.w - x.w);
  return out.slice(0, 6).map((o) => o.i);
}
