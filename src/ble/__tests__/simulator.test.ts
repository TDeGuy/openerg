import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PmWorkoutSummary, SplitSummary, StrokeSample, WorkoutPlan } from '@/core/types';
import { createErgSource } from '@/ble';
import { createSimulator, SIM_ERG } from '@/ble/simulator';

async function run(plan: WorkoutPlan, maxMs = 30_000) {
  const sim = createSimulator({ speed: 50, seed: 42 });
  const strokes: StrokeSample[] = [];
  const splits: SplitSummary[] = [];
  const ends: PmWorkoutSummary[] = [];
  sim.on('stroke', (s) => strokes.push(s));
  sim.on('split', (s) => splits.push(s));
  sim.on('workoutEnd', (s) => ends.push(s));
  const found: string[] = [];
  const stop = await sim.scan((e) => found.push(e.name));
  await vi.advanceTimersByTimeAsync(300);
  stop();
  expect(found).toEqual([SIM_ERG.name]);
  const p = sim.connect(SIM_ERG.id);
  await vi.advanceTimersByTimeAsync(400);
  expect((await p).simulated).toBe(true);
  await sim.programWorkout(plan);
  for (let t = 0; t < maxMs && !ends.length; t += 500) await vi.advanceTimersByTimeAsync(500);
  sim.destroy();
  return { strokes, splits, ends };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('simulator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rows a 500 m piece with strokes, splits and a consistent summary', async () => {
    const { strokes, splits, ends } = await run({ id: 'x', name: '500m', kind: 'single-distance', value: 500 });
    expect(ends).toHaveLength(1);
    const end = ends[0]!;
    expect(end.distanceM).toBeCloseTo(500, 6);
    expect(end.workoutType).toBe('fixed-distance-splits');
    expect(splits).toHaveLength(5);
    expect(sum(splits.map((s) => s.splitDistanceM))).toBeCloseTo(500, 6);
    expect(sum(splits.map((s) => s.splitTimeMs))).toBeCloseTo(end.elapsedMs, 3);
    expect(sum(splits.map((s) => s.strokeCount))).toBe(strokes.length);
    expect(end.strokeCount).toBe(strokes.length);
    expect(end.avgPaceMsPer500).toBeGreaterThan(90_000);
    expect(end.avgPaceMsPer500).toBeLessThan(130_000);
    for (const s of strokes) {
      expect(s.forceCurve.length).toBeGreaterThanOrEqual(16);
      expect(s.peakForceN).toBeCloseTo(Math.max(...s.forceCurve), 0);
      expect(s.driveTimeMs).toBeLessThan(s.recoveryTimeMs);
    }
    expect(strokes.map((s) => s.strokeNumber)).toEqual(strokes.map((_, i) => i + 1));
  });

  it('runs intervals with rest and reports rest in splits and summary', async () => {
    const { splits, ends } = await run({
      id: 'i',
      name: '2x250',
      kind: 'intervals',
      intervals: [
        { type: 'distance', value: 250, restMs: 30_000 },
        { type: 'distance', value: 250, restMs: 30_000 },
      ],
    });
    expect(splits.map((s) => [s.index, s.splitDistanceM, s.restTimeMs])).toEqual([
      [0, 250, 30_000],
      [1, 250, 0],
    ]);
    expect(splits[0]!.restHeartRate).not.toBeNull();
    expect(ends[0]).toMatchObject({ workoutType: 'fixed-distance-interval', intervalCount: 2, totalRestMs: 30_000 });
    expect(ends[0]!.distanceM).toBeCloseTo(500, 6);
  });

  it('createErgSource works without native modules', async () => {
    expect(createErgSource('simulator').kind).toBe('simulator');
    const ble = createErgSource('ble');
    vi.useRealTimers();
    expect(await ble.prepare()).toMatchObject({ ok: false });
    ble.destroy();
  });
});
