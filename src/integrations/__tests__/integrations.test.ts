import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SplitSummary, StrokeSample, WorkoutRecord } from '@/core/types';
import { buildC2Result, c2Date, c2Post, c2Refresh, weightClass } from '../concept2';
import { freshTokens, parseRedirect } from '../oauth';
import { stravaFields, stravaRefresh, stravaUpload } from '../strava';

const stroke = (n: number, t: number, d: number, i = 0): StrokeSample =>
  ({ strokeNumber: n, elapsedMs: t, distanceM: d, paceMsPer500: 120_000, watts: 200, strokeRate: 24.4, heartRate: 150, intervalCount: i, forceCurve: [] }) as unknown as StrokeSample;
const split = (index: number, rest = 0): SplitSummary =>
  ({ index, type: rest ? 'time' : 'distance', splitTimeMs: 120_000, splitDistanceM: 500, restTimeMs: rest, restDistanceM: 0, avgStrokeRate: 24, avgHeartRate: 150, calories: 30 }) as unknown as SplitSummary;
const rec = (over: Partial<WorkoutRecord> = {}): WorkoutRecord =>
  ({
    id: 'w1', startedAt: 0, endedAt: new Date(2026, 2, 12, 8, 10, 5).getTime(), machineType: 'rower', title: '1000m', notes: 'a\nb',
    workoutType: 'fixed-distance-splits', elapsedMs: 240_000, distanceM: 1000, avgStrokeRate: 24.4, avgHeartRate: 150.2, maxHeartRate: 170,
    calories: 60, strokeCount: 2, avgDragFactor: 120, totalRestMs: 0, plan: null, ergName: 'PM5',
    splits: [split(0), split(1)], strokes: [stroke(1, 60_000, 250.4), stroke(2, 180_000, 750)], heartRate: [], coxCalls: [], ...over,
  }) as unknown as WorkoutRecord;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe('concept2 payload', () => {
  it('builds a fixed-distance result in API units', () => {
    const b = buildC2Result(rec(), { sex: null, weightKg: null }, 'Europe/London') as Record<string, any>;
    expect(b).toMatchObject({ type: 'rower', date: c2Date(rec().endedAt), distance: 1000, time: 2400, workout_type: 'FixedDistanceSplits', weight_class: 'H', stroke_rate: 24, comments: 'a\r\nb' });
    expect(b.date).toBe('2026-03-12 08:10:05');
    expect(b.heart_rate).toEqual({ average: 150, max: 170 });
    expect(b.workout.splits).toHaveLength(2);
    expect(b.stroke_data[0]).toEqual({ t: 600, d: 2504, p: 1200, spm: 24, hr: 150 });
  });
  it('builds work-only totals and rest for intervals', () => {
    const r = rec({ workoutType: 'fixed-time-interval', totalRestMs: 60_000, splits: [split(0, 30_000), split(1, 30_000)] });
    const b = buildC2Result(r, { sex: 'female', weightKg: 60 }) as Record<string, any>;
    expect(b).toMatchObject({ distance: 1000, time: 2400, rest_time: 600, weight_class: 'L', workout_type: 'FixedTimeInterval' });
    expect(b.workout.intervals[0]).toMatchObject({ type: 'time', distance: 500, time: 1200, rest_time: 300 });
    expect(b.workout.splits).toBeUndefined();
  });
  it('weight class', () => {
    expect(weightClass({ sex: 'male', weightKg: 80 })).toBe('H');
    expect(weightClass({ sex: 'male', weightKg: 70 })).toBe('L');
  });
  it('treats 409 as already uploaded and surfaces 422', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 409)).mockResolvedValueOnce(json({ message: 'bad' }, 422)));
    expect(await c2Post('dev', 't', {})).toBeNull();
    await expect(c2Post('dev', 't', {})).rejects.toThrow(/422/);
  });
});

describe('strava', () => {
  it('sets trainer + rowing and a duplicate-guard external id', () => {
    expect(stravaFields(rec())).toMatchObject({ data_type: 'tcx', sport_type: 'Rowing', trainer: '1', external_id: 'openerg-w1', description: 'a\nb' });
  });
  it('polls until the activity exists', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ id_str: '9' }, 201))
      .mockResolvedValueOnce(json({ id_str: '9', status: 'processing', activity_id: null, error: null }))
      .mockResolvedValueOnce(json({ activity_id: 77, error: null }));
    vi.stubGlobal('fetch', f);
    const id = await stravaUpload('tok', rec(), { uri: 'file:///x.tcx', name: 'x.tcx', type: 't' }, { sleep: async () => undefined });
    expect(id).toBe('77');
    expect(f.mock.calls[1][0]).toContain('/uploads/9');
  });
  it('reports processing errors such as duplicates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ id: 1 }, 201)).mockResolvedValueOnce(json({ error: 'x.tcx duplicate of activity 5' })));
    await expect(stravaUpload('t', rec(), { uri: 'u', name: 'n', type: 't' }, { sleep: async () => undefined })).rejects.toThrow(/duplicate/);
  });
});

describe('tokens', () => {
  const t = { accessToken: 'a', refreshToken: 'r', expiresAt: 10_000_000 };
  it('keeps a valid token and refreshes an expiring one', async () => {
    const refresh = vi.fn().mockResolvedValue({ ...t, accessToken: 'new' });
    expect(await freshTokens(t, refresh, 0)).toBe(t);
    expect((await freshTokens(t, refresh, 9_900_000)).accessToken).toBe('new');
    expect(refresh).toHaveBeenCalledWith('r');
  });
  it('strava refresh stores the rotated refresh token (epoch seconds)', async () => {
    const f = vi.fn().mockResolvedValue(json({ access_token: 'n', refresh_token: 'r2', expires_at: 2000 }));
    vi.stubGlobal('fetch', f);
    expect(await stravaRefresh('id', 'sec', 'r1')).toEqual({ accessToken: 'n', refreshToken: 'r2', expiresAt: 2_000_000 });
    expect(f.mock.calls[0][1].body).toContain('grant_type=refresh_token');
  });
  it('concept2 refresh uses expires_in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ access_token: 'n', refresh_token: 'r2', expires_in: 100 })));
    expect((await c2Refresh('dev', 'i', 's', 'r1', 1000)).expiresAt).toBe(101_000);
  });
  it('parses redirects', () => {
    expect(parseRedirect('openerg://oauth/strava?state=&code=abc&scope=activity:write')).toBe('abc');
    expect(() => parseRedirect('openerg://oauth/strava?error=access_denied')).toThrow(/denied/);
  });
});
