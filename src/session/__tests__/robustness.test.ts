import { describe, expect, it, vi } from 'vitest';
import type { StrokeSample, WorkoutRecord } from '@/core/types';
import { nextReconnectDelay, RECONNECT_DELAYS_MS } from '@/ble/pm5/link';
import { averageHeartRate, persistRecord, useSessionExtras } from '../extras';
import { WorkoutRecorder } from '../recorder';

const stroke = (n: number, d: number, hr: number | null = null): StrokeSample => ({
  strokeNumber: n, elapsedMs: n * 2500, distanceM: d, paceMsPer500: 120_000, watts: 200, strokeRate: 24, heartRate: hr,
  driveLengthM: 1.4, driveTimeMs: 800, recoveryTimeMs: 1700, strokeDistanceM: 10, peakForceN: 600, avgForceN: 400,
  workPerStrokeJ: 650, intervalCount: 0, forceCurve: [],
});

describe('failed save keeps the workout', () => {
  const rec = { id: 'w1' } as WorkoutRecord;
  it('hands the record back on failure and the retry succeeds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const save = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    expect(await persistRecord(rec, save)).toEqual({ id: null, pending: rec });
    expect(await persistRecord(rec, save)).toEqual({ id: 'w1', pending: null });
  });
});

describe('mute state', () => {
  it('lives in one store the UI reads', () => {
    useSessionExtras.setState({ muted: true });
    expect(useSessionExtras.getState().muted).toBe(true);
    useSessionExtras.setState({ muted: false });
  });
});

describe('reconnect schedule', () => {
  it('gives up after about 45 seconds', () => {
    const total = RECONNECT_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(30_000);
    expect(total).toBeLessThanOrEqual(45_000);
    expect(nextReconnectDelay(0)).toBe(1000);
    expect(nextReconnectDelay(RECONNECT_DELAYS_MS.length)).toBeNull();
  });
});

describe('short rows', () => {
  it('saves anything with a stroke or distance, not an empty piece', () => {
    expect(new WorkoutRecorder({ plan: null }).isWorthSaving()).toBe(false);
    const r = new WorkoutRecorder({ plan: null });
    r.addStroke(stroke(1, 5));
    expect(r.isWorthSaving()).toBe(true);
  });
});

describe('average heart rate', () => {
  it('averages samples, ignores gaps, falls back to splits', () => {
    expect(averageHeartRate([stroke(1, 1, 100), stroke(2, 2, null), stroke(3, 3, 140)], [])).toBe(120);
    expect(averageHeartRate([], [{ avgHeartRate: 150 }])).toBe(150);
    expect(averageHeartRate([], [])).toBeNull();
  });
});
