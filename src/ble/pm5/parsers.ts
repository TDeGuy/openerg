/**
 * Pure parsers for PM5 rowing-service notifications.
 *
 * Byte layouts come from the attribute table in the "Concept2 PM CSAFE Communication
 * Definition" rev 0.31/0.34 (2025-07-17), pp. 17-42. All multi-byte values are little endian.
 * The multiplexed characteristic (0x0080) carries the same data, prefixed by an ID byte,
 * but several payloads are shorter or reordered than the standalone characteristics. Each
 * parser therefore takes a `variant`.
 *
 * Unit conversions (PM → app):
 *   time 0.01 s → ms ×10, time 0.1 s → ms ×100, distance 0.1 m → m ÷10,
 *   pace 0.01 s/500m → ms ×10 (0.1 s variants ×100), speed 0.001 m/s → m/s ÷1000,
 *   force 0.1 lbf → N ×0.44482216, work 0.1 J → J ÷10, drive length 0.01 m → m ÷100.
 */
import type { IntervalType, MachineType, PmWorkoutType, RowingState, StrokeState, WorkoutState } from '@/core/types';

export type Variant = 'direct' | 'mux';

export const N_PER_LBF = 4.4482216;

/* ───────────── byte helpers ───────────── */

export function u8(b: ArrayLike<number>, o: number): number {
  return (b[o] ?? 0) & 0xff;
}
export function u16(b: ArrayLike<number>, o: number): number {
  return u8(b, o) | (u8(b, o + 1) << 8);
}
export function u24(b: ArrayLike<number>, o: number): number {
  return u8(b, o) | (u8(b, o + 1) << 8) | (u8(b, o + 2) << 16);
}
export function u32(b: ArrayLike<number>, o: number): number {
  return (u24(b, o) + u8(b, o + 3) * 0x1000000) >>> 0;
}
function hr(v: number): number | null {
  return v === 0 || v === 255 ? null : v;
}

/* ───────────── enums ───────────── */

const WORKOUT_TYPES: PmWorkoutType[] = [
  'just-row-no-splits',
  'just-row-splits',
  'fixed-distance-no-splits',
  'fixed-distance-splits',
  'fixed-time-no-splits',
  'fixed-time-splits',
  'fixed-time-interval',
  'fixed-distance-interval',
  'variable-interval',
  'variable-undefined-rest-interval',
  'fixed-calorie',
  'fixed-watt-minutes',
  'fixed-calorie-interval',
];
export function workoutTypeFromPm(v: number): PmWorkoutType {
  // 13 = FIXEDWATTMIN_INTERVAL has no dedicated contract value.
  if (v === 13) return 'fixed-watt-minutes';
  return WORKOUT_TYPES[v] ?? 'unknown';
}
export function workoutTypeToPm(t: PmWorkoutType): number {
  const i = WORKOUT_TYPES.indexOf(t);
  return i < 0 ? 1 : i;
}

const INTERVAL_TYPES: IntervalType[] = [
  'time',
  'distance',
  'rest',
  'time-rest-undefined',
  'distance-rest-undefined',
  'rest-undefined',
  'calorie',
  'calorie-rest-undefined',
  'watt-minute',
  'watt-minute-rest-undefined',
];
export function intervalTypeFromPm(v: number): IntervalType {
  return INTERVAL_TYPES[v] ?? 'none';
}
export function intervalTypeToPm(t: IntervalType): number {
  const i = INTERVAL_TYPES.indexOf(t);
  return i < 0 ? 255 : i;
}

const WORKOUT_STATES: WorkoutState[] = [
  'waiting-to-begin',
  'workout-row',
  'countdown-pause',
  'interval-rest',
  'interval-work-time',
  'interval-work-distance',
  'interval-rest-end-to-work-time',
  'interval-rest-end-to-work-distance',
  'interval-work-time-to-rest',
  'interval-work-distance-to-rest',
  'workout-end',
  'terminate',
  'workout-logged',
  'rearm',
];
export function workoutStateFromPm(v: number): WorkoutState {
  return WORKOUT_STATES[v] ?? 'waiting-to-begin';
}
export function workoutStateToPm(s: WorkoutState): number {
  return Math.max(0, WORKOUT_STATES.indexOf(s));
}

