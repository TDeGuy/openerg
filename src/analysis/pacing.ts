/**
 * Pacing analysis of a recorded piece. Works with splits only, strokes only, both, or neither.
 * Series x values are cumulative work time (ms); segment watts use the Concept2 cubic
 * pace–power relation so that "time lost vs even pacing" is internally consistent.
 */
import type { Insight, PacingAnalysis, PacingProfile, PacingSegment, SeriesPoint, SplitSummary, WorkoutRecord } from '@/core/types';
import { clamp, paceToWatts, wattsToPace } from '@/core/units';
import { PACING_COPY } from './describe';
import { fin, movingAverage, pos, round, stdDev, strokeTrack, timeAtDistance, type TrackPoint } from './util';

export const DEFAULT_SEGMENTS = 8;
const MAX_SERIES_POINTS = 400;

function emptyNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function seg(
  index: number,
  startM: number,
  endM: number,
  startMs: number,
  endMs: number,
  paceHint: number,
  rate: number,
  hr: number | null,
): PacingSegment {
  const dist = endM - startM;
  const dur = endMs - startMs;
  const pace = pos(paceHint) || (dist > 0 && dur > 0 ? (dur / dist) * 500 : 0);
  return {
    index,
    startM,
    endM,
    startMs,
    endMs,
    avgPaceMsPer500: pace,
    avgWatts: paceToWatts(pace),
    avgStrokeRate: pos(rate),
    avgHeartRate: hr != null && hr > 0 ? hr : null,
    deltaVsAvgMs: 0,
    deltaVsPlanMs: null,
  };
}

/** Segments from PM splits (work portions only, rest excluded). */
export function segmentsFromSplits(splits: SplitSummary[] | undefined): PacingSegment[] {
  if (!Array.isArray(splits)) return [];
  const out: PacingSegment[] = [];
  let m = 0;
  let t = 0;
  for (const s of splits) {
    if (!s || s.type === 'rest' || s.type === 'rest-undefined') continue;
    const d = pos(s.splitDistanceM);
    const dur = pos(s.splitTimeMs);
    if (d <= 0 && dur <= 0) continue;
    const pace = pos(s.avgPaceMsPer500) || (d > 0 && dur > 0 ? (dur / d) * 500 : 0);
    if (pace <= 0) continue;
    const dd = d > 0 ? d : (dur / pace) * 500;
    const tt = dur > 0 ? dur : (pace / 500) * d;
    out.push(seg(out.length, m, m + dd, t, t + tt, pace, s.avgStrokeRate, s.avgHeartRate));
    m += dd;
    t += tt;
  }
  return out;
}

/** `count` equal-distance segments from a stroke track. */
export function segmentsFromTrack(track: TrackPoint[], count: number): PacingSegment[] {
  const total = track.length ? track[track.length - 1].d : 0;
  if (total <= 0 || count < 1 || track.length < 3) return [];
  const out: PacingSegment[] = [];
  const hint = { i: 0 };
  let k = 1;
  for (let i = 0; i < count; i++) {
    const d0 = (total * i) / count;
    const d1 = (total * (i + 1)) / count;
    const t0 = timeAtDistance(track, d0, hint);
    const t1 = timeAtDistance(track, d1, hint);
    let rSum = 0;
    let rN = 0;
    let hSum = 0;
    let hN = 0;
    while (k < track.length && (track[k].d <= d1 || i === count - 1)) {
      const s = track[k].s;
      if (s) {
        if (pos(s.strokeRate) > 0) {
          rSum += s.strokeRate;
          rN++;
        }
        if (s.heartRate != null && pos(s.heartRate) > 0) {
          hSum += s.heartRate;
          hN++;
        }
      }
      k++;
    }
    out.push(seg(i, d0, d1, t0, t1, 0, rN ? rSum / rN : 0, hN ? hSum / hN : null));
  }
  return out.filter((s) => s.avgPaceMsPer500 > 0).map((s, i) => ({ ...s, index: i }));
}

function totals(segs: PacingSegment[]): { dist: number; time: number } {
  let dist = 0;
  let time = 0;
  for (const s of segs) {
    dist += s.endM - s.startM;
    time += s.endMs - s.startMs;
  }
  return { dist, time };
}

