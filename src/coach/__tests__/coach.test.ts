import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, emptyMetrics } from '@/core/defaults';
import type { CoxCall, CoxswainSettings, ForceCurveAnalysis, LiveMetrics, StrokeSample, TechniqueFlag, WorkoutPlan } from '@/core/types';
import { Coxswain, mulberry32, sampleCalls } from '../engine';
import { buildPacePlan, planAveragePace, segmentAt } from '../pacePlan';
import { computePaceBoat, PaceProfile } from '../paceBoat';
import { FREQUENCY_GAP_MS } from '../scheduler';
import { speakClock, speakMetres, speakPace } from '../speech';
import { fill, PHRASES, PhraseBook, TECHNIQUE_CUES, type PhraseKey } from '../phrases';

const settings = (p: Partial<CoxswainSettings> = {}): CoxswainSettings => ({ ...DEFAULT_SETTINGS.coxswain, ...p });
const profile = { ...DEFAULT_SETTINGS.profile, maxHeartRate: 190 };

function analysis(flags: TechniqueFlag[]): ForceCurveAnalysis {
  return { valid: true, peakForceN: 600, avgForceN: 400, peakPosition: 0.4, fullness: 0.7, smoothness: 0.9, riseFraction: 0.2, impulseNs: 300, shape: 'ideal', flags, score: 80 };
}

/** Rows strokes at a pace; feeds metrics + stroke each stroke. */
class Rower {
  t = 0;
  d = 0;
  n = 0;
  constructor(private cox: Coxswain, private base: Partial<LiveMetrics> = {}) {}
  row(count: number, pace: number, opts: { rate?: number; flags?: TechniqueFlag[]; hr?: number; interval?: number } = {}) {
    const rate = opts.rate ?? 30;
    const dt = 60000 / rate;
    for (let i = 0; i < count; i++) {
      this.t += dt;
      const sd = (dt / pace) * 500;
      this.d += sd;
      this.n += 1;
      const m: LiveMetrics = { ...emptyMetrics(), ...this.base, elapsedMs: this.t, distanceM: this.d, paceMsPer500: pace, avgPaceMsPer500: (this.t / this.d) * 500, strokeRate: rate, heartRate: opts.hr ?? null, workoutState: 'workout-row', rowingState: 'active', intervalCount: opts.interval ?? 0 };
      this.cox.onMetrics(m);
      const s: StrokeSample = { strokeNumber: this.n, elapsedMs: this.t, distanceM: this.d, paceMsPer500: pace, watts: 200, strokeRate: rate, heartRate: null, driveLengthM: 1.4, driveTimeMs: dt / 3, recoveryTimeMs: (dt * 2) / 3, strokeDistanceM: sd, peakForceN: 600, avgForceN: 400, workPerStrokeJ: 600, intervalCount: opts.interval ?? 0, forceCurve: [] };
      this.cox.onStroke(s, analysis(opts.flags ?? []));
    }
  }
}

function collect(cox: Coxswain): CoxCall[] {
  const calls: CoxCall[] = [];
  cox.subscribe((c) => calls.push(c));
  return calls;
}

const twoK: WorkoutPlan = { id: 'p', name: '2k', kind: 'single-distance', value: 2000, category: 'test', target: { paceMsPer500: 110000 } };

