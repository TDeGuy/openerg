import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { analyzeForceSession, analyzePacing } from '@/analysis';
import { byDistance, formatDate } from '@/components/analysis/helpers';
import { Table } from '@/components/analysis/ui';
import { ForceCurveChart, LineChart, movingAverage, type ForceCurve, type LineSeries } from '@/components/charts';
import type { WorkoutRecord } from '@/core/types';
import { formatDelta, formatDistance, formatDuration, formatPace } from '@/core/units';
import { getWorkout } from '@/storage/db';
import { useSettings } from '@/storage/settings';
import { Button, Card, EmptyState, Screen, SectionTitle, Segmented, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

type Metric = 'pace' | 'rate' | 'hr' | 'watts';


interface TotalRow {
  label: string;
  a: string;
  b: string;
  delta: string;
  /** true = B better, false = B worse, null = neutral. */
  better: boolean | null;
}

function num(a: number | null, b: number | null, fmt: (v: number) => string, higherIsBetter: boolean | null, label: string): TotalRow {
  const ok = a != null && b != null && a > 0 && b > 0;
  const d = ok ? (b as number) - (a as number) : 0;
  return {
    label,
    a: a != null && a > 0 ? fmt(a) : '–',
    b: b != null && b > 0 ? fmt(b) : '–',
    delta: ok ? `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d))}` : '–',
    better: !ok || d === 0 || higherIsBetter == null ? null : higherIsBetter ? d > 0 : d < 0,
  };
}

export default function CompareScreen() {
  const { a, b } = useLocalSearchParams<{ a?: string; b?: string }>();
  const t = useTheme();
  const unit = useSettings((s) => s.settings.forceUnit);
  const [pair, setPair] = useState<[WorkoutRecord | null, WorkoutRecord | null] | undefined>(undefined);
  const [metric, setMetric] = useState<Metric>('pace');

  useEffect(() => {
    let alive = true;
    if (!a || !b) {
      setPair([null, null]);
      return;
    }
    Promise.all([getWorkout(String(a)), getWorkout(String(b))])
      .then((r) => alive && setPair(r))
      .catch(() => alive && setPair([null, null]));
    return () => {
      alive = false;
    };
  }, [a, b]);

  const A = pair?.[0] ?? null;
  const B = pair?.[1] ?? null;
  // Compare is meant for one machine; a mixed pair shows A's unit.
  const fmtPace = useCallback((v: number) => formatPace(v, A?.machineType), [A?.machineType]);
  const paceTick = useCallback((v: number) => fmtPace(v).replace(/\.\d$/, ''), [fmtPace]);
  const colA = t.pace;
  const colB = t.watts;

  const totals = useMemo<TotalRow[]>(() => {
    if (!A || !B) return [];
    const dps = (r: WorkoutRecord) => (r.strokeCount > 0 ? r.distanceM / r.strokeCount : 0);
    return [
      num(A.elapsedMs, B.elapsedMs, (v) => formatDuration(v), null, 'Time'),
      num(A.distanceM, B.distanceM, formatDistance, null, 'Distance'),
      {
        label: 'Avg pace',
        a: formatPace(A.avgPaceMsPer500, A.machineType),
        b: formatPace(B.avgPaceMsPer500, B.machineType),
        delta: A.avgPaceMsPer500 > 0 && B.avgPaceMsPer500 > 0 ? formatDelta(B.avgPaceMsPer500 - A.avgPaceMsPer500) : '–',
        better: A.avgPaceMsPer500 > 0 && B.avgPaceMsPer500 > 0 && A.avgPaceMsPer500 !== B.avgPaceMsPer500 ? B.avgPaceMsPer500 < A.avgPaceMsPer500 : null,
      },
      num(A.avgWatts, B.avgWatts, (v) => `${v.toFixed(0)} W`, true, 'Watts'),
      num(A.avgStrokeRate, B.avgStrokeRate, (v) => v.toFixed(1), null, 'Rate'),
      num(A.avgHeartRate, B.avgHeartRate, (v) => v.toFixed(0), null, 'HR avg'),
      num(A.maxHeartRate, B.maxHeartRate, (v) => v.toFixed(0), null, 'HR max'),
      num(dps(A), dps(B), (v) => `${v.toFixed(2)} m`, true, 'Dist/stroke'),
      num(A.strokeCount, B.strokeCount, (v) => v.toFixed(0), null, 'Strokes'),
      num(A.calories, B.calories, (v) => v.toFixed(0), null, 'Calories'),
      num(A.avgDragFactor, B.avgDragFactor, (v) => v.toFixed(0), null, 'Drag factor'),
    ];
  }, [A, B]);

  const curves = useMemo<LineSeries[]>(() => {
    if (!A || !B) return [];
    const pick =
      metric === 'pace'
        ? (s: WorkoutRecord['strokes'][number]) => s.paceMsPer500
        : metric === 'rate'
          ? (s: WorkoutRecord['strokes'][number]) => s.strokeRate
          : metric === 'watts'
            ? (s: WorkoutRecord['strokes'][number]) => s.watts
            : (s: WorkoutRecord['strokes'][number]) => s.heartRate;
    const fmt = metric === 'pace' ? fmtPace : (v: number) => v.toFixed(metric === 'rate' ? 1 : 0);
    return [
      { key: 'a', label: 'A', points: movingAverage(byDistance(A.strokes, pick), 7), color: colA, format: fmt },
      { key: 'b', label: 'B', points: movingAverage(byDistance(B.strokes, pick), 7), color: colB, format: fmt },
    ];
  }, [A, B, metric, colA, colB, fmtPace]);

  const forces = useMemo<ForceCurve[]>(() => {
    if (!A || !B) return [];
    const out: ForceCurve[] = [];
    if (A.strokes.some((s) => s.forceCurve.length >= 4)) out.push({ key: 'a', label: 'A average', values: analyzeForceSession(A.strokes).averageCurve, color: colA, peak: true });
    if (B.strokes.some((s) => s.forceCurve.length >= 4)) out.push({ key: 'b', label: 'B average', values: analyzeForceSession(B.strokes).averageCurve, color: colB, peak: true });
    return out;
  }, [A, B, colA, colB]);

  const splitRows = useMemo(() => {
    if (!A || !B) return [];
    const useSplits = A.splits.length > 0 && A.splits.length === B.splits.length;
    const sa = useSplits ? A.splits.map((s) => s.avgPaceMsPer500) : analyzePacing(A).segments.map((s) => s.avgPaceMsPer500);
    const sb = useSplits ? B.splits.map((s) => s.avgPaceMsPer500) : analyzePacing(B).segments.map((s) => s.avgPaceMsPer500);
    const n = Math.min(sa.length, sb.length);
    return Array.from({ length: n }, (_, i) => ({ i, a: sa[i], b: sb[i], d: sb[i] - sa[i], kind: useSplits ? 'split' : 'segment' }));
  }, [A, B]);

  if (pair === undefined) {
    return (
      <Screen scroll={false} edges={['left', 'right']}>
        <Stack.Screen options={{ title: 'Compare' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      </Screen>
    );
  }
  if (!A || !B) {
    return (
      <Screen edges={['left', 'right']}>
        <Stack.Screen options={{ title: 'Compare' }} />
        <EmptyState
          title="Pick two workouts"
          detail={a && b ? 'One of these workouts could not be found.' : 'Tap Select in the logbook, then pick two workouts to compare them.'}
          action={<Button title="Open logbook" onPress={() => router.navigate('/history')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Compare' }} />
      <Card>
        <Legend color={colA} tag="A" r={A} onPress={() => router.push(`/workout/${encodeURIComponent(A.id)}`)} />
        <Legend color={colB} tag="B" r={B} onPress={() => router.push(`/workout/${encodeURIComponent(B.id)}`)} />
      </Card>
      {A.machineType !== B.machineType ? (
        <Text size="sm" tone="bad">
          These workouts are from different machines, so the comparison is not like for like.
        </Text>
      ) : null}

      <Card>
        <SectionTitle>Totals</SectionTitle>
        <Table<TotalRow>
          rows={totals}
          columns={[
            { title: '', flex: 1.2, align: 'left', render: (r) => r.label },
            { title: 'A', flex: 1.1, render: (r) => r.a },
            { title: 'B', flex: 1.1, render: (r) => r.b },
            { title: 'B − A', flex: 1, render: (r) => r.delta, tone: (r) => (r.better == null ? 'dim' : r.better ? 'good' : 'bad') },
          ]}
        />
      </Card>

      <Card>
        <SectionTitle>By distance</SectionTitle>
        <Segmented
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'pace', label: 'Pace' },
            { value: 'watts', label: 'Watts' },
            { value: 'rate', label: 'Rate' },
            { value: 'hr', label: 'Heart rate' },
          ]}
        />
        {curves.some((c) => c.points.length > 1) ? (
          <LineChart
            series={curves}
            left={metric === 'pace' ? { invert: true, format: paceTick } : undefined}
            xFormat={(v) => formatDistance(v)}
            height={200}
          />
        ) : (
          <Text tone="dim">No {metric === 'hr' ? 'heart-rate' : 'stroke'} data to compare.</Text>
        )}
      </Card>

      <Card>
        <SectionTitle>Average force curves</SectionTitle>
        {forces.length > 0 ? <ForceCurveChart curves={forces} unit={unit} /> : <Text tone="dim">Neither workout has force curve data.</Text>}
      </Card>

      {splitRows.length > 0 ? (
        <Card>
          <SectionTitle>{splitRows[0].kind === 'split' ? 'Split by split' : 'Segment by segment'}</SectionTitle>
          <Table
            rows={splitRows}
            columns={[
              { title: '#', flex: 0.5, align: 'left', render: (r) => String(r.i + 1) },
              { title: 'A pace', render: (r) => fmtPace(r.a) },
              { title: 'B pace', render: (r) => fmtPace(r.b) },
              { title: 'Δ', render: (r) => (r.a > 0 && r.b > 0 ? formatDelta(r.d) : '–'), tone: (r) => (!(r.a > 0 && r.b > 0) ? 'dim' : r.d < 0 ? 'good' : r.d > 0 ? 'bad' : 'dim') },
            ]}
          />
          {splitRows[0].kind === 'segment' ? (
            <Text size="xs" tone="faint">
              The PM splits differ, so both pieces are cut into equal segments.
            </Text>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function Legend({ color, tag, r, onPress }: { color: string; tag: string; r: WorkoutRecord; onPress: () => void }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Text size="sm" weight="700" style={{ color: t.accentText }}>
          {tag}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text weight="700" numberOfLines={1}>
          {r.title}
        </Text>
        <Text size="xs" tone="dim">
          {formatDate(r.startedAt)} · {formatDistance(r.distanceM)} · {formatDuration(r.elapsedMs)}
        </Text>
      </View>
    </Card>
  );
}
