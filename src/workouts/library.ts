/** Built-in workout library (pure). Ids are stable: never rename an existing `builtin-…` id. */
import type { IntervalDef, IntervalTarget, PlanSegment, WorkoutCategory, WorkoutPlan } from '@/core/types';

const S = 1000;
const MIN = 60 * S;

type Extra = Partial<Pick<WorkoutPlan, 'target' | 'splitValue' | 'segments' | 'cox'>>;
const TRAINING = { style: 'training' } as const;

function dist(id: string, name: string, m: number, category: WorkoutCategory, description: string, extra: Extra = {}): WorkoutPlan {
  return { id: `builtin-${id}`, name, kind: 'single-distance', value: m, category, description, builtIn: true, ...extra };
}

function time(id: string, name: string, ms: number, category: WorkoutCategory, description: string, extra: Extra = {}): WorkoutPlan {
  return { id: `builtin-${id}`, name, kind: 'single-time', value: ms, category, description, builtIn: true, ...extra };
}

function intervals(id: string, name: string, ivs: IntervalDef[], category: WorkoutCategory, description: string, target?: IntervalTarget): WorkoutPlan {
  return { id: `builtin-${id}`, name, kind: 'intervals', intervals: ivs, category, description, builtIn: true, ...(target ? { target } : {}) };
}

function reps(n: number, type: IntervalDef['type'], value: number, restMs: number, target?: IntervalTarget): IntervalDef[] {
  return Array.from({ length: n }, () => ({ type, value, restMs, ...(target ? { target: { ...target } } : {}) }));
}

/** Continuous time steps at given rates (one PM piece; the app tracks the rate changes). */
function rateSegs(stepMs: number, rates: number[]): PlanSegment[] {
  return rates.map((r) => ({ duration: stepMs, strokeRate: r }));
}

