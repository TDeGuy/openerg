import type { Unsubscribe } from '@/core/types';

/** Tiny typed event emitter; listener errors are isolated so one bad subscriber can't break the source. */
export class Emitter<E extends object> {
  private listeners: { [K in keyof E]?: Set<(p: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, cb: (payload: E[K]) => void): Unsubscribe {
    const set = (this.listeners[event] ??= new Set());
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (e) {
        console.warn(`[ble] ${String(event)} listener failed`, e);
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
