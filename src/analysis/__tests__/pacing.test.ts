import { describe, expect, it } from 'vitest';
import { analyzeIntervals, analyzePacing } from '@/analysis';
import type { PacingProfile, StrokeSample } from '@/core/types';
import { badNumbers, makeRecord, record, split, stroke } from './fixtures';

const profiles: [PacingProfile, (f: number) => number][] = [
  ['even', () => 110000],
  ['negative-split', (f) => 112000 - 4000 * f],
  ['positive-split', (f) => 108000 + 3000 * f],
  ['fly-and-die', (f) => 100000 + 18000 * Math.pow(f, 1.5)],
  ['u-shaped', (f) => (f < 0.12 ? 104000 : f > 0.88 ? 105000 : 111000)],
  ['erratic', (f) => (Math.floor(f * 8) % 2 ? 114000 : 106000)],
];

describe('analyzePacing — classification from strokes', () => {
  for (const [expected, paceAt] of profiles) {
    it(expected, () => {
      const a = analyzePacing(makeRecord({ paceAt }));
      expect(a.profile).toBe(expected);
      expect(a.segments).toHaveLength(8);
      expect(a.insights.length).toBeGreaterThan(0);
      expect(badNumbers(a)).toEqual([]);
    });
  }
});

describe('analyzePacing — metrics', () => {
  it('even piece: no fade, no time lost, high score', () => {
    const a = analyzePacing(makeRecord({ paceAt: () => 110000 }));
    expect(Math.abs(a.fadePct)).toBeLessThan(0.1);
    expect(a.variabilityPct).toBeLessThan(0.1);
    expect(a.timeLostToPacingMs).toBeLessThan(50);
    expect(a.score).toBeGreaterThanOrEqual(95);
    expect(a.segments[0].startM).toBe(0);
    expect(a.segments[7].endM).toBeCloseTo(2000, 6);
    expect(a.paceSeries.length).toBeGreaterThan(100);
    expect(a.paceSeries[50].y).toBeCloseTo(110000, -1);
    expect(a.distancePerStrokeSeries[10].y).toBeCloseTo(10, 6);
  });
  it('fly-and-die loses time, fades and scores lower than even', () => {
    const even = analyzePacing(makeRecord({ paceAt: () => 110000 }));
    const fly = analyzePacing(makeRecord({ paceAt: profiles[3][1] }));
    expect(fly.fadePct).toBeGreaterThan(3);
    expect(fly.timeLostToPacingMs).toBeGreaterThan(500);
    expect(fly.fastestSegment).toBe(0);
    expect(fly.slowestSegment).toBe(7);
    expect(fly.score).toBeLessThan(even.score - 20);
    expect(fly.insights[0].severity).toBe('warn');
    expect(fly.segments[0].deltaVsAvgMs).toBeLessThan(0);
  });
  it('negative split has negative fade', () => {
    expect(analyzePacing(makeRecord({ paceAt: profiles[1][1] })).fadePct).toBeLessThan(-1);
  });
  it('HR drift: decoupling when HR rises at constant power', () => {
    const flat = analyzePacing(makeRecord({ paceAt: () => 110000, hrDrift: 0 }));
    expect(flat.hrDriftPct).toBeCloseTo(0, 1);
    const drift = analyzePacing(makeRecord({ paceAt: () => 110000, hrDrift: 30 }));
    expect(drift.hrDriftPct!).toBeGreaterThan(5);
    expect(drift.insights.some((i) => /drift/i.test(i.title))).toBe(true);
    const noHr = makeRecord({ paceAt: () => 110000 });
    noHr.strokes = noHr.strokes.map((s) => ({ ...s, heartRate: null }));
    noHr.avgHeartRate = null;
    expect(analyzePacing(noHr).hrDriftPct).toBeNull();
  });
  it('delta vs pace plan', () => {
    const r = makeRecord({ paceAt: () => 110000 });
    r.plan = {
      id: 'p',
      name: '2k',
      kind: 'single-distance',
      value: 2000,
      pacePlan: {
        strategy: 'custom',
        goalPaceMsPer500: 109000,
        segments: [
          { startFraction: 0, endFraction: 0.5, targetPaceMsPer500: 112000, label: 'Settle' },
          { startFraction: 0.5, endFraction: 1, targetPaceMsPer500: 106000, label: 'Push' },
        ],
      },
    };
    const a = analyzePacing(r);
    expect(a.segments[0].deltaVsPlanMs).toBeCloseTo(-2000, -1);
    expect(a.segments[7].deltaVsPlanMs).toBeCloseTo(4000, -1);
    expect(a.insights.some((i) => /plan/i.test(i.title))).toBe(true);
    expect(analyzePacing(makeRecord({ paceAt: () => 110000 })).segments[0].deltaVsPlanMs).toBeNull();
  });
  it('uses PM splits when present (no strokes)', () => {
    const a = analyzePacing(makeRecord({ paceAt: profiles[2][1], splitM: 500, withStrokes: false }));
    expect(a.segments).toHaveLength(4);
    expect(a.profile).toBe('positive-split');
    expect(a.paceSeries).toHaveLength(4);
    expect(a.heartRateSeries).toHaveLength(4);
    expect(badNumbers(a)).toEqual([]);
  });
  it('copes with totals only, and with an empty record', () => {
    const totalsOnly = analyzePacing(record());
    expect(totalsOnly.segments).toHaveLength(1);
    expect(totalsOnly.profile).toBe('unknown');
    const empty = analyzePacing(record({ distanceM: 0, elapsedMs: 0, avgPaceMsPer500: 0 }));
    expect(empty.segments).toEqual([]);
    expect(empty.profile).toBe('unknown');
    expect(empty.score).toBe(0);
    expect(badNumbers(empty)).toEqual([]);
    const one = analyzePacing(record({ strokes: [stroke(1)] }));
    expect(badNumbers(one)).toEqual([]);
  });
  it('stitches interval strokes whose distance resets each rep', () => {
    const strokes: StrokeSample[] = [];
    for (let rep = 0; rep < 2; rep++) for (let i = 1; i <= 50; i++) strokes.push(stroke(i, { distanceM: i * 10, elapsedMs: i * 2750, intervalCount: rep }));
    const a = analyzePacing(record({ strokes }));
    expect(a.segments[a.segments.length - 1].endM).toBeCloseTo(1000, 6);
    expect(a.profile).toBe('even');
  });
});