export const BUILT_IN_WORKOUTS: WorkoutPlan[] = [
  /* ── tests ── */
  dist('100m', '100m sprint', 100, 'test', 'All-out 100m. Explosive start, hold the rate high (40+) and never back off — it is over in about 20 seconds.'),
  dist('500m', '500m test', 500, 'test', 'Flat-out 500m. Fast start, settle for only a few strokes around 250m, then sprint the last 150m. Expect to fade slightly; that is normal.', { splitValue: 100 }),
  dist('1k', '1000m test', 1000, 'test', 'One-kilometre test. Hard first 200m, settle at about two seconds slower than your 500m pace, and build from 600m.', { splitValue: 250 }),
  dist('2k', '2000m test', 2000, 'test', 'The benchmark erg test. Fast start for ~15 strokes, settle a touch above goal pace, hold through the third 500 (the hard one), and sprint from 1750m. Add a pace plan in the builder to get a pace boat.', { splitValue: 500 }),
  dist('5k', '5000m test', 5000, 'test', 'Aerobic power test. Start controlled — no faster than 2k pace + 6s — hold even splits and lift the last 1000m.', { splitValue: 1000 }),
  dist('6k', '6000m test', 6000, 'test', 'The classic endurance test. Even pacing around 2k pace + 8–10s at rate 26–30, then empty it over the last 1000m.', { splitValue: 1000 }),
  dist('10k', '10,000m', 10000, 'test', 'Long aerobic test. Settle into a sustainable rhythm (rate 24–28), even splits, and only push in the final 2k.', { splitValue: 1000 }),
  dist('hm', 'Half marathon', 21097, 'test', 'Half marathon (21,097m). Pace it like a long steady state at the top of UT1, fuel and hydrate, negative split if you can.', { splitValue: 1000 }),
  dist('fm', 'Marathon', 42195, 'test', 'Full marathon (42,195m). Start conservatively, rate 20–24, eat and drink every 30 minutes, hold form when it gets tough.', { splitValue: 2000 }),
  // Timed pieces default to training coxing (the user does not row them as tests).
  time('1min', '1:00 test', 1 * MIN, 'test', 'One minute all-out for maximum metres. Aggressive start, hang on through the last 20 seconds.', { splitValue: 20 * S, cox: TRAINING }),
  time('4min', '4:00 test', 4 * MIN, 'test', 'Four minutes for maximum distance — a VO2max benchmark. Pace it like a 1k: quick start, settle, sprint the final minute.', { splitValue: MIN, cox: TRAINING }),
  time('30min-r20', '30:00 at r20', 30 * MIN, 'test', 'The classic 30r20: maximum distance in 30 minutes at a capped rate of 20. Long, powerful strokes; the test is power per stroke.', { splitValue: 5 * MIN, target: { strokeRate: 20 }, cox: TRAINING }),
  time('60min', '60:00', 60 * MIN, 'test', 'Maximum metres in one hour. Even pacing around 2k pace + 15–18s, rate 22–26.', { splitValue: 5 * MIN, cox: TRAINING }),

  /* ── steady state ── */
  time('ss-30-ut2', '30:00 UT2', 30 * MIN, 'steady-state', 'Easy aerobic base. Conversational effort (HR zone 1), rate 18–20, focus on long relaxed strokes.', { splitValue: 5 * MIN, target: { strokeRate: 20, hrZone: 1 } }),
  time('ss-45-ut2', '45:00 UT2', 45 * MIN, 'steady-state', 'Longer UT2 aerobic session at rate 18–20. You should be able to breathe through your nose most of the time.', { splitValue: 5 * MIN, target: { strokeRate: 20, hrZone: 1 } }),
  time('ss-60-ut1', '60:00 UT1', 60 * MIN, 'steady-state', 'Steady UT1 hour (HR zone 2), rate 20–22. Firmer than UT2 but still sustainable; keep splits even.', { splitValue: 10 * MIN, target: { strokeRate: 22, hrZone: 2 } }),
  time('ss-90', '90:00 long steady', 90 * MIN, 'steady-state', 'Long aerobic base builder. Very easy pressure, rate 18–20, take a drink every 20 minutes.', { splitValue: 10 * MIN, target: { strokeRate: 19, hrZone: 1 } }),
  dist('ss-10k', '10k steady', 10000, 'steady-state', '10,000m at a steady UT1 effort, rate 20–22. Even splits; do not race it.', { splitValue: 1000, target: { strokeRate: 22, hrZone: 2 } }),
  intervals('ss-3x20-rates', '3 × 20:00 r20/22/24', [
    { type: 'time', value: 20 * MIN, restMs: 2 * MIN, target: { strokeRate: 20 } },
    { type: 'time', value: 20 * MIN, restMs: 2 * MIN, target: { strokeRate: 22 } },
    { type: 'time', value: 20 * MIN, restMs: 0, target: { strokeRate: 24 } },
  ], 'steady-state', 'Three 20-minute pieces stepping up the rate (20, 22, 24) with two minutes rest. Pressure stays the same, so pace drops a little each piece.'),
  intervals('ss-4x10', '4 × 10:00 / 2:00r', reps(4, 'time', 10 * MIN, 2 * MIN, { strokeRate: 22, hrZone: 2 }), 'steady-state', 'Broken steady state in UT1: four 10-minute pieces at rate 22, steady and even, short rests to reset technique.'),
  intervals('ss-2x30', '2 × 30:00 / 3:00r', reps(2, 'time', 30 * MIN, 3 * MIN, { strokeRate: 20, hrZone: 1 }), 'steady-state', 'Two half-hour UT2 pieces with a short break. Keep the second piece at the same pace as the first.'),

  /* ── threshold ── */
  intervals('4x2k', '4 × 2000m / 5:00r', reps(4, 'distance', 2000, 5 * MIN, { strokeRate: 26, hrZone: 3 }), 'threshold', 'Anaerobic-threshold classic. Each 2k at about 2k test pace + 8–10s, rate 24–28. Aim to hold every rep within a second of the first.'),
  intervals('3x10', '3 × 10:00 / 3:00r', reps(3, 'time', 10 * MIN, 3 * MIN, { strokeRate: 26, hrZone: 3 }), 'threshold', 'Threshold work at AT intensity (zone 3), rate 24–26. Hard but controlled — you should finish each piece able to do one more.'),
  intervals('3x20', '3 × 20:00 / 3:00r', reps(3, 'time', 20 * MIN, 3 * MIN, { strokeRate: 24, hrZone: 3 }), 'threshold', 'Long threshold intervals at the top of zone 2 / bottom of zone 3, rate 22–24. Hold the same split in all three.'),
  intervals('2x5k', '2 × 5000m / 5:00r', reps(2, 'distance', 5000, 5 * MIN, { strokeRate: 24, hrZone: 3 }), 'threshold', 'Two 5k pieces at 5k test pace + 3–5s. Teaches sustained pressure; negative split the second piece.'),
  intervals('6x1k-thr', '6 × 1000m / 2:00r', reps(6, 'distance', 1000, 2 * MIN, { strokeRate: 26, hrZone: 3 }), 'threshold', 'Short-rest kilometres around 6k pace. The short rest keeps HR up; keep every rep identical.'),
  time('thr-30-r24', '30:00 r24', 30 * MIN, 'threshold', 'Continuous 30 minutes at threshold, capped at rate 24. Long powerful strokes, even splits.', { splitValue: 5 * MIN, target: { strokeRate: 24, hrZone: 3 } }),
  intervals('8x5', '8 × 5:00 / 1:00r', reps(8, 'time', 5 * MIN, MIN, { strokeRate: 26, hrZone: 3 }), 'threshold', 'Eight five-minute pieces with one minute rest at threshold pace. Builds the ability to hold race-ish pace for a long time.'),

  /* ── VO2max ── */
  intervals('8x500', '8 × 500m / 2:00r', reps(8, 'distance', 500, 2 * MIN, { strokeRate: 32, hrZone: 5 }), 'vo2max', 'Classic VO2max session. Each 500m at 2k pace or a second quicker, rate 30–34. Same split every rep.'),
  intervals('4x1k', '4 × 1000m / 5:00r', reps(4, 'distance', 1000, 5 * MIN, { strokeRate: 30, hrZone: 4 }), 'vo2max', 'Race-pace kilometres at 2k pace + 1–3s, rate 28–32. Long rest so the quality stays high.'),
  intervals('5x1500', '5 × 1500m / 5:00r', reps(5, 'distance', 1500, 5 * MIN, { strokeRate: 28, hrZone: 4 }), 'vo2max', 'Transport-zone work at 2k pace + 4–6s, rate 26–30. Tough; pace the first rep conservatively.'),
  intervals('5x3', '5 × 3:00 / 3:00r', reps(5, 'time', 3 * MIN, 3 * MIN, { strokeRate: 30, hrZone: 5 }), 'vo2max', 'Three-minute efforts at roughly 2k pace with equal rest. Maximise metres while keeping every rep the same.'),
  intervals('6x750', '6 × 750m / 2:30r', reps(6, 'distance', 750, 150 * S, { strokeRate: 30, hrZone: 5 }), 'vo2max', 'Hard 750s at 2k pace. Quick start, settle by 150m, hold the split to the end.'),
  intervals('pyramid-time', 'Pyramid 1-2-3-4-3-2-1', [1, 2, 3, 4, 3, 2, 1].map((m, i, a) => ({ type: 'time' as const, value: m * MIN, restMs: i === a.length - 1 ? 0 : Math.max(MIN, (m * MIN) / 2) })), 'vo2max', 'Time pyramid (1 to 4 minutes and back) with rest of half the work, at least a minute. Shorter steps are faster: 1:00 at 1k pace, 4:00 at 2k pace.'),

  /* ── sprint ── */
  intervals('10x1', '10 × 1:00 / 1:00r', reps(10, 'time', MIN, MIN, { strokeRate: 34, hrZone: 5 }), 'sprint', 'Ten hard minutes with equal rest, at 500m–1k pace, rate 32–36. Do not go out so hard that the last three die.'),
  intervals('30-30', '20 × 0:30 / 0:30r', reps(20, 'time', 30 * S, 30 * S, { strokeRate: 34 }), 'sprint', 'Thirty-thirties: 30 seconds hard (around 2k pace minus 2s), 30 seconds easy rest. Twenty reps; hold the split.'),
  intervals('tabata', 'Tabata 8 × 0:20 / 0:10r', reps(8, 'time', 20 * S, 10 * S, { strokeRate: 38 }), 'sprint', 'Tabata-style: eight rounds of 20 seconds all-out and 10 seconds rest. Four minutes of real hurt — warm up thoroughly first.'),
  intervals('8x250', '8 × 250m / 1:30r', reps(8, 'distance', 250, 90 * S, { strokeRate: 38 }), 'sprint', 'Speed endurance: 250m sprints at faster than 500m pace, rate 36–40, with 90 seconds rest. Explosive starts.'),
  intervals('10x100', '10 × 100m / 1:00r', reps(10, 'distance', 100, MIN, { strokeRate: 42 }), 'sprint', 'Pure speed: ten flat-out 100m sprints with a minute to recover. Practise your racing start each time.'),
  intervals('pyramid-dist', 'Pyramid 250-500-750-1000-750-500-250', [250, 500, 750, 1000, 750, 500, 250].map((m, i, a) => ({ type: 'distance' as const, value: m, restMs: i === a.length - 1 ? 0 : 90 * S + m * 60 })), 'sprint', 'Distance pyramid with rest growing with the rep. The 250s are near-max, the 1000 at 2k pace; mirror your splits on the way down.'),

  /* ── technique ── */
  time('rate-ladder', 'Rate ladder 18-28', 24 * MIN, 'technique', 'Continuous 24 minutes: four minutes at each rate from 18 to 28. Keep the same length and ratio as the rate rises — change speed only on the drive.', { splitValue: 4 * MIN, segments: rateSegs(4 * MIN, [18, 20, 22, 24, 26, 28]) }),
  time('rate-pyramid', 'Rate pyramid 20-26-20', 14 * MIN, 'technique', 'Two minutes each at rates 20, 22, 24, 26 and back down. Hit each rate exactly; a quicker rate should mean more speed, not shorter strokes.', { splitValue: 2 * MIN, segments: rateSegs(2 * MIN, [20, 22, 24, 26, 24, 22, 20]) }),
  intervals('pause-drill', '10 × 2:00 r18 / 1:00r', reps(10, 'time', 2 * MIN, MIN, { strokeRate: 18 }), 'technique', 'Low-rate control work. Row at rate 18 with a slow, patient recovery (1:2 ratio or more) and a crisp catch. Add a pause at hands-away if you like.'),
  time('tech-20-r18', '20:00 technique r18', 20 * MIN, 'technique', 'Twenty minutes at rate 18 focusing on one thing at a time: catch, connection, finish, recovery. Listen to the coxswain’s technique calls.', { splitValue: 5 * MIN, target: { strokeRate: 18, hrZone: 1 } }),
  intervals('ratio-6x5', '6 × 5:00 r20 / 1:00r', reps(6, 'time', 5 * MIN, MIN, { strokeRate: 20 }), 'technique', 'Ratio work: fixed rate 20, push hard on the drive and take your time on the recovery. Watch the split drop as power per stroke rises.'),

  /* ── warm-ups ── */
  time('wu-10', '10:00 easy warm-up', 10 * MIN, 'warmup', 'Gentle ten minutes, rate 18–20, building from arms only to full slide.', { splitValue: 2 * MIN, target: { strokeRate: 20, hrZone: 1 } }),
  time('wu-5', '5:00 quick warm-up', 5 * MIN, 'warmup', 'Short warm-up before a steady session: easy pressure, rate 20.', { splitValue: MIN, target: { strokeRate: 20 } }),
  time('wu-progressive', 'Progressive warm-up 15:00', 15 * MIN, 'warmup', 'Fifteen continuous minutes building rate and pressure: 18, 20, 22, then 24. Ends ready for a hard session.', {
    splitValue: 5 * MIN,
    segments: [{ duration: 5 * MIN, strokeRate: 18 }, { duration: 5 * MIN, strokeRate: 20 }, { duration: 3 * MIN, strokeRate: 22 }, { duration: 2 * MIN, strokeRate: 24 }],
  }),
  intervals('wu-race', 'Pre-race warm-up', [
    { type: 'time', value: 8 * MIN, restMs: MIN, target: { strokeRate: 20 } },
    { type: 'time', value: 3 * MIN, restMs: MIN, target: { strokeRate: 24 } },
    { type: 'time', value: 30 * S, restMs: MIN, target: { strokeRate: 32 } },
    { type: 'time', value: 30 * S, restMs: MIN, target: { strokeRate: 34 } },
    { type: 'time', value: 20 * S, restMs: 0, target: { strokeRate: 36 } },
  ], 'warmup', 'Before a 2k test: 8 minutes easy, 3 minutes firmer, then three short bursts at race rate including a practice start. Finish 5–10 minutes before the test.'),
];

/** Home "Standard pieces" defaults; ids match DEFAULT_SETTINGS.homeWorkoutIds. */
export const QUICK_WORKOUTS: WorkoutPlan[] = [
  ...[500, 1000, 2000, 5000, 6000, 10000].map((m) => quick('single-distance', m, `${m >= 1000 ? m / 1000 + 'k' : m + 'm'}`)),
  ...[20, 30, 60].map((min) => quick('single-time', min * MIN, `${min}:00`)),
];

function quick(kind: 'single-distance' | 'single-time', value: number, name: string): WorkoutPlan {
  const splitValue = kind === 'single-distance' ? (value >= 5000 ? 1000 : value >= 1000 ? 500 : 100) : value >= 30 * MIN ? 5 * MIN : MIN;
  return { id: `quick-${kind}-${value}`, name, kind, value, splitValue, category: value === 2000 ? 'test' : 'custom' };
}