describe('speech', () => {
  it('speaks numbers TTS-friendly', () => {
    expect(speakPace(112300)).toBe('one fifty-two');
    expect(speakPace(125000)).toBe('two oh five');
    expect(speakPace(120000)).toBe('two flat');
    expect(speakMetres(250)).toBe('two fifty');
    expect(speakMetres(1500)).toBe('fifteen hundred');
    expect(speakMetres(1250)).toBe('twelve fifty');
    expect(speakClock(418400)).toBe('six fifty-eight point four');
    expect(speakClock(420400)).toBe('seven oh oh point four');
    expect(fill('{diff} over. You are {diff} slow.', { diff: 'two seconds' })).toBe('Two seconds over. You are two seconds slow.');
  });
  it('keeps calls short, varied and distinct per personality', () => {
    const words = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w)).length;
    for (const bank of Object.values(PHRASES)) {
      for (const [k, list] of Object.entries(bank)) {
        expect(list.length, k).toBeGreaterThanOrEqual(k === 'safety' ? 2 : 3);
        for (const p of list) expect(words(p), p).toBeLessThanOrEqual(9);
      }
    }
    for (const v of Object.values(TECHNIQUE_CUES)) {
      for (const list of Object.values(v.cues)) for (const c of list) expect(words(c), c).toBeLessThanOrEqual(9);
    }
    const CORRECTIVE: PhraseKey[] = ['over', 'under', 'tooHot', 'overOwn', 'powerTen', 'rateUp', 'rateDown', 'hrHigh', 'hrLow', 'safety', 'repSlower', 'improved'];
    for (const bank of Object.values(PHRASES)) for (const k of CORRECTIVE) expect(bank[k].length, k).toBeGreaterThanOrEqual(k === 'improved' ? 4 : 4);
    for (const k of Object.keys(PHRASES.calm) as PhraseKey[]) {
      const all = [PHRASES.calm[k], PHRASES.encouraging[k], PHRASES.race[k]].flat();
      expect(new Set(all).size, k).toBe(all.length);
    }
    expect(sampleCalls('race')).toHaveLength(5);
    expect(sampleCalls('calm')).not.toEqual(sampleCalls('race'));
  });
  it('uses every variant once before repeating, never twice in a row', () => {
    const book = new PhraseBook('calm', mulberry32(5));
    const n = PHRASES.calm.motivation.length;
    const got = Array.from({ length: n * 5 }, () => book.say('motivation'));
    for (let r = 0; r < 5; r++) expect(new Set(got.slice(r * n, r * n + n)).size).toBe(n);
    for (let i = 1; i < got.length; i++) expect(got[i]).not.toBe(got[i - 1]);
  });
});

describe('timing rules', () => {
  it('2k: no technique in the first 10 strokes, only race calls in the last 250 m', () => {
    const cox = new Coxswain({ settings: settings({ frequency: 'chatty' }), profile, plan: twoK, seed: 4 });
    const r = new Rower(cox);
    const at: { c: CoxCall; d: number; n: number }[] = [];
    cox.subscribe((c) => at.push({ c, d: r.d, n: r.n }));
    r.row(194, 110000, { flags: ['slow-catch'] }); // to ~1764 m on target
    r.row(30, 104000, { flags: ['slow-catch'] }); // sprint well under target pace
    cox.onWorkoutEnd(null);
    const tech = at.filter((x) => x.c.category === 'technique');
    expect(tech.length).toBeGreaterThan(0);
    expect(tech.every((x) => x.n > 10 && x.d < 1750)).toBe(true);
    const finish = at.filter((x) => x.d >= 1750);
    expect(finish.length).toBeGreaterThan(0);
    expect(finish.every((x) => x.c.category === 'race-plan' || x.c.category === 'info')).toBe(true);
  });

  it('never calls a settle in a sprint', () => {
    const plan: WorkoutPlan = { id: 's', name: '500', kind: 'single-distance', value: 500, category: 'sprint' };
    const cox = new Coxswain({ settings: settings({ personality: 'race' }), profile, plan });
    const calls = collect(cox);
    new Rower(cox).row(55, 100000, { rate: 36 });
    expect(calls.length).toBeGreaterThan(0);
    const settles = [...PHRASES.race.settle, ...PHRASES.race.settleSteady, ...PHRASES.race.startHigh].map((p) => fill(p, { pace: speakPace(100000) }));
    expect(calls.some((c) => settles.includes(c.text))).toBe(false);
  });

  it('repeatForever: rep numbers without a total, no last-rep calls, rest calls only in rest', () => {
    const plan: WorkoutPlan = { id: 'f', name: 'x', kind: 'intervals', category: 'vo2max', repeatForever: true, intervals: [{ type: 'distance', value: 500, restMs: 60000 }] };
    const cox = new Coxswain({ settings: settings(), profile, plan });
    const calls = collect(cox);
    const r = new Rower(cox);
    const rests: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      r.row(53, 105000, { interval: k });
      cox.onSplit({ index: k, type: 'distance', elapsedMs: r.t, distanceM: 500, splitTimeMs: 105000, splitDistanceM: 500, restTimeMs: 60000, restDistanceM: 0, avgPaceMsPer500: 105000, avgWatts: 300, avgStrokeRate: 30, avgHeartRate: null, restHeartRate: null, avgDragFactor: 120, calories: 30, strokeCount: 53 });
      if (k === 2) break;
      const start = r.t;
      for (let rem = 60000; rem >= 0; rem -= 1000) {
        r.t += 1000;
        cox.onMetrics({ ...emptyMetrics(), elapsedMs: r.t, distanceM: r.d, workoutState: 'interval-rest', restTimeRemainingMs: rem, intervalCount: k + 1 });
      }
      rests.push([start, r.t]);
    }
    cox.onWorkoutEnd(null);
    const texts = calls.map((c) => c.text);
    expect(texts.some((t) => /^rep three|rep three[.!,]/i.test(t))).toBe(true);
    expect(texts.some((t) => /rep three next/i.test(t))).toBe(true);
    expect(texts.some((t) => /rep \w+ of /i.test(t))).toBe(false);
    const lastRep = Object.values(PHRASES).flatMap((b) => b.lastRep);
    expect(texts.some((t) => lastRep.some((p) => t.startsWith(p)))).toBe(false);
    expect(texts[texts.length - 1]).toMatch(/three reps/i);
    const inRest = (c: CoxCall) => rests.some(([a, b]) => c.elapsedMs > a && c.elapsedMs <= b);
    expect(calls.filter(inRest).every((c) => c.category === 'race-plan')).toBe(true);
    expect(calls.filter((c) => /next:|sit ready|come forward/i.test(c.text)).every(inRest)).toBe(true);
  });
});

