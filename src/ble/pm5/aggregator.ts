/**
 * Pure state machine that merges PM5 packets into one LiveMetrics snapshot and derives
 * per-stroke, per-split and end-of-workout events. No timers: the caller passes `now`
 * and calls `tick(now)` periodically to flush events that wait for companion packets.
 */
import type { LiveMetrics, PmWorkoutSummary, SplitSummary, StrokeSample } from '@/core/types';
import { emptyMetrics } from '@/core/defaults';
import {
  ForceCurveReassembler,
  type AdditionalSplitData,
  type AdditionalWorkoutSummary,
  type AdditionalWorkoutSummary2,
  type Pm5Packet,
  type SplitData,
  type WorkoutSummary,
} from './parsers';

export type AggregatorEvent =
  | { type: 'stroke'; stroke: StrokeSample }
  | { type: 'split'; split: SplitSummary }
  | { type: 'workoutEnd'; summary: PmWorkoutSummary };

/** How long to wait for a companion packet before emitting with what we have. */
const STROKE_WAIT_MS = 1200;
/** Once the PM has sent any curve, a stroke waits this long for its own (the next stroke flushes it anyway). */
const CURVE_WAIT_MS = 3000;
const SPLIT_WAIT_MS = 1500;
const SUMMARY_WAIT_MS = 1500;
/** A completed curve this recent can be attached to a stroke that shows up after it. */
const CURVE_MATCH_MS = 1500;

interface PendingStroke {
  sample: StrokeSample;
  createdAt: number;
  hasPower: boolean;
  hasCurve: boolean;
  peakForceN: number;
}

export class Pm5Aggregator {
  private m: LiveMetrics = emptyMetrics();
  private dirty = false;
  private reassembler = new ForceCurveReassembler();
  private pendingStroke: PendingStroke | null = null;
  private lastEmittedStroke = -1;
  private lastCurve: { words: number[]; at: number } | null = null;
  private curvesSeen = false;
  private pendingSplit: { a: SplitData | null; b: AdditionalSplitData | null; at: number; number: number } | null = null;
  private emittedSplits = new Set<number>();
  private splitStrokeBase = 0;
  private pendingSummary: {
    a: WorkoutSummary | null;
    b: AdditionalWorkoutSummary | null;
    c: AdditionalWorkoutSummary2 | null;
    at: number;
    key: string;
  } | null = null;
  private emittedSummaries = new Set<string>();
  private newPiece = false;
  private machineTypeRaw: number | null = null;

  get metrics(): LiveMetrics {
    return this.m;
  }

  /** Erg machine type enum last seen in status packets (null if none). */
  get machineType(): number | null {
    return this.machineTypeRaw;
  }

  /** True if metrics changed since the last call; clears the flag. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Resets per-workout bookkeeping (keeps the latest metrics). */
  resetWorkout(): void {
    this.newPiece = true;
    this.pendingStroke = null;
    this.lastEmittedStroke = -1;
    this.pendingSplit = null;
    this.emittedSplits.clear();
    this.splitStrokeBase = 0;
    this.pendingSummary = null;
    this.reassembler.reset();
    this.lastCurve = null;
  }

