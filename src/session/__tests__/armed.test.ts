import { describe, expect, it, vi } from 'vitest';
import type { ConnectionState, ErgEvents, LiveMetrics, StrokeSample } from '@/core/types';

vi.mock('expo-haptics', () => ({}));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} }));
vi.mock('@/coach', () => ({ Coxswain: class {}, computePaceBoat: () => null, coxFor: (_p: unknown, c: unknown) => c, createVoice: () => ({}) }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: () => new Promise(() => {}) }));

// Fake PM5 the test drives packet by packet.
const { Emitter } = await import('@/ble/emitter');
const events = new Emitter<ErgEvents>();
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
    programWorkout: async () => {},
    terminateWorkout: async () => {},
    destroy: () => {},
  }),
}));

const { useSession } = await import('@/session');
const { useSettings } = await import('@/storage/settings');
const { emptyMetrics } = await import('@/core/defaults');

const status = (p: Partial<LiveMetrics>) => events.emit('metrics', { ...emptyMetrics(), workoutState: 'waiting-to-begin', rowingState: 'inactive', ...p });
const staleStroke = { strokeNumber: 230, elapsedMs: 480_000, distanceM: 2000, intervalCount: 0, forceCurve: [] } as unknown as StrokeSample;

describe('armed workout', () => {
  it('stays armed indefinitely before the first stroke, through stale packets and a dropout', async () => {
    useSettings.getState().update({ useSimulator: false, autoReconnect: false });
    await useSession.getState().connect('pm');
    await useSession.getState().startWorkout({ id: '2k', name: '2k', kind: 'single-distance', value: 2000 });
    vi.useFakeTimers();
    status({});
    events.emit('stroke', staleStroke); // last stroke of the previous piece, resent by the PM
    for (let i = 0; i < 100; i++) {
      status({});
      vi.advanceTimersByTime(100);
    }
    events.emit('connection', { status: 'reconnecting', device: info });
    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();
    expect(useSession.getState().phase).toBe('ready');
    expect(useSession.getState().strokes).toHaveLength(0);
    useSession.getState().discardWorkout();
  });

  it('arms with a matching plan when a workout is set on the monitor', () => {
    status({ workoutType: 'just-row-splits' });
    expect(useSession.getState().phase).toBe('idle');
    status({ workoutType: 'fixed-distance-splits', workoutDistanceM: 5000 });
    expect(useSession.getState()).toMatchObject({ phase: 'ready', plan: { kind: 'single-distance', value: 5000 } });
  });
});
