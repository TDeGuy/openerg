import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/core/defaults';
import type { WorkoutPlan } from '@/core/types';
import { mergeSettings } from '@/storage/merge';
import { coxFor } from '../override';

const g = DEFAULT_SETTINGS.coxswain;
const plan = (cox?: WorkoutPlan['cox'], category?: WorkoutPlan['category']): WorkoutPlan => ({ id: 'p', name: 'p', kind: 'just-row', cox, category });

describe('coxFor', () => {
  it('follows global settings without an override', () => {
    expect(coxFor(null, g)).toEqual(g);
    expect(coxFor(plan(), g).personality).toBe('encouraging');
  });

  it('applies the plan on/off and style over global', () => {
    expect(coxFor(plan({ enabled: false }), g).enabled).toBe(false);
    expect(coxFor(plan({ enabled: true }), { ...g, enabled: false }).enabled).toBe(true);
    expect(coxFor(plan({ style: 'race' }), g).personality).toBe('race');
    expect(coxFor(plan({ style: 'training' }, 'test'), { ...g, style: 'race', personality: 'calm' }).personality).toBe('calm');
  });

  it('defaults test pieces to race and reads a legacy race personality as calm training', () => {
    expect(coxFor(plan(undefined, 'test'), g).personality).toBe('race');
    expect(coxFor(plan(undefined, 'threshold'), g).personality).toBe('encouraging');
    expect(coxFor(null, { ...g, personality: 'race', style: 'training' }).personality).toBe('calm');
  });

  it('migrates a stored race personality to race style', () => {
    const m = mergeSettings({ coxswain: { personality: 'race' } }).coxswain;
    expect([m.style, m.personality]).toEqual(['race', 'calm']);
    expect(mergeSettings({ coxswain: { personality: 'calm' } }).coxswain.style).toBe('training');
  });
});