  apply(p: Pm5Packet, now: number): AggregatorEvent[] {
    const out: AggregatorEvent[] = [];
    const m = this.m;
    m.timestamp = now;
    this.dirty = true;
    switch (p.kind) {
      case 'generalStatus': {
        const wasEnded = m.workoutState === 'workout-end' || m.workoutState === 'workout-logged' || m.workoutState === 'terminate';
        m.elapsedMs = p.elapsedMs;
        m.distanceM = p.distanceM;
        m.workoutType = p.workoutType;
        m.intervalType = p.intervalType;
        m.workoutState = p.workoutState;
        m.rowingState = p.rowingState;
        m.strokeState = p.strokeState;
        m.dragFactor = p.dragFactor;
        m.workoutDurationMs = p.workoutDurationMs;
        m.workoutDistanceM = p.workoutDistanceM;
        // A new workout began (PM back to waiting / rowing from 0 after an end).
        if (wasEnded && (p.workoutState === 'waiting-to-begin' || p.workoutState === 'workout-row') && p.elapsedMs < 2000) {
          this.resetWorkout();
        }
        break;
      }
      case 'additionalStatus':
        m.elapsedMs = Math.max(m.elapsedMs, p.elapsedMs);
        m.speedMps = p.speedMps;
        m.strokeRate = p.strokeRate;
        m.heartRate = p.heartRate;
        m.paceMsPer500 = p.paceMsPer500;
        m.avgPaceMsPer500 = p.avgPaceMsPer500;
        m.restDistanceM = p.restDistanceM;
        m.restTimeRemainingMs = p.restTimeMs;
        if (p.avgWatts !== null) m.avgWatts = p.avgWatts;
        if (p.machineType !== null) this.machineTypeRaw = p.machineType;
        break;
      case 'additionalStatus2':
        m.intervalCount = p.intervalCount;
        if (p.avgWatts !== null) m.avgWatts = p.avgWatts;
        m.calories = p.calories;
        m.splitAvgPaceMsPer500 = p.splitAvgPaceMsPer500;
        m.splitAvgWatts = p.splitAvgWatts;
        m.splitAvgCalPerHour = p.splitAvgCalPerHour;
        m.lastSplitTimeMs = p.lastSplitTimeMs;
        m.lastSplitDistanceM = p.lastSplitDistanceM;
        break;
      case 'strokeData': {
        m.distanceM = p.distanceM;
        m.driveLengthM = p.driveLengthM;
        m.driveTimeMs = p.driveTimeMs;
        m.recoveryTimeMs = p.recoveryTimeMs;
        m.strokeDistanceM = p.strokeDistanceM;
        m.peakForceN = p.peakForceN;
        m.avgForceN = p.avgForceN;
        if (p.workPerStrokeJ !== null) m.workPerStrokeJ = p.workPerStrokeJ;
        m.strokeCount = p.strokeCount;
        if (m.elapsedMs > 0) m.avgStrokeRate = Math.round((p.strokeCount * 600000) / m.elapsedMs) / 10;
        if (p.strokeCount === this.pendingStroke?.sample.strokeNumber) {
          // Repeated stroke packet (PM may resend): refresh mechanics.
          Object.assign(this.pendingStroke.sample, this.mechanics(p));
          this.pendingStroke.peakForceN = p.peakForceN;
          break;
        }
        // Stroke counter restarted (new workout).
        if (p.strokeCount < this.lastEmittedStroke && p.strokeCount <= 2) this.lastEmittedStroke = -1;
        if (p.strokeCount <= this.lastEmittedStroke) break;
        this.flushStroke(out);
        const sample: StrokeSample = {
          strokeNumber: p.strokeCount,
          elapsedMs: p.elapsedMs,
          distanceM: p.distanceM,
          paceMsPer500: m.paceMsPer500,
          watts: m.watts,
          strokeRate: m.strokeRate,
          heartRate: m.heartRate,
          ...this.mechanics(p),
          workPerStrokeJ: p.workPerStrokeJ ?? 0,
          intervalCount: m.intervalCount,
          forceCurve: [],
        };
        this.pendingStroke = { sample, createdAt: now, hasPower: false, hasCurve: false, peakForceN: p.peakForceN };
        if (this.lastCurve && now - this.lastCurve.at <= CURVE_MATCH_MS) {
          sample.forceCurve = ForceCurveReassembler.toNewtons(this.lastCurve.words, p.peakForceN);
          this.pendingStroke.hasCurve = true;
          this.lastCurve = null;
        }
        break;
      }
      case 'additionalStrokeData': {
        m.watts = p.watts;
        m.caloriesPerHour = p.caloriesPerHour;
        m.projectedWorkTimeMs = p.projectedWorkTimeMs;
        m.projectedWorkDistanceM = p.projectedWorkDistanceM;
        if (p.workPerStrokeJ !== null) m.workPerStrokeJ = p.workPerStrokeJ;
        const ps = this.pendingStroke;
        if (ps && ps.sample.strokeNumber === p.strokeCount) {
          ps.sample.watts = p.watts;
          if (p.workPerStrokeJ !== null) ps.sample.workPerStrokeJ = p.workPerStrokeJ;
          ps.hasPower = true;
        }
        break;
      }
      case 'forceCurveFragment': {
        this.dirty = false;
        const words = this.reassembler.push(p);
        if (!words?.length) break;
        this.curvesSeen = true;
        const ps = this.pendingStroke;
        if (ps && !ps.hasCurve) {
          ps.sample.forceCurve = ForceCurveReassembler.toNewtons(words, ps.peakForceN);
          ps.hasCurve = true;
        } else {
          this.lastCurve = { words, at: now };
        }
        break;
      }
      case 'splitData':
      case 'additionalSplitData':
        this.onSplitPacket(p, now, out);
        break;
      case 'workoutSummary':
      case 'additionalWorkoutSummary':
      case 'additionalWorkoutSummary2':
        this.onSummaryPacket(p, now, out);
        break;
      case 'heartRateBeltInfo':
        this.dirty = false;
        break;
    }
    if (this.pendingStroke?.hasPower && this.pendingStroke.hasCurve) this.flushStroke(out);
    this.tickInto(now, out);
    return out;
  }

