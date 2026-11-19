/**
 * Physics-plausible PM5 simulator. Pure TypeScript, timers only (no native imports).
 *
 * Advertises one fake erg ("PM5 SIM 430000001"). After programWorkout() it counts down briefly
 * and then rows by itself. It produces a stroke cycle timed from the stroke rate, pace with natural
 * noise and mild fatigue drift, heart-rate response, drag factor ~125, and bell-shaped force curves
 * that sometimes show flaws (late peak, double peak, soft catch). It also produces splits,
 * interval work/rest transitions and a workoutEnd summary.
 * `speed` multiplies simulated time (e.g. 20 → 20× real time).
 */
import type {
  ConnectionState,
  DiscoveredErg,
  ErgDataSource,
  ErgEvents,
  ErgInfo,
  IntervalType,
  LiveMetrics,
  MachineType,
  PmWorkoutSummary,
  PmWorkoutType,
  SplitSummary,
  StrokeSample,
  Unsubscribe,
  WorkoutPlan,
  WorkoutState,
} from '@/core/types';
import { emptyMetrics } from '@/core/defaults';
import { paceToWatts, wattsToCalPerHour } from '@/core/units';
import { Emitter } from './emitter';

export interface SimulatorOptions {
  /** Time multiplier, default 1 (real time). */
  speed?: number;
  machineType?: MachineType;
  /** RNG seed for reproducible sessions. */
  seed?: number;
  /** Countdown before rowing starts (simulated ms). Default 3000. */
  countdownMs?: number;
  /** Athlete's comfortable steady pace (ms/500m). Default 2:05. */
  basePaceMsPer500?: number;
  /** Real-time tick period (ms). Default 100 (= 10 Hz metrics). */
  tickMs?: number;
}

export interface SimulatorSource extends ErgDataSource {
  setSpeed(speed: number): void;
}

export const SIM_ERG: DiscoveredErg = { id: 'sim-pm5-430000001', name: 'PM5 SIM 430000001', rssi: -48, simulated: true };

type MeasureKind = 'distance' | 'time' | 'calorie' | 'open';

interface Segment {
  kind: MeasureKind;
  /** metres | ms | kcal; open = unbounded */
  value: number;
  restMs: number;
  undefinedRest: boolean;
  /** Split measure + length inside the segment (single pieces); null = one split per segment. */
  splitKind: Exclude<MeasureKind, 'open'> | null;
  splitValue: number;
  intervalType: IntervalType;
  targetPace?: number;
  targetRate?: number;
}

interface Stroke {
  pace: number;
  rate: number;
  driveMs: number;
  recoveryMs: number;
  speed: number;
  watts: number;
  driveLengthM: number;
  workJ: number;
  curve: number[];
}

const SUBSTEP_MS = 20;
const UNDEFINED_REST_MS = 15000;
const EPS = 1e-6;

/* ───────────── RNG ───────────── */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────── force curve shapes ───────────── */

function beta(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.pow(x, a - 1) * Math.pow(1 - x, b - 1);
}

export type SimCurveFlaw = 'none' | 'late-peak' | 'double-peak' | 'soft-catch';

/** Force curve (N) with mean ≈ avgForceN; exposed for tests. */
export function simForceCurve(points: number, avgForceN: number, flaw: SimCurveFlaw, rand: () => number): number[] {
  const g: number[] = [];
  for (let i = 0; i < points; i++) {
    // Sample slightly inside the drive so the first/last points are small but non-zero.
    const x = (i + 0.5) / points;
    let v: number;
    switch (flaw) {
      case 'late-peak':
        v = beta(x, 2.9, 1.8);
        break;
      case 'double-peak':
        v = 0.55 * beta(x, 2.2, 5) / 0.077 + 0.62 * beta(x, 5.2, 2.3) / 0.058;
        break;
      case 'soft-catch':
        v = beta(x, 1.9, 2.6) * Math.pow(Math.min(1, x / 0.4), 1.6);
        break;
      default:
        v = beta(x, 1.9, 2.6);
    }
    g.push(Math.max(0, v * (1 + (rand() - 0.5) * 0.06)));
  }
  const mean = g.reduce((s, v) => s + v, 0) / g.length || 1;
  return g.map((v) => Math.round((v / mean) * avgForceN * 10) / 10);
}

