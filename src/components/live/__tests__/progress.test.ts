import type { GraphPosition } from '@/core/types';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, emptyMetrics } from '@/core/defaults';
import type { SplitSummary, WorkoutPlan } from '@/core/types';

import { METRICS } from '../metrics';
import {
  computeProgress,
  currentTarget,
  formatField,
  formatIntervalValue,
  layoutPage,
  nextAxisMax,
  repLabel,
  nextRep,
  paceTone,
  parseField,
  rateTone,
  smoothPath,
} from '../progress';

const m = (p: Partial<ReturnType<typeof emptyMetrics>>) => ({ ...emptyMetrics(), ...p });
const split = (p: Partial<SplitSummary>): SplitSummary => ({
  index: 0, type: 'distance', elapsedMs: 0, distanceM: 0, splitTimeMs: 0, splitDistanceM: 0, restTimeMs: 0, restDistanceM: 0,
  avgPaceMsPer500: 0, avgWatts: 0, avgStrokeRate: 0, avgHeartRate: null, restHeartRate: null, avgDragFactor: 0, calories: 0, strokeCount: 0, ...p,
});

const twoK: WorkoutPlan = { id: 'a', name: '2k', kind: 'single-distance', value: 2000 };
const intervals: WorkoutPlan = {
  id: 'b',
  name: '4x500',
  kind: 'intervals',
  intervals: Array.from({ length: 4 }, () => ({ type: 'distance' as const, value: 500, restMs: 60000, target: { paceMsPer500: 100000, strokeRate: 30 } })),
};

describe('computeProgress', () => {
  it('single distance', () => {
    const p = computeProgress(twoK, m({ distanceM: 500 }), [])!;
    expect(p.remaining).toBe(1500);
    expect(p.fraction).toBeCloseTo(0.25);
    expect(p.rep).toBeNull();
  });
  it('just row has no progress', () => {
    expect(computeProgress({ id: 'c', name: '', kind: 'just-row' }, m({}), [])).toBeNull();
    expect(computeProgress(null, m({}), [])).toBeNull();
  });
  it('intervals with per-interval distance', () => {
    const p = computeProgress(intervals, m({ intervalCount: 1, distanceM: 200 }), [split({ index: 0, splitDistanceM: 500 })])!;
    expect(p.rep).toBe(1);
    expect(p.done).toBe(200);
    expect(p.overallFraction).toBeCloseTo((1 + 0.4) / 4);
  });
  it('intervals with cumulative distance', () => {
    const p = computeProgress(intervals, m({ intervalCount: 1, distanceM: 700 }), [split({ index: 0, splitDistanceM: 500 })])!;
    expect(p.done).toBe(200);
  });
});

describe('targets', () => {
  it('uses interval target and next rep', () => {
    const tg = currentTarget(intervals, m({ intervalCount: 2 }), null);
    expect(tg.paceMsPer500).toBe(100000);
    expect(tg.strokeRate).toBe(30);
    expect(nextRep(intervals, m({ intervalCount: 2 }))?.index).toBe(3);
    expect(nextRep(intervals, m({ intervalCount: 3 }))).toBeNull();
  });
  it('uses pace plan segment', () => {
    const plan: WorkoutPlan = {
      ...twoK,
      pacePlan: {
        strategy: 'custom',
        goalPaceMsPer500: 105000,
        segments: [
          { startFraction: 0, endFraction: 0.5, targetPaceMsPer500: 104000, label: 'A' },
          { startFraction: 0.5, endFraction: 1, targetPaceMsPer500: 106000, label: 'B' },
        ],
      },
    };
    const mm = m({ distanceM: 1500 });
    const tg = currentTarget(plan, mm, computeProgress(plan, mm, []));
    expect(tg.paceMsPer500).toBe(106000);
    expect(tg.label).toBe('B');
  });
  it('tones', () => {
    expect(paceTone(105000, 105000)).toBe('good');
    expect(paceTone(106500, 105000)).toBe('warn');
    expect(paceTone(110000, 105000)).toBe('bad');
    expect(paceTone(105000, null)).toBe('default');
    expect(rateTone(24, 24)).toBe('good');
    expect(rateTone(30, 24)).toBe('bad');
  });
});

describe('fields', () => {
  it('parses', () => {
    expect(parseField('distance', '2000')).toBe(2000);
    expect(parseField('distance', '2,000m')).toBe(2000);
    expect(parseField('distance', '5k')).toBe(5000);
    expect(parseField('time', '30:00')).toBe(1800000);
    expect(parseField('pace', '1:45.0')).toBe(105000);
    expect(parseField('rate', '')).toBeNull();
    expect(Number.isNaN(parseField('distance', 'abc'))).toBe(true);
    expect(Number.isNaN(parseField('time', '1:xx'))).toBe(true);
  });
  it('formats', () => {
    expect(formatField('time', 1800000)).toBe('30:00');
    expect(formatField('pace', 105000)).toBe('1:45.0');
    expect(formatField('distance', 2000)).toBe('2000');
    expect(formatIntervalValue({ type: 'time', value: 120000 })).toBe('2:00');
    expect(formatIntervalValue({ type: 'distance', value: 500 })).toBe('500m');
  });
});

