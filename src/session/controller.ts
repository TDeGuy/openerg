/**
 * SAFETY GUARANTEE: the controller sends the PM5 a CSAFE command only from explicit user actions:
 * startWorkout() (program), finishWorkout() / discardWorkout() (terminate, skipped if the PM already
 * ended the piece). App close / background / disconnect / reconnect / auto-adopt of a running piece
 * send nothing, so reopening the app never touches a PM5 that is mid-workout; it only listens, adopts
 * the PM's piece (its elapsed time and distance are absolute PM values) and resumes the recording
 * from the snapshot when the PM is still in that piece. Covered by __tests__/resume.test.ts.
 *
 * Session controller: wires the erg data source → analysis → coxswain → pace boat →
 * recorder → database, and pushes state into the zustand store.
 */
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { StoreApi } from 'zustand';
import { analyzeForceCurve, resampleCurve } from '@/analysis';
import { createErgSource, createHeartRateSource } from '@/ble';
import { SIM_ERG } from '@/ble/simulator';
import { nextReconnectDelay, Pm5RejectedError } from '@/ble/pm5/link';
import { Coxswain, computePaceBoat, coxFor, createVoice, type CoxVoice } from '@/coach';
import type {
  ConnectionState,
  CoxCall,
  ErgDataSource,
  ForceCurveAnalysis,
  HeartRateDevice,
  HeartRateSource,
  LiveMetrics,
  PaceBoatState,
  PmWorkoutSummary,
  SessionActions,
  SessionState,
  SplitSummary,
  StrokeSample,
  Unsubscribe,
  WorkoutPlan,
  WorkoutRecord,
} from '@/core/types';
import { getWorkout, saveWorkout } from '@/storage/db';
import { autoUpload } from '@/integrations/upload';
import { useSettings } from '@/storage/settings';
import { completedReps, planTitle, titleFromPm } from '@/workouts';
import { persistRecord, useSessionExtras } from './extras';
import { buildGhost, computeGhostBoat, type GhostTrack } from './ghost';
import { classifyWorkoutState, derivePhase, isWorkoutOver, planFromPm, pmProgramKey, shouldAutoArm } from './phase';
import { WorkoutRecorder, type TitleFn } from './recorder';
import { clearSnapshot, loadSnapshot, matchSnapshot, saveSnapshot, SNAPSHOT_EVERY_MS } from './snapshot';

type Store = SessionState & SessionActions;

const METRICS_INTERVAL_MS = 250;
const ROLLING_CURVES = 10;
const HR_STALE_MS = 5000;
const KEEP_AWAKE_TAG = 'openerg-workout';
const JUST_ROW: WorkoutPlan = { id: 'just-row', name: 'Just row', kind: 'just-row' };

export function initialSessionState(): SessionState {
  return {
    connection: { status: 'idle', device: null },
    discovered: [],
    hrConnected: false,
    phase: 'idle',
    plan: null,
    metrics: null,
    lastStroke: null,
    strokes: [],
    splits: [],
    lastStrokeAnalysis: null,
    rollingAverageCurve: [],
    paceBoat: null,
    lastCoxCall: null,
    coxCalls: [],
    lastSavedWorkoutId: null,
  };
}

const titler: TitleFn = ({ plan, workoutType, distanceM, elapsedMs, splits }) =>
  plan && plan.kind !== 'just-row'
    ? planTitle(plan, plan.repeatForever && plan.intervals?.[0] ? completedReps(plan.intervals[0], splits) : undefined)
    : titleFromPm(workoutType, { distanceM, elapsedMs }, splits);

const buildGhostOrNull = (rec: Parameters<typeof buildGhost>[0] | null) => (rec ? buildGhost(rec) : null);
// Lazy: the dialog module pulls in react-native, which unit tests cannot load.
const askProgramFailed = async () => {
  const { dialog } = await import('@/ui/dialog');
  return new Promise<'retry' | 'continue' | 'cancel'>((resolve) =>
    dialog('PM5 did not accept the workout', 'The monitor is connected but rejected the setup. Set the piece on the PM5 yourself if you continue.', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
      { text: 'Continue anyway', onPress: () => resolve('continue') },
      { text: 'Retry', onPress: () => resolve('retry') },
    ]),
  );
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const settings = () => useSettings.getState().settings;