/** First-half and second-half pace (by distance, assuming constant pace within a segment). */
function halfPaces(segs: PacingSegment[]): [number, number] {
  const { dist } = totals(segs);
  if (dist <= 0) return [0, 0];
  const half = dist / 2;
  let t1 = 0;
  let t2 = 0;
  let covered = 0;
  for (const s of segs) {
    const d = s.endM - s.startM;
    const tPerM = s.avgPaceMsPer500 / 500;
    const inFirst = clamp(half - covered, 0, d);
    t1 += inFirst * tPerM;
    t2 += (d - inFirst) * tPerM;
    covered += d;
  }
  return [(t1 / half) * 500, (t2 / half) * 500];
}

/** Classify a sequence of segment paces. */
export function classifyPacing(paces: number[], fadePct: number, cvPct: number): PacingProfile {
  const n = paces.length;
  if (n < 2) return 'unknown';
  if (cvPct < 1 && Math.abs(fadePct) < 1) return 'even';
  if (n < 3) return fadePct >= 1 ? 'positive-split' : fadePct <= -1 ? 'negative-split' : 'even';
  const avg = paces.reduce((a, b) => a + b, 0) / n;
  // Erratic: many direction changes in meaningful (> 0.3 %) pace swings.
  if (n >= 4 && cvPct > 2) {
    const diffs: number[] = [];
    for (let i = 1; i < n; i++) {
      const d = paces[i] - paces[i - 1];
      if (Math.abs(d) > 0.003 * avg) diffs.push(Math.sign(d));
    }
    let changes = 0;
    for (let i = 1; i < diffs.length; i++) if (diffs[i] !== diffs[i - 1]) changes++;
    if (diffs.length >= 3 && changes / (diffs.length - 1) >= 0.6) return 'erratic';
  }
  const first = paces[0];
  const last = paces[n - 1];
  const middle = paces.slice(1, n - 1);
  const mid = middle.reduce((a, b) => a + b, 0) / middle.length;
  if (first < mid * 0.99 && last < mid * 0.99) return 'u-shaped';
  let fastest = 0;
  let slowest = 0;
  for (let i = 1; i < n; i++) {
    if (paces[i] < paces[fastest]) fastest = i;
    if (paces[i] > paces[slowest]) slowest = i;
  }
  if (fadePct >= 3 && fastest === 0 && last >= paces[slowest] * 0.995) return 'fly-and-die';
  if (fadePct >= 1) return 'positive-split';
  if (fadePct <= -1) return 'negative-split';
  return cvPct > 2.5 ? 'erratic' : 'even';
}

function downsample(points: SeriesPoint[]): SeriesPoint[] {
  if (points.length <= MAX_SERIES_POINTS) return points;
  const step = points.length / MAX_SERIES_POINTS;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < MAX_SERIES_POINTS; i++) out.push(points[Math.floor(i * step)]);
  out[out.length - 1] = points[points.length - 1];
  return out;
}

function smoothSeries(xs: number[], ys: number[], window: number): SeriesPoint[] {
  const sm = movingAverage(ys, window);
  return downsample(xs.map((x, i) => ({ x, y: sm[i] })));
}

interface Series {
  paceSeries: SeriesPoint[];
  wattsSeries: SeriesPoint[];
  rateSeries: SeriesPoint[];
  heartRateSeries: SeriesPoint[];
  distancePerStrokeSeries: SeriesPoint[];
}

