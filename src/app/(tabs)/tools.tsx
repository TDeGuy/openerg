import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { dragFactorAdvice, predictRaces, trainingZones, weightAdjustedDistance, weightAdjustedTime } from '@/analysis';
import { buildPacePlan } from '@/coach';
import { calPerHourToWatts, solveTimeDistancePace, type SolveKey } from '@/components/analysis/helpers';
import { Field, InsightList, Table } from '@/components/analysis/ui';
import type { MachineType, PaceStrategy, RacePrediction, TrainingZone } from '@/core/types';
import {
  formatDistance,
  formatDuration,
  formatPace,
  paceToWatts,
  parseDuration,
  wattsToCalPerHour,
  wattsToCalPerHourForWeight,
  wattsToPace,
} from '@/core/units';
import { useSettings } from '@/storage/settings';
import { Button, Card, Screen, SectionTitle, Segmented, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

const TIME_KB = 'numbers-and-punctuation' as const;
const numOrNaN = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : NaN);

export default function ToolsScreen() {
  return (
    <Screen>
      <Text size="xxl" weight="700">
        Tools
      </Text>
      <PaceWatts />
      <Solver />
      <Predictor />
      <Zones />
      <SplitPlanner />
      <WeightAdjust />
      <DragGuide />
    </Screen>
  );
}

/* ───────── Pace ⇄ watts ⇄ cal/h ───────── */

function PaceWatts() {
  const weight = useSettings((s) => s.settings.profile.weightKg);
  const [src, setSrc] = useState<'pace' | 'watts' | 'cal'>('pace');
  const [text, setText] = useState('2:00');
  const watts = useMemo(() => {
    if (src === 'pace') return paceToWatts(parseDuration(text));
    const v = numOrNaN(text);
    if (!(v > 0)) return 0;
    return src === 'watts' ? v : calPerHourToWatts(v);
  }, [src, text]);
  const show = (k: typeof src, computed: string) => (src === k ? text : watts > 0 ? computed : '');
  const edit = (k: typeof src) => (v: string) => {
    setSrc(k);
    setText(v);
  };
  return (
    <Card>
      <SectionTitle>Pace · watts · calories</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Field flex label="Pace /500m" value={show('pace', formatPace(wattsToPace(watts)))} onChangeText={edit('pace')} keyboardType={TIME_KB} placeholder="2:00.0" />
        <Field flex label="Watts" value={show('watts', watts.toFixed(0))} onChangeText={edit('watts')} keyboardType="numeric" placeholder="203" />
        <Field flex label="Cal/hour" value={show('cal', wattsToCalPerHour(watts).toFixed(0))} onChangeText={edit('cal')} keyboardType="numeric" placeholder="999" />
      </View>
      {watts > 0 && weight ? (
        <Text size="sm" tone="dim">
          At your weight ({weight} kg): {wattsToCalPerHourForWeight(watts, weight).toFixed(0)} kcal/h · {(watts / weight).toFixed(2)} W/kg
        </Text>
      ) : null}
      <Text size="xs" tone="faint">
        Concept2 formulas: watts = 2.80 / (sec per metre)³; the PM's cal/h assumes a 175 lb rower.
      </Text>
    </Card>
  );
}

/* ───────── Time / distance / pace solver ───────── */