export class SessionController {
  private source: ErgDataSource | null = null;
  private sourceSubs: Unsubscribe[] = [];
  private stopScanFn: Unsubscribe | null = null;

  private hr: HeartRateSource | null = null;
  private hrSub: Unsubscribe | null = null;
  private hrBpm: number | null = null;
  private hrAt = 0;
  private hrRetryAt = 0;

  private recorder: WorkoutRecorder | null = null;
  private armed = false;
  private finished = false;
  private finalizing: Promise<string | null> | null = null;
  private savedId: string | null = null;
  /** Built record whose save failed; kept (with the crash snapshot) until it saves or is discarded. */
  /** Finished workouts that failed to save; kept until saved or discarded. */
  private failedSaves: WorkoutRecord[] = [];
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private endWaiter: (() => void) | null = null;
  private suppressAutoArm = false;
  /** PM reported work/rest since arming; strokes before that are stale packets, not rowing. */
  private pmWorked = false;
  /** Last piece seen waiting on the PM, so a workout set on the monitor arms once. */
  private pmKey: string | null = null;
  private plan: WorkoutPlan | null = null;
  private ghost: GhostTrack | null = null;
  private ghostId: string | null = null;
  private lastSnapAt = 0;

  private cox: Coxswain | null = null;
  private coxSub: Unsubscribe | null = null;
  private muted = false;
  private voice: CoxVoice | null = null;

  private curves: number[][] = [];
  private lastStrokeKey = '';
  private lastRaw: LiveMetrics | null = null;
  private pending: { metrics: LiveMetrics; paceBoat: PaceBoatState | null } | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush = 0;

  private userDisconnect = false;
  private reconnectId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private keepAwakeOn = false;

  constructor(private store: StoreApi<Store>) {
    useSettings.subscribe((s, prev) => {
      const a = s.settings;
      const b = prev.settings;
      if (a.useSimulator !== b.useSimulator && this.source) this.ensureSource();
      if (a.coxswain !== b.coxswain) this.onCoxSettings();
      if (a.keepAwake !== b.keepAwake) this.applyKeepAwake();
    });
  }

  private set(patch: Partial<SessionState>) {
    this.store.setState(patch);
  }

  /* ───────────── source lifecycle ───────────── */

  private ensureSource(): ErgDataSource {
    const kind = settings().useSimulator ? 'simulator' : 'ble';
    if (this.source?.kind === kind) return this.source;
    this.teardownSource();
    const src: ErgDataSource = createErgSource(kind);
    this.source = src;
    this.sourceSubs = [
      src.on('connection', (c) => src === this.source && this.onConnection(c)),
      src.on('metrics', (m) => src === this.source && this.onMetrics(m)),
      src.on('stroke', (s) => src === this.source && this.onStroke(s)),
      src.on('split', (s) => src === this.source && this.onSplit(s)),
      src.on('workoutEnd', (s) => src === this.source && this.onWorkoutEnd(s)),
    ];
    this.set({ connection: src.getConnectionState(), discovered: [] });
    return src;
  }

  private teardownSource() {
    const src = this.source;
    if (!src) return;
    this.stopScan();
    this.clearReconnect();
    this.sourceSubs.forEach((u) => u());
    this.sourceSubs = [];
    this.source = null;
    src.disconnect().catch(() => undefined).finally(() => src.destroy());
  }

  async init(): Promise<{ ok: boolean; reason?: string }> {
    const src = this.ensureSource();
    let res: { ok: boolean; reason?: string };
    try {
      res = await src.prepare();
    } catch (e) {
      res = { ok: false, reason: String(e) };
    }
    if (settings().lastErgId === SIM_ERG.id) useSettings.getState().update({ lastErgId: null });
    const st = settings();
    if (res.ok && st.autoReconnect) {
      const status = src.getConnectionState().status;
      if (src.kind === 'ble' && st.lastErgId && (status === 'idle' || status === 'disconnected')) {
        this.reconnectId = st.lastErgId;
        src.connect(st.lastErgId).catch(() => this.scheduleReconnect());
      }
      if (st.lastHrDeviceId && !this.store.getState().hrConnected) {
        this.connectHeartRate(st.lastHrDeviceId).catch(() => undefined);
      }
    }
    return res;
  }