export function rowingStateFromPm(v: number): RowingState {
  return v === 1 ? 'active' : 'inactive';
}

const STROKE_STATES: StrokeState[] = [
  'waiting-for-wheel-to-reach-min-speed',
  'waiting-for-wheel-to-accelerate',
  'driving',
  'dwelling-after-drive',
  'recovery',
];
export function strokeStateFromPm(v: number): StrokeState {
  return STROKE_STATES[v] ?? 'waiting-for-wheel-to-reach-min-speed';
}
export function strokeStateToPm(s: StrokeState): number {
  return Math.max(0, STROKE_STATES.indexOf(s));
}

/** OBJ_ERGMACHINETYPE_T → MachineType. 0-127 rowers (static/slides/dynamic/dyno), 128-191 SkiErg, 192+ BikeErg, 224-226 MultiErg. */
export function machineTypeFromPm(v: number): MachineType {
  if (v === 224) return 'rower';
  if (v === 225) return 'skierg';
  if (v === 226) return 'bikeerg';
  if (v >= 192) return 'bikeerg';
  if (v >= 128) return 'skierg';
  return 'rower';
}

/** Workout duration identifier (CSAFE_PM_SET_WORKOUTDURATION byte 0). */
export const DURATION_ID = { TIME: 0x00, CALORIES: 0x40, DISTANCE: 0x80, WATT_MINUTES: 0xc0 } as const;

/* ───────────── parsed shapes ───────────── */

export interface GeneralStatus {
  kind: 'generalStatus';
  elapsedMs: number;
  distanceM: number;
  workoutType: PmWorkoutType;
  intervalType: IntervalType;
  workoutState: WorkoutState;
  rowingState: RowingState;
  strokeState: StrokeState;
  totalWorkDistanceM: number;
  /** Raw workout duration and its identifier; see workoutDurationMs / workoutDistanceM. */
  workoutDurationRaw: number;
  workoutDurationType: number;
  workoutDurationMs: number;
  workoutDistanceM: number;
  /** Workout target in kcal when the duration type is calories. */
  workoutCalories: number;
  dragFactor: number;
}

export interface AdditionalStatus {
  kind: 'additionalStatus';
  elapsedMs: number;
  speedMps: number;
  strokeRate: number;
  heartRate: number | null;
  paceMsPer500: number;
  avgPaceMsPer500: number;
  restDistanceM: number;
  restTimeMs: number;
  /** Only in the multiplexed variant. */
  avgWatts: number | null;
  machineType: number | null;
}

export interface AdditionalStatus2 {
  kind: 'additionalStatus2';
  elapsedMs: number;
  intervalCount: number;
  /** Only in the standalone characteristic (the mux variant carries it in 0x32). */
  avgWatts: number | null;
  calories: number;
  splitAvgPaceMsPer500: number;
  splitAvgWatts: number;
  splitAvgCalPerHour: number;
  lastSplitTimeMs: number;
  lastSplitDistanceM: number;
}

export interface StrokeData {
  kind: 'strokeData';
  elapsedMs: number;
  distanceM: number;
  driveLengthM: number;
  driveTimeMs: number;
  recoveryTimeMs: number;
  strokeDistanceM: number;
  peakForceN: number;
  avgForceN: number;
  /** Only in the standalone characteristic (mux carries it in 0x36). */
  workPerStrokeJ: number | null;
  strokeCount: number;
}

export interface AdditionalStrokeData {
  kind: 'additionalStrokeData';
  elapsedMs: number;
  watts: number;
  caloriesPerHour: number;
  strokeCount: number;
  projectedWorkTimeMs: number;
  projectedWorkDistanceM: number;
  /** Only in the mux variant. */
  workPerStrokeJ: number | null;
}

export interface SplitData {
  kind: 'splitData';
  elapsedMs: number;
  distanceM: number;
  splitTimeMs: number;
  splitDistanceM: number;
  restTimeMs: number;
  restDistanceM: number;
  intervalType: IntervalType;
  splitNumber: number;
}

export interface AdditionalSplitData {
  kind: 'additionalSplitData';
  elapsedMs: number;
  avgStrokeRate: number;
  workHeartRate: number | null;
  restHeartRate: number | null;
  avgPaceMsPer500: number;
  calories: number;
  avgCalPerHour: number;
  speedMps: number;
  watts: number;
  avgDragFactor: number;
  splitNumber: number;
  machineType: number | null;
}

