import { describe, expect, it } from 'vitest';
import type { WorkoutPlan } from '@/core/types';
import {
  buildFrame,
  buildTerminateFrames,
  buildWorkoutFrames,
  chunk,
  fixedIntervalGroups,
  FrameAccumulator,
  MAX_FRAME_BYTES,
  packFrames,
  parseFrame,
  stuff,
  unstuff,
} from '@/ble/pm5/csafe';

const h = (s: string) => s.trim().split(/\s+/).map((x) => parseInt(x, 16));
const plan = (p: Partial<WorkoutPlan>): WorkoutPlan => ({ id: 't', name: 't', kind: 'just-row', ...p });

/** Frames copied from the example tables in "Concept2 PM CSAFE Communication Definition" rev 0.31. */
describe('workout frames match the spec examples', () => {
  it('JustRow', () => {
    expect(buildWorkoutFrames(plan({ kind: 'just-row' }))).toEqual([h('F1 76 07 01 01 01 13 02 01 01 61 F2')]);
  });

  it('Fixed distance 2000 m / 400 m splits', () => {
    const expected = h('F1 76 18 01 01 03 03 05 80 00 00 07 D0 05 05 80 00 00 01 90 14 01 01 13 02 01 01 28 F2');
    expect(buildWorkoutFrames(plan({ kind: 'single-distance', value: 2000, splitValue: 400 }))).toEqual([expected]);
    // Default split = 1/5 of the piece.
    expect(buildWorkoutFrames(plan({ kind: 'single-distance', value: 2000 }))).toEqual([expected]);
  });

  it('Fixed time 20:00 / 4:00 splits', () => {
    expect(buildWorkoutFrames(plan({ kind: 'single-time', value: 1_200_000, splitValue: 240_000 }))).toEqual([
      h('F1 76 18 01 01 05 03 05 00 00 01 D4 C0 05 05 00 00 00 5D C0 14 01 01 13 02 01 01 E0 F2'),
    ]);
  });

  it('Fixed time interval 2:00 / 0:30r and fixed calorie interval 25 cal / 0:12r', () => {
    expect(packFrames(fixedIntervalGroups({ type: 'time', value: 120_000, restMs: 30_000 }))).toEqual([
      // Spec prints checksum 0x0A; the XOR of these bytes is 0xB0 (see terminate test).
      h('F1 76 15 01 01 06 03 05 00 00 00 2E E0 04 02 00 1E 14 01 01 13 02 01 01 B0 F2'),
    ]);
    expect(packFrames(fixedIntervalGroups({ type: 'calorie', value: 25, restMs: 12_000 }))).toEqual([
      h('F1 76 15 01 01 0C 03 05 40 00 00 00 19 04 02 00 0C 14 01 01 13 02 01 01 3F F2'),
    ]);
  });

  it('Variable interval (500m/1:00r, 3:00/0:00r, 1000m/0:00r, 5:00/2:00r @ 1:40)', () => {
    const p = plan({
      kind: 'intervals',
      target: { paceMsPer500: 100_000 },
      intervals: [
        { type: 'distance', value: 500, restMs: 60_000 },
        { type: 'time', value: 180_000, restMs: 0 },
        { type: 'distance', value: 1000, restMs: 0 },
        { type: 'time', value: 300_000, restMs: 120_000 },
      ],
    });
    expect(buildWorkoutFrames(p)).toEqual([
      h(`F1 76 6F 18 01 00 01 01 08 17 01 01 03 05 80 00 00 01 F4 04 02 00 3C 06 04 00 00 27 10 14 01 01
         18 01 01 17 01 00 03 05 00 00 00 46 50 04 02 00 00 06 04 00 00 27 10 14 01 01
         18 01 02 17 01 01 03 05 80 00 00 03 E8 04 02 00 00 06 04 00 00 27 10 14 01 01
         18 01 03 17 01 00 03 05 00 00 00 75 30 04 02 00 78 06 04 00 00 27 10 14 01 01 13 02 01 01 09 F2`),
      // ^ spec prints checksum 0xC6; the XOR of the bytes is 0x09.
    ]);
  });

  it('Variable interval with undefined rest (100m, 2:00 @ 2:10)', () => {
    const p = plan({
      kind: 'intervals',
      intervals: [
        { type: 'distance', value: 100, restMs: 0, undefinedRest: true, target: { paceMsPer500: 130_000 } },
        { type: 'time', value: 120_000, restMs: 0, undefinedRest: true, target: { paceMsPer500: 130_000 } },
      ],
    });
    expect(buildWorkoutFrames(p)).toEqual([
      h(`F1 76 45 18 01 00 01 01 08 17 01 04 03 05 80 00 00 00 64 04 02 00 00 06 04 00 00 32 C8 14 01 01
         18 01 01 17 01 03 03 05 00 00 00 2E E0 04 02 00 00 06 04 00 00 32 C8 14 01 01
         01 01 09 05 05 80 00 00 00 00 13 02 01 01 8F F2`),
    ]);
  });

  it('Terminate workout, then main screen', () => {
    // The spec table prints checksum 0x62 for this frame, but XOR(76 04 13 02 01 02) = 0x60, the
    // same rule that every other example satisfies. We use the computed value.
    expect(buildTerminateFrames()).toEqual([h('F1 76 04 13 02 01 02 60 F2'), h('F1 76 04 13 02 01 06 64 F2')]);
  });

  it('single calorie piece uses the calorie duration identifier', () => {
    const [f] = buildWorkoutFrames(plan({ kind: 'single-calorie', value: 100 }));
    expect(f!.slice(3, 16)).toEqual(h('01 01 0A 03 05 40 00 00 00 64 05 05 40'));
  });

  it('rejects plans without a target', () => {
    expect(() => buildWorkoutFrames(plan({ kind: 'single-distance' }))).toThrow();
    expect(() => buildWorkoutFrames(plan({ kind: 'intervals', intervals: [] }))).toThrow();
  });
});

