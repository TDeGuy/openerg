/** Pure mapping from PM5 workout / rowing state to the app's session phase. */
import type { LiveMetrics, SessionPhase, WorkoutPlan, WorkoutState } from '@/core/types';

export type PmStateClass = 'pre' | 'work' | 'rest' | 'end';

export function classifyWorkoutState(ws: WorkoutState): PmStateClass {
  switch (ws) {
    case 'workout-row':
    case 'interval-work-time':
    case 'interval-work-distance':
    case 'interval-rest-end-to-work-time':
    case 'interval-rest-end-to-work-distance':
      return 'work';
    case 'interval-rest':
    case 'interval-work-time-to-rest':
    case 'interval-work-distance-to-rest':
      return 'rest';
    case 'workout-end':
    case 'terminate':
    case 'workout-logged':
      return 'end';
    default:
      return 'pre'; // waiting-to-begin, countdown-pause, rearm
  }
}

export function derivePhase(a: {
  armed: boolean;
  started: boolean;
  finished: boolean;
  metrics: Pick<LiveMetrics, 'workoutState' | 'rowingState'>;
}): SessionPhase {
  if (a.finished) return 'finished';
  if (!a.armed) return 'idle';
  const c = classifyWorkoutState(a.metrics.workoutState);
  if (c === 'rest') return 'rest';
  if (c === 'work' && a.metrics.rowingState === 'active') return 'rowing';
  // A stale end state from a previous piece before this one started means "ready".
  if (c === 'end') return a.started ? 'finished' : 'ready';
  return a.started ? 'paused' : 'ready';
}

/**
 * The PM is mid-piece and the app is not recording it (set on the monitor, or the app was closed
 * and reopened): adopt it. Includes paused / resting pieces so a reopen during rest still adopts.
 */
export function shouldAutoArm(m: Pick<LiveMetrics, 'workoutState' | 'rowingState'>): boolean {
  const c = classifyWorkoutState(m.workoutState);
  return c === 'work' || c === 'rest';
}

/**
 * After the PM reported work for this piece and strokes were recorded, the PM reporting end /
 * back-to-menu means the piece is over. Callers must pass `started` = strokes recorded *while the
 * PM was working*: a stale stroke packet while still waiting-to-begin must not end the piece.
 */
export function isWorkoutOver(started: boolean, m: Pick<LiveMetrics, 'workoutState'>): boolean {
  if (!started) return false;
  const c = classifyWorkoutState(m.workoutState);
  return c === 'end' || (c === 'pre' && m.workoutState !== 'countdown-pause');
}

type PmProgram = Pick<LiveMetrics, 'workoutState' | 'workoutType' | 'workoutDurationMs' | 'workoutDistanceM' | 'intervalType'>;

/** Identity of the piece the PM is waiting to start, or null when it is not waiting. */
export function pmProgramKey(m: PmProgram): string | null {
  if (m.workoutState !== 'waiting-to-begin') return null;
  return `${m.workoutType}:${m.workoutDurationMs}:${m.workoutDistanceM}:${m.intervalType}`;
}

/** Best-effort plan for a workout set on the monitor; null = just row (or not representable). */
export function planFromPm(m: PmProgram): WorkoutPlan | null {
  const t = m.workoutType;
  const plan = (p: Omit<WorkoutPlan, 'id' | 'name'>): WorkoutPlan => ({ id: 'pm5', name: 'PM5 workout', ...p });
  if (t.startsWith('fixed-distance') && m.workoutDistanceM > 0) {
    const value = m.workoutDistanceM;
    return t === 'fixed-distance-interval'
      ? plan({ kind: 'intervals', repeatForever: true, intervals: [{ type: 'distance', value, restMs: 0 }] })
      : plan({ kind: 'single-distance', value });
  }
  if (t.startsWith('fixed-time') && m.workoutDurationMs > 0) {
    const value = m.workoutDurationMs;
    return t === 'fixed-time-interval'
      ? plan({ kind: 'intervals', repeatForever: true, intervals: [{ type: 'time', value, restMs: 0 }] })
      : plan({ kind: 'single-time', value });
  }
  return null; // shortcut: calorie / variable intervals need CSAFE reads of the PM's program to reproduce.
}
