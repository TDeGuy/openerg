/** Pure: deep-merge stored (untrusted) settings over defaults so new fields get defaults. */
import type { AppSettings } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/defaults';
import { migrateGraphs } from '@/components/live/graphs';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function deepMergeDefaults<T>(defaults: T, stored: unknown): T {
  if (isPlainObject(defaults)) {
    if (!isPlainObject(stored)) return clone(defaults);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(defaults)) {
      out[k] = deepMergeDefaults((defaults as Record<string, unknown>)[k], stored[k]);
    }
    return out as T;
  }
  if (stored === undefined) return clone(defaults);
  // Nullable fields (default null) accept any stored value.
  if (defaults === null) return clone(stored) as T;
  if (Array.isArray(defaults)) return (Array.isArray(stored) ? clone(stored) : clone(defaults)) as T;
  if (typeof stored !== typeof defaults) return defaults;
  if (typeof stored === 'number' && !Number.isFinite(stored)) return defaults;
  return stored as T;
}

export function mergeSettings(stored: unknown): AppSettings {
  const merged = deepMergeDefaults(DEFAULT_SETTINGS, stored);
  // Older installs stored 'race' as the personality; it is now a style.
  const old = isPlainObject(stored) && isPlainObject(stored.coxswain) ? stored.coxswain : null;
  if (old && old.style === undefined && old.personality === 'race') merged.coxswain = { ...merged.coxswain, style: 'race', personality: 'calm' };
  const fix = (pages: typeof merged.livePages) => migrateGraphs(pages, merged.forceCurveOverlays);
  merged.livePages = fix(merged.livePages);
  merged.savedLayouts = merged.savedLayouts.map((l) => ({ ...l, pages: fix(l.pages) }));
  return merged;
}

export function defaultSettings(): AppSettings {
  return clone(DEFAULT_SETTINGS);
}
