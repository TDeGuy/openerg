import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, View } from 'react-native';

import { filterWorkouts, pbEvents, type WorkoutKind } from '@/analysis';
import { syncReference2k } from '@/analysis/reference2k';
import { groupByMonth, formatDate, seasonStart, type MonthSection } from '@/components/analysis/helpers';
import { Badge, Field } from '@/components/analysis/ui';
import type { MachineType, WorkoutListItem } from '@/core/types';
import { formatDistance, formatDuration, formatPace, paceUnit } from '@/core/units';
import { deleteWorkouts, listWorkouts, useDbVersion } from '@/storage/db';
import { Button, Chip, EmptyState, Screen, Segmented, Text } from '@/ui/kit';
import { dialog } from '@/ui/dialog';
import { radius, spacing, useTheme } from '@/ui/theme';

type Range = 'all' | '7d' | '30d' | 'season' | 'year';
const PAGE = 40;
const DAY = 86400000;

function rangeFrom(r: Range, now: number): number | undefined {
  if (r === '7d') return now - 7 * DAY;
  if (r === '30d') return now - 30 * DAY;
  if (r === 'season') return seasonStart(now);
  if (r === 'year') return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  return undefined;
}

export default function LogbookScreen() {
  const t = useTheme();
  const version = useDbVersion();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<WorkoutListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [machine, setMachine] = useState<MachineType>('rower');
  const [kind, setKind] = useState<WorkoutKind | 'all'>('all');
  const [range, setRange] = useState<Range>('all');
  const [showSim, setShowSim] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(PAGE);

  useEffect(() => {
    const h = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);

  const load = useCallback(async () => {
    try {
      // Summary rows only (no strokes); PB badges need every row, the list itself renders PAGE at a time.
      setItems(await listWorkouts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  // Keep the profile reference 2k at the best RowErg 2k.
  useEffect(() => {
    if (!items) return;
    syncReference2k(items);
  }, [items]);

  useEffect(() => {
    setCount(PAGE);
    setSelected([]);
  }, [machine, kind, range, showSim, search]);

  const pbs = useMemo(() => pbEvents(items ?? []), [items]);
  const filtered = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => filterWorkouts(items ?? [], { machine, showSim, kind, search, from: rangeFrom(range, Date.now()) }),
    [items, machine, showSim, kind, search, range],
  );
  const sections = useMemo(() => groupByMonth(filtered.slice(0, count)), [filtered, count]);

  const toggle = useCallback((id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }, []);

  const startSelect = useCallback((id?: string) => {
    setSelecting(true);
    if (id) setSelected([id]);
  }, []);
  const stopSelect = () => {
    setSelecting(false);
    setSelected([]);
  };

  const onPress = useCallback(
    (w: WorkoutListItem) => {
      if (selecting) toggle(w.id);
      else router.push(`/workout/${encodeURIComponent(w.id)}`);
    },
    [selecting, toggle],
  );

  const bulkDelete = () => {
    const n = selected.length;
    dialog(`Delete ${n} workout${n === 1 ? '' : 's'}?`, 'This permanently removes them and their stroke data. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWorkouts(selected);
          } catch (e) {
            dialog('Could not delete', e instanceof Error ? e.message : String(e));
          }
          stopSelect();
        },
      },
    ]);
  };

  const renderItem = useCallback(
    ({ item }: { item: WorkoutListItem }) => (
      <LogRow
        item={item}
        selected={selected.includes(item.id)}
        selecting={selecting}
        pb={pbs.get(item.id)}
        onPress={() => onPress(item)}
        onLongPress={() => (selecting ? toggle(item.id) : startSelect(item.id))}
      />
    ),
    [selected, selecting, pbs, onPress, toggle, startSelect],
  );

  const renderHeader = useCallback(
    ({ section }: { section: MonthSection }) => (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: spacing.lg, paddingBottom: spacing.sm, backgroundColor: t.bg }}>
        <Text weight="700">{section.title}</Text>
        <Text size="xs" tone="dim">
          {section.sessions} {section.sessions === 1 ? 'session' : 'sessions'} · {formatDistance(section.metres)} · {formatDuration(section.durationMs, { tenths: false })}
        </Text>
      </View>
    ),
    [t.bg],
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtersActive = kind !== 'all' || range !== 'all' || !!search;

  return (
    <Screen scroll={false} padded={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text size="xxl" weight="700" style={{ flex: 1 }}>
            Logbook
          </Text>
          <Button title={selecting ? 'Done' : 'Select'} variant={selecting ? 'secondary' : 'ghost'} small onPress={() => (selecting ? stopSelect() : startSelect())} />
        </View>
        <Segmented
          value={machine}
          onChange={setMachine}
          options={[
            { value: 'rower', label: 'Row' },
            { value: 'skierg', label: 'Ski' },
            { value: 'bikeerg', label: 'Bike' },
          ]}
        />
        <Field value={query} onChangeText={setQuery} placeholder="Search title, notes or tags" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All types' },
            { value: 'distance', label: 'Distance' },
            { value: 'time', label: 'Time' },
            { value: 'intervals', label: 'Intervals' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {([['all', 'Any date'], ['7d', '7 days'], ['30d', '30 days'], ['season', 'Season'], ['year', 'This year']] as [Range, string][]).map(([v, l]) => (
            <Chip key={v} label={l} selected={range === v} onPress={() => setRange(v)} />
          ))}
          <Chip label={showSim ? 'Simulator: shown' : 'Simulator: hidden'} selected={!showSim} color={t.textDim} onPress={() => setShowSim((v) => !v)} />
        </View>
        {selecting ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text size="sm" tone="dim" style={{ flex: 1 }}>
              {selected.length === 0 ? 'Tap workouts to select them' : `${selected.length} selected`}
            </Text>
            <Button title="Compare" small variant="secondary" disabled={selected.length !== 2} onPress={() => {
              const [a, b] = selected;
              stopSelect();
              router.push(`/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
            }} />
            <Button title="Delete" small variant="danger" disabled={selected.length === 0} onPress={bulkDelete} />
          </View>
        ) : null}
      </View>
      {items === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(w) => w.id}
          renderItem={renderItem}
          renderSectionHeader={renderHeader}
          stickySectionHeadersEnabled
          extraData={selected}
          onEndReached={() => setCount((c) => (c < filtered.length ? c + PAGE : c))}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accent} />}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            error ? (
              <EmptyState title="Could not load workouts" detail={error} action={<Button title="Retry" onPress={load} />} />
            ) : filtersActive || items.length > 0 ? (
              <EmptyState title="No workouts" detail="Nothing matches these filters. Try another machine, date range or search." />
            ) : (
              <EmptyState
                title="No workouts yet"
                detail="Every piece you row is saved here automatically, with full stroke-by-stroke analysis. Head to the Row tab to connect your PM5 or try the simulator."
                action={<Button title="Go to Row" onPress={() => router.navigate('/')} />}
              />
            )
          }
        />
      )}
    </Screen>
  );
}

const LogRow = React.memo(function LogRow({
  item,
  selected,
  selecting,
  pb,
  onPress,
  onLongPress,
}: {
  item: WorkoutListItem;
  selected: boolean;
  selecting: boolean;
  pb?: string[];
  onPress: () => void;
  onLongPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => ({
        backgroundColor: t.surface,
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 0.5,
        borderColor: selected ? t.accent : t.border,
        padding: spacing.md,
        gap: 6,
        opacity: pressed ? 0.8 : 1,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {selecting ? <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selected ? t.accent : t.textFaint} /> : null}
        <Text weight="700" style={{ flex: 1 }} numberOfLines={1}>
          {item.title}
        </Text>
        {pb?.length ? <Badge label="PB" color={t.good} icon="trophy" /> : null}
        {item.simulated ? <Badge label="SIM" color={t.textDim} /> : null}
        <Text size="xs" tone="faint">
          {formatDate(item.startedAt)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Metric value={formatDistance(item.distanceM)} label="dist" />
        <Metric value={formatDuration(item.elapsedMs)} label="time" />
        <Metric value={formatPace(item.avgPaceMsPer500, item.machineType)} label={paceUnit(item.machineType)} accent />
        <Metric value={item.avgStrokeRate > 0 ? item.avgStrokeRate.toFixed(0) : '–'} label="spm" />
        <Metric value={item.avgHeartRate ? item.avgHeartRate.toFixed(0) : '–'} label="bpm" />
      </View>
    </Pressable>
  );
});

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Text size="sm" weight="700" tone={accent ? 'accent' : 'default'} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      <Text size="xs" tone="faint">
        {label}
      </Text>
    </View>
  );
}
