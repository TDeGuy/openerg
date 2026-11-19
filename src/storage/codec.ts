/**
 * Pure (de)serialisation between WorkoutRecord and the SQLite row layout.
 * Summary columns are plain values; strokes / splits / HR / cox calls live in one compact
 * JSON blob (`data`) that only getWorkout reads.
 */
import type {
  CoxCall,
  HeartRatePoint,
  MachineType,
  PmWorkoutType,
  SplitSummary,
  StrokeSample,
  WorkoutListItem,
  WorkoutPlan,
  WorkoutRecord,
} from '@/core/types';

export const BLOB_VERSION = 1;

/** Row shape of the `workouts` table (without `data`). */
export interface WorkoutRow {
  id: string;
  started_at: number;
  ended_at: number;
  title: string;
  machine_type: string;
  workout_type: string;
  elapsed_ms: number | null;
  distance_m: number | null;
  avg_pace: number | null;
  avg_watts: number | null;
  avg_rate: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  stroke_count: number | null;
  avg_drag: number | null;
  total_rest_ms: number | null;
  erg_name: string | null;
  erg_serial: string | null;
  notes: string | null;
  tags: string | null;
  simulated: number;
  verified: number;
  plan: string | null;
}

export const SUMMARY_COLUMNS =
  'id, started_at, ended_at, title, machine_type, workout_type, elapsed_ms, distance_m, avg_pace, avg_watts, ' +
  'avg_rate, avg_hr, max_hr, calories, stroke_count, avg_drag, total_rest_ms, erg_name, erg_serial, notes, tags, ' +
  'simulated, verified, plan';

const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Stroke tuple: [n, elapsed, dist, pace, watts, rate, hr, driveLen, driveT, recT, strokeDist, peak, avg, work, interval, curve] */
type StrokeTuple = [
  number, number, number, number, number, number, number | null, number, number, number, number, number, number, number, number, number[],
];

export function encodeStroke(s: StrokeSample): StrokeTuple {
  return [
    s.strokeNumber,
    r0(s.elapsedMs),
    r1(s.distanceM),
    r0(s.paceMsPer500),
    r1(s.watts),
    r1(s.strokeRate),
    s.heartRate == null ? null : r0(s.heartRate),
    r2(s.driveLengthM),
    r0(s.driveTimeMs),
    r0(s.recoveryTimeMs),
    r2(s.strokeDistanceM),
    r1(s.peakForceN),
    r1(s.avgForceN),
    r0(s.workPerStrokeJ),
    s.intervalCount,
    (s.forceCurve ?? []).map(r0),
  ];
}

export function decodeStroke(t: unknown[]): StrokeSample {
  return {
    strokeNumber: num(t[0]),
    elapsedMs: num(t[1]),
    distanceM: num(t[2]),
    paceMsPer500: num(t[3]),
    watts: num(t[4]),
    strokeRate: num(t[5]),
    heartRate: typeof t[6] === 'number' ? t[6] : null,
    driveLengthM: num(t[7]),
    driveTimeMs: num(t[8]),
    recoveryTimeMs: num(t[9]),
    strokeDistanceM: num(t[10]),
    peakForceN: num(t[11]),
    avgForceN: num(t[12]),
    workPerStrokeJ: num(t[13]),
    intervalCount: num(t[14]),
    forceCurve: Array.isArray(t[15]) ? (t[15] as unknown[]).map((v) => num(v)) : [],
  };
}

interface Blob {
  v: number;
  s: StrokeTuple[];
  sp: SplitSummary[];
  hr: [number, number][];
  cx: CoxCall[];
}

export function encodeBlob(r: Pick<WorkoutRecord, 'strokes' | 'splits' | 'heartRate' | 'coxCalls'>): string {
  const blob: Blob = {
    v: BLOB_VERSION,
    s: r.strokes.map(encodeStroke),
    sp: r.splits,
    hr: r.heartRate.map((p) => [r0(p.elapsedMs), r0(p.bpm)]),
    cx: r.coxCalls,
  };
  return JSON.stringify(blob);
}

