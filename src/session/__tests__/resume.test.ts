import { describe, expect, it, vi } from 'vitest';
import type { ConnectionState, ErgEvents, LiveMetrics, StrokeSample } from '@/core/types';

vi.mock('expo-haptics', () => ({}));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} }));
const cox: { muted: boolean[]; fire: (c: unknown) => void } = { muted: [], fire: () => {} };
class FakeCox {
  setMuted = (m: boolean) => void cox.muted.push(m);
  subscribe = (fn: (c: unknown) => void) => ((cox.fire = fn), () => {});
  onMetrics = () => {};
  onStroke = () => {};
  onSplit = () => {};
  onWorkoutEnd = () => {};
  updateSettings = () => {};
}
vi.mock('@/coach', () => ({ Coxswain: FakeCox, computePaceBoat: () => null, coxFor: (_p: unknown, c: unknown) => c, createVoice: () => ({ stop: () => {}, speak: () => {}, prewarm: () => {} }) }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: () => new Promise(() => {}) }));
const saved: any[] = [];
vi.mock('@/storage/db', () => ({ saveWorkout: async (r: any) => void saved.push(r), getWorkout: async () => null }));
vi.mock('@/integrations/upload', () => ({ autoUpload: async () => {} }));

const { Emitter } = await import('@/ble/emitter');
const events = new Emitter<ErgEvents>();
const calls = { program: 0, terminate: 0, read: 0 };
let conn: ConnectionState = { status: 'idle', device: null };
const info = { id: 'pm', name: 'PM5', manufacturer: 'Concept2', machineType: 'rower' as const };
vi.mock('@/ble', () => ({
  createHeartRateSource: () => ({}),
  createErgSource: () => ({
    kind: 'ble',
    prepare: async () => ({ ok: true }),
    scan: async () => () => {},
    connect: async () => {
      conn = { status: 'connected', device: info };
      events.emit('connection', conn);
      return info;
    },
    disconnect: async () => {},
    getConnectionState: () => conn,
    on: events.on.bind(events),
    programWorkout: async () => void calls.program++,
    terminateWorkout: async () => {
      calls.terminate++;
      events.emit('workoutEnd', { workoutType: 'fixed-distance-splits' } as never);
    },
    readTargetPace: async () => (calls.read++, 108_000),
    destroy: () => {},
  }),
}));

const { useSession } = await import('@/session');
const { useSettings } = await import('@/storage/settings');
const { emptyMetrics } = await import('@/core/defaults');
const { saveSnapshot, loadSnapshot, clearSnapshot } = await import('@/session/snapshot');

const status = (p: Partial<LiveMetrics>) => events.emit('metrics', { ...emptyMetrics(), ...p });
const mid = (elapsedMs: number, distanceM: number): Partial<LiveMetrics> => ({
  workoutState: 'workout-row', rowingState: 'active', workoutType: 'fixed-distance-splits',
  workoutDistanceM: 5000, elapsedMs, distanceM,
});
const stroke = (n: number, elapsedMs: number) =>
  ({ strokeNumber: n, elapsedMs, distanceM: elapsedMs / 100, intervalCount: 0, forceCurve: [], strokeRate: 24, watts: 200 }) as unknown as StrokeSample;
const tick = () => new Promise((r) => setTimeout(r, 300));
const snapshot = (savedAgo: number) => ({
  recId: 'w_before', savedAt: Date.now() - savedAgo, startedAt: Date.now() - 130_000, plan: { id: 'p', name: '5k', kind: 'single-distance' as const, value: 5000 },
  ghostId: null, workoutType: 'fixed-distance-splits' as const, intervalCount: 0, elapsedMs: 100_000, distanceM: 1000, durationMs: 0, pieceDistanceM: 5000,
  strokes: [stroke(1, 98_000), stroke(2, 100_000)], splits: [], heartRate: [], coxCalls: [{ id: 'c0', text: 'Settle' }] as never[],
});

