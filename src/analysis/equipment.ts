/** Weight adjustment, W/kg and drag factor guidance. */
import type { Insight, MachineType } from '@/core/types';
import { pos } from './util';

/** Concept2 weight correction factor Wf = (weight lb / 270)^0.222. */
export function weightFactor(weightKg: number): number {
  const kg = pos(weightKg);
  if (kg <= 0) return 1;
  return Math.pow((kg * 2.20462) / 270, 0.222);
}

/** Concept2 weight adjustment: corrected time = Wf × actual time. */
export function weightAdjustedTime(timeMs: number, weightKg: number): number {
  return pos(timeMs) * weightFactor(weightKg);
}

/** Concept2 weight adjustment: corrected distance = actual distance / Wf. */
export function weightAdjustedDistance(distanceM: number, weightKg: number): number {
  return pos(distanceM) / weightFactor(weightKg);
}

export function wattsPerKg(watts: number, weightKg: number | null): number {
  const kg = pos(weightKg);
  return kg > 0 ? pos(watts) / kg : 0;
}

/**
 * Typical drag factor ranges. RowErg: most rowers 110–150 (Concept2 suggests ~115–130 for
 * women and lighter men, 125–140 for heavier men). SkiErg: 80–140. BikeErg: 15–60 (its scale
 * is much lower than the other machines).
 */
export const DRAG_RANGES: Record<MachineType, { low: number; high: number; name: string }> = {
  rower: { low: 110, high: 150, name: 'RowErg' },
  skierg: { low: 80, high: 140, name: 'SkiErg' },
  bikeerg: { low: 15, high: 60, name: 'BikeErg' },
};

/** Machine-specific wording, so the SkiErg and BikeErg advice never talks about boats or catches. */
const DRAG_WORDS: Record<MachineType, { light: string; heavy: string; strain: string; people: string }> = {
  rower: {
    light: 'it feels like a fast, light boat. Fine for high-rate work, but it can encourage short, rushed strokes and needs a very quick catch',
    heavy: 'it feels like a slow, heavy boat',
    strain: 'High drag loads the lower back',
    people: 'most rowers',
  },
  skierg: {
    light: 'each pull feels light and quick. Fine for sprints, but it can encourage short, snatched pulls that skip the hinge',
    heavy: 'each pull feels heavy and slow',
    strain: 'High drag loads the shoulders and lower back',
    people: 'most skiers',
  },
  bikeerg: {
    light: 'it feels like spinning a low gear. Fine for high-cadence work, but it is easy to spin without pushing',
    heavy: 'it feels like pushing a big gear',
    strain: 'High drag loads the knees',
    people: 'most riders',
  },
};

export function dragFactorAdvice(dragFactor: number, machine: MachineType): Insight {
  const r = DRAG_RANGES[machine] ?? DRAG_RANGES.rower;
  const w = DRAG_WORDS[machine] ?? DRAG_WORDS.rower;
  const df = pos(dragFactor);
  if (df <= 0) {
    return {
      severity: 'info',
      title: 'Drag factor unknown',
      detail: `Check it on the PM5 (More Options → Display Drag Factor) and take a few strokes. A typical ${r.name} range is ${r.low}–${r.high}.`,
    };
  }
  const d = Math.round(df);
  if (df < r.low) {
    return {
      severity: 'info',
      title: `Light drag (${d})`,
      detail: `Below the typical ${r.low}–${r.high} range: ${w.light}. If it feels too light, raise the damper a notch. Dust in the fan housing also lowers drag, so give it a clean if the reading is low at a normal damper setting.`,
    };
  }
  if (df > r.high) {
    return {
      severity: 'warn',
      title: `Heavy drag (${d})`,
      detail: `Above the typical ${r.low}–${r.high} range: ${w.heavy}. ${w.strain} and tires you faster without making the workout better. Lower the damper; ${w.people} are fastest and healthiest in the middle of the range.`,
    };
  }
  return {
    severity: 'good',
    title: `Drag factor ${d} looks good`,
    detail: `Inside the typical ${r.low}–${r.high} range for the ${r.name}. Keep it the same between sessions so your results are comparable.`,
  };
}
