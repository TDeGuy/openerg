/**
 * Session UI state that SessionState (core/types, frozen) has no field for, plus its pure helpers.
 * The controller is the only writer; screens read it so mute/save/reconnect have one source of truth.
 */
import { create } from 'zustand';
import type { SplitSummary, StrokeSample, WorkoutRecord } from '@/core/types';
import { mean } from '@/core/units';

export const useSessionExtras = create<{
  /** Coxswain muted for the current workout (reset when a workout arms). */
  muted: boolean;
  /** The finished workout could not be written to the logbook; it is kept in memory for a retry. */
  saveFailed: boolean;
  /** Auto-reconnect gave up: the PM5 is gone until the user reconnects. */
  pmLost: boolean;
}>(() => ({ muted: false, saveFailed: false, pmLost: false }));

/** Saves `record`; on failure hands it back as `pending` so nothing is lost. */
export async function persistRecord(
  record: WorkoutRecord,
  save: (r: WorkoutRecord) => Promise<unknown>,
): Promise<{ id: string | null; pending: WorkoutRecord | null }> {
  try {
    await save(record);
    return { id: record.id, pending: null };
  } catch (e) {
    console.warn('[session] saving workout failed', e);
    return { id: null, pending: record };
  }
}

/** Real average of the recorded strap/PM samples; falls back to the PM's per-split averages. */
export function averageHeartRate(strokes: Pick<StrokeSample, 'heartRate'>[], splits: Pick<SplitSummary, 'avgHeartRate'>[]): number | null {
  const pick = (xs: (number | null | undefined)[]) => xs.filter((h): h is number => h != null && h > 0);
  const hrs = pick(strokes.map((s) => s.heartRate));
  const vals = hrs.length ? hrs : pick(splits.map((s) => s.avgHeartRate));
  return vals.length ? Math.round(mean(vals)) : null;
}
