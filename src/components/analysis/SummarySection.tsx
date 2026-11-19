import { dialog } from '@/ui/dialog';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { bestEffort, dragFactorAdvice, wattsPerKg, weightAdjustedDistance, weightAdjustedTime } from '@/analysis';
import type { PersonalRecord, WorkoutRecord } from '@/core/types';
import { formatDistance, formatDuration, formatPace, paceUnit } from '@/core/units';
import { updateWorkoutMeta } from '@/storage/db';
import { useSettings } from '@/storage/settings';
import { Button, Card, SectionTitle, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

import { eventLabel, formatDate } from './helpers';
import { Badge, Field, InsightList, StatGrid, Table } from './ui';

const EFFORTS = [500, 1000, 2000, 5000];

export function SummarySection({
  record,
  records,
  onUpdated,
}: {
  record: WorkoutRecord;
  records: PersonalRecord[];
  onUpdated: (r: WorkoutRecord) => void;
}) {
  const t = useTheme();
  const profile = useSettings((s) => s.settings.profile);
  const weight = profile.weightKg;

  const dps = record.strokeCount > 0 ? record.distanceM / record.strokeCount : 0;
  const wkg = useMemo(() => wattsPerKg(record.avgWatts, weight), [record.avgWatts, weight]);
  const drag = useMemo(
    () => (record.avgDragFactor > 0 ? dragFactorAdvice(record.avgDragFactor, record.machineType) : null),
    [record.avgDragFactor, record.machineType],
  );
  const isTimePiece = record.plan?.kind === 'single-time' || record.workoutType.startsWith('fixed-time');
  const isInterval = record.plan?.kind === 'intervals' || record.workoutType.includes('interval');
  const adjusted = useMemo(() => {
    if (!weight || isInterval) return null;
    return isTimePiece
      ? { label: 'Weight-adjusted distance', value: formatDistance(weightAdjustedDistance(record.distanceM, weight)) }
      : { label: 'Weight-adjusted time', value: formatDuration(weightAdjustedTime(record.elapsedMs, weight)) };
  }, [weight, isTimePiece, isInterval, record.distanceM, record.elapsedMs]);

  const efforts = useMemo(() => {
    if (record.strokes.length < 2) return [];
    return EFFORTS.filter((d) => d <= record.distanceM)
      .map((d) => ({ d, r: bestEffort(record, d) }))
      .filter((e): e is { d: number; r: NonNullable<ReturnType<typeof bestEffort>> } => e.r != null);
  }, [record]);

  const [title, setTitle] = useState(record.title);
  const [notes, setNotes] = useState(record.notes ?? '');
  const [tags, setTags] = useState((record.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTitle(record.title);
    setNotes(record.notes ?? '');
    setTags((record.tags ?? []).join(', '));
  }, [record.id, record.title, record.notes, record.tags]);
  const parsedTags = tags
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const dirty = title.trim() !== record.title || notes !== (record.notes ?? '') || parsedTags.join(',') !== (record.tags ?? []).join(',');

  const save = async () => {
    const patch = { title: title.trim() || record.title, notes, tags: parsedTags };
    setSaving(true);
    try {
      await updateWorkoutMeta(record.id, patch);
      onUpdated({ ...record, ...patch });
    } catch (e) {
      dialog('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {records.map((r) => (
            <Badge key={r.event} label={`PR ${eventLabel(r.event)}`} color={t.warn} icon="trophy" />
          ))}
          {record.simulated ? <Badge label="Simulated" color={t.textDim} icon="game-controller-outline" /> : null}
          {record.verified ? <Badge label="PM verified" color={t.good} icon="checkmark-circle" /> : null}
        </View>
        <Text tone="dim" size="sm">
          {formatDate(record.startedAt)}
          {record.ergName ? ` · ${record.ergName}` : ''} · {record.machineType}
        </Text>
        <StatGrid
          items={[
            { label: 'Time', value: formatDuration(record.elapsedMs) },
            { label: 'Distance', value: formatDistance(record.distanceM) },
            { label: 'Avg pace', value: formatPace(record.avgPaceMsPer500, record.machineType), unit: paceUnit(record.machineType), tone: 'accent' },
            { label: 'Watts', value: record.avgWatts > 0 ? record.avgWatts.toFixed(0) : '–', unit: 'W' },
            { label: 'W/kg', value: weight && wkg > 0 ? wkg.toFixed(2) : '–' },
            { label: 'Rate', value: record.avgStrokeRate > 0 ? record.avgStrokeRate.toFixed(0) : '–', unit: 'spm' },
            { label: 'HR avg', value: record.avgHeartRate ? record.avgHeartRate.toFixed(0) : '–', unit: 'bpm' },
            { label: 'HR max', value: record.maxHeartRate ? record.maxHeartRate.toFixed(0) : '–', unit: 'bpm' },
            { label: 'Calories', value: record.calories > 0 ? record.calories.toFixed(0) : '–', unit: 'kcal' },
            { label: 'Strokes', value: record.strokeCount > 0 ? String(record.strokeCount) : '–' },
            { label: 'Drag factor', value: record.avgDragFactor > 0 ? record.avgDragFactor.toFixed(0) : '–' },
            { label: 'Dist/stroke', value: dps > 0 ? dps.toFixed(1) : '–', unit: 'm' },
            ...(record.totalRestMs > 0 ? [{ label: 'Rest', value: formatDuration(record.totalRestMs, { tenths: false }) }] : []),
          ]}
        />
        {adjusted ? (
          <Text size="sm" tone="dim">
            {adjusted.label} ({weight} kg): <Text weight="700">{adjusted.value}</Text>
          </Text>
        ) : !weight ? (
          <Text size="xs" tone="faint">
            Add your weight in Settings → Profile for W/kg and weight-adjusted results.
          </Text>
        ) : null}
      </Card>

      {drag ? (
        <Card>
          <SectionTitle>Drag factor</SectionTitle>
          <InsightList insights={[drag]} />
        </Card>
      ) : null}

      {efforts.length > 0 ? (
        <Card>
          <SectionTitle>Best efforts in this piece</SectionTitle>
          <Table
            rows={efforts}
            columns={[
              { title: 'Distance', align: 'left', render: (e) => formatDistance(e.d) },
              { title: 'Time', render: (e) => formatDuration(e.r.timeMs) },
              { title: 'Pace', render: (e) => formatPace(e.r.paceMsPer500, record.machineType) },
              { title: 'From', render: (e) => formatDistance(e.r.startM) },
            ]}
          />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Title, notes & tags</SectionTitle>
        <Field label="Title" value={title} onChangeText={setTitle} maxLength={80} />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
        <Field label="Tags" value={tags} onChangeText={setTags} placeholder="test, race, steady" hint="Comma separated" autoCapitalize="none" />
        <Button title="Save" onPress={save} disabled={!dirty} loading={saving} small />
      </Card>
    </View>
  );
}