describe('race plan + pacing', () => {
  it('runs a 2k: start, off-pace, milestones, sprint, finish', () => {
    const cox = new Coxswain({ settings: settings(), profile, plan: twoK, seed: 3 });
    const calls = collect(cox);
    const r = new Rower(cox);
    r.row(40, 110000);
    r.row(25, 114000); // 4 s over target
    r.row(156, 110000);
    cox.onWorkoutEnd(null);
    const texts = calls.map((c) => c.text.toLowerCase());
    expect(calls[0]!.category).toBe('race-plan');
    expect(calls[0]!.priority).toBe(3);
    expect(calls.some((c) => c.category === 'pacing' && /over|down|off|slow/i.test(c.text) && c.text.includes('one fifty'))).toBe(true);
    expect(texts.some((t) => t.includes('halfway'))).toBe(true);
    expect(texts.some((t) => t.includes('two fifty'))).toBe(true);
    expect(texts.some((t) => /(last|final) ten|ten strokes|ten to go/.test(t))).toBe(true);
    expect(calls[calls.length - 1]!.text).toMatch(/for two thousand.* metres, average/);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const cox = new Coxswain({ settings: settings(), profile, plan: twoK, seed: 9 });
      const calls = collect(cox);
      new Rower(cox).row(120, 112000);
      return calls.map((c) => c.text);
    };
    expect(run()).toEqual(run());
  });

  it('mutes, and respects frequency gaps for ordinary calls', () => {
    const muted = new Coxswain({ settings: settings(), profile, plan: twoK });
    const none = collect(muted);
    muted.setMuted(true);
    new Rower(muted).row(100, 110000);
    expect(none).toHaveLength(0);

    const cox = new Coxswain({ settings: settings({ frequency: 'normal' }), profile, plan: null });
    const calls = collect(cox);
    const r = new Rower(cox);
    for (let i = 0; i < 20; i++) r.row(20, i % 2 ? 105000 : 125000, { flags: i % 3 ? ['slow-catch'] : [] });
    const gap = FREQUENCY_GAP_MS.normal;
    for (let i = 1; i < calls.length; i++) {
      const c = calls[i]!;
      if (c.priority === 1 && c.category !== 'race-plan') expect(c.elapsedMs - calls[i - 1]!.elapsedMs).toBeGreaterThanOrEqual(gap);
    }
  });

  it('calls the HR safety warning above max', () => {
    const cox = new Coxswain({ settings: settings(), profile, plan: twoK });
    const calls = collect(cox);
    new Rower(cox).row(30, 110000, { hr: 195 });
    expect(calls.some((c) => c.category === 'safety' && c.priority === 3)).toBe(true);
  });
});

