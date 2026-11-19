/**
 * In-progress recording snapshot, so a workout survives the app being killed. Written periodically
 * while recording and read once on (re)connect: if the PM5 is still in the same piece the
 * recording resumes, otherwise the snapshot is stale and dropped. Never sends anything to the PM.
 */
import type { CoxCall, HeartRatePoint, LiveMetrics, PmWorkoutType, SplitSummary, StrokeSample, WorkoutPlan } from '@/core/types';
import { kv } from '@/storage/kv';
import { classifyWorkoutState } from './phase';

const KEY = 'openerg.session.snapshot.v2';
/** Older than this the PM has certainly been reset or reused. */
export const SNAPSHOT_MAX_AGE_MS = 6 * 3600_000;
export const SNAPSHOT_EVERY_MS = 15_000;

export interface Snapshot {
  recId: string;
  savedAt: number;
  startedAt: number;
  plan: WorkoutPlan | null;
  ghostId: string | null;
  workoutType: PmWorkoutType;
  /** PM state at the last save (elapsed is absolute PM time within the interval). */
  intervalCount: number;
  elapsedMs: number;
  distanceM: number;
  durationMs: number;
  pieceDistanceM: number;
  strokes: StrokeSample[];
  splits: SplitSummary[];
  heartRate: HeartRatePoint[];
  coxCalls: CoxCall[];
}

/**
 * Strokes (with force curves) are the bulk, so they live in fixed-size chunks under their own keys: a
 * save rewrites only the unfinished tail chunk, never the whole history. The meta key goes last.
 */
const CHUNK = 100;
const chunkKey = (i: number) => `${KEY}.s${i}`;
let full: { recId: string; n: number } | null = null; // complete chunks already stored for this recording

export async function saveSnapshot(s: Snapshot): Promise<void> {
  try {
    const done = full?.recId === s.recId ? full.n : 0;
    const chunks = Math.ceil(s.strokes.length / CHUNK);
    for (let i = done; i < chunks; i++) await kv.setItem(chunkKey(i), JSON.stringify(s.strokes.slice(i * CHUNK, (i + 1) * CHUNK)));
    full = { recId: s.recId, n: Math.floor(s.strokes.length / CHUNK) };
    const { strokes, ...meta } = s;
    await kv.setItem(KEY, JSON.stringify({ ...meta, strokeCount: strokes.length }));
  } catch {
    full = null;
  }
}
export async function clearSnapshot(): Promise<void> {
  full = null;
  try {
    const raw = await kv.getItem(KEY);
    const n = raw ? Math.ceil((JSON.parse(raw).strokeCount ?? 0) / CHUNK) : 0;
    await kv.removeItem(KEY);
    for (let i = 0; i < n; i++) await kv.removeItem(chunkKey(i));
  } catch {
    // best effort
  }
}
export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await kv.getItem(KEY);
    if (!raw) return null;
    const { strokeCount, ...meta } = JSON.parse(raw);
    const strokes: StrokeSample[] = [];
    for (let i = 0; i < Math.ceil(strokeCount / CHUNK); i++) strokes.push(...JSON.parse((await kv.getItem(chunkKey(i))) ?? '[]'));
    if (strokes.length !== strokeCount) return null;
    full = { recId: meta.recId, n: Math.floor(strokeCount / CHUNK) };
    return { ...meta, strokes };
  } catch {
    return null;
  }
}

/** Is the PM5 still in the piece this snapshot recorded? PM data is authoritative; any doubt = no. */
export function matchSnapshot(s: Snapshot, m: LiveMetrics, now: number): boolean {
  const cls = classifyWorkoutState(m.workoutState);
  if ((cls !== 'work' && cls !== 'rest') || now - s.savedAt > SNAPSHOT_MAX_AGE_MS) return false;
  if (s.workoutType !== 'unknown' && m.workoutType !== s.workoutType) return false;
  if (!m.workoutType.includes('interval') && (m.workoutDurationMs !== s.durationMs || m.workoutDistanceM !== s.pieceDistanceM)) return false;
  if (m.intervalCount < s.intervalCount) return false;
  if (m.intervalCount === s.intervalCount) {
    // Elapsed continues from the snapshot and cannot have advanced more than the wall clock allows.
    if (m.elapsedMs + 1000 < s.elapsedMs || m.distanceM + 5 < s.distanceM) return false;
    if (m.elapsedMs - s.elapsedMs > now - s.savedAt + 5000) return false;
  }
  return true;
}
