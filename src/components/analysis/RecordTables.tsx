import React, { memo, useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { heartRateZone, trainingZones } from '@/analysis';
import type { CoxCall, SplitSummary, StrokeSample, WorkoutRecord } from '@/core/types';
import { convertForce, formatDistance, formatDuration, formatPace } from '@/core/units';
import { DistributionBars } from '@/components/charts';
import { useSettings } from '@/storage/settings';
import { Button, Card, EmptyState, SectionTitle, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

import { heartRatePoints, timeInHrZones, timeInPaceZones } from './helpers';
import { Table } from './ui';

export function SplitsSection({ record }: { record: WorkoutRecord }) {
  const splits = record.splits;
  if (splits.length === 0) {
    return <EmptyState title="No splits" detail="The PM did not report splits or intervals for this workout. See the Pacing tab for equal segments." />;
  }
  const hasRest = splits.some((s) => s.restTimeMs > 0);
  return (
    <Card>
      <SectionTitle>{record.workoutType.includes('interval') ? 'Intervals' : 'Splits'}</SectionTitle>
      <Table<SplitSummary>
        rows={splits}
        columns={[
          { title: '#', flex: 0.45, align: 'left', render: (s) => String(s.index + 1) },
          { title: 'Time', flex: 1.15, render: (s) => formatDuration(s.splitTimeMs) },
          { title: 'Dist', flex: 1.05, render: (s) => formatDistance(s.splitDistanceM) },
          { title: 'Pace', flex: 1, render: (s) => formatPace(s.avgPaceMsPer500, record.machineType) },
          { title: 'W', flex: 0.6, render: (s) => (s.avgWatts > 0 ? s.avgWatts.toFixed(0) : '–') },
          { title: 'spm', flex: 0.55, render: (s) => (s.avgStrokeRate > 0 ? s.avgStrokeRate.toFixed(0) : '–') },
          { title: 'HR', flex: 0.55, render: (s) => (s.avgHeartRate ? s.avgHeartRate.toFixed(0) : '–') },
        ]}
      />
      {hasRest ? (
        <>
          <SectionTitle>Rest</SectionTitle>
          <Table<SplitSummary>
            rows={splits.filter((s) => s.restTimeMs > 0)}
            columns={[
              { title: 'After #', flex: 0.8, align: 'left', render: (s) => String(s.index + 1) },
              { title: 'Rest', render: (s) => formatDuration(s.restTimeMs, { tenths: false }) },
              { title: 'Rest dist', render: (s) => (s.restDistanceM > 0 ? formatDistance(s.restDistanceM) : '–') },
              { title: 'End HR', render: (s) => (s.restHeartRate ? `${s.restHeartRate}` : '–') },
            ]}
          />
        </>
      ) : null}
    </Card>
  );
}

export const STROKE_ROW_HEIGHT = 52;

export const StrokeHeader = memo(function StrokeHeader() {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: t.border, gap: 2 }}>
      <Cols tone="faint" cells={['#', 'Time', 'Dist', 'Pace', 'spm', 'W']} />
      <Cols tone="faint" cells={['', 'HR', 'Drive m', 'Drive s', 'Rec s', 'Peak']} />
    </View>
  );
});

export const StrokeRow = memo(function StrokeRow({ s, unit, machine }: { s: StrokeSample; unit: 'N' | 'kgf' | 'lbf'; machine?: string }) {
  const t = useTheme();
  return (
    <View style={{ height: STROKE_ROW_HEIGHT, justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: t.border, gap: 2 }}>
      <Cols
        cells={[
          String(s.strokeNumber),
          formatDuration(s.elapsedMs),
          formatDistance(s.distanceM),
          formatPace(s.paceMsPer500, machine),
          s.strokeRate.toFixed(0),
          s.watts.toFixed(0),
        ]}
      />
      <Cols
        tone="dim"
        cells={[
          '',
          s.heartRate ? String(s.heartRate) : '–',
          s.driveLengthM.toFixed(2),
          (s.driveTimeMs / 1000).toFixed(2),
          (s.recoveryTimeMs / 1000).toFixed(2),
          `${convertForce(s.peakForceN, unit).toFixed(0)}${unit === 'N' ? '' : unit}`,
        ]}
      />
    </View>
  );
});