describe('reopening the app while the PM5 is mid-workout', () => {
  it('connects, adopts the PM piece with its own time/distance, and sends nothing', async () => {
    useSettings.getState().update({ useSimulator: false, autoReconnect: false });
    await useSession.getState().connect('pm');
    status({ workoutState: 'waiting-to-begin' }); // first status only records the PM program
    status(mid(600_000, 2000));
    await tick();
    expect(useSession.getState()).toMatchObject({ phase: 'rowing', plan: { kind: 'single-distance', value: 5000, target: { paceMsPer500: 108_000 } } });
    expect(useSession.getState().metrics).toMatchObject({ elapsedMs: 600_000, distanceM: 2000 });
    events.emit('connection', { status: 'reconnecting', device: info });
    events.emit('connection', conn);
    expect(calls).toMatchObject({ program: 0, terminate: 0 });
    useSession.getState().discardWorkout(); // explicit user action
    expect(calls.terminate).toBe(1);
  });

  it('resumes the recording from a matching snapshot and marks the gap', async () => {
    calls.terminate = 0;
    status({ workoutState: 'waiting-to-begin' });
    await saveSnapshot(snapshot(30_000));
    useSession.getState().setCoxMuted(true); // muted before/while the piece is adopted
    status(mid(130_000, 1300));
    await tick();
    expect(useSession.getState().coxCalls).toHaveLength(1);
    expect(cox.muted.at(-1)).toBe(true); // resume must not unmute the coxswain
    expect(useSession.getState().strokes.map((s) => s.strokeNumber)).toEqual([1, 2]);
    events.emit('stroke', stroke(30, 131_000));
    await tick();
    expect(useSession.getState().strokes).toHaveLength(3);
    expect(calls).toMatchObject({ program: 0, terminate: 0 });
    const id = await useSession.getState().finishWorkout();
    expect(id).toBe('w_before');
    const rec = saved.find((r) => r.id === 'w_before');
    expect(rec.strokes).toHaveLength(3);
    expect(rec.tags).toEqual(['data-gap']);
    expect(rec.coxCalls).toEqual([{ id: 'c0', text: 'Settle' }]);
    expect(rec.plan).toMatchObject({ kind: 'single-distance', value: 5000 });
    expect(await loadSnapshot()).toBeNull();
  });

  it('drops a stale snapshot (too old, or PM elapsed does not continue)', async () => {
    for (const [ago, elapsed] of [[7 * 3600_000, 130_000], [30_000, 50_000]] as const) {
      status({ workoutState: 'waiting-to-begin' });
      await saveSnapshot(snapshot(ago));
      status(mid(elapsed, 1300));
      await tick();
      expect(useSession.getState().strokes).toHaveLength(0);
      expect(await loadSnapshot()).toBeNull();
      useSession.getState().discardWorkout();
    }
  });
});

describe('ending before anything was rowed', () => {
  it('finish just ends the workout: no finished summary, nothing saved', async () => {
    const before = saved.length;
    await useSession.getState().startWorkout(null);
    expect(useSession.getState().phase).toBe('ready');
    expect(await useSession.getState().finishWorkout()).toBeNull();
    expect(useSession.getState().phase).toBe('idle');
    expect(saved).toHaveLength(before);
  });
});

describe('resume snapshot', () => {
  it('stores strokes in chunks and round-trips them, force curves included', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...stroke(i + 1, i * 2000), forceCurve: [1, 2, 3] }));
    await saveSnapshot({ ...snapshot(0), strokes: many.slice(0, 120) });
    await saveSnapshot({ ...snapshot(0), strokes: many });
    const back = await loadSnapshot();
    expect(back?.strokes).toEqual(many);
    expect(back?.strokes[249].forceCurve).toEqual([1, 2, 3]);
    await clearSnapshot();
    expect(await loadSnapshot()).toBeNull();
  });
});
