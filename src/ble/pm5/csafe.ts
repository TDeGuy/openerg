/**
 * CSAFE framing + PM5 workout programming. Pure.
 *
 * Source: "Concept2 PM CSAFE Communication Definition" rev 0.31/0.34 (2025-07-17):
 *  - Standard frame: 0xF1 <contents> <checksum> 0xF2; checksum = XOR of all content bytes;
 *    byte stuffing (applied to contents + checksum): 0xF0-0xF3 → 0xF3, (b - 0xF0).
 *  - Max frame size 120 bytes including flags, checksum and stuffing.
 *  - PM proprietary configuration commands are wrapped in 0x76 (C2 proprietary wrapper,
 *    CSAFE_SETPMCFG_CMD) <byte count> <commands…>, exactly as in the spec's workout examples
 *    (JustRow, Fixed Distance, Fixed Time, Fixed/Variable Interval, Terminate Workout).
 *  - Multi-byte command data is big endian (MS byte first).
 */
import type { IntervalDef, WorkoutPlan } from '@/core/types';
import { DURATION_ID } from './parsers';

export const FRAME_START = 0xf1;
export const FRAME_STOP = 0xf2;
export const FRAME_STUFF = 0xf3;
export const MAX_FRAME_BYTES = 120;
/** The PM5 CSAFE receive characteristic accepts at most 20 bytes per write. */
export const BLE_CHUNK_BYTES = 20;

export const PM_WRAPPER = 0x76;
/** CSAFE_GETPMDATA_CMD: wrapper for PM-specific read commands (spec "CSAFE_GETPMDATA_CMD1" 0x7F). */
export const PM_GET_WRAPPER = 0x7f;
/** CSAFE_PM_GET_TARGETPACETIME (spec PM data get table): 4 bytes, MSB first, 0.01 s per 500 m. */
export const GET_TARGETPACETIME = 0xbe;

export const CMD = {
  SET_WORKOUTTYPE: 0x01,
  SET_WORKOUTDURATION: 0x03,
  SET_RESTDURATION: 0x04,
  SET_SPLITDURATION: 0x05,
  SET_TARGETPACETIME: 0x06,
  SET_SCREENSTATE: 0x13,
  CONFIGURE_WORKOUT: 0x14,
  SET_INTERVALTYPE: 0x17,
  SET_WORKOUTINTERVALCOUNT: 0x18,
} as const;

/** OBJ_WORKOUTTYPE_T */
export const WORKOUT_TYPE = {
  JUSTROW_NOSPLITS: 0,
  JUSTROW_SPLITS: 1,
  FIXEDDIST_NOSPLITS: 2,
  FIXEDDIST_SPLITS: 3,
  FIXEDTIME_NOSPLITS: 4,
  FIXEDTIME_SPLITS: 5,
  FIXEDTIME_INTERVAL: 6,
  FIXEDDIST_INTERVAL: 7,
  VARIABLE_INTERVAL: 8,
  VARIABLE_UNDEFINEDREST_INTERVAL: 9,
  FIXEDCALORIE_SPLITS: 10,
  FIXEDWATTMINUTE_SPLITS: 11,
  FIXEDCALS_INTERVAL: 12,
} as const;

/** OBJ_INTERVALTYPE_T */
export const INTERVAL_TYPE = {
  TIME: 0,
  DIST: 1,
  REST: 2,
  TIMERESTUNDEFINED: 3,
  DISTANCERESTUNDEFINED: 4,
  RESTUNDEFINED: 5,
  CALORIE: 6,
  CALORIERESTUNDEFINED: 7,
} as const;

export const SCREEN_TYPE_WORKOUT = 1;
export const SCREEN_VALUE = { PREPARE_TO_ROW: 1, TERMINATE_WORKOUT: 2, GOTO_MAIN_SCREEN: 6 } as const;

/** PM limits used when programming. */
export const PM_LIMITS = { MAX_INTERVALS: 50, MAX_SPLITS: 30, MIN_SPLIT_DISTANCE_M: 100, MIN_SPLIT_TIME_MS: 20000 } as const;

/* ───────────── framing ───────────── */

export function checksum(contents: number[]): number {
  let c = 0;
  for (const b of contents) c ^= b & 0xff;
  return c;
}

