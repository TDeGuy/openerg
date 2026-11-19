import { create } from 'zustand';
import type { SessionActions, SessionState } from '@/core/types';
import { SessionController, initialSessionState } from './controller';

export { useSessionExtras, averageHeartRate } from './extras';

let controller: SessionController;
/** Retry a failed save; resolves to the new workout id (null if it failed again). */
export const retrySave = () => controller.retrySave();
/** Reconnect the last PM5 after auto-reconnect gave up. */
export const reconnectNow = () => controller.reconnectNow();

export const useSession = create<SessionState & SessionActions>()((_set, _get, api) => {
  const c = (controller = new SessionController(api));
  return {
    ...initialSessionState(),
    init: () => c.init(),
    startScan: () => c.startScan(),
    stopScan: () => c.stopScan(),
    connect: (id) => c.connect(id),
    disconnect: () => c.disconnect(),
    startWorkout: (plan, opts) => c.startWorkout(plan, opts),
    finishWorkout: () => c.finishWorkout(),
    discardWorkout: () => c.discardWorkout(),
    scanHeartRate: (onFound) => c.scanHeartRate(onFound),
    connectHeartRate: (id) => c.connectHeartRate(id),
    disconnectHeartRate: () => c.disconnectHeartRate(),
    setCoxMuted: (muted) => c.setCoxMuted(muted),
  };
});