  async startScan(): Promise<void> {
    const src = this.ensureSource();
    this.stopScan();
    this.set({ discovered: [] });
    this.stopScanFn = await src.scan((erg) => {
      const list = this.store.getState().discovered.filter((d) => d.id !== erg.id);
      this.set({ discovered: [...list, erg] });
    });
  }

  stopScan(): void {
    this.stopScanFn?.();
    this.stopScanFn = null;
  }

  async connect(id: string): Promise<void> {
    const src = this.ensureSource();
    this.stopScan();
    this.clearReconnect();
    this.userDisconnect = false;
    this.reconnectId = id;
    await src.connect(id);
    this.set({ connection: src.getConnectionState() });
    if (src.kind === 'ble' && settings().lastErgId !== id) useSettings.getState().update({ lastErgId: id });
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.clearReconnect();
    await this.source?.disconnect();
  }

  private onConnection(c: ConnectionState) {
    this.set({ connection: c });
    if (c.status === 'connected') {
      if (c.device) this.reconnectId = c.device.id;
      this.clearReconnect();
    } else if ((c.status === 'disconnected' || c.status === 'error') && !this.userDisconnect) {
      // Recording state is kept; the piece resumes when the PM comes back.
      // 'disconnected' is the BLE source's own retries running out; 'error' is a failed connect.
      if (settings().autoReconnect && this.reconnectId) {
        if (c.status === 'disconnected' && this.source?.kind === 'ble') this.giveUpReconnect();
        else this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.reconnectId) return;
    const delay = nextReconnectDelay(this.reconnectAttempts);
    if (delay === null) return this.giveUpReconnect();
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const src = this.source;
      const id = this.reconnectId;
      if (!src || !id || this.userDisconnect || src.getConnectionState().status === 'connected') return;
      this.reconnectAttempts++;
      try {
        await src.connect(id);
        this.reconnectAttempts = 0;
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    useSessionExtras.setState({ pmLost: false });
  }

  private giveUpReconnect() {
    useSessionExtras.setState({ pmLost: true });
  }

  /** Manual retry after giving up (home / live screen button). */
  async reconnectNow(): Promise<void> {
    const id = this.reconnectId ?? settings().lastErgId;
    if (!id) throw new Error('No erg to reconnect to');
    await this.connect(id);
  }

  /* ───────────── heart-rate strap ───────────── */

  private hrSource(): HeartRateSource {
    return (this.hr ??= createHeartRateSource());
  }

  scanHeartRate(onFound: (d: HeartRateDevice) => void): Promise<Unsubscribe> {
    return this.hrSource().scan(onFound);
  }

  async connectHeartRate(id: string): Promise<void> {
    const hr = this.hrSource();
    await hr.connect(id);
    this.hrSub?.();
    this.hrSub = hr.onHeartRate((bpm) => {
      this.hrBpm = bpm;
      this.hrAt = Date.now();
    });
    this.set({ hrConnected: true });
    if (settings().lastHrDeviceId !== id) useSettings.getState().update({ lastHrDeviceId: id });
  }

  async disconnectHeartRate(): Promise<void> {
    this.hrSub?.();
    this.hrSub = null;
    this.hrBpm = null;
    this.set({ hrConnected: false });
    await this.hr?.disconnect();
  }

  /** Fresh strap reading, or null to keep the PM's value. */
  private strapHr(): number | null {
    if (!this.hr || !this.store.getState().hrConnected) return null;
    if (!this.hr.isConnected()) {
      this.set({ hrConnected: false });
      const id = settings().lastHrDeviceId;
      if (id && settings().autoReconnect && Date.now() > this.hrRetryAt) {
        this.hrRetryAt = Date.now() + 15_000;
        this.connectHeartRate(id).catch(() => undefined);
      }
      return null;
    }
    return this.hrBpm && Date.now() - this.hrAt < HR_STALE_MS ? this.hrBpm : null;
  }

  /* ───────────── workout lifecycle ───────────── */

  /** `adopting` continues a piece already under way, so the user's mute stays; a new workout unmutes. */
  private arm(plan: WorkoutPlan | null, ghost: GhostTrack | null, pmWorked = false, adopting = false) {
    this.clearEndTimer();
    this.pmWorked = pmWorked;
    this.stopCox();
    if (!adopting) this.muted = false;
    useSessionExtras.setState({ muted: this.muted, saveFailed: this.failedSaves.length > 0 });
    const device = this.store.getState().connection.device;
    this.recorder = new WorkoutRecorder({
      plan,
      machineType: device?.machineType ?? 'rower',
      ergName: device?.name,
      ergSerial: device?.serialNumber,
      simulated: this.source?.kind === 'simulator' || !!device?.simulated,
    });
    this.armed = true;
    this.finished = false;
    this.finalizing = null;
    this.savedId = null;
    this.plan = plan;
    this.ghost = ghost;
    this.ghostId = null;
    this.lastSnapAt = 0;
    this.curves = [];
    this.pending = null;
    const s = initialSessionState();
    this.set({
      phase: 'ready',
      plan,
      metrics: null,
      lastStroke: null,
      strokes: s.strokes,
      splits: s.splits,
      lastStrokeAnalysis: null,
      rollingAverageCurve: [],
      paceBoat: null,
      lastCoxCall: null,
      coxCalls: [],
      lastSavedWorkoutId: null,
    });
    this.startCox();
    this.applyKeepAwake();
  }

  async startWorkout(plan: WorkoutPlan | null, opts?: { ghostWorkoutId?: string }): Promise<void> {
    const src = this.ensureSource();
    if (this.armed && !this.finished && this.recorder?.started) await this.finishWorkout();
    let ghost: GhostTrack | null = null;
    if (opts?.ghostWorkoutId) {
      const rec = await getWorkout(opts.ghostWorkoutId).catch(() => null);
      ghost = rec ? buildGhost(rec) : null;
    }
    this.arm(plan, ghost);
    this.ghostId = ghost ? opts?.ghostWorkoutId ?? null : null;
    for (;;) {
      try {
        await src.programWorkout(plan ?? JUST_ROW);
        this.pmWorked = false; // status from the previous piece may have arrived while programming
        return;
      } catch (e) {
        // Connected but the PM refused: let the user retry or row anyway. A dead link just errors out.
        const choice = e instanceof Pm5RejectedError && src.getConnectionState().status === 'connected' ? await askProgramFailed() : 'cancel';
        if (choice === 'continue') return;
        if (choice === 'cancel') {
          this.disarm();
          throw e;
        }
      }
    }
  }

  async finishWorkout(): Promise<string | null> {
    if (!this.recorder || !this.armed) return null;
    if (this.finalizing) return this.finalizing;
    if (!this.recorder.isWorthSaving()) {
      this.discardWorkout(); // nothing rowed: just end it
      return null;
    }
    const src = this.source;
    if (src && src.getConnectionState().status === 'connected' && !this.pmEnded()) {
      const ended = new Promise<void>((r) => (this.endWaiter = r));
      await Promise.race([src.terminateWorkout().catch(() => undefined), sleep(3000)]);
      // Give the PM a moment to deliver its end-of-workout summary.
      if (!this.recorder.summary) await Promise.race([ended, sleep(1500)]);
    }
    return this.finalize();
  }

  discardWorkout(): void {
    const src = this.source;
    if (this.armed && !this.finished && src?.getConnectionState().status === 'connected' && !this.pmEnded()) {
      src.terminateWorkout().catch(() => undefined);
    }
    this.disarm();
  }

  /** The PM already ended the piece itself: do not send it anything more. */
  private pmEnded(): boolean {
    return !!this.lastRaw && classifyWorkoutState(this.lastRaw.workoutState) === 'end';
  }

  private disarm() {
    void clearSnapshot();
    this.failedSaves = [];
    useSessionExtras.setState({ saveFailed: false });
    this.clearEndTimer();
    this.stopCox();
    this.recorder = null;
    this.armed = false;
    this.finished = false;
    this.finalizing = null;
    this.ghost = null;
    this.plan = null;
    this.suppressAutoArm = true;
    this.applyKeepAwake();
    const s = initialSessionState();
    this.set({
      phase: 'idle',
      plan: null,
      strokes: s.strokes,
      splits: s.splits,
      lastStroke: null,
      lastStrokeAnalysis: null,
      rollingAverageCurve: [],
      paceBoat: null,
      lastCoxCall: null,
      coxCalls: [],
    });
  }

  /** Idempotent: saves once (if worth saving) and moves to 'finished'. */
  private finalize(): Promise<string | null> {
    if (this.finalizing) return this.finalizing;
    this.finalizing = (async () => {
      this.clearEndTimer();
      this.finished = true;
      this.suppressAutoArm = true;
      this.stopCox();
      this.applyKeepAwake();
      this.flushMetrics();
      const rec = this.recorder;
      let id: string | null = null;
      if (rec?.isWorthSaving()) {
        const record = rec.build({ title: titler });
        const res = await persistRecord(record, saveWorkout);
        id = res.id;
        if (res.pending) this.failedSaves.push(res.pending);
        if (id) this.onSaved(record);
      }
      if (!this.failedSaves.length) void clearSnapshot(); // a failed save keeps the crash snapshot
      useSessionExtras.setState({ saveFailed: this.failedSaves.length > 0 });
      this.savedId = id;
      this.set({ phase: 'finished', paceBoat: null, lastSavedWorkoutId: id });
      return id;
    })();
    return this.finalizing;
  }

  private onSaved(record: WorkoutRecord) {
    void autoUpload(record).catch((e) => console.warn('[session] auto upload failed', e));
  }

  /** Retries the failed saves; resolves to the id of the last one saved, or null if any still fail. */
  async retrySave(): Promise<string | null> {
    if (!this.failedSaves.length) return this.savedId;
    let id: string | null = null;
    for (const record of this.failedSaves.splice(0)) {
      const res = await persistRecord(record, saveWorkout);
      if (res.pending) this.failedSaves.push(res.pending);
      else {
        id = record.id;
        this.savedId = id;
        this.onSaved(record);
      }
    }
    useSessionExtras.setState({ saveFailed: this.failedSaves.length > 0 });
    if (!this.failedSaves.length) void clearSnapshot();
    if (id) this.set({ lastSavedWorkoutId: id });
    return this.failedSaves.length ? null : id;
  }

  /** Late data (split after workoutEnd) updates the already-saved record. */
  private resave() {
    if (!this.savedId || !this.recorder) return;
    saveWorkout(this.recorder.build({ title: titler })).catch((e) => console.warn('[session] resave failed', e));
  }

  private scheduleEnd(ms: number) {
    this.clearEndTimer();
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      void this.finalize();
    }, ms);
  }

