/** Coach-quality copy for every analysis enum. Records are exhaustive so the compiler enforces coverage. */
import type { ForceCurveShape, PacingProfile, TechniqueFlag } from '@/core/types';

export const FLAG_COPY: Record<TechniqueFlag, { title: string; detail: string; drill: string }> = {
  'slow-catch': {
    title: 'Slow catch',
    detail:
      'Force builds slowly after the catch, so the first part of the drive is wasted. Connect with the legs the instant you change direction.',
    drill:
      'Catch pause drill: hold 2 s at full compression (arms long, shins vertical), then take a sharp, firm push off the footplate. Follow with 10 quarter-slide strokes focusing only on an immediate hook-up.',
  },
  'early-peak-fade': {
    title: 'Early peak, then fade',
    detail:
      'Force spikes right after the catch and then falls away: the legs kick but the body and arms don\'t carry the pressure through. Often the seat moves before the handle ("shooting the slide").',
    drill:
      'Pick drill: legs only, then legs + body, then full stroke, keeping seat and handle moving together. Legs-only rowing at low rate teaches you to keep the handle loaded as the legs go down.',
  },
  'late-peak': {
    title: 'Late peak',
    detail:
      'Peak force arrives late in the drive, so you are hauling with the back and arms instead of driving with the legs.',
    drill:
      'Legs-only strokes to feel the drive come from the footplate, then the reverse pick drill (arms → arms + body → full slide) with the leg push staying dominant.',
  },
  'double-peak': {
    title: 'Double peak (mid-drive dip)',
    detail:
      'Force dips mid-drive: legs and back are working one after the other instead of as one connected push, leaking power at the hand-over.',
    drill:
      'Pick drill building from arms-only to full slide with one smooth push, then half-slide pause drills. Think "legs and back open together" and keep the arms long until the legs are nearly down.',
  },
  'weak-finish': {
    title: 'Weak finish',
    detail:
      'Pressure dies before the handle reaches the body, so the last part of every stroke is lost.',
    drill:
      'Feet-out rowing (straps loose) forces a controlled, connected finish. Add arms-and-body-only strokes, drawing firmly to the lower ribs with the elbows past the body.',
  },
  'soft-drive': {
    title: 'Soft drive',
    detail:
      'The curve is a low, flat plateau with no real punch: the stroke is pushed rather than driven.',
    drill:
      'Power strokes: 10 strokes at r20 at maximum pressure, 10 easy, repeat. Rate-capped pieces (e.g. 4 × 5\' at r20) teach you to move the flywheel with pressure, not rate.',
  },
  'jerky-drive': {
    title: 'Jerky drive',
    detail:
      'Force rises and falls sharply within the drive. The handle is being yanked rather than suspended between feet and hands.',
    drill:
      'Slow-motion strokes at r16–18 and moderate pressure, accelerating the handle smoothly. Hang your body weight from the handle (suspension) from catch to finish.',
  },
  'short-stroke': {
    title: 'Short stroke',
    detail:
      'Your drive is short for your size, usually because you are not reaching full compression at the catch.',
    drill:
      'Pause at full compression for 2 s (shins vertical, arms long, body forward) for 10 strokes, then row full slide keeping that reach.',
  },
  overreaching: {
    title: 'Overreaching',
    detail:
      'The drive is unusually long: you are probably over-compressing (shins past vertical) or lunging with the shoulders, which weakens the catch.',
    drill:
      'Body-over pause drill: stop with arms straight and body pivoted forward before the knees rise, then slide only until the shins are vertical.',
  },
  'rushed-recovery': {
    title: 'Rushed recovery',
    detail:
      'The recovery is too quick for this rate: you are charging up the slide, which upsets timing and wastes energy.',
    drill:
      'Rate ladder holding the ratio: 2\' each at r18, 20, 22, 24 with the same pressure. Count "one" on the drive and "two-three" on the way forward.',
  },
  'slow-recovery': {
    title: 'Slow recovery',
    detail:
      'A very long recovery for this rate usually means a stop at the finish or a hurried drive.',
    drill:
      'Continuous-rowing focus: hands away, body over, then slide with no stop at the finish. A rate ladder helps you find a rhythm that flows.',
  },
  'inconsistent-strokes': {
    title: 'Inconsistent strokes',
    detail:
      'Your force curve changes a lot from stroke to stroke, so speed and pace fluctuate.',
    drill:
      'Fixed-rate blocks (e.g. 3 × 5\' at r22) trying to make each curve overlay the last. Row 10 strokes with eyes closed to feel the rhythm.',
  },
  'rate-too-high': {
    title: 'Rate too high',
    detail:
      'You are rating above target, spending energy moving up and down the slide instead of on the handle.',
    drill:
      'Rate-capped pieces: hold r20–24 at your usual split by adding pressure per stroke, not rate.',
  },
  'rate-too-low': {
    title: 'Rate too low',
    detail:
      'You are rating below target, so each stroke has to do too much work and the legs grind out.',
    drill:
      'Rate ladders: build 2 spm every minute while holding technique; on longer pieces add 1–2 spm with slightly lighter pressure.',
  },
  'low-power-per-stroke': {
    title: 'Low power per stroke',
    detail:
      'Each stroke is light for the rate: you are spinning the flywheel with little load, so distance per stroke is low.',
    drill:
      'Drop the rate by 4–6 spm and hold the same split, which forces more work per stroke. Power strokes at r20 teach you to load the handle.',
  },
};