  /** Flushes events whose companion packets never arrived. */
  tick(now: number): AggregatorEvent[] {
    const out: AggregatorEvent[] = [];
    this.tickInto(now, out);
    return out;
  }

  private tickInto(now: number, out: AggregatorEvent[]): void {
    const ps = this.pendingStroke;
    const wait = this.curvesSeen && !ps?.hasCurve ? CURVE_WAIT_MS : STROKE_WAIT_MS;
    if (ps && now - ps.createdAt >= wait) this.flushStroke(out);
    if (this.pendingSplit && now - this.pendingSplit.at >= SPLIT_WAIT_MS) this.flushSplit(out);
    if (this.pendingSummary && now - this.pendingSummary.at >= SUMMARY_WAIT_MS) this.flushSummary(out, now);
  }

  private mechanics(p: { driveLengthM: number; driveTimeMs: number; recoveryTimeMs: number; strokeDistanceM: number; peakForceN: number; avgForceN: number }) {
    return {
      driveLengthM: p.driveLengthM,
      driveTimeMs: p.driveTimeMs,
      recoveryTimeMs: p.recoveryTimeMs,
      strokeDistanceM: p.strokeDistanceM,
      peakForceN: p.peakForceN,
      avgForceN: p.avgForceN,
    };
  }

  private flushStroke(out: AggregatorEvent[]): void {
    const ps = this.pendingStroke;
    if (!ps) return;
    this.pendingStroke = null;
    if (!ps.hasPower) ps.sample.watts = this.m.watts;
    this.lastEmittedStroke = ps.sample.strokeNumber;
    // A new piece has started rowing: summaries keyed by log minute must not block its own summary.
    if (this.newPiece) {
      this.newPiece = false;
      this.emittedSummaries.clear();
    }
    out.push({ type: 'stroke', stroke: ps.sample });
  }

  private onSplitPacket(p: SplitData | AdditionalSplitData, now: number, out: AggregatorEvent[]): void {
    if (this.emittedSplits.has(p.splitNumber)) return;
    if (this.pendingSplit && this.pendingSplit.number !== p.splitNumber) this.flushSplit(out);
    if (!this.pendingSplit) this.pendingSplit = { a: null, b: null, at: now, number: p.splitNumber };
    if (p.kind === 'splitData') this.pendingSplit.a = p;
    else this.pendingSplit.b = p;
    if (this.pendingSplit.a && this.pendingSplit.b) this.flushSplit(out);
  }