  private clearEndTimer() {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  /* ───────────── events ───────────── */

  private onMetrics(raw: LiveMetrics) {
    const hr = this.strapHr();
    const m = hr != null ? { ...raw, heartRate: hr } : raw;
    this.lastRaw = m;
    const cls = classifyWorkoutState(m.workoutState);
    if (cls === 'pre' || cls === 'end') this.suppressAutoArm = false;
    const key = pmProgramKey(m);
    if (key !== null && key !== this.pmKey) {
      // A workout set on the monitor itself: arm with a matching plan before the first stroke.
      // The first key seen is only recorded: the main menu also "waits" with the last workout type.
      const plan = this.pmKey !== null && (!this.armed || this.finished) ? planFromPm(m) : null;
      this.pmKey = key;
      if (plan) this.arm(plan, null);
      void this.adoptPmTargetPace();
    }
    if ((!this.armed || this.finished) && !this.suppressAutoArm && shouldAutoArm(m)) this.adopt(m);
    if (this.armed && (cls === 'work' || cls === 'rest')) this.pmWorked = true;

    const rec = this.recorder;
    let paceBoat: PaceBoatState | null = null;
    if (this.armed && !this.finished && rec) {
      rec.noteMetrics(m);
      this.cox?.onMetrics(m);
      if (rec.started && Date.now() - this.lastSnapAt >= SNAPSHOT_EVERY_MS) this.snapshot(rec, m);
      if (isWorkoutOver(rec.started, m)) {
        // Fallback when the PM ends without a workoutEnd event (or it got lost).
        if (!this.endTimer) this.scheduleEnd(3000);
      } else if (this.endTimer && (cls === 'work' || cls === 'rest')) {
        this.clearEndTimer();
      }
      if (settings().showPaceBoat) {
        try {
          paceBoat = this.ghost ? computeGhostBoat(this.ghost, m.elapsedMs, m.distanceM) : computePaceBoat(this.plan, m, this.store.getState().connection.device?.machineType);
        } catch {
          paceBoat = null;
        }
      }
    }

    const phase = derivePhase({ armed: this.armed, started: !!rec?.started, finished: this.finished, metrics: m });
    if (phase !== this.store.getState().phase) this.set({ phase });

    // Throttle React updates to ~4 Hz.
    this.pending = { metrics: m, paceBoat };
    const wait = METRICS_INTERVAL_MS - (Date.now() - this.lastFlush);
    if (wait <= 0) this.flushMetrics();
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushMetrics(), wait);
  }

