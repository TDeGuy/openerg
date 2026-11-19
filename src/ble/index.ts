// react-native-ble-plx is only required lazily inside ./native on first BLE use, so this
// module is safe to import on web and in vitest.
import type { ErgDataSource, ErgSourceKind, HeartRateSource } from '@/core/types';
import { createSimulator } from './simulator';
import { Pm5BleSource } from './Pm5BleSource';
import { HeartRateBle } from './HeartRateBle';

export { createSimulator, SIM_ERG, type SimulatorOptions, type SimulatorSource } from './simulator';
export { parseHeartRateMeasurement } from './heartRateParser';

/** 'ble' → real PM5 over Bluetooth; 'simulator' → built-in simulator. */
export function createErgSource(kind: ErgSourceKind): ErgDataSource {
  return kind === 'simulator' ? createSimulator() : new Pm5BleSource();
}

export function createHeartRateSource(): HeartRateSource {
  return new HeartRateBle();
}
