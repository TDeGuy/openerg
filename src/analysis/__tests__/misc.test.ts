import { describe, expect, it } from 'vitest';
import {
  bestEffort,
  computePersonalRecords,
  describeFlag,
  describePacingProfile,
  describeShape,
  dragFactorAdvice,
  FLAG_COPY,
  heartRateZone,
  PACING_COPY,
  predictRaces,
  SHAPE_COPY,
  trainingZones,
  trends,
  wattsPerKg,
  weightAdjustedDistance,
  weightAdjustedTime,
} from '@/analysis';
import type { AthleteProfile, ForceCurveShape, PacingProfile, TechniqueFlag } from '@/core/types';
import { paceToWatts } from '@/core/units';
import { badNumbers, listItem, makeRecord } from './fixtures';

const profile = (p: Partial<AthleteProfile> = {}): AthleteProfile => ({
  name: '',
  weightKg: 80,
  heightCm: 183,
  birthYear: null,
  sex: null,
  maxHeartRate: 190,
  restingHeartRate: 50,
  reference2kMs: 420000,
  ...p,
});

describe('zones', () => {
  it('builds 5 zones from the reference 2k with Karvonen HR', () => {
    const z = trainingZones(profile());
    const w2k = paceToWatts(105000);
    expect(z.map((x) => x.name)).toEqual(['UT2', 'UT1', 'AT', 'TR', 'AN']);
    expect(z[0].wattsMin).toBe(Math.round(0.55 * w2k));
    expect(z[3].wattsMax).toBe(Math.round(1.03 * w2k));
    expect(z[1].hrMin).toBe(Math.round(50 + 0.7 * 140));
    for (const x of z) {
      expect(x.paceMinMsPer500).toBeLessThan(x.paceMaxMsPer500);
      expect(x.strokeRateMin).toBeLessThan(x.strokeRateMax);
    }
    // Zones get faster as they go up.
    for (let i = 1; i < z.length; i++) expect(z[i].paceMaxMsPer500).toBeLessThanOrEqual(z[i - 1].paceMinMsPer500 + 1);
  });
  it('uses % max HR without resting HR, null HR without any HR info, [] without 2k', () => {
    expect(trainingZones(profile({ restingHeartRate: null }))[0].hrMin).toBe(Math.round(0.65 * 190));
    const z = trainingZones(profile({ maxHeartRate: null, restingHeartRate: null }));
    expect(z[0].hrMin).toBeNull();
    expect(trainingZones(profile({ reference2kMs: null }))).toEqual([]);
  });
  it('heartRateZone', () => {
    const p = profile();
    expect(heartRateZone(0, p)).toBeNull();
    expect(heartRateZone(100, p)).toBeNull();
    expect(heartRateZone(135, p)).toBe(1);
    expect(heartRateZone(155, p)).toBe(2);
    expect(heartRateZone(165, p)).toBe(3);
    expect(heartRateZone(175, p)).toBe(4);
    expect(heartRateZone(200, p)).toBe(5);
    expect(heartRateZone(150, profile({ maxHeartRate: null, birthYear: null }))).toBeNull();
    expect(heartRateZone(150, profile({ maxHeartRate: null, birthYear: new Date().getFullYear() - 30 }))).not.toBeNull();
  });
});

describe('predictRaces', () => {
  it("applies Paul's law (+5 s/500m per doubling)", () => {
    const p = predictRaces(2000, 420000);
    const by = (label: string) => p.find((x) => x.label.startsWith(label))!;
    expect(by('2,000m').predictedMs).toBe(420000);
    expect(by('1,000m').paceMsPer500).toBe(100000);
    expect(by('1,000m').predictedMs).toBe(200000);
    expect(by('500m').paceMsPer500).toBe(95000);
    expect(by('6,000m').paceMsPer500).toBe(Math.round(105000 + 5000 * Math.log2(3)));
    expect(by('Marathon').distanceM).toBe(42195);
    expect(p).toHaveLength(11);
  });
  it('represents time events as predicted distance at a fixed duration', () => {
    const p = predictRaces(2000, 420000);
    const t30 = p.find((x) => x.label.startsWith('30:00'))!;
    expect(t30.predictedMs).toBe(1800000);
    expect(t30.distanceM).toBeGreaterThan(7000);
    expect(t30.distanceM).toBeLessThan(8500);
    expect((t30.paceMsPer500 * t30.distanceM) / 500).toBeCloseTo(1800000, -3);
    const t60 = p.find((x) => x.label.startsWith('60:00'))!;
    expect(t60.distanceM).toBeGreaterThan(t30.distanceM);
    expect(t60.paceMsPer500).toBeGreaterThan(t30.paceMsPer500);
  });
  it('invalid input → []', () => {
    expect(predictRaces(0, 1000)).toEqual([]);
    expect(predictRaces(2000, NaN)).toEqual([]);
  });
});