  private flushSplit(out: AggregatorEvent[]): void {
    const ps = this.pendingSplit;
    this.pendingSplit = null;
    if (!ps || !ps.a) return; // the split time/distance packet is mandatory
    const a = ps.a;
    const b = ps.b;
    this.emittedSplits.add(ps.number);
    const strokeCount = Math.max(0, this.m.strokeCount - this.splitStrokeBase);
    this.splitStrokeBase = this.m.strokeCount;
    const pace = b?.avgPaceMsPer500 || (a.splitDistanceM > 0 ? (a.splitTimeMs / a.splitDistanceM) * 500 : 0);
    out.push({
      type: 'split',
      split: {
        index: Math.max(0, ps.number - 1),
        type: a.intervalType,
        elapsedMs: a.elapsedMs,
        distanceM: a.distanceM,
        splitTimeMs: a.splitTimeMs,
        splitDistanceM: a.splitDistanceM,
        restTimeMs: a.restTimeMs,
        restDistanceM: a.restDistanceM,
        avgPaceMsPer500: pace,
        avgWatts: b?.watts ?? 0,
        avgStrokeRate: b?.avgStrokeRate ?? (a.splitTimeMs > 0 ? (strokeCount * 60000) / a.splitTimeMs : 0),
        avgHeartRate: b?.workHeartRate ?? null,
        restHeartRate: b?.restHeartRate ?? null,
        avgDragFactor: b?.avgDragFactor ?? this.m.dragFactor,
        calories: b?.calories ?? 0,
        strokeCount,
      },
    });
  }

  private onSummaryPacket(
    p: WorkoutSummary | AdditionalWorkoutSummary | AdditionalWorkoutSummary2,
    now: number,
    out: AggregatorEvent[],
  ): void {
    const key = `${p.logDate}:${p.logTime}`;
    if (this.emittedSummaries.has(key)) return; // e.g. the revised summary with recovery HR
    if (this.pendingSummary && this.pendingSummary.key !== key) this.flushSummary(out, now);
    if (!this.pendingSummary) this.pendingSummary = { a: null, b: null, c: null, at: now, key };
    if (p.kind === 'workoutSummary') this.pendingSummary.a = p;
    else if (p.kind === 'additionalWorkoutSummary') this.pendingSummary.b = p;
    else this.pendingSummary.c = p;
    const s = this.pendingSummary;
    if (s.a && s.b && (s.a.avgPaceMsPer500 !== null || s.c)) this.flushSummary(out, now);
  }

  private flushSummary(out: AggregatorEvent[], now: number): void {
    const s = this.pendingSummary;
    this.pendingSummary = null;
    if (!s || !s.a) return;
    // Pending split/stroke belong before the summary.
    this.flushStroke(out);
    this.flushSplit(out);
    this.emittedSummaries.add(s.key);
    const a = s.a;
    const b = s.b;
    const pace =
      a.avgPaceMsPer500 || s.c?.avgPaceMsPer500 || (a.distanceM > 0 ? (a.elapsedMs / a.distanceM) * 500 : 0);
    out.push({
      type: 'workoutEnd',
      summary: {
        endedAt: now,
        elapsedMs: a.elapsedMs,
        distanceM: a.distanceM,
        avgPaceMsPer500: pace,
        avgWatts: b?.watts ?? this.m.avgWatts,
        avgStrokeRate: a.avgStrokeRate,
        avgHeartRate: a.avgHeartRate,
        minHeartRate: a.minHeartRate,
        maxHeartRate: a.maxHeartRate,
        avgDragFactor: a.avgDragFactor,
        calories: b?.calories ?? this.m.calories,
        strokeCount: this.m.strokeCount,
        workoutType: a.workoutType,
        intervalCount: b?.splitCount ?? 0,
        totalRestMs: b?.restTimeMs ?? 0,
      },
    });
  }
}