function buildSeries(record: WorkoutRecord, track: TrackPoint[], segs: PacingSegment[]): Series {
  const pts = track.filter((p) => p.s);
  const out: Series = { paceSeries: [], wattsSeries: [], rateSeries: [], heartRateSeries: [], distancePerStrokeSeries: [] };
  if (pts.length >= 2) {
    const W = 5;
    const pw = pts.filter((p) => pos(p.s!.watts) > 0 || pos(p.s!.paceMsPer500) > 0);
    const watts = pw.map((p) => pos(p.s!.watts) || paceToWatts(p.s!.paceMsPer500));
    const wSm = movingAverage(watts, W);
    out.wattsSeries = downsample(pw.map((p, i) => ({ x: p.t, y: wSm[i] })));
    out.paceSeries = downsample(pw.map((p, i) => ({ x: p.t, y: wattsToPace(wSm[i]) })));
    const pr = pts.filter((p) => pos(p.s!.strokeRate) > 0);
    out.rateSeries = smoothSeries(pr.map((p) => p.t), pr.map((p) => p.s!.strokeRate), W);
    const dpsX: number[] = [];
    const dpsY: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prevD = i > 0 ? pts[i - 1].d : 0;
      const v = pos(pts[i].s!.strokeDistanceM) || (i > 0 ? pts[i].d - prevD : 0);
      if (v > 0 && v < 30) {
        dpsX.push(pts[i].t);
        dpsY.push(v);
      }
    }
    out.distancePerStrokeSeries = smoothSeries(dpsX, dpsY, W);
    const ph = pts.filter((p) => p.s!.heartRate != null && pos(p.s!.heartRate) > 0);
    if (!(Array.isArray(record.heartRate) && record.heartRate.length >= 2)) {
      out.heartRateSeries = smoothSeries(ph.map((p) => p.t), ph.map((p) => p.s!.heartRate as number), W);
    }
  } else if (segs.length) {
    for (const s of segs) {
      out.paceSeries.push({ x: s.endMs, y: s.avgPaceMsPer500 });
      out.wattsSeries.push({ x: s.endMs, y: s.avgWatts });
      if (s.avgStrokeRate > 0) out.rateSeries.push({ x: s.endMs, y: s.avgStrokeRate });
      if (s.avgHeartRate != null) out.heartRateSeries.push({ x: s.endMs, y: s.avgHeartRate });
      if (s.avgStrokeRate > 0) {
        const strokes = ((s.endMs - s.startMs) / 60000) * s.avgStrokeRate;
        if (strokes > 0) out.distancePerStrokeSeries.push({ x: s.endMs, y: (s.endM - s.startM) / strokes });
      }
    }
  }
  if (Array.isArray(record.heartRate) && record.heartRate.length >= 2) {
    const hr = record.heartRate.filter((h) => h && pos(h.bpm) > 0);
    out.heartRateSeries = smoothSeries(hr.map((h) => fin(h.elapsedMs)), hr.map((h) => h.bpm), 5);
  }
  return out;
}

/** Aerobic decoupling: drop of power/HR efficiency from the first to the second half, %. */
function hrDrift(record: WorkoutRecord, track: TrackPoint[], segs: PacingSegment[], totalTime: number): number | null {
  if (totalTime <= 0) return null;
  const half = totalTime / 2;
  const hr: { t: number; v: number }[] = [];
  if (Array.isArray(record.heartRate) && record.heartRate.length >= 4) {
    for (const h of record.heartRate) if (h && pos(h.bpm) > 0) hr.push({ t: fin(h.elapsedMs), v: h.bpm });
  } else {
    for (const p of track) if (p.s && p.s.heartRate != null && pos(p.s.heartRate) > 0) hr.push({ t: p.t, v: p.s.heartRate });
  }
  const pw: { t: number; v: number; w: number }[] = [];
  const strokePts = track.filter((p) => p.s && (pos(p.s.watts) > 0 || pos(p.s.paceMsPer500) > 0));
  if (strokePts.length >= 4) {
    for (const p of strokePts) pw.push({ t: p.t, v: pos(p.s!.watts) || paceToWatts(p.s!.paceMsPer500), w: 1 });
  } else {
    for (const s of segs) pw.push({ t: (s.startMs + s.endMs) / 2, v: s.avgWatts, w: s.endMs - s.startMs });
  }
  if (hr.length < 2) {
    for (const s of segs) if (s.avgHeartRate != null) hr.push({ t: (s.startMs + s.endMs) / 2, v: s.avgHeartRate });
  }
  const avgHalf = (xs: { t: number; v: number; w?: number }[], first: boolean) => {
    let s = 0;
    let w = 0;
    for (const x of xs) {
      if (first ? x.t < half : x.t >= half) {
        const wt = x.w ?? 1;
        s += x.v * wt;
        w += wt;
      }
    }
    return w > 0 ? s / w : 0;
  };
  const h1 = avgHalf(hr, true);
  const h2 = avgHalf(hr, false);
  const p1 = avgHalf(pw, true);
  const p2 = avgHalf(pw, false);
  if (!(h1 > 0 && h2 > 0 && p1 > 0 && p2 > 0)) return null;
  const ef1 = p1 / h1;
  const ef2 = p2 / h2;
  return round(((ef1 - ef2) / ef1) * 100, 1);
}

