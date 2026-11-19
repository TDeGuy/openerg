/** Starting workouts from anywhere: routes through /connect when no erg is connected. */
import { router } from 'expo-router';

import type { WorkoutPlan } from '@/core/types';
import { dialog } from '@/ui/dialog';
import { useSession } from '@/session';

import { errorMessage } from './common';

export interface PendingStart {
  plan: WorkoutPlan | null;
  opts?: { ghostWorkoutId?: string };
}

let pending: PendingStart | null = null;

const listeners = new Set<() => void>();
export const subscribePendingStart = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export function setPendingStart(p: PendingStart | null): void {
  pending = p;
  listeners.forEach((l) => l());
}
export function peekPendingStart(): PendingStart | null {
  return pending;
}
export function takePendingStart(): PendingStart | null {
  const p = pending;
  setPendingStart(null);
  return p;
}

/** Starts the workout and opens /live; returns false on failure. */
export async function launchWorkout(p: PendingStart, replace = false): Promise<boolean> {
  try {
    await useSession.getState().startWorkout(p.plan, p.opts);
    if (replace) router.replace('/live');
    else router.push('/live');
    return true;
  } catch (e) {
    dialog('Could not start the workout', errorMessage(e));
    return false;
  }
}

export function startOrConnect(plan: WorkoutPlan | null, opts?: { ghostWorkoutId?: string }): void {
  const s = useSession.getState();
  if (s.phase === 'rowing' || s.phase === 'rest' || s.phase === 'paused' || s.phase === 'ready') {
    dialog('Workout in progress', 'Finish or discard the current workout first.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Go to workout', onPress: () => router.push('/live') },
    ]);
    return;
  }
  if (s.connection.status !== 'connected') {
    setPendingStart({ plan, opts });
    router.push('/connect');
    return;
  }
  void launchWorkout({ plan, opts });
}