describe('personal records', () => {
  it('finds best results with PM tolerance and excludes intervals / simulated', () => {
    const items = [
      listItem({ id: 'a', distanceM: 2000, elapsedMs: 425000 }),
      listItem({ id: 'b', distanceM: 2003, elapsedMs: 420000 }), // rowed past the line
      listItem({ id: 'c', distanceM: 2000, elapsedMs: 400000, simulated: true }),
      listItem({ id: 'd', distanceM: 2000, elapsedMs: 390000, workoutType: 'fixed-distance-interval' }),
      listItem({ id: 'e', distanceM: 7600, elapsedMs: 1800000 }),
      listItem({ id: 'f', distanceM: 7700, elapsedMs: 1800400 }),
      listItem({ id: 'g', distanceM: 1500, elapsedMs: 330000 }),
    ];
    const prs = computePersonalRecords(items);
    const twoK = prs.find((p) => p.event === '2000m')!;
    expect(twoK.workoutId).toBe('b');
    expect(twoK.result).toBe(Math.round((420000 * 2000) / 2003));
    expect(twoK.eventType).toBe('distance');
    const t30 = prs.find((p) => p.event === '30:00')!;
    expect(t30.workoutId).toBe('f');
    expect(t30.eventType).toBe('time');
    expect(t30.result).toBe(Math.round((7700 * 1800000) / 1800400));
    expect(prs.find((p) => p.event === '1500m')).toBeUndefined();
    expect(prs.map((p) => p.event)).toEqual(['2000m', '30:00']);
  });
  it('empty → []', () => {
    expect(computePersonalRecords([])).toEqual([]);
    expect(computePersonalRecords([listItem({ distanceM: 0, elapsedMs: 0 })])).toEqual([]);
  });
});

describe('bestEffort', () => {
  it('finds the fastest window', () => {
    // 5k at 2:00 with a fast 1k from 2000–3000 m at 1:50.
    const r = makeRecord({ distanceM: 5000, paceAt: (f) => (f >= 0.4 && f < 0.6 ? 110000 : 120000) });
    const b = bestEffort(r, 1000)!;
    expect(b.startM).toBeCloseTo(2000, -1);
    expect(b.timeMs).toBeCloseTo(220000, -2);
    expect(b.paceMsPer500).toBeCloseTo(110000, -2);
    const whole = bestEffort(r, 5000)!;
    expect(whole.timeMs).toBeCloseTo(r.elapsedMs, -1);
  });
  it('null when too short or no strokes', () => {
    const r = makeRecord({ distanceM: 1000, paceAt: () => 110000 });
    expect(bestEffort(r, 2000)).toBeNull();
    expect(bestEffort({ ...r, strokes: [] }, 500)).toBeNull();
    expect(bestEffort(r, 0)).toBeNull();
  });
});

