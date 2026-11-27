/**
 * The built-in coxswain: a pure rules engine. Driven only by onMetrics / onStroke / onSplit /
 * onWorkoutEnd, uses the workout elapsedMs as its clock and an injectable RNG for phrase choice,
 * so a scripted session always produces the same calls.
 */
import type {
  AthleteProfile,
  CoxCall,
  CoxCallCategory,
  CoxFrequency,
  CoxPersonality,
  CoxswainSettings,
  ForceCurveAnalysis,
  IntervalDef,
  LiveMetrics,
  PmWorkoutSummary,
  SplitSummary,
  StrokeSample,
  TechniqueFlag,
  Unsubscribe,
  WorkoutPlan,
} from '@/core/types';
import { mean } from '@/core/units';
import { recoveryRatioBounds } from '@/analysis/forceCurve';
import { segmentLookup } from '@/workouts/segments';
import { segmentAt } from './pacePlan';
import { PhraseBook, type PhraseKey } from './phrases';
import { CallScheduler } from './scheduler';
import { numberWords, speakClock, speakDuration, speakMetres, speakPace, speakSeconds } from './speech';

/** Small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CoxswainOptions {
  settings: CoxswainSettings;
  profile: AthleteProfile;
  plan: WorkoutPlan | null;
  /** Seed for the default RNG (phrase choice). Default 1. */
  seed?: number;
  /** Custom RNG in [0,1). Overrides seed. */
  rng?: () => number;
  /** Machine type; a BikeErg splits are spoken per 1000 m. */
  machine?: string;
}

/** Re-cue an unresolved pacing problem after this long. */
export const PACING_REPEAT_MS: Record<CoxFrequency, number> = { minimal: 60000, normal: 30000, chatty: 20000 };
/** Cool-down between technique focuses. */
export const TECHNIQUE_COOLDOWN_MS: Record<CoxFrequency, number> = { minimal: 90000, normal: 45000, chatty: 25000 };
export const MOTIVATION_EVERY_MS: Record<CoxFrequency, number> = { minimal: 240000, normal: 120000, chatty: 60000 };

/** Flag must be present in ≥ this share of the stroke window before the cox mentions it. */
export const FLAG_PERSISTENCE = 0.6;
export const FLAG_WINDOW = 10;
const MIN_WINDOW = 8;

const FLAG_ORDER: TechniqueFlag[] = [
  'slow-catch', 'double-peak', 'rushed-recovery', 'early-peak-fade', 'late-peak', 'soft-drive',
  'short-stroke', 'overreaching', 'weak-finish', 'jerky-drive', 'slow-recovery',
  'low-power-per-stroke', 'inconsistent-strokes', 'rate-too-high', 'rate-too-low',
];

/** %HRmax bands for zones 1-5 (UT2, UT1, AT, TR, AN). */
const HR_ZONES: Record<number, [number, number]> = {
  1: [0.55, 0.7], 2: [0.7, 0.8], 3: [0.8, 0.85], 4: [0.85, 0.9], 5: [0.9, 1.0],
};

type MarkKind = 'regular' | 'halfway' | 'r500' | 'r250' | 'r60' | 'r30';
const MARK_RANK: Record<MarkKind, number> = { regular: 0, halfway: 1, r500: 2, r60: 2, r250: 3, r30: 3 };
interface Mark {
  at: number;
  kind: MarkKind;
  fired: boolean;
}

function buildMarks(axis: 'distance' | 'time', total: number, rep: boolean): Mark[] {
  const marks = new Map<number, MarkKind>();
  const add = (at: number, kind: MarkKind) => {
    const k = Math.round(at);
    if (k <= 0 || k >= total) return;
    const prev = marks.get(k);
    if (!prev || MARK_RANK[kind] > MARK_RANK[prev]) marks.set(k, kind);
  };
  if (axis === 'distance') {
    if (!rep) {
      const step = total <= 2500 ? 500 : total <= 10000 ? 1000 : 5000;
      for (let a = step; a < total; a += step) add(a, 'regular');
      if (total >= 1000) add(total - 500, 'r500');
    }
    if (total >= (rep ? 1000 : 500)) add(total / 2, 'halfway');
    if (total >= 500) add(total - 250, 'r250'); // the last hundred is covered by "last ten"
  } else {
    if (!rep) {
      const step = total <= 6 * 60000 ? 60000 : total <= 40 * 60000 ? 300000 : 600000;
      for (let rem = step; rem < total; rem += step) add(total - rem, 'regular');
    }
    if (total >= 120000) add(total / 2, 'halfway');
    if (total >= (rep ? 180000 : 120000)) add(total - 60000, 'r60');
    if (total >= 60000) add(total - 30000, 'r30');
  }
  return [...marks.entries()].sort((a, b) => a[0] - b[0]).map(([at, kind]) => ({ at, kind, fired: false }));
}

interface Piece {
  kind: 'distance' | 'time' | 'intervals' | 'open';
  total: number;
  intervals: IntervalDef[];
  raceLike: boolean;
  /** plan.repeatForever: intervals[0] repeats with no set count. */
  forever?: boolean;
}

interface Target {
  pace?: number;
  rate?: number;
  hrZone?: number;
  source: 'plan' | 'target' | 'own' | null;
}

const DERIVED_RATIO_MIN = 1.25;

export class Coxswain {
  private settings: CoxswainSettings;
  private profile: AthleteProfile;
  private plan: WorkoutPlan | null;
  private rng: () => number;
  private machine?: string;
  private book: PhraseBook;
  private scheduler: CallScheduler;
  private listeners = new Set<(call: CoxCall) => void>();

