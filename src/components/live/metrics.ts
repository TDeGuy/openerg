/** Single registry of every dashboard MetricKey: label, formatted value, unit, tone. */
import { heartRateZone, wattsPerKg } from '@/analysis';
import type {
  AppSettings,
  AthleteProfile,
  ForceCurveAnalysis,
  LiveMetrics,
  MachineType,
  MetricKey,
  PaceBoatState,
  WorkoutPlan,
} from '@/core/types';
import { convertForce, formatDuration, formatPace, paceUnit } from '@/core/units';

import { type LiveProgress, type LiveTarget, type LiveTone, paceTone, rateTone } from './progress';

export interface MetricContext {
  m: LiveMetrics;
  profile: AthleteProfile;
  forceUnit: AppSettings['forceUnit'];
  plan: WorkoutPlan | null;
  paceBoat: PaceBoatState | null;
  analysis: ForceCurveAnalysis | null;
  target: LiveTarget;
  progress: LiveProgress | null;
  /** Connected machine; BikeErg shows pace per 1000 m. */
  machine?: MachineType;
}

export interface MetricValue {
  /** Overrides the registry label (e.g. "Distance left" while counting down). */
  label?: string;
  value: string;
  unit?: string;
  tone?: LiveTone;
  /** HR zone 1-5 → coloured with the palette's zone colours. */
  zone?: 1 | 2 | 3 | 4 | 5 | null;
}

export interface MetricDef {
  label: string;
  /** Longer explanation for the dashboard settings screen. */
  description: string;
  compute(ctx: MetricContext): MetricValue;
}

const DASH = '–';
const int = (v: number) => (v > 0 && Number.isFinite(v) ? String(Math.round(v)) : DASH);
const fixed = (v: number, d: number) => (v > 0 && Number.isFinite(v) ? v.toFixed(d) : DASH);
const thousands = (v: number) => (v > 0 && Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '0');
const clock = (ms: number) => formatDuration(ms, { tenths: false });

function force(ctx: MetricContext, n: number): MetricValue {
  const v = convertForce(n, ctx.forceUnit);
  return { value: ctx.forceUnit === 'N' ? int(v) : fixed(v, 1), unit: ctx.forceUnit };
}

/** Counts the target down; with no target (just row) it shows elapsed time. */
function remaining(ctx: MetricContext): MetricValue {
  const p = ctx.progress;
  if (!p) return { label: 'Time', value: clock(ctx.m.elapsedMs) };
  if (p.unit === 'distance') return { label: 'Distance left', value: thousands(p.remaining), unit: 'm' };
  if (p.unit === 'time') return { label: 'Time left', value: clock(p.remaining) };
  return { label: 'Cal left', value: String(Math.round(p.remaining)), unit: 'cal' };
}

/** Distance counts down whenever the piece / interval has a distance target, else up. */
function distance(ctx: MetricContext): MetricValue {
  const p = ctx.progress;
  if (p?.unit === 'distance') return { label: 'Distance left', value: thousands(p.remaining), unit: 'm' };
  return { value: thousands(ctx.m.distanceM), unit: 'm' };
}

/** Time counts down whenever the piece / interval has a time target, else up. */
function time(ctx: MetricContext): MetricValue {
  const p = ctx.progress;
  if (p?.unit === 'time') return { label: 'Time left', value: clock(p.remaining) };
  return { value: clock(ctx.m.elapsedMs) };
}

/** Calories count down whenever the piece / interval has a calorie target, else up. */
function calories(ctx: MetricContext): MetricValue {
  const p = ctx.progress;
  if (p?.unit === 'calorie') return { label: 'Cal left', value: String(Math.round(p.remaining)), unit: 'cal' };
  return { value: thousands(ctx.m.calories), unit: 'cal' };
}

function projectedFinish(ctx: MetricContext): MetricValue {
  const { m, plan } = ctx;
  if (m.projectedWorkTimeMs > 0) return { value: clock(m.projectedWorkTimeMs) };
  if (plan?.kind === 'single-distance' && plan.value && m.avgPaceMsPer500 > 0) {
    return { value: clock((plan.value / 500) * m.avgPaceMsPer500) };
  }
  return { value: DASH };
}

