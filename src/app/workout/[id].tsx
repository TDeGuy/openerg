import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { computePersonalRecords } from '@/analysis';
import { ForceSection } from '@/components/analysis/ForceSection';
import { PacingSection } from '@/components/analysis/PacingSection';
import { CallsSection, SplitsSection, StrokeHeader, StrokeRow, ZonesSection } from '@/components/analysis/RecordTables';
import { SummarySection } from '@/components/analysis/SummarySection';
import { WorkoutActions } from '@/components/analysis/WorkoutActions';
import { recordsFor } from '@/components/analysis/helpers';
import type { PersonalRecord, StrokeSample, WorkoutRecord } from '@/core/types';
import { getWorkout, listWorkouts, useDbVersion } from '@/storage/db';
import { useSettings } from '@/storage/settings';
import { Button, Card, EmptyState, Screen, Segmented, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

type Section = 'summary' | 'pacing' | 'force' | 'splits' | 'strokes' | 'zones' | 'calls';

const EMPTY: StrokeSample[] = [];

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const version = useDbVersion();
  const unit = useSettings((s) => s.settings.forceUnit);
  const [record, setRecord] = useState<WorkoutRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [section, setSection] = useState<Section>('summary');

  useEffect(() => {
    if (!id) {
      setRecord(null);
      return;
    }
    let alive = true;
    getWorkout(String(id))
      .then((r) => alive && setRecord(r))
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setRecord(null);
      });
    listWorkouts()
      .then((items) => alive && setRecords(recordsFor(computePersonalRecords(items, items.find((w) => w.id === String(id))?.machineType), String(id))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, version]);

  const options = useMemo(() => {
    const o: { value: Section; label: string }[] = [
      { value: 'summary', label: 'Summary' },
      { value: 'pacing', label: 'Pacing' },
      { value: 'force', label: 'Force' },
      { value: 'splits', label: 'Splits' },
      { value: 'strokes', label: 'Strokes' },
      { value: 'zones', label: 'Zones' },
    ];
    if (record && record.coxCalls.length > 0) o.push({ value: 'calls', label: `Cox (${record.coxCalls.length})` });
    return o;
  }, [record]);

  const renderStroke = useCallback(({ item }: { item: StrokeSample }) => <StrokeRow s={item} unit={unit} machine={record?.machineType} />, [unit, record?.machineType]);

  if (record === undefined) {
    return (
      <Screen scroll={false} edges={['left', 'right']}>
        <Stack.Screen options={{ title: 'Workout' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      </Screen>
    );
  }
  if (record === null) {
    return (
      <Screen edges={['left', 'right']}>
        <Stack.Screen options={{ title: 'Workout' }} />
        <EmptyState
          title="Workout not found"
          detail={error ?? 'It may have been deleted.'}
          action={<Button title="Back to logbook" onPress={() => (router.canGoBack() ? router.back() : router.replace('/history'))} />}
        />
      </Screen>
    );
  }

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: section === 'strokes' ? 0 : spacing.md }}>
      <Text size="xl" weight="700">
        {record.title}
      </Text>
      <Segmented options={options} value={section} onChange={setSection} />
      <Animated.View key={section} entering={FadeIn.duration(180)} style={{ gap: spacing.md }}>
      {section === 'summary' ? (
        <>
          <SummarySection record={record} records={records} onUpdated={setRecord} />
          <WorkoutActions record={record} />
        </>
      ) : section === 'pacing' ? (
        <PacingSection record={record} />
      ) : section === 'force' ? (
        <ForceSection record={record} />
      ) : section === 'splits' ? (
        <SplitsSection record={record} />
      ) : section === 'zones' ? (
        <ZonesSection record={record} />
      ) : section === 'calls' ? (
        <CallsSection calls={record.coxCalls} />
      ) : record.strokes.length === 0 ? (
        <EmptyState title="No strokes recorded" detail="This workout has no stroke-by-stroke data." />
      ) : (
        <Card style={{ paddingBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <Text size="sm" tone="dim">
            {record.strokes.length} strokes
          </Text>
          <StrokeHeader />
        </Card>
      )}
      </Animated.View>
    </View>
  );

  return (
    <Screen scroll={false} padded={false} edges={['left', 'right']}>
      <Stack.Screen options={{ title: record.title }} />
      <FlatList
        data={section === 'strokes' ? record.strokes : EMPTY}
        keyExtractor={(s, i) => `${s.strokeNumber}-${i}`}
        renderItem={renderStroke}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        initialNumToRender={20}
        maxToRenderPerBatch={40}
        windowSize={11}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: t.bg }}
      />
    </Screen>
  );
}