describe('trends', () => {
  it('weekly buckets start Monday and include empty weeks', () => {
    const mon = new Date(2026, 10, 2, 8).getTime(); // Mon 2 Nov 2026
    const sun = new Date(2026, 10, 8, 20).getTime(); // Sun 8 Nov
    const later = new Date(2026, 10, 25, 7).getTime(); // Wed 25 Nov
    const t = trends(
      [
        listItem({ startedAt: mon, distanceM: 2000, elapsedMs: 420000, avgWatts: 300 }),
        listItem({ startedAt: sun, distanceM: 6000, elapsedMs: 1500000, avgWatts: 200 }),
        listItem({ startedAt: later, distanceM: 5000, elapsedMs: 1200000, avgWatts: 220 }),
      ],
      'week',
    );
    expect(t).toHaveLength(4);
    expect(new Date(t[0].periodStart).getDay()).toBe(1);
    expect(t[0].sessions).toBe(2);
    expect(t[0].metres).toBe(8000);
    expect(t[0].avgPaceMsPer500).toBe(Math.round((1920000 / 8000) * 500));
    expect(t[0].avgWatts).toBe(Math.round((300 * 420000 + 200 * 1500000) / 1920000));
    expect(t[1].sessions).toBe(0);
    expect(t[2].sessions).toBe(0);
    expect(t[3].periodStart).toBe(new Date(2026, 10, 23).getTime());
  });
  it('monthly buckets', () => {
    const t = trends([listItem({ startedAt: new Date(2026, 0, 15).getTime() }), listItem({ startedAt: new Date(2026, 3, 2).getTime() })], 'month');
    expect(t.map((x) => new Date(x.periodStart).getMonth())).toEqual([0, 1, 2, 3]);
    expect(t[1].avgPaceMsPer500).toBe(0);
  });
  it('empty → []', () => {
    expect(trends([], 'week')).toEqual([]);
  });
});

describe('weight adjustment & watts/kg', () => {
  it('uses the Concept2 formula', () => {
    const kg270 = 270 / 2.20462;
    expect(weightAdjustedTime(420000, kg270)).toBeCloseTo(420000, 3);
    const wf = Math.pow((60 * 2.20462) / 270, 0.222);
    expect(weightAdjustedTime(420000, 60)).toBeCloseTo(420000 * wf, 3);
    expect(weightAdjustedDistance(7000, 60)).toBeCloseTo(7000 / wf, 3);
    expect(weightAdjustedTime(420000, 0)).toBe(420000);
  });
  it('wattsPerKg', () => {
    expect(wattsPerKg(300, 75)).toBe(4);
    expect(wattsPerKg(300, null)).toBe(0);
    expect(wattsPerKg(300, 0)).toBe(0);
  });
});

describe('dragFactorAdvice', () => {
  it('per machine ranges', () => {
    expect(dragFactorAdvice(125, 'rower').severity).toBe('good');
    expect(dragFactorAdvice(200, 'rower').severity).toBe('warn');
    expect(dragFactorAdvice(90, 'rower').severity).toBe('info');
    expect(dragFactorAdvice(100, 'skierg').severity).toBe('good');
    expect(dragFactorAdvice(30, 'bikeerg').severity).toBe('good');
    expect(dragFactorAdvice(0, 'rower').title).toMatch(/unknown/i);
  });
});

describe('describe*', () => {
  const flags: TechniqueFlag[] = [
    'slow-catch', 'early-peak-fade', 'late-peak', 'double-peak', 'weak-finish', 'soft-drive', 'jerky-drive', 'short-stroke',
    'overreaching', 'rushed-recovery', 'slow-recovery', 'inconsistent-strokes', 'rate-too-high', 'rate-too-low', 'low-power-per-stroke',
  ];
  const shapes: ForceCurveShape[] = ['ideal', 'front-loaded', 'back-loaded', 'double-peak', 'flat', 'spiky'];
  const pacing: PacingProfile[] = ['even', 'negative-split', 'positive-split', 'fly-and-die', 'u-shaped', 'erratic', 'unknown'];
  it('covers every enum member with non-empty copy', () => {
    expect(Object.keys(FLAG_COPY).sort()).toEqual([...flags].sort());
    expect(Object.keys(SHAPE_COPY).sort()).toEqual([...shapes].sort());
    expect(Object.keys(PACING_COPY).sort()).toEqual([...pacing].sort());
    for (const f of flags) {
      const d = describeFlag(f);
      expect(d.title && d.detail && d.drill).toBeTruthy();
    }
    for (const s of shapes) expect(describeShape(s).detail).toBeTruthy();
    for (const p of pacing) expect(describePacingProfile(p).title).toBeTruthy();
  });
  it('no NaN in any output', () => {
    expect(badNumbers(trainingZones(profile()))).toEqual([]);
    expect(badNumbers(predictRaces(500, 90000))).toEqual([]);
  });
});
