/** End-of-workout summary card. Loads the saved record when an id is available. */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { LiveMetrics, SplitSummary, WorkoutRecord } from '@/core/types';
import { pbEventsFor } from '@/analysis';
import { syncReference2k } from '@/analysis/reference2k';
import { formatDistance, formatDuration, formatPace, paceUnit } from '@/core/units';
import { eventLabel } from '@/components/analysis/helpers';
import { UploadCard } from '@/integrations/UploadCard';
import { getWorkout, listWorkouts } from '@/storage/db';
import { Button, Card, Stat, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

export interface SummarySnapshot {
  title: string;
  metrics: LiveMetrics | null;
  splits: SplitSummary[];
  /** Real average of the recorded HR samples. */
  avgHr: number | null;
}

interface Totals {
  title: string;
  elapsedMs: number;
  distanceM: number;
  avgPace: number;
  avgWatts: number;
  avgRate: number;
  avgHr: number | null;
  calories: number;
  strokes: number;
  splits: number;
}

function fromRecord(r: WorkoutRecord): Totals {
  return {
    title: r.title,
    elapsedMs: r.elapsedMs,
    distanceM: r.distanceM,
    avgPace: r.avgPaceMsPer500,
    avgWatts: r.avgWatts,
    avgRate: r.avgStrokeRate,
    avgHr: r.avgHeartRate,
    calories: r.calories,
    strokes: r.strokeCount,
    splits: r.splits.length,
  };
}

function fromSnapshot(s: SummarySnapshot): Totals {
  const m = s.metrics;
  return {
    title: s.title,
    elapsedMs: m?.elapsedMs ?? 0,
    distanceM: m?.distanceM ?? 0,
    avgPace: m?.avgPaceMsPer500 ?? 0,
    avgWatts: m?.avgWatts ?? 0,
    avgRate: m?.avgStrokeRate ?? 0,
    avgHr: s.avgHr,
    calories: m?.calories ?? 0,
    strokes: m?.strokeCount ?? 0,
    splits: s.splits.length,
  };
}

export function SummaryCard({
  workoutId,
  snapshot,
  saveFailed,
  onRetry,
  onViewAnalysis,
  onDone,
}: {
  workoutId: string | null;
  snapshot: SummarySnapshot;
  /** Save failed and the workout is still held in memory. */
  saveFailed?: boolean;
  onRetry?: () => Promise<unknown>;
  onViewAnalysis: (id: string) => void;
  onDone: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const t = useTheme();
  const [record, setRecord] = useState<WorkoutRecord | null>(null);
  const [loading, setLoading] = useState(!!workoutId);
  const [pb, setPb] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    if (!workoutId) return;
    setLoading(true);
    getWorkout(workoutId)
      .then((r) => alive && setRecord(r))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [workoutId]);

  // New PB: the saved piece is now the best for its event; also keeps the profile 2k current.
  useEffect(() => {
    if (!workoutId) return;
    let alive = true;
    listWorkouts()
      .then((items) => {
        syncReference2k(items);
        if (alive) setPb(pbEventsFor(items, workoutId));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workoutId]);

  const s = record ? fromRecord(record) : fromSnapshot(snapshot);
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name="trophy-outline" size={28} color={t.accent} />
        <View style={{ flex: 1 }}>
          <Text size="xl" weight="800">
            Workout complete
          </Text>
          <Text tone="dim">{s.title}</Text>
          {pb.length ? (
            <Text weight="700" tone="good">
              New PB · {pb.map(eventLabel).join(", ")}
            </Text>
          ) : null}
        </View>
        {loading ? <ActivityIndicator color={t.accent} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <Stat label="Time" value={formatDuration(s.elapsedMs)} size="xxl" style={{ flex: 1 }} />
        <Stat label="Distance" value={formatDistance(s.distanceM)} size="xxl" style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md }}>
        {[
          { label: 'Avg pace', value: formatPace(s.avgPace, record?.machineType), unit: paceUnit(record?.machineType) },
          { label: 'Avg watts', value: s.avgWatts > 0 ? String(Math.round(s.avgWatts)) : '–', unit: 'W' },
          { label: 'Avg rate', value: s.avgRate > 0 ? String(Math.round(s.avgRate)) : '–', unit: 'spm' },
          { label: 'Avg HR', value: s.avgHr ? String(Math.round(s.avgHr)) : '–', unit: 'bpm' },
          { label: 'Cal', value: String(Math.round(s.calories)), unit: 'cal' },
          { label: 'Strokes', value: String(s.strokes) },
          { label: 'Splits', value: String(s.splits) },
        ].map((x) => (
          <Stat key={x.label} label={x.label} value={x.value} unit={x.unit} size="lg" style={{ width: '33%' }} />
        ))}
      </View>
      {saveFailed && !workoutId ? (
        <View style={{ gap: spacing.sm }}>
          <Text tone="bad" weight="700">
            Saving failed
          </Text>
          <Text tone="dim" size="sm">
            The workout is still held in memory. Retry before you leave.
          </Text>
          <Button
            title="Retry"
            loading={retrying}
            onPress={() => {
              setRetrying(true);
              Promise.resolve(onRetry?.()).finally(() => setRetrying(false));
            }}
          />
        </View>
      ) : !workoutId ? (
        <Text tone="faint" size="sm">
          Nothing was rowed, so there is nothing to save.
        </Text>
      ) : null}
      <UploadCard workoutId={workoutId} variant="summary" />
      {workoutId ? <Button title="View analysis" onPress={() => onViewAnalysis(workoutId)} /> : null}
      <Button title="Done" variant="secondary" onPress={onDone} />
    </Card>
  );
}