export interface WorkoutSummary {
  kind: 'workoutSummary';
  logDate: number;
  logTime: number;
  /** Decoded PM log timestamp (local time), null if not decodable. */
  loggedAt: number | null;
  elapsedMs: number;
  distanceM: number;
  avgStrokeRate: number;
  endingHeartRate: number | null;
  avgHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  avgDragFactor: number;
  recoveryHeartRate: number | null;
  workoutType: PmWorkoutType;
  /** Only in the standalone characteristic (mux carries it in 0x3C). */
  avgPaceMsPer500: number | null;
}

export interface AdditionalWorkoutSummary {
  kind: 'additionalWorkoutSummary';
  logDate: number;
  logTime: number;
  /** Only in the standalone characteristic. */
  intervalType: IntervalType | null;
  /** Metres or seconds, depending on the workout. */
  splitSize: number;
  splitCount: number;
  calories: number;
  watts: number;
  restDistanceM: number;
  restTimeMs: number;
  avgCalPerHour: number;
}

export interface AdditionalWorkoutSummary2 {
  kind: 'additionalWorkoutSummary2';
  logDate: number;
  logTime: number;
  avgPaceMsPer500: number;
  gameId: number;
  gameScore: number;
  machineType: number;
  totalWattMinutes: number;
}

export interface HeartRateBeltInfo {
  kind: 'heartRateBeltInfo';
  manufacturerId: number;
  deviceType: number;
  beltId: number;
}

export interface ForceCurveFragment {
  kind: 'forceCurveFragment';
  /** Total notifications making up this curve (MS nibble). */
  totalFragments: number;
  /** 16-bit words in this notification (LS nibble). */
  wordCount: number;
  sequence: number;
  /** Raw words (PM force units, see ForceCurveReassembler). */
  words: number[];
}

export type Pm5Packet =
  | GeneralStatus
  | AdditionalStatus
  | AdditionalStatus2
  | StrokeData
  | AdditionalStrokeData
  | SplitData
  | AdditionalSplitData
  | WorkoutSummary
  | AdditionalWorkoutSummary
  | AdditionalWorkoutSummary2
  | HeartRateBeltInfo
  | ForceCurveFragment;

/* ───────────── parsers ───────────── */

const lbfTenthsToN = (v: number) => (v / 10) * N_PER_LBF;

/** 0x0031 (19 bytes, identical in mux). */
export function parseGeneralStatus(b: ArrayLike<number>): GeneralStatus {
  const raw = u24(b, 14);
  const durType = u8(b, 17);
  return {
    kind: 'generalStatus',
    elapsedMs: u24(b, 0) * 10,
    distanceM: u24(b, 3) / 10,
    workoutType: workoutTypeFromPm(u8(b, 6)),
    intervalType: intervalTypeFromPm(u8(b, 7)),
    workoutState: workoutStateFromPm(u8(b, 8)),
    rowingState: rowingStateFromPm(u8(b, 9)),
    strokeState: strokeStateFromPm(u8(b, 10)),
    totalWorkDistanceM: u24(b, 11),
    workoutDurationRaw: raw,
    workoutDurationType: durType,
    workoutDurationMs: durType === DURATION_ID.TIME ? raw * 10 : 0,
    workoutDistanceM: durType === DURATION_ID.DISTANCE ? raw : 0,
    workoutCalories: durType === DURATION_ID.CALORIES ? raw : 0,
    dragFactor: u8(b, 18),
  };
}

/** 0x0032 (17 bytes) / mux 0x32 (19 bytes: adds average power before machine type). */
export function parseAdditionalStatus(b: ArrayLike<number>, variant: Variant = 'direct'): AdditionalStatus {
  const mux = variant === 'mux';
  return {
    kind: 'additionalStatus',
    elapsedMs: u24(b, 0) * 10,
    speedMps: u16(b, 3) / 1000,
    strokeRate: u8(b, 5),
    heartRate: hr(u8(b, 6)),
    paceMsPer500: u16(b, 7) * 10,
    avgPaceMsPer500: u16(b, 9) * 10,
    restDistanceM: u16(b, 11),
    restTimeMs: u24(b, 13) * 10,
    avgWatts: mux ? u16(b, 16) : null,
    machineType: mux ? (b.length > 18 ? u8(b, 18) : null) : b.length > 16 ? u8(b, 16) : null,
  };
}