function projectedDistance(ctx: MetricContext): MetricValue {
  const { m, plan } = ctx;
  if (m.projectedWorkDistanceM > 0) return { value: thousands(m.projectedWorkDistanceM), unit: 'm' };
  if (plan?.kind === 'single-time' && plan.value && m.avgPaceMsPer500 > 0) {
    return { value: thousands((plan.value / m.avgPaceMsPer500) * 500), unit: 'm' };
  }
  return { value: DASH };
}

export const METRICS: Record<MetricKey, MetricDef> = {
  pace: {
    label: 'Pace',
    description: 'Current pace per 500 m (1000 m on the BikeErg), coloured against your target.',
    compute: (c) => ({ value: formatPace(c.m.paceMsPer500, c.machine), unit: c.target.next && !c.target.strokeRate ? `${paceUnit(c.machine)} · next ${c.target.next}` : paceUnit(c.machine), tone: paceTone(c.m.paceMsPer500, c.target.paceMsPer500) }),
  },
  avgPace: {
    label: 'Avg pace',
    description: 'Average pace for the workout so far.',
    compute: (c) => ({ value: formatPace(c.m.avgPaceMsPer500, c.machine), unit: paceUnit(c.machine), tone: paceTone(c.m.avgPaceMsPer500, c.target.paceMsPer500) }),
  },
  splitPace: {
    label: 'Split pace',
    description: 'Average pace of the split in progress.',
    compute: (c) => ({ value: formatPace(c.m.splitAvgPaceMsPer500, c.machine), unit: paceUnit(c.machine), tone: paceTone(c.m.splitAvgPaceMsPer500, c.target.paceMsPer500) }),
  },
  watts: { label: 'Watts', description: 'Current power.', compute: (c) => ({ value: int(c.m.watts), unit: 'W' }) },
  avgWatts: { label: 'Avg watts', description: 'Average power so far.', compute: (c) => ({ value: int(c.m.avgWatts), unit: 'W' }) },
  strokeRate: {
    label: 'Rate',
    description: 'Strokes per minute, coloured against your target rate.',
    compute: (c) => ({ value: int(c.m.strokeRate), unit: c.target.next ? `spm · next ${c.target.next}` : 'spm', tone: rateTone(c.m.strokeRate, c.target.strokeRate) }),
  },
  avgStrokeRate: { label: 'Avg rate', description: 'Average stroke rate.', compute: (c) => ({ value: int(c.m.avgStrokeRate), unit: 'spm' }) },
  heartRate: {
    label: 'Heart rate',
    description: 'Heart rate, coloured by training zone.',
    compute: (c) => {
      const hr = c.m.heartRate;
      if (!hr) return { value: DASH, unit: 'bpm' };
      return { value: String(Math.round(hr)), unit: 'bpm', zone: heartRateZone(hr, c.profile) };
    },
  },
  hrZone: {
    label: 'HR zone',
    description: 'Training zone from your max / resting heart rate.',
    compute: (c) => {
      const hr = c.m.heartRate;
      const z = hr ? heartRateZone(hr, c.profile) : null;
      return z ? { value: `Z${z}`, zone: z } : { value: DASH };
    },
  },
  elapsed: { label: 'Time', description: 'Time rowed; counts down when the piece has a time target.', compute: time },
  distance: { label: 'Distance', description: 'Distance rowed; counts down when the piece has a distance target.', compute: distance },
  remaining: { label: 'Piece', description: 'Shows whatever the workout is set by: distance on distance pieces, time on time pieces (counting down); time when just rowing.', compute: remaining },
  calories: { label: 'Calories', description: 'Calories burned; counts down when the piece has a calorie target.', compute: calories },
  calPerHour: { label: 'Cal/hr', description: 'Calorie burn rate.', compute: (c) => ({ value: thousands(c.m.caloriesPerHour), unit: 'cal/h' }) },
  dragFactor: { label: 'Drag', description: 'Drag factor of the flywheel.', compute: (c) => ({ value: int(c.m.dragFactor) }) },
  driveLength: { label: 'Drive length', description: 'Handle travel per drive.', compute: (c) => ({ value: fixed(c.m.driveLengthM, 2), unit: 'm' }) },
  driveTime: { label: 'Drive time', description: 'Duration of the drive.', compute: (c) => ({ value: fixed(c.m.driveTimeMs / 1000, 2), unit: 's' }) },
  recoveryTime: { label: 'Recovery', description: 'Duration of the recovery.', compute: (c) => ({ value: fixed(c.m.recoveryTimeMs / 1000, 2), unit: 's' }) },
  driveRecoveryRatio: {
    label: 'Ratio',
    description: 'Drive : recovery ratio — aim for about 1:2 or longer.',
    compute: (c) => {
      const { driveTimeMs: d, recoveryTimeMs: r } = c.m;
      if (!(d > 0) || !(r > 0)) return { value: DASH };
      const ratio = r / d;
      return { value: `1:${ratio.toFixed(1)}`, tone: ratio >= 1.6 ? 'good' : ratio >= 1.2 ? 'warn' : 'bad' };
    },
  },
  strokeDistance: { label: 'Dist/stroke', description: 'Metres travelled per stroke.', compute: (c) => ({ value: fixed(c.m.strokeDistanceM, 1), unit: 'm' }) },
  peakForce: { label: 'Peak force', description: 'Peak handle force of the last stroke.', compute: (c) => force(c, c.m.peakForceN) },
  avgForce: { label: 'Avg force', description: 'Average handle force of the last drive.', compute: (c) => force(c, c.m.avgForceN) },
  workPerStroke: { label: 'Work', description: 'Work per stroke.', compute: (c) => ({ value: int(c.m.workPerStrokeJ), unit: 'J' }) },
  strokeCount: { label: 'Strokes', description: 'Stroke count.', compute: (c) => ({ value: String(Math.max(0, Math.round(c.m.strokeCount))) }) },
  speed: { label: 'Speed', description: 'Speed in metres per second.', compute: (c) => ({ value: fixed(c.m.speedMps, 2), unit: 'm/s' }) },
  speedKmh: { label: 'Speed', description: 'Speed in kilometres per hour.', compute: (c) => ({ value: fixed(c.m.speedMps * 3.6, 1), unit: 'km/h' }) },
  projectedFinish: { label: 'Proj. finish', description: 'Projected finish time at your current average.', compute: projectedFinish },
  projectedDistance: { label: 'Proj. distance', description: 'Projected distance at your current average.', compute: projectedDistance },
  wattsPerKg: {
    label: 'W/kg',
    description: 'Power to weight (needs your weight in the profile).',
    compute: (c) => (c.profile.weightKg ? { value: fixed(wattsPerKg(c.m.watts, c.profile.weightKg), 2), unit: 'W/kg' } : { value: DASH, unit: 'W/kg' }),
  },
  paceBoatGap: {
    label: 'Pace boat',
    description: 'Gap to the pace boat in metres.',
    compute: (c) => {
      const b = c.paceBoat;
      if (!b) return { value: DASH };
      const s = b.gapM > 0.5 ? '+' : b.gapM < -0.5 ? '−' : '±';
      return { value: `${s}${Math.abs(b.gapM).toFixed(0)}`, unit: 'm', tone: b.gapM >= 0 ? 'good' : 'bad' };
    },
  },
  strokeScore: {
    label: 'Stroke score',
    description: 'Force-curve quality score of the last stroke (0-100).',
    compute: (c) => {
      const a = c.analysis;
      if (!a?.valid) return { value: DASH };
      return { value: String(Math.round(a.score)), tone: a.score >= 80 ? 'good' : a.score >= 60 ? 'warn' : 'bad' };
    },
  },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export type TileValue = MetricValue & { id: MetricKey; label: string };

export function tileValues(keys: readonly MetricKey[], ctx: MetricContext): TileValue[] {
  return keys.filter((k) => k in METRICS).map((k) => ({ id: k, label: METRICS[k].label, ...METRICS[k].compute(ctx) }) as TileValue);
}
