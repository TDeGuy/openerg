/** Connect / disconnect services and upload workouts. Native modules are required lazily so this stays testable. */
import type { UploadService, WorkoutRecord } from '@/core/types';
import { useSettings } from '@/storage/settings';
import { buildC2Result, c2AuthUrl, c2Exchange, c2Post, c2Refresh, C2_REDIRECT } from './concept2';
import { freshTokens, parseRedirect, type Tokens } from './oauth';
import { setUploadStatus, useIntegrations } from './store';
import { STRAVA_REDIRECT, stravaAuthUrl, stravaExchange, stravaFile, stravaRefresh, stravaRevoke, stravaUpload } from './strava';

export const SERVICE_NAME: Record<UploadService, string> = { strava: 'Strava', concept2: 'Concept2 Logbook' };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isConnected = (s: UploadService) => !!useIntegrations.getState()[s].tokens;

function saveTokens(service: UploadService, tokens: Tokens | null) {
  const st = useIntegrations.getState();
  st.patch({ [service]: { ...st[service], tokens } });
}

async function authorise(service: UploadService): Promise<void> {
  const st = useIntegrations.getState();
  const { clientId, clientSecret } = st[service];
  if (!clientId.trim() || !clientSecret.trim()) throw new Error('Enter the client ID and client secret first.');
  const url = service === 'strava' ? stravaAuthUrl(clientId.trim()) : c2AuthUrl(st.c2Env, clientId.trim());
  const redirect = service === 'strava' ? STRAVA_REDIRECT : C2_REDIRECT;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebBrowser = require('expo-web-browser') as typeof import('expo-web-browser');
  const res = await WebBrowser.openAuthSessionAsync(url, redirect);
  if (res.type !== 'success') throw new Error('Sign-in was cancelled.');
  const code = parseRedirect(res.url);
  const tokens =
    service === 'strava'
      ? await stravaExchange(clientId.trim(), clientSecret.trim(), code)
      : await c2Exchange(st.c2Env, clientId.trim(), clientSecret.trim(), code);
  saveTokens(service, tokens);
  const a = useIntegrations.getState().alert;
  if (a?.service === service) useIntegrations.getState().dismissAlert();
}
export const connectService = authorise;

export async function disconnectService(service: UploadService): Promise<void> {
  const { tokens, clientId, clientSecret } = useIntegrations.getState()[service];
  try {
    if (service === 'strava' && tokens) await stravaRevoke(clientId, clientSecret, tokens.accessToken);
  } catch (e) {
    useIntegrations.getState().raiseAlert({ service, kind: 'disconnect-failed', message: `Could not tell ${SERVICE_NAME[service]} to revoke access (${errorText(e)}). This phone is disconnected; you can revoke the app in the service\x27s settings.` });
  } finally {
    saveTokens(service, null); // always forget local tokens, even when the remote revoke fails
  }
}

const refreshing: Partial<Record<UploadService, Promise<string>>> = {};

/** A valid access token, refreshing (once, even if called concurrently) when about to expire. */
export function accessToken(service: UploadService): Promise<string> {
  return (refreshing[service] ??= (async () => {
    const st = useIntegrations.getState();
    const a = st[service];
    if (!a.tokens) throw new Error(`${SERVICE_NAME[service]} is not connected.`);
    let t: Tokens;
    try {
      t = await freshTokens(a.tokens, (rt) =>
        service === 'strava' ? stravaRefresh(a.clientId, a.clientSecret, rt) : c2Refresh(st.c2Env, a.clientId, a.clientSecret, rt),
      );
    } catch (e) {
      st.raiseAlert({ service, kind: 'reconnect', message: `${SERVICE_NAME[service]} sign-in expired. Reconnect to keep uploading.` });
      throw e;
    }
    if (t !== a.tokens) saveTokens(service, t);
    return t.accessToken;
  })().finally(() => {
    delete refreshing[service];
  }));
}

async function send(service: UploadService, record: WorkoutRecord): Promise<string | null> {
  const token = await accessToken(service);
  if (service === 'concept2') {
    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      tz = undefined;
    }
    return c2Post(useIntegrations.getState().c2Env, token, buildC2Result(record, useSettings.getState().settings.profile, tz));
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const f = stravaFile(record);
  const file = new File(Paths.cache, f.name);
  if (file.exists) file.delete();
  file.create();
  await file.write(f.content);
  try {
    return await stravaUpload(token, record, { uri: file.uri, name: f.name, type: 'application/vnd.garmin.tcx+xml' });
  } finally {
    try {
      file.delete();
    } catch {
      // cache file, harmless
    }
  }
}

/** Uploads once: no-op if already uploaded or an upload is running. Never throws; the outcome is recorded. */
export async function uploadWorkout(record: WorkoutRecord, service: UploadService): Promise<void> {
  const st = useIntegrations.getState();
  const key = `${record.id}:${service}`;
  if (st.uploads[record.id]?.[service]?.state === 'done' || st.busy[key]) return;
  st.setBusy(key, true);
  try {
    const remoteId = await send(service, record);
    setUploadStatus(record.id, service, { state: 'done', at: Date.now(), remoteId: remoteId ?? undefined });
  } catch (e) {
    setUploadStatus(record.id, service, { state: 'failed', at: Date.now(), error: errorText(e) });
    const st2 = useIntegrations.getState();
    if (st2.alert?.kind !== 'reconnect' || st2.alert.service !== service) {
      st2.raiseAlert({ service, kind: 'upload-failed', message: `Upload to ${SERVICE_NAME[service]} failed: ${errorText(e)}` });
    }
  } finally {
    useIntegrations.getState().setBusy(key, false);
  }
}

/** Called when a workout is saved: uploads to every connected service set to "Always". Simulator rows are skipped. */
export async function autoUpload(record: WorkoutRecord): Promise<void> {
  if (record.simulated) return;
  await useIntegrations.getState().load();
  const modes = useSettings.getState().settings.uploads;
  for (const s of ['strava', 'concept2'] as const) {
    if (modes[s] === 'always' && isConnected(s)) await uploadWorkout(record, s);
  }
}
