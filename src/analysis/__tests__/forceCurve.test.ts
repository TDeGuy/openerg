import { describe, expect, it } from 'vitest';
import { analyzeForceCurve, analyzeForceSession, idealForceCurve, resampleCurve } from '@/analysis';
import { badNumbers, curve, hump, stroke } from './fixtures';

describe('resampleCurve', () => {
  it('returns requested length and preserves endpoints', () => {
    const r = resampleCurve([0, 100, 200, 100, 0], 9);
    expect(r).toHaveLength(9);
    expect(r[0]).toBe(0);
    expect(r[4]).toBe(200);
    expect(r[2]).toBe(100);
  });
  it('defaults to 32 points and handles empty / single / NaN input', () => {
    expect(resampleCurve([])).toEqual(new Array(32).fill(0));
    expect(resampleCurve([50], 4)).toEqual([50, 50, 50, 50]);
    expect(badNumbers(resampleCurve([NaN, Infinity, -5, 10]))).toEqual([]);
    expect(resampleCurve([1, 2], 0)).toHaveLength(32);
  });
});

describe('idealForceCurve', () => {
  it('peaks at the requested force near 40 % of the drive', () => {
    const c = idealForceCurve(600);
    expect(c).toHaveLength(32);
    const max = Math.max(...c);
    expect(max).toBeCloseTo(600, 6);
    const pos = c.indexOf(max) / 31;
    expect(pos).toBeGreaterThan(0.35);
    expect(pos).toBeLessThan(0.45);
  });
  it('is itself analysed as an ideal, high-scoring curve', () => {
    const a = analyzeForceCurve(idealForceCurve(500));
    expect(a.shape).toBe('ideal');
    expect(a.flags).toEqual([]);
    expect(a.score).toBeGreaterThanOrEqual(95);
    expect(a.fullness).toBeGreaterThan(0.6);
    expect(a.fullness).toBeLessThan(0.75);
  });
  it('handles zero / invalid peaks', () => {
    expect(idealForceCurve(0)).toEqual(new Array(32).fill(0));
    expect(badNumbers(idealForceCurve(NaN, 10))).toEqual([]);
  });
});

describe('analyzeForceCurve — validity', () => {
  it('marks empty, too short and zero curves invalid without throwing', () => {
    for (const c of [[], [100, 200], [0, 0, 0, 0, 0, 0, 0, 0], [NaN, NaN, NaN, NaN, NaN, NaN]]) {
      const a = analyzeForceCurve(c);
      expect(a.valid).toBe(false);
      expect(a.score).toBe(0);
      expect(badNumbers(a)).toEqual([]);
    }
    // @ts-expect-error robustness against bad callers
    expect(analyzeForceCurve(undefined).valid).toBe(false);
  });
  it('analyses an 8-sample curve', () => {
    const a = analyzeForceCurve(hump(0.4, 2, 8, 450));
    expect(a.valid).toBe(true);
    expect(a.shape).toBe('ideal');
    expect(a.peakPosition).toBeGreaterThan(0.33);
    expect(a.peakPosition).toBeLessThan(0.47);
    expect(a.score).toBeGreaterThanOrEqual(85);
  });
  it('computes impulse from drive time', () => {
    const c = curve('ideal');
    const a = analyzeForceCurve(c, { driveTimeMs: 800 });
    expect(a.impulseNs).toBeCloseTo((a.avgForceN * 800) / 1000, 6);
    expect(analyzeForceCurve(c).impulseNs).toBe(0);
  });
});

