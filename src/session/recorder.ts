/** Pure workout recorder: accumulates live data into a WorkoutRecord. */
import type {
  CoxCall,
  HeartRatePoint,
  LiveMetrics,
  MachineType,
  PmWorkoutSummary,
  PmWorkoutType,
  SplitSummary,
  StrokeSample,
  WorkoutPlan,
  WorkoutRecord,
} from '@/core/types';
import { formatDuration, mean, paceFromTimeDistance, paceToWatts, uid } from '@/core/units';
import { isIntervalRecord } from '@/storage/formats';
import { strokeTimeline } from '@/storage/timeline';

const GAP_MS = 4000;

export type TitleFn = (args: {
  plan: WorkoutPlan | null;
  workoutType: PmWorkoutType;
  distanceM: number;
  elapsedMs: number;
  splits: SplitSummary[];
}) => string;

export const fallbackTitle: TitleFn = ({ plan, distanceM, elapsedMs }) =>
  plan?.name || (distanceM > 0 ? `${Math.round(distanceM)}m` : formatDuration(elapsedMs, { tenths: false }));

function workoutTypeForPlan(plan: WorkoutPlan | null): PmWorkoutType {
  switch (plan?.kind) {
    case 'single-distance': return plan.splitValue ? 'fixed-distance-splits' : 'fixed-distance-no-splits';
    case 'single-time': return plan.splitValue ? 'fixed-time-splits' : 'fixed-time-no-splits';
    case 'single-calorie': return 'fixed-calorie';
    case 'intervals': return 'variable-interval';
    case 'just-row': return 'just-row-splits';
    default: return 'unknown';
  }
}

export interface RecorderInit {
  plan: WorkoutPlan | null;
  startedAt?: number;
  machineType?: MachineType;
  ergName?: string;
  ergSerial?: string;
  simulated?: boolean;
}

export class WorkoutRecorder {
  id = uid('w_');
  startedAt: number;
  readonly strokes: StrokeSample[] = [];
  readonly heartRate: HeartRatePoint[] = [];
  readonly coxCalls: CoxCall[] = [];
  summary: PmWorkoutSummary | null = null;
  private splitMap = new Map<number, SplitSummary>();
  private strokeKeys = new Set<string>();
  private startFixed = false;
  private workoutType: PmWorkoutType = 'unknown';
  private maxCalories = 0;
  private dragSum = 0;
  private dragN = 0;
  private lastMetrics: LiveMetrics | null = null;
  /** Stretches where the app was closed mid-piece, so strokes are missing (PM elapsed ms). */
  readonly gaps: { fromMs: number; toMs: number }[] = [];
  private gapCheck = false;

  constructor(readonly init: RecorderInit) {
    this.startedAt = init.startedAt ?? Date.now();
  }

  get started(): boolean {
    return this.strokes.length > 0;
  }

  get splits(): SplitSummary[] {
    return [...this.splitMap.values()].sort((a, b) => a.index - b.index);
  }

  /** Returns false for duplicates (same interval + stroke number, or identical to the last one). */
  addStroke(s: StrokeSample, now = Date.now()): boolean {
    const key = `${s.intervalCount}:${s.strokeNumber}`;
    const last = this.strokes[this.strokes.length - 1];
    if (this.strokeKeys.has(key)) return false;
    if (last && last.elapsedMs === s.elapsedMs && last.distanceM === s.distanceM && last.intervalCount === s.intervalCount) return false;
    if (this.gapCheck && last) {
      // Strokes rowed while the app was closed never reached us; the PM keeps no per-stroke history over BLE.
      if (s.intervalCount !== last.intervalCount || s.elapsedMs - last.elapsedMs > GAP_MS) this.gaps.push({ fromMs: last.elapsedMs, toMs: s.elapsedMs });
      this.gapCheck = false;
    }
    this.strokeKeys.add(key);
    if (!this.startFixed) {
      // Anchor start to the PM clock rather than the moment the app armed.
      this.startedAt = now - Math.max(0, s.elapsedMs);
      this.startFixed = true;
    }
    this.strokes.push(s);
    if (s.heartRate) this.addHeartRate(s.elapsedMs, s.heartRate);
    return true;
  }

  /** Continue a recording from a snapshot taken before the app closed. */
  restore(snap: { recId: string; startedAt: number; strokes: StrokeSample[]; splits: SplitSummary[]; heartRate: HeartRatePoint[]; coxCalls: CoxCall[] }): void {
    this.id = snap.recId;
    this.startedAt = snap.startedAt;
    this.startFixed = true;
    snap.strokes.forEach((s) => {
      this.strokeKeys.add(`${s.intervalCount}:${s.strokeNumber}`);
      this.strokes.push(s);
    });
    snap.splits.forEach((s) => this.addSplit(s));
    this.heartRate.push(...snap.heartRate);
    this.coxCalls.push(...snap.coxCalls);
    this.gapCheck = snap.strokes.length > 0;
  }

  /** Later reports of the same split index replace earlier ones. */
  addSplit(s: SplitSummary): void {
    this.splitMap.set(s.index, s);
  }

  addHeartRate(elapsedMs: number, bpm: number): void {
    if (!(bpm > 0)) return;
    const last = this.heartRate[this.heartRate.length - 1];
    if (last && elapsedMs >= last.elapsedMs && elapsedMs - last.elapsedMs < 1000) return;
    this.heartRate.push({ elapsedMs, bpm });
  }

  addCoxCall(c: CoxCall): void {
    this.coxCalls.push(c);
  }

