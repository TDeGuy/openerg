/** Interval (rep-by-rep) analysis. */
import type { Insight, IntervalAnalysis, PacingSegment, StrokeSample, WorkoutRecord } from '@/core/types';
import { clamp } from '@/core/units';
import { segmentsFromSplits } from './pacing';
import { isIntervalWorkout, pos, round, stdDev } from './util';

function repsFromStrokes(strokes: StrokeSample[]): PacingSegment[] {
  const groups = new Map<number, StrokeSample[]>();
  for (const s of strokes) {
    if (!s) continue;
    const k = Math.max(0, Math.floor(pos(s.intervalCount)));
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const out: PacingSegment[] = [];
  let m = 0;
  let t = 0;
  let prevEndRawD = 0;
  let prevEndRawT = 0;
  for (const k of keys) {
    const g = groups.get(k)!;
    const first = g[0];
    const last = g[g.length - 1];
    // Per-rep distance/time may be cumulative or reset each rep.
    const reset = pos(first.distanceM) < prevEndRawD;
    const d0 = reset ? 0 : prevEndRawD;
    const t0 = reset || pos(first.elapsedMs) < prevEndRawT ? 0 : prevEndRawT;
    const dist = pos(last.distanceM) - d0;
    const dur = pos(last.elapsedMs) - t0;
    prevEndRawD = pos(last.distanceM);
    prevEndRawT = pos(last.elapsedMs);
    if (dist <= 0 || dur <= 0) continue;
    const rates = g.map((s) => pos(s.strokeRate)).filter((r) => r > 0);
    const hrs = g.map((s) => pos(s.heartRate)).filter((h) => h > 0);
    const pace = (dur / dist) * 500;
    out.push({
      index: out.length,
      startM: m,
      endM: m + dist,
      startMs: t,
      endMs: t + dur,
      avgPaceMsPer500: pace,
      avgWatts: 2.8 / Math.pow(pace / 500000, 3),
      avgStrokeRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0,
      avgHeartRate: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
      deltaVsAvgMs: 0,
      deltaVsPlanMs: null,
    });
    m += dist;
    t += dur;
  }
  return out;
}

/** Last HR of the work portion of rep `i` (from strokes), else the rep's average HR. */
function endOfWorkHr(record: WorkoutRecord, rep: PacingSegment, i: number): number | null {
  const strokes = Array.isArray(record.strokes) ? record.strokes : [];
  for (let k = strokes.length - 1; k >= 0; k--) {
    const s = strokes[k];
    if (s && s.intervalCount === i && pos(s.heartRate) > 0) return s.heartRate;
  }
  return rep.avgHeartRate;
}

/** null when the record is not an interval workout. */
export function analyzeIntervals(record: WorkoutRecord): IntervalAnalysis | null {
  if (!record || !isIntervalWorkout(record)) return null;
  const workSplits = (Array.isArray(record.splits) ? record.splits : []).filter(
    (s) => s && s.type !== 'rest' && s.type !== 'rest-undefined' && (pos(s.splitDistanceM) > 0 || pos(s.splitTimeMs) > 0),
  );
  let reps = segmentsFromSplits(workSplits);
  if (reps.length < 2 && Array.isArray(record.strokes) && record.strokes.length) {
    const fromStrokes = repsFromStrokes(record.strokes);
    if (fromStrokes.length > reps.length) reps = fromStrokes;
  }

  const paces = reps.map((r) => r.avgPaceMsPer500);
  let dist = 0;
  let time = 0;
  for (const r of reps) {
    dist += r.endM - r.startM;
    time += r.endMs - r.startMs;
  }
  const avg = dist > 0 ? (time / dist) * 500 : 0;
  const defs = record.plan?.intervals ?? [];
  const planTarget = pos(record.plan?.target?.paceMsPer500);
  reps.forEach((r, i) => {
    r.deltaVsAvgMs = avg > 0 ? round(r.avgPaceMsPer500 - avg) : 0;
    const t = pos(defs[i % Math.max(1, defs.length)]?.target?.paceMsPer500) || planTarget;
    r.deltaVsPlanMs = t > 0 ? round(r.avgPaceMsPer500 - t) : null;
  });

  const best = paces.length ? Math.min(...paces) : 0;
  const worst = paces.length ? Math.max(...paces) : 0;
  const dropOffPct = best > 0 ? round(((worst - best) / best) * 100, 2) : 0;
  const meanPace = paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : 0;
  const cv = meanPace > 0 ? (stdDev(paces) / meanPace) * 100 : 0;
  const consistencyPct = reps.length ? round(clamp(100 - cv * 10, 0, 100), 1) : 0;

  const splitByRep = workSplits.filter((s) => {
    const p = pos(s.avgPaceMsPer500);
    return p > 0 || (pos(s.splitDistanceM) > 0 && pos(s.splitTimeMs) > 0);
  });
  const hrRecovery = reps.map((r, i) => {
    const sp = splitByRep[i];
    if (!sp || !(pos(sp.restTimeMs) > 0) || sp.restHeartRate == null || !(sp.restHeartRate > 0)) return null;
    const end = endOfWorkHr(record, r, sp.index ?? i);
    return end != null && end > 0 ? round(end - sp.restHeartRate) : null;
  });

  return { reps, dropOffPct, consistencyPct, hrRecovery, insights: intervalInsights(reps, dropOffPct, cv, hrRecovery, splitByRep.map((s) => pos(s.restTimeMs))) };
}

function intervalInsights(reps: PacingSegment[], dropOff: number, cv: number, hr: (number | null)[], restMs: number[]): Insight[] {
  const out: Insight[] = [];
  const n = reps.length;
  if (n < 2) {
    out.push({ severity: 'info', title: 'Not enough reps', detail: 'At least two completed reps are needed to compare intervals.' });
    return out;
  }
  const s = (ms: number) => `${(Math.abs(ms) / 1000).toFixed(1)} s`;
  const first = reps[0];
  const last = reps[n - 1];
  const others = reps.slice(1);
  const othersAvg = others.reduce((a, r) => a + r.avgPaceMsPer500, 0) / others.length;
  if (cv < 1 && dropOff < 2) {
    out.push({ severity: 'good', title: 'Rock-solid reps', detail: `Every rep within ${dropOff.toFixed(1)} % of each other. Excellent control; you are ready for a faster target.` });
  } else if (dropOff > 5) {
    out.push({
      severity: 'warn',
      title: 'Reps fell away',
      detail: `${dropOff.toFixed(1)} % between your best and worst rep. Start the set at the pace you can hold on the last rep; aim to be within 2 s/500m across all reps.`,
    });
  } else {
    out.push({ severity: 'info', title: 'Fairly consistent reps', detail: `${dropOff.toFixed(1)} % spread between best and worst rep. Tighten it to under 2 % by holding back slightly on the first reps.` });
  }
  if (n >= 3 && first.avgPaceMsPer500 < othersAvg - 2000) {
    out.push({
      severity: 'warn',
      title: 'First rep too hot',
      detail: `Rep 1 was ${s(othersAvg - first.avgPaceMsPer500)}/500m faster than the rest. Go out at target pace; the first rep always feels easy.`,
    });
  }
  const minPace = Math.min(...reps.map((r) => r.avgPaceMsPer500));
  if (n >= 3 && last.avgPaceMsPer500 === minPace && last.avgPaceMsPer500 < othersAvg - 1500) {
    out.push({
      severity: 'info',
      title: 'Fastest on the last rep',
      detail: 'You had the most left at the end. Next time raise the target for the middle reps by 1 s/500m.',
    });
  }
  const recs = hr.map((h, i) => ({ h, rest: restMs[i] ?? 0 })).filter((x) => x.h != null && x.rest >= 60000) as { h: number; rest: number }[];
  if (recs.length) {
    const avgRec = recs.reduce((a, x) => a + x.h, 0) / recs.length;
    if (avgRec < 20) {
      out.push({ severity: 'info', title: 'Slow heart-rate recovery', detail: `HR dropped only ~${Math.round(avgRec)} bpm in the rests. More aerobic base (UT2) work will speed up recovery between reps.` });
    } else {
      out.push({ severity: 'good', title: 'Good recovery between reps', detail: `HR dropped ~${Math.round(avgRec)} bpm per rest on average.` });
    }
  }
  const rank = (x: Insight['severity']) => (x === 'warn' ? 2 : x === 'info' ? 1 : 0);
  return out.sort((a, b) => rank(b.severity) - rank(a.severity));
}