export function stuff(bytes: number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) {
    if (b >= 0xf0 && b <= 0xf3) out.push(FRAME_STUFF, b - 0xf0);
    else out.push(b);
  }
  return out;
}

export function unstuff(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === FRAME_STUFF && i + 1 < bytes.length) out.push(0xf0 + bytes[++i]!);
    else out.push(b);
  }
  return out;
}

/** Standard frame around raw contents. */
export function buildFrame(contents: number[]): number[] {
  return [FRAME_START, ...stuff([...contents, checksum(contents)]), FRAME_STOP];
}

/** One CSAFE command: id, byte count, data. */
export function command(id: number, data: number[] = []): number[] {
  return [id, data.length, ...data];
}

/** PM proprietary wrapper: 0x76, byte count, commands. */
export function pmWrap(commands: number[]): number[] {
  return [PM_WRAPPER, commands.length, ...commands];
}

export function be32(v: number): number[] {
  const n = Math.max(0, Math.round(v)) >>> 0;
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
export function be16(v: number): number[] {
  const n = Math.max(0, Math.min(0xffff, Math.round(v)));
  return [(n >> 8) & 0xff, n & 0xff];
}

export interface ParsedFrame {
  /** First content byte (PM status byte in responses). */
  status: number;
  contents: number[];
  checksumOk: boolean;
}

/** Parses a complete standard frame (F1 … F2). Returns null if malformed. */
export function parseFrame(raw: number[]): ParsedFrame | null {
  const s = raw.indexOf(FRAME_START);
  const e = raw.lastIndexOf(FRAME_STOP);
  if (s < 0 || e <= s + 1) return null;
  const body = unstuff(raw.slice(s + 1, e));
  if (body.length < 2) return null;
  const contents = body.slice(0, -1);
  return { status: contents[0] ?? 0, contents, checksumOk: checksum(contents) === body[body.length - 1] };
}

/** Accumulates notification chunks into complete frames. */
export class FrameAccumulator {
  private buf: number[] = [];
  push(chunk: ArrayLike<number>): ParsedFrame[] {
    const frames: ParsedFrame[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]! & 0xff;
      if (b === FRAME_START) this.buf = [b];
      else if (this.buf.length) {
        this.buf.push(b);
        if (b === FRAME_STOP) {
          const f = parseFrame(this.buf);
          if (f) frames.push(f);
          this.buf = [];
        }
      }
      if (this.buf.length > MAX_FRAME_BYTES * 2) this.buf = [];
    }
    return frames;
  }
}

/** Splits a frame into BLE writes. */
export function chunk(bytes: number[], size = BLE_CHUNK_BYTES): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

/**
 * Packs command groups into as few frames as possible (≤ 120 bytes each). A group is never
 * split across frames. Commands are stateful on the PM, so splitting between groups is safe.
 */
export function packFrames(groups: number[][]): number[][] {
  const frames: number[][] = [];
  let cur: number[] = [];
  for (const g of groups) {
    const candidate = [...cur, ...g];
    if (cur.length && buildFrame(pmWrap(candidate)).length > MAX_FRAME_BYTES) {
      frames.push(buildFrame(pmWrap(cur)));
      cur = [...g];
    } else cur = candidate;
  }
  if (cur.length) frames.push(buildFrame(pmWrap(cur)));
  return frames;
}

/* ───────────── workout programming ───────────── */

const setWorkoutType = (t: number) => command(CMD.SET_WORKOUTTYPE, [t]);
const configure = () => command(CMD.CONFIGURE_WORKOUT, [1]);
const prepareToRow = () => command(CMD.SET_SCREENSTATE, [SCREEN_TYPE_WORKOUT, SCREEN_VALUE.PREPARE_TO_ROW]);

/** Duration payload: identifier + 4-byte BE value (time in 0.01 s, distance in m, calories in kcal). */
export function durationBytes(kind: 'time' | 'distance' | 'calorie', value: number): number[] {
  if (kind === 'time') return [DURATION_ID.TIME, ...be32(value / 10)];
  if (kind === 'distance') return [DURATION_ID.DISTANCE, ...be32(value)];
  return [DURATION_ID.CALORIES, ...be32(value)];
}

