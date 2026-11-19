/** Pure geometry and wording for the pace boat lanes (no React). Unit tested. */
import type { PaceBoatState } from '@/core/types';
import { clamp } from '@/core/units';

import type { LiveProgress } from './progress';

/** Your boat's resting x and the finish line's x, as fractions of the course width. */
export const YOU_X = 0.35;
export const FINISH_X = 0.92;
const MAX_X = 0.97;

export interface BoatLayout {
  youX: number;
  paceX: number;
  /** Null until the rower is inside the finish window. */
  finishX: number | null;
  /** Course metres per unit of width fraction (for scrolling water marks). */
  pxPerM: number;
}

/** Metres left in the piece, or null for Just Row / calorie pieces. Time is converted at the pace boat's speed. */
export function remainingMeters(p: LiveProgress | null, targetPaceMsPer500: number): number | null {
  if (!p || p.unit === 'calorie') return null;
  if (p.unit === 'distance') return p.remaining;
  return targetPaceMsPer500 > 0 ? (p.remaining * 500) / targetPaceMsPer500 : null;
}

/**
 * Lane positions. Outside the finish window you sit at YOU_X and the pace boat is offset by the gap.
 * Inside it (last ~100 m, or ~20 s of rowing) a finish line appears and you advance toward it.
 */
export function layoutBoats(gapM: number, remainingM: number | null, targetPaceMsPer500: number): BoatLayout {
  const windowM = Math.max(100, targetPaceMsPer500 > 0 ? (20000 * 500) / targetPaceMsPer500 : 0);
  // Gaps bigger than the window shrink the scale in 50 m steps so both boats stay visible.
  const range = Math.max(windowM, Math.ceil((Math.abs(gapM) * 1.5) / 50) * 50);
  const pxPerM = (FINISH_X - YOU_X) / range;
  const finishing = remainingM !== null && remainingM <= range;
  const youX = finishing ? YOU_X + (range - Math.max(0, remainingM)) * pxPerM : YOU_X;
  return {
    youX,
    paceX: clamp(youX - gapM * pxPerM, 0.03, MAX_X),
    finishX: finishing ? FINISH_X : null,
    pxPerM,
  };
}

/** "12 m · 3.1 s ahead of Ghost", "Level with ...". */
export function gapText(b: PaceBoatState): { main: string; sub: string; tone: 'good' | 'bad' | 'accent' } {
  const m = Math.abs(b.gapM);
  const name = b.label || 'pace boat';
  if (m < 1) return { main: 'Level', sub: `with ${name}`, tone: 'accent' };
  const ahead = b.gapM > 0;
  return {
    main: `${m.toFixed(m < 10 ? 1 : 0)} m · ${(Math.abs(b.gapMs) / 1000).toFixed(1)} s`,
    sub: `${ahead ? 'ahead of' : 'behind'} ${name}`,
    tone: ahead ? 'good' : 'bad',
  };
}
