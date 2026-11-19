/**
 * SAFETY GUARANTEE (tested in __tests__/noCommands.test.ts): the only CSAFE writes this class ever
 * makes are programWorkout() and terminateWorkout() (called solely from explicit user actions in
 * the session controller) and the read-only readTargetPace(). Connecting, reconnecting after a link
 * drop, disconnecting, destroy() and the app being closed or backgrounded send no CSAFE frame, so a
 * PM5 that is mid-workout is never reprogrammed, terminated or reset. (The only other write is the
 * non-destructive status sample-rate setting during connect.)
 *
 * Real PM5 over BLE (react-native-ble-plx, loaded lazily via ./native).
 *
 * Notifications: the multiplexed characteristic 0x0080 plus force curve 0x003D. Force-curve data
 * spans several notifications and is not reliably multiplexed, so it gets its own subscription; the
 * spec multiplexes an ID only while its own characteristic is not notifying, so nothing arrives
 * twice. Android limits simultaneous notifications (≈15), hence the mux for everything else. If no
 * multiplexed data arrives within a few seconds, we fall back to the individual characteristics.
 */
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';
import type { ConnectionState, DiscoveredErg, ErgDataSource, ErgEvents, ErgInfo, Unsubscribe, WorkoutPlan } from '@/core/types';
import { Emitter } from './emitter';
import { base64ToText, fromBase64, getBleManager, prepareBle, toBase64 } from './native';
import { Pm5Aggregator, type AggregatorEvent } from './pm5/aggregator';
import { goalPace, buildGetTargetPaceFrame, buildTerminateFrames, buildWorkoutFrames, chunk, FrameAccumulator, parseTargetPace, type ParsedFrame } from './pm5/csafe';
import { machineTypeFromPm, parseMultiplexed, parsePacket } from './pm5/parsers';
import { nextReconnectDelay, Pm5RejectedError } from './pm5/link';
import { isPm5Name, PM5, PM5_NOTIFY_CHARACTERISTICS, SAMPLE_RATE } from './pm5/uuids';

const METRICS_INTERVAL_MS = 100; // ≤ 10 Hz
const MUX_WATCHDOG_MS = 4000;
const RESPONSE_TIMEOUT_MS = 600;
const REQUESTED_MTU = 247;

export class Pm5BleSource implements ErgDataSource {
  readonly kind = 'ble' as const;
  private events = new Emitter<ErgEvents>();
  private state: ConnectionState = { status: 'idle', device: null };
  private agg = new Pm5Aggregator();
  private subs: Subscription[] = [];
  private disconnectSub: Subscription | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private muxWatchdog: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceId: string | null = null;
  private info: ErgInfo | null = null;
  private userDisconnect = false;
  private scanning = false;
  private gotData = false;
  private csafe = new FrameAccumulator();
  private responseWaiters: Array<() => void> = [];
  private lastFrames: ParsedFrame[] = [];
  /** Responses whose CSAFE status byte (bits 5-4) says the previous frame was rejected / bad. */
  private rejected = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private destroyed = false;