  private snapshot(rec: WorkoutRecorder, m: LiveMetrics) {
    this.lastSnapAt = Date.now();
    void saveSnapshot({
      recId: rec.id,
      savedAt: this.lastSnapAt,
      startedAt: rec.startedAt,
      plan: this.plan,
      ghostId: this.ghostId,
      workoutType: m.workoutType,
      intervalCount: m.intervalCount,
      elapsedMs: m.elapsedMs,
      distanceM: m.distanceM,
      durationMs: m.workoutDurationMs,
      pieceDistanceM: m.workoutDistanceM,
      strokes: rec.strokes,
      splits: rec.splits,
      heartRate: rec.heartRate,
      coxCalls: rec.coxCalls,
    });
  }

  /**
   * Adopt a piece the PM is already running (set on the monitor, or the app was reopened mid-piece).
   * The PM is the source of truth: if a fresh snapshot matches it, keep recording into that same
   * workout; otherwise the snapshot is stale and dropped. Sends nothing to the PM except a read.
   */
  private adopt(m: LiveMetrics) {
    this.arm(planFromPm(m), null, true, true);
    const rec = this.recorder;
    void (async () => {
      const snap = await loadSnapshot();
      if (this.recorder !== rec || this.finished) return;
      if (!snap || !matchSnapshot(snap, m, Date.now())) {
        if (snap) void clearSnapshot();
        void this.adoptPmTargetPace();
        return;
      }
      const ghost = snap.ghostId ? buildGhostOrNull(await getWorkout(snap.ghostId).catch(() => null)) : null;
      if (this.recorder !== rec || this.finished) return;
      this.arm(snap.plan, ghost, true, true);
      this.ghostId = snap.ghostId;
      this.recorder!.restore(snap);
      // Strokes/splits/calls that arrived while the snapshot was loading.
      rec!.strokes.forEach((s) => this.recorder!.addStroke(s));
      rec!.splits.forEach((s) => this.recorder!.addSplit(s));
      rec!.coxCalls.forEach((c) => this.recorder!.addCoxCall(c));
      this.set({ strokes: [...this.recorder!.strokes], splits: this.recorder!.splits, coxCalls: [...this.recorder!.coxCalls] });
      void this.adoptPmTargetPace();
    })();
  }