/* ───────────── plan → segments ───────────── */

function rateForPace(pace: number): number {
  // ~20 spm at 2:10, ~32 spm at 1:40.
  return Math.max(17, Math.min(36, Math.round(20 + (130000 - pace) / 2500)));
}

function defaultPaceFor(plan: WorkoutPlan, base: number): number {
  if (plan.target?.paceMsPer500) return plan.target.paceMsPer500;
  switch (plan.kind) {
    case 'single-distance': {
      const d = plan.value ?? 2000;
      return d <= 1000 ? base - 17000 : d <= 2000 ? base - 13000 : d <= 6000 ? base - 8000 : base - 3000;
    }
    case 'single-time': {
      const t = plan.value ?? 1800000;
      return t <= 300000 ? base - 12000 : t <= 1200000 ? base - 7000 : base - 2000;
    }
    case 'single-calorie':
      return base - 10000;
    case 'intervals':
      return base - 12000;
    default:
      return base;
  }
}

interface SimWorkout {
  segments: Segment[];
  intervals: boolean;
  /** PM fixed-interval mode: the single segment repeats until terminated. */
  repeat?: boolean;
  workoutType: PmWorkoutType;
  basePace: number;
}

function buildWorkout(plan: WorkoutPlan, basePaceDefault: number): SimWorkout {
  const basePace = defaultPaceFor(plan, basePaceDefault);
  const rate = plan.target?.strokeRate;
  const split = (kind: 'distance' | 'time' | 'calorie', total: number) => {
    let s = plan.splitValue && plan.splitValue > 0 ? plan.splitValue : total / 5;
    s = Math.min(total, Math.max(s, total / 30));
    return kind === 'time' ? Math.max(1000, Math.round(s / 1000) * 1000) : Math.max(1, Math.round(s));
  };
  switch (plan.kind) {
    case 'single-distance':
    case 'single-time':
    case 'single-calorie': {
      const kind = plan.kind === 'single-distance' ? 'distance' : plan.kind === 'single-time' ? 'time' : 'calorie';
      const value = plan.value && plan.value > 0 ? plan.value : kind === 'distance' ? 2000 : kind === 'time' ? 1200000 : 100;
      return {
        intervals: false,
        basePace,
        workoutType: kind === 'distance' ? 'fixed-distance-splits' : kind === 'time' ? 'fixed-time-splits' : 'fixed-calorie',
        segments: [
          { kind, value, restMs: 0, undefinedRest: false, splitKind: kind, splitValue: split(kind, value), intervalType: kind, targetPace: basePace, targetRate: rate },
        ],
      };
    }
    case 'intervals': {
      const repeat = !!plan.repeatForever;
      const defs = (plan.intervals ?? []).filter((d) => d.value > 0).slice(0, repeat ? 1 : undefined);
      if (!defs.length) return buildWorkout({ ...plan, kind: 'just-row' }, basePaceDefault);
      const identical = defs.every(
        (d) => d.type === defs[0]!.type && d.value === defs[0]!.value && d.restMs === defs[0]!.restMs && !d.undefinedRest,
      );
      const anyUndef = defs.some((d) => d.undefinedRest);
      const workoutType: PmWorkoutType = anyUndef
        ? 'variable-undefined-rest-interval'
        : identical
          ? defs[0]!.type === 'distance'
            ? 'fixed-distance-interval'
            : defs[0]!.type === 'time'
              ? 'fixed-time-interval'
              : 'fixed-calorie-interval'
          : 'variable-interval';
      return {
        intervals: true,
        repeat,
        basePace,
        workoutType,
        segments: defs.map((d) => ({
          kind: d.type,
          value: d.value,
          restMs: d.undefinedRest ? 0 : Math.max(0, d.restMs),
          undefinedRest: !!d.undefinedRest,
          splitKind: null,
          splitValue: 0,
          intervalType: d.undefinedRest ? (`${d.type}-rest-undefined` as IntervalType) : d.type,
          targetPace: d.target?.paceMsPer500 ?? (d.type === 'time' && d.value >= 600000 ? basePace + 6000 : basePace),
          targetRate: d.target?.strokeRate ?? rate,
        })),
      };
    }
    default:
      return {
        intervals: false,
        basePace,
        workoutType: 'just-row-splits',
        segments: [
          { kind: 'open', value: Infinity, restMs: 0, undefinedRest: false, splitKind: 'distance', splitValue: 500, intervalType: 'distance', targetPace: basePace, targetRate: rate },
        ],
      };
  }
}

