/** Pure: what a backup restore does, given the user's choices. */
import type { AppSettings } from '@/core/types';
import type { UploadLedger } from './backup';
import { mergeSettings } from './merge';

export type RestoreMode = 'none' | 'new' | 'update';
export type SettingsGroup = 'coxswain' | 'layouts' | 'display' | 'profile' | 'services' | 'devices';

export interface RestoreOptions {
  workouts: RestoreMode;
  plans: RestoreMode;
  groups: Record<SettingsGroup, boolean>;
}

export const GROUP_LABEL: Record<SettingsGroup, string> = {
  coxswain: 'Coxswain settings',
  layouts: 'Rowing-screen layouts and saved layouts',
  display: 'Theme, units and display',
  profile: 'Athlete profile',
  services: 'Upload choices and upload history',
  devices: 'Paired PM5 / HR strap and simulator',
};

const GROUP_KEYS: Record<SettingsGroup, (keyof AppSettings)[]> = {
  coxswain: ['coxswain'],
  layouts: ['livePages', 'savedLayouts', 'activeLayoutId'],
  display: ['theme', 'forceUnit', 'keepAwake', 'showPaceBoat', 'forceCurveOverlays', 'homeWorkoutIds'],
  profile: ['profile'],
  services: ['uploads'],
  devices: ['lastErgId', 'lastHrDeviceId', 'useSimulator', 'autoReconnect'],
};

export const GROUPS = Object.keys(GROUP_KEYS) as SettingsGroup[];

/** Phone settings with only the chosen groups taken from the backup. */
export function mergeRestoredSettings(current: AppSettings, backup: unknown, groups: Record<SettingsGroup, boolean>): AppSettings {
  const restored = mergeSettings(backup);
  const out = { ...current } as Record<string, unknown>;
  for (const g of GROUPS) if (groups[g]) for (const k of GROUP_KEYS[g]) out[k] = restored[k];
  return out as unknown as AppSettings;
}

/** Items to write for a restore mode, counting added vs updated; 'new' leaves existing ones untouched. */
export function planRestore<T extends { id: string }>(existingIds: Iterable<string>, incoming: T[], mode: RestoreMode) {
  const have = new Set(existingIds);
  const toSave = mode === 'none' ? [] : incoming.filter((x) => mode === 'update' || !have.has(x.id));
  const updated = toSave.filter((x) => have.has(x.id)).length;
  return { toSave, added: toSave.length - updated, updated, unchanged: incoming.length - toSave.length };
}

/** The phone's record wins on conflicts; backup-only entries are added so restored workouts aren't re-uploaded. */
export function mergeLedger(current: UploadLedger, backup: UploadLedger): UploadLedger {
  const out: UploadLedger = { ...backup };
  for (const id of Object.keys(current)) out[id] = { ...backup[id], ...current[id] };
  return out;
}
