import { describe, expect, it } from 'vitest';
import {
  ForceCurveReassembler,
  N_PER_LBF,
  parseForceCurveFragment,
  parseMultiplexed,
  parsePacket,
  type Variant,
} from '@/ble/pm5/parsers';
import { parseHeartRateMeasurement } from '@/ble/heartRateParser';

const h = (s: string) => s.trim().split(/\s+/).map((x) => parseInt(x, 16));

// Common elapsed time: 0x01E240 = 123456 × 0.01 s = 1 234 560 ms.
const T = '40 E2 01';

/** Hand-computed fixtures; every value worked out from the spec's byte table and units. */
const cases: Array<{ name: string; id: number; variant: Variant; bytes: string; expected: Record<string, unknown> }> = [
  {
    name: '0x31 general status (distance workout)',
    id: 0x31,
    variant: 'direct',
    // dist 20000×0.1=2000m | type 3 | itype 255 | wstate 1 | rstate 1 | sstate 2 | work dist 2000 | duration 2000 id 0x80 | drag 125
    bytes: `${T} 20 4E 00 03 FF 01 01 02 D0 07 00 D0 07 00 80 7D`,
    expected: {
      elapsedMs: 1234560, distanceM: 2000, workoutType: 'fixed-distance-splits', intervalType: 'none',
      workoutState: 'workout-row', rowingState: 'active', strokeState: 'driving', totalWorkDistanceM: 2000,
      workoutDistanceM: 2000, workoutDurationMs: 0, dragFactor: 125,
    },
  },
  {
    name: '0x31 general status (time workout 20:00)',
    id: 0x31,
    variant: 'mux',
    // duration 0x01D4C0 = 120000 × 0.01 s, id 0x00 (time); interval rest state 3; recovery 4
    bytes: `${T} 00 00 00 05 02 03 00 04 00 00 00 C0 D4 01 00 7D`,
    expected: { workoutType: 'fixed-time-splits', intervalType: 'rest', workoutState: 'interval-rest', rowingState: 'inactive', strokeState: 'recovery', workoutDurationMs: 1200000, workoutDistanceM: 0 },
  },
  {
    name: '0x32 additional status (direct, 17 B)',
    id: 0x32,
    variant: 'direct',
    // speed 4123 mm/s | rate 28 | HR 150 | pace 10530 cs | avg 10600 cs | rest dist 0 | rest time 3000 cs | machine 0
    bytes: `${T} 1B 10 1C 96 22 29 68 29 00 00 B8 0B 00 00`,
    expected: { speedMps: 4.123, strokeRate: 28, heartRate: 150, paceMsPer500: 105300, avgPaceMsPer500: 106000, restDistanceM: 0, restTimeMs: 30000, avgWatts: null, machineType: 0 },
  },
  {
    name: '0x32 additional status (mux, 19 B, HR 255 invalid)',
    id: 0x32,
    variant: 'mux',
    bytes: `${T} 1B 10 1C FF 22 29 68 29 05 00 B8 0B 00 FA 00 80`,
    expected: { heartRate: null, restDistanceM: 5, avgWatts: 250, machineType: 0x80 },
  },
  {
    name: '0x33 additional status 2 (direct, 20 B)',
    id: 0x33,
    variant: 'direct',
    // ivl 2 | avg W 200 | cal 100 | split pace 10530 cs | split W 210 | split cal/h 1024 | last split 1140×0.1s | 500 m
    bytes: `${T} 02 C8 00 64 00 22 29 D2 00 00 04 74 04 00 F4 01 00`,
    expected: { intervalCount: 2, avgWatts: 200, calories: 100, splitAvgPaceMsPer500: 105300, splitAvgWatts: 210, splitAvgCalPerHour: 1024, lastSplitTimeMs: 114000, lastSplitDistanceM: 500 },
  },
  {
    name: '0x33 additional status 2 (mux, 18 B, no avg power)',
    id: 0x33,
    variant: 'mux',
    bytes: `${T} 02 64 00 22 29 D2 00 00 04 74 04 00 F4 01 00`,
    expected: { intervalCount: 2, avgWatts: null, calories: 100, splitAvgWatts: 210, lastSplitTimeMs: 114000, lastSplitDistanceM: 500 },
  },
  {
    name: '0x35 stroke data (direct, 20 B)',
    id: 0x35,
    variant: 'direct',
    // drive 145 cm | 80 cs | recovery 160 cs | stroke dist 1025 cm | peak 1805 (0.1 lbf) | avg 1000 | work 6500 (0.1 J) | count 300
    bytes: `${T} 20 4E 00 91 50 A0 00 01 04 0D 07 E8 03 64 19 2C 01`,
    expected: { distanceM: 2000, driveLengthM: 1.45, driveTimeMs: 800, recoveryTimeMs: 1600, strokeDistanceM: 10.25, workPerStrokeJ: 650, strokeCount: 300 },
  },
  {
    name: '0x35 stroke data (mux, 18 B, no work)',
    id: 0x35,
    variant: 'mux',
    bytes: `${T} 20 4E 00 91 50 A0 00 01 04 0D 07 E8 03 2C 01`,
    expected: { workPerStrokeJ: null, strokeCount: 300 },
  },
  {
    name: '0x36 additional stroke data (direct, 17 B)',
    id: 0x36,
    variant: 'direct',
    // power 250 | cal/h 1111 | count 300 | proj time 420 s | proj dist 2000 m
    bytes: `${T} FA 00 57 04 2C 01 A4 01 00 D0 07 00`,
    expected: { watts: 250, caloriesPerHour: 1111, strokeCount: 300, projectedWorkTimeMs: 420000, projectedWorkDistanceM: 2000, workPerStrokeJ: null },
  },
  {
    name: '0x36 additional stroke data (mux, 17 B, work per stroke)',
    id: 0x36,
    variant: 'mux',
    bytes: `${T} FA 00 57 04 2C 01 A4 01 00 D0 07 00 64 19`,
    expected: { watts: 250, workPerStrokeJ: 650 },
  },
  {
    name: '0x37 split data',
    id: 0x37,
    variant: 'direct',
    // dist 5000×0.1 | split 1140×0.1 s | 500 m | rest 60 s | rest dist 15 | type 1 | number 1
    bytes: `${T} 88 13 00 74 04 00 F4 01 00 3C 00 0F 00 01 01`,
    expected: { distanceM: 500, splitTimeMs: 114000, splitDistanceM: 500, restTimeMs: 60000, restDistanceM: 15, intervalType: 'distance', splitNumber: 1 },
  },
  {
    name: '0x38 additional split data',
    id: 0x38,
    variant: 'direct',
    // SR 28 | work HR 160 | rest HR 120 | pace 1140×0.1 s | cal 25 | cal/h 1024 | speed 4386 mm/s | 210 W | drag 125 | #1 | machine 0
    bytes: `${T} 1C A0 78 74 04 19 00 00 04 22 11 D2 00 7D 01 00`,
    expected: { avgStrokeRate: 28, workHeartRate: 160, restHeartRate: 120, avgPaceMsPer500: 114000, calories: 25, avgCalPerHour: 1024, speedMps: 4.386, watts: 210, avgDragFactor: 125, splitNumber: 1, machineType: 0 },
  },
  {
    name: '0x39 workout summary (direct, 20 B)',
    id: 0x39,
    variant: 'direct',
    // date 0x350B = 2026-11-16 | time 0x0E05 = 14:05 | 42000 cs | 2000 m | SR 28 | HR end 180 avg 165 min 90 max 190 | drag 125 | rec 0 | type 3 | pace 1050×0.1 s
    bytes: `0B 35 05 0E 10 A4 00 20 4E 00 1C B4 A5 5A BE 7D 00 03 1A 04`,
    expected: {
      loggedAt: new Date(2026, 10, 16, 14, 5).getTime(), elapsedMs: 420000, distanceM: 2000, avgStrokeRate: 28,
      endingHeartRate: 180, avgHeartRate: 165, minHeartRate: 90, maxHeartRate: 190, avgDragFactor: 125,
      recoveryHeartRate: null, workoutType: 'fixed-distance-splits', avgPaceMsPer500: 105000,
    },
  },
  {
    name: '0x39 workout summary (mux, 18 B, no pace)',
    id: 0x39,
    variant: 'mux',
    bytes: `0B 35 05 0E 10 A4 00 20 4E 00 1C B4 A5 5A BE 7D 00 03`,
    expected: { elapsedMs: 420000, avgPaceMsPer500: null },
  },
  {
    name: '0x3A additional summary (direct, 19 B)',
    id: 0x3a,
    variant: 'direct',
    // type 1 | split 500 | count 4 | 120 cal | 303 W | rest dist 0 | rest 0 s | 1351 cal/h
    bytes: `0B 35 05 0E 01 F4 01 04 78 00 2F 01 00 00 00 00 00 47 05`,
    expected: { intervalType: 'distance', splitSize: 500, splitCount: 4, calories: 120, watts: 303, restDistanceM: 0, restTimeMs: 0, avgCalPerHour: 1351 },
  },
  {
    name: '0x3A additional summary (mux, 18 B, no type)',
    id: 0x3a,
    variant: 'mux',
    bytes: `0B 35 05 0E F4 01 04 78 00 2F 01 0A 00 00 B4 00 47 05`,
    expected: { intervalType: null, splitSize: 500, splitCount: 4, calories: 120, watts: 303, restDistanceM: 10, restTimeMs: 180000, avgCalPerHour: 1351 },
  },
  {
    name: '0x3B heart-rate belt info',
    id: 0x3b,
    variant: 'direct',
    bytes: `01 02 78 56 34 12`,
    expected: { manufacturerId: 1, deviceType: 2, beltId: 0x12345678 },
  },
  {
    name: '0x3C additional summary 2 (mux)',
    id: 0x3c,
    variant: 'mux',
    bytes: `0B 35 05 0E 1A 04 00 00 00 00 23 01 00`,
    expected: { avgPaceMsPer500: 105000, machineType: 0, totalWattMinutes: 0x123 },
  },
];

