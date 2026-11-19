/**
 * Standard rowing training zones (UT2 / UT1 / AT / TR / AN).
 *
 * Power bands, % of reference-2k average watts (paces derived via the cubic Concept2 relation):
 *   UT2 55–70 %, UT1 70–80 %, AT 80–90 %, TR 90–103 %, AN 103–125 %.
 * Heart-rate bands:
 *   Karvonen (% heart-rate reserve) when resting HR is known:
 *     UT2 55–70 %, UT1 70–80 %, AT 80–85 %, TR 85–95 %, AN 95–100 %.
 *   Otherwise % of max HR: UT2 65–75 %, UT1 75–82 %, AT 82–88 %, TR 88–94 %, AN 94–100 %.
 *   Max HR falls back to Tanaka (208 − 0.7 × age) when only birth year is known.
 * Stroke rates: UT2 18–20, UT1 20–24, AT 24–28, TR 28–32, AN 32–40 spm.
 */
import type { AthleteProfile, TrainingZone } from '@/core/types';
import { paceToWatts, wattsToPace } from '@/core/units';
import { pos } from './util';

type Z = 1 | 2 | 3 | 4 | 5;

interface ZoneDef {
  zone: Z;
  name: string;
  description: string;
  power: [number, number];
  hrr: [number, number];
  hrMax: [number, number];
  rate: [number, number];
}

export const ZONE_DEFS: ZoneDef[] = [
  {
    zone: 1,
    name: 'UT2',
    description: 'Utilisation 2: easy aerobic base. Conversational, long steady pieces that build endurance and technique.',
    power: [0.55, 0.7],
    hrr: [0.55, 0.7],
    hrMax: [0.65, 0.75],
    rate: [18, 20],
  },
  {
    zone: 2,
    name: 'UT1',
    description: 'Utilisation 1: firm aerobic work. Steady but focused, able to speak in short sentences.',
    power: [0.7, 0.8],
    hrr: [0.7, 0.8],
    hrMax: [0.75, 0.82],
    rate: [20, 24],
  },
  {
    zone: 3,
    name: 'AT',
    description: 'Anaerobic threshold: comfortably hard, sustainable for about 20–40 minutes. Raises the pace you can hold.',
    power: [0.8, 0.9],
    hrr: [0.8, 0.85],
    hrMax: [0.82, 0.88],
    rate: [24, 28],
  },
  {
    zone: 4,
    name: 'TR',
    description: 'Transport: VO₂max intervals around 2k race pace that build maximal aerobic power.',
    power: [0.9, 1.03],
    hrr: [0.85, 0.95],
    hrMax: [0.88, 0.94],
    rate: [28, 32],
  },
  {
    zone: 5,
    name: 'AN',
    description: 'Anaerobic: short, all-out efforts faster than 2k pace for speed and lactate tolerance.',
    power: [1.03, 1.25],
    hrr: [0.95, 1],
    hrMax: [0.94, 1],
    rate: [32, 40],
  },
];

function estimatedMaxHr(profile: AthleteProfile): number | null {
  const max = pos(profile?.maxHeartRate);
  if (max > 0) return max;
  const by = pos(profile?.birthYear);
  if (by > 1900) {
    const age = new Date().getFullYear() - by;
    if (age > 5 && age < 110) return Math.round(208 - 0.7 * age);
  }
  return null;
}

/** HR bands [min, max] per zone, or null if no max HR can be determined. */
export function heartRateBands(profile: AthleteProfile): [number, number][] | null {
  const max = estimatedMaxHr(profile);
  if (max == null) return null;
  const rest = pos(profile?.restingHeartRate);
  const useK = rest > 0 && rest < max;
  return ZONE_DEFS.map((z) => {
    const [a, b] = useK ? z.hrr : z.hrMax;
    return useK ? [Math.round(rest + a * (max - rest)), Math.round(rest + b * (max - rest))] : [Math.round(a * max), Math.round(b * max)];
  });
}

/** Zones from reference 2k (pace/watts) and max/resting HR. [] when no reference 2k. */
export function trainingZones(profile: AthleteProfile): TrainingZone[] {
  const ref = pos(profile?.reference2kMs);
  if (ref <= 0) return [];
  const w2k = paceToWatts(ref / 4);
  const hr = heartRateBands(profile);
  return ZONE_DEFS.map((z, i) => {
    const wMin = Math.round(w2k * z.power[0]);
    const wMax = Math.round(w2k * z.power[1]);
    return {
      zone: z.zone,
      name: z.name,
      description: z.description,
      // Faster pace (lower ms) corresponds to higher watts.
      paceMinMsPer500: Math.round(wattsToPace(w2k * z.power[1])),
      paceMaxMsPer500: Math.round(wattsToPace(w2k * z.power[0])),
      wattsMin: wMin,
      wattsMax: wMax,
      hrMin: hr ? hr[i][0] : null,
      hrMax: hr ? hr[i][1] : null,
      strokeRateMin: z.rate[0],
      strokeRateMax: z.rate[1],
    };
  });
}

/** HR zone 1–5; null when HR unknown, no max HR, or below UT2 (recovery). Above max → 5. */
export function heartRateZone(bpm: number, profile: AthleteProfile): 1 | 2 | 3 | 4 | 5 | null {
  const v = pos(bpm);
  if (v <= 0) return null;
  const bands = heartRateBands(profile);
  if (!bands) return null;
  if (v < bands[0][0]) return null;
  for (let i = bands.length - 1; i >= 0; i--) if (v >= bands[i][0]) return ZONE_DEFS[i].zone;
  return 1;
}
