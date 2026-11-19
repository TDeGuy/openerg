/**
 * Lazy access to react-native-ble-plx + react-native, so web / vitest can import @/ble.
 * One BleManager is shared by the PM5 and heart-rate sources (ble-plx expects a single instance).
 */
import type { BleManager as BleManagerT, State as StateT } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

declare const require: (id: string) => unknown;

type BlePlx = typeof import('react-native-ble-plx');
type RN = typeof import('react-native');

let plx: BlePlx | null | undefined;
let rn: RN | null | undefined;
let manager: BleManagerT | null = null;

function loadRn(): RN | null {
  if (rn === undefined) {
    try {
      rn = require('react-native') as RN;
    } catch {
      rn = null;
    }
  }
  return rn;
}

/** Null where native BLE isn't available (web, tests, Expo Go without the module). */
export function getBleManager(): BleManagerT | null {
  if (manager) return manager;
  if (plx === undefined) {
    try {
      const os = loadRn()?.Platform?.OS;
      plx = os === 'ios' || os === 'android' ? (require('react-native-ble-plx') as BlePlx) : null;
    } catch {
      plx = null;
    }
  }
  if (!plx) return null;
  try {
    manager = new plx.BleManager();
  } catch {
    // Native module missing (e.g. Expo Go).
    plx = null;
    return null;
  }
  return manager;
}

/** Android runtime permissions: 12+ needs BLUETOOTH_SCAN/CONNECT, older needs fine location. */
export async function requestBlePermissions(): Promise<{ ok: boolean; reason?: string }> {
  const r = loadRn();
  if (!r || r.Platform.OS !== 'android') return { ok: true };
  const { PermissionsAndroid } = r;
  const P = PermissionsAndroid.PERMISSIONS;
  const api = typeof r.Platform.Version === 'number' ? r.Platform.Version : parseInt(String(r.Platform.Version), 10);
  const wanted = api >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(wanted);
  const denied = wanted.filter((p) => res[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length) {
    return {
      ok: false,
      reason: api >= 31 ? 'Nearby devices permission is required to find your erg.' : 'Location permission is required for Bluetooth scanning.',
    };
  }
  return { ok: true };
}

/** Waits (≤ 4 s) for the adapter to leave Unknown/Resetting, then reports whether it is powered on. */
export async function checkAdapter(m: BleManagerT): Promise<{ ok: boolean; reason?: string }> {
  let state: StateT | string = await m.state();
  if (state === 'Unknown' || state === 'Resetting') {
    state = await new Promise<string>((resolve) => {
      const t = setTimeout(() => {
        sub.remove();
        resolve(state);
      }, 4000);
      const sub = m.onStateChange((s) => {
        if (s !== 'Unknown' && s !== 'Resetting') {
          clearTimeout(t);
          sub.remove();
          resolve(s);
        }
      }, true);
    });
  }
  switch (state) {
    case 'PoweredOn':
      return { ok: true };
    case 'PoweredOff':
      return { ok: false, reason: 'Bluetooth is turned off.' };
    case 'Unauthorized':
      return { ok: false, reason: 'Bluetooth permission was denied.' };
    case 'Unsupported':
      return { ok: false, reason: 'This device does not support Bluetooth LE.' };
    default:
      return { ok: false, reason: `Bluetooth is not ready (${state}).` };
  }
}

export async function prepareBle(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const m = getBleManager();
    if (!m) return { ok: false, reason: 'Bluetooth is not available on this platform. Use the simulator instead.' };
    const perm = await requestBlePermissions();
    if (!perm.ok) return perm;
    return await checkAdapter(m);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Bluetooth unavailable' };
  }
}

export const fromBase64 = (s: string | null | undefined): Uint8Array => (s ? new Uint8Array(Buffer.from(s, 'base64')) : new Uint8Array());
export const toBase64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
export const base64ToText = (s: string | null | undefined): string =>
  s ? Buffer.from(s, 'base64').toString('utf8').replace(/\0+$/, '').trim() : '';
