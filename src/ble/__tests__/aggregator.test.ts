import { describe, expect, it } from 'vitest';
import { Pm5Aggregator } from '@/ble/pm5/aggregator';
import { N_PER_LBF, parseMultiplexed } from '@/ble/pm5/parsers';

const h = (s: string) => s.trim().split(/\s+/).map((x) => parseInt(x, 16));
const T = '40 E2 01';

describe('Pm5Aggregator', () => {
  it('merges mux packets into metrics, one stroke with its curve, a split and a summary', () => {
    const a = new Pm5Aggregator();
    const feed = (hex: string, now: number) => a.apply(parseMultiplexed(h(hex))!, now);

    expect(feed(`31 ${T} 20 4E 00 03 FF 01 01 02 D0 07 00 D0 07 00 80 7D`, 0)).toEqual([]);
    feed(`32 ${T} 1B 10 1C 96 22 29 68 29 00 00 00 00 00 FA 00 00`, 10);
    expect(a.takeDirty()).toBe(true);
    expect(a.takeDirty()).toBe(false);
    expect(a.metrics).toMatchObject({ distanceM: 2000, strokeRate: 28, heartRate: 150, avgWatts: 250, dragFactor: 125 });

    // Curve (in lbf) before the stroke packet; stroke peak 12.0 lbf, so the curve stays in lbf.
    feed('3D 29 00 01 00 02 00 03 00 04 00 05 00 06 00 07 00 08 00 09 00', 20);
    feed('3D 23 01 0A 00 0B 00 0C 00', 30);
    expect(feed(`35 ${T} 20 4E 00 91 50 A0 00 01 04 78 00 50 00 2C 01`, 40)).toEqual([]);
    const ev = feed(`36 ${T} FA 00 57 04 2C 01 A4 01 00 D0 07 00 64 19`, 50);
    expect(ev).toHaveLength(1);
    const s = ev[0]!.type === 'stroke' ? ev[0]!.stroke : null;
    expect(s).toMatchObject({ strokeNumber: 300, watts: 250, workPerStrokeJ: 650, driveTimeMs: 800 });
    expect(s!.forceCurve).toHaveLength(12);
    expect(s!.forceCurve[11]).toBeCloseTo(12 * N_PER_LBF, 6);

    // Split: both halves → one event.
    expect(feed(`37 ${T} 88 13 00 74 04 00 F4 01 00 00 00 00 00 01 01`, 60)).toEqual([]);
    const sp = feed(`38 ${T} 1C A0 78 74 04 19 00 00 04 22 11 D2 00 7D 01`, 70);
    expect(sp[0]).toMatchObject({ type: 'split', split: { index: 0, splitDistanceM: 500, splitTimeMs: 114000, avgWatts: 210, avgHeartRate: 160, strokeCount: 300 } });

    // Summary: 0x39 + 0x3A + 0x3C (mux has no pace in 0x39).
    feed('39 0B 35 05 0E 10 A4 00 20 4E 00 1C B4 A5 5A BE 7D 00 03', 80);
    feed('3A 0B 35 05 0E F4 01 04 78 00 2F 01 00 00 00 00 00 47 05', 90);
    const end = feed('3C 0B 35 05 0E 1A 04 00 00 00 00 23 01 00', 100);
    expect(end[0]).toMatchObject({ type: 'workoutEnd', summary: { elapsedMs: 420000, distanceM: 2000, avgPaceMsPer500: 105000, avgWatts: 303, calories: 120, intervalCount: 4, strokeCount: 300 } });
    // The revised summary (recovery HR after 1 min) is not re-emitted.
    expect(feed('39 0B 35 05 0E 10 A4 00 20 4E 00 1C B4 A5 5A BE 7D 64 03', 60_000)).toEqual([]);
  });

  it('emits a stroke without companions after a timeout', () => {
    const a = new Pm5Aggregator();
    a.apply(parseMultiplexed(h(`35 ${T} 20 4E 00 91 50 A0 00 01 04 78 00 50 00 05 00`))!, 0);
    expect(a.tick(500)).toEqual([]);
    const ev = a.tick(1300);
    expect(ev[0]).toMatchObject({ type: 'stroke', stroke: { strokeNumber: 5, forceCurve: [] } });
  });

  it('holds a stroke for a curve that arrives late once the PM is known to send curves', () => {
    const a = new Pm5Aggregator();
    const feed = (hex: string, now: number) => a.apply(parseMultiplexed(h(hex))!, now);
    feed('3D 13 00 05 00 0A 00 05 00', 0);
    feed(`35 ${T} 20 4E 00 91 50 A0 00 01 04 78 00 50 00 2C 01`, 0);
    expect(feed(`36 ${T} FA 00 57 04 2C 01 A4 01 00 D0 07 00 64 19`, 0)).toHaveLength(1);

    feed(`35 ${T} 20 4E 00 91 50 A0 00 01 04 78 00 50 00 2D 01`, 1000);
    feed(`36 ${T} FA 00 57 04 2D 01 A4 01 00 D0 07 00 64 19`, 1000);
    expect(a.tick(2500)).toEqual([]); // past the plain 1.2 s wait, still waiting for the curve
    const ev = a.apply(parseMultiplexed(h('3D 13 01 05 00 0A 00 05 00'))!, 2600);
    expect(ev[0]).toMatchObject({ type: 'stroke', stroke: { strokeNumber: 301 } });
    expect(ev[0]!.type === 'stroke' && ev[0]!.stroke.forceCurve).toHaveLength(3);
  });
});