function applyPlan(record: WorkoutRecord, segs: PacingSegment[]): void {
  const plan = record.plan?.pacePlan;
  if (!plan) return;
  const { dist, time } = totals(segs);
  const byTime = record.plan?.kind === 'single-time';
  const goal = pos(plan.goalPaceMsPer500);
  for (const s of segs) {
    const f = byTime ? (time > 0 ? (s.startMs + s.endMs) / 2 / time : 0) : dist > 0 ? (s.startM + s.endM) / 2 / dist : 0;
    let target = 0;
    if (Array.isArray(plan.segments) && plan.segments.length) {
      const hit =
        plan.segments.find((p) => f >= p.startFraction && f < p.endFraction) ??
        (f >= 1 ? plan.segments[plan.segments.length - 1] : plan.segments[0]);
      target = pos(hit?.targetPaceMsPer500);
    }
    if (!target) target = goal;
    s.deltaVsPlanMs = target > 0 ? round(s.avgPaceMsPer500 - target) : null;
  }
}

function sec(ms: number): string {
  return `${(Math.abs(ms) / 1000).toFixed(1)} s`;
}

export function analyzePacing(record: WorkoutRecord): PacingAnalysis {
  const track = strokeTrack(record?.strokes);
  let segs = segmentsFromSplits(record?.splits);
  if (segs.length < 2) {
    const strokeCount = track.length - 1;
    const count = strokeCount >= 16 ? DEFAULT_SEGMENTS : Math.max(1, Math.floor(strokeCount / 2));
    const fromStrokes = segmentsFromTrack(track, count);
    if (fromStrokes.length >= segs.length) segs = fromStrokes;
  }
  if (segs.length === 0 && record && pos(record.distanceM) > 0 && pos(record.elapsedMs) > 0) {
    segs = [seg(0, 0, record.distanceM, 0, record.elapsedMs, record.avgPaceMsPer500, record.avgStrokeRate, record.avgHeartRate)];
  }

  const { dist, time } = totals(segs);
  const avgPace = dist > 0 ? (time / dist) * 500 : 0;
  for (const s of segs) s.deltaVsAvgMs = avgPace > 0 ? round(s.avgPaceMsPer500 - avgPace) : 0;
  if (record) applyPlan(record, segs);

  const paces = segs.map((s) => s.avgPaceMsPer500);
  const meanPace = paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : 0;
  const cv = meanPace > 0 && paces.length >= 2 ? (stdDev(paces) / meanPace) * 100 : 0;
  const [p1, p2] = segs.length >= 2 ? halfPaces(segs) : [0, 0];
  const fade = p1 > 0 ? ((p2 - p1) / p1) * 100 : 0;
  const profile = classifyPacing(paces, fade, cv);

  let fastest = 0;
  let slowest = 0;
  for (let i = 1; i < paces.length; i++) {
    if (paces[i] < paces[fastest]) fastest = i;
    if (paces[i] > paces[slowest]) slowest = i;
  }

  // Time lost: same average power held evenly over the same distance.
  let energy = 0;
  for (const s of segs) energy += s.avgWatts * (s.endMs - s.startMs);
  const avgPower = time > 0 ? energy / time : 0;
  const evenTime = avgPower > 0 ? (wattsToPace(avgPower) / 500) * dist : time;
  const timeLost = Math.max(0, emptyNumber(time - evenTime));

  const drift = record ? hrDrift(record, track, segs, time) : null;
  const planDeltas = segs.map((s) => s.deltaVsPlanMs).filter((d): d is number => d != null);
  const planAbs = planDeltas.length ? planDeltas.reduce((a, d) => a + Math.abs(d), 0) / planDeltas.length : 0;

  let score = 0;
  if (profile !== 'unknown') {
    const lostFrac = time > 0 ? timeLost / time : 0;
    score = 100 - 6 * cv - 3 * Math.max(0, fade) - Math.min(30, lostFrac * 1500) - Math.min(20, (planAbs / 1000) * 2);
    score = Math.round(clamp(score, 0, 100));
  }

  const insights = pacingInsights({ profile, segs, fade, cv, timeLost, drift, planDeltas, planAbs, avgPace, time });
  const series = record ? buildSeries(record, track, segs) : buildSeries({ heartRate: [] } as unknown as WorkoutRecord, track, segs);

  return {
    profile,
    variabilityPct: round(cv, 2),
    fadePct: round(fade, 2),
    fastestSegment: fastest,
    slowestSegment: slowest,
    segments: segs,
    ...series,
    hrDriftPct: drift,
    timeLostToPacingMs: round(timeLost),
    score,
    insights,
  };
}