describe('call limits and toggles', () => {
  const tech = (calls: CoxCall[]) => calls.filter((c) => c.category === 'technique');
  it('gives a final warning at the cap, retires the fault, then still acknowledges the fix', () => {
    const cox = new Coxswain({ settings: settings({ maxCuesPerFault: 2 }), profile, plan: null, seed: 2 }); // steady: cap 1
    const calls = collect(cox);
    const r = new Rower(cox);
    r.row(14, 120000, { rate: 22 });
    r.row(10, 120000, { rate: 22, flags: ['slow-catch'] });
    expect(tech(calls)).toHaveLength(1);
    expect(tech(calls)[0]!.text).toMatch(/^(Last|Final|I will not|Not saying)/i);
    r.row(60, 120000, { rate: 22, flags: ['slow-catch'] });
    expect(tech(calls)).toHaveLength(1); // retired: silence
    r.row(14, 120000, { rate: 22 });
    expect(tech(calls)).toHaveLength(2);
    expect(tech(calls)[1]!.text).toMatch(/catch|fixed|change|fix/i);
  });
  it('final warnings stay speakable for every fault and personality', () => {
    for (const p of ['calm', 'encouraging', 'race'] as const) {
      const book = new PhraseBook(p, mulberry32(1));
      for (const f of Object.keys(TECHNIQUE_CUES) as TechniqueFlag[]) for (let i = 0; i < 6; i++) expect(book.finalCue(f).split(/s+/).length, f).toBeLessThanOrEqual(12);
    }
  });
  it('never cues muted faults', () => {
    const cox = new Coxswain({ settings: settings({ mutedFlags: ['slow-catch'] }), profile, plan: null, seed: 2 });
    const calls = collect(cox);
    const r = new Rower(cox);
    r.row(14, 120000, { rate: 22 });
    r.row(40, 120000, { rate: 22, flags: ['slow-catch'] });
    expect(tech(calls)).toHaveLength(0);
  });
  it('makes no rate calls unless rateCalls is on', () => {
    const plan: WorkoutPlan = { ...twoK, target: { paceMsPer500: 110000, strokeRate: 28 } };
    for (const rateCalls of [false, true]) {
      const cox = new Coxswain({ settings: settings({ rateCalls }), profile, plan, seed: 2 });
      const calls = collect(cox);
      new Rower(cox).row(60, 110000, { rate: 20 });
      expect(calls.some((c) => c.category === 'rate'), String(rateCalls)).toBe(rateCalls);
    }
  });
  it('steady pieces use their own motivation lines, never the race ones', () => {
    const cox = new Coxswain({ settings: settings({ frequency: 'chatty', personality: 'calm' }), profile, plan: { ...twoK, category: 'steady-state', target: { paceMsPer500: 120000 } }, seed: 3 });
    const calls = collect(cox);
    new Rower(cox).row(200, 120000, { rate: 20 });
    const mot = calls.filter((c) => c.category === 'motivation').map((c) => c.text);
    expect(mot.length).toBeGreaterThan(0);
    const steady = [...PHRASES.calm.motivationSteady, ...PHRASES.calm.motivationLate, ...PHRASES.calm.focus];
    expect(mot.every((t) => steady.includes(t))).toBe(true);
  });
  it('steady pieces with a set pace keep reminding, with no last call', () => {
    const cox = new Coxswain({ settings: settings({ maxCuesPerFault: 2, frequency: 'chatty' }), profile, plan: { ...twoK, category: 'steady-state', target: { paceMsPer500: 120000 } }, seed: 2 });
    const calls = collect(cox);
    new Rower(cox).row(200, 126000, { rate: 20 });
    const pacing = calls.filter((c) => c.category === 'pacing');
    expect(pacing.length).toBeGreaterThan(2);
    expect(pacing.some((c) => /last call|final reminder|not nagging|once more/i.test(c.text))).toBe(false);
  });
});