describe('count-down rule', () => {
  const tile = (plan: WorkoutPlan | null, mm: ReturnType<typeof m>) => {
    const progress = computeProgress(plan, mm, []);
    const ctx = { m: mm, profile: DEFAULT_SETTINGS.profile, forceUnit: 'N' as const, plan, paceBoat: null, analysis: null, progress, target: currentTarget(plan, mm, progress) };
    return { remaining: METRICS.remaining.compute(ctx), distance: METRICS.distance.compute(ctx) };
  };
  it('distance piece counts distance down on both tiles', () => {
    const r = tile(twoK, m({ distanceM: 500, elapsedMs: 100000 }));
    expect(r.remaining).toMatchObject({ label: 'Distance left', value: '1,500' });
    expect(r.distance).toMatchObject({ label: 'Distance left', value: '1,500' });
  });
  it('time piece counts time down and distance up', () => {
    const r = tile({ id: 't', name: '', kind: 'single-time', value: 1800000 }, m({ distanceM: 500, elapsedMs: 600000 }));
    expect(r.remaining).toMatchObject({ label: 'Time left', value: '20:00' });
    expect(r.distance.label).toBeUndefined();
    expect(r.distance.value).toBe('500');
  });
  it('just row shows elapsed time and distance up', () => {
    const r = tile(null, m({ distanceM: 500, elapsedMs: 125000 }));
    expect(r.remaining).toMatchObject({ label: 'Time', value: '2:05' });
    expect(r.distance.value).toBe('500');
  });
  it('repeat-forever intervals keep counting reps with no total', () => {
    const forever: WorkoutPlan = { ...intervals, repeatForever: true, intervals: [intervals.intervals![0]] };
    const p = computeProgress(forever, m({ intervalCount: 5, distanceM: 100 }), [])!;
    expect(p.rep).toBe(5);
    expect(p.reps).toBeNull();
    expect(p.remaining).toBe(400);
    expect(nextRep(forever, m({ intervalCount: 5 }))?.total).toBeNull();
    expect(repLabel(5, null)).toBe('Rep 6');
    expect(repLabel(1, 4)).toBe('Rep 2 of 4');
  });
});

describe('layoutPage', () => {
  const inside = (b: { x: number; y: number; w: number; h: number }, w: number, h: number) =>
    b.x >= 0 && b.y >= 0 && b.x + b.w <= w + 0.01 && b.y + b.h <= h + 0.01 && b.w > 0 && b.h > 0;
  it('fits every tile and graph in the page, landscape and portrait', () => {
    for (const [w, h] of [[800, 330], [390, 700]]) {
      for (const [n, g] of [[6, 1], [12, 2], [1, 0], [0, 2], [4, 0]]) {
        const L = layoutPage(w, h, n, g, 8);
        expect(L.tiles).toHaveLength(n);
        expect(L.graphs).toHaveLength(g);
        for (const b of [...L.tiles, ...L.graphs]) expect(inside(b, w, h)).toBe(true);
      }
    }
  });
  it('graphs go beside tiles in landscape', () => {
    const L = layoutPage(800, 330, 4, 1, 8);
    expect(L.graphs[0].x).toBeGreaterThan(L.tiles[0].x + L.tiles[0].w);
  });
});

describe('chart helpers', () => {
  it('axis grows immediately and shrinks slowly', () => {
    let s = nextAxisMax({ max: 0, low: 0 }, 800, 100);
    expect(s.max).toBe(900);
    s = nextAxisMax(s, 1000, 100);
    expect(s.max).toBe(1100);
    for (let i = 0; i < 7; i++) s = nextAxisMax(s, 300, 100);
    expect(s.max).toBe(1100);
    s = nextAxisMax(s, 300, 100);
    expect(s.max).toBe(400);
  });
  it('smooth path', () => {
    expect(smoothPath([{ x: 0, y: 0 }], 10)).toBe('');
    const d = smoothPath([{ x: 0, y: 10 }, { x: 5, y: 0 }, { x: 10, y: 10 }], 10);
    expect(d.startsWith('M0,10')).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(2);
  });
});

describe('layoutPage graph position', () => {
  const area = (bs: { w: number; h: number }[]) => bs.reduce((a, b) => a + b.w * b.h, 0);
  it('places graphs left, top, bottom and right of the tiles', () => {
    const L = (p: GraphPosition) => layoutPage(800, 330, 4, 1, 8, p);
    expect(L('left').graphs[0].x).toBe(0);
    expect(L('left').tiles[0].x).toBeGreaterThan(L('left').graphs[0].w);
    expect(L('top').graphs[0].y).toBe(0);
    expect(L('top').tiles[0].y).toBeGreaterThan(L('top').graphs[0].h);
    expect(L('bottom').graphs[0].y).toBeGreaterThan(L('bottom').tiles[0].y);
    expect(L('right').graphs[0].x).toBeGreaterThan(L('right').tiles[0].x);
    expect(L('auto')).toEqual(L('right'));
    expect(layoutPage(390, 700, 4, 1, 8, 'auto')).toEqual(layoutPage(390, 700, 4, 1, 8, 'bottom'));
  });
  it('graphs-only / tiles-only drop the other kind, and never leave a page empty', () => {
    const g = layoutPage(800, 330, 4, 2, 8, 'graphsOnly');
    expect(g.tiles).toHaveLength(0);
    expect(g.graphs).toHaveLength(2);
    expect(area(g.graphs)).toBeGreaterThan(800 * 330 * 0.9);
    const t = layoutPage(800, 330, 4, 2, 8, 'tilesOnly');
    expect(t.graphs).toHaveLength(0);
    expect(t.tiles).toHaveLength(4);
    expect(layoutPage(800, 330, 4, 0, 8, 'graphsOnly').tiles).toHaveLength(4);
    expect(layoutPage(800, 330, 0, 1, 8, 'tilesOnly').graphs).toHaveLength(1);
  });
});