describe('PM5 characteristic parsers', () => {
  it.each(cases)('$name', ({ id, variant, bytes, expected }) => {
    const p = parsePacket(id, h(bytes), variant) as unknown as Record<string, unknown>;
    expect(p).not.toBeNull();
    if (id < 0x39) expect(p.elapsedMs).toBe(1234560);
    for (const [k, v] of Object.entries(expected)) {
      if (typeof v === 'number' && !Number.isInteger(v)) expect(p[k], k).toBeCloseTo(v, 6);
      else expect(p[k], k).toEqual(v);
    }
  });

  it('converts stroke forces from 0.1 lbf to newtons', () => {
    const p = parsePacket(0x35, h(`${T} 20 4E 00 91 50 A0 00 01 04 0D 07 E8 03 64 19 2C 01`), 'direct');
    expect(p).toMatchObject({ kind: 'strokeData' });
    if (p?.kind !== 'strokeData') return;
    expect(p.peakForceN).toBeCloseTo(180.5 * N_PER_LBF, 6);
    expect(p.avgForceN).toBeCloseTo(100 * N_PER_LBF, 6);
  });

  it('rejects truncated packets and unknown ids', () => {
    expect(parsePacket(0x31, h('00 01 02'), 'direct')).toBeNull();
    expect(parsePacket(0x99, h(`${T} 00 00 00`), 'direct')).toBeNull();
  });

  it('demultiplexes 0x0080 using the id byte and mux layout', () => {
    const p = parseMultiplexed(h(`35 ${T} 20 4E 00 91 50 A0 00 01 04 0D 07 E8 03 2C 01`));
    expect(p).toMatchObject({ kind: 'strokeData', strokeCount: 300, workPerStrokeJ: null });
  });
});