  /** Show a pace boat that was set on the PM itself (read-only CSAFE query; not all firmware answers). */
  private async adoptPmTargetPace() {
    const src = this.source as { readTargetPace?: () => Promise<number | null> } | null;
    const plan = this.plan;
    if (!src?.readTargetPace || !this.armed || (plan && (plan.target?.paceMsPer500 || plan.pacePlan))) return;
    const pace = await src.readTargetPace().catch(() => null);
    if (!pace || this.plan !== plan || !this.armed) return;
    // shortcut: variable-interval plans from the PM are not reconstructed, so only single/fixed pieces get a boat.
    if (plan && plan.kind !== 'just-row') {
      this.plan = { ...plan, target: { ...plan.target, paceMsPer500: pace } };
      this.set({ plan: this.plan });
    }
  }

  private flushMetrics() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pending) return;
    this.lastFlush = Date.now();
    this.set(this.pending);
    this.pending = null;
  }

  private onStroke(raw: StrokeSample) {
    const hr = this.strapHr();
    const s = hr != null ? { ...raw, heartRate: hr } : raw;
    if ((!this.armed || this.finished) && !this.suppressAutoArm && this.lastRaw && shouldAutoArm(this.lastRaw)) this.adopt(this.lastRaw);

    // Strokes before the PM reports work are stale packets: recording them made the piece look
    // started, and the PM still "waiting" then read as workout over → autosave after 3 s.
    const recording = this.armed && !this.finished && !!this.recorder && this.pmWorked;
    if (recording) {
      if (!this.recorder!.addStroke(s)) return;
    } else {
      const key = `${s.intervalCount}:${s.strokeNumber}:${s.elapsedMs}`;
      if (key === this.lastStrokeKey) return;
      this.lastStrokeKey = key;
    }

    let analysis: ForceCurveAnalysis | null = null;
    let rolling = this.store.getState().rollingAverageCurve;
    if (s.forceCurve.length >= 3) {
      try {
        analysis = analyzeForceCurve(s.forceCurve, {
          driveTimeMs: s.driveTimeMs,
          recoveryTimeMs: s.recoveryTimeMs,
          driveLengthM: s.driveLengthM,
          strokeRate: s.strokeRate,
          heightCm: settings().profile.heightCm,
        });
        this.curves.push(resampleCurve(s.forceCurve, 32));
        if (this.curves.length > ROLLING_CURVES) this.curves.shift();
        rolling = this.curves[0].map((_, i) => this.curves.reduce((a, c) => a + (c[i] ?? 0), 0) / this.curves.length);
      } catch (e) {
        console.warn('[session] force analysis failed', e);
      }
    }
    if (recording) this.cox?.onStroke(s, analysis);
    this.set({
      lastStroke: s,
      lastStrokeAnalysis: analysis,
      rollingAverageCurve: rolling,
      ...(recording ? { strokes: [...this.recorder!.strokes] } : {}),
    });
  }

  private onSplit(s: SplitSummary) {
    const rec = this.recorder;
    if (!this.armed || !rec) return;
    rec.addSplit(s);
    this.set({ splits: rec.splits });
    if (this.finished) this.resave();
    else this.cox?.onSplit(s);
  }

  private onWorkoutEnd(sum: PmWorkoutSummary) {
    const rec = this.recorder;
    if (!this.armed || !rec) return;
    rec.setSummary(sum);
    this.endWaiter?.();
    this.endWaiter = null;
    if (this.finished) {
      this.resave();
      return;
    }
    this.cox?.onWorkoutEnd(sum);
    this.set({ phase: 'finished' });
    // Short grace period so a final split that arrives after workoutEnd is included.
    this.scheduleEnd(1000);
  }

  /* ───────────── coxswain ───────────── */

  private startCox() {
    const st = settings();
    const cs = coxFor(this.plan, st.coxswain);
    if (this.cox || !cs.enabled || !this.armed || this.finished) return;
    try {
      const cox = new Coxswain({ settings: cs, profile: st.profile, plan: this.plan, machine: this.store.getState().connection.device?.machineType });
      cox.setMuted(this.muted);
      this.coxSub = cox.subscribe((c) => this.onCoxCall(c));
      this.cox = cox;
      // Load the neural voice before the first call so it isn't spoken late.
      if (cs.voiceEnabled) (this.voice ??= createVoice()).prewarm?.(cs);
    } catch (e) {
      console.warn('[session] coxswain failed to start', e);
    }
  }

  private stopCox() {
    this.coxSub?.();
    this.coxSub = null;
    this.cox = null;
    this.voice?.stop();
  }

  private onCoxSettings() {
    const cs = coxFor(this.plan, settings().coxswain);
    if (!cs.enabled) this.stopCox();
    else if (!this.cox) this.startCox();
    else this.cox.updateSettings(cs);
    if (!cs.voiceEnabled) this.voice?.stop();
  }

  private onCoxCall(c: CoxCall) {
    this.recorder?.addCoxCall(c);
    this.set({ lastCoxCall: c, coxCalls: [...this.store.getState().coxCalls, c] });
    const cs = settings().coxswain;
    if (this.muted) return;
    if (cs.voiceEnabled) {
      try {
        (this.voice ??= createVoice()).speak(c, cs);
      } catch (e) {
        console.warn('[session] voice failed', e);
      }
    }
    if (cs.hapticsEnabled) {
      const p =
        c.priority === 3
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          : Haptics.impactAsync(c.priority === 2 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      p.catch(() => undefined);
    }
  }

  setCoxMuted(muted: boolean): void {
    this.muted = muted;
    useSessionExtras.setState({ muted });
    this.cox?.setMuted(muted);
    if (muted) this.voice?.stop();
  }

  /* ───────────── keep awake ───────────── */

  private applyKeepAwake() {
    const want = this.armed && !this.finished && settings().keepAwake;
    if (want === this.keepAwakeOn) return;
    this.keepAwakeOn = want;
    (want ? activateKeepAwakeAsync(KEEP_AWAKE_TAG) : deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => undefined);
  }
}
