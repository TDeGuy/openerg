/** Pure link helpers shared by the PM5 source and the session controller (no native imports). */

/** Waits before each reconnect attempt: about 43 s of waiting in total, then give up. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 12000, 16000];

/** Delay before attempt `attempt` (0-based), or null once the schedule is exhausted. */
export const nextReconnectDelay = (attempt: number): number | null => RECONNECT_DELAYS_MS[attempt] ?? null;

/** The PM5 is connected but answered the programming frames with an error status. */
export class Pm5RejectedError extends Error {
  constructor() {
    super('The PM5 did not accept the workout');
    this.name = 'Pm5RejectedError';
  }
}