describe('analyzeForceCurve — shapes and flags', () => {
  it('ideal', () => {
    const a = analyzeForceCurve(curve('ideal'));
    expect(a.shape).toBe('ideal');
    expect(a.riseFraction).toBeLessThan(0.2);
    expect(a.smoothness).toBeGreaterThan(0.95);
  });
  it('front-loaded with fade', () => {
    const a = analyzeForceCurve(curve('front'));
    expect(a.shape).toBe('front-loaded');
    expect(a.flags).toContain('early-peak-fade');
    expect(a.flags).not.toContain('weak-finish');
  });
  it('back-loaded → late peak + slow catch', () => {
    const a = analyzeForceCurve(curve('back'));
    expect(a.shape).toBe('back-loaded');
    expect(a.flags).toContain('late-peak');
    expect(a.flags).toContain('slow-catch');
  });
  it('double peak', () => {
    const a = analyzeForceCurve(curve('double'));
    expect(a.shape).toBe('double-peak');
    expect(a.flags).toContain('double-peak');
  });
  it('flat → soft drive', () => {
    const a = analyzeForceCurve(curve('flat', { peak: 250 }));
    expect(a.shape).toBe('flat');
    expect(a.flags).toContain('soft-drive');
  });
  it('spiky → jerky', () => {
    const a = analyzeForceCurve(curve('spiky'));
    expect(a.shape).toBe('spiky');
    expect(a.flags).toContain('jerky-drive');
  });
  it('jerky oscillation lowers smoothness and flags jerky drive', () => {
    const a = analyzeForceCurve(curve('jerky'));
    expect(a.smoothness).toBeLessThan(0.7);
    expect(a.flags).toContain('jerky-drive');
    expect(a.shape).not.toBe('double-peak');
  });
  it('weak finish', () => {
    const a = analyzeForceCurve(curve('weakFinish'));
    expect(a.flags).toContain('weak-finish');
    expect(a.flags).not.toContain('early-peak-fade');
  });
  it('is robust to mild noise', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = analyzeForceCurve(curve('ideal', { noise: 0.03, seed, n: 20 }));
      expect(a.shape).toBe('ideal');
      expect(a.flags).not.toContain('jerky-drive');
      expect(a.flags).not.toContain('double-peak');
    }
  });
});

describe('analyzeForceCurve — context flags', () => {
  const c = curve('ideal');
  it('drive length vs height and absolute bounds', () => {
    expect(analyzeForceCurve(c, { driveLengthM: 1.05 }).flags).toContain('short-stroke');
    expect(analyzeForceCurve(c, { driveLengthM: 1.8 }).flags).toContain('overreaching');
    expect(analyzeForceCurve(c, { driveLengthM: 1.45 }).flags).toEqual([]);
    expect(analyzeForceCurve(c, { driveLengthM: 1.3, heightCm: 200 }).flags).toContain('short-stroke');
    expect(analyzeForceCurve(c, { driveLengthM: 1.55, heightCm: 160 }).flags).toContain('overreaching');
    expect(analyzeForceCurve(c, { driveLengthM: 1.4, heightCm: 180 }).flags).toEqual([]);
  });
  it('recovery ratio norms depend on rate', () => {
    // 1:1 at r20 is rushed, but 1:1.1 at r34 is fine.
    expect(analyzeForceCurve(c, { driveTimeMs: 900, recoveryTimeMs: 900, strokeRate: 20 }).flags).toContain('rushed-recovery');
    expect(analyzeForceCurve(c, { driveTimeMs: 800, recoveryTimeMs: 960, strokeRate: 34 }).flags).not.toContain('rushed-recovery');
    expect(analyzeForceCurve(c, { driveTimeMs: 700, recoveryTimeMs: 2300, strokeRate: 30 }).flags).toContain('slow-recovery');
    expect(analyzeForceCurve(c, { driveTimeMs: 900, recoveryTimeMs: 2100, strokeRate: 20 }).flags).toEqual([]);
    // Rate derived from times when not given.
    expect(analyzeForceCurve(c, { driveTimeMs: 1000, recoveryTimeMs: 1000 }).flags).toContain('rushed-recovery');
  });
  it('low power per stroke at high rate', () => {
    const light = curve('ideal', { peak: 180 });
    expect(analyzeForceCurve(light, { driveLengthM: 1.3, strokeRate: 30 }).flags).toContain('low-power-per-stroke');
    expect(analyzeForceCurve(light, { driveLengthM: 1.3, strokeRate: 18 }).flags).not.toContain('low-power-per-stroke');
  });
  it('invalid curves still report context flags', () => {
    expect(analyzeForceCurve([], { driveLengthM: 0.9 }).flags).toContain('short-stroke');
  });
});

