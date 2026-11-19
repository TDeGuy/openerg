/** Concept2 Logbook: OAuth + result upload (https://log.concept2.com/developers/documentation). */
import type { AthleteProfile, PmWorkoutType, SplitSummary, WorkoutRecord } from '@/core/types';
import { formBody, postForm, type Tokens } from './oauth';

export type C2Env = 'dev' | 'production';
export const C2_REDIRECT = 'openerg://oauth/concept2';
const SCOPE = 'results:write';
const HOST: Record<C2Env, string> = { production: 'https://log.concept2.com', dev: 'https://log-dev.concept2.com' };

export function c2AuthUrl(env: C2Env, clientId: string): string {
  return `${HOST[env]}/oauth/authorize?${formBody({ client_id: clientId, scope: SCOPE, response_type: 'code', redirect_uri: C2_REDIRECT })}`;
}

function toTokens(j: Record<string, unknown>, now: number): Tokens {
  if (typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string') throw new Error('Concept2 returned no tokens.');
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: now + Number(j.expires_in) * 1000 };
}

export async function c2Exchange(env: C2Env, id: string, secret: string, code: string, now = Date.now()): Promise<Tokens> {
  const j = await postForm(`${HOST[env]}/oauth/access_token`, {
    client_id: id, client_secret: secret, grant_type: 'authorization_code', scope: SCOPE, code, redirect_uri: C2_REDIRECT,
  });
  return toTokens(j, now);
}

/** Refresh tokens are single-use: each refresh returns a new pair. */
export async function c2Refresh(env: C2Env, id: string, secret: string, refreshToken: string, now = Date.now()): Promise<Tokens> {
  const j = await postForm(`${HOST[env]}/oauth/access_token`, {
    client_id: id, client_secret: secret, grant_type: 'refresh_token', scope: SCOPE, refresh_token: refreshToken,
  });
  return toTokens(j, now);
}

const WORKOUT_TYPE: Record<PmWorkoutType, string> = {
  'just-row-no-splits': 'JustRow',
  'just-row-splits': 'JustRow',
  'fixed-distance-no-splits': 'FixedDistanceSplits',
  'fixed-distance-splits': 'FixedDistanceSplits',
  'fixed-time-no-splits': 'FixedTimeSplits',
  'fixed-time-splits': 'FixedTimeSplits',
  'fixed-time-interval': 'FixedTimeInterval',
  'fixed-distance-interval': 'FixedDistanceInterval',
  'variable-interval': 'VariableInterval',
  'variable-undefined-rest-interval': 'VariableIntervalUndefinedRest',
  'fixed-calorie': 'FixedCalorie',
  'fixed-watt-minutes': 'FixedWattMinute',
  'fixed-calorie-interval': 'FixedCalorieInterval',
  unknown: 'unknown',
};

const MACHINE = { rower: 'rower', skierg: 'skierg', bikeerg: 'bike' } as const;
const tenths = (ms: number) => Math.max(0, Math.round(ms / 100));
const pad = (n: number) => String(n).padStart(2, '0');

