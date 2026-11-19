/** Keeps the profile's reference 2k at the best non-simulated RowErg 2k. */
import type { WorkoutListItem } from '@/core/types';
import { useSettings } from '@/storage/settings';
import { nextReference2k } from './logbook';

export function syncReference2k(items: readonly WorkoutListItem[]): void {
  const s = useSettings.getState();
  const next = nextReference2k(items, s.settings.profile.reference2kMs);
  if (next != null) s.updateProfile({ reference2kMs: next });
}
