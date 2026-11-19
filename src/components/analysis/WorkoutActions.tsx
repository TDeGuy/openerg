import { dialog } from '@/ui/dialog';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { WorkoutListItem, WorkoutRecord } from '@/core/types';
import { formatDistance, formatDuration } from '@/core/units';
import { useSession } from '@/session';
import { planOfRecord } from '@/session/ghost';
import { deleteWorkout, listWorkouts } from '@/storage/db';
import { UploadCard } from '@/integrations/UploadCard';
import { shareWorkout, type ExportFormat } from '@/storage/export';
import { Button, Card, Divider, Row, SectionTitle, Text } from '@/ui/kit';
import { spacing } from '@/ui/theme';

import { formatDate } from './helpers';

export function WorkoutActions({ record }: { record: WorkoutRecord }) {
  const status = useSession((s) => s.connection.status);
  const startWorkout = useSession((s) => s.startWorkout);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [others, setOthers] = useState<WorkoutListItem[] | null>(null);

  useEffect(() => {
    if (!picking || others) return;
    let alive = true;
    listWorkouts({ limit: 60 })
      .then((l) => alive && setOthers(l.filter((w) => w.id !== record.id)))
      .catch(() => alive && setOthers([]));
    return () => {
      alive = false;
    };
  }, [picking, others, record.id]);

  const doExport = async (fmt: ExportFormat) => {
    setBusy(fmt);
    try {
      await shareWorkout(record, fmt);
    } catch (e) {
      dialog('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const start = async (ghost: boolean) => {
    if (status !== 'connected') {
      dialog('Not connected', 'Connect to your PM5 (or turn on the simulator) first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Connect', onPress: () => router.push('/connect') },
      ]);
      return;
    }
    setBusy(ghost ? 'ghost' : 'again');
    try {
      await startWorkout(planOfRecord(record), ghost ? { ghostWorkoutId: record.id } : undefined);
      router.push('/live');
    } catch (e) {
      dialog('Could not start', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () =>
    dialog('Delete workout?', `“${record.title}” and all its stroke data will be permanently removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWorkout(record.id);
            if (router.canGoBack()) router.back();
            else router.replace('/history');
          } catch (e) {
            dialog('Delete failed', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  return (
    <>
    <UploadCard workoutId={record.id} variant="detail" />
    <Card>
      <SectionTitle>Actions</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title="Row again" onPress={() => start(false)} loading={busy === 'again'} style={{ flex: 1 }} />
        <Button title="Race as ghost" variant="secondary" onPress={() => start(true)} loading={busy === 'ghost'} style={{ flex: 1 }} />
      </View>
      <Text size="xs" tone="faint">
        {planOfRecord(record) ? 'Row again programs the same workout on the PM.' : 'This was a just-row session; Row again starts a free row.'} Race as ghost puts
        this performance on the water as your pace boat.
      </Text>
      <Divider />
      <Text size="sm" tone="dim">
        Export (CSV stroke data, TCX for Strava / Concept2 Logbook / TrainingPeaks, or raw JSON)
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {(['csv', 'tcx', 'json'] as ExportFormat[]).map((f) => (
          <Button key={f} title={f.toUpperCase()} variant="secondary" small loading={busy === f} onPress={() => doExport(f)} style={{ flex: 1 }} />
        ))}
      </View>
      <Divider />
      <Button title={picking ? 'Hide workouts' : 'Compare with…'} variant="secondary" onPress={() => setPicking((p) => !p)} />
      {picking ? (
        others == null ? (
          <Text tone="dim">Loading…</Text>
        ) : others.length === 0 ? (
          <Text tone="dim">No other workouts to compare with yet.</Text>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {others.map((w) => (
              <Row
                key={w.id}
                label={w.title}
                hint={`${formatDate(w.startedAt, false)} · ${formatDistance(w.distanceM)} · ${formatDuration(w.elapsedMs)}`}
                onPress={() => router.push(`/compare?a=${encodeURIComponent(record.id)}&b=${encodeURIComponent(w.id)}`)}
              />
            ))}
          </View>
        )
      ) : null}
      <Divider />
      <Button title="Delete workout" variant="danger" onPress={confirmDelete} />
    </Card>
    </>
  );
}
