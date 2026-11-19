/** Plan titles, descriptions and totals (pure). */
import type { IntervalDef, PmWorkoutType, SplitSummary, WorkoutKind, WorkoutPlan } from '@/core/types';
import { formatDistance, formatDuration, formatPace, uid } from '@/core/units';

function clock(ms: number): string {
  return formatDuration(Math.round(ms / 1000) * 1000, { tenths: false });
}

export function intervalLabel(iv: Pick<IntervalDef, 'type' | 'value'>): string {
  if (iv.type === 'distance') return `${Math.round(iv.value)}m`;
  if (iv.type === 'time') return clock(iv.value);
  return `${Math.round(iv.value)}cal`;
}

function restLabel(iv: Pick<IntervalDef, 'restMs' | 'undefinedRest'>): string {
  if (iv.undefinedRest) return '...r';
  return `${clock(iv.restMs)}r`;
}

function sameInterval(a: IntervalDef, b: IntervalDef): boolean {
  return a.type === b.type && a.value === b.value && a.restMs === b.restMs && !!a.undefinedRest === !!b.undefinedRest;
}

function intervalsTitle(ivs: Pick<IntervalDef, 'type' | 'value' | 'restMs' | 'undefinedRest'>[]): string {
  if (ivs.length === 0) return 'Intervals';
  const first = ivs[0]!;
  const fixed = ivs.every((iv) => sameInterval(iv as IntervalDef, first as IntervalDef));
  if (fixed) {
    const rest = first.restMs > 0 || first.undefinedRest ? ` / ${restLabel(first)}` : '';
    return ivs.length === 1 ? `${intervalLabel(first)}${rest}` : `${ivs.length} × ${intervalLabel(first)}${rest}`;
  }
  const labels = ivs.map(intervalLabel);
  const shown = labels.length > 6 ? [...labels.slice(0, 6), '…'] : labels;
  return `v${shown.join('/')}`;
}

/** Full reps of a repeat-forever interval in `splits` (a partial last rep doesn't count). */
export function completedReps(iv: Pick<IntervalDef, 'type' | 'value'>, splits: SplitSummary[]): number {
  const done = (s: SplitSummary) => (iv.type === 'distance' ? s.splitDistanceM : iv.type === 'time' ? s.splitTimeMs : s.calories);
  return splits.filter((s) => done(s) >= iv.value * 0.98).length;
}

/**
 * "2000m", "30:00", "8 × 500m / 2:00r", "v1:00/2:00/3:00", "∞ × 500m / 1:00r".
 * `reps` replaces ∞ for a repeat-forever plan once it has been rowed.
 */
export function planTitle(plan: WorkoutPlan, reps?: number): string {
  if (plan.kind === 'intervals' && plan.repeatForever && plan.intervals?.[0]) {
    const iv = plan.intervals[0];
    const rest = iv.restMs > 0 ? ` / ${restLabel(iv)}` : '';
    return `${reps ?? '∞'} × ${intervalLabel(iv)}${rest}`;
  }
  switch (plan.kind) {
    case 'just-row':
      return 'Just row';
    case 'single-distance':
      return `${Math.round(plan.value ?? 0)}m`;
    case 'single-time':
      return clock(plan.value ?? 0);
    case 'single-calorie':
      return `${Math.round(plan.value ?? 0)} cal`;
    case 'intervals':
      return intervalsTitle(plan.intervals ?? []);
  }
}

export function planTotals(plan: WorkoutPlan): { distanceM: number | null; durationMs: number | null; restMs: number } {
  switch (plan.kind) {
    case 'just-row':
    case 'single-calorie':
      return { distanceM: null, durationMs: null, restMs: 0 };
    case 'single-distance':
      return { distanceM: plan.value ?? null, durationMs: null, restMs: 0 };
    case 'single-time':
      return { distanceM: null, durationMs: plan.value ?? null, restMs: 0 };
    case 'intervals': {
      if (plan.repeatForever) return { distanceM: null, durationMs: null, restMs: 0 };
      const ivs = plan.intervals ?? [];
      const allDist = ivs.length > 0 && ivs.every((iv) => iv.type === 'distance');
      const allTime = ivs.length > 0 && ivs.every((iv) => iv.type === 'time');
      // Rest after the final interval is not part of the session.
      const restMs = ivs.slice(0, -1).reduce((a, iv) => a + (iv.undefinedRest ? 0 : iv.restMs), 0);
      return {
        distanceM: allDist ? ivs.reduce((a, iv) => a + iv.value, 0) : null,
        durationMs: allTime ? ivs.reduce((a, iv) => a + iv.value, 0) : null,
        restMs,
      };
    }
  }
}

function targetText(plan: WorkoutPlan): string {
  const t = plan.target;
  const parts: string[] = [];
  if (t?.paceMsPer500) parts.push(`at ${formatPace(t.paceMsPer500)}/500m`);
  if (t?.strokeRate) parts.push(`rate ${t.strokeRate}`);
  if (t?.hrZone) parts.push(`HR zone ${t.hrZone}`);
  return parts.length ? ` ${parts.join(', ')}` : '';
}