/** "yyyy-mm-dd hh:mm:ss" in the phone's local time (sent together with `timezone`). */
export function c2Date(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Concept2 lightweight limits: men 75 kg, women 61.5 kg. Unknown profile defaults to heavyweight. */
export function weightClass(profile: Pick<AthleteProfile, 'sex' | 'weightKg'>): 'H' | 'L' {
  if (!profile.weightKg) return 'H';
  return profile.weightKg <= (profile.sex === 'female' ? 61.5 : 75) ? 'L' : 'H';
}

function intervalType(s: SplitSummary, wt: PmWorkoutType): 'time' | 'distance' | 'calorie' | 'wattminute' {
  if (s.type.startsWith('time')) return 'time';
  if (s.type.startsWith('distance')) return 'distance';
  if (s.type.startsWith('calorie')) return 'calorie';
  if (s.type.startsWith('watt')) return 'wattminute';
  return wt.includes('time') ? 'time' : wt.includes('calorie') ? 'calorie' : 'distance';
}

const isRest = (s: SplitSummary) => s.type === 'rest' || s.type === 'rest-undefined';
const hr = (avg: number | null | undefined) => (avg && avg > 0 ? { average: Math.round(avg) } : undefined);

/** Pure: WorkoutRecord -> body for POST /api/users/me/results. Undefined fields drop out in JSON. */
export function buildC2Result(record: WorkoutRecord, profile: Pick<AthleteProfile, 'sex' | 'weightKg'>, timezone?: string) {
  const interval = record.workoutType.includes('interval') || record.splits.some((s) => s.restTimeMs > 0);
  const work = record.splits.filter((s) => !isRest(s)).sort((a, b) => a.index - b.index);
  const bike = record.machineType === 'bikeerg';
  const heartRate = {
    ...hr(record.avgHeartRate),
    ...(record.maxHeartRate ? { max: Math.round(record.maxHeartRate) } : {}),
  };

  const body: Record<string, unknown> = {
    type: MACHINE[record.machineType],
    date: c2Date(record.endedAt),
    timezone,
    distance: Math.round(interval && work.length ? work.reduce((a, s) => a + s.splitDistanceM, 0) : record.distanceM),
    time: tenths(interval && work.length ? work.reduce((a, s) => a + s.splitTimeMs, 0) : record.elapsedMs),
    workout_type: WORKOUT_TYPE[record.workoutType] ?? 'unknown',
    comments: record.notes ? record.notes.replace(/\r?\n/g, '\r\n') : undefined,
    stroke_rate: record.avgStrokeRate > 0 ? Math.round(record.avgStrokeRate) : undefined,
    stroke_count: record.strokeCount > 0 ? record.strokeCount : undefined,
    calories_total: record.calories > 0 ? Math.round(record.calories) : undefined,
    drag_factor: record.avgDragFactor > 0 ? Math.round(record.avgDragFactor) : undefined,
    heart_rate: Object.keys(heartRate).length ? heartRate : undefined,
    metadata: record.ergName || record.ergSerial ? { device: record.ergName, serial_number: record.ergSerial } : undefined,
  };
  if (record.machineType === 'rower') body.weight_class = weightClass(profile);

  if (interval && work.length) {
    body.rest_time = tenths(record.totalRestMs);
    body.rest_distance = Math.round(work.reduce((a, s) => a + s.restDistanceM, 0));
    body.workout = {
      intervals: work.map((s) => ({
        type: intervalType(s, record.workoutType),
        distance: Math.round(s.splitDistanceM),
        time: tenths(s.splitTimeMs),
        rest_time: tenths(s.restTimeMs),
        rest_distance: s.restDistanceM > 0 ? Math.round(s.restDistanceM) : undefined,
        stroke_rate: s.avgStrokeRate > 0 ? Math.round(s.avgStrokeRate) : undefined,
        calories_total: s.calories > 0 ? Math.round(s.calories) : undefined,
        heart_rate: hr(s.avgHeartRate),
      })),
    };
  } else if (work.length > 1) {
    body.workout = {
      splits: work.map((s) => ({
        distance: Math.round(s.splitDistanceM),
        time: tenths(s.splitTimeMs),
        stroke_rate: s.avgStrokeRate > 0 ? Math.round(s.avgStrokeRate) : undefined,
        calories_total: s.calories > 0 ? Math.round(s.calories) : undefined,
        heart_rate: hr(s.avgHeartRate),
      })),
    };
  }

  // The PM restarts stroke time/distance at 0 for each interval, which is what the API expects.
  const strokes = record.strokes.filter((s) => s.paceMsPer500 > 0);
  if (strokes.length) {
    body.stroke_data = strokes.map((s) => ({
      t: tenths(s.elapsedMs),
      d: Math.round(s.distanceM * 10),
      p: tenths(s.paceMsPer500 * (bike ? 2 : 1)), // API: per 1000 m for BikeErg
      spm: Math.round(s.strokeRate),
      hr: s.heartRate && s.heartRate > 0 ? Math.round(s.heartRate) : undefined,
    }));
  }
  return body;
}

/** Posts the result. 409 (same date/time/distance already logged) counts as success. Returns the result id if given. */
export async function c2Post(env: C2Env, accessToken: string, body: unknown): Promise<string | null> {
  const res = await fetch(`${HOST[env]}/api/users/me/results`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/vnd.c2logbook.v1+json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) return null;
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: number | string }; message?: string; errors?: unknown };
  if (!res.ok) {
    const detail = j.errors ? JSON.stringify(j.errors).slice(0, 200) : (j.message ?? '');
    throw new Error(`Concept2 rejected the result (${res.status}). ${detail}`.trim());
  }
  return j.data?.id != null ? String(j.data.id) : null;
}
