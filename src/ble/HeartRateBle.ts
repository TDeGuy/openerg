/** Standard BLE heart-rate strap (service 0x180D, measurement 0x2A37). Degrades to a no-op where BLE is unavailable. */
import type { Subscription } from 'react-native-ble-plx';
import type { HeartRateDevice, HeartRateSource, Unsubscribe } from '@/core/types';
import { Emitter } from './emitter';
import { fromBase64, getBleManager, prepareBle } from './native';
import { useStrapStatus } from './hrStatus';
import { parseBatteryLevel, parseHeartRateMeasurement } from './heartRateParser';
import { BATTERY_LEVEL, BATTERY_SERVICE, HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE } from './pm5/uuids';

export class HeartRateBle implements HeartRateSource {
  private events = new Emitter<{ hr: number }>();
  private deviceId: string | null = null;
  private subs: Subscription[] = [];
  private connected = false;

  async scan(onFound: (d: HeartRateDevice) => void): Promise<Unsubscribe> {
    const ready = await prepareBle();
    const m = getBleManager();
    if (!ready.ok || !m) return () => {};
    const seen = new Set<string>();
    let active = true;
    try {
      await m.startDeviceScan([HEART_RATE_SERVICE], { allowDuplicates: false }, (error, device) => {
        if (error || !device || seen.has(device.id)) return;
        seen.add(device.id);
        onFound({ id: device.id, name: device.name ?? device.localName ?? 'Heart-rate monitor', rssi: device.rssi ?? null });
      });
    } catch {
      return () => {};
    }
    return () => {
      if (!active) return;
      active = false;
      m.stopDeviceScan().catch(() => {});
    };
  }

  async connect(id: string): Promise<void> {
    const m = getBleManager();
    if (!m) throw new Error('Bluetooth is not available on this platform');
    await this.disconnect();
    const ready = await prepareBle();
    if (!ready.ok) throw new Error(ready.reason ?? 'Bluetooth unavailable');
    await m.stopDeviceScan().catch(() => {});
    const device = await m.connectToDevice(id, { timeout: 15000 });
    await m.discoverAllServicesAndCharacteristicsForDevice(device.id);
    this.deviceId = device.id;
    this.connected = true;
    // Battery Service is optional; read once, ignore failure.
    m.readCharacteristicForDevice(device.id, BATTERY_SERVICE, BATTERY_LEVEL)
      .then((c) => c.value && useStrapStatus.setState({ battery: parseBatteryLevel(fromBase64(c.value)) }))
      .catch(() => {});
    this.subs.push(
      m.onDeviceDisconnected(device.id, () => {
        this.connected = false;
        useStrapStatus.setState({ bpm: null, battery: null });
      }),
      m.monitorCharacteristicForDevice(device.id, HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, (err, c) => {
        if (err || !c?.value) return;
        const hr = parseHeartRateMeasurement(fromBase64(c.value));
        if (hr && hr.bpm > 0) {
          useStrapStatus.setState({ bpm: hr.bpm });
          this.events.emit('hr', hr.bpm);
        }
      }),
    );
  }

  async disconnect(): Promise<void> {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    const id = this.deviceId;
    this.deviceId = null;
    this.connected = false;
    useStrapStatus.setState({ bpm: null, battery: null });
    if (id) await getBleManager()?.cancelDeviceConnection(id).catch(() => {});
  }

  isConnected(): boolean {
    return this.connected;
  }

  onHeartRate(cb: (bpm: number) => void): Unsubscribe {
    return this.events.on('hr', cb);
  }
}
