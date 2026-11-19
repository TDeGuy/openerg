import { describe, expect, it } from 'vitest';
import { best2k, computePersonalRecords, filterWorkouts, nextReference2k, pbEventsFor, statsPool, trends } from '@/analysis';
import { streaks, totals } from '@/components/analysis/helpers';
import { formatPace, paceFor, paceUnit } from '@/core/units';
import { listItem } from './fixtures';

const day = (d: number) => new Date(2026, 10, d, 9).getTime();
const row = (id: string, ms: number, extra = {}) => listItem({ id, elapsedMs: ms, distanceM: 2000, startedAt: day(Number(id.replace(/\D/g, '')) || 1), ...extra });

describe('filtering', () => {
  const items = [
    row('a1', 420000),
    row('b2', 400000, { simulated: true }),
    row('c3', 380000, { machineType: 'bikeerg' }),
    row('d4', 1800000, { title: '30:00 steady', workoutType: 'fixed-time-splits', distanceM: 7000 }),
    row('e5', 400000, { workoutType: 'fixed-distance-interval', title: '4 x 500m' }),
  ];
  const base = { machine: 'rower', showSim: true, kind: 'all' } as const;
  it('separates machines and can hide simulator rows', () => {
    expect(filterWorkouts(items, base).map((w) => w.id)).toEqual(['a1', 'b2', 'd4', 'e5']);
    expect(filterWorkouts(items, { ...base, showSim: false }).map((w) => w.id)).toEqual(['a1', 'd4', 'e5']);
    expect(filterWorkouts(items, { ...base, machine: 'bikeerg' }).map((w) => w.id)).toEqual(['c3']);
  });
  it('filters by kind, date range and search', () => {
    expect(filterWorkouts(items, { ...base, kind: 'time' }).map((w) => w.id)).toEqual(['d4']);
    expect(filterWorkouts(items, { ...base, kind: 'intervals' }).map((w) => w.id)).toEqual(['e5']);
    expect(filterWorkouts(items, { ...base, from: day(4) }).map((w) => w.id)).toEqual(['d4', 'e5']);
    expect(filterWorkouts(items, { ...base, search: 'STEADY' }).map((w) => w.id)).toEqual(['d4']);
  });
});

describe('simulator rows never count in stats', () => {
  const items = [row('a1', 420000), row('b2', 400000, { simulated: true })];
  it('totals, streaks, trends and pool skip them', () => {
    expect(totals(items).sessions).toBe(1);
    expect(streaks(items, day(2)).longest).toBe(1);
    expect(trends(items, 'week').reduce((a, p) => a + p.sessions, 0)).toBe(1);
    expect(statsPool(items, 'rower').map((w) => w.id)).toEqual(['a1']);
  });
});

describe('machine separation of PRs', () => {
  it('a bike 2k is never a row PR', () => {
    const items = [row('a1', 420000), row('c3', 380000, { machineType: 'bikeerg' })];
    expect(computePersonalRecords(items).find((r) => r.event === '2000m')?.workoutId).toBe('a1');
    expect(computePersonalRecords(items, 'bikeerg').find((r) => r.event === '2000m')?.workoutId).toBe('c3');
  });
});

describe('bike pace', () => {
  it('shows /1000m for the BikeErg only', () => {
    expect(paceUnit('bikeerg')).toBe('/1000m');
    expect(paceUnit('rower')).toBe('/500m');
    expect(paceFor(105000, 'bikeerg')).toBe(210000);
    expect(formatPace(105000)).toBe('1:45.0');
    expect(formatPace(105000, 'bikeerg')).toBe('3:30.0');
  });
});

describe('PB detection and reference 2k', () => {
  const items = [row('a1', 420000), row('a2', 410000), row('b3', 390000, { simulated: true }), row('c4', 380000, { machineType: 'bikeerg' })];
  it('marks only the current best real piece', () => {
    expect(pbEventsFor(items, 'a2')).toContain('2000m');
    expect(pbEventsFor(items, 'a1')).toEqual([]);
    expect(pbEventsFor(items, 'b3')).toEqual([]);
    expect(pbEventsFor(items, 'c4')).toContain('2000m');
  });
  it('auto-updates the reference 2k only for a faster non-sim RowErg 2k', () => {
    expect(best2k(items)).toBe(410000);
    expect(nextReference2k(items, 430000)).toBe(410000);
    expect(nextReference2k(items, 410000)).toBeNull();
    expect(nextReference2k(items, 400000)).toBeNull();
    expect(nextReference2k(items, null)).toBe(410000);
  });
});