/** 0x0033 (20 bytes) / mux 0x33 (18 bytes, no average power). */
export function parseAdditionalStatus2(b: ArrayLike<number>, variant: Variant = 'direct'): AdditionalStatus2 {
  const o = variant === 'mux' ? -2 : 0;
  return {
    kind: 'additionalStatus2',
    elapsedMs: u24(b, 0) * 10,
    intervalCount: u8(b, 3),
    avgWatts: variant === 'mux' ? null : u16(b, 4),
    calories: u16(b, 6 + o),
    splitAvgPaceMsPer500: u16(b, 8 + o) * 10,
    splitAvgWatts: u16(b, 10 + o),
    splitAvgCalPerHour: u16(b, 12 + o),
    lastSplitTimeMs: u24(b, 14 + o) * 100,
    lastSplitDistanceM: u24(b, 17 + o),
  };
}

/** 0x0035 (20 bytes) / mux 0x35 (18 bytes, no work per stroke). */
export function parseStrokeData(b: ArrayLike<number>, variant: Variant = 'direct'): StrokeData {
  const mux = variant === 'mux';
  return {
    kind: 'strokeData',
    elapsedMs: u24(b, 0) * 10,
    distanceM: u24(b, 3) / 10,
    driveLengthM: u8(b, 6) / 100,
    driveTimeMs: u8(b, 7) * 10,
    recoveryTimeMs: u16(b, 8) * 10,
    strokeDistanceM: u16(b, 10) / 100,
    peakForceN: lbfTenthsToN(u16(b, 12)),
    avgForceN: lbfTenthsToN(u16(b, 14)),
    workPerStrokeJ: mux ? null : u16(b, 16) / 10,
    strokeCount: mux ? u16(b, 16) : u16(b, 18),
  };
}

/** 0x0036 (17 bytes; rev 0.31+ appends 3 bytes "projected work other") / mux 0x36 (17 bytes, adds work per stroke). */
export function parseAdditionalStrokeData(b: ArrayLike<number>, variant: Variant = 'direct'): AdditionalStrokeData {
  return {
    kind: 'additionalStrokeData',
    elapsedMs: u24(b, 0) * 10,
    watts: u16(b, 3),
    caloriesPerHour: u16(b, 5),
    strokeCount: u16(b, 7),
    projectedWorkTimeMs: u24(b, 9) * 1000,
    projectedWorkDistanceM: u24(b, 12),
    workPerStrokeJ: variant === 'mux' ? u16(b, 15) / 10 : null,
  };
}

/** 0x0037 (18 bytes, identical in mux). */
export function parseSplitData(b: ArrayLike<number>): SplitData {
  return {
    kind: 'splitData',
    elapsedMs: u24(b, 0) * 10,
    distanceM: u24(b, 3) / 10,
    splitTimeMs: u24(b, 6) * 100,
    splitDistanceM: u24(b, 9),
    restTimeMs: u16(b, 12) * 1000,
    restDistanceM: u16(b, 14),
    intervalType: intervalTypeFromPm(u8(b, 16)),
    splitNumber: u8(b, 17),
  };
}

/** 0x0038 (19 bytes) / mux 0x38 (18 bytes; machine type omitted). */
export function parseAdditionalSplitData(b: ArrayLike<number>): AdditionalSplitData {
  return {
    kind: 'additionalSplitData',
    elapsedMs: u24(b, 0) * 10,
    avgStrokeRate: u8(b, 3),
    workHeartRate: hr(u8(b, 4)),
    restHeartRate: hr(u8(b, 5)),
    avgPaceMsPer500: u16(b, 6) * 100,
    calories: u16(b, 8),
    avgCalPerHour: u16(b, 10),
    speedMps: u16(b, 12) / 1000,
    watts: u16(b, 14),
    avgDragFactor: u8(b, 16),
    splitNumber: u8(b, 17),
    machineType: b.length > 18 ? u8(b, 18) : null,
  };
}

