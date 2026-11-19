import { describe, expect, it } from 'vitest';

import { graphOptions, migrateGraphs, toggleOption } from '@/components/live/graphs';
import type { LivePageConfig } from '@/core/types';
import { mergeSettings } from '../merge';

const page = (p: Partial<LivePageConfig> = {}): LivePageConfig => ({ id: 'a', name: 'A', tiles: ['pace'], graphs: ['forceCurve', 'paceHistory'], ...p });

describe('per-graph options', () => {
  it('defaults: global force overlays for the force curve, sensible lines for the rest', () => {
    expect(graphOptions(page(), 'forceCurve', ['ideal'])).toEqual(['ideal']);
    expect(graphOptions(page(), 'paceHistory', [])).toContain('plan');
  });
  it('toggles one graph without touching the others', () => {
    const p = page({ graphOptions: { forceCurve: ['ideal'] } });
    const next = toggleOption(p, 'paceHistory', 'boat', ['ideal'])!;
    expect(next.forceCurve).toEqual(['ideal']);
    expect(next.paceHistory).not.toContain('boat');
    expect(toggleOption(p, 'forceCurve', 'previous', [])!.forceCurve).toEqual(['ideal', 'previous']);
  });
});

describe('migration', () => {
  it('keeps today\'s arrangement and copies the global force overlays into force graphs', () => {
    const [a, b] = migrateGraphs([page(), page({ graphs: ['splits'], graphPosition: 'left' })], ['ideal', 'previous']);
    expect(a!.graphPosition).toBe('auto');
    expect(a!.graphOptions!.forceCurve).toEqual(['ideal', 'previous']);
    expect(b!.graphPosition).toBe('left');
    expect(b!.graphOptions).toBeUndefined();
  });
  it('repairs bad positions and is idempotent via mergeSettings', () => {
    const stored = { forceCurveOverlays: ['average'], livePages: [{ ...page(), graphPosition: 'sideways' }] };
    const once = mergeSettings(stored);
    expect(once.livePages[0]!.graphPosition).toBe('auto');
    expect(once.livePages[0]!.graphOptions!.forceCurve).toEqual(['average']);
    expect(mergeSettings(once).livePages).toEqual(once.livePages);
  });
});
