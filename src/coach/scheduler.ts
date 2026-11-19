/** Call scheduler (pure): spacing by frequency, priorities, category toggles, staleness, mute. */
import type { CoxCall, CoxCallCategory, CoxFrequency, CoxswainSettings, TechniqueFlag } from '@/core/types';

export interface CallRequest {
  text: string;
  category: CoxCallCategory;
  priority: 1 | 2 | 3;
  flag?: TechniqueFlag;
}

export type SubmitResult = 'emitted' | 'queued' | 'dropped';

/** Minimum gap between ordinary (priority 1) calls. Priority 2 waits half of this. */
export const FREQUENCY_GAP_MS: Record<CoxFrequency, number> = { minimal: 45000, normal: 20000, chatty: 10000 };
/** Race-plan calls (start sequence, last 250, rest countdown…) only need a short breath between them. */
export const RACE_PLAN_GAP_MS = 3000;
/** How long a blocked call may wait before it is considered stale and dropped. */
export const STALE_MS: Record<1 | 2 | 3, number> = { 1: 2000, 2: 6000, 3: 0 };

export class CallScheduler {
  private lastEmitAt = Number.NEGATIVE_INFINITY;
  private pending: { req: CallRequest; at: number } | null = null;
  private muted = false;
  private counter = 0;

  constructor(
    private settings: CoxswainSettings,
    private emit: (call: CoxCall) => void,
  ) {}

  updateSettings(settings: CoxswainSettings): void {
    this.settings = settings;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.pending = null;
  }

  get lastCallAt(): number {
    return this.lastEmitAt;
  }

  gapFor(req: Pick<CallRequest, 'priority' | 'category'>): number {
    if (req.priority === 3 || req.category === 'safety') return 0;
    if (req.category === 'race-plan') return RACE_PLAN_GAP_MS;
    const base = FREQUENCY_GAP_MS[this.settings.frequency] ?? FREQUENCY_GAP_MS.normal;
    return req.priority === 2 ? base / 2 : base;
  }

  allowed(req: CallRequest): boolean {
    const s = this.settings;
    if (!s.enabled || this.muted) return false;
    switch (req.category) {
      case 'pacing':
      case 'rate':
        if (!s.pacingCalls) return false;
        break;
      case 'technique':
        if (!s.techniqueCalls) return false;
        break;
      case 'motivation':
        if (!s.motivationCalls) return false;
        if (s.frequency === 'minimal' && req.priority === 1) return false;
        break;
      case 'info':
        if (!s.splitCalls) return false;
        break;
      default:
        break;
    }
    return true;
  }

  /** True if a call of this kind could be emitted right now. */
  canEmit(req: Pick<CallRequest, 'priority' | 'category'>, now: number): boolean {
    this.normalize(now);
    return now - this.lastEmitAt >= this.gapFor(req);
  }

  submit(req: CallRequest, now: number, opts: { queue?: boolean } = {}): SubmitResult {
    this.normalize(now);
    if (!this.allowed(req)) return 'dropped';
    if (now - this.lastEmitAt >= this.gapFor(req)) {
      this.fire(req, now);
      return 'emitted';
    }
    if (opts.queue === false || STALE_MS[req.priority] <= 0) return 'dropped';
    if (!this.pending || this.pending.req.priority <= req.priority) {
      this.pending = { req, at: now };
      return 'queued';
    }
    return 'dropped';
  }

  /** Flush a pending call if its gap has passed; drop it once stale. */
  tick(now: number): void {
    this.normalize(now);
    const p = this.pending;
    if (!p) return;
    if (now - p.at > STALE_MS[p.req.priority] || !this.allowed(p.req)) {
      this.pending = null;
      return;
    }
    if (now - this.lastEmitAt >= this.gapFor(p.req)) {
      this.pending = null;
      this.fire(p.req, now);
    }
  }

  /** The PM clock can restart (new workout / interval reset); never block forever on it. */
  private normalize(now: number): void {
    if (now < this.lastEmitAt) this.lastEmitAt = Number.NEGATIVE_INFINITY;
    if (this.pending && now < this.pending.at) this.pending = null;
  }

  private fire(req: CallRequest, now: number): void {
    this.lastEmitAt = now;
    this.counter += 1;
    const call: CoxCall = {
      id: `cox-${this.counter}-${Math.round(now)}`,
      elapsedMs: now,
      text: req.text,
      category: req.category,
      priority: req.priority,
    };
    if (req.flag) call.flag = req.flag;
    this.emit(call);
  }
}
