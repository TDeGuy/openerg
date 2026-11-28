import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { analyzeIntervals, analyzePacing, describePacingProfile } from '@/analysis';
import type { WorkoutRecord } from '@/core/types';
import { formatDelta, formatDistance, formatDuration, formatPace } from '@/core/units';
import { BarChart, LineChart, type LineSeries } from '@/components/charts';
import { Card, Chip, EmptyState, SectionTitle, Segmented, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

import { planTargetSeries } from './helpers';
import { InsightList, StatGrid, Table, pct } from './ui';

type Metric = 'pace' | 'watts' | 'rate' | 'hr';

export const timeTick = (v: number) => formatDuration(v, { tenths: false });

export function PacingSection({ record }: { record: WorkoutRecord }) {
  const t = useTheme();
  const fmtPace = useCallback((v: number) => formatPace(v, record.machineType), [record.machineType]);
  const paceTick = useCallback((v: number) => fmtPace(v).replace(/\.\d$/, ''), [fmtPace]);
  const [parts, setParts] = useState<'auto' | '4' | '8' | '16'>('auto');
  const [picked, setPicked] = useState<number | null>(null);
  const pacing = useMemo(() => analyzePacing(record, parts === 'auto' ? undefined : Number(parts)), [record, parts]);
  const seg = picked != null ? pacing.segments[picked] : undefined;
  const intervals = useMemo(() => analyzeIntervals(record), [record]);
  const plan = useMemo(() => planTargetSeries(record.plan, record), [record]);
  const profile = useMemo(() => describePacingProfile(pacing.profile), [pacing.profile]);
  const [shown, setShown] = useState<Record<Metric, boolean>>({ pace: true, watts: false, rate: true, hr: true });
  const hasPlanDelta = pacing.segments.some((s) => s.deltaVsPlanMs != null);
  const [barMode, setBarMode] = useState<'avg' | 'plan'>('avg');

  const paceSeries = useMemo<LineSeries[]>(() => {
    const s: LineSeries[] = [
      { key: 'pace', label: 'Pace', points: pacing.paceSeries, color: t.pace, fill: true, format: fmtPace },
    ];
    if (plan.length) s.push({ key: 'plan', label: 'Plan', points: plan, color: t.textDim, step: true, dashed: true, format: fmtPace });
    return s;
  }, [pacing.paceSeries, plan, t, fmtPace]);
  const wattsSeries = useMemo<LineSeries[]>(
    () => [{ key: 'w', label: 'Watts', points: pacing.wattsSeries, color: t.watts, fill: true, format: (v) => `${v.toFixed(0)} W` }],
    [pacing.wattsSeries, t],
  );
  const rateSeries = useMemo<LineSeries[]>(
    () => [{ key: 'r', label: 'Rate', points: pacing.rateSeries, color: t.rate, format: (v) => `${v.toFixed(1)} spm` }],
    [pacing.rateSeries, t],
  );
  const hrSeries = useMemo<LineSeries[]>(
    () => [{ key: 'h', label: 'Heart rate', points: pacing.heartRateSeries, color: t.heart, format: (v) => `${v.toFixed(0)} bpm` }],
    [pacing.heartRateSeries, t],
  );
  const paceRefs = useMemo(
    () => (record.avgPaceMsPer500 > 0 ? [{ y: record.avgPaceMsPer500, label: `avg ${formatPace(record.avgPaceMsPer500, record.machineType)}` }] : []),
    [record.avgPaceMsPer500, record.machineType],
  );

  const bars = useMemo(
    () =>
      pacing.segments.map((s) => {
        const v = barMode === 'plan' ? (s.deltaVsPlanMs ?? 0) : s.deltaVsAvgMs;
        return { label: String(s.index + 1), value: v, color: v <= 0 ? t.good : t.bad };
      }),
    [pacing.segments, barMode, t],
  );

  if (pacing.paceSeries.length < 2 && pacing.segments.length === 0) {
    return <EmptyState title="Not enough data" detail="This workout has too few strokes for a pacing analysis." />;
  }

  const metricChips: { key: Metric; label: string; color: string; has: boolean }[] = [
    { key: 'pace', label: 'Pace', color: t.pace, has: pacing.paceSeries.length > 1 },
    { key: 'watts', label: 'Watts', color: t.watts, has: pacing.wattsSeries.length > 1 },
    { key: 'rate', label: 'Rate', color: t.rate, has: pacing.rateSeries.length > 1 },
    { key: 'hr', label: 'Heart rate', color: t.heart, has: pacing.heartRateSeries.length > 1 },
  ];

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <SectionTitle right={<Text tone="accent" weight="700">{`${Math.round(pacing.score)}/100`}</Text>}>Pacing</SectionTitle>
        <Text size="lg" weight="700">
          {profile.title}
        </Text>
        <Text tone="dim" size="sm">
          {profile.detail}
        </Text>
        <StatGrid
          items={[
            { label: 'Variability', value: pct(pacing.variabilityPct, 1) },
            { label: 'Fade', value: `${pacing.fadePct > 0 ? '+' : ''}${pct(pacing.fadePct, 1)}`, tone: pacing.fadePct > 2 ? 'warn' : 'default' },
            { label: 'HR drift', value: pacing.hrDriftPct == null ? '–' : pct(pacing.hrDriftPct, 1) },
            { label: 'Lost to pacing', value: formatDelta(pacing.timeLostToPacingMs), tone: pacing.timeLostToPacingMs > 2000 ? 'warn' : 'default' },
            { label: 'Fastest seg', value: pacing.segments[pacing.fastestSegment] ? `#${pacing.fastestSegment + 1}` : '–', tone: 'good' },
            { label: 'Slowest seg', value: pacing.segments[pacing.slowestSegment] ? `#${pacing.slowestSegment + 1}` : '–', tone: 'bad' },
          ]}
        />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {metricChips
            .filter((m) => m.has)
            .map((m) => (
              <Chip key={m.key} label={m.label} color={m.color} selected={shown[m.key]} onPress={() => setShown((s) => ({ ...s, [m.key]: !s[m.key] }))} />
            ))}
        </View>
        <Text size="xs" tone="faint">
          Drag across a chart to read values.
        </Text>
        {shown.pace && pacing.paceSeries.length > 1 ? (
          <LineChart series={paceSeries} left={{ invert: true, format: paceTick }} xFormat={timeTick} references={paceRefs} height={190} />
        ) : null}
        {shown.watts && pacing.wattsSeries.length > 1 ? <LineChart series={wattsSeries} xFormat={timeTick} height={130} /> : null}
        {shown.rate && pacing.rateSeries.length > 1 ? <LineChart series={rateSeries} xFormat={timeTick} height={120} /> : null}
        {shown.hr && pacing.heartRateSeries.length > 1 ? <LineChart series={hrSeries} xFormat={timeTick} height={120} /> : null}
      </Card>

      {pacing.segments.length > 0 ? (
        <Card>
          <SectionTitle>Segments</SectionTitle>
          {hasPlanDelta ? (
            <Segmented
              value={barMode}
              onChange={setBarMode}
              options={[
                { value: 'avg', label: 'vs average' },
                { value: 'plan', label: 'vs plan' },
              ]}
            />
          ) : null}
          <Segmented
            value={parts}
            onChange={(v) => {
              setParts(v);
              setPicked(null);
            }}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: '4', label: '4 parts' },
              { value: '8', label: '8 parts' },
              { value: '16', label: '16 parts' },
            ]}
          />
          <BarChart
            bars={bars}
            format={(v) => formatDelta(v)}
            reference={{ value: 0 }}
            invert
            onPressBar={setPicked}
            describe={(i) => {
              const s = pacing.segments[i];
              return `${formatPace(s.avgPaceMsPer500, record.machineType)} · ${s.avgStrokeRate.toFixed(0)} spm · ${formatDistance(s.endM - s.startM)}`;
            }}
          />
          <Text size="xs" tone="faint">
            Pace delta per segment {barMode === 'plan' ? 'versus plan' : 'versus your average'}; green is faster. Tap a bar to select a segment.
          </Text>
          {seg ? (
            <StatGrid
              items={[
                { label: `Segment ${seg.index + 1}`, value: formatDistance(seg.endM - seg.startM) },
                { label: 'Time', value: formatDuration(seg.endMs - seg.startMs) },
                { label: 'Pace', value: formatPace(seg.avgPaceMsPer500, record.machineType), tone: 'accent' },
                { label: 'vs average', value: formatDelta(seg.deltaVsAvgMs), tone: seg.deltaVsAvgMs <= 0 ? 'good' : 'bad' },
                { label: 'Rate', value: `${seg.avgStrokeRate.toFixed(0)} spm` },
                { label: 'HR', value: seg.avgHeartRate ? `${seg.avgHeartRate.toFixed(0)} bpm` : '–' },
              ]}
            />
          ) : null}
        </Card>
      ) : null}

      {intervals ? (
        <Card>
          <SectionTitle>Intervals</SectionTitle>
          <StatGrid
            items={[
              { label: 'Reps', value: String(intervals.reps.length) },
              { label: 'Drop-off', value: pct(intervals.dropOffPct, 1), tone: intervals.dropOffPct > 3 ? 'warn' : 'good' },
              { label: 'Consistency', value: pct(intervals.consistencyPct, 0) },
            ]}
          />
          <BarChart
            bars={intervals.reps.map((r) => ({ label: String(r.index + 1), value: r.deltaVsAvgMs, color: r.deltaVsAvgMs <= 0 ? t.good : t.bad }))}
            format={(v) => formatDelta(v)}
            reference={{ value: 0 }}
            invert
            describe={(i) => formatPace(intervals.reps[i].avgPaceMsPer500, record.machineType)}
          />
          <Table
            rows={intervals.reps}
            columns={[
              { title: '#', flex: 0.5, align: 'left', render: (r) => String(r.index + 1) },
              { title: 'Time', flex: 1.2, render: (r) => formatDuration(r.endMs - r.startMs) },
              { title: 'Dist', flex: 1.1, render: (r) => formatDistance(r.endM - r.startM) },
              { title: 'Pace', flex: 1.1, render: (r) => formatPace(r.avgPaceMsPer500, record.machineType), tone: (_, i) => (i === bestIdx(intervals.reps) ? 'good' : undefined) },
              { title: 'spm', flex: 0.6, render: (r) => r.avgStrokeRate.toFixed(0) },
              { title: 'HR', flex: 0.6, render: (r) => (r.avgHeartRate ? r.avgHeartRate.toFixed(0) : '–') },
              { title: 'Rec', flex: 0.7, render: (_, i) => (intervals.hrRecovery[i] != null ? `−${intervals.hrRecovery[i]}` : '–') },
            ]}
          />
          <Text size="xs" tone="faint">
            Rec = heart-rate drop (bpm) during the rest after the rep.
          </Text>
          <InsightList insights={intervals.insights} />
        </Card>
      ) : null}

      {pacing.insights.length > 0 ? (
        <Card>
          <SectionTitle>Insights</SectionTitle>
          <InsightList insights={pacing.insights} />
        </Card>
      ) : null}
    </View>
  );
}

function bestIdx(reps: { avgPaceMsPer500: number }[]): number {
  let b = -1;
  for (let i = 0; i < reps.length; i++) if (reps[i].avgPaceMsPer500 > 0 && (b < 0 || reps[i].avgPaceMsPer500 < reps[b].avgPaceMsPer500)) b = i;
  return b;
}