/** Split length for a single piece; defaults to 1/5 of the piece, clamped to PM limits. */
export function defaultSplit(kind: 'time' | 'distance' | 'calorie', total: number, requested?: number): number {
  const minSplit =
    kind === 'distance' ? PM_LIMITS.MIN_SPLIT_DISTANCE_M : kind === 'time' ? PM_LIMITS.MIN_SPLIT_TIME_MS : 1;
  let split = requested && requested > 0 ? requested : total / 5;
  split = Math.max(split, total / PM_LIMITS.MAX_SPLITS, minSplit);
  split = Math.min(split, total);
  // Whole metres / whole seconds / whole kcal.
  return kind === 'time' ? Math.round(split / 1000) * 1000 : Math.round(split);
}

/**
 * Pace for the PM5 pace-boat display: the plan's goal pace, else the average of its pace plan.
 * Spec: CSAFE_PM_SET_TARGETPACETIME 0x06, 4 bytes MSB first, 0.01 s LSB (1:40 = 00 00 27 10), sent
 * before CONFIGURE_WORKOUT as in the spec's interval examples. The spec's single-piece examples
 * omit it (shortcut: not hardware-verified for single pieces; the PM may ignore it there).
 */
export function goalPace(plan: WorkoutPlan): number | undefined {
  const p = plan.target?.paceMsPer500 ?? plan.pacePlan?.goalPaceMsPer500;
  return p && p > 0 ? p : undefined;
}
const targetPace = (pace?: number) => (pace && pace > 0 ? command(CMD.SET_TARGETPACETIME, be32(pace / 10)) : []);

function singlePiece(type: number, kind: 'time' | 'distance' | 'calorie', value: number, splitValue?: number, pace?: number): number[][] {
  const split = defaultSplit(kind, value, splitValue);
  return [
    [
      ...setWorkoutType(type),
      ...command(CMD.SET_WORKOUTDURATION, durationBytes(kind, value)),
      ...command(CMD.SET_SPLITDURATION, durationBytes(kind, split)),
      ...targetPace(pace),
      ...configure(),
    ],
    prepareToRow(),
  ];
}

function intervalTypeFor(def: IntervalDef): number {
  const undef = !!def.undefinedRest;
  if (def.type === 'distance') return undef ? INTERVAL_TYPE.DISTANCERESTUNDEFINED : INTERVAL_TYPE.DIST;
  if (def.type === 'time') return undef ? INTERVAL_TYPE.TIMERESTUNDEFINED : INTERVAL_TYPE.TIME;
  return undef ? INTERVAL_TYPE.CALORIERESTUNDEFINED : INTERVAL_TYPE.CALORIE;
}

function restSeconds(def: IntervalDef): number {
  return def.undefinedRest ? 0 : Math.round(Math.max(0, def.restMs) / 1000);
}

/**
 * Variable-interval programming (spec examples "Variable Interval" and "Variable Interval
 * Undefined Rest"). Used for every interval plan with a rep count, because PM fixed-interval
 * workouts have no repeat count (they run until terminated). The spec also says fixed intervals
 * with undefined rest must be programmed this way.
 */
export function variableIntervalGroups(intervals: IntervalDef[], fallbackPaceMs?: number): number[][] {
  const list = intervals.slice(0, PM_LIMITS.MAX_INTERVALS);
  const groups: number[][] = [];
  const anyUndefined = list.some((d) => d.undefinedRest);
  list.forEach((def, i) => {
    const g: number[] = [...command(CMD.SET_WORKOUTINTERVALCOUNT, [i])];
    if (i === 0) g.push(...setWorkoutType(WORKOUT_TYPE.VARIABLE_INTERVAL));
    g.push(...command(CMD.SET_INTERVALTYPE, [intervalTypeFor(def)]));
    g.push(...command(CMD.SET_WORKOUTDURATION, durationBytes(def.type, def.value)));
    g.push(...command(CMD.SET_RESTDURATION, be16(restSeconds(def))));
    const pace = def.target?.paceMsPer500 ?? fallbackPaceMs;
    if (pace && pace > 0) g.push(...command(CMD.SET_TARGETPACETIME, be32(pace / 10)));
    g.push(...configure());
    groups.push(g);
  });
  if (anyUndefined) {
    // Spec: SplitDurationDistance must be 0 so "Biathlon" logic is not triggered.
    groups.push([
      ...setWorkoutType(WORKOUT_TYPE.VARIABLE_UNDEFINEDREST_INTERVAL),
      ...command(CMD.SET_SPLITDURATION, [DURATION_ID.DISTANCE, 0, 0, 0, 0]),
    ]);
  }
  groups.push(prepareToRow());
  return groups;
}