function Solver() {
  const [vals, setVals] = useState<Record<SolveKey, string>>({ time: '', distance: '', pace: '' });
  const [order, setOrder] = useState<SolveKey[]>([]);
  const target: SolveKey | null = order.length >= 2 ? (['time', 'distance', 'pace'] as SolveKey[]).find((k) => !order.slice(-2).includes(k)) ?? null : null;
  const solved = useMemo(() => {
    if (!target) return NaN;
    return solveTimeDistancePace(target, parseDuration(vals.time), numOrNaN(vals.distance), parseDuration(vals.pace));
  }, [target, vals]);
  const fmt = (k: SolveKey) => {
    if (k !== target) return vals[k];
    if (!Number.isFinite(solved)) return '';
    return k === 'distance' ? String(Math.round(solved)) : k === 'pace' ? formatPace(solved) : formatDuration(solved);
  };
  const edit = (k: SolveKey) => (v: string) => {
    setVals((s) => ({ ...s, [k]: v }));
    setOrder((o) => [...o.filter((x) => x !== k), k]);
  };
  return (
    <Card>
      <SectionTitle right={<Button title="Clear" variant="ghost" small onPress={() => { setVals({ time: '', distance: '', pace: '' }); setOrder([]); }} />}>
        Time · distance · pace
      </SectionTitle>
      <Text size="sm" tone="dim">
        Enter any two; the third is solved.
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Field flex label={target === 'time' ? 'Time =' : 'Time'} value={fmt('time')} onChangeText={edit('time')} keyboardType={TIME_KB} placeholder="7:30.0" />
        <Field flex label={target === 'distance' ? 'Metres =' : 'Metres'} value={fmt('distance')} onChangeText={edit('distance')} keyboardType="numeric" placeholder="2000" />
        <Field flex label={target === 'pace' ? 'Pace =' : 'Pace'} value={fmt('pace')} onChangeText={edit('pace')} keyboardType={TIME_KB} placeholder="1:52.5" />
      </View>
      {target === 'pace' && Number.isFinite(solved) ? (
        <Text size="sm" tone="dim">
          ≈ {paceToWatts(solved).toFixed(0)} W
        </Text>
      ) : null}
    </Card>
  );
}

/* ───────── Race predictor ───────── */

const REF_DISTANCES = [500, 1000, 2000, 5000, 6000, 10000, 21097];

function Predictor() {
  const ref2k = useSettings((s) => s.settings.profile.reference2kMs);
  const [dist, setDist] = useState('2000');
  const [time, setTime] = useState(ref2k ? formatDuration(ref2k) : '');
  const ms = parseDuration(time);
  const preds = useMemo(() => (ms > 0 ? predictRaces(Number(dist), ms) : []), [dist, ms]);
  return (
    <Card>
      <SectionTitle>Race predictor</SectionTitle>
      <Segmented value={dist} onChange={setDist} options={REF_DISTANCES.map((d) => ({ value: String(d), label: d === 21097 ? 'Half' : d >= 1000 ? `${d / 1000}k` : `${d}m` }))} />
      <Field label={`Your ${formatDistance(Number(dist))} time`} value={time} onChangeText={setTime} keyboardType={TIME_KB} placeholder="7:00.0" error={time && !(ms > 0) ? 'Use m:ss.t, e.g. 7:05.3' : null} />
      {preds.length > 0 ? (
        <Table<RacePrediction>
          rows={preds}
          columns={[
            { title: 'Event', align: 'left', render: (p) => p.label },
            { title: 'Time', flex: 1.2, render: (p) => formatDuration(p.predictedMs), tone: (p) => (p.distanceM === Number(dist) ? 'accent' : undefined) },
            { title: 'Pace', render: (p) => formatPace(p.paceMsPer500) },
            { title: 'W', flex: 0.6, render: (p) => p.watts.toFixed(0) },
          ]}
        />
      ) : null}
      <Text size="xs" tone="faint">
        Based on Paul's law (about +5 s/500m for each doubling of distance); accuracy drops for events far from your reference.
      </Text>
    </Card>
  );
}

/* ───────── Training zones ───────── */

