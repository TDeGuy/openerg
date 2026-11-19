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
/** Set once the user changes anything, so a slow load() never clobbers fresh edits. */
let dirtyBeforeLoad = false;

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void flushSettings();
  }, WRITE_DEBOUNCE_MS);
}

/** Writes the current settings immediately (also used by backup restore). */
export async function flushSettings(): Promise<void> {
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
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        // Never let a stuck backend block the root layout.
        const raw = await Promise.race([
          kv.getItem(SETTINGS_KEY),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        if (raw && !dirtyBeforeLoad) {
          set({ settings: mergeSettings(JSON.parse(raw)) });
        }
      } catch {
        // corrupt / unavailable storage → defaults
      } finally {
        set({ loaded: true });
      }
    })();
    return loadPromise;
  },

  update(patch) {
    if (!get().loaded) dirtyBeforeLoad = true;
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
