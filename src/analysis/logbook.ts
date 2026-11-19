/** Pure logbook helpers: filtering, machine separation, PB detection, reference-2k sync. */
import type { MachineType, WorkoutListItem } from '@/core/types';
import { computePersonalRecords } from './records';
import { isIntervalWorkout } from './util';

export type WorkoutKind = 'distance' | 'time' | 'intervals' | 'other';

export interface LogbookFilter {
  machine: MachineType;
  showSim: boolean;
  kind: WorkoutKind | 'all';
  /** Inclusive epoch-ms bounds. */
  from?: number;
  to?: number;
  search?: string;
}

export const machineOf = (w: { machineType?: MachineType }): MachineType => w.machineType ?? 'rower';

export function workoutKind(w: WorkoutListItem): WorkoutKind {
  if (isIntervalWorkout(w)) return 'intervals';
  if (w.plan?.kind === 'single-distance' || /distance/.test(w.workoutType)) return 'distance';
  if (w.plan?.kind === 'single-time' || /time/.test(w.workoutType)) return 'time';
  return 'other';
}

/** Rows that count in stats: one machine, no simulator rows. */
export function statsPool(items: readonly WorkoutListItem[], machine: MachineType): WorkoutListItem[] {
  return items.filter((w) => !w.simulated && machineOf(w) === machine);
}

export function filterWorkouts(items: readonly WorkoutListItem[], f: LogbookFilter): WorkoutListItem[] {
  const q = f.search?.trim().toLowerCase() ?? '';
  return items.filter((w) => {
    if (machineOf(w) !== f.machine) return false;
    if (w.simulated && !f.showSim) return false;
    if (f.kind !== 'all' && workoutKind(w) !== f.kind) return false;
    if (f.from != null && w.startedAt < f.from) return false;
    if (f.to != null && w.startedAt > f.to) return false;
    if (!q) return true;
    return [w.title, w.notes ?? '', (w.tags ?? []).join(' '), w.ergName ?? ''].join(' ').toLowerCase().includes(q);
  });
}

/** Events each workout holds the personal best for, per machine (simulator rows never). */
export function pbEvents(items: readonly WorkoutListItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of ['rower', 'skierg', 'bikeerg'] as MachineType[]) {
    for (const r of computePersonalRecords(statsPool(items, m), m)) out.set(r.workoutId, [...(out.get(r.workoutId) ?? []), r.event]);
  }
  return out;
}

/** Events for which `id` is the current best (empty when not a PB). `items` must include it. */
export function pbEventsFor(items: readonly WorkoutListItem[], id: string): string[] {
  return pbEvents(items).get(id) ?? [];
}

/** Best non-simulated RowErg 2k time (ms), or null. */
export function best2k(items: readonly WorkoutListItem[]): number | null {
  const r = computePersonalRecords(statsPool(items, 'rower'), 'rower').find((x) => x.event === '2000m');
  return r ? r.result : null;
}

/** The new reference 2k if the best 2k beats the current one (or none is set); otherwise null. */
export function nextReference2k(items: readonly WorkoutListItem[], current: number | null): number | null {
  const best = best2k(items);
  return best != null && (current == null || best < current) ? best : null;
}