  private now = 0;
  private lastM: LiveMetrics | null = null;
  private piece: Piece | null = null;
  private active = false;
  private inRest = false;
  private finished = false;

  // piece / rep progress
  private workStartTime = 0;
  private repIndex = -1;
  private completedReps = 0;
  private repBaseDist = 0;
  private repBaseTime = 0;
  private repPaces: number[] = [];
  private strokesInWork = 0;
  private marks: Mark[] = [];
  private lastTenFired = false;
  private progDist = 0;
  private progTime = 0;
  /** Segment pieces: current segment index and the one already warned about (-1 = none). */
  private segIdx = -1;
  private segWarned = -1;
  private openNextMark = 1000;

  // rolling stroke data
  private recentPaces: number[] = [];
  private recentRates: number[] = [];
  private recentStrokeDist: number[] = [];
  private recentLen: number[] = [];
  private recentWork: number[] = [];
  /** Early-piece reference for length / work / rate; drift from it is flagged. */
  private base: { len: number[]; work: number[]; rate: number[] } = { len: [], work: [], rate: [] };
  private flagWindow: TechniqueFlag[][] = [];
  private strokeCounter = 0;

  // pacing / rate / technique state
  private paceState: 'unknown' | 'on' | 'over' | 'under' = 'unknown';
  private lastPacingAt = Number.NEGATIVE_INFINITY;
  private lastPowerTenAt = Number.NEGATIVE_INFINITY;
  private rateState: 'unknown' | 'on' | 'low' | 'high' = 'unknown';
  private lastRateAt = Number.NEGATIVE_INFINITY;
  /** Cues spoken per fault this piece, and faults that have had their last word. */
  private cueCounts = new Map<TechniqueFlag, number>();
  private retired = new Set<TechniqueFlag>();
  /** Retired faults waiting for their "fixed it" acknowledgement: flag -> stroke it was retired at. */
  private watch = new Map<TechniqueFlag, number>();
  private paceCalls = 0;
  private paceSilenced = false;
  private focus: { flag: TechniqueFlag; sinceStroke: number; cues: number } | null = null;
  private lastTechAt = Number.NEGATIVE_INFINITY;
  private lastMotivationAt = 0;
  private motivationToggle = false;

  // heart rate
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private lastHrAt = Number.NEGATIVE_INFINITY;
  private lastSafetyAt = Number.NEGATIVE_INFINITY;

  // rest
  private restInitial = 0;
  private rest30Fired = false;
  private rest10Fired = false;

  constructor(opts: CoxswainOptions) {
    this.settings = opts.settings;
    this.profile = opts.profile;
    this.plan = opts.plan;
    this.machine = opts.machine;
    this.rng = opts.rng ?? mulberry32(opts.seed ?? 1);
    this.book = new PhraseBook(opts.settings.personality, this.rng);
    this.scheduler = new CallScheduler(opts.settings, (call) => {
      for (const cb of [...this.listeners]) cb(call);
    });
  }

  private sp(p: number): string {
    return speakPace(p, this.machine);
  }

  /* ───────────── public API ───────────── */