describe('technique', () => {
  it('has 4+ distinct cues per personality for every flag', () => {
    const flags = Object.keys(TECHNIQUE_CUES) as TechniqueFlag[];
    expect(flags).toHaveLength(15);
    for (const f of flags) for (const p of ['calm', 'encouraging', 'race'] as const) {
      const c = TECHNIQUE_CUES[f].cues[p];
      expect(new Set(c).size, `${f}/${p}`).toBe(c.length);
      expect(c.length, `${f}/${p}`).toBeGreaterThanOrEqual(4);
    }
  });
  // Stroke-by-stroke rower with mechanics the analysis module does not flag per stroke.
  const driftRow = (cox: Coxswain, n: number, o: { len?: number; work?: number; rate?: number; dist?: number; rec?: number } = {}, t0 = 0) => {
    let t = t0;
    for (let i = 0; i < n; i++) {
      const rate = o.rate ?? 22;
      const dt = 60000 / rate;
      t += dt;
      const dist = o.dist ?? 10.5;
      const jitter = o.dist === undefined ? 0 : i % 2 ? 1.5 : -1.5;
      cox.onMetrics({ ...emptyMetrics(), elapsedMs: t, distanceM: 0, paceMsPer500: 120000, strokeRate: rate, workoutState: 'workout-row', rowingState: 'active' });
      cox.onStroke({ strokeNumber: i, elapsedMs: t, distanceM: i * 10, paceMsPer500: 120000, watts: 150, strokeRate: rate, heartRate: null, driveLengthM: o.len ?? 1.4, driveTimeMs: dt / (1 + (o.rec ?? 2)), recoveryTimeMs: (dt * (o.rec ?? 2)) / (1 + (o.rec ?? 2)), strokeDistanceM: dist + jitter, peakForceN: 600, avgForceN: 400, workPerStrokeJ: o.work ?? 600, intervalCount: 0, forceCurve: [] }, null);
    }
    return t;
  };
  const cases: [TechniqueFlag, Parameters<typeof driftRow>[2]][] = [
    ['short-stroke', { len: 1.2 }],
    ['low-power-per-stroke', { work: 400 }],
    ['rate-too-high', { rate: 27 }],
    ['rate-too-low', { rate: 18 }],
    ['inconsistent-strokes', { dist: 10.5 }],
    ['slow-recovery', { rec: 5 }],
  ];
  for (const [flag, drift] of cases) {
    it(`derives ${flag} from stroke data and cues it`, () => {
      const cox = new Coxswain({ settings: settings({ rateCalls: true }), profile, plan: null, seed: 3 });
      const calls = collect(cox);
      const t = driftRow(cox, 16);
      driftRow(cox, 16, drift, t);
      expect(calls.some((c) => c.category === 'technique' && c.flag === flag)).toBe(true);
    });
  }

  it('holds a free row to its own average only in Race style', () => {
    for (const style of ['race', 'training'] as const) {
      const cox = new Coxswain({ settings: settings({ style, personality: style === 'race' ? 'race' : 'calm' }), profile, plan: null, seed: 4 });
      const calls = collect(cox);
      const r = new Rower(cox);
      r.row(40, 120000, { rate: 22 });
      r.row(12, 130000, { rate: 22 }); // ten seconds slower than the average
      expect(calls.some((c) => c.category === 'pacing'), style).toBe(style === 'race');
    }
  });

  it('cues a persistent flag once, then confirms the improvement', () => {
    const cox = new Coxswain({ settings: settings(), profile, plan: null, seed: 2 });
    const calls = collect(cox);
    const r = new Rower(cox);
    r.row(14, 120000, { rate: 22 });
    r.row(4, 120000, { rate: 22, flags: ['slow-catch'] }); // 4/10: not yet persistent
    expect(calls.filter((c) => c.category === 'technique')).toHaveLength(0);
    r.row(10, 120000, { rate: 22, flags: ['slow-catch'] });
    const cue = calls.filter((c) => c.category === 'technique');
    expect(cue).toHaveLength(1);
    expect(cue[0]!.flag).toBe('slow-catch');
    r.row(12, 120000, { rate: 22 });
    const tech = calls.filter((c) => c.category === 'technique');
    expect(tech).toHaveLength(2);
    expect(tech[1]!.text).toMatch(/catch/);
  });
});