describe('CSAFE framing', () => {
  it('stuffs and unstuffs reserved bytes', () => {
    expect(stuff([0xf0, 0xf1, 0xf2, 0xf3, 0x01])).toEqual([0xf3, 0, 0xf3, 1, 0xf3, 2, 0xf3, 3, 0x01]);
    expect(unstuff(stuff([0xf0, 0xf1, 0xf2, 0xf3, 0x01]))).toEqual([0xf0, 0xf1, 0xf2, 0xf3, 0x01]);
  });

  it('stuffs a checksum that collides with a flag', () => {
    // XOR(0x76, 0x84) = 0xF2 → must be sent as F3 02.
    expect(buildFrame([0x76, 0x84])).toEqual([0xf1, 0x76, 0x84, 0xf3, 0x02, 0xf2]);
    expect(parseFrame(buildFrame([0x76, 0x84]))).toEqual({ status: 0x76, contents: [0x76, 0x84], checksumOk: true });
  });

  it('reassembles a response split across notifications', () => {
    const acc = new FrameAccumulator();
    const frame = buildFrame([0x81, 0x76, 0x01, 0x13]);
    expect(acc.push(frame.slice(0, 3))).toEqual([]);
    expect(acc.push(frame.slice(3))).toEqual([{ status: 0x81, contents: [0x81, 0x76, 0x01, 0x13], checksumOk: true }]);
  });

  it('splits long interval plans into valid ≤120-byte frames and 20-byte writes', () => {
    const intervals = Array.from({ length: 20 }, () => ({ type: 'distance' as const, value: 500, restMs: 60_000 }));
    const frames = buildWorkoutFrames(plan({ kind: 'intervals', intervals }));
    expect(frames.length).toBeGreaterThan(1);
    for (const f of frames) {
      expect(f.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      expect(parseFrame(f)?.checksumOk).toBe(true);
      expect(chunk(f).every((c) => c.length <= 20)).toBe(true);
    }
  });
});

/** Target pace for the PM5 pace boat: CSAFE_PM_SET_TARGETPACETIME 0x06, 0.01 s LSB (spec: 1:40 = 00 00 27 10). */
describe('target pace programming', () => {
  const pace100 = [0x06, 0x04, 0x00, 0x00, 0x27, 0x10];
  const hasSeq = (frame: number[], seq: number[]) => frame.some((_, i) => seq.every((b, j) => frame[i + j] === b));

  it('adds the pace before CONFIGURE_WORKOUT on single pieces (goal pace or pace-plan goal)', async () => {
    const { goalPace } = await import('@/ble/pm5/csafe');
    for (const p of [
      plan({ kind: 'single-distance', value: 2000, target: { paceMsPer500: 100_000 } }),
      plan({ kind: 'single-time', value: 1_200_000, pacePlan: { strategy: 'even', goalPaceMsPer500: 100_000, segments: [] } }),
      plan({ kind: 'single-calorie', value: 300, target: { paceMsPer500: 100_000 } }),
    ]) {
      const f = buildWorkoutFrames(p)[0]!;
      expect(goalPace(p)).toBe(100_000);
      expect(hasSeq(f, [...pace100, 0x14, 0x01, 0x01])).toBe(true);
    }
  });

  it('leaves plans without a goal pace byte-identical, and covers fixed intervals', () => {
    expect(hasSeq(buildWorkoutFrames(plan({ kind: 'single-distance', value: 2000 }))[0]!, [0x06, 0x04])).toBe(false);
    const fixed = fixedIntervalGroups({ type: 'distance', value: 500, restMs: 60_000 }, 100_000);
    expect(hasSeq(packFrames(fixed)[0]!, pace100)).toBe(true);
  });

  it('builds the read-only query and parses the answer', async () => {
    const { buildGetTargetPaceFrame, parseTargetPace, buildFrame } = await import('@/ble/pm5/csafe');
    expect(buildGetTargetPaceFrame().slice(0, 4)).toEqual([0xf1, 0x7f, 0x01, 0xbe]);
    const resp = parseFrame(buildFrame([0x81, 0x7f, 0x06, 0xbe, 0x04, 0x00, 0x00, 0x27, 0x10]))!;
    expect(parseTargetPace([resp])).toBe(100_000);
    expect(parseTargetPace([parseFrame(buildFrame([0x81, 0x7f, 0x06, 0xbe, 0x04, 0, 0, 0, 0]))!])).toBeNull();
  });
});