/* ───────────── simulator ───────────── */

type Phase = 'idle' | 'countdown' | 'work' | 'rest' | 'finished';

interface SplitAcc {
  ms: number;
  dist: number;
  cal: number;
  strokes: number;
  wattMs: number;
  hrMs: number;
  hrSum: number;
}
const newSplit = (): SplitAcc => ({ ms: 0, dist: 0, cal: 0, strokes: 0, wattMs: 0, hrMs: 0, hrSum: 0 });

export function createSimulator(opts: SimulatorOptions = {}): SimulatorSource {
  let speed = Math.max(0.1, opts.speed ?? 1);
  const tickMs = opts.tickMs ?? 100;
  const countdownMs = opts.countdownMs ?? 3000;
  const machineType = opts.machineType ?? 'rower';
  const basePaceDefault = opts.basePaceMsPer500 ?? (machineType === 'bikeerg' ? 125000 / 2 + 60000 : 125000);
  const rand = mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
  const gauss = () => {
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  const events = new Emitter<ErgEvents>();
  const info: ErgInfo = {
    id: SIM_ERG.id,
    name: SIM_ERG.name,
    serialNumber: '430000001',
    hardwareRevision: '634',
    firmwareRevision: '212',
    manufacturer: 'Concept2',
    machineType,
    simulated: true,
  };
  let connection: ConnectionState = { status: 'idle', device: null };
  let timer: ReturnType<typeof setInterval> | null = null;
  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  let destroyed = false;

  // workout state
  let workout: SimWorkout | null = null;
  let phase: Phase = 'idle';
  let workoutState: WorkoutState = 'waiting-to-begin';
  let countdownLeft = 0;
  let segIdx = 0;
  let segMs = 0;
  let segDist = 0;
  let segCal = 0;
  let segSplitIdx = 0;
  let restLeft = 0;
  let restTotal = 0;
  let totalRestMs = 0;
  let elapsedMs = 0;
  let workMs = 0;
  let workDist = 0;
  let workCal = 0;
  let wattMs = 0;
  let strokeCount = 0;
  let splitIndex = 0;
  let split = newSplit();
  let pendingIntervalSplit: SplitSummary | null = null;
  let lastSplitTime = 0;
  let lastSplitDist = 0;
  let hr = 64;
  let hrSum = 0;
  let hrMs = 0;
  let hrMin = Infinity;
  let hrMax = 0;
  let drag = 125;
  let stroke: Stroke | null = null;
  let strokePhase: 'drive' | 'recovery' = 'drive';
  let phaseLeft = 0;
  let lastStroke: StrokeSample | null = null;
  let flawStreak: SimCurveFlaw = 'none';
  let loggedScheduled = false;
  const metrics: LiveMetrics = emptyMetrics();
  metrics.dragFactor = drag;
  const queue: Array<{ k: 'stroke'; v: StrokeSample } | { k: 'split'; v: SplitSummary } | { k: 'workoutEnd'; v: PmWorkoutSummary }> = [];

  function later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      pendingTimeouts.delete(t);
      if (!destroyed) fn();
    }, ms);
    pendingTimeouts.add(t);
  }

  function setConnection(next: ConnectionState): void {
    connection = next;
    events.emit('connection', next);
  }

  function seg(): Segment | null {
    return workout?.segments[segIdx] ?? null;
  }

  function segProgress(s: Segment): number {
    if (s.kind === 'distance') return segDist / s.value;
    if (s.kind === 'time') return segMs / s.value;
    if (s.kind === 'calorie') return segCal / s.value;
    return 0;
  }

  function newStroke(s: Segment): Stroke {
    const p = Math.min(1, segProgress(s));
    const fatigue = 0.03 * Math.min(1, workMs / 3600000) + (workout?.intervals ? 0.012 * p : 0);
    const startBoost = p < 0.04 && s.kind !== 'open' ? -0.025 : 0;
    const sprint = p > 0.9 && s.kind !== 'open' ? -0.03 : 0;
    const target = s.targetPace ?? workout!.basePace;
    const pace = Math.max(70000, target * (1 + fatigue + startBoost + sprint + gauss() * 0.011));
    const baseRate = s.targetRate ?? rateForPace(target);
    const rate = Math.max(14, Math.min(42, Math.round(baseRate + (sprint ? 3 : 0) + (startBoost ? 4 : 0) + gauss() * 0.6)));
    const period = 60000 / rate;
    const driveMs = Math.max(520, Math.min(1050, 1200 - rate * 13 + gauss() * 25));
    const recoveryMs = Math.max(350, period - driveMs);
    const speedMps = 500 / (pace / 1000);
    const watts = paceToWatts(pace);
    const lengthBase = machineType === 'skierg' ? 1.25 : machineType === 'bikeerg' ? 0.6 : 1.44;
    const driveLengthM = Math.max(0.4, lengthBase * (1 - fatigue * 0.5) + gauss() * 0.025);
    const workJ = (watts * (driveMs + recoveryMs)) / 1000;
    const avgForce = workJ / driveLengthM;
    // Flaws: occasional, a bit more frequent with fatigue; flaws tend to repeat for a few strokes.
    const flawChance = 0.16 + fatigue * 2;
    let flaw: SimCurveFlaw = 'none';
    if (flawStreak !== 'none' && rand() < 0.5) flaw = flawStreak;
    else if (rand() < flawChance) {
      const r = rand();
      flaw = r < 0.4 ? 'late-peak' : r < 0.7 ? 'soft-catch' : 'double-peak';
    }
    flawStreak = flaw;
    const points = Math.max(16, Math.min(50, Math.round(driveMs / 20)));
    return {
      pace,
      rate,
      driveMs,
      recoveryMs,
      speed: speedMps,
      watts,
      driveLengthM,
      workJ,
      curve: simForceCurve(points, avgForce, flaw, rand),
    };
  }

  function stepHr(dtMs: number, working: boolean, watts: number): void {
    const intensity = Math.max(0.15, Math.min(1.25, watts / 300));
    const fatigueBpm = Math.min(12, (workMs / 60000) * 0.35);
    const target = working ? Math.min(194, 72 + 112 * Math.pow(intensity, 0.8) + fatigueBpm) : 78 + fatigueBpm;
    const tau = target > hr ? 25000 : 40000;
    hr += (target - hr) * (1 - Math.exp(-dtMs / tau));
  }

  function makeSplit(s: Segment, restMs: number, restHr: number | null): SplitSummary {
    const acc = split;
    const type: IntervalType = s.splitKind ?? (s.kind === 'open' ? 'distance' : s.intervalType);
    const out: SplitSummary = {
      index: splitIndex,
      type,
      elapsedMs: workMs,
      distanceM: workDist,
      splitTimeMs: acc.ms,
      splitDistanceM: acc.dist,
      restTimeMs: restMs,
      restDistanceM: 0,
      avgPaceMsPer500: acc.dist > 0 ? (acc.ms / acc.dist) * 500 : 0,
      avgWatts: acc.ms > 0 ? acc.wattMs / acc.ms : 0,
      avgStrokeRate: acc.ms > 0 ? (acc.strokes * 60000) / acc.ms : 0,
      avgHeartRate: acc.hrMs > 0 ? Math.round(acc.hrSum / acc.hrMs) : null,
      restHeartRate: restHr,
      avgDragFactor: drag,
      calories: Math.round(acc.cal),
      strokeCount: acc.strokes,
    };
    splitIndex++;
    lastSplitTime = acc.ms;
    lastSplitDist = acc.dist;
    split = newSplit();
    return out;
  }

  function finishWorkout(): void {
    if (!workout) return;
    const s = seg() ?? workout.segments[workout.segments.length - 1]!;
    if (pendingIntervalSplit) {
      queue.push({ k: 'split', v: pendingIntervalSplit });
      pendingIntervalSplit = null;
    }
    if (split.ms > 0) queue.push({ k: 'split', v: makeSplit(s, 0, null) });
    const summary: PmWorkoutSummary = {
      endedAt: Date.now(),
      elapsedMs: workMs,
      distanceM: workDist,
      avgPaceMsPer500: workDist > 0 ? (workMs / workDist) * 500 : 0,
      avgWatts: workMs > 0 ? wattMs / workMs : 0,
      avgStrokeRate: workMs > 0 ? Math.round((strokeCount * 60000) / workMs) : 0,
      avgHeartRate: hrMs > 0 ? Math.round(hrSum / hrMs) : null,
      minHeartRate: Number.isFinite(hrMin) ? Math.round(hrMin) : null,
      maxHeartRate: hrMax > 0 ? Math.round(hrMax) : null,
      avgDragFactor: drag,
      calories: Math.round(workCal),
      strokeCount,
      workoutType: workout.workoutType,
      intervalCount: workout.intervals ? Math.min(workout.segments.length, segIdx + (phase === 'work' && segMs > 0 ? 1 : 0)) : splitIndex,
      totalRestMs,
    };
    queue.push({ k: 'workoutEnd', v: summary });
    phase = 'finished';
    workoutState = 'workout-end';
    stroke = null;
  }

  /** Segment finished at the current instant. */
  function endSegment(): void {
    const s = seg()!;
    const last = !workout!.repeat && segIdx >= workout!.segments.length - 1;
    if (workout!.intervals) {
      const restMs = last ? 0 : s.undefinedRest ? UNDEFINED_REST_MS : s.restMs;
      if (restMs > 0) {
        // Interval split is reported at the end of its rest, with rest data filled in.
        pendingIntervalSplit = makeSplit(s, restMs, null);
        restLeft = restMs;
        restTotal = restMs;
        phase = 'rest';
        workoutState = 'interval-rest';
        stroke = null;
        return;
      }
      queue.push({ k: 'split', v: makeSplit(s, 0, null) });
    } else if (split.ms > 0) {
      queue.push({ k: 'split', v: makeSplit(s, 0, null) });
    }
    if (last) {
      finishWorkout();
      return;
    }
    startNextSegment();
  }

  function startNextSegment(): void {
    if (workout!.repeat) workout!.segments.push(workout!.segments[0]!);
    segIdx++;
    segMs = 0;
    segDist = 0;
    segCal = 0;
    segSplitIdx = 0;
    phase = 'work';
    stroke = null;
    workoutState = workStateFor(seg()!);
  }

  function workStateFor(s: Segment): WorkoutState {
    if (!workout?.intervals) return 'workout-row';
    return s.kind === 'distance' ? 'interval-work-distance' : 'interval-work-time';
  }

  /** ms until `measure` reaches `goal` given current rates. */
  function timeTo(kind: MeasureKind, goal: number, cur: number, speedMps: number, calPerMs: number): number {
    const rem = goal - cur;
    if (rem <= EPS) return 0;
    if (kind === 'distance') return speedMps > 0 ? (rem / speedMps) * 1000 : Infinity;
    if (kind === 'time') return rem;
    if (kind === 'calorie') return calPerMs > 0 ? rem / calPerMs : Infinity;
    return Infinity;
  }

  function advance(dtTotal: number): void {
    let remaining = dtTotal;
    let guard = 0;
    while (remaining > EPS && guard++ < 100000) {
      if (phase === 'idle' || phase === 'finished') return;
      if (phase === 'countdown') {
        const step = Math.min(remaining, countdownLeft);
        countdownLeft -= step;
        remaining -= step;
        if (countdownLeft <= EPS) {
          phase = 'work';
          workoutState = workStateFor(seg()!);
        }
        continue;
      }
      if (phase === 'rest') {
        const step = Math.min(remaining, restLeft, SUBSTEP_MS);
        restLeft -= step;
        remaining -= step;
        elapsedMs += step;
        totalRestMs += step;
        stepHr(step, false, 0);
        if (restLeft <= EPS) {
          if (pendingIntervalSplit) {
            pendingIntervalSplit.restHeartRate = Math.round(hr);
            pendingIntervalSplit.restTimeMs = restTotal;
            queue.push({ k: 'split', v: pendingIntervalSplit });
            pendingIntervalSplit = null;
          }
          startNextSegment();
        }
        continue;
      }
      // work
      const s = seg()!;
      if (!stroke) {
        stroke = newStroke(s);
        strokePhase = 'drive';
        phaseLeft = stroke.driveMs;
      }
      const calPerMs = wattsToCalPerHour(stroke.watts) / 3_600_000;
      let step = Math.min(remaining, SUBSTEP_MS, phaseLeft);
      const tSeg = s.kind === 'open' ? Infinity : timeTo(s.kind, s.value, s.kind === 'distance' ? segDist : s.kind === 'time' ? segMs : segCal, stroke.speed, calPerMs);
      let tSplit = Infinity;
      if (s.splitKind) {
        const goal = Math.min((segSplitIdx + 1) * s.splitValue, s.kind === 'open' ? Infinity : s.value);
        const cur = s.splitKind === 'distance' ? segDist : s.splitKind === 'time' ? segMs : segCal;
        tSplit = timeTo(s.splitKind, goal, cur, stroke.speed, calPerMs);
      }
      step = Math.min(step, tSeg, tSplit);
      // integrate
      const dDist = (stroke.speed * step) / 1000;
      const dCal = calPerMs * step;
      segMs += step;
      segDist += dDist;
      segCal += dCal;
      workMs += step;
      workDist += dDist;
      workCal += dCal;
      elapsedMs += step;
      wattMs += stroke.watts * step;
      split.ms += step;
      split.dist += dDist;
      split.cal += dCal;
      split.wattMs += stroke.watts * step;
      stepHr(step, true, stroke.watts);
      split.hrSum += hr * step;
      split.hrMs += step;
      hrSum += hr * step;
      hrMs += step;
      if (workMs > 30000) {
        hrMin = Math.min(hrMin, hr);
      }
      hrMax = Math.max(hrMax, hr);
      phaseLeft -= step;
      remaining -= step;

      if (phaseLeft <= EPS) {
        if (strokePhase === 'drive') {
          emitStroke(stroke);
          strokePhase = 'recovery';
          phaseLeft = stroke.recoveryMs;
        } else {
          stroke = newStroke(s);
          strokePhase = 'drive';
          phaseLeft = stroke.driveMs;
        }
      }
      // Snap to exact boundaries to avoid float drift.
      if (tSeg <= step + EPS && s.kind !== 'open') {
        snap(s);
        endSegment();
        continue;
      }
      if (tSplit <= step + EPS && s.splitKind) {
        segSplitIdx++;
        queue.push({ k: 'split', v: makeSplit(s, 0, null) });
      }
    }
  }

  function snap(s: Segment): void {
    if (s.kind === 'distance') {
      const d = s.value - segDist;
      segDist += d;
      workDist += d;
      split.dist += d;
    } else if (s.kind === 'time') {
      const d = s.value - segMs;
      segMs += d;
      workMs += d;
      split.ms += d;
      elapsedMs += d;
    }
  }

  function emitStroke(st: Stroke): void {
    strokeCount++;
    split.strokes++;
    const peak = Math.max(...st.curve);
    const avg = st.curve.reduce((a, b) => a + b, 0) / st.curve.length;
    if (rand() < 0.02) drag = 125 + Math.round(gauss());
    const sample: StrokeSample = {
      strokeNumber: strokeCount,
      elapsedMs,
      distanceM: workDist,
      paceMsPer500: Math.round(st.pace),
      watts: Math.round(st.watts),
      strokeRate: st.rate,
      heartRate: Math.round(hr),
      driveLengthM: Math.round(st.driveLengthM * 100) / 100,
      driveTimeMs: Math.round(st.driveMs),
      recoveryTimeMs: Math.round(st.recoveryMs),
      strokeDistanceM: Math.round(((st.speed * (st.driveMs + st.recoveryMs)) / 1000) * 100) / 100,
      peakForceN: Math.round(peak * 10) / 10,
      avgForceN: Math.round(avg * 10) / 10,
      workPerStrokeJ: Math.round(st.workJ * 10) / 10,
      intervalCount: workout?.intervals ? segIdx : splitIndex,
      forceCurve: st.curve,
    };
    lastStroke = sample;
    queue.push({ k: 'stroke', v: sample });
  }

  function refreshMetrics(): void {
    const m = metrics;
    const s = seg();
    const rowing = phase === 'work' && !!stroke;
    m.timestamp = Date.now();
    m.elapsedMs = Math.round(elapsedMs);
    m.distanceM = Math.round(workDist * 10) / 10;
    m.paceMsPer500 = rowing ? Math.round(stroke!.pace) : 0;
    m.avgPaceMsPer500 = workDist > 1 ? Math.round((workMs / workDist) * 500) : 0;
    m.watts = rowing ? Math.round(stroke!.watts) : 0;
    m.avgWatts = workMs > 0 ? Math.round(wattMs / workMs) : 0;
    m.strokeRate = rowing ? stroke!.rate : 0;
    m.avgStrokeRate = workMs > 0 ? Math.round((strokeCount * 600000) / workMs) / 10 : 0;
    m.heartRate = connection.status === 'connected' ? Math.round(hr) : null;
    m.calories = Math.round(workCal);
    m.caloriesPerHour = rowing ? Math.round(wattsToCalPerHour(stroke!.watts)) : 0;
    m.speedMps = rowing ? Math.round(stroke!.speed * 1000) / 1000 : 0;
    m.dragFactor = drag;
    m.strokeCount = strokeCount;
    if (lastStroke) {
      m.driveLengthM = lastStroke.driveLengthM;
      m.driveTimeMs = lastStroke.driveTimeMs;
      m.recoveryTimeMs = lastStroke.recoveryTimeMs;
      m.strokeDistanceM = lastStroke.strokeDistanceM;
      m.peakForceN = lastStroke.peakForceN;
      m.avgForceN = lastStroke.avgForceN;
      m.workPerStrokeJ = lastStroke.workPerStrokeJ;
    }
    m.workoutState = workoutState;
    m.rowingState = rowing ? 'active' : 'inactive';
    m.strokeState = rowing ? (strokePhase === 'drive' ? 'driving' : 'recovery') : 'waiting-for-wheel-to-reach-min-speed';
    m.workoutType = workout?.workoutType ?? 'just-row-no-splits';
    m.intervalType = phase === 'rest' ? (s?.undefinedRest ? 'rest-undefined' : 'rest') : s ? (workout?.intervals ? s.intervalType : s.splitKind ?? 'none') : 'none';
    m.intervalCount = workout?.intervals ? segIdx : splitIndex;
    m.restTimeRemainingMs = phase === 'rest' ? Math.round(restLeft) : 0;
    m.restDistanceM = 0;
    const avgSpeed = workMs > 0 ? workDist / (workMs / 1000) : 0;
    if (s && s.kind === 'distance' && avgSpeed > 0) {
      m.projectedWorkTimeMs = Math.round(workMs + ((s.value - segDist) / avgSpeed) * 1000);
      m.projectedWorkDistanceM = workout?.intervals ? 0 : s.value;
    } else if (s && s.kind === 'time' && avgSpeed > 0) {
      m.projectedWorkDistanceM = Math.round(workDist + (avgSpeed * (s.value - segMs)) / 1000);
      m.projectedWorkTimeMs = workout?.intervals ? 0 : s.value;
    } else {
      m.projectedWorkTimeMs = 0;
      m.projectedWorkDistanceM = 0;
    }
    m.splitAvgPaceMsPer500 = split.dist > 1 ? Math.round((split.ms / split.dist) * 500) : 0;
    m.splitAvgWatts = split.ms > 0 ? Math.round(split.wattMs / split.ms) : 0;
    m.splitAvgCalPerHour = m.splitAvgWatts > 0 ? Math.round(wattsToCalPerHour(m.splitAvgWatts)) : 0;
    m.lastSplitTimeMs = Math.round(lastSplitTime);
    m.lastSplitDistanceM = Math.round(lastSplitDist);
    m.workoutDurationMs = s?.kind === 'time' ? s.value : 0;
    m.workoutDistanceM = s?.kind === 'distance' ? s.value : 0;
  }

  function tick(): void {
    if (connection.status !== 'connected') return;
    advance(tickMs * speed);
    if (phase === 'finished' && workoutState === 'workout-end' && !loggedScheduled) {
      loggedScheduled = true;
      later(() => {
        if (phase === 'finished') workoutState = 'workout-logged';
      }, Math.max(50, 1000 / speed));
    }
    const out = queue.splice(0);
    for (const e of out) {
      if (e.k === 'stroke') events.emit('stroke', e.v);
      else if (e.k === 'split') events.emit('split', e.v);
      else events.emit('workoutEnd', e.v);
    }
    refreshMetrics();
    events.emit('metrics', { ...metrics });
  }

  function startTimer(): void {
    if (!timer && !destroyed) timer = setInterval(tick, tickMs);
  }
  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function resetWorkoutState(): void {
    loggedScheduled = false;
    phase = 'idle';
    workoutState = 'waiting-to-begin';
    segIdx = 0;
    segMs = segDist = segCal = 0;
    segSplitIdx = 0;
    restLeft = restTotal = totalRestMs = 0;
    elapsedMs = workMs = workDist = workCal = wattMs = 0;
    strokeCount = 0;
    splitIndex = 0;
    split = newSplit();
    pendingIntervalSplit = null;
    lastSplitTime = lastSplitDist = 0;
    hrSum = hrMs = 0;
    hrMin = Infinity;
    hrMax = 0;
    stroke = null;
    lastStroke = null;
    queue.length = 0;
  }

  return {
    kind: 'simulator',
    async prepare() {
      return { ok: true };
    },
    async scan(onFound) {
      if (connection.status !== 'connected') setConnection({ status: 'scanning', device: null });
      let active = true;
      later(() => {
        if (active) onFound({ ...SIM_ERG });
      }, 250);
      return () => {
        active = false;
        if (connection.status === 'scanning') setConnection({ status: 'idle', device: null });
      };
    },
    connect(id: string) {
      return new Promise<ErgInfo>((resolve, reject) => {
        if (destroyed) return reject(new Error('Simulator destroyed'));
        if (id !== SIM_ERG.id) return reject(new Error(`Unknown simulated erg ${id}`));
        if (connection.status === 'connected') return resolve({ ...info });
        setConnection({ status: 'connecting', device: null });
        later(() => {
          setConnection({ status: 'connected', device: { ...info } });
          startTimer();
          resolve({ ...info });
        }, 300);
      });
    },
    async disconnect() {
      stopTimer();
      if (connection.status !== 'idle' && connection.status !== 'disconnected') setConnection({ status: 'disconnected', device: null });
    },
    getConnectionState() {
      return connection;
    },
    on<K extends keyof ErgEvents>(event: K, cb: (payload: ErgEvents[K]) => void): Unsubscribe {
      return events.on(event, cb);
    },
    async programWorkout(plan: WorkoutPlan) {
      if (connection.status !== 'connected') throw new Error('Simulated PM5 is not connected');
      resetWorkoutState();
      workout = buildWorkout(plan, basePaceDefault);
      phase = 'countdown';
      countdownLeft = plan.kind === 'just-row' ? Math.min(countdownMs, 1500) : countdownMs;
      workoutState = 'waiting-to-begin';
      refreshMetrics();
      events.emit('metrics', { ...metrics });
    },
    async terminateWorkout() {
      if (phase === 'work' || phase === 'rest' || phase === 'countdown') {
        if (workMs > 0) finishWorkout();
        const out = queue.splice(0);
        for (const e of out) {
          if (e.k === 'stroke') events.emit('stroke', e.v);
          else if (e.k === 'split') events.emit('split', e.v);
          else events.emit('workoutEnd', e.v);
        }
      }
      phase = 'idle';
      workoutState = 'waiting-to-begin';
      stroke = null;
      refreshMetrics();
      events.emit('metrics', { ...metrics });
    },
    destroy() {
      destroyed = true;
      stopTimer();
      for (const t of pendingTimeouts) clearTimeout(t);
      pendingTimeouts.clear();
      events.clear();
      connection = { status: 'idle', device: null };
    },
    setSpeed(n: number) {
      speed = Math.max(0.1, n);
    },
  };
}
