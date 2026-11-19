/** Pure helpers for named live-page layouts. The active layout mirrors settings.livePages. */
import type { AppSettings, LivePageConfig, SavedLayout } from '@/core/types';

type Patch = Pick<AppSettings, 'livePages' | 'savedLayouts' | 'activeLayoutId'>;
type S = Pick<AppSettings, 'livePages' | 'savedLayouts' | 'activeLayoutId'>;

const copy = (pages: LivePageConfig[]): LivePageConfig[] => JSON.parse(JSON.stringify(pages));

/** Page edit: also writes through to the active saved layout. */
export function editPages(s: S, pages: LivePageConfig[]): Patch {
  return {
    livePages: pages,
    activeLayoutId: s.activeLayoutId,
    savedLayouts: s.savedLayouts.map((l) => (l.id === s.activeLayoutId ? { ...l, pages: copy(pages) } : l)),
  };
}

/** Saves the current pages as a new named layout and makes it active. */
export function saveLayout(s: S, name: string, id: string): Patch {
  const layout: SavedLayout = { id, name: name.trim() || `Layout ${s.savedLayouts.length + 1}`, pages: copy(s.livePages) };
  return { livePages: s.livePages, savedLayouts: [...s.savedLayouts, layout], activeLayoutId: id };
}

export function activateLayout(s: S, id: string): Patch {
  const l = s.savedLayouts.find((x) => x.id === id);
  return l && l.pages.length ? { savedLayouts: s.savedLayouts, livePages: copy(l.pages), activeLayoutId: id } : s;
}

export function renameLayout(s: S, id: string, name: string): Patch {
  return { ...s, savedLayouts: s.savedLayouts.map((l) => (l.id === id ? { ...l, name } : l)) };
}

/** Deleting the active layout keeps the pages on screen; they just stop being tied to a layout. */
export function deleteLayout(s: S, id: string): Patch {
  return { ...s, savedLayouts: s.savedLayouts.filter((l) => l.id !== id), activeLayoutId: s.activeLayoutId === id ? null : s.activeLayoutId };
}