const FLEX = [0.6, 1.3, 1.2, 1.1, 0.7, 0.8];
function Cols({ cells, tone }: { cells: string[]; tone?: 'faint' | 'dim' }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {cells.map((c, i) => (
        <Text
          key={i}
          size={tone === 'faint' ? 'xs' : 'sm'}
          tone={tone}
          weight={tone === 'faint' ? '700' : undefined}
          numberOfLines={1}
          style={{ flex: FLEX[i], textAlign: i === 0 ? 'left' : 'right', fontVariant: ['tabular-nums'] }}>
          {c}
        </Text>
      ))}
    </View>
  );
}

const ZONE_NAMES = ['UT2', 'UT1', 'AT', 'TR', 'AN'];

export function ZonesSection({ record }: { record: WorkoutRecord }) {
  const t = useTheme();
  const profile = useSettings((s) => s.settings.profile);
  const hr = useMemo(() => heartRatePoints(record), [record]);
  const hrZones = useMemo(() => timeInHrZones(hr, (bpm) => heartRateZone(bpm, profile)), [hr, profile]);
  const zones = useMemo(() => trainingZones(profile), [profile]);
  const paceZones = useMemo(() => timeInPaceZones(record.strokes, zones), [record.strokes, zones]);
  const hrTotal = hrZones.reduce((a, b) => a + b, 0);
  const paceTotal = paceZones.reduce((a, b) => a + b, 0);
  const items = (ms: number[], total: number) =>
    ms.map((v, i) => ({
      key: String(i),
      label: `Zone ${i + 1} · ${zones[i]?.name ?? ZONE_NAMES[i]}`,
      value: v,
      valueText: `${formatDuration(v, { tenths: false })} · ${total > 0 ? Math.round((v / total) * 100) : 0}%`,
      color: t.zones[i],
    }));

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <SectionTitle>Time in heart-rate zones</SectionTitle>
        {hr.length < 2 ? (
          <Text tone="dim">No heart-rate data was recorded for this workout.</Text>
        ) : hrTotal === 0 ? (
          <>
            <Text tone="dim">Set your max (and resting) heart rate or birth year in your profile to see HR zones.</Text>
            <Button title="Edit profile" variant="secondary" small onPress={() => router.push('/settings/profile')} />
          </>
        ) : (
          <DistributionBars items={items(hrZones, hrTotal)} />
        )}
      </Card>
      <Card>
        <SectionTitle>Time in training (pace) zones</SectionTitle>
        {zones.length === 0 ? (
          <>
            <Text tone="dim">Add a reference 2k time to your profile to see pace-based training zones.</Text>
            <Button title="Edit profile" variant="secondary" small onPress={() => router.push('/settings/profile')} />
          </>
        ) : paceTotal === 0 ? (
          <Text tone="dim">Not enough stroke data.</Text>
        ) : (
          <DistributionBars items={items(paceZones, paceTotal)} />
        )}
      </Card>
    </View>
  );
}

export function CallsSection({ calls }: { calls: CoxCall[] }) {
  const t = useTheme();
  if (calls.length === 0) {
    return <EmptyState title="No coxswain calls" detail="The coxswain was off or had nothing to say during this workout." />;
  }
  const col = (c: CoxCall) =>
    c.category === 'technique' ? t.force : c.category === 'pacing' || c.category === 'rate' ? t.pace : c.category === 'motivation' ? t.watts : c.category === 'safety' ? t.bad : t.textDim;
  return (
    <Card>
      <SectionTitle>Coxswain call log</SectionTitle>
      {calls.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: 4 }}>
          <Text size="sm" tone="faint" style={{ width: 54, fontVariant: ['tabular-nums'] }}>
            {formatDuration(c.elapsedMs, { tenths: false })}
          </Text>
          <View style={{ flex: 1 }}>
            <Text size="sm" weight={c.priority >= 3 ? '700' : undefined}>
              {c.text}
            </Text>
            <Text size="xs" style={{ color: col(c) }}>
              {c.category}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}
