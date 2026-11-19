/**
 * Plan validation against PM5 programming limits (pure).
 * Limits per the Concept2 PM5 manual / CSAFE workout programming:
 * - single distance 100 m – 50,000 m; single time 0:20 – 9:59:59 (whole seconds)
 * - calories 1 – 9,999
 * - up to 50 intervals; work interval distance 100 m – 50,000 m, time 0:20 – 9:59:59
 * - rest 0:00 – 9:55 in whole seconds
 * - splits: ≥ 100 m / ≥ 0:20, and at most 30 splits per piece
 */
import type { IntervalTarget, WorkoutPlan } from '@/core/types';

export const PM5_LIMITS = {
  minDistanceM: 100,
  maxDistanceM: 50000,
  minTimeMs: 20000,
  maxTimeMs: (9 * 3600 + 59 * 60 + 59) * 1000,
  minCalories: 1,
  maxCalories: 9999,
  maxIntervals: 50,
  maxRestMs: (9 * 60 + 55) * 1000,
  minSplitDistanceM: 100,
  minSplitTimeMs: 20000,
  maxSplits: 30,
} as const;

const L = PM5_LIMITS;

function checkTarget(t: IntervalTarget | undefined, where: string, errs: string[]): void {
  if (!t) return;
  if (t.paceMsPer500 != null && !(t.paceMsPer500 >= 60000 && t.paceMsPer500 <= 600000)) errs.push(`${where}: target pace must be between 1:00 and 10:00 /500m.`);
  if (t.strokeRate != null && !(t.strokeRate >= 10 && t.strokeRate <= 60)) errs.push(`${where}: target stroke rate must be 10–60 spm.`);
  if (t.hrZone != null && !(Number.isInteger(t.hrZone) && t.hrZone >= 1 && t.hrZone <= 5)) errs.push(`${where}: heart-rate zone must be 1–5.`);
}

function checkDistance(v: number | undefined, where: string, errs: string[]): void {
  if (v == null || !Number.isFinite(v) || !Number.isInteger(v)) errs.push(`${where}: distance must be a whole number of metres.`);
  else if (v < L.minDistanceM || v > L.maxDistanceM) errs.push(`${where}: distance must be ${L.minDistanceM}–${L.maxDistanceM.toLocaleString('en-US')} m.`);
}

function checkTime(v: number | undefined, where: string, errs: string[]): void {
  if (v == null || !Number.isFinite(v) || v % 1000 !== 0) errs.push(`${where}: time must be whole seconds.`);
  else if (v < L.minTimeMs || v > L.maxTimeMs) errs.push(`${where}: time must be 0:20 – 9:59:59.`);
}

function checkCalories(v: number | undefined, where: string, errs: string[]): void {
  if (v == null || !Number.isInteger(v) || v < L.minCalories || v > L.maxCalories) errs.push(`${where}: calories must be ${L.minCalories}–${L.maxCalories}.`);
}