describe('intervals', () => {
  it('counts down the rest and announces the next rep', () => {
    const plan: WorkoutPlan = { id: 'i', name: 'x', kind: 'intervals', category: 'vo2max', intervals: [
      { type: 'distance', value: 500, restMs: 60000, target: { paceMsPer500: 105000 } },
      { type: 'distance', value: 500, restMs: 0, target: { paceMsPer500: 105000 } },
    ] };
    const cox = new Coxswain({ settings: settings(), profile, plan });
    const calls = collect(cox);
    const r = new Rower(cox);
    r.row(52, 105000, { interval: 0 });
    cox.onSplit({ index: 0, type: 'distance', elapsedMs: r.t, distanceM: 500, splitTimeMs: 105000, splitDistanceM: 500, restTimeMs: 60000, restDistanceM: 0, avgPaceMsPer500: 105000, avgWatts: 300, avgStrokeRate: 30, avgHeartRate: null, restHeartRate: null, avgDragFactor: 120, calories: 30, strokeCount: 52 });
    for (let rem = 60000; rem >= 0; rem -= 1000) {
      r.t += 1000;
      cox.onMetrics({ ...emptyMetrics(), elapsedMs: r.t, distanceM: r.d, workoutState: 'interval-rest', restTimeRemainingMs: rem, intervalCount: 1 });
    }
    r.row(5, 105000, { interval: 1 });
    const texts = calls.map((c) => c.text);
    expect(texts.some((t) => /rep one/i.test(t))).toBe(true);
    expect(texts.some((t) => /rep two next: five hundred metres at one forty-five/i.test(t))).toBe(true);
    expect(texts.some((t) => /^ten/i.test(t))).toBe(true);
    expect(texts.some((t) => /last|final/i.test(t) && /target one forty-five/i.test(t))).toBe(true);
  });
});

describe('pace plans', () => {
  for (const strategy of ['even', 'negative-split', 'fast-start-settle-sprint'] as const) {
    it(`${strategy} averages exactly the goal (distance and time)`, () => {
      const d = buildPacePlan({ kind: 'distance', value: 2000, goalPaceMsPer500: 105000, strategy });
      expect(planAveragePace(d.segments, 'distance')).toBeCloseTo(105000, 6);
      expect(new PaceProfile('distance', d.segments.map((s) => ({ len: (s.endFraction - s.startFraction) * 2000, pace: s.targetPaceMsPer500, label: s.label }))).timeAtDistance(2000)).toBeCloseTo(420000, 3);
      const t = buildPacePlan({ kind: 'time', value: 1800000, goalPaceMsPer500: 120000, strategy });
      const boat = PaceProfile.fromSegments('time', 1800000, t.segments);
      expect(boat.distanceAtTime(1800000)).toBeCloseTo(7500, 6);
    });
  }
  it('fast-start plan: start fast, settle above goal, sprint', () => {
    const p = buildPacePlan({ kind: 'distance', value: 2000, goalPaceMsPer500: 105000, strategy: 'fast-start-settle-sprint' });
    expect(segmentAt(p, 0).label).toBe('Start');
    expect(segmentAt(p, 0.3).targetPaceMsPer500).toBeGreaterThan(105000);
    expect(segmentAt(p, 0.95).targetPaceMsPer500).toBeLessThan(105000);
    expect(segmentAt(p, 1.2).label).toBe('Sprint');
  });
});

describe('pace boat', () => {
  it('computes gaps for a constant target', () => {
    const plan: WorkoutPlan = { ...twoK, target: { paceMsPer500: 120000 } };
    const b = computePaceBoat(plan, { ...emptyMetrics(), distanceM: 1000, elapsedMs: 236000 })!;
    expect(b.gapMs).toBeCloseTo(4000, 6);
    expect(b.gapM).toBeCloseTo(1000 - (236000 * 500) / 120000, 6);
    expect(computePaceBoat({ ...twoK, target: undefined }, emptyMetrics())).toBeNull();
  });
  it('integrates pace-plan segments rather than averaging', () => {
    const pacePlan = buildPacePlan({ kind: 'distance', value: 2000, goalPaceMsPer500: 105000, strategy: 'fast-start-settle-sprint' });
    const plan: WorkoutPlan = { ...twoK, target: undefined, pacePlan };
    const s0 = pacePlan.segments[0]!;
    const startMs = (100 * s0.targetPaceMsPer500) / 500; // boat time over the 100 m start segment
    const b = computePaceBoat(plan, { ...emptyMetrics(), distanceM: 100, elapsedMs: startMs })!;
    expect(b.gapMs).toBeCloseTo(0, 6);
    expect(b.label).toBe('Settle');
  });
});