function pacingInsights(a: {
  profile: PacingProfile;
  segs: PacingSegment[];
  fade: number;
  cv: number;
  timeLost: number;
  drift: number | null;
  planDeltas: number[];
  planAbs: number;
  avgPace: number;
  time: number;
}): Insight[] {
  const out: Insight[] = [];
  const copy = PACING_COPY[a.profile];
  const segs = a.segs;
  const first = segs[0];
  const last = segs[segs.length - 1];
  switch (a.profile) {
    case 'even':
      out.push({ severity: 'good', title: copy.title, detail: `${copy.detail} Pace varied only ${a.cv.toFixed(1)} % between segments.` });
      break;
    case 'negative-split': {
      const strong = last && last.deltaVsAvgMs < -2000;
      out.push({
        severity: 'good',
        title: copy.title,
        detail: strong
          ? `${copy.detail} Your last segment was ${sec(last.deltaVsAvgMs)}/500m quicker than average: next time you can afford to start 1 s/500m faster.`
          : copy.detail,
      });
      break;
    }
    case 'positive-split':
      out.push({
        severity: 'warn',
        title: copy.title,
        detail: `${copy.detail} You slowed ${a.fade.toFixed(1)} % in the second half. Next time start at your goal average, not faster, and save the push for the last 25 %.`,
      });
      break;
    case 'fly-and-die':
      out.push({
        severity: 'warn',
        title: copy.title,
        detail: `${copy.detail} The opening segment was ${sec(first?.deltaVsAvgMs ?? 0)}/500m faster than your average and you faded ${a.fade.toFixed(1)} %. Next time hold the first quarter 2–3 s/500m slower and settle onto target pace within 20 strokes.`,
      });
      break;
    case 'u-shaped':
      out.push({
        severity: 'info',
        title: copy.title,
        detail: `${copy.detail} Keep the start burst short (about 10–15 strokes), then settle within 1–2 s/500m of target so the middle doesn't sag.`,
      });
      break;
    case 'erratic':
      out.push({
        severity: 'warn',
        title: copy.title,
        detail: `${copy.detail} Segment pace varied ${a.cv.toFixed(1)} %. Pick one target split, check the monitor every 10 strokes and adjust with small pressure changes rather than surges.`,
      });
      break;
    case 'unknown':
      out.push({ severity: 'info', title: copy.title, detail: copy.detail });
      break;
  }
  if (a.timeLost >= 500 && a.profile !== 'unknown') {
    out.push({
      severity: a.timeLost >= 3000 ? 'warn' : 'info',
      title: `Uneven pacing cost ~${sec(a.timeLost)}`,
      detail: `For the same average power, holding one even pace would have finished about ${sec(a.timeLost)} faster.`,
    });
  }
  if (a.drift != null) {
    if (a.drift > 5) {
      out.push({
        severity: 'info',
        title: `Heart-rate drift ${a.drift.toFixed(1)} %`,
        detail:
          'Your heart rate rose relative to power in the second half (cardiac drift). Hydrate, keep steady pieces truly easy, and build aerobic base with longer UT2 sessions.',
      });
    } else if (a.drift <= 3 && a.time >= 20 * 60000) {
      out.push({
        severity: 'good',
        title: 'Well coupled heart rate',
        detail: `Power and heart rate stayed in step (${a.drift.toFixed(1)} % drift): a sign of good aerobic fitness at this intensity.`,
      });
    }
  }
  if (a.planDeltas.length) {
    if (a.planAbs > 2000) {
      out.push({
        severity: 'warn',
        title: 'Off your pace plan',
        detail: `On average each segment was ${sec(a.planAbs)}/500m away from plan. Use the pace boat and check the split every 10 strokes.`,
      });
    } else {
      out.push({ severity: 'good', title: 'Executed the pace plan', detail: `Segments were within ${sec(a.planAbs)}/500m of plan on average.` });
    }
  }
  const rank = (s: Insight['severity']) => (s === 'warn' ? 2 : s === 'info' ? 1 : 0);
  return out.sort((x, y) => rank(y.severity) - rank(x.severity));
}