export function decodeBlob(json: string | null): Pick<WorkoutRecord, 'strokes' | 'splits' | 'heartRate' | 'coxCalls'> {
  try {
    const b = JSON.parse(json ?? '{}') as Partial<Blob>;
    return {
      strokes: Array.isArray(b.s) ? b.s.map((t) => decodeStroke(t as unknown[])) : [],
      splits: Array.isArray(b.sp) ? b.sp : [],
      heartRate: Array.isArray(b.hr) ? b.hr.map(([elapsedMs, bpm]): HeartRatePoint => ({ elapsedMs, bpm })) : [],
      coxCalls: Array.isArray(b.cx) ? b.cx : [],
    };
  } catch {
    return { strokes: [], splits: [], heartRate: [], coxCalls: [] };
  }
}

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Bind params for INSERT OR REPLACE (named `$col`). */
export function recordToParams(r: WorkoutRecord): Record<string, string | number | null> {
  return {
    $id: r.id,
    $started_at: r.startedAt,
    $ended_at: r.endedAt,
    $title: r.title,
    $machine_type: r.machineType,
    $workout_type: r.workoutType,
    $elapsed_ms: r.elapsedMs,
    $distance_m: r.distanceM,
    $avg_pace: r.avgPaceMsPer500,
    $avg_watts: r.avgWatts,
    $avg_rate: r.avgStrokeRate,
    $avg_hr: r.avgHeartRate,
    $max_hr: r.maxHeartRate,
    $calories: r.calories,
    $stroke_count: r.strokeCount,
    $avg_drag: r.avgDragFactor,
    $total_rest_ms: r.totalRestMs,
    $erg_name: r.ergName ?? null,
    $erg_serial: r.ergSerial ?? null,
    $notes: r.notes ?? null,
    $tags: r.tags && r.tags.length ? JSON.stringify(r.tags) : null,
    $simulated: r.simulated ? 1 : 0,
    $verified: r.verified ? 1 : 0,
    $plan: r.plan ? JSON.stringify(r.plan) : null,
    $data: encodeBlob(r),
  };
}

export function rowToListItem(row: WorkoutRow): WorkoutListItem {
  const item: WorkoutListItem = {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    machineType: row.machine_type as MachineType,
    plan: parseJson<WorkoutPlan | null>(row.plan, null),
    title: row.title,
    workoutType: row.workout_type as PmWorkoutType,
    elapsedMs: num(row.elapsed_ms),
    distanceM: num(row.distance_m),
    avgPaceMsPer500: num(row.avg_pace),
    avgWatts: num(row.avg_watts),
    avgStrokeRate: num(row.avg_rate),
    avgHeartRate: row.avg_hr ?? null,
    maxHeartRate: row.max_hr ?? null,
    calories: num(row.calories),
    strokeCount: num(row.stroke_count),
    avgDragFactor: num(row.avg_drag),
    totalRestMs: num(row.total_rest_ms),
    simulated: !!row.simulated,
    verified: !!row.verified,
  };
  if (row.erg_name) item.ergName = row.erg_name;
  if (row.erg_serial) item.ergSerial = row.erg_serial;
  if (row.notes) item.notes = row.notes;
  const tags = parseJson<string[]>(row.tags, []);
  if (tags.length) item.tags = tags;
  return item;
}

export function rowToRecord(row: WorkoutRow & { data: string | null }): WorkoutRecord {
  return { ...rowToListItem(row), ...decodeBlob(row.data) };
}

/** WorkoutRecord → list item (in-memory backend). */
export function toListItem(r: WorkoutRecord): WorkoutListItem {
  const { strokes: _s, heartRate: _h, coxCalls: _c, splits: _p, ...rest } = r;
  return rest;
}
