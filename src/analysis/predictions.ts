/**
 * Race predictions with Paul's law: pace slows by 5 s/500m for every doubling of distance,
 * pace(d) = refPace + 5000 · log2(d / refDistance)  (ms/500m).
 *
 * Distance events: distanceM = event distance, predictedMs = predicted finishing time.
 * Time events (30:00, 60:00): predictedMs = the fixed duration and distanceM = the predicted
 * distance (whole metres) covered in that time, solved so that pace(d) · d / 500 = duration.
 * paceMsPer500/watts always describe the predicted average pace.
 */
import type { RacePrediction } from '@/core/types';
import { formatDistance, paceToWatts } from '@/core/units';
import { pos } from './util';

export const PREDICTION_DISTANCES: { distanceM: number; label: string }[] = [
  { distanceM: 100, label: '100m' },
  { distanceM: 500, label: '500m' },
  { distanceM: 1000, label: '1,000m' },
  { distanceM: 2000, label: '2,000m' },
  { distanceM: 5000, label: '5,000m' },
  { distanceM: 6000, label: '6,000m' },
  { distanceM: 10000, label: '10,000m' },
  { distanceM: 21097, label: 'Half marathon' },
  { distanceM: 42195, label: 'Marathon' },
];

export const PREDICTION_TIMES: { durationMs: number; label: string }[] = [
  { durationMs: 30 * 60000, label: '30:00' },
  { durationMs: 60 * 60000, label: '60:00' },
];

const PAUL_MS_PER_DOUBLING = 5000;

export function paulsLawPace(refDistanceM: number, refTimeMs: number, distanceM: number): number {
  const refPace = (refTimeMs / refDistanceM) * 500;
  return refPace + PAUL_MS_PER_DOUBLING * Math.log2(distanceM / refDistanceM);
}

export function predictRaces(refDistanceM: number, refTimeMs: number): RacePrediction[] {
  const rd = pos(refDistanceM);
  const rt = pos(refTimeMs);
  if (rd <= 0 || rt <= 0) return [];
  const out: RacePrediction[] = [];
  for (const e of PREDICTION_DISTANCES) {
    const pace = paulsLawPace(rd, rt, e.distanceM);
    if (!(pace > 0)) continue;
    out.push({ distanceM: e.distanceM, label: e.label, predictedMs: Math.round((pace * e.distanceM) / 500), paceMsPer500: Math.round(pace), watts: Math.round(paceToWatts(pace)) });
  }
  for (const e of PREDICTION_TIMES) {
    // time(d) is increasing in d: bisection.
    const timeAt = (d: number) => (paulsLawPace(rd, rt, d) * d) / 500;
    let lo = 1;
    let hi = 200000;
    if (!(timeAt(hi) > e.durationMs) || !(timeAt(lo) < e.durationMs)) continue;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (timeAt(mid) < e.durationMs) lo = mid;
      else hi = mid;
    }
    const d = Math.round(lo);
    const pace = (e.durationMs / lo) * 500;
    out.push({ distanceM: d, label: `${e.label} (${formatDistance(d)})`, predictedMs: e.durationMs, paceMsPer500: Math.round(pace), watts: Math.round(paceToWatts(pace)) });
  }
  return out;
}