/** One-sentence summary. */
export function describePlan(plan: WorkoutPlan): string {
  const tgt = targetText(plan);
  switch (plan.kind) {
    case 'just-row':
      return `Open row with no set distance or time${tgt}.`;
    case 'single-distance': {
      const split = plan.splitValue ? `, splits every ${formatDistance(plan.splitValue)}` : '';
      const pp = plan.segments?.length ? `, ${plan.segments.length} segments` : plan.pacePlan ? `, ${plan.pacePlan.strategy.replace(/-/g, ' ')} plan for ${formatPace(plan.pacePlan.goalPaceMsPer500)}` : '';
      return `Single ${formatDistance(plan.value ?? 0)} piece${tgt}${split}${pp}.`;
    }
    case 'single-time': {
      const split = plan.splitValue ? `, splits every ${clock(plan.splitValue)}` : '';
      const pp = plan.segments?.length ? `, ${plan.segments.length} segments` : plan.pacePlan ? `, ${plan.pacePlan.strategy.replace(/-/g, ' ')} plan for ${formatPace(plan.pacePlan.goalPaceMsPer500)}` : '';
      return `Single ${clock(plan.value ?? 0)} piece${tgt}${split}${pp}.`;
    }
    case 'single-calorie':
      return `Row until you have burned ${Math.round(plan.value ?? 0)} calories${tgt}.`;
    case 'intervals': {
      if (plan.repeatForever) return `Repeat ${planTitle(plan).replace('∞ × ', '')} until you stop${tgt}.`;
      const ivs = plan.intervals ?? [];
      const totals = planTotals(plan);
      const work = totals.distanceM != null ? `${formatDistance(totals.distanceM)} of work` : totals.durationMs != null ? `${clock(totals.durationMs)} of work` : 'mixed work';
      const rest = totals.restMs > 0 ? ` and ${clock(totals.restMs)} rest` : '';
      const kind = ivs.length > 1 && ivs.every((iv) => sameInterval(iv, ivs[0]!)) ? 'fixed' : 'variable';
      return `${ivs.length} ${kind} interval${ivs.length === 1 ? '' : 's'} (${planTitle(plan)}): ${work}${rest}${tgt}.`;
    }
  }
}

/** Title from what the PM reported when no plan was chosen. */
export function titleFromPm(workoutType: PmWorkoutType, totals: { distanceM: number; elapsedMs: number }, splits: SplitSummary[]): string {
  const dist = `${Math.round(totals.distanceM)}m`;
  switch (workoutType) {
    case 'fixed-distance-splits':
    case 'fixed-distance-no-splits':
    case 'just-row-splits':
    case 'just-row-no-splits':
      return dist;
    case 'fixed-time-splits':
    case 'fixed-time-no-splits':
      return clock(totals.elapsedMs);
    case 'fixed-calorie': {
      const cal = splits.reduce((a, s) => a + s.calories, 0);
      return cal > 0 ? `${Math.round(cal)} cal` : dist;
    }
    case 'fixed-watt-minutes':
      return `Watt-minutes ${dist}`;
    case 'fixed-time-interval':
    case 'fixed-distance-interval':
    case 'fixed-calorie-interval':
    case 'variable-interval':
    case 'variable-undefined-rest-interval': {
      if (splits.length === 0) return dist;
      const undef = workoutType === 'variable-undefined-rest-interval';
      const defs = splits.map((s) => {
        const type: IntervalDef['type'] =
          workoutType === 'fixed-time-interval' || s.type === 'time' || s.type === 'time-rest-undefined'
            ? 'time'
            : workoutType === 'fixed-calorie-interval' || s.type === 'calorie' || s.type === 'calorie-rest-undefined'
              ? 'calorie'
              : 'distance';
        const value = type === 'time' ? Math.round(s.splitTimeMs / 1000) * 1000 : type === 'calorie' ? Math.round(s.calories) : Math.round(s.splitDistanceM);
        return { type, value, restMs: Math.round(s.restTimeMs / 1000) * 1000, undefinedRest: undef || s.type.endsWith('rest-undefined') };
      });
      // The PM usually doesn't count the final rest; ignore it when comparing reps.
      const last = defs[defs.length - 1]!;
      if (defs.length > 1) {
        last.restMs = defs[0]!.restMs;
        last.undefinedRest = defs[0]!.undefinedRest;
      }
      return intervalsTitle(defs);
    }
    default:
      return totals.distanceM > 0 ? dist : clock(totals.elapsedMs);
  }
}

/** Fresh plan with sensible defaults. */
export function newPlan(kind: WorkoutKind): WorkoutPlan {
  const base = { id: uid('plan-'), kind, category: 'custom' as const };
  let plan: WorkoutPlan;
  switch (kind) {
    case 'just-row':
      plan = { ...base, name: '' };
      break;
    case 'single-distance':
      plan = { ...base, name: '', value: 2000, splitValue: 500 };
      break;
    case 'single-time':
      plan = { ...base, name: '', value: 30 * 60000, splitValue: 5 * 60000 };
      break;
    case 'single-calorie':
      plan = { ...base, name: '', value: 100 };
      break;
    case 'intervals':
      plan = { ...base, name: '', intervals: Array.from({ length: 8 }, () => ({ type: 'distance' as const, value: 500, restMs: 120000 })) };
      break;
  }
  plan.name = planTitle(plan);
  return plan;
}
