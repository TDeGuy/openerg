import { describe, expect, it } from 'vitest';

import type { LiveProgress } from '../progress';
import { FINISH_X, gapText, layoutBoats, remainingMeters, YOU_X } from '../paceBoatLayout';
import { activateLayout, deleteLayout, editPages, renameLayout, saveLayout } from '../layouts';

const pace = 120000; // 2:00/500m
const prog = (unit: LiveProgress['unit'], remaining: number): LiveProgress => ({ unit, done: 0, total: 0, remaining, fraction: 0, rep: null, reps: null, overallFraction: 0 });

describe('pace boat layout', () => {
  it('keeps you fixed with no finish line far from the end', () => {
    const l = layoutBoats(10, 800, pace);
    expect(l.finishX).toBeNull();
    expect(l.youX).toBe(YOU_X);
    expect(l.paceX).toBeLessThan(l.youX);
  });
  it('shows the finish line and advances toward it in the last 100 m', () => {
    expect(layoutBoats(0, 100, pace).finishX).toBe(FINISH_X);
    expect(layoutBoats(0, 100, pace).youX).toBeCloseTo(YOU_X);
    expect(layoutBoats(0, 0, pace).youX).toBeCloseTo(FINISH_X);
    expect(layoutBoats(0, 50, pace).youX).toBeGreaterThan(YOU_X);
  });
  it('has no finish for just row and converts time at pace-boat speed', () => {
    expect(remainingMeters(null, pace)).toBeNull();
    expect(remainingMeters(prog('calorie', 9), pace)).toBeNull();
    expect(remainingMeters(prog('time', 60000), pace)).toBeCloseTo(250);
    expect(layoutBoats(0, remainingMeters(prog('time', 20000), pace)!, pace).finishX).not.toBeNull();
  });
  it('keeps big gaps on screen', () => {
    const l = layoutBoats(-500, null, pace);
    expect(l.paceX).toBeLessThanOrEqual(0.97);
    expect(layoutBoats(500, null, pace).paceX).toBeGreaterThanOrEqual(0.03);
  });
  it('words the gap', () => {
    expect(gapText({ gapM: 12.3, gapMs: 3100, targetPaceMsPer500: pace, label: 'Ghost' })).toEqual({ main: '12 m · 3.1 s', sub: 'ahead of Ghost', tone: 'good' });
    expect(gapText({ gapM: -4.2, gapMs: -1000, targetPaceMsPer500: pace, label: '' }).sub).toBe('behind pace boat');
    expect(gapText({ gapM: 0.2, gapMs: 0, targetPaceMsPer500: pace, label: 'X' }).main).toBe('Level');
  });
});

describe('saved layouts', () => {
  const p = (id: string) => ({ id, name: id, tiles: ['pace' as const], graphs: [] });
  const base = { livePages: [p('a')], savedLayouts: [], activeLayoutId: null };
  it('saves, edits through, switches, renames, deletes', () => {
    const s1 = saveLayout(base, ' Race ', 'L1');
    expect(s1.savedLayouts[0].name).toBe('Race');
    expect(s1.activeLayoutId).toBe('L1');
    const s2 = { ...s1, ...editPages(s1, [p('b')]) };
    expect(s2.savedLayouts[0].pages[0].id).toBe('b');
    const s3 = { ...s2, ...saveLayout(s2, '', 'L2') };
    const s4 = { ...s3, ...activateLayout(s3, 'L1') };
    expect(s4.livePages[0].id).toBe('b');
    expect(s4.activeLayoutId).toBe('L1');
    expect(renameLayout(s4, 'L1', 'X').savedLayouts[0].name).toBe('X');
    const s5 = deleteLayout(s4, 'L1');
    expect(s5.savedLayouts.map((l) => l.id)).toEqual(['L2']);
    expect(s5.activeLayoutId).toBeNull();
    expect(s5.livePages[0].id).toBe('b');
  });
});