describe('analyzeForceCurve — score', () => {
  it('separates good from flawed curves', () => {
    const good = analyzeForceCurve(curve('ideal')).score;
    for (const k of ['front', 'back', 'double', 'flat', 'spiky', 'jerky', 'weakFinish'] as const) {
      expect(analyzeForceCurve(curve(k)).score, k).toBeLessThan(good - 15);
    }
  });
  it('decreases monotonically as the peak moves later', () => {
    let prev = 101;
    for (let p = 0.4; p <= 0.76; p += 0.04) {
      const s = analyzeForceCurve(hump(p, 2)).score;
      expect(s).toBeLessThanOrEqual(prev + 1);
      prev = s;
    }
    expect(prev).toBeLessThan(60);
  });
  it('decreases monotonically as a mid-drive dip deepens', () => {
    let prev = 101;
    const base = hump(0.4, 2, 32);
    for (let depth = 0; depth <= 0.5; depth += 0.05) {
      const c = base.map((v, i) => v * (1 - depth * Math.exp(-(((i / 31 - 0.45) / 0.08) ** 2))));
      const s = analyzeForceCurve(c).score;
      expect(s).toBeLessThanOrEqual(prev + 1);
      prev = s;
    }
    expect(prev).toBeLessThan(70);
  });
  it('is stable stroke to stroke for a consistent rower', () => {
    const scores = Array.from({ length: 30 }, (_, i) => analyzeForceCurve(curve('ideal', { noise: 0.02, seed: i + 1, n: 20 })).score);
    const m = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sd = Math.sqrt(scores.reduce((a, b) => a + (b - m) ** 2, 0) / scores.length);
    expect(sd).toBeLessThan(4);
    expect(m).toBeGreaterThan(80);
  });
  it('runs well under 1 ms per stroke', () => {
    const c = curve('ideal', { noise: 0.03, n: 40 });
    const t0 = performance.now();
    for (let i = 0; i < 5000; i++) analyzeForceCurve(c, { driveTimeMs: 800, recoveryTimeMs: 1600, driveLengthM: 1.4, strokeRate: 24 });
    const per = (performance.now() - t0) / 5000;
    expect(per).toBeLessThan(0.1);
  });
});

describe('analyzeForceSession', () => {
  it('empty / no curves → zeroed result with an insight', () => {
    for (const s of [[], [stroke(1, { forceCurve: [] })]]) {
      const r = analyzeForceSession(s);
      expect(r.strokesAnalysed).toBe(0);
      expect(r.insights.length).toBeGreaterThan(0);
      expect(badNumbers(r)).toEqual([]);
    }
  });
  it('single stroke', () => {
    const r = analyzeForceSession([stroke(1)]);
    expect(r.strokesAnalysed).toBe(1);
    expect(r.consistency).toBe(1);
    expect(r.averageCurve).toHaveLength(32);
    expect(badNumbers(r)).toEqual([]);
  });
  it('aggregates a consistent good session', () => {
    const strokes = Array.from({ length: 60 }, (_, i) => stroke(i + 1, { forceCurve: curve('ideal', { noise: 0.02, seed: i + 1 }) }));
    const r = analyzeForceSession(strokes);
    expect(r.strokesAnalysed).toBe(60);
    expect(r.dominantShape).toBe('ideal');
    expect(r.consistency).toBeGreaterThan(0.85);
    expect(r.curveStdDev).toHaveLength(32);
    expect(r.scoreSeries).toHaveLength(60);
    expect(r.insights.some((i) => i.severity === 'good')).toBe(true);
    expect(r.insights.some((i) => i.severity === 'warn')).toBe(false);
  });
  it('flags dominant faults with drills, and detects fatigue', () => {
    const strokes = Array.from({ length: 60 }, (_, i) => {
      const peak = i < 20 ? 550 : i >= 40 ? 420 : 500;
      return stroke(i + 1, { forceCurve: i % 4 === 0 ? curve('ideal', { peak }) : curve('double', { peak }) });
    });
    const r = analyzeForceSession(strokes);
    expect(r.dominantShape).toBe('double-peak');
    expect(r.shapeDistribution['double-peak']).toBeCloseTo(0.75, 2);
    expect(r.flagFrequency['double-peak']).toBeCloseTo(0.75, 2);
    expect(r.insights[0].severity).toBe('warn');
    const dp = r.insights.find((i) => i.flag === 'double-peak');
    expect(dp?.drill).toMatch(/pick drill/i);
    expect(r.insights.some((i) => /faded/i.test(i.title))).toBe(true);
    expect(Math.max(...r.earlyCurve)).toBeGreaterThan(Math.max(...r.lateCurve));
  });
  it('detects inconsistent strokes', () => {
    const kinds = ['ideal', 'front', 'back', 'double', 'flat'] as const;
    const strokes = Array.from({ length: 40 }, (_, i) => stroke(i + 1, { forceCurve: curve(kinds[i % kinds.length], { peak: 300 + (i % 3) * 150 }) }));
    const r = analyzeForceSession(strokes);
    expect(r.consistency).toBeLessThan(0.75);
    expect(r.flagFrequency['inconsistent-strokes'] ?? 0).toBeGreaterThan(0.25);
  });
});
