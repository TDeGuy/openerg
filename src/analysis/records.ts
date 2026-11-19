/** Personal records and best efforts. */
import type { MachineType, PersonalRecord, WorkoutListItem, WorkoutRecord } from '@/core/types';
import { paceToWatts } from '@/core/units';
import { isIntervalWorkout, pos, strokeTrack, timeAtDistance } from './util';

export const PR_DISTANCES = [100, 500, 1000, 2000, 5000, 6000, 10000, 21097, 42195];
export const PR_TIMES: { ms: number; event: string }[] = [
  { ms: 60000, event: '1:00' },
  { ms: 4 * 60000, event: '4:00' },
  { ms: 30 * 60000, event: '30:00' },
  { ms: 60 * 60000, event: '60:00' },
];

/**
 * PRs from list totals. A piece counts for a distance event when its distance is within
 * [event − 1 m, event × 1.005 + 2 m] (PM rounding / rowing past the line; time is pro-rated
 * when over); for a time event when its time is within ±max(1 s, 0.5 %) (distance pro-rated
 * when over). Interval and simulated workouts are excluded, and only `machine` (default RowErg) counts: a bike 2k is never a row PR. Output: distance events (ascending)
 * then time events, only events with a result.
 */
export function computePersonalRecords(items: WorkoutListItem[], machine: MachineType = 'rower'): PersonalRecord[] {
  if (!Array.isArray(items)) return [];
  const best = new Map<string, PersonalRecord>();
  for (const w of items) {
    if (!w || w.simulated || (w.machineType ?? 'rower') !== machine || isIntervalWorkout(w)) continue;
    const dist = pos(w.distanceM);
    const time = pos(w.elapsedMs);
    if (dist <= 0 || time <= 0) continue;
    for (const ev of PR_DISTANCES) {
      if (dist < ev - 1 || dist > ev * 1.005 + 2) continue;
      const t = dist > ev ? (time * ev) / dist : time;
      const key = `${ev}m`;
      const cur = best.get(key);
      if (!cur || t < cur.result) {
        const pace = (t / ev) * 500;
        best.set(key, { event: key, eventType: 'distance', result: Math.round(t), paceMsPer500: Math.round(pace), watts: Math.round(paceToWatts(pace)), workoutId: w.id, achievedAt: w.startedAt });
      }
    }
    for (const ev of PR_TIMES) {
      const tol = Math.max(1000, ev.ms * 0.005);
      if (Math.abs(time - ev.ms) > tol) continue;
      const d = time > ev.ms ? (dist * ev.ms) / time : dist;
      const cur = best.get(ev.event);
      if (!cur || d > cur.result) {
        const pace = (ev.ms / d) * 500;
        best.set(ev.event, { event: ev.event, eventType: 'time', result: Math.round(d), paceMsPer500: Math.round(pace), watts: Math.round(paceToWatts(pace)), workoutId: w.id, achievedAt: w.startedAt });
      }
    }
  }
  const order = [...PR_DISTANCES.map((d) => `${d}m`), ...PR_TIMES.map((t) => t.event)];
  return order.map((k) => best.get(k)).filter((r): r is PersonalRecord => !!r);
}

/** Best rolling effort for a distance inside a longer piece; null if piece too short / no strokes. */
export function bestEffort(record: WorkoutRecord, distanceM: number): { timeMs: number; startM: number; paceMsPer500: number } | null {
  const D = pos(distanceM);
  if (!record || D <= 0 || !Array.isArray(record.strokes) || record.strokes.length < 2) return null;
  const track = strokeTrack(record.strokes);
  const total = track[track.length - 1].d;
  if (total + 0.5 < D) return null;
  let bestT = Infinity;
  let bestStart = 0;
  const hint = { i: 0 };
  // Window end at each stroke (plus the end of the piece).
  for (let j = 1; j < track.length; j++) {
    const end = Math.min(track[j].d, total);
    if (end < D - 0.5) continue;
    const start = Math.max(0, end - D);
    const t = track[j].t - timeAtDistance(track, start, hint);
    if (t > 0 && t < bestT) {
      bestT = t;
      bestStart = start;
    }
  }
  if (!Number.isFinite(bestT)) return null;
  const covered = Math.min(D, total);
  return { timeMs: Math.round(bestT), startM: Math.round(bestStart * 10) / 10, paceMsPer500: Math.round((bestT / covered) * 500) };
}