  private mgr(): BleManager {
    const m = getBleManager();
    if (!m) throw new Error('Bluetooth is not available on this platform');
    return m;
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    this.events.emit('connection', next);
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  on<K extends keyof ErgEvents>(event: K, cb: (payload: ErgEvents[K]) => void): Unsubscribe {
    return this.events.on(event, cb);
  }

  prepare(): Promise<{ ok: boolean; reason?: string }> {
    return prepareBle();
  }

  async scan(onFound: (erg: DiscoveredErg) => void): Promise<Unsubscribe> {
    const ready = await this.prepare();
    if (!ready.ok) {
      this.setState({ status: 'error', device: null, error: ready.reason });
      return () => {};
    }
    const m = this.mgr();
    const seen = new Map<string, number>();
    this.scanning = true;
    if (this.state.status !== 'connected') this.setState({ status: 'scanning', device: null });
    // No UUID filter: some PM5 firmware does not include the service UUID in the advertisement,
    // so we match on the service UUID *or* the "PM5" name prefix.
    await m.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        this.scanning = false;
        if (this.state.status === 'scanning') this.setState({ status: 'error', device: null, error: error.message });
        return;
      }
      if (!device || !isPm5Device(device)) return;
      const last = seen.get(device.id);
      const now = Date.now();
      if (last && now - last < 2000) return;
      seen.set(device.id, now);
      onFound({ id: device.id, name: device.name ?? device.localName ?? 'PM5', rssi: device.rssi ?? null });
    });
    return () => {
      if (!this.scanning) return;
      this.scanning = false;
      m.stopDeviceScan().catch(() => {});
      if (this.state.status === 'scanning') this.setState({ status: 'idle', device: null });
    };
  }

  async connect(id: string): Promise<ErgInfo> {
    const m = this.mgr();
    if (this.scanning) {
      this.scanning = false;
      await m.stopDeviceScan().catch(() => {});
    }
    if (this.deviceId && this.deviceId !== id) await this.disconnect();
    this.userDisconnect = false;
    this.clearReconnect();
    this.setState({ status: 'connecting', device: null });
    try {
      const info = await this.establish(id);
      this.setState({ status: 'connected', device: info });
      return info;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.teardownLink(true);
      this.deviceId = null;
      this.setState({ status: 'error', device: null, error: `Could not connect to the PM5: ${msg}` });
      throw new Error(msg);
    }
  }

  /** Connect, discover, read info, configure and subscribe. Used for first connect and reconnects. */
  private async establish(id: string): Promise<ErgInfo> {
    const m = this.mgr();
    await this.teardownLink(false);
    let device = await m.connectToDevice(id, { requestMTU: REQUESTED_MTU, timeout: 15000 });
    device = await m.discoverAllServicesAndCharacteristicsForDevice(device.id);
    this.deviceId = device.id;

    const read = async (uuid: string) => {
      try {
        return (await m.readCharacteristicForDevice(device.id, PM5.DEVICE_INFO_SERVICE, uuid)).value;
      } catch {
        return null;
      }
    };
    const [serial, hw, fw, maker, machine] = await Promise.all([
      read(PM5.SERIAL_NUMBER),
      read(PM5.HARDWARE_REVISION),
      read(PM5.FIRMWARE_REVISION),
      read(PM5.MANUFACTURER_NAME),
      read(PM5.ERG_MACHINE_TYPE),
    ]);
    const machineBytes = fromBase64(machine);
    const info: ErgInfo = {
      id: device.id,
      name: device.name ?? device.localName ?? `PM5 ${base64ToText(serial)}`.trim(),
      serialNumber: base64ToText(serial) || undefined,
      hardwareRevision: base64ToText(hw) || undefined,
      firmwareRevision: base64ToText(fw) || undefined,
      manufacturer: base64ToText(maker) || 'Concept2',
      machineType: machineTypeFromPm(machineBytes.length ? machineBytes[0]! : 0),
    };
    this.info = info;

    // Fastest status rate: 100 ms.
    await m
      .writeCharacteristicWithResponseForDevice(device.id, PM5.ROWING_SERVICE, PM5.SAMPLE_RATE, toBase64([SAMPLE_RATE.MS_100]))
      .catch(() => {});

    this.disconnectSub = m.onDeviceDisconnected(device.id, () => this.onLinkLost());
    this.subs.push(
      m.monitorCharacteristicForDevice(device.id, PM5.CONTROL_SERVICE, PM5.CSAFE_TRANSMIT, (err, c) => {
        if (err || !c?.value) return;
        const frames = this.csafe.push(fromBase64(c.value));
        if (frames.length) {
          this.lastFrames = frames;
          this.rejected += frames.filter((f) => [0x10, 0x20].includes(f.status & 0x30)).length;
          this.responseWaiters.splice(0).forEach((w) => w());
        }
      }),
    );
    this.subscribeMux(device.id);
    this.startMetricsTimer();
    return info;
  }

  private subscribeMux(deviceId: string): void {
    const m = this.mgr();
    this.gotData = false;
    const sub = m.monitorCharacteristicForDevice(deviceId, PM5.ROWING_SERVICE, PM5.MULTIPLEXED, (err, c) => {
      if (err) return;
      const pkt = parseMultiplexed(fromBase64(c?.value));
      if (pkt) {
        this.gotData = true;
        this.handle(this.agg.apply(pkt, Date.now()));
      }
    });
    this.subs.push(sub, this.monitorDirect(deviceId, PM5.FORCE_CURVE, 0x3d));
    this.muxWatchdog = setTimeout(() => {
      this.muxWatchdog = null;
      if (this.gotData || this.deviceId !== deviceId) return;
      sub.remove();
      this.subs = this.subs.filter((s) => s !== sub);
      this.subscribeIndividual(deviceId);
    }, MUX_WATCHDOG_MS);
  }

  private subscribeIndividual(deviceId: string): void {
    // 0x3D is already subscribed next to the mux.
    for (const { uuid, id } of PM5_NOTIFY_CHARACTERISTICS) if (id !== 0x3d) this.subs.push(this.monitorDirect(deviceId, uuid, id));
  }

  private monitorDirect(deviceId: string, uuid: string, id: number): Subscription {
    return this.mgr().monitorCharacteristicForDevice(deviceId, PM5.ROWING_SERVICE, uuid, (err, c) => {
      if (err) return;
      const pkt = parsePacket(id, fromBase64(c?.value), 'direct');
      if (pkt) this.handle(this.agg.apply(pkt, Date.now()));
    });
  }

  private handle(evts: AggregatorEvent[]): void {
    for (const e of evts) {
      if (e.type === 'stroke') this.events.emit('stroke', e.stroke);
      else if (e.type === 'split') this.events.emit('split', e.split);
      else this.events.emit('workoutEnd', e.summary);
    }
  }

  private startMetricsTimer(): void {
    if (this.metricsTimer) return;
    this.metricsTimer = setInterval(() => {
      this.handle(this.agg.tick(Date.now()));
      if (this.agg.takeDirty()) this.events.emit('metrics', { ...this.agg.metrics });
    }, METRICS_INTERVAL_MS);
  }

  private onLinkLost(): void {
    if (this.destroyed || this.userDisconnect || !this.deviceId) return;
    const id = this.deviceId;
    void this.teardownLink(false);
    this.reconnect(id, 0);
  }

  private reconnect(id: string, attempt: number): void {
    const delay = nextReconnectDelay(attempt);
    if (delay === null) {
      this.deviceId = null;
      this.setState({ status: 'disconnected', device: null, error: 'Lost connection to the PM5.' });
      return;
    }
    this.setState({ status: 'reconnecting', device: this.info });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.destroyed || this.userDisconnect) return;
      try {
        const info = await this.establish(id);
        this.setState({ status: 'connected', device: info });
      } catch {
        this.reconnect(id, attempt + 1);
      }
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** Removes subscriptions/timers; optionally cancels the link. */
  private async teardownLink(cancel: boolean): Promise<void> {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.disconnectSub?.remove();
    this.disconnectSub = null;
    if (this.muxWatchdog) clearTimeout(this.muxWatchdog);
    this.muxWatchdog = null;
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.metricsTimer = null;
    this.responseWaiters.splice(0).forEach((w) => w());
    if (cancel && this.deviceId) {
      const m = getBleManager();
      await m?.cancelDeviceConnection(this.deviceId).catch(() => {});
    }
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.clearReconnect();
    await this.teardownLink(true);
    this.deviceId = null;
    this.info = null;
    this.setState({ status: 'disconnected', device: null });
  }

  /** Writes frames sequentially in 20-byte chunks, waiting for each frame's response (or a timeout). */
  private writeFrames(frames: number[][]): Promise<void> {
    const run = async () => {
      const id = this.deviceId;
      if (!id || this.state.status !== 'connected') throw new Error('PM5 is not connected');
      const m = this.mgr();
      for (const frame of frames) {
        const answered = new Promise<void>((resolve) => {
          const t = setTimeout(resolve, RESPONSE_TIMEOUT_MS);
          this.responseWaiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
        for (const part of chunk(frame)) {
          await m.writeCharacteristicWithResponseForDevice(id, PM5.CONTROL_SERVICE, PM5.CSAFE_RECEIVE, toBase64(part));
        }
        await answered;
      }
    };
    const p = this.writeChain.then(run, run);
    this.writeChain = p.catch(() => {});
    return p;
  }

  async programWorkout(plan: WorkoutPlan): Promise<void> {
    if (plan.kind === 'just-row') {
      // Failures surface: a dead link throws, a rejected frame means the PM is not on the Just Row screen.
      this.rejected = 0;
      await this.writeFrames(buildWorkoutFrames(plan));
      if (this.rejected) throw new Pm5RejectedError();
      this.agg.resetWorkout();
      return;
    }
    this.rejected = 0;
    try {
      await this.writeFrames(buildWorkoutFrames(plan));
      if (this.rejected) throw new Pm5RejectedError();
    } catch (e) {
      // Target pace on single / fixed pieces is not hardware-verified: retry once without it so the
      // worst case is "no pace boat on the PM", never "workout won't start". Variable intervals keep theirs.
      const variable = plan.kind === 'intervals' && !plan.repeatForever;
      if (variable || !goalPace(plan)) throw e;
      console.warn('[pm5] programming with target pace failed, retrying without it', e);
      const bare = { ...plan, target: plan.target && { ...plan.target, paceMsPer500: undefined }, pacePlan: undefined };
      this.rejected = 0;
      await this.writeFrames(buildWorkoutFrames(bare));
    }
    this.agg.resetWorkout();
  }

  /** Pace-boat target pace set on the PM (ms/500m), or null if none / unreadable. Read-only. */
  async readTargetPace(): Promise<number | null> {
    this.lastFrames = [];
    try {
      await this.writeFrames([buildGetTargetPaceFrame()]);
    } catch {
      return null;
    }
    return parseTargetPace(this.lastFrames);
  }

  async terminateWorkout(): Promise<void> {
    await this.writeFrames(buildTerminateFrames());
  }

  destroy(): void {
    this.destroyed = true;
    this.userDisconnect = true;
    this.clearReconnect();
    void this.teardownLink(true);
    if (this.scanning) getBleManager()?.stopDeviceScan().catch(() => {});
    this.events.clear();
  }
}

function isPm5Device(d: Device): boolean {
  if (isPm5Name(d.name) || isPm5Name(d.localName)) return true;
  return (d.serviceUUIDs ?? []).some((u) => /^ce06[0-9a-f]{4}-43e5-11e4-916c-0800200c9a66$/i.test(u));
}