/**
 * PM log date/time words. Assumed encoding (as used by the PM5 log card and open-source
 * clients such as ergometer-js): date = month (bits 0-3) | day (bits 4-8) | year-2000 (bits 9-15);
 * time = minutes (low byte) | hours (high byte). Returns null if out of range.
 */
export function decodePmLogTimestamp(date: number, time: number): number | null {
  const month = date & 0x0f;
  const day = (date >> 4) & 0x1f;
  const year = ((date >> 9) & 0x7f) + 2000;
  const minute = time & 0xff;
  const hour = (time >> 8) & 0xff;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return new Date(year, month - 1, day, hour, minute).getTime();
}

/** 0x0039 (20 bytes) / mux 0x39 (18 bytes, no average pace). */
export function parseWorkoutSummary(b: ArrayLike<number>, variant: Variant = 'direct'): WorkoutSummary {
  const logDate = u16(b, 0);
  const logTime = u16(b, 2);
  return {
    kind: 'workoutSummary',
    logDate,
    logTime,
    loggedAt: decodePmLogTimestamp(logDate, logTime),
    elapsedMs: u24(b, 4) * 10,
    distanceM: u24(b, 7) / 10,
    avgStrokeRate: u8(b, 10),
    endingHeartRate: hr(u8(b, 11)),
    avgHeartRate: hr(u8(b, 12)),
    minHeartRate: hr(u8(b, 13)),
    maxHeartRate: hr(u8(b, 14)),
    avgDragFactor: u8(b, 15),
    recoveryHeartRate: hr(u8(b, 16)),
    workoutType: workoutTypeFromPm(u8(b, 17)),
    avgPaceMsPer500: variant === 'direct' && b.length >= 20 ? u16(b, 18) * 100 : null,
  };
}

/** 0x003A (19 bytes) / mux 0x3A (18 bytes, no split/interval type). */
export function parseAdditionalWorkoutSummary(b: ArrayLike<number>, variant: Variant = 'direct'): AdditionalWorkoutSummary {
  const o = variant === 'mux' ? -1 : 0;
  return {
    kind: 'additionalWorkoutSummary',
    logDate: u16(b, 0),
    logTime: u16(b, 2),
    intervalType: variant === 'mux' ? null : intervalTypeFromPm(u8(b, 4)),
    splitSize: u16(b, 5 + o),
    splitCount: u8(b, 7 + o),
    calories: u16(b, 8 + o),
    watts: u16(b, 10 + o),
    restDistanceM: u24(b, 12 + o),
    restTimeMs: u16(b, 15 + o) * 1000,
    avgCalPerHour: u16(b, 17 + o),
  };
}

/** mux 0x3C (13 bytes). */
export function parseAdditionalWorkoutSummary2(b: ArrayLike<number>): AdditionalWorkoutSummary2 {
  return {
    kind: 'additionalWorkoutSummary2',
    logDate: u16(b, 0),
    logTime: u16(b, 2),
    avgPaceMsPer500: u16(b, 4) * 100,
    gameId: u8(b, 6),
    gameScore: u16(b, 7),
    machineType: u8(b, 9),
    totalWattMinutes: u24(b, 10),
  };
}

/** 0x003B (6 bytes). */
export function parseHeartRateBeltInfo(b: ArrayLike<number>): HeartRateBeltInfo {
  return { kind: 'heartRateBeltInfo', manufacturerId: u8(b, 0), deviceType: u8(b, 1), beltId: u32(b, 2) };
}

/** 0x003D (2-20 bytes per notification). */
export function parseForceCurveFragment(b: ArrayLike<number>): ForceCurveFragment {
  const header = u8(b, 0);
  const wordCount = header & 0x0f;
  const available = Math.max(0, Math.floor((b.length - 2) / 2));
  const n = Math.min(wordCount, available);
  const words: number[] = [];
  for (let i = 0; i < n; i++) words.push(u16(b, 2 + i * 2));
  return { kind: 'forceCurveFragment', totalFragments: header >> 4, wordCount, sequence: u8(b, 1), words };
}

const MIN_LEN: Record<number, number> = {
  0x31: 19, 0x32: 17, 0x33: 18, 0x35: 18, 0x36: 15, 0x37: 18, 0x38: 18, 0x39: 18, 0x3a: 18, 0x3b: 6, 0x3c: 13, 0x3d: 2,
};

