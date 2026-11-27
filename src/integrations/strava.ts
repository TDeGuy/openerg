/** Strava: OAuth + TCX upload (https://developers.strava.com/docs/authentication, /docs/uploads). */
import type { MachineType, WorkoutRecord } from '@/core/types';
import { toTcx } from '@/storage/formats';
import { formBody, postForm, type Tokens } from './oauth';

export const STRAVA_REDIRECT = 'openerg://oauth/strava';
/** Strava wants the host part of the redirect URI as "Authorization Callback Domain". */
export const STRAVA_CALLBACK_DOMAIN = 'oauth';
const API = 'https://www.strava.com';

export function stravaAuthUrl(clientId: string, state: string): string {
  return `${API}/oauth/authorize?${formBody({
    client_id: clientId,
    state,
    redirect_uri: STRAVA_REDIRECT,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:write',
  })}`;
}

function toTokens(j: Record<string, unknown>): Tokens {
  if (typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string') throw new Error('Strava returned no tokens.');
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Number(j.expires_at) * 1000 };
}

export async function stravaExchange(id: string, secret: string, code: string): Promise<Tokens> {
  return toTokens(await postForm(`${API}/oauth/token`, { client_id: id, client_secret: secret, code, grant_type: 'authorization_code' }));
}

/** Strava rotates the refresh token on every refresh: always store the returned one. */
export async function stravaRefresh(id: string, secret: string, refreshToken: string): Promise<Tokens> {
  return toTokens(await postForm(`${API}/oauth/token`, { client_id: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: refreshToken }));
}

export async function stravaRevoke(id: string, secret: string, token: string): Promise<void> {
  await fetch(`${API}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body: formBody({ token }),
  }).catch(() => undefined);
}

const SPORT: Record<MachineType, string> = { rower: 'Rowing', skierg: 'NordicSki', bikeerg: 'VirtualRide' };

/** Non-file multipart fields. external_id makes Strava reject a duplicate of the same workout. */
export function stravaFields(record: WorkoutRecord): Record<string, string> {
  const f: Record<string, string> = {
    data_type: 'tcx',
    sport_type: SPORT[record.machineType] ?? 'Workout',
    trainer: '1',
    name: record.title,
    external_id: `openerg-${record.id}`,
  };
  if (record.notes) f.description = record.notes;
  return f;
}

export const stravaFile = (record: WorkoutRecord) => ({ name: `openerg-${record.id}.tcx`, content: toTcx(record) });

export interface UploadPart {
  uri: string;
  name: string;
  type: string;
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(j: Record<string, unknown>): string {
  return String(j.error ?? j.status ?? 'Unknown error').replace(/<[^>]*>/g, '').slice(0, 200);
}

/** Uploads the file and polls (<= 1 req/s per Strava) until processed. Returns the activity id. */
export async function stravaUpload(
  accessToken: string,
  record: WorkoutRecord,
  file: UploadPart,
  opts: { sleep?: (ms: number) => Promise<unknown>; maxPolls?: number } = {},
): Promise<string> {
  const sleep = opts.sleep ?? sleepMs;
  const auth = { Authorization: `Bearer ${accessToken}` };
  const form = new FormData();
  for (const [k, v] of Object.entries(stravaFields(record))) form.append(k, v);
  form.append('file', file as unknown as Blob);
  const res = await fetch(`${API}/api/v3/uploads`, { method: 'POST', headers: auth, body: form });
  const first = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Strava rejected the upload (${res.status}). ${describe(first)}`);
  const id = String(first.id_str ?? first.id);
  for (let i = 0; i < (opts.maxPolls ?? 30); i++) {
    await sleep(1500);
    const r = await fetch(`${API}/api/v3/uploads/${id}`, { headers: auth });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    // A repeat of an upload that did reach Strava (same external_id) is reported with the earlier activity id.
    const dup = /duplicate of activity (\d+)/.exec(String(j.error ?? ''));
    if (dup) return dup[1]!;
    if (j.error) throw new Error(describe(j));
    if (j.activity_id) return String(j.activity_id);
    if (!r.ok) throw new Error(`Strava status check failed (${r.status}).`);
  }
  throw new Error('Strava is still processing the upload. Check Strava before retrying.');
}
