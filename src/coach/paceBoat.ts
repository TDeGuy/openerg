/** Pace boat: where a perfectly-paced virtual rower is relative to you (pure). */
import type { IntervalDef, LiveMetrics, MachineType, PaceBoatState, PacePlanSegment, WorkoutPlan } from '@/core/types';
import { formatPace } from '@/core/units';
import { segmentAt } from './pacePlan';

interface Piece {
  /** Length along the axis (metres for 'distance', ms for 'time'). */
  len: number;
  pace: number;
  label: string;
}

/** Piecewise-constant pace profile along distance or time, integrated exactly. */
export class PaceProfile {
  constructor(
    private axis: 'distance' | 'time',
    private pieces: Piece[],
  ) {}

  static constant(axis: 'distance' | 'time', pace: number, label: string): PaceProfile {
    return new PaceProfile(axis, [{ len: Number.POSITIVE_INFINITY, pace, label }]);
  }

  static fromSegments(axis: 'distance' | 'time', total: number, segments: PacePlanSegment[]): PaceProfile {
    const segs = [...segments].sort((a, b) => a.startFraction - b.startFraction);
    const pieces = segs.map((s) => ({
      len: Math.max(0, (s.endFraction - s.startFraction) * total),
      pace: s.targetPaceMsPer500,
      label: s.label,
    }));
    const last = segs[segs.length - 1];
    if (last) pieces.push({ len: Number.POSITIVE_INFINITY, pace: last.targetPaceMsPer500, label: last.label });
    return new PaceProfile(axis, pieces);
  }

  /** Time the boat needs to cover d metres. */
  timeAtDistance(d: number): number {
    let t = 0;
    let rem = Math.max(0, d);
    if (this.axis === 'distance') {
      for (const p of this.pieces) {
        const take = Math.min(rem, p.len);
        t += (take * p.pace) / 500;
        rem -= take;
        if (rem <= 0) break;
      }
      return t;
    }
    for (const p of this.pieces) {
      const pieceDist = (p.len * 500) / p.pace;
      if (rem <= pieceDist) return t + (rem * p.pace) / 500;
      t += p.len;
      rem -= pieceDist;
    }
    return t;
  }

  /** Distance the boat has covered after t ms. */
  distanceAtTime(t: number): number {
    let d = 0;
    let rem = Math.max(0, t);
    if (this.axis === 'time') {
      for (const p of this.pieces) {
        const take = Math.min(rem, p.len);
        d += (take * 500) / p.pace;
        rem -= take;
        if (rem <= 0) break;
      }
      return d;
    }
    for (const p of this.pieces) {
      const pieceTime = (p.len * p.pace) / 500;
      if (rem <= pieceTime) return d + (rem * 500) / p.pace;
      d += p.len;
      rem -= pieceTime;
    }
    return d;
  }
}

function constantLabel(pace: number, machine?: MachineType): string {
  return `Target ${formatPace(pace, machine)}`;
}

function gap(profile: PaceProfile, rowerDist: number, rowerTime: number) {
  return {
    gapM: rowerDist - profile.distanceAtTime(rowerTime),
    gapMs: profile.timeAtDistance(rowerDist) - rowerTime,
  };
}

/**
 * Work done in the current interval. LiveMetrics are treated as cumulative (elapsedMs includes rest,
 * distanceM is cumulative work distance) per core/types, but a PM that resets per interval is
 * detected and handled too.
 */
function intervalProgress(intervals: IntervalDef[], m: LiveMetrics) {
  const k = Math.min(Math.max(0, m.intervalCount), intervals.length - 1);
  let startDist = 0;
  let startTime = 0;
  for (let i = 0; i < k; i++) {
    const iv = intervals[i]!;
    if (iv.type === 'distance') startDist += iv.value;
    if (iv.type === 'time') startTime += iv.value;
    startTime += iv.restMs;
  }
  const iv = intervals[k]!;
  const split = m.splitAvgPaceMsPer500 > 0 ? m.splitAvgPaceMsPer500 : m.avgPaceMsPer500;
  let repDist: number;
  let repTime: number;
  if (iv.type === 'distance') {
    repDist = k > 0 && m.distanceM >= startDist ? m.distanceM - startDist : m.distanceM;
    repTime = split > 0 ? (repDist * split) / 500 : 0;
  } else {
    repTime = k > 0 && m.elapsedMs >= startTime ? m.elapsedMs - startTime : m.elapsedMs;
    repTime = Math.min(repTime, iv.type === 'time' ? iv.value : repTime);
    repDist = split > 0 ? (repTime * 500) / split : 0;
  }
  return { iv, repDist, repTime };
}

export function computePaceBoat(plan: WorkoutPlan | null, m: LiveMetrics, machine?: MachineType): PaceBoatState | null {
  if (!plan) return null;
  const targetPace = plan.target?.paceMsPer500;

  if (plan.kind === 'intervals') {
    const ivs = plan.intervals ?? [];
    if (ivs.length === 0) return null;
    if (m.workoutState === 'interval-rest' || m.restTimeRemainingMs > 0) return null;
    const { iv, repDist, repTime } = intervalProgress(ivs, m);
    const pace = iv.target?.paceMsPer500 ?? targetPace;
    if (!pace || iv.type === 'calorie') return null;
    const profile = PaceProfile.constant(iv.type === 'distance' ? 'distance' : 'time', pace, constantLabel(pace, machine));
    return { ...gap(profile, repDist, repTime), targetPaceMsPer500: pace, label: constantLabel(pace, machine) };
  }

  const dist = m.distanceM;
  const time = m.elapsedMs;
  const value = plan.value ?? 0;

  if ((plan.kind === 'single-distance' || plan.kind === 'single-time') && plan.pacePlan && plan.pacePlan.segments.length && value > 0) {
    const axis = plan.kind === 'single-distance' ? 'distance' : 'time';
    const profile = PaceProfile.fromSegments(axis, value, plan.pacePlan.segments);
    const fraction = axis === 'distance' ? dist / value : time / value;
    const seg = segmentAt(plan.pacePlan, fraction);
    return { ...gap(profile, dist, time), targetPaceMsPer500: seg.targetPaceMsPer500, label: seg.label };
  }

  const pace = targetPace ?? (plan.pacePlan ? plan.pacePlan.goalPaceMsPer500 : undefined);
  if (!pace) return null;
  const profile = PaceProfile.constant(plan.kind === 'single-distance' ? 'distance' : 'time', pace, constantLabel(pace, machine));
  return { ...gap(profile, dist, time), targetPaceMsPer500: pace, label: constantLabel(pace, machine) };
}