/** [] = valid. */
export function validatePlan(plan: WorkoutPlan): string[] {
  const errs: string[] = [];
  if (!plan.id) errs.push('Plan needs an id.');
  if (!plan.name || !plan.name.trim()) errs.push('Plan needs a name.');
  checkTarget(plan.target, 'Workout', errs);

  switch (plan.kind) {
    case 'just-row':
      break;
    case 'single-distance': {
      checkDistance(plan.value, 'Distance', errs);
      if (plan.splitValue != null && plan.value) {
        if (!Number.isInteger(plan.splitValue) || plan.splitValue < L.minSplitDistanceM) errs.push(`Split must be at least ${L.minSplitDistanceM} m.`);
        else if (plan.splitValue > plan.value) errs.push('Split cannot be longer than the piece.');
        else if (Math.ceil(plan.value / plan.splitValue) > L.maxSplits) errs.push(`At most ${L.maxSplits} splits — use a longer split.`);
      }
      break;
    }
    case 'single-time': {
      checkTime(plan.value, 'Time', errs);
      if (plan.splitValue != null && plan.value) {
        if (plan.splitValue % 1000 !== 0 || plan.splitValue < L.minSplitTimeMs) errs.push('Split must be at least 0:20 in whole seconds.');
        else if (plan.splitValue > plan.value) errs.push('Split cannot be longer than the piece.');
        else if (Math.ceil(plan.value / plan.splitValue) > L.maxSplits) errs.push(`At most ${L.maxSplits} splits — use a longer split.`);
      }
      break;
    }
    case 'single-calorie':
      checkCalories(plan.value, 'Calories', errs);
      break;
    case 'intervals': {
      const ivs = plan.intervals ?? [];
      if (ivs.length === 0) errs.push('Add at least one interval.');
      if (ivs.length > L.maxIntervals) errs.push(`The PM5 allows at most ${L.maxIntervals} intervals.`);
      if (plan.repeatForever) {
        if (ivs.length !== 1) errs.push('Unlimited intervals need exactly one interval.');
        // The PM's fixed-interval mode has no undefined-rest variant.
        if (ivs.some((iv) => iv.undefinedRest)) errs.push('Unlimited intervals need a set rest.');
      }
      ivs.forEach((iv, i) => {
        const where = `Interval ${i + 1}`;
        if (iv.type === 'distance') checkDistance(iv.value, where, errs);
        else if (iv.type === 'time') checkTime(iv.value, where, errs);
        else if (iv.type === 'calorie') checkCalories(iv.value, where, errs);
        else errs.push(`${where}: unknown interval type.`);
        if (!iv.undefinedRest) {
          if (!Number.isFinite(iv.restMs) || iv.restMs < 0 || iv.restMs % 1000 !== 0) errs.push(`${where}: rest must be whole seconds.`);
          else if (iv.restMs > L.maxRestMs) errs.push(`${where}: rest must be at most 9:55.`);
        }
        checkTarget(iv.target, where, errs);
      });
      break;
    }
    default:
      errs.push('Unknown workout kind.');
  }

  if (plan.segments?.length) {
    if (plan.kind !== 'single-distance' && plan.kind !== 'single-time') errs.push('Segments apply to single distance or time pieces only.');
    else {
      plan.segments.forEach((s, i) => {
        if (!(s.duration > 0)) errs.push(`Segment ${i + 1}: needs a length.`);
        checkTarget({ paceMsPer500: s.paceMsPer500, strokeRate: s.strokeRate }, `Segment ${i + 1}`, errs);
      });
      const total = plan.segments.reduce((a, s) => a + s.duration, 0);
      if (plan.value && total > plan.value) errs.push('Segments are longer than the piece.');
    }
  }
  if (plan.repeatForever && plan.kind !== 'intervals') errs.push('Only interval workouts can repeat until stopped.');
  if (plan.pacePlan) {
    if (plan.kind !== 'single-distance' && plan.kind !== 'single-time') errs.push('Pace plans apply to single distance or time pieces only.');
    const segs = [...plan.pacePlan.segments].sort((a, b) => a.startFraction - b.startFraction);
    if (!(plan.pacePlan.goalPaceMsPer500 >= 60000 && plan.pacePlan.goalPaceMsPer500 <= 600000)) errs.push('Pace plan goal must be between 1:00 and 10:00 /500m.');
    if (segs.length === 0) errs.push('Pace plan has no segments.');
    else {
      const eps = 1e-6;
      if (Math.abs(segs[0]!.startFraction) > eps || Math.abs(segs[segs.length - 1]!.endFraction - 1) > eps) errs.push('Pace plan must cover the whole piece.');
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]!;
        if (!(s.endFraction > s.startFraction)) errs.push(`Pace plan segment ${i + 1} is empty.`);
        if (i > 0 && Math.abs(segs[i - 1]!.endFraction - s.startFraction) > eps) errs.push('Pace plan segments must be contiguous.');
        if (!(s.targetPaceMsPer500 > 0)) errs.push(`Pace plan segment ${i + 1} needs a pace.`);
      }
    }
  }
  return errs;
}