export const SHAPE_COPY: Record<ForceCurveShape, { title: string; detail: string }> = {
  ideal: {
    title: 'Efficient curve',
    detail:
      'Quick rise at the catch, one smooth peak around 40 % of the drive and a controlled taper to the finish. This is what you want.',
  },
  'front-loaded': {
    title: 'Front-loaded',
    detail: 'Big early hit that fades quickly: the legs fire but the body and arms don\'t keep the pressure on.',
  },
  'back-loaded': {
    title: 'Back-loaded',
    detail: 'Force builds late: the catch is soft and the back and arms finish the job the legs should be doing.',
  },
  'double-peak': {
    title: 'Double peak',
    detail: 'Two humps with a dip between: legs and back working in sequence rather than together.',
  },
  flat: {
    title: 'Flat / soft',
    detail: 'A low plateau without a clear peak: the stroke lacks a decisive push off the footplate.',
  },
  spiky: {
    title: 'Spiky',
    detail: 'A sharp, narrow spike: force comes in a jerk instead of being sustained through the drive.',
  },
};

export const PACING_COPY: Record<PacingProfile, { title: string; detail: string }> = {
  even: {
    title: 'Even pacing',
    detail: 'You held a steady split from start to finish, which is the most efficient way to row a piece.',
  },
  'negative-split': {
    title: 'Negative split',
    detail: 'You got faster as the piece went on. Controlled, smart pacing that leaves room to build.',
  },
  'positive-split': {
    title: 'Positive split',
    detail: 'You slowed down in the second half. The start was probably a little too ambitious.',
  },
  'fly-and-die': {
    title: 'Fly and die',
    detail: 'A fast start followed by a steady fade to the finish. The opening pace cost you more than it gained.',
  },
  'u-shaped': {
    title: 'Fast start, strong finish',
    detail: 'Quick start, settled middle and a sprint finish: the classic race profile. Keep the middle close to target.',
  },
  erratic: {
    title: 'Erratic pacing',
    detail: 'The split swung up and down through the piece. Surges and recoveries cost energy.',
  },
  unknown: {
    title: 'Not enough data',
    detail: 'There was not enough split or stroke data to judge the pacing of this piece.',
  },
};

export function describeFlag(flag: TechniqueFlag): { title: string; detail: string; drill: string } {
  return FLAG_COPY[flag] ?? { title: String(flag), detail: '', drill: '' };
}

export function describeShape(shape: ForceCurveShape): { title: string; detail: string } {
  return SHAPE_COPY[shape] ?? { title: String(shape), detail: '' };
}

export function describePacingProfile(p: PacingProfile): { title: string; detail: string } {
  return PACING_COPY[p] ?? PACING_COPY.unknown;
}
