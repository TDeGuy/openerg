/** Pure registry of live graph positions and per-graph line / overlay options (no React). */
import type { GraphPosition, LiveGraphKey, LivePageConfig } from '@/core/types';

export const GRAPH_POSITIONS: { key: GraphPosition; label: string }[] = [
  { key: 'auto', label: 'Auto' },
  { key: 'right', label: 'Right' },
  { key: 'left', label: 'Left' },
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'graphsOnly', label: 'Graphs only' },
  { key: 'tilesOnly', label: 'Tiles only' },
];

export const GRAPH_OPTIONS: Partial<Record<LiveGraphKey, { key: string; label: string }[]>> = {
  forceCurve: [
    { key: 'previous', label: 'Previous' },
    { key: 'average', label: 'Average' },
    { key: 'ideal', label: 'Ideal' },
  ],
  paceRate: [
    { key: 'pace', label: 'Pace' },
    { key: 'rate', label: 'Rate' },
  ],
  paceHistory: [
    { key: 'avg', label: 'Avg pace' },
    { key: 'plan', label: 'Plan' },
    { key: 'markers', label: 'Plan changes' },
    { key: 'boat', label: 'Pace boat' },
  ],
  hrHistory: [{ key: 'zones', label: 'Zones' }],
  wattsHistory: [{ key: 'avg', label: 'Average' }],
};

const DEFAULTS: Partial<Record<LiveGraphKey, string[]>> = {
  paceRate: ['pace', 'rate'],
  paceHistory: ['plan', 'markers', 'boat'],
  hrHistory: ['zones'],
};

/** Options on for graph `g` of a page; `forceDefault` is the global force-curve overlay setting. */
export function graphOptions(page: Pick<LivePageConfig, 'graphOptions'>, g: LiveGraphKey, forceDefault: string[]): string[] {
  return page.graphOptions?.[g] ?? (g === 'forceCurve' ? forceDefault : (DEFAULTS[g] ?? []));
}

export function toggleOption(page: LivePageConfig, g: LiveGraphKey, key: string, forceDefault: string[]): LivePageConfig['graphOptions'] {
  const cur = graphOptions(page, g, forceDefault);
  return { ...page.graphOptions, [g]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
}

/** Stored pages from older versions: explicit 'auto' position and the global force overlays copied into each force graph. */
export function migrateGraphs<P extends LivePageConfig>(pages: P[], forceOverlays: string[]): P[] {
  return pages.map((p) => {
    const graphPosition = GRAPH_POSITIONS.some((x) => x.key === p.graphPosition) ? p.graphPosition : 'auto';
    const graphOptions = p.graphs.includes('forceCurve') && !p.graphOptions?.forceCurve ? { ...p.graphOptions, forceCurve: [...forceOverlays] } : p.graphOptions;
    return { ...p, graphPosition, graphOptions };
  });
}
