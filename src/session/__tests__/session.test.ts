import { describe, expect, it } from 'vitest';
import type { PmWorkoutSummary, StrokeSample, WorkoutRecord } from '@/core/types';
import { emptyMetrics } from '@/core/defaults';
import { buildGhost, computeGhostBoat } from '../ghost';
import { derivePhase, isWorkoutOver } from '../phase';
import { WorkoutRecorder } from '../recorder';

function stroke(n: number, elapsedMs: number, distanceM: number): StrokeSample {
  return {
    strokeNumber: n, elapsedMs, distanceM, paceMsPer500: 120_000, watts: 200, strokeRate: 24, heartRate: null,
    driveLengthM: 1.4, driveTimeMs: 800, recoveryTimeMs: 1700, strokeDistanceM: 10, peakForceN: 600, avgForceN: 400,
    workPerStrokeJ: 650, intervalCount: 0, forceCurve: [],
  };
}

describe('recorder', () => {
  it('dedupes strokes, derives totals, and decides worth saving', () => {
    const r = new WorkoutRecorder({ plan: null });
    expect(r.addStroke(stroke(1, 2500, 10), 100_000)).toBe(true);
    expect(r.addStroke(stroke(1, 2500, 10))).toBe(false);
    expect(r.isWorthSaving()).toBe(true);
    r.addStroke(stroke(2, 60_000, 250));
    expect(r.startedAt).toBe(97_500);
    const rec = r.build({ title: () => 'T' });
    expect(rec.strokeCount).toBe(2);
    expect(rec.distanceM).toBe(250);
    expect(rec.avgPaceMsPer500).toBe(120_000);
    expect(rec.verified).toBe(false);
    expect(r.isWorthSaving()).toBe(true);
  });

  it('prefers PM summary values and falls back per field', () => {
    const r = new WorkoutRecorder({ plan: { id: 'p', name: '2k', kind: 'single-distance', value: 2000 } });
    r.addStroke(stroke(1, 400_000, 1990));
    const sum: PmWorkoutSummary = {
      endedAt: 5, elapsedMs: 402_000, distanceM: 2000, avgPaceMsPer500: 100_500, avgWatts: 0, avgStrokeRate: 30,
      avgHeartRate: null, minHeartRate: null, maxHeartRate: null, avgDragFactor: 125, calories: 120, strokeCount: 210,
      workoutType: 'fixed-distance-no-splits', intervalCount: 0, totalRestMs: 0,
    };
    r.setSummary(sum);
    const rec = r.build();
    expect(rec.title).toBe('2k');
    expect([rec.distanceM, rec.elapsedMs, rec.strokeCount, rec.avgWatts]).toEqual([2000, 402_000, 210, 200]);
    expect(rec.verified).toBe(true);
    expect(rec.endedAt).toBe(5);
  });
});

describe('phase', () => {
  it('maps PM states to session phases', () => {
    const m = (workoutState: any, rowingState: any = 'active') => ({ workoutState, rowingState });
    expect(derivePhase({ armed: false, started: false, finished: false, metrics: m('workout-row') })).toBe('idle');
    expect(derivePhase({ armed: true, started: false, finished: false, metrics: m('workout-end') })).toBe('ready');
    expect(derivePhase({ armed: true, started: true, finished: false, metrics: m('workout-row') })).toBe('rowing');
    expect(derivePhase({ armed: true, started: true, finished: false, metrics: m('interval-rest') })).toBe('rest');
    expect(isWorkoutOver(true, { ...emptyMetrics(), workoutState: 'waiting-to-begin' })).toBe(true);
  });
});

describe('ghost', () => {
  it('reports gap in metres and ms versus the previous piece', () => {
    const g = buildGhost({ startedAt: Date.UTC(2026, 2, 12, 12), splits: [], avgPaceMsPer500: 120_000,
      strokes: [stroke(1, 60_000, 250), stroke(2, 120_000, 500)] } as unknown as WorkoutRecord)!;
    expect(g.label).toBe('Ghost · 12 Mar');
    const b = computeGhostBoat(g, 60_000, 260);
    expect(b.gapM).toBeCloseTo(10);
    expect(b.gapMs).toBeCloseTo(2400);
  });
});
