import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkoutPlan } from '@/core/types';

vi.mock('expo-haptics', () => ({}));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} }));
vi.mock('@/coach', () => ({ Coxswain: class {}, computePaceBoat: () => null, coxFor: (_p: unknown, c: unknown) => c, createVoice: () => ({}) }));
// Web build: the SQLite worker fails to load and openDatabaseAsync never settles.
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: () => new Promise(() => {}) }));
vi.mock('@/ble', async () => {
  const { createSimulator } = await import('@/ble/simulator');
  return { createErgSource: () => createSimulator({ speed: 300, countdownMs: 100, seed: 7 }), createHeartRateSource: () => ({}) };
});

const { useSession } = await import('@/session');
const { useSettings } = await import('@/storage/settings');
const { SIM_ERG } = await import('@/ble/simulator');
const { getWorkout } = await import('@/storage/db');
const { planTitle, planTotals, validatePlan } = await import('@/workouts');
const { buildWorkoutFrames, WORKOUT_TYPE } = await import('@/ble/pm5/csafe');

const ONE_K: WorkoutPlan = { id: '1k', name: '1000m', kind: 'single-distance', value: 1000 };
const until = async (fn: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('session controller + simulator', () => {
  beforeAll(async () => {
    useSettings.getState().update({ useSimulator: true, coxswain: { ...useSettings.getState().settings.coxswain, enabled: false } });
    await useSession.getState().init();
    await useSession.getState().connect(SIM_ERG.id);
  });

  it('never remembers the simulator as the last erg', () => {
    expect(useSettings.getState().settings.lastErgId).not.toBe(SIM_ERG.id);
  });

  it('autosaves a 1k that ends on the PM', async () => {
    await useSession.getState().startWorkout(ONE_K);
    await until(() => !!useSession.getState().lastSavedWorkoutId);
    const rec = (await getWorkout(useSession.getState().lastSavedWorkoutId!))!;
    expect(rec.distanceM).toBeCloseTo(1000, 0);
    expect(rec.title).toBe('1000m');
  }, 15_000);

  it('saves a 1k finished manually near the end', async () => {
    await useSession.getState().startWorkout({ ...ONE_K, value: 1200 });
    await until(() => (useSession.getState().metrics?.distanceM ?? 0) >= 1000);
    const id = await useSession.getState().finishWorkout();
    expect(id).toBeTruthy();
    expect((await getWorkout(id!))!.distanceM).toBeGreaterThan(990);
  }, 15_000);

  it('runs unlimited fixed intervals until stopped and titles the reps done', async () => {
    const plan: WorkoutPlan = { id: 'u', name: 'x', kind: 'intervals', repeatForever: true, intervals: [{ type: 'distance', value: 500, restMs: 20_000 }] };
    expect([planTitle(plan), planTotals(plan).distanceM, validatePlan(plan)]).toEqual(['∞ × 500m / 0:20r', null, []]);
    expect(buildWorkoutFrames(plan)[0]).toContain(WORKOUT_TYPE.FIXEDDIST_INTERVAL);
    await useSession.getState().startWorkout(plan);
    await until(() => useSession.getState().splits.length >= 3);
    await new Promise((r) => setTimeout(r, 150)); // part-way into the next rep
    const rec = (await getWorkout((await useSession.getState().finishWorkout())!))!;
    expect(rec.title).toBe(`${rec.splits.length - 1} × 500m / 0:20r`);
    expect(rec.splits.length - 1).toBeGreaterThanOrEqual(3);
  }, 15_000);
});