/** PM fixed-interval workout (repeats until terminated); used for `plan.repeatForever`. */
export function fixedIntervalGroups(def: IntervalDef, fallbackPaceMs?: number): number[][] {
  const type =
    def.type === 'distance' ? WORKOUT_TYPE.FIXEDDIST_INTERVAL : def.type === 'time' ? WORKOUT_TYPE.FIXEDTIME_INTERVAL : WORKOUT_TYPE.FIXEDCALS_INTERVAL;
  return [
    [
      ...setWorkoutType(type),
      ...command(CMD.SET_WORKOUTDURATION, durationBytes(def.type, def.value)),
      ...command(CMD.SET_RESTDURATION, be16(restSeconds(def))),
      ...targetPace(def.target?.paceMsPer500 ?? fallbackPaceMs),
      ...configure(),
    ],
    prepareToRow(),
  ];
}

/** Command groups for a plan. Throws on a plan the PM cannot represent. */
export function workoutGroups(plan: WorkoutPlan): number[][] {
  switch (plan.kind) {
    case 'just-row':
      return [setWorkoutType(WORKOUT_TYPE.JUSTROW_SPLITS), prepareToRow()];
    case 'single-distance':
      return singlePiece(WORKOUT_TYPE.FIXEDDIST_SPLITS, 'distance', requireValue(plan), plan.splitValue, goalPace(plan));
    case 'single-time':
      return singlePiece(WORKOUT_TYPE.FIXEDTIME_SPLITS, 'time', requireValue(plan), plan.splitValue, goalPace(plan));
    case 'single-calorie':
      return singlePiece(WORKOUT_TYPE.FIXEDCALORIE_SPLITS, 'calorie', requireValue(plan), plan.splitValue, goalPace(plan));
    case 'intervals': {
      const list = plan.intervals ?? [];
      if (!list.length) throw new Error('Interval plan has no intervals');
      if (plan.repeatForever) return fixedIntervalGroups(list[0]!, goalPace(plan));
      return variableIntervalGroups(list, goalPace(plan));
    }
  }
}

function requireValue(plan: WorkoutPlan): number {
  if (!plan.value || plan.value <= 0) throw new Error(`Plan "${plan.name}" has no target value`);
  return plan.value;
}

/** Complete frames (each ≤ 120 bytes) that program and arm `plan`. */
export function buildWorkoutFrames(plan: WorkoutPlan): number[][] {
  return packFrames(workoutGroups(plan));
}

/** Terminate the workout in progress (it is logged), then go to the main screen. */
export function buildTerminateFrames(): number[][] {
  return [
    buildFrame(pmWrap(command(CMD.SET_SCREENSTATE, [SCREEN_TYPE_WORKOUT, SCREEN_VALUE.TERMINATE_WORKOUT]))),
    buildFrame(pmWrap(command(CMD.SET_SCREENSTATE, [SCREEN_TYPE_WORKOUT, SCREEN_VALUE.GOTO_MAIN_SCREEN]))),
  ];
}

/**
 * Read-only: asks the PM5 for the pace-boat target pace (CSAFE_PM_GET_TARGETPACETIME 0xBE inside
 * the GETPMDATA wrapper 0x7F). Changes nothing on the PM.
 */
export function buildGetTargetPaceFrame(): number[] {
  return buildFrame([PM_GET_WRAPPER, 1, GET_TARGETPACETIME]);
}

/** Target pace (ms/500m) from a response to buildGetTargetPaceFrame, or null if absent / zero. */
export function parseTargetPace(frames: ParsedFrame[]): number | null {
  for (const f of frames) {
    const c = f.contents;
    for (let i = 1; i + 5 < c.length; i++) {
      if (c[i] === GET_TARGETPACETIME && c[i + 1] === 4) {
        const cs = ((c[i + 2]! << 24) | (c[i + 3]! << 16) | (c[i + 4]! << 8) | c[i + 5]!) >>> 0;
        return cs > 0 ? cs * 10 : null;
      }
    }
  }
  return null;
}
