/** Pure ghost boat: race a previous workout's actual stroke timeline. */
import type { PaceBoatState, WorkoutPlan, WorkoutRecord } from '@/core/types';
import { paceFromTimeDistance } from '@/core/units';
import { strokeTimeline } from '@/storage/timeline';

export interface GhostTrack {
  label: string;
  /** Monotonic work time (ms) and cumulative distance (m). */
  points: { w: number; d: number }[];
  avgPaceMsPer500: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildGhost(record: WorkoutRecord): GhostTrack | null {
  const tl = strokeTimeline(record.strokes, record.splits);
  const points = [{ w: 0, d: 0 }];
  if (tl.length >= 2) {
    for (const p of tl) if (p.w >= points[points.length - 1].w && p.d >= points[points.length - 1].d) points.push({ w: p.w, d: p.d });
  } else if (record.elapsedMs > 0 && record.distanceM > 0) {
    points.push({ w: record.elapsedMs, d: record.distanceM }); // imported: no strokes, pace evenly over the totals
  }
  if (points.length < 2) return null;
  const d = new Date(record.startedAt);
  const last = points[points.length - 1];
  return {
    label: `Ghost · ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    points,
    avgPaceMsPer500: record.avgPaceMsPer500 || paceFromTimeDistance(last.w, last.d),
  };
}

function interp(points: { w: number; d: number }[], x: number, from: 'w' | 'd', to: 'w' | 'd'): number {
  if (x <= points[0][from]) return points[0][to];
  const last = points[points.length - 1];
  if (x >= last[from]) return last[to];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][from] <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b[from] - a[from];
  return span > 0 ? a[to] + ((x - a[from]) / span) * (b[to] - a[to]) : a[to];
}

export function computeGhostBoat(g: GhostTrack, elapsedMs: number, distanceM: number): PaceBoatState {
  const ghostD = interp(g.points, elapsedMs, 'w', 'd');
  const last = g.points[g.points.length - 1];
  // Beyond the ghost's finish distance, extrapolate at its average pace.
  const ghostT = distanceM <= last.d
    ? interp(g.points, distanceM, 'd', 'w')
    : last.w + ((distanceM - last.d) / 500) * g.avgPaceMsPer500;
  const recentD = ghostD - interp(g.points, Math.max(0, elapsedMs - 10_000), 'w', 'd');
  return {
    gapM: distanceM - ghostD,
    gapMs: ghostT - elapsedMs,
    targetPaceMsPer500: paceFromTimeDistance(Math.min(10_000, elapsedMs), recentD) || g.avgPaceMsPer500,
    label: g.label,
  };
}

/** The plan to re-row a record: its own, else a single piece derived from its totals (e.g. set on the PM5 itself). */
export function planOfRecord(r: WorkoutRecord): WorkoutPlan | null {
  if (r.plan) return r.plan;
  const t = r.workoutType;
  const plan = (p: Omit<WorkoutPlan, 'id' | 'name'>): WorkoutPlan => ({ id: 'pm5', name: r.title, ...p });
  if (t.startsWith('fixed-distance') && !t.endsWith('interval') && r.distanceM > 0) return plan({ kind: 'single-distance', value: Math.round(r.distanceM) });
  if (t.startsWith('fixed-time') && !t.endsWith('interval') && r.elapsedMs > 0) return plan({ kind: 'single-time', value: Math.round(r.elapsedMs) });
  return null;
}