function Zones() {
  const t = useTheme();
  const profile = useSettings((s) => s.settings.profile);
  const updateProfile = useSettings((s) => s.updateProfile);
  const zones = useMemo(() => trainingZones(profile), [profile]);
  const [text, setText] = useState('');
  const ms = parseDuration(text);
  return (
    <Card>
      <SectionTitle>Training zones</SectionTitle>
      {zones.length === 0 ? (
        <>
          <Text tone="dim">Training zones are built from your best (or current) 2k time. Enter it to see your zones.</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <Field flex label="Reference 2k" value={text} onChangeText={setText} keyboardType={TIME_KB} placeholder="7:30.0" />
            <Button title="Save" disabled={!(ms > 60000)} onPress={() => updateProfile({ reference2kMs: ms })} />
          </View>
        </>
      ) : (
        <>
          <Table<TrainingZone>
            rows={zones}
            columns={[
              { title: 'Zone', flex: 0.9, align: 'left', render: (z) => `${z.zone} ${z.name}`, tone: () => undefined },
              { title: 'Pace', flex: 1.7, render: (z) => `${formatPace(Math.min(z.paceMinMsPer500, z.paceMaxMsPer500))}–${formatPace(Math.max(z.paceMinMsPer500, z.paceMaxMsPer500))}` },
              { title: 'Watts', flex: 1.1, render: (z) => `${Math.round(Math.min(z.wattsMin, z.wattsMax))}–${Math.round(Math.max(z.wattsMin, z.wattsMax))}` },
              { title: 'HR', flex: 1, render: (z) => (z.hrMin != null && z.hrMax != null ? `${z.hrMin}–${z.hrMax}` : '–') },
              { title: 'spm', flex: 0.8, render: (z) => `${z.strokeRateMin}–${z.strokeRateMax}` },
            ]}
          />
          {zones.map((z) => (
            <Text key={z.zone} size="xs" tone="dim">
              <Text size="xs" weight="700" style={{ color: t.zones[z.zone - 1] }}>
                {z.name}:{' '}
              </Text>
              {z.description}
            </Text>
          ))}
          <Text size="xs" tone="faint">
            From your reference 2k of {formatDuration(profile.reference2kMs ?? 0)}.{' '}
            {profile.maxHeartRate ? '' : 'Add max heart rate in your profile for HR ranges.'}
          </Text>
          <Button title="Edit profile" variant="ghost" small onPress={() => router.push('/settings/profile')} />
        </>
      )}
    </Card>
  );
}

/* ───────── Split planner ───────── */

const STRATEGIES: { value: Exclude<PaceStrategy, 'custom'>; label: string }[] = [
  { value: 'even', label: 'Even' },
  { value: 'negative-split', label: 'Negative split' },
  { value: 'fast-start-settle-sprint', label: 'Start · settle · sprint' },
];

function SplitPlanner() {
  const [kind, setKind] = useState<'distance' | 'time'>('distance');
  const [piece, setPiece] = useState('2000');
  const [goal, setGoal] = useState('7:30');
  const [strategy, setStrategy] = useState<Exclude<PaceStrategy, 'custom'>>('fast-start-settle-sprint');

  const value = kind === 'distance' ? numOrNaN(piece) : parseDuration(piece);
  const goalNum = kind === 'distance' ? parseDuration(goal) : numOrNaN(goal);
  const goalPace = kind === 'distance' ? (value > 0 && goalNum > 0 ? (goalNum / value) * 500 : NaN) : value > 0 && goalNum > 0 ? (value / goalNum) * 500 : NaN;

  const plan = useMemo(() => {
    if (!(value > 0) || !(goalPace > 0)) return null;
    try {
      return buildPacePlan({ kind, value, goalPaceMsPer500: goalPace, strategy });
    } catch {
      return null;
    }
  }, [kind, value, goalPace, strategy]);

  const rows = useMemo(() => {
    if (!plan) return [];
    let cumT = 0;
    let cumD = 0;
    return plan.segments.map((s) => {
      const frac = s.endFraction - s.startFraction;
      const segD = kind === 'distance' ? frac * value : ((frac * value) / s.targetPaceMsPer500) * 500;
      const segT = kind === 'distance' ? (segD / 500) * s.targetPaceMsPer500 : frac * value;
      cumT += segT;
      cumD += segD;
      return { s, segD, segT, cumT, cumD };
    });
  }, [plan, kind, value]);
  const last = rows[rows.length - 1];

  return (
    <Card>
      <SectionTitle>Split planner</SectionTitle>
      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k);
          if (k === 'distance') {
            setPiece('2000');
            setGoal('7:30');
          } else {
            setPiece('30:00');
            setGoal('7500');
          }
        }}
        options={[
          { value: 'distance', label: 'Distance piece' },
          { value: 'time', label: 'Time piece' },
        ]}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Field flex label={kind === 'distance' ? 'Distance (m)' : 'Duration'} value={piece} onChangeText={setPiece} keyboardType={kind === 'distance' ? 'numeric' : TIME_KB} />
        <Field flex label={kind === 'distance' ? 'Goal time' : 'Goal metres'} value={goal} onChangeText={setGoal} keyboardType={kind === 'distance' ? TIME_KB : 'numeric'} />
      </View>
      <Segmented value={strategy} onChange={setStrategy} options={STRATEGIES} />
      {plan && last ? (
        <>
          <Text size="sm" tone="dim">
            Goal average {formatPace(plan.goalPaceMsPer500)} /500m ({paceToWatts(plan.goalPaceMsPer500).toFixed(0)} W). Plan finishes in{' '}
            {kind === 'distance' ? formatDuration(last.cumT) : formatDistance(last.cumD)}.
          </Text>
          <Table
            rows={rows}
            columns={[
              { title: 'Segment', flex: 1.4, align: 'left', render: (r) => r.s.label },
              { title: kind === 'distance' ? 'Metres' : 'Time', flex: 1.3, render: (r) => (kind === 'distance' ? `${Math.round(r.cumD - r.segD)}–${Math.round(r.cumD)}` : `${formatDuration(r.cumT - r.segT, { tenths: false })}–${formatDuration(r.cumT, { tenths: false })}`) },
              { title: 'Pace', render: (r) => formatPace(r.s.targetPaceMsPer500), tone: () => 'accent' },
              { title: 'spm', flex: 0.6, render: (r) => (r.s.targetStrokeRate ? String(Math.round(r.s.targetStrokeRate)) : '–') },
              { title: kind === 'distance' ? 'At' : 'Dist', flex: 1.1, render: (r) => (kind === 'distance' ? formatDuration(r.cumT) : formatDistance(r.cumD)) },
            ]}
          />
        </>
      ) : (
        <Text tone="faint" size="sm">
          Enter the piece and your goal to see segment targets.
        </Text>
      )}
    </Card>
  );
}

