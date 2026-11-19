import type { CoxswainSettings, WorkoutPlan } from '@/core/types';

/**
 * The settings a workout's coxswain runs with. Per-plan on/off and style win over global; with no plan
 * style, 'test' pieces default to Race and everything else to the settings default. Race uses the race bank,
 * Training the chosen calm/encouraging voice.
 */
export function coxFor(plan: WorkoutPlan | null, global: CoxswainSettings): CoxswainSettings {
  const style = plan?.cox?.style ?? (plan?.category === 'test' ? 'race' : global.style);
  const training = global.personality === 'race' ? 'calm' : global.personality;
  return { ...global, enabled: plan?.cox?.enabled ?? global.enabled, style, personality: style === 'race' ? 'race' : training };
}