/** Parses a payload for a characteristic id (0x31…0x3D). Returns null if unknown / too short. */
export function parsePacket(id: number, b: ArrayLike<number>, variant: Variant): Pm5Packet | null {
  const min = MIN_LEN[id];
  if (min === undefined || b.length < min) return null;
  switch (id) {
    case 0x31: return parseGeneralStatus(b);
    case 0x32: return parseAdditionalStatus(b, variant);
    case 0x33: return parseAdditionalStatus2(b, variant === 'mux' || b.length < 20 ? 'mux' : 'direct');
    case 0x35: return parseStrokeData(b, variant === 'mux' || b.length < 20 ? 'mux' : 'direct');
    case 0x36: return parseAdditionalStrokeData(b, variant);
    case 0x37: return parseSplitData(b);
    case 0x38: return parseAdditionalSplitData(b);
    case 0x39: return parseWorkoutSummary(b, variant);
    case 0x3a: return parseAdditionalWorkoutSummary(b, variant === 'mux' || b.length < 19 ? 'mux' : 'direct');
    case 0x3b: return parseHeartRateBeltInfo(b);
    case 0x3c: return parseAdditionalWorkoutSummary2(b);
    case 0x3d: return parseForceCurveFragment(b);
    default: return null;
  }
}

/** Multiplexed characteristic 0x0080: first byte = id, rest = payload. */
export function parseMultiplexed(b: ArrayLike<number>): Pm5Packet | null {
  if (b.length < 2) return null;
  const payload = Array.prototype.slice.call(b, 1) as number[];
  return parsePacket(u8(b, 0), payload, 'mux');
}

/* ───────────── force curve reassembly ───────────── */

/**
 * Reassembles force-curve notifications. Each notification's header gives the total number of
 * notifications for this stroke (MS nibble) and its word count (LS nibble, max 9 words).
 * A curve is complete when `totalFragments` fragments have arrived. The spec does not say whether
 * the sequence number counts fragments or curves, so a fragment continues the curve in progress
 * when its total matches and its sequence is the same or the next one; anything else starts a new
 * curve. An exact repeat of the previous fragment (same sequence and words) is dropped.
 *
 * Units: the spec does not state force-curve units. Concept2's own apps and open-source clients
 * (ergometer-js, c2bluetooth) treat the words as pounds-force (integer lbf), unlike the 0.1 lbf
 * peak/average force in 0x35. `toNewtons` converts lbf → N. If the stroke's peak force is known it
 * also checks the scale: if the curve maximum is about 10× the peak in lbf, it treats the curve
 * as 0.1 lbf.
 */
export class ForceCurveReassembler {
  private words: number[] = [];
  private total = 0;
  private received = 0;
  private last: ForceCurveFragment | null = null;

  /** Feed one fragment; returns raw words when a curve completes, else null. */
  push(f: ForceCurveFragment): number[] | null {
    if (f.totalFragments <= 0) return null;
    const prev = this.last;
    if (prev && prev.sequence === f.sequence && prev.words.join() === f.words.join()) return null;
    const continues = prev && f.totalFragments === this.total && (f.sequence === prev.sequence || f.sequence === ((prev.sequence + 1) & 0xff));
    if (this.received > 0 && !continues) this.reset();
    if (this.received === 0) this.total = f.totalFragments;
    this.words.push(...f.words);
    this.last = f;
    this.received++;
    if (this.received >= this.total) {
      const out = this.words;
      this.reset(true);
      return out;
    }
    return null;
  }

  /** `keepLast` remembers the final fragment so a resent copy of it is still dropped. */
  reset(keepLast = false): void {
    this.words = [];
    this.total = 0;
    this.received = 0;
    if (!keepLast) this.last = null;
  }

  static toNewtons(words: number[], peakForceN?: number): number[] {
    const max = words.length ? Math.max(...words) : 0;
    const peakLbf = peakForceN && peakForceN > 0 ? peakForceN / N_PER_LBF : 0;
    // 0.1 lbf words read ~10× the stroke's peak; with no peak known, >400 lbf is not humanly possible.
    const tenths = peakLbf ? max > peakLbf * 5 : max > 400;
    const scale = tenths ? N_PER_LBF / 10 : N_PER_LBF;
    return words.map((w) => w * scale);
  }
}