describe('force curve reassembly', () => {
  // header 0x29 = 2 notifications total, 9 words here; 0x23 = 2 total, 3 words.
  const f1 = h('29 00 0A 00 14 00 1E 00 28 00 32 00 3C 00 46 00 50 00 5A 00');
  const f2 = h('23 01 64 00 6E 00 78 00');

  it('joins fragments into one curve', () => {
    expect(parseForceCurveFragment(f1)).toMatchObject({ totalFragments: 2, wordCount: 9, sequence: 0 });
    const r = new ForceCurveReassembler();
    expect(r.push(parseForceCurveFragment(f1))).toBeNull();
    expect(r.push(parseForceCurveFragment(f2))).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  });

  it('drops a resent fragment and restarts after a lost one', () => {
    const r = new ForceCurveReassembler();
    r.push(parseForceCurveFragment(f1));
    expect(r.push(parseForceCurveFragment(f1))).toBeNull();
    expect(r.push(parseForceCurveFragment(f2))).toHaveLength(12);
    // Next curve (seq 2, 3) loses its last fragment; the one after (seq 4, 5) must come out clean.
    r.push(parseForceCurveFragment(h('29 02 01 00 01 00 01 00 01 00 01 00 01 00 01 00 01 00 01 00')));
    expect(r.push(parseForceCurveFragment([0x29, 4, ...f1.slice(2)]))).toBeNull();
    expect(r.push(parseForceCurveFragment([0x23, 5, ...f2.slice(2)]))).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  });

  it('accepts a sequence number that counts curves rather than fragments', () => {
    const r = new ForceCurveReassembler();
    expect(r.push(parseForceCurveFragment([0x29, 7, ...f1.slice(2)]))).toBeNull();
    expect(r.push(parseForceCurveFragment([0x23, 7, ...f2.slice(2)]))).toHaveLength(12);
  });

  it('converts lbf to N and detects a 0.1 lbf scale from the peak force', () => {
    expect(ForceCurveReassembler.toNewtons([100], 100 * N_PER_LBF)[0]).toBeCloseTo(100 * N_PER_LBF, 6);
    expect(ForceCurveReassembler.toNewtons([1000], 100 * N_PER_LBF)[0]).toBeCloseTo(100 * N_PER_LBF, 6);
    expect(ForceCurveReassembler.toNewtons([1000])[0]).toBeCloseTo(100 * N_PER_LBF, 6);
  });
});

describe('heart-rate measurement 0x2A37', () => {
  it.each([
    { name: '8-bit', bytes: '00 48', bpm: 72, contact: null, energy: null, rr: [] },
    { name: '16-bit', bytes: '01 2C 01', bpm: 300, contact: null, energy: null, rr: [] },
    // flags 0x1E: contact supported + detected, energy present, RR present; RR 1024/1024 s, 512/1024 s
    { name: '8-bit + energy + RR', bytes: '1E 5A 10 00 00 04 00 02', bpm: 90, contact: true, energy: 16, rr: [1000, 500] },
  ])('$name', ({ bytes, bpm, contact, energy, rr }) => {
    expect(parseHeartRateMeasurement(h(bytes))).toEqual({ bpm, contact, energyExpendedKj: energy, rrIntervalsMs: rr });
  });

  it('returns null for short payloads', () => {
    expect(parseHeartRateMeasurement([0x01, 0x2c])).toBeNull();
  });
});
