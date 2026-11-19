import { describe, expect, it, vi } from 'vitest';
import { PM5 } from '@/ble/pm5/uuids';

// Mocked react-native-ble-plx manager that records every write.
import { fromBase64 } from '@/ble/native';
const writes: { char: string; bytes: number[] }[] = [];
const listeners: { disconnected: (() => void) | null } = { disconnected: null };
const manager = {
  connectToDevice: async (id: string) => ({ id }),
  discoverAllServicesAndCharacteristicsForDevice: async (id: string) => ({ id, name: 'PM5 430000001' }),
  readCharacteristicForDevice: async () => ({ value: null }),
  writeCharacteristicWithResponseForDevice: async (_id: string, _svc: string, char: string, b64: string) => {
    writes.push({ char, bytes: [...fromBase64(b64)] });
  },
  onDeviceDisconnected: (_id: string, cb: () => void) => {
    listeners.disconnected = cb;
    return { remove: () => {} };
  },
  monitorCharacteristicForDevice: () => ({ remove: () => {} }),
  cancelDeviceConnection: async () => ({}),
  stopDeviceScan: async () => {},
};
vi.mock('@/ble/native', async (orig) => ({ ...(await orig<typeof import('@/ble/native')>()), getBleManager: () => manager }));

const { Pm5BleSource } = await import('@/ble/Pm5BleSource');
const csafeWrites = () => writes.filter((w) => w.char === PM5.CSAFE_RECEIVE);

describe('PM5 safety: connecting never sends CSAFE', () => {
  it('connect, link drop + auto-reconnect, disconnect and destroy write no CSAFE frame', async () => {
    vi.useFakeTimers();
    const src = new Pm5BleSource();
    await src.connect('pm');
    listeners.disconnected?.(); // app / link dropped while the PM is mid-workout
    await vi.advanceTimersByTimeAsync(5000); // reconnect attempt
    expect(src.getConnectionState().status).toBe('connected');
    await src.disconnect();
    src.destroy();
    vi.useRealTimers();
    expect(csafeWrites()).toEqual([]);
  });

  it('only programWorkout / terminateWorkout / the read-only target pace query write CSAFE', async () => {
    const src = new Pm5BleSource();
    await src.connect('pm');
    expect(await src.readTargetPace()).toBeNull(); // no response from the mock
    const read = csafeWrites().length;
    expect(read).toBe(1);
    await src.programWorkout({ id: 'x', name: 'x', kind: 'single-distance', value: 2000 });
    expect(csafeWrites().length).toBeGreaterThan(read);
    src.destroy();
  });
});

describe('target pace fallback', () => {
  it('retries once without target pace when programming fails; variable intervals do not retry', async () => {
    const src = new Pm5BleSource();
    await src.connect('pm');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orig = manager.writeCharacteristicWithResponseForDevice;
    let fail = true;
    manager.writeCharacteristicWithResponseForDevice = async (...a: Parameters<typeof orig>) => {
      if (a[2] === PM5.CSAFE_RECEIVE && fail) {
        fail = false;
        throw new Error('rejected');
      }
      return orig(...a);
    };
    writes.length = 0;
    await src.programWorkout({ id: 'x', name: 'x', kind: 'single-distance', value: 2000, target: { paceMsPer500: 100_000 } });
    const has = (w: { bytes: number[] }) => w.bytes.join().includes('6,4,0,0,39,16');
    expect(warn).toHaveBeenCalled();
    expect(csafeWrites().length).toBeGreaterThan(0);
    expect(csafeWrites().some(has)).toBe(false); // retry carried no target pace

    fail = true;
    const iv = { type: 'distance' as const, value: 500, restMs: 30_000 };
    await expect(src.programWorkout({ id: 'v', name: 'v', kind: 'intervals', intervals: [iv], target: { paceMsPer500: 100_000 } })).rejects.toThrow();
    manager.writeCharacteristicWithResponseForDevice = orig;
    src.destroy();
  });
});