/* ───────── Weight adjustment ───────── */

function WeightAdjust() {
  const profileWeight = useSettings((s) => s.settings.profile.weightKg);
  const [weight, setWeight] = useState(profileWeight ? String(profileWeight) : '');
  const [mode, setMode] = useState<'time' | 'distance'>('time');
  const [value, setValue] = useState('');
  const w = numOrNaN(weight);
  const v = mode === 'time' ? parseDuration(value) : numOrNaN(value);
  const result = w > 0 && v > 0 ? (mode === 'time' ? formatDuration(weightAdjustedTime(v, w)) : formatDistance(weightAdjustedDistance(v, w))) : null;
  return (
    <Card>
      <SectionTitle>Weight-adjusted result</SectionTitle>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'time', label: 'Time (distance event)' },
          { value: 'distance', label: 'Distance (time event)' },
        ]}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Field flex label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="75" />
        <Field flex label={mode === 'time' ? 'Time' : 'Metres'} value={value} onChangeText={setValue} keyboardType={mode === 'time' ? TIME_KB : 'numeric'} placeholder={mode === 'time' ? '7:30.0' : '7500'} />
      </View>
      {result ? (
        <Text>
          Adjusted: <Text weight="700" tone="accent">{result}</Text>
        </Text>
      ) : null}
      <Text size="xs" tone="faint">
        Concept2's formula: factor = (weight lb / 270)^0.222, which lets lighter and heavier athletes compare fairly.
      </Text>
    </Card>
  );
}

/* ───────── Drag factor ───────── */

function DragGuide() {
  const [machine, setMachine] = useState<MachineType>('rower');
  const [df, setDf] = useState('');
  const v = numOrNaN(df);
  const advice = useMemo(() => (v > 0 ? dragFactorAdvice(v, machine) : null), [v, machine]);
  return (
    <Card>
      <SectionTitle>Drag factor guide</SectionTitle>
      <Segmented
        value={machine}
        onChange={setMachine}
        options={[
          { value: 'rower', label: 'RowErg' },
          { value: 'skierg', label: 'SkiErg' },
          { value: 'bikeerg', label: 'BikeErg' },
        ]}
      />
      <Field label="Drag factor" value={df} onChangeText={setDf} keyboardType="numeric" placeholder="125" hint="On the PM5: More → Display Drag Factor, then spin the flywheel." />
      {advice ? <InsightList insights={[advice]} /> : null}
      <Text size="xs" tone="dim">
        Drag factor measures how quickly the flywheel slows, independent of damper number (a dusty or cold flywheel reads lower). Higher drag feels heavier per stroke but is not "more
        workout" — most rowers do best with a lighter, faster-feeling setting and a long, powerful drive.
      </Text>
    </Card>
  );
}