  noteMetrics(m: LiveMetrics): void {
    this.lastMetrics = m;
    if (m.workoutType !== 'unknown') this.workoutType = m.workoutType;
    if (m.calories > this.maxCalories) this.maxCalories = m.calories;
    if (m.dragFactor > 0) {
      this.dragSum += m.dragFactor;
      this.dragN++;
    }
    if (m.heartRate) this.addHeartRate(m.elapsedMs, m.heartRate);
  }

  setSummary(s: PmWorkoutSummary): void {
    this.summary = s;
  }

  /** Work-only totals; PM summary values win where present and non-zero. */
  totals() {
    const splits = this.splits;
    const strokes = this.strokes;
    const tl = strokeTimeline(strokes, splits);
    const end = tl[tl.length - 1];
    const workoutType = this.summary?.workoutType && this.summary.workoutType !== 'unknown'
      ? this.summary.workoutType
      : this.workoutType !== 'unknown' ? this.workoutType : workoutTypeForPlan(this.init.plan);
    const intervals = isIntervalRecord({ workoutType, strokes, splits });

    let distanceM = Math.max(end?.d ?? 0, splits.reduce((a, s) => a + s.splitDistanceM, 0));
    let elapsedMs = Math.max(end?.w ?? 0, splits.reduce((a, s) => a + s.splitTimeMs, 0));
    const lm = this.lastMetrics;
    if (!intervals && lm) {
      distanceM = Math.max(distanceM, lm.distanceM);
      elapsedMs = Math.max(elapsedMs, lm.elapsedMs);
    }
    const hrs = this.heartRate.map((p) => p.bpm);
    const splitHrs = splits.map((s) => s.avgHeartRate).filter((h): h is number => h != null && h > 0);
    const derived = {
      workoutType,
      elapsedMs,
      distanceM,
      avgPaceMsPer500: paceFromTimeDistance(elapsedMs, distanceM),
      avgWatts: 0,
      avgStrokeRate: mean(strokes.map((s) => s.strokeRate).filter((r) => r > 0)),
      avgHeartRate: hrs.length ? Math.round(mean(hrs)) : splitHrs.length ? Math.round(mean(splitHrs)) : null,
      maxHeartRate: hrs.length ? Math.max(...hrs) : null,
      calories: Math.max(this.maxCalories, splits.reduce((a, s) => a + s.calories, 0)),
      strokeCount: Math.max(strokes.length, splits.reduce((a, s) => a + s.strokeCount, 0)),
      avgDragFactor: this.dragN
        ? Math.round(this.dragSum / this.dragN)
        : Math.round(mean(splits.map((s) => s.avgDragFactor).filter((d) => d > 0))),
      totalRestMs: splits.reduce((a, s) => a + s.restTimeMs, 0),
    };
    derived.avgWatts = mean(strokes.map((s) => s.watts).filter((w) => w > 0)) || paceToWatts(derived.avgPaceMsPer500);

    const s = this.summary;
    if (!s) return derived;
    const pos = (v: number, d: number) => (v > 0 ? v : d);
    return {
      workoutType,
      elapsedMs: pos(s.elapsedMs, derived.elapsedMs),
      distanceM: pos(s.distanceM, derived.distanceM),
      avgPaceMsPer500: pos(s.avgPaceMsPer500, derived.avgPaceMsPer500),
      avgWatts: pos(s.avgWatts, derived.avgWatts),
      avgStrokeRate: pos(s.avgStrokeRate, derived.avgStrokeRate),
      avgHeartRate: s.avgHeartRate ?? derived.avgHeartRate,
      maxHeartRate: s.maxHeartRate ?? derived.maxHeartRate,
      calories: pos(s.calories, derived.calories),
      strokeCount: pos(s.strokeCount, derived.strokeCount),
      avgDragFactor: pos(s.avgDragFactor, derived.avgDragFactor),
      totalRestMs: pos(s.totalRestMs, derived.totalRestMs),
    };
  }

  isWorthSaving(): boolean {
    const t = this.totals();
    return this.strokes.length > 0 || t.distanceM > 0;
  }

  build(opts: { title?: TitleFn; endedAt?: number } = {}): WorkoutRecord {
    const t = this.totals();
    const splits = this.splits;
    const plan = this.init.plan;
    let title: string;
    try {
      title = (opts.title ?? fallbackTitle)({ plan, workoutType: t.workoutType, distanceM: t.distanceM, elapsedMs: t.elapsedMs, splits });
    } catch {
      title = fallbackTitle({ plan, workoutType: t.workoutType, distanceM: t.distanceM, elapsedMs: t.elapsedMs, splits });
    }
    const record: WorkoutRecord = {
      id: this.id,
      startedAt: this.startedAt,
      endedAt: opts.endedAt ?? this.summary?.endedAt ?? Date.now(),
      machineType: this.init.machineType ?? 'rower',
      plan,
      title,
      ...t,
      splits,
      strokes: [...this.strokes],
      heartRate: [...this.heartRate],
      coxCalls: [...this.coxCalls],
      simulated: !!this.init.simulated,
      verified: !!this.summary,
    };
    if (this.init.ergName) record.ergName = this.init.ergName;
    if (this.init.ergSerial) record.ergSerial = this.init.ergSerial;
    if (this.gaps.length) {
      record.tags = ['data-gap'];
      record.notes = `Strokes missing: the app was closed during this piece (${this.gaps.map((g) => `${formatDuration(g.fromMs, { tenths: false })}-${formatDuration(g.toMs, { tenths: false })}`).join(', ')}). Totals come from the PM5.`;
    }
    return record;
  }
}
