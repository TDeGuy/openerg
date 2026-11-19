/**
 * API credentials, OAuth tokens and per-workout upload status.
 * shortcut: tokens and client secrets live in app-private storage (the SQLite kv store), not the OS
 * keystore, because expo-secure-store is a native dependency; upgrade when a dev build can take it.
 * Kept out of AppSettings so backups never contain secrets.
 */
import { create } from 'zustand';

import type { UploadService } from '@/core/types';
import { kv } from '@/storage/kv';
import type { C2Env } from './concept2';
import type { Tokens } from './oauth';

const KEY = 'openerg.integrations.v1';

export interface ServiceAuth {
  clientId: string;
  clientSecret: string;
  tokens: Tokens | null;
}
export interface UploadStatus {
  state: 'done' | 'failed';
  at: number;
  error?: string;
  /** Strava activity id / Concept2 result id when known. */
  remoteId?: string;
}
/** A problem the user should see on the home screen. In memory only; dismissed or cleared on a successful reconnect. */
export interface IntegrationAlert {
  service: UploadService;
  kind: 'upload-failed' | 'reconnect' | 'disconnect-failed';
  message: string;
}
interface Persisted {
  strava: ServiceAuth;
  concept2: ServiceAuth;
  c2Env: C2Env;
  uploads: Record<string, Partial<Record<UploadService, UploadStatus>>>;
}
interface Store extends Persisted {
  loaded: boolean;
  /** In-memory only: `${workoutId}:${service}` while an upload runs. */
  busy: Record<string, true>;
  alert: IntegrationAlert | null;
  raiseAlert(a: IntegrationAlert): void;
  dismissAlert(): void;
  load(): Promise<void>;
  patch(p: Partial<Persisted>): void;
  setBusy(key: string, on: boolean): void;
}

const empty = (): ServiceAuth => ({ clientId: '', clientSecret: '', tokens: null });
let loading: Promise<void> | null = null;

export const useIntegrations = create<Store>()((set, get) => ({
  strava: empty(),
  concept2: empty(),
  c2Env: 'dev',
  uploads: {},
  loaded: false,
  busy: {},
  alert: null,
  raiseAlert: (alert) => set({ alert }),
  dismissAlert: () => set({ alert: null }),
  load() {
    loading ??= (async () => {
      try {
        const raw = await kv.getItem(KEY);
        if (raw) {
          const p = JSON.parse(raw) as Partial<Persisted>;
          set({
            strava: { ...empty(), ...p.strava },
            concept2: { ...empty(), ...p.concept2 },
            c2Env: p.c2Env === 'production' ? 'production' : 'dev',
            uploads: p.uploads ?? {},
          });
        }
      } catch {
        // corrupt storage: start empty
      }
      set({ loaded: true });
    })();
    return loading;
  },
  patch(p) {
    set(p);
    const { strava, concept2, c2Env, uploads } = get();
    void kv.setItem(KEY, JSON.stringify({ strava, concept2, c2Env, uploads }));
  },
  setBusy(key, on) {
    const busy = { ...get().busy };
    if (on) busy[key] = true;
    else delete busy[key];
    set({ busy });
  },
}));

/** Drops upload history for deleted workouts (all of it when no ids are given) so backups don't carry it. */
export async function forgetUploads(ids?: readonly string[]): Promise<void> {
  const s = useIntegrations.getState();
  await s.load(); // patching before the persisted ledger is loaded would overwrite it
  const { uploads, patch } = useIntegrations.getState();
  if (!ids) {
    if (Object.keys(uploads).length) patch({ uploads: {} });
    return;
  }
  if (!ids.some((id) => id in uploads)) return;
  const next = { ...uploads };
  for (const id of ids) delete next[id];
  patch({ uploads: next });
}

export function setUploadStatus(workoutId: string, service: UploadService, status: UploadStatus): void {
  const { uploads, patch } = useIntegrations.getState();
  patch({ uploads: { ...uploads, [workoutId]: { ...uploads[workoutId], [service]: status } } });
}
