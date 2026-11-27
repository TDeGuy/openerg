/** Pure helpers for the analysis screens. No React Native imports (unit tested). */
import type {
  HeartRatePoint,
  MetricKey,
  PersonalRecord,
  StrokeSample,
  TrainingZone,
  WorkoutListItem,
  WorkoutPlan,
  WorkoutRecord,
} from '@/core/types';
import { parseDuration } from '@/core/units';

export interface XY {
  x: number;
  y: number;
}

/* ───────────── Logbook grouping ───────────── */

export interface MonthSection {
  key: string;
  title: string;
  data: WorkoutListItem[];
  metres: number;
  durationMs: number;
  sessions: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

export function groupByMonth(items: readonly WorkoutListItem[]): MonthSection[] {
  const sorted = [...items].sort((a, b) => b.startedAt - a.startedAt);
  const out: MonthSection[] = [];
  for (const it of sorted) {
    const d = new Date(it.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let sec = out[out.length - 1];
    if (!sec || sec.key !== key) {
      sec = { key, title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, data: [], metres: 0, durationMs: 0, sessions: 0 };
      out.push(sec);
    }
    sec.data.push(it);
    sec.metres += it.distanceM || 0;
    sec.durationMs += it.elapsedMs || 0;
    sec.sessions += 1;
  }
  return out;
}

export function formatDate(ms: number, withTime = true): string {
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  if (!withTime) return base;
  const hh = d.getHours();
  const mm = d.getMinutes();
  return `${base}, ${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

export function formatShortDate(ms: number, period: 'week' | 'month' | 'day' = 'day'): string {
  const d = new Date(ms);
  if (period === 'month') return `${MONTHS_SHORT[d.getMonth()]}${d.getMonth() === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ''}`;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/* ───────────── Totals / streaks ───────────── */

export interface Totals {
  metres: number;
  durationMs: number;
  sessions: number;
  calories: number;
}

export function totals(items: readonly WorkoutListItem[], fromMs = -Infinity): Totals {
  const t: Totals = { metres: 0, durationMs: 0, sessions: 0, calories: 0 };
  for (const it of items) {
    if (it.simulated || it.startedAt < fromMs) continue;
    t.metres += it.distanceM || 0;
    t.durationMs += it.elapsedMs || 0;
    t.calories += it.calories || 0;
    t.sessions += 1;
  }
  return t;
}

/** Concept2 logbook season starts 1 May. */
export function seasonStart(now: number): number {
  const d = new Date(now);
  const y = d.getMonth() >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, 4, 1).getTime();
}

function dayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
}

/** Consecutive-day streaks. Current streak counts if the last session was today or yesterday. */
export function streaks(items: readonly WorkoutListItem[], now: number): { current: number; longest: number } {
  const days = Array.from(new Set(items.filter((i) => !i.simulated).map((i) => dayIndex(i.startedAt)))).sort((a, b) => a - b);
  if (days.length === 0) return { current: 0, longest: 0 };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] - days[i - 1] === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const today = dayIndex(now);
  const last = days[days.length - 1];
  let current = 0;
  if (today - last <= 1) {
    current = 1;
    for (let i = days.length - 1; i > 0 && days[i] - days[i - 1] === 1; i--) current++;
  }
  return { current, longest };
}

/* ───────────── Events / progression ───────────── */

export const STANDARD_EVENTS = ['500m', '1000m', '2000m', '5000m', '6000m', '10000m', '21097m', '42195m', '1:00', '4:00', '30:00', '60:00'];

export function parseEvent(event: string): { type: 'distance' | 'time'; value: number } | null {
  if (/^\d+m$/.test(event)) return { type: 'distance', value: Number(event.slice(0, -1)) };
  const ms = parseDuration(event.includes(':') ? event : '');
  return Number.isFinite(ms) && ms > 0 ? { type: 'time', value: ms } : null;
}

export function eventLabel(event: string): string {
  const p = parseEvent(event);
  if (!p) return event;
  if (p.type === 'distance') {
    if (p.value === 21097) return 'Half marathon';
    if (p.value === 42195) return 'Marathon';
    return p.value >= 1000 && p.value % 1000 === 0 ? `${p.value / 1000}k` : `${p.value}m`;
  }
  return `${Math.round(p.value / 60000)} min`;
}

function isInterval(it: WorkoutListItem): boolean {
  return it.workoutType.includes('interval') || it.plan?.kind === 'intervals';
}

/** Whole pieces matching a standard event, oldest first, as {x: startedAt, y: pace, result}. */
export function progression(items: readonly WorkoutListItem[], event: string): { x: number; y: number; result: number; id: string }[] {
  const p = parseEvent(event);
  if (!p) return [];
  const out: { x: number; y: number; result: number; id: string }[] = [];
  for (const it of items) {
    if (it.simulated || isInterval(it) || !(it.avgPaceMsPer500 > 0)) continue;
    if (p.type === 'distance') {
      if (Math.abs(it.distanceM - p.value) <= Math.max(2, p.value * 0.002)) out.push({ x: it.startedAt, y: it.avgPaceMsPer500, result: it.elapsedMs, id: it.id });
    } else if (Math.abs(it.elapsedMs - p.value) <= 1500) {
      out.push({ x: it.startedAt, y: it.avgPaceMsPer500, result: it.distanceM, id: it.id });
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

/** Running best (lowest pace) of a progression, for a "best so far" step line. */
export function bestSoFar(points: readonly XY[]): XY[] {
  let best = Infinity;
  const out: XY[] = [];
  for (const p of points) {
    best = Math.min(best, p.y);
    out.push({ x: p.x, y: best });
  }
  return out;
}

export function recordsFor(records: readonly PersonalRecord[], workoutId: string): PersonalRecord[] {
  return records.filter((r) => r.workoutId === workoutId);
}

/* ───────────── Zones ───────────── */

/** ms spent in each HR zone (index 0 = zone 1). Gaps longer than 10 s are capped. */
export function timeInHrZones(points: readonly HeartRatePoint[], zoneOf: (bpm: number) => number | null): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let i = 1; i < points.length; i++) {
    const dt = Math.min(10000, Math.max(0, points[i].elapsedMs - points[i - 1].elapsedMs));
    const z = zoneOf(points[i].bpm);
    if (z && z >= 1 && z <= 5) out[z - 1] += dt;
  }
  return out;
}

/** HR points from the record, falling back to per-stroke HR. */
export function heartRatePoints(record: Pick<WorkoutRecord, 'heartRate' | 'strokes'>): HeartRatePoint[] {
  if (record.heartRate.length > 1) return record.heartRate;
  return record.strokes.filter((s) => s.heartRate != null && s.heartRate > 0).map((s) => ({ elapsedMs: s.elapsedMs, bpm: s.heartRate as number }));
}

/** Zone (1-5) a pace falls in; slower than zone 1 → 1, faster than zone 5 → 5. */
export function paceZone(pace: number, zones: readonly TrainingZone[]): number | null {
  if (!(pace > 0) || zones.length === 0) return null;
  let bestZ: number | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const lo = Math.min(z.paceMinMsPer500, z.paceMaxMsPer500);
    const hi = Math.max(z.paceMinMsPer500, z.paceMaxMsPer500);
    if (pace >= lo && pace <= hi) return z.zone;
    const d = pace < lo ? lo - pace : pace - hi;
    if (d < bestDist) {
      bestDist = d;
      bestZ = z.zone;
    }
  }
  return bestZ;
}

export function timeInPaceZones(strokes: readonly StrokeSample[], zones: readonly TrainingZone[]): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let i = 1; i < strokes.length; i++) {
    const dt = Math.min(10000, Math.max(0, strokes[i].elapsedMs - strokes[i - 1].elapsedMs));
    const z = paceZone(strokes[i].paceMsPer500, zones);
    if (z) out[z - 1] += dt;
  }
  return out;
}

/** Tanaka estimate. */
export function estimateMaxHr(birthYear: number | null, now: number): number | null {
  if (!birthYear || birthYear < 1900) return null;
  const age = new Date(now).getFullYear() - birthYear;
  if (age < 5 || age > 110) return null;
  return Math.round(208 - 0.7 * age);
}

/* ───────────── Plan overlay ───────────── */

/** Elapsed ms at which the rower reached `distanceM` (linear between strokes). */
export function elapsedAtDistance(strokes: readonly StrokeSample[], distanceM: number): number | null {
  if (strokes.length === 0) return null;
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (s.distanceM >= distanceM) {
      const prev = i > 0 ? strokes[i - 1] : { distanceM: 0, elapsedMs: 0 };
      const span = s.distanceM - prev.distanceM;
      const f = span > 0 ? (distanceM - prev.distanceM) / span : 0;
      return prev.elapsedMs + f * (s.elapsedMs - prev.elapsedMs);
    }
  }
  return strokes[strokes.length - 1].elapsedMs;
}

/** Target pace as a step series over elapsed time, from the plan's pace plan or flat target. */
export function planTargetSeries(plan: WorkoutPlan | null, record: Pick<WorkoutRecord, 'strokes' | 'elapsedMs' | 'distanceM'>): XY[] {
  if (!plan) return [];
  const pp = plan.pacePlan;
  const total = record.elapsedMs || record.strokes[record.strokes.length - 1]?.elapsedMs || 0;
  if (pp && pp.segments.length > 0 && (plan.kind === 'single-distance' || plan.kind === 'single-time')) {
    const toX = (f: number): number | null => {
      if (plan.kind === 'single-time') return f * (plan.value ?? total);
      return elapsedAtDistance(record.strokes, f * (plan.value ?? record.distanceM));
    };
    const pts: XY[] = [];
    for (const seg of pp.segments) {
      const x = toX(seg.startFraction);
      if (x != null && seg.targetPaceMsPer500 > 0) pts.push({ x, y: seg.targetPaceMsPer500 });
    }
    const last = pp.segments[pp.segments.length - 1];
    const xe = toX(last.endFraction);
    if (xe != null && pts.length) pts.push({ x: Math.min(xe, total || xe), y: last.targetPaceMsPer500 });
    return pts;
  }
  const target = plan.target?.paceMsPer500;
  if (target && target > 0 && total > 0) return [{ x: 0, y: target }, { x: total, y: target }];
  return [];
}

/** Per-stroke metric against cumulative distance (for comparing two pieces). */
export function byDistance(strokes: readonly StrokeSample[], pick: (s: StrokeSample) => number | null): XY[] {
  const out: XY[] = [];
  for (const s of strokes) {
    const v = pick(s);
    if (v != null && Number.isFinite(v) && v > 0) out.push({ x: s.distanceM, y: v });
  }
  return out;
}

/* ───────────── Calculators ───────────── */

/** Inverse of the Concept2 kcal/h formula. */
export function calPerHourToWatts(calPerHour: number): number {
  return calPerHour > 300 ? (calPerHour - 300) / (4 * 0.8604) : 0;
}

export type SolveKey = 'time' | 'distance' | 'pace';

/**
 * Given time (ms), distance (m), pace (ms/500) — any of which may be NaN — and which field
 * should be computed, returns the solved value (NaN if impossible).
 */
export function solveTimeDistancePace(target: SolveKey, timeMs: number, distanceM: number, paceMs: number): number {
  if (target === 'time') return distanceM > 0 && paceMs > 0 ? (distanceM / 500) * paceMs : NaN;
  if (target === 'distance') return timeMs > 0 && paceMs > 0 ? (timeMs / paceMs) * 500 : NaN;
  return timeMs > 0 && distanceM > 0 ? (timeMs / distanceM) * 500 : NaN;
}

/* ───────────── Dashboard tile names ───────────── */

export const METRIC_NAMES: Record<MetricKey, { name: string; hint: string }> = {
  pace: { name: 'Pace', hint: 'Current /500m split' },
  avgPace: { name: 'Average pace', hint: 'Workout average /500m' },
  splitPace: { name: 'Split pace', hint: 'Average of the split in progress' },
  watts: { name: 'Watts', hint: 'Power of the last stroke' },
  avgWatts: { name: 'Average watts', hint: 'Workout average power' },
  strokeRate: { name: 'Stroke rate', hint: 'Strokes per minute' },
  avgStrokeRate: { name: 'Average rate', hint: 'Workout average spm' },
  heartRate: { name: 'Heart rate', hint: 'From PM or HR strap' },
  hrZone: { name: 'HR zone', hint: 'Zone 1-5 from your profile' },
  elapsed: { name: 'Elapsed time', hint: 'Workout clock' },
  distance: { name: 'Distance', hint: 'Metres rowed' },
  remaining: { name: 'Piece', hint: 'Distance on distance pieces, time on time pieces' },
  calories: { name: 'Calories', hint: 'Total kcal' },
  calPerHour: { name: 'Cal/hour', hint: 'Current kcal/h' },
  dragFactor: { name: 'Drag factor', hint: 'Flywheel resistance' },
  driveLength: { name: 'Drive length', hint: 'Handle travel per stroke' },
  driveTime: { name: 'Drive time', hint: 'Duration of the drive' },
  recoveryTime: { name: 'Recovery time', hint: 'Duration of the recovery' },
  driveRecoveryRatio: { name: 'Drive : recovery', hint: 'Rhythm ratio' },
  strokeDistance: { name: 'Distance / stroke', hint: 'Metres per stroke' },
  peakForce: { name: 'Peak force', hint: 'Highest handle force' },
  avgForce: { name: 'Average force', hint: 'Mean force over the drive' },
  workPerStroke: { name: 'Work / stroke', hint: 'Joules per stroke' },
  strokeCount: { name: 'Stroke count', hint: 'Strokes so far' },
  speed: { name: 'Speed (m/s)', hint: 'Metres per second' },
  speedKmh: { name: 'Speed (km/h)', hint: 'Kilometres per hour' },
  projectedFinish: { name: 'Projected finish', hint: 'Finish time (distance piece) or distance (time piece)' },
  projectedDistance: { name: 'Projected distance', hint: 'Final distance at current pace' },
  wattsPerKg: { name: 'Watts / kg', hint: 'Needs your weight' },
  paceBoatGap: { name: 'Pace boat gap', hint: 'Ahead / behind the target' },
  strokeScore: { name: 'Stroke score', hint: 'Force-curve quality 0-100' },
};

export const ALL_METRIC_KEYS = Object.keys(METRIC_NAMES) as MetricKey[];

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list.slice();
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}
