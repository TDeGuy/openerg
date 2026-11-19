/** Weekly / monthly training totals (local time; weeks start Monday). */
import type { TrendPoint, WorkoutListItem } from '@/core/types';
import { pos } from './util';

export function periodStart(ts: number, period: 'week' | 'month'): number {
  const d = new Date(ts);
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

function nextPeriod(start: number, period: 'week' | 'month'): number {
  const d = new Date(start);
  return period === 'month'
    ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
}

/**
 * Buckets ascending from the first to the last workout's period, empty periods included.
 * avgPace = total time / total metres; avgWatts = time-weighted mean of workout avgWatts.
 */
export function trends(items: WorkoutListItem[], period: 'week' | 'month'): TrendPoint[] {
  if (!Array.isArray(items)) return [];
  const p: 'week' | 'month' = period === 'month' ? 'month' : 'week';
  const valid = items.filter((w) => w && !w.simulated && Number.isFinite(w.startedAt) && w.startedAt > 0);
  if (!valid.length) return [];
  const buckets = new Map<number, { m: number; t: number; n: number; wt: number; paceT: number; paceM: number; wattT: number }>();
  let first = Infinity;
  let last = -Infinity;
  for (const w of valid) {
    const k = periodStart(w.startedAt, p);
    first = Math.min(first, k);
    last = Math.max(last, k);
    const b = buckets.get(k) ?? { m: 0, t: 0, n: 0, wt: 0, paceT: 0, paceM: 0, wattT: 0 };
    const m = pos(w.distanceM);
    const t = pos(w.elapsedMs);
    b.m += m;
    b.t += t;
    b.n += 1;
    if (m > 0 && t > 0) {
      b.paceT += t;
      b.paceM += m;
    }
    if (pos(w.avgWatts) > 0 && t > 0) {
      b.wt += w.avgWatts * t;
      b.wattT += t;
    }
    buckets.set(k, b);
  }
  const out: TrendPoint[] = [];
  for (let k = first, guard = 0; k <= last && guard < 5000; k = nextPeriod(k, p), guard++) {
    const b = buckets.get(k);
    out.push({
      periodStart: k,
      metres: b ? Math.round(b.m) : 0,
      durationMs: b ? Math.round(b.t) : 0,
      sessions: b ? b.n : 0,
      avgPaceMsPer500: b && b.paceM > 0 ? Math.round((b.paceT / b.paceM) * 500) : 0,
      avgWatts: b && b.wattT > 0 ? Math.round(b.wt / b.wattT) : 0,
    });
  }
  return out;
}