describe('analyzeIntervals', () => {
  const paces = [105000, 106000, 107000, 110000];
  const intervalRecord = () =>
    record({
      workoutType: 'fixed-distance-interval',
      splits: paces.map((p, i) =>
        split(i, 500, p, { restTimeMs: 60000, restHeartRate: 140, avgHeartRate: 170, type: 'distance' }),
      ),
    });
  it('returns null for non-interval workouts', () => {
    expect(analyzeIntervals(makeRecord({ paceAt: () => 110000 }))).toBeNull();
  });
  it('compares reps from splits', () => {
    const a = analyzeIntervals(intervalRecord())!;
    expect(a.reps).toHaveLength(4);
    expect(a.dropOffPct).toBeCloseTo(((110000 - 105000) / 105000) * 100, 1);
    expect(a.consistencyPct).toBeGreaterThan(0);
    expect(a.consistencyPct).toBeLessThan(100);
    expect(a.hrRecovery).toEqual([30, 30, 30, 30]);
    expect(a.reps[0].deltaVsAvgMs).toBeLessThan(0);
    expect(a.insights.length).toBeGreaterThan(0);
    expect(badNumbers(a)).toEqual([]);
  });
  it('flags a big drop-off', () => {
    const r = intervalRecord();
    r.splits[3] = split(3, 500, 118000, { restTimeMs: 60000 });
    const a = analyzeIntervals(r)!;
    expect(a.dropOffPct).toBeGreaterThan(5);
    expect(a.insights[0].severity).toBe('warn');
    expect(a.hrRecovery[3]).toBeNull();
  });
  it('uses plan targets for deltaVsPlan', () => {
    const r = intervalRecord();
    r.plan = { id: 'x', name: '4x500', kind: 'intervals', intervals: [{ type: 'distance', value: 500, restMs: 60000, target: { paceMsPer500: 106000 } }] };
    const a = analyzeIntervals(r)!;
    expect(a.reps.map((x) => x.deltaVsPlanMs)).toEqual([-1000, 0, 1000, 4000]);
  });
  it('falls back to strokes grouped by interval', () => {
    const strokes: StrokeSample[] = [];
    for (let rep = 0; rep < 3; rep++)
      for (let i = 1; i <= 25; i++) strokes.push(stroke(i, { distanceM: i * 10, elapsedMs: i * (2600 + rep * 50), intervalCount: rep }));
    const a = analyzeIntervals(record({ workoutType: 'fixed-distance-interval', strokes }))!;
    expect(a.reps).toHaveLength(3);
    expect(a.reps[2].avgPaceMsPer500).toBeGreaterThan(a.reps[0].avgPaceMsPer500);
    expect(a.hrRecovery).toEqual([null, null, null]);
  });
  it('empty interval record does not throw', () => {
    const a = analyzeIntervals(record({ workoutType: 'variable-interval' }))!;
    expect(a.reps).toEqual([]);
    expect(badNumbers(a)).toEqual([]);
  });
});
