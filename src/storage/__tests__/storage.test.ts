import { describe, expect, it } from 'vitest';
import type { SplitSummary, StrokeSample, WorkoutRecord } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/defaults';
import { buildBackup, parseBackup } from '../backup';
import { decodeBlob, encodeBlob, recordToParams } from '../codec';
import { toCsv, toTcx, xmlEscape } from '../formats';
import { mergeSettings } from '../merge';
import { strokeTimeline } from '../timeline';

export function stroke(n: number, elapsedMs: number, distanceM: number, intervalCount = 0): StrokeSample {
  return {
    strokeNumber: n, elapsedMs, distanceM, paceMsPer500: 120_000, watts: 203.4, strokeRate: 24, heartRate: 150,
    driveLengthM: 1.45, driveTimeMs: 800, recoveryTimeMs: 1700, strokeDistanceM: 10.2, peakForceN: 600.44,
    avgForceN: 400, workPerStrokeJ: 650, intervalCount, forceCurve: [10.4, 300.6, 600.2, 200.9],
  };
}

function split(index: number, splitTimeMs: number, splitDistanceM: number, restTimeMs = 0): SplitSummary {
  return {
    index, type: restTimeMs ? 'distance' : 'time', elapsedMs: 0, distanceM: 0, splitTimeMs, splitDistanceM, restTimeMs,
    restDistanceM: 0, avgPaceMsPer500: 120_000, avgWatts: 203, avgStrokeRate: 24, avgHeartRate: 150, restHeartRate: null,
    avgDragFactor: 120, calories: 20, strokeCount: 10,
  };
}

function record(over: Partial<WorkoutRecord> = {}): WorkoutRecord {
  return {
    id: 'w1', startedAt: Date.UTC(2026, 2, 12, 8), endedAt: Date.UTC(2026, 2, 12, 8, 10), machineType: 'rower', plan: null,
    title: '1000m <A&B>', workoutType: 'fixed-distance-splits', elapsedMs: 240_000, distanceM: 1000, avgPaceMsPer500: 120_000,
    avgWatts: 203, avgStrokeRate: 24, avgHeartRate: 150, maxHeartRate: 160, calories: 40, strokeCount: 2, avgDragFactor: 120,
    totalRestMs: 0, splits: [split(0, 120_000, 500), split(1, 120_000, 500)],
    strokes: [stroke(1, 60_000, 250), stroke(2, 180_000, 750)], heartRate: [{ elapsedMs: 1000, bpm: 140 }], coxCalls: [],
    ...over,
  };
}

describe('timeline', () => {
  it('normalises per-interval resets into a monotonic work timeline', () => {
    const tl = strokeTimeline(
      [stroke(1, 50_000, 200, 0), stroke(2, 100_000, 400, 0), stroke(1, 50_000, 200, 1)],
      [split(0, 100_000, 400, 60_000)],
    );
    expect(tl[2]).toEqual({ t: 210_000, w: 150_000, d: 600 });
  });
});

describe('codec', () => {
  it('round-trips the blob compactly (integer forces)', () => {
    const r = record();
    const back = decodeBlob(encodeBlob(r));
    expect(back.strokes[0].forceCurve).toEqual([10, 301, 600, 201]);
    expect(back.strokes[1].distanceM).toBe(750);
    expect(back.splits).toEqual(r.splits);
    expect(back.heartRate).toEqual(r.heartRate);
    expect(recordToParams(r).$tags).toBeNull();
  });
});

describe('formats', () => {
  it('csv has a stroke header, stroke rows and a split section', () => {
    const lines = toCsv(record()).trim().split('\r\n');
    expect(lines[0].startsWith('stroke,interval,elapsed_s')).toBe(true);
    expect(lines[1]).toContain('10 301 600 201');
    expect(lines[3]).toBe('');
    expect(lines[4].startsWith('split,type')).toBe(true);
    expect(lines).toHaveLength(7);
  });

  it('tcx is a TCX v2 activity with one lap per split and TPX watts', () => {
    const x = toTcx(record({ notes: 'tough "one"' }));
    expect(x).toContain('<Activity Sport="Other">');
    expect(x.match(/<Lap /g)).toHaveLength(2);
    expect(x.match(/<Trackpoint>/g)).toHaveLength(2);
    expect(x).toContain('<ns3:Watts>203</ns3:Watts>');
    expect(x).toContain('<Cadence>24</Cadence>');
    expect(x).toContain('<Time>2026-03-12T08:01:00.000Z</Time>');
    expect(x).toContain('1000m &lt;A&amp;B&gt;');
    expect(xmlEscape('"\'')).toBe('&quot;&apos;');
  });
});

describe('settings merge + backup', () => {
  it('fills new fields with defaults and rejects wrong types', () => {
    const s = mergeSettings({ keepAwake: false, coxswain: { personality: 'race', voiceRate: 'fast' }, profile: { weightKg: 80 } });
    expect(s.keepAwake).toBe(false);
    expect(s.coxswain.style).toBe('race'); // legacy personality 'race' migrates to race style
    expect(s.coxswain.voiceRate).toBe(DEFAULT_SETTINGS.coxswain.voiceRate);
    expect(s.coxswain.splitCalls).toBe(true);
    expect(s.profile.weightKg).toBe(80);
  });

  it('parses its own backup, skips invalid entries, rejects junk', () => {
    const b = buildBackup({ settings: DEFAULT_SETTINGS, plans: [], favoritePlanIds: ['p'], workouts: [record()] });
    const text = JSON.stringify({ ...b, workouts: [...b.workouts, { id: 'bad' }] });
    const p = parseBackup(text);
    expect(p.workouts.map((w) => w.id)).toEqual(['w1']);
    expect(p.skipped).toBe(1);
    expect(() => parseBackup('{"hello":1}')).toThrow();
  });
});