  subscribe(cb: (call: CoxCall) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  setMuted(muted: boolean): void {
    this.scheduler.setMuted(muted);
  }

  updateSettings(settings: CoxswainSettings): void {
    this.settings = settings;
    this.scheduler.updateSettings(settings);
    if (settings.personality !== this.book.personality) this.book = new PhraseBook(settings.personality, this.rng);
  }


  onMetrics(m: LiveMetrics): void {
    this.now = m.elapsedMs;
    this.lastM = m;
    if (this.finished) return;
    if (!this.piece && this.plan) this.piece = this.resolvePiece(m);

    const piece = this.piece;
    if (piece?.kind === 'intervals' && (m.workoutState === 'interval-rest' || m.restTimeRemainingMs > 0)) {
      this.handleRest(m);
    } else if (this.active) {
      this.checkProgress(m.distanceM, m.elapsedMs);
      this.checkHeartRate(m);
      this.checkMotivation();
    }
    this.scheduler.tick(this.now);
  }

  onStroke(s: StrokeSample, analysis: ForceCurveAnalysis | null): void {
    // Strokes arrive up to ~3 s late (the aggregator waits for force data); never move the clock back.
    this.now = Math.max(this.now, s.elapsedMs);
    if (this.finished) return;
    if (!this.piece) this.piece = this.resolvePiece(this.lastM);
    const piece = this.piece;

    if (!this.active) {
      if (piece.kind === 'intervals') {
        const lm = this.lastM;
        if (lm && (lm.workoutState === 'interval-rest' || lm.restTimeRemainingMs > 0)) return; // paddling in rest
        let idx = Math.max(s.intervalCount, this.completedReps);
        if (idx <= this.repIndex) idx = this.repIndex + 1;
        if (!this.hasRep(idx)) return;
        this.startWork(s, idx);
      } else {
        if (this.workStartTime > 0 || this.strokesInWork > 0) {
          // resumed after a pause — keep going without restarting the race plan
          this.active = true;
        } else {
          this.startWork(s, 0);
        }
      }
    }

    this.strokeCounter += 1;
    this.strokesInWork += 1;
    push(this.recentPaces, s.paceMsPer500);
    push(this.recentRates, s.strokeRate);
    push(this.recentStrokeDist, s.strokeDistanceM);
    push(this.recentLen, s.driveLengthM);
    push(this.recentWork, s.workPerStrokeJ);
    if (this.strokesInWork > 5 && this.strokesInWork <= 15) {
      this.base.len.push(s.driveLengthM);
      this.base.work.push(s.workPerStrokeJ);
      this.base.rate.push(s.strokeRate);
    }
    const flags = new Set<TechniqueFlag>(analysis && analysis.valid ? analysis.flags : []);
    for (const f of [...derivedFlags(s), ...this.driftFlags()]) flags.add(f);
    this.flagWindow.push([...flags]);
    if (this.flagWindow.length > FLAG_WINDOW) this.flagWindow.shift();

    this.startSequence(this.strokesInWork);
    this.checkProgress(s.distanceM, s.elapsedMs);
    this.checkPacing();
    this.checkRate();
    this.checkTechnique();
    this.scheduler.tick(this.now);
  }

  onSplit(s: SplitSummary): void {
    if (this.finished) return;
    const piece = this.piece;
    if (piece?.kind !== 'intervals') return;
    this.now = Math.max(this.now, s.elapsedMs);
    const idx = s.index;
    this.completedReps = Math.max(this.completedReps, idx + 1);
    this.repPaces[idx] = s.avgPaceMsPer500;
    this.active = false;
    if (!this.hasRep(idx + 1)) return; // the finish call covers the last rep

    const pace = s.avgPaceMsPer500;
    const parts = [this.book.say('repDone', { rep: numberWords(idx + 1), split: this.sp(pace) })];
    const prev = this.repPaces[idx - 1];
    if (prev && prev > 0 && pace > 0) {
      const diff = pace - prev;
      if (Math.abs(diff) < 500) parts.push(this.book.say('repSame'));
      else parts.push(this.book.say(diff < 0 ? 'repFaster' : 'repSlower', { diff: speakSeconds(diff) }));
    } else {
      const target = this.repDef(idx)?.target?.paceMsPer500 ?? this.plan?.target?.paceMsPer500;
      if (target && pace > 0) {
        const d = pace - target;
        parts.push(Math.abs(d) < 1000 ? 'Right on target.' : `${cap(speakSeconds(d))} ${d > 0 ? 'over' : 'under'} target.`);
      }
    }
    this.sayText(parts.join(' '), 'info', 2);
  }

  onWorkoutEnd(summary: PmWorkoutSummary | null): void {
    if (this.finished) return;
    this.finished = true;
    this.active = false;
    const m = this.lastM;
    const elapsed = summary?.elapsedMs ?? m?.elapsedMs ?? this.now;
    const dist = summary?.distanceM ?? m?.distanceM ?? 0;
    let avg = summary?.avgPaceMsPer500 ?? m?.avgPaceMsPer500 ?? 0;
    if (!(avg > 0) && dist > 0) avg = (elapsed / dist) * 500;
    this.now = Math.max(this.now, m?.elapsedMs ?? 0);
    const piece = this.piece ?? this.resolvePiece(m);
    const avgWords = avg > 0 ? `average ${this.sp(avg)}` : '';
    let key: PhraseKey = 'finish';
    let result: string;
    if (piece.kind === 'intervals') {
      key = 'finishIntervals';
      // Count what was actually rowed, so a set stopped early is not announced as complete.
      const reps = Math.max(this.completedReps, summary?.intervalCount ?? 0);
      result = [`${cap(numberWords(reps))} reps`, avgWords].filter(Boolean).join(', ');
    } else if (piece.kind === 'distance') {
      result = `${cap(speakClock(elapsed))} for ${speakMetres(dist)} metres${avgWords ? `, ${avgWords}` : ''}`;
    } else if (piece.kind === 'time') {
      result = `${cap(speakMetres(dist))} metres${avgWords ? `, ${avgWords}` : ''}`;
    } else {
      result = `${cap(speakMetres(dist))} metres in ${speakClock(elapsed)}`;
    }
    this.say(key, { result }, 'race-plan', 3);
  }

  /* ───────────── piece model ───────────── */

  private resolvePiece(m: LiveMetrics | null): Piece {
    const p = this.plan;
    const guessPace = p?.target?.paceMsPer500 ?? p?.pacePlan?.goalPaceMsPer500 ?? (this.profile.reference2kMs ? this.profile.reference2kMs / 4 : 120000);
    if (p?.kind === 'single-distance' && p.value) {
      return { kind: 'distance', total: p.value, intervals: [], raceLike: raceLike(p, (p.value / 500) * guessPace) };
    }
    if (p?.kind === 'single-time' && p.value) {
      return { kind: 'time', total: p.value, intervals: [], raceLike: raceLike(p, p.value) };
    }
    if (p?.kind === 'intervals' && p.intervals && p.intervals.length) {
      const cat = p.category;
      return {
        kind: 'intervals',
        total: p.intervals.length,
        intervals: p.intervals,
        raceLike: cat !== 'steady-state' && cat !== 'technique' && cat !== 'warmup',
        forever: !!p.repeatForever,
      };
    }
    if (!p || p.kind === 'just-row') {
      if (m && m.workoutDistanceM > 0) return { kind: 'distance', total: m.workoutDistanceM, intervals: [], raceLike: raceLike(null, (m.workoutDistanceM / 500) * guessPace) };
      if (m && m.workoutDurationMs > 0) return { kind: 'time', total: m.workoutDurationMs, intervals: [], raceLike: raceLike(null, m.workoutDurationMs) };
    }
    return { kind: 'open', total: 0, intervals: [], raceLike: false };
  }

  private currentInterval(): IntervalDef | null {
    const piece = this.piece;
    if (piece?.kind !== 'intervals' || this.repIndex < 0) return null;
    return this.repDef(this.repIndex) ?? null;
  }

  private repDef(idx: number): IntervalDef | undefined {
    const piece = this.piece!;
    return piece.intervals[piece.forever ? 0 : idx];
  }

  private hasRep(idx: number): boolean {
    return !!this.piece!.forever || idx < this.piece!.intervals.length;
  }

  private axisTotal(): { axis: 'distance' | 'time' | null; total: number } {
    const piece = this.piece;
    if (piece?.kind === 'distance' || piece?.kind === 'time') return { axis: piece.kind, total: piece.total };
    const iv = this.currentInterval();
    return iv && iv.type !== 'calorie' ? { axis: iv.type, total: iv.value } : { axis: null, total: 0 };
  }

  /** Last 250 m / last minute of the piece or rep: racing the finish, so no corrections, nagging or "ease off". */
  private inFinal(): boolean {
    if (this.lastTenFired) return true;
    const { axis, total } = this.axisTotal();
    if (axis === 'distance') return total - this.progDist <= 250;
    if (axis === 'time') return total - this.progTime <= 60000;
    return false;
  }

  private startWork(s: StrokeSample, repIdx: number): void {
    const piece = this.piece!;
    this.active = true;
    this.inRest = false;
    this.strokesInWork = 0;
    this.lastTenFired = false;
    this.paceState = 'unknown';
    this.rateState = 'unknown';
    this.recentPaces = [];
    this.recentRates = [];
    this.recentStrokeDist = [];
    this.recentLen = [];
    this.recentWork = [];
    this.base = { len: [], work: [], rate: [] };
    this.aboveSince = null;
    this.belowSince = null;
    this.progDist = 0;
    this.progTime = 0;
    this.segIdx = -1;
    this.segWarned = -1;
    const strokeMs = Math.max(0, s.driveTimeMs + s.recoveryTimeMs);
    if (piece.kind === 'intervals') {
      this.repIndex = repIdx;
      this.repBaseDist = Math.max(0, s.distanceM - s.strokeDistanceM);
      this.repBaseTime = Math.max(0, s.elapsedMs - strokeMs);
      const iv = this.repDef(repIdx)!;
      this.marks = iv.type === 'calorie' ? [] : buildMarks(iv.type, iv.value, true);
      this.workStartTime = this.repBaseTime;
    } else {
      this.repBaseDist = 0;
      this.repBaseTime = 0;
      this.workStartTime = Math.max(1, s.elapsedMs - strokeMs);
      this.marks = piece.kind === 'distance' || piece.kind === 'time' ? buildMarks(piece.kind, piece.total, false) : [];
    }
    if (this.lastMotivationAt < this.workStartTime) this.lastMotivationAt = this.workStartTime;
  }

  /** Expected duration of the current piece / rep. */
  private expectedMs(): number {
    const piece = this.piece;
    if (!piece) return 0;
    const pace = this.activeTarget().pace ?? 120000;
    if (piece.kind === 'distance') return (piece.total / 500) * pace;
    if (piece.kind === 'time') return piece.total;
    if (piece.kind === 'intervals') {
      const iv = this.currentInterval();
      if (!iv) return 0;
      if (iv.type === 'distance') return (iv.value / 500) * pace;
      if (iv.type === 'time') return iv.value;
      return iv.value * 3000;
    }
    return Number.POSITIVE_INFINITY;
  }

  private fraction(): number {
    const piece = this.piece;
    if (!piece) return 0;
    if (piece.kind === 'distance') return this.progDist / piece.total;
    if (piece.kind === 'time') return this.progTime / piece.total;
    if (piece.kind === 'intervals') {
      const iv = this.currentInterval();
      if (!iv || iv.type === 'calorie') return 0.5;
      return (iv.type === 'distance' ? this.progDist : this.progTime) / iv.value;
    }
    return 0.5;
  }

  private activeTarget(): Target {
    const plan = this.plan;
    const piece = this.piece;
    let pace: number | undefined;
    let rate: number | undefined;
    let hrZone: number | undefined;
    let source: Target['source'] = null;
    if (piece?.kind === 'intervals') {
      const iv = this.currentInterval();
      pace = iv?.target?.paceMsPer500 ?? plan?.target?.paceMsPer500;
      rate = iv?.target?.strokeRate ?? plan?.target?.strokeRate;
      hrZone = iv?.target?.hrZone ?? plan?.target?.hrZone;
      if (pace) source = 'target';
    } else {
      rate = plan?.target?.strokeRate;
      hrZone = plan?.target?.hrZone;
      const sp = this.segNow();
      if (sp) {
        rate = sp.segment.strokeRate ?? rate;
        if (sp.segment.paceMsPer500) {
          pace = sp.segment.paceMsPer500;
          source = 'plan';
        }
      }
      if (pace) {
        // segment pace wins over the pace plan
      } else if (plan?.pacePlan && plan.pacePlan.segments.length && (piece?.kind === 'distance' || piece?.kind === 'time')) {
        const seg = segmentAt(plan.pacePlan, this.fraction());
        pace = seg.targetPaceMsPer500;
        rate = seg.targetStrokeRate ?? rate;
        source = 'plan';
      } else if (plan?.target?.paceMsPer500) {
        pace = plan.target.paceMsPer500;
        source = 'target';
      }
      // With no set pace, only Race holds the rower to their own average; in Training slowing down is a choice.
      if (!pace && this.settings.style === 'race') {
        const own = this.lastM?.avgPaceMsPer500 ?? 0;
        if (own > 0 && this.now - this.workStartTime >= 60000 && this.strokesInWork >= 20) {
          pace = own;
          source = 'own';
        }
      }
    }
    return { pace, rate, hrZone, source };
  }

  /* ───────────── calls ───────────── */

  private sayText(text: string, category: CoxCallCategory, priority: 1 | 2 | 3, flag?: TechniqueFlag, queue = true): boolean {
    if (!text) return false;
    return this.scheduler.submit({ text, category, priority, flag }, this.now, { queue }) !== 'dropped';
  }

  private say(key: PhraseKey, vars: Record<string, string>, category: CoxCallCategory, priority: 1 | 2 | 3): boolean {
    return this.sayText(this.book.say(key, vars), category, priority);
  }

  private startSequence(n: number): void {
    const piece = this.piece!;
    const isRep = piece.kind === 'intervals';
    const est = this.expectedMs();
    const t = this.activeTarget();
    if (n === 1) {
      if (isRep) {
        const iv = this.currentInterval();
        const n = piece.intervals.length;
        const key: PhraseKey = piece.forever ? 'repOpen' : n > 1 && this.repIndex + 1 === n ? 'lastRep' : 'repStart';
        let text = this.book.say(key, { rep: numberWords(this.repIndex + 1), total: numberWords(n) });
        if (iv?.target?.paceMsPer500 ?? this.plan?.target?.paceMsPer500) text += ` Target ${this.sp(t.pace!)}.`;
        if (t.rate) text += ` Rate ${numberWords(t.rate)}.`;
        this.sayText(text, 'race-plan', 3);
      } else if (piece.raceLike) {
        this.say('start', {}, 'race-plan', 3);
      } else {
        this.say('startEasy', {}, 'race-plan', 2);
      }
      return;
    }
    // Sprints and pieces under ~2 min stay high the whole way: no settle.
    if (piece.raceLike && est > 120000 && this.plan?.category !== 'sprint' && !this.inFinal()) {
      if (!isRep && n === 6) this.say('startHigh', {}, 'race-plan', 2);
      if ((!isRep && n === 14) || (isRep && n === 10)) {
        if (t.pace && t.source !== 'own') this.say('settle', { pace: this.sp(t.pace) }, 'race-plan', 2);
        else this.say('settleSteady', {}, 'race-plan', 2);
      }
    } else if (!piece.raceLike && !isRep && n === 10) {
      this.say('settleSteady', {}, 'race-plan', 1);
    }
  }

  private segNow() {
    const k = this.plan?.kind;
    return this.piece && (k === 'single-time' || k === 'single-distance') ? segmentLookup(this.plan, k === 'single-time' ? this.progTime : this.progDist) : null;
  }

  /** Warns shortly before a segment change and calls the change itself. */
  private checkSegments(): void {
    const sp = this.segNow();
    if (!sp) return;
    const words = (g: { strokeRate?: number; paceMsPer500?: number }) =>
      [g.strokeRate ? `rate ${numberWords(g.strokeRate)}` : '', g.paceMsPer500 ? `pace ${this.sp(g.paceMsPer500)}` : ''].filter(Boolean).join(', ') || 'the next segment';
    const time = this.plan!.kind === 'single-time';
    if (sp.index !== this.segIdx) {
      const prev = this.plan!.segments![this.segIdx];
      this.segIdx = sp.index;
      if (!prev) return; // first segment: the start call covers it
      this.paceState = 'unknown';
      this.rateState = 'unknown';
      const a = prev.strokeRate;
      const b = sp.segment.strokeRate;
      const p = prev.paceMsPer500;
      const q = sp.segment.paceMsPer500;
      const up = a && b && a !== b ? b > a : p && q && p !== q ? q < p : true;
      this.say(up ? 'segUp' : 'segDown', { what: words(sp.segment) }, 'race-plan', 3);
    } else if (sp.next && this.segWarned !== sp.index) {
      const lead = time ? 10000 : 50;
      if (sp.remaining <= lead && sp.segment.duration > lead * 2) {
        this.segWarned = sp.index;
        this.say('segWarn', { what: words(sp.next), when: time ? 'ten seconds' : 'fifty metres' }, 'race-plan', 2);
      }
    }
  }

  private checkProgress(dist: number, time: number): void {
    const piece = this.piece;
    if (!piece || !this.active) return;
    const d = Math.max(0, dist - this.repBaseDist);
    const t = Math.max(0, time - this.repBaseTime);
    this.progDist = Math.max(this.progDist, d);
    this.progTime = Math.max(this.progTime, t);
    this.checkSegments();

    if (piece.kind === 'open' && this.progDist >= this.openNextMark) {
      const k = Math.floor(this.progDist / 1000) * 1000;
      this.openNextMark = k + 1000;
      const avg = this.lastM?.avgPaceMsPer500 ?? 0;
      this.sayText(`${cap(speakMetres(k))} metres${avg > 0 ? `, averaging ${this.sp(avg)}` : ''}.`, 'info', 2);
      return;
    }
    const { axis, total } = this.axisTotal();
    if (!axis) return;
    const done = axis === 'distance' ? this.progDist : this.progTime;

    // milestones: fire only the latest crossed one
    let latest: Mark | null = null;
    for (const mk of this.marks) {
      if (!mk.fired && mk.at <= done) {
        mk.fired = true;
        latest = mk;
      }
    }
    if (latest) this.fireMark(latest, axis, total);

    // last ten strokes
    if (!this.lastTenFired && this.strokesInWork >= 10 && this.expectedMs() >= 40000) {
      const rem = total - done;
      let strokesLeft = Number.POSITIVE_INFINITY;
      if (axis === 'distance') {
        const sd = mean(this.recentStrokeDist.filter((x) => x > 0));
        if (sd > 0) strokesLeft = rem / sd;
      } else {
        const r = mean(this.recentRates.filter((x) => x > 0));
        if (r > 0) strokesLeft = (rem / 60000) * r;
      }
      if (rem > 0 && strokesLeft <= 10) {
        this.lastTenFired = true;
        this.say('lastTen', {}, 'race-plan', 2);
      }
    }
  }

  private fireMark(mk: Mark, axis: 'distance' | 'time', total: number): void {
    const isRep = this.piece?.kind === 'intervals';
    let avg = isRep ? 0 : this.lastM?.avgPaceMsPer500 ?? 0;
    if (!(avg > 0) && this.progDist > 0) avg = (this.progTime / this.progDist) * 500;
    const avgW = avg > 0 ? this.sp(avg) : 'steady';
    switch (mk.kind) {
      case 'regular':
        if (axis === 'distance') this.say('milestone', { done: speakMetres(mk.at), remain: speakMetres(total - mk.at), avg: avgW }, 'info', 2);
        else this.say('timeLeft', { left: speakDuration(total - mk.at), avg: avgW }, 'info', 2);
        return;
      case 'halfway':
        this.say('halfway', { avg: avgW }, 'info', 2);
        return;
      case 'r500':
        this.say('last500', {}, this.piece?.raceLike ? 'race-plan' : 'info', 2);
        return;
      case 'r250':
        this.say('last250', {}, 'race-plan', 2);
        return;
      case 'r60':
        this.say('lastMinute', {}, 'race-plan', 2);
        return;
      case 'r30':
        this.say('last30s', {}, 'race-plan', 2);
        return;
    }
  }

  private checkPacing(): void {
    const piece = this.piece!;
    if (this.strokesInWork < (piece.raceLike ? 18 : 10) || this.lastTenFired) return;
    const t = this.activeTarget();
    if (!t.pace) return;
    const paces = this.recentPaces.slice(-6).filter((p) => p > 0);
    if (paces.length < 4) return;
    const delta = mean(paces) - t.pace; // + = slower than target
    const own = t.source === 'own';
    const enter = own ? 3000 : 2000;
    const exit = own ? 1500 : 1000;
    const repeat = PACING_REPEAT_MS[this.settings.frequency];
    const vars = { diff: speakSeconds(delta), target: this.sp(t.pace) };
    const f = this.fraction();
    const final = this.inFinal();
    if (final && delta <= enter) return; // never "settle back" while they sprint the finish

    if (delta > enter) {
      if (this.paceState !== 'over') {
        this.paceState = 'over';
        if (this.paceSilenced) return;
        if (own && this.countPace(vars)) return;
        if (this.say(own ? 'overOwn' : 'over', vars, 'pacing', 2)) this.lastPacingAt = this.now;
      } else if (this.now - this.lastPacingAt >= repeat) {
        // A set pace (pace boat) keeps reminding at the repeat interval; only own-average nagging is capped.
        if (this.paceSilenced || (own && this.countPace(vars))) return;
        if (f > 0.35 && !final && this.now - this.lastPowerTenAt >= 90000) {
          if (this.say('powerTen', {}, 'pacing', 2)) {
            this.lastPowerTenAt = this.now;
            this.lastPacingAt = this.now;
          }
        } else if (this.say(own ? 'overOwn' : 'over', vars, 'pacing', 1)) {
          this.lastPacingAt = this.now;
        }
      }
      return;
    }
    if (delta < -enter) {
      if (own) {
        this.paceState = 'under';
        return;
      }
      const early = f < 0.25;
      if (this.paceState !== 'under') {
        this.paceState = 'under';
        if (this.say(early ? 'tooHot' : 'under', vars, 'pacing', early ? 2 : 1)) this.lastPacingAt = this.now;
      } else if (early && this.now - this.lastPacingAt >= repeat) {
        if (this.say('tooHot', vars, 'pacing', 2)) this.lastPacingAt = this.now;
      }
      return;
    }
    if (Math.abs(delta) < exit) {
      this.paceCalls = 0;
      this.paceSilenced = false;
      if (this.paceState === 'over' || this.paceState === 'under') {
        this.paceState = 'on';
        this.say('onTarget', vars, 'pacing', 1);
        this.lastPacingAt = this.now;
      } else {
        if (this.paceState === 'unknown') this.lastPacingAt = this.now;
        this.paceState = 'on';
        if (!own && this.now - this.lastPacingAt >= repeat * 3 && this.say('onTarget', vars, 'pacing', 1)) this.lastPacingAt = this.now;
      }
    }
  }

  /** Max cues for a fault this piece; steady-state pieces get one fewer (min 1). */
  private cueCap(): number {
    return Math.max(1, this.settings.maxCuesPerFault - (this.piece?.raceLike ? 0 : 1));
  }

  private flagAllowed(f: TechniqueFlag): boolean {
    if (this.settings.mutedFlags.includes(f) || this.retired.has(f)) return false;
    return this.settings.rateCalls || (f !== 'rate-too-high' && f !== 'rate-too-low');
  }

  /** Speaks the next cue for a fault; the one that reaches the cap is a final warning and retires it. */
  private cue(flag: TechniqueFlag): boolean {
    const n = (this.cueCounts.get(flag) ?? 0) + 1;
    const last = n >= this.cueCap();
    const text = last ? this.book.finalCue(flag) : this.book.technique(flag);
    if (!this.sayText(text, 'technique', 2, flag, false)) return false;
    this.cueCounts.set(flag, n);
    if (last) {
      this.retired.add(flag);
      this.watch.set(flag, this.strokeCounter);
    }
    return true;
  }

  /** Steady pieces: after the cap, one "last call on pace" then silence until back on target. True = this call was replaced. */
  private countPace(vars: Record<string, string>): boolean {
    this.paceCalls += 1;
    if (this.piece?.raceLike || this.paceCalls < this.cueCap()) return false;
    if (this.say('lastPace', vars, 'pacing', 2)) {
      this.paceSilenced = true;
      this.lastPacingAt = this.now;
      return true;
    }
    this.paceCalls -= 1;
    return false;
  }

  private checkRate(): void {
    if (!this.settings.rateCalls) return;
    const piece = this.piece!;
    if (this.strokesInWork < (piece.raceLike ? 18 : 10) || this.lastTenFired) return;
    const t = this.activeTarget();
    if (!t.rate) return;
    const rates = this.recentRates.slice(-6).filter((r) => r > 0);
    if (rates.length < 4) return;
    const r = mean(rates);
    const d = r - t.rate;
    if (d >= -2 && this.inFinal()) return; // only "rate up" in the finish
    const repeat = PACING_REPEAT_MS[this.settings.frequency] * 1.5;
    const vars = { rate: numberWords(r), target: numberWords(t.rate) };
    if (d < -2 || d > 2) {
      const next = d < 0 ? 'low' : 'high';
      if (this.rateState !== next || this.now - this.lastRateAt >= repeat) {
        const first = this.rateState !== next;
        this.rateState = next;
        if (this.say(next === 'low' ? 'rateUp' : 'rateDown', vars, 'rate', first ? 2 : 1)) this.lastRateAt = this.now;
      }
    } else if (Math.abs(d) <= 1) {
      if (this.rateState === 'low' || this.rateState === 'high') {
        this.say('rateOn', vars, 'rate', 1);
        this.lastRateAt = this.now;
      }
      this.rateState = 'on';
    }
  }

  /** Flags from drift against the piece's own early strokes; the analysis module sets none of these per stroke. */
  private driftFlags(): TechniqueFlag[] {
    const out: TechniqueFlag[] = [];
    if (this.base.len.length < 10) return out;
    const len = avgPos(this.recentLen.slice(-5));
    const work = avgPos(this.recentWork.slice(-5));
    const rate = avgPos(this.recentRates.slice(-5));
    const bLen = avgPos(this.base.len);
    const bWork = avgPos(this.base.work);
    const bRate = avgPos(this.base.rate);
    if (len > 0 && bLen > 0 && len < bLen * 0.92) out.push('short-stroke');
    if (work > 0 && bWork > 0 && work < bWork * 0.8) out.push('low-power-per-stroke');
    if (rate > 0 && bRate > 0 && Math.abs(rate - bRate) >= 3) out.push(rate > bRate ? 'rate-too-high' : 'rate-too-low');
    const d = this.recentStrokeDist.filter((x) => x > 0);
    if (d.length >= 8) {
      const m = mean(d);
      if (Math.sqrt(mean(d.map((x) => (x - m) ** 2))) / m > 0.07) out.push('inconsistent-strokes');
    }
    return out;
  }

  private checkTechnique(): void {
    if (this.strokesInWork < 12 || this.inFinal()) return;
    const win = this.flagWindow;
    if (win.length < MIN_WINDOW) return;

    for (const [flag, at] of this.watch) {
      if (this.strokeCounter - at < MIN_WINDOW) continue;
      if (win.slice(-MIN_WINDOW).filter((fs) => fs.includes(flag)).length <= 2) {
        this.watch.delete(flag);
        this.sayText(this.book.improved(flag), 'technique', 2, flag);
      }
    }

    if (this.focus) {
      const focus = this.focus;
      const since = this.strokeCounter - focus.sinceStroke;
      if (since < MIN_WINDOW) return;
      const recent = win.slice(-MIN_WINDOW);
      const c = recent.filter((fs) => fs.includes(focus.flag)).length;
      if (c <= 2) {
        this.sayText(this.book.improved(focus.flag), 'technique', 2, focus.flag);
        this.focus = null;
        this.lastTechAt = this.now;
        return;
      }
      if (since >= 30) {
        if (this.cue(focus.flag)) {
          focus.sinceStroke = this.strokeCounter;
          if (this.retired.has(focus.flag)) {
            this.focus = null;
            this.lastTechAt = this.now;
          }
        }
      }
      return;
    }

    if (this.now - this.lastTechAt < TECHNIQUE_COOLDOWN_MS[this.settings.frequency]) return;
    const hasRateTarget = !!this.activeTarget().rate;
    const counts = new Map<TechniqueFlag, number>();
    for (const fs of win) for (const f of fs) counts.set(f, (counts.get(f) ?? 0) + 1);
    let best: TechniqueFlag | null = null;
    let bestCount = 0;
    for (const f of FLAG_ORDER) {
      if ((hasRateTarget && (f === 'rate-too-high' || f === 'rate-too-low')) || !this.flagAllowed(f)) continue;
      const c = counts.get(f) ?? 0;
      if (c / win.length >= FLAG_PERSISTENCE && c > bestCount) {
        best = f;
        bestCount = c;
      }
    }
    if (best && this.cue(best)) {
      this.focus = this.retired.has(best) ? null : { flag: best, sinceStroke: this.strokeCounter, cues: 1 };
      this.lastTechAt = this.now;
    }
  }

  private checkMotivation(): void {
    if (this.inRest || this.now - this.workStartTime < 45000 || this.inFinal()) return;
    if (this.now - this.lastMotivationAt < MOTIVATION_EVERY_MS[this.settings.frequency]) return;
    const f = this.fraction();
    let key: PhraseKey;
    if (f > 0.75 && this.piece?.kind !== 'open') key = 'motivationLate';
    else if (this.piece && !this.piece.raceLike) key = this.motivationToggle ? 'focus' : 'motivationSteady'; // steady: quieter, rhythm-led
    else key = this.motivationToggle ? 'focus' : 'motivation';
    if (this.say(key, {}, 'motivation', 1)) {
      this.lastMotivationAt = this.now;
      this.motivationToggle = !this.motivationToggle;
    }
  }

  private checkHeartRate(m: LiveMetrics): void {
    const hr = m.heartRate;
    if (hr == null || !(hr > 0)) return;
    const max = this.profile.maxHeartRate;
    if (max && hr > max && this.now - this.lastSafetyAt >= 60000) {
      if (this.say('safety', {}, 'safety', 3)) this.lastSafetyAt = this.now;
    }
    if (this.inFinal()) return; // zone calls ("ease off") make no sense in the finish; safety still does
    const zone = this.activeTarget().hrZone;
    const birthYear = this.profile.birthYear;
    const hrMax = max ?? (birthYear ? 220 - (new Date(m.timestamp).getFullYear() - birthYear) : null);
    const band = zone ? HR_ZONES[Math.round(zone)] : undefined;
    if (!band || !hrMax) return;
    const lo = band[0] * hrMax;
    const hi = band[1] * hrMax;
    if (hr > hi) {
      this.aboveSince ??= this.now;
      if (this.now - this.aboveSince >= 20000 && this.now - this.lastHrAt >= 90000) {
        if (this.say('hrHigh', {}, 'pacing', 2)) this.lastHrAt = this.now;
      }
    } else this.aboveSince = null;
    if (hr < lo && this.now - this.workStartTime >= 120000) {
      this.belowSince ??= this.now;
      if (this.now - this.belowSince >= 60000 && this.now - this.lastHrAt >= 120000) {
        if (this.say('hrLow', {}, 'pacing', 1)) this.lastHrAt = this.now;
      }
    } else this.belowSince = null;
  }

  private handleRest(m: LiveMetrics): void {
    if (!this.inRest) {
      this.inRest = true;
      this.active = false;
      this.restInitial = 0;
      this.rest30Fired = false;
      this.rest10Fired = false;
      this.focus = null;
    }
    const r = m.restTimeRemainingMs;
    this.restInitial = Math.max(this.restInitial, r);
    const next = Math.max(this.completedReps, this.repIndex + 1);
    if (!this.hasRep(next)) return;
    if (!this.rest30Fired && r > 0 && r <= 30500 && this.restInitial >= 40000) {
      this.rest30Fired = true;
      this.say('rest30', { next: this.describeRep(next) }, 'race-plan', 2);
    }
    if (!this.rest10Fired && r > 0 && r <= 10500 && this.restInitial >= 14000) {
      this.rest10Fired = true;
      this.say('rest10', {}, 'race-plan', 2);
    }
  }

  private describeRep(idx: number): string {
    const iv = this.repDef(idx);
    if (!iv) return '';
    const what =
      iv.type === 'distance' ? `${speakMetres(iv.value)} metres` : iv.type === 'time' ? speakDuration(iv.value) : `${numberWords(iv.value)} calories`;
    const pace = iv.target?.paceMsPer500 ?? this.plan?.target?.paceMsPer500;
    const rate = iv.target?.strokeRate ?? this.plan?.target?.strokeRate;
    let s = `Rep ${numberWords(idx + 1)} next: ${what}`;
    if (pace) s += ` at ${this.sp(pace)}`;
    if (rate) s += `, rate ${numberWords(rate)}`;
    return `${s}.`;
  }
}

function push(arr: number[], v: number, cap = 10): void {
  arr.push(v);
  if (arr.length > cap) arr.shift();
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function raceLike(plan: WorkoutPlan | null, estMs: number): boolean {
  const c = plan?.category;
  if (c === 'steady-state' || c === 'technique' || c === 'warmup') return false;
  if (c === 'test' || c === 'sprint' || c === 'vo2max') return true;
  return estMs <= 12 * 60000;
}

function avgPos(a: number[]): number {
  const v = a.filter((x) => x > 0);
  return v.length ? mean(v) : 0;
}

/** Technique problems visible from stroke mechanics alone. */
export function derivedFlags(s: StrokeSample): TechniqueFlag[] {
  const out: TechniqueFlag[] = [];
  if (s.driveTimeMs > 0 && s.recoveryTimeMs > 0 && s.strokeRate > 0 && s.strokeRate <= 30) {
    if (s.recoveryTimeMs / s.driveTimeMs < DERIVED_RATIO_MIN) out.push('rushed-recovery');
  }
  if (s.driveTimeMs > 0 && s.recoveryTimeMs > 0 && s.strokeRate > 0 && s.recoveryTimeMs / s.driveTimeMs > recoveryRatioBounds(s.strokeRate)[1]) out.push('slow-recovery');
  return out;
}

/** A few sample lines for the settings preview. */
export function sampleCalls(personality: CoxPersonality): string[] {
  const book = new PhraseBook(personality, mulberry32(7));
  return [
    book.say('start'),
    book.say('over', { diff: 'two seconds', target: speakPace(112000) }),
    book.technique('slow-catch'),
    book.say('last250'),
    book.say('finish', { result: `${cap(speakClock(418400))} for ${speakMetres(2000)} metres, average ${speakPace(104600)}` }),
  ];
}
