/** Persisted app settings (zustand). JSON in the key-value store, debounced writes. */
import { create } from 'zustand';

import type { AppSettings, AthleteProfile, CoxswainSettings } from '@/core/types';

import { kv } from './kv';
import { defaultSettings, mergeSettings } from './merge';

export const SETTINGS_KEY = 'openerg.settings.v1';
const WRITE_DEBOUNCE_MS = 400;

interface SettingsStore {
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<AppSettings>): void;
  updateProfile(patch: Partial<AthleteProfile>): void;
  updateCoxswain(patch: Partial<CoxswainSettings>): void;
  reset(): void;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let loadPromise: Promise<void> | null = null;
/** Edits made before the stored settings were read; replayed on top of them. */
let pendingEdits: Partial<AppSettings>[] = [];
/** Until the stored settings are read, nothing is written: defaults must never overwrite them. */
let readDone = false;

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void flushSettings();
  }, WRITE_DEBOUNCE_MS);
}

/** Writes the current settings immediately (also used by backup restore). */
export async function flushSettings(): Promise<void> {
  if (!readDone) return;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    await kv.setItem(SETTINGS_KEY, JSON.stringify(useSettings.getState().settings));
  } catch {
    // fail soft: settings stay in memory
  }
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  settings: defaultSettings(),
  loaded: false,

  load() {
    loadPromise ??= (async () => {
      const read = kv
        .getItem(SETTINGS_KEY)
        .then((raw) => {
          const stored = raw ? mergeSettings(JSON.parse(raw)) : get().settings;
          set({ settings: pendingEdits.reduce<AppSettings>((cur, p) => mergeSettings({ ...cur, ...p }), stored) });
        })
        .catch(() => undefined) // corrupt or unavailable storage: keep defaults
        .finally(() => {
          readDone = true;
          if (pendingEdits.length) scheduleWrite();
          pendingEdits = [];
        });
      // The 4 s cap only stops the root layout waiting; the read still lands later.
      await Promise.race([read, new Promise((resolve) => setTimeout(resolve, 4000))]);
      set({ loaded: true });
    })();
    return loadPromise;
  },

  update(patch) {
    if (!readDone) pendingEdits.push(patch);
    set({ settings: mergeSettings({ ...get().settings, ...patch }) });
    scheduleWrite();
  },

  updateProfile(patch) {
    const s = get().settings;
    get().update({ profile: { ...s.profile, ...patch } });
  },

  updateCoxswain(patch) {
    const s = get().settings;
    get().update({ coxswain: { ...s.coxswain, ...patch } });
  },

  reset() {
    set({ settings: defaultSettings() });
    scheduleWrite();
  },
}));
