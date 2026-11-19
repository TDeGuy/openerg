/**
 * Pure helpers for the live screens: progress toward the target, current targets,
 * tones, value parsing/formatting, stable chart axes and smooth SVG paths.
 * No React Native imports — unit tested in __tests__/progress.test.ts.
 */
import type {
  IntervalDef,
  LiveMetrics,
  PacePlan,
  PacePlanSegment,
  SessionPhase,
  SplitSummary,
  WorkoutPlan,
} from '@/core/types';
import { clamp, formatDuration, formatPace, parseDuration } from '@/core/units';
import { segmentLookup, segmentProgress } from '@/workouts/segments';

export type ProgressUnit = 'distance' | 'time' | 'calorie';
export type LiveTone = 'default' | 'dim' | 'accent' | 'good' | 'warn' | 'bad';

export interface LiveProgress {
  unit: ProgressUnit;
  /** Done / total within the current piece (or current interval). */
  done: number;
  total: number;
  remaining: number;
  fraction: number;
  /** 0-based interval index (null for single pieces) and interval count (null too for repeat-forever). */
  rep: number | null;
  reps: number | null;
  /** Fraction of the whole workout (used for pace plans). */
  overallFraction: number;
}

function unitOf(t: IntervalDef['type']): ProgressUnit {
  return t === 'distance' ? 'distance' : t === 'time' ? 'time' : 'calorie';
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Index of the interval currently being rowed (clamped to the plan). */
export function repIndex(plan: WorkoutPlan | null, m: LiveMetrics): number {
  const n = plan?.intervals?.length ?? 0;
  if (n === 0) return 0;
  return plan?.repeatForever ? Math.max(0, Math.floor(m.intervalCount)) : clamp(Math.floor(m.intervalCount), 0, n - 1);
}

/** Definition of interval `index` (repeat-forever plans reuse their single entry). */
function defAt(plan: WorkoutPlan, index: number): IntervalDef | undefined {
  return plan.intervals?.[plan.repeatForever ? 0 : index];
}

export function computeProgress(plan: WorkoutPlan | null, m: LiveMetrics, splits: SplitSummary[]): LiveProgress | null {
  if (!plan) return null;
  const single = (unit: ProgressUnit, done: number): LiveProgress | null => {
    const total = plan.value ?? 0;
    if (!(total > 0)) return null;
    const fraction = clamp(done / total, 0, 1);
    return { unit, done, total, remaining: Math.max(0, total - done), fraction, rep: null, reps: null, overallFraction: fraction };
  };
  switch (plan.kind) {
    case 'single-distance':
      return single('distance', m.distanceM);
    case 'single-time':
      return single('time', m.elapsedMs);
    case 'single-calorie':
      return single('calorie', m.calories);
    case 'intervals': {
      const defs = plan.intervals ?? [];
      if (defs.length === 0) return null;
      const idx = repIndex(plan, m);
      const def = defAt(plan, idx)!;
      const unit = unitOf(def.type);
      const before = splits.filter((s) => s.index < idx);
      // The PM may report cumulative or per-interval totals; handle both.
      let raw: number;
      let start: number;
      if (unit === 'distance') {
        raw = m.distanceM;
        start = sum(before.map((s) => s.splitDistanceM));
      } else if (unit === 'time') {
        raw = m.elapsedMs;
        start = sum(before.map((s) => s.splitTimeMs + s.restTimeMs));
      } else {
        raw = m.calories;
        start = sum(before.map((s) => s.calories));
      }
      const done = start > 0 && raw >= start ? raw - start : raw;
      const total = def.value;
      const fraction = total > 0 ? clamp(done / total, 0, 1) : 0;
      return {
        unit,
        done,
        total,
        remaining: Math.max(0, total - done),
        fraction,
        rep: idx,
        reps: plan.repeatForever ? null : defs.length,
        overallFraction: plan.repeatForever ? fraction : clamp((idx + fraction) / defs.length, 0, 1),
      };
    }
    default:
      return null;
  }
}

export function isRestState(phase: SessionPhase, m: LiveMetrics | null): boolean {
  if (phase === 'rest') return true;
  return m?.workoutState === 'interval-rest';
}

/** The interval that follows the current one (shown during rest). */
export function nextRep(plan: WorkoutPlan | null, m: LiveMetrics): { index: number; def: IntervalDef; total: number | null } | null {
  const defs = plan?.intervals ?? [];
  if (!plan || defs.length === 0) return null;
  const index = Math.floor(m.intervalCount) + 1;
  if (plan.repeatForever) return { index, def: defs[0], total: null };
  if (index >= defs.length) return null;
  return { index, def: defs[index], total: defs.length };
}

/** "Rep 3 of 8", or "Rep 3" when the plan repeats forever. */
export function repLabel(rep: number, total: number | null): string {
  return total ? `Rep ${rep + 1} of ${total}` : `Rep ${rep + 1}`;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Splits a live page (w×h) into graph boxes and tile boxes so nothing overflows:
 * graphs take a column (landscape) or a band (portrait), tiles share the rest with the
 * first two tiles in a taller hero row.
 */
export function layoutPage(w: number, h: number, nTiles: number, nGraphs: number, gap: number): { tiles: Box[]; graphs: Box[] } {
  const graphs: Box[] = [];
  let area: Box = { x: 0, y: 0, w, h };
  if (nGraphs > 0) {
    let band = area;
    if (nTiles > 0 && w >= h) {
      const gw = Math.round((w - gap) * 0.5);
      band = { x: w - gw, y: 0, w: gw, h };
      area = { x: 0, y: 0, w: w - gw - gap, h };
    } else if (nTiles > 0) {
      const gh = Math.round((h - gap) * 0.45);
      band = { x: 0, y: h - gh, w, h: gh };
      area = { x: 0, y: 0, w, h: h - gh - gap };
    }
    const gh = (band.h - gap * (nGraphs - 1)) / nGraphs;
    for (let i = 0; i < nGraphs; i++) graphs.push({ x: band.x, y: band.y + i * (gh + gap), w: band.w, h: gh });
  }
  return { tiles: tileBoxes(area, nTiles, gap), graphs };
}

const HERO = 1.6;

function tileBoxes(a: Box, n: number, gap: number): Box[] {
  if (n <= 0) return [];
  const hero = Math.min(2, n);
  const rest = n - hero;
  // Pick the column count that gives the largest readable tile (values are ~2.4× wider than tall).
  let cols = 1;
  let best = -1;
  for (let c = 1; c <= rest; c++) {
    const rows = Math.ceil(rest / c);
    const score = Math.min((a.w - gap * (c - 1)) / c / 2.4, (a.h - gap * rows) / (rows + HERO));
    if (score > best) {
      best = score;
      cols = c;
    }
  }
  const rows = rest ? Math.ceil(rest / cols) : 0;
  const unit = rows ? (a.h - gap * rows) / (rows + HERO) : 0;
  const heroH = rows ? unit * HERO : a.h;
  const out: Box[] = [];
  const row = (count: number, y: number, rh: number) => {
    const cw = (a.w - gap * (count - 1)) / count;
    for (let i = 0; i < count; i++) out.push({ x: a.x + i * (cw + gap), y, w: cw, h: rh });
  };
  row(hero, a.y, heroH);
  for (let r = 0; r < rows; r++) row(Math.min(cols, rest - r * cols), a.y + heroH + gap + r * (unit + gap), unit);
  return out;
}

/** Label and value font sizes that fit a tile of w×h showing `chars` characters. */
export function tileFonts(w: number, h: number, chars: number): { label: number; value: number } {
  const label = clamp(Math.round(h * 0.14), 10, 16);
  const byHeight = (h - label * 1.3 - 8) / 1.1;
  const byWidth = (w - 16) / (Math.max(3, chars) * 0.62);
  return { label, value: Math.max(10, Math.floor(Math.min(byHeight, byWidth))) };
}

export function segmentForFraction(pp: PacePlan, fraction: number): PacePlanSegment | null {
  if (pp.segments.length === 0) return null;
  const f = clamp(fraction, 0, 1);
  return pp.segments.find((s) => f >= s.startFraction && f < s.endFraction) ?? pp.segments[pp.segments.length - 1];
}

export interface LiveTarget {
  paceMsPer500: number | null;
  strokeRate: number | null;
  label: string | null;
  /** Countdown to the next segment change, e.g. "r24 in 0:30"; null outside segment pieces / in the last segment. */
  next?: string | null;
}

export function currentTarget(plan: WorkoutPlan | null, m: LiveMetrics, progress: LiveProgress | null): LiveTarget {
  const none: LiveTarget = { paceMsPer500: null, strokeRate: null, label: null, next: null };
  if (!plan) return none;
  const pos = (v: number | undefined) => (v !== undefined && v > 0 ? v : null);
  if (plan.kind === 'intervals') {
    const def = defAt(plan, repIndex(plan, m));
    const t = def?.target ?? plan.target;
    return { paceMsPer500: pos(t?.paceMsPer500), strokeRate: pos(t?.strokeRate), label: null, next: null };
  }
  const sp = segmentLookup(plan, segmentProgress(plan, m));
  if (sp) {
    const what = (g: { paceMsPer500?: number; strokeRate?: number }) => [g.strokeRate ? `r${g.strokeRate}` : '', g.paceMsPer500 ? formatPace(g.paceMsPer500) : ''].filter(Boolean).join(' ');
    const left = plan.kind === 'single-time' ? formatDuration(Math.ceil(sp.remaining / 1000) * 1000, { tenths: false }) : `${Math.ceil(sp.remaining)}m`;
    return {
      paceMsPer500: pos(sp.segment.paceMsPer500) ?? pos(plan.target?.paceMsPer500),
      strokeRate: pos(sp.segment.strokeRate) ?? pos(plan.target?.strokeRate),
      label: `Segment ${sp.index + 1} of ${plan.segments!.length}`,
      next: sp.next ? `${what(sp.next)} in ${left}` : null,
    };
  }
  if (plan.pacePlan && plan.pacePlan.segments.length > 0) {
    const seg = segmentForFraction(plan.pacePlan, progress?.overallFraction ?? 0);
    return {
      paceMsPer500: pos(seg?.targetPaceMsPer500) ?? pos(plan.pacePlan.goalPaceMsPer500),
      strokeRate: pos(seg?.targetStrokeRate) ?? pos(plan.target?.strokeRate),
      label: seg?.label ?? null,
      next: null,
    };
  }
  return { paceMsPer500: pos(plan.target?.paceMsPer500), strokeRate: pos(plan.target?.strokeRate), label: null, next: null };
}

/** Pace colour versus target (lower pace = faster). */
export function paceTone(pace: number, target: number | null): LiveTone {
  if (!(pace > 0) || !target) return 'default';
  const diff = pace - target;
  if (diff <= 500) return 'good';
  if (diff <= 2000) return 'warn';
  return 'bad';
}

export function rateTone(rate: number, target: number | null): LiveTone {
  if (!(rate > 0) || !target) return 'default';
  const d = Math.abs(rate - target);
  if (d <= 1.5) return 'good';
  if (d <= 3.5) return 'warn';
  return 'bad';
}

/** "500m", "2:00", "20 cal". */
export function formatIntervalValue(def: Pick<IntervalDef, 'type' | 'value'>): string {
  if (def.type === 'distance') return `${Math.round(def.value)}m`;
  if (def.type === 'time') return formatDuration(def.value, { tenths: def.value % 1000 !== 0 });
  return `${Math.round(def.value)} cal`;
}

export type FieldKind = 'distance' | 'time' | 'calorie' | 'pace' | 'rate' | 'count';

/** Parses user text for a field. Empty → null, invalid → NaN. Accepts "2000", "2,000m", "30:00", "1:45.0". */
export function parseField(kind: FieldKind, text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (kind === 'time' || kind === 'pace') {
    const v = parseDuration(t.replace(/\/500m?$/, '').trim());
    return Number.isFinite(v) && v > 0 ? v : NaN;
  }
  let s = t.replace(/[,\s]/g, '');
  let mult = 1;
  if (kind === 'distance') {
    if (s.endsWith('km')) {
      s = s.slice(0, -2);
      mult = 1000;
    } else if (s.endsWith('k')) {
      s = s.slice(0, -1);
      mult = 1000;
    } else if (s.endsWith('m')) s = s.slice(0, -1);
  }
  if (kind === 'calorie') s = s.replace(/(kcal|cal)$/, '');
  if (kind === 'rate') s = s.replace(/(spm|s\/m)$/, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const v = Number(s) * mult;
  if (!(v > 0)) return NaN;
  return kind === 'count' || kind === 'distance' || kind === 'calorie' ? Math.round(v) : v;
}

export function formatField(kind: FieldKind, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return '';
  if (kind === 'time') return formatDuration(v, { tenths: v % 1000 !== 0 });
  if (kind === 'pace') return formatPace(v);
  return String(Math.round(v * 10) / 10);
}

export function niceCeil(v: number, step: number): number {
  return Math.max(step, Math.ceil(v / step) * step);
}

export interface AxisState {
  max: number;
  /** Consecutive strokes whose need was far below max. */
  low: number;
}

/** Stable y-axis: grows immediately, shrinks only after 8 consecutive much-smaller strokes. */
export function nextAxisMax(state: AxisState, peak: number, step: number): AxisState {
  const need = niceCeil(peak * 1.1, step);
  if (state.max <= 0 || need > state.max) return { max: need, low: 0 };
  if (need < state.max * 0.6) {
    const low = state.low + 1;
    return low >= 8 ? { max: need, low: 0 } : { max: state.max, low };
  }
  return { max: state.max, low: 0 };
}

/** Catmull-Rom spline through the points as an SVG cubic path. y clamped to [0, maxY]. */
export function smoothPath(pts: { x: number; y: number }[], maxY: number): string {
  if (pts.length < 2) return '';
  const cy = (y: number) => clamp(y, 0, maxY);
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = cy(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = cy(p2.y - (p3.y - p1.y) / 6);
    d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2.x)},${f(p2.y)}`;
  }
  return d;
}

/** Maps a curve (any length) to points in a w×h box with y-axis max `yMax`. */
export function curvePoints(curve: number[], w: number, h: number, yMax: number): { x: number; y: number }[] {
  const n = curve.length;
  if (n < 2 || yMax <= 0) return [];
  return curve.map((v, i) => ({ x: (i / (n - 1)) * w, y: h - (clamp(v, 0, yMax) / yMax) * h }));
}
