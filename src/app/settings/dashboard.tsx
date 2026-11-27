/** Live page editor: pages, a true-to-layout preview with drag-to-reorder tiles, tile palette, graphs. */
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { moveItem } from '@/components/analysis/helpers';
import { IconButton, TextField } from '@/components/live/common';
import { GRAPH_LABELS, GraphFrame, MetricTile, PageLayout } from '@/components/live/dashboard';
import { GRAPH_OPTIONS, GRAPH_POSITIONS, graphOptions, toggleOption } from '@/components/live/graphs';
import { METRIC_KEYS, METRICS, type TileValue, tileValues } from '@/components/live/metrics';
import { activateLayout, deleteLayout, editPages, renameLayout, saveLayout } from '@/components/live/layouts';
import { type Box, computeProgress } from '@/components/live/progress';
import { DEFAULT_SETTINGS, emptyMetrics } from '@/core/defaults';
import type { LiveGraphKey, LivePageConfig, MetricKey, WorkoutPlan } from '@/core/types';
import { useSettings } from '@/storage/settings';
import { dialog } from '@/ui/dialog';
import { Button, Card, Chip, Screen, SectionTitle, Text } from '@/ui/kit';
import { radius, spacing, useTheme } from '@/ui/theme';

const GRAPH_KEYS = Object.keys(GRAPH_LABELS) as LiveGraphKey[];
const SAMPLE_PLAN: WorkoutPlan = { id: 'sample', name: '2k', kind: 'single-distance', value: 2000 };
const SAMPLE_M = {
  ...emptyMetrics(),
  elapsedMs: 245300,
  distanceM: 1150,
  paceMsPer500: 106200,
  avgPaceMsPer500: 106800,
  splitAvgPaceMsPer500: 106500,
  watts: 291,
  avgWatts: 285,
  strokeRate: 30,
  avgStrokeRate: 29,
  heartRate: 168,
  calories: 72,
  caloriesPerHour: 1180,
  dragFactor: 120,
  driveLengthM: 1.42,
  driveTimeMs: 720,
  recoveryTimeMs: 1280,
  strokeDistanceM: 10.1,
  peakForceN: 720,
  avgForceN: 420,
  workPerStrokeJ: 560,
  strokeCount: 121,
  speedMps: 4.7,
  projectedWorkTimeMs: 427000,
};
const NO_TARGET = { paceMsPer500: null, strokeRate: null, label: null };

const copyDefaults = (): LivePageConfig[] => DEFAULT_SETTINGS.livePages.map((p) => ({ ...p, tiles: [...p.tiles], graphs: [...p.graphs] }));

export default function LivePagesScreen() {
  const t = useTheme();
  const pages = useSettings((s) => s.settings.livePages);
  const profile = useSettings((s) => s.settings.profile);
  const forceUnit = useSettings((s) => s.settings.forceUnit);
  const forceDefault = useSettings((s) => s.settings.forceCurveOverlays);
  const update = useSettings((s) => s.update);
  const { width } = useWindowDimensions();
  const [sel, setSel] = useState(0);
  const [dragging, setDragging] = useState(false);

  const i = Math.min(sel, pages.length - 1);
  const page = pages[i];
  const layouts = useSettings((s) => s.settings.savedLayouts);
  const activeId = useSettings((s) => s.settings.activeLayoutId);
  const active = layouts.find((l) => l.id === activeId);
  const cur = () => ({ livePages: pages, savedLayouts: layouts, activeLayoutId: activeId });
  const save = (next: LivePageConfig[]) => update(editPages(cur(), next));
  const saveAsLayout = () => {
    update(saveLayout(cur(), `Layout ${layouts.length + 1}`, `l${Date.now().toString(36)}`));
  };
  const removeLayout = (id: string, name: string) =>
    dialog(`Delete layout “${name}”?`, 'Your current pages stay as they are.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => update(deleteLayout(cur(), id)) },
    ]);
  const patch = (p: Partial<LivePageConfig>) => save(pages.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const sample = useMemo(
    () => tileValues(page.tiles, { m: SAMPLE_M, profile, forceUnit, plan: SAMPLE_PLAN, paceBoat: null, analysis: null, progress: computeProgress(SAMPLE_PLAN, SAMPLE_M, []), target: NO_TARGET }),
    [page.tiles, profile, forceUnit],
  );

  const addPage = () => {
    save([...pages, { id: `p${Date.now().toString(36)}`, name: `Page ${pages.length + 1}`, tiles: ['pace', 'strokeRate', 'distance', 'elapsed'], graphs: [] }]);
    setSel(pages.length);
  };
  const deletePage = () =>
    dialog(`Delete “${page.name}”?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          save(pages.filter((_, j) => j !== i));
          setSel(Math.max(0, i - 1));
        },
      },
    ]);
  const movePage = (d: -1 | 1) => {
    save(moveItem(pages, i, i + d));
    setSel(i + d);
  };
  const reset = () =>
    dialog('Reset live pages?', 'Replaces all pages with the defaults.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          save(copyDefaults());
          setSel(0);
        },
      },
    ]);
  const toggleGraph = (g: LiveGraphKey) =>
    patch({ graphs: page.graphs.includes(g) ? page.graphs.filter((x) => x !== g) : [...page.graphs, g].slice(-2) });

  // Same proportions as the live page on a landscape phone (screen minus the top strip).
  const pw = Math.min(width - spacing.lg * 2, 760);
  const ph = Math.round(pw * 0.42);
  const unused = METRIC_KEYS.filter((k) => !page.tiles.includes(k));

  return (
    <Screen edges={['left', 'right']} scroll={false} padded={false}>
      <Stack.Screen options={{ title: 'Live pages' }} />
      <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
        <Text size="sm" tone="dim">
          Swipe between these pages while rowing. Everything on a page always fits the screen: tiles share the space the graphs leave.
        </Text>
        <SectionTitle right={<Button title="Save as layout" variant="ghost" small onPress={saveAsLayout} />}>Saved layouts</SectionTitle>
        {layouts.length === 0 ? (
          <Text size="sm" tone="faint">
            Save your current pages as a named layout, then switch between layouts here. Edits to pages update the active layout.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {layouts.map((l) => (
              <Chip key={l.id} label={l.name || 'Layout'} selected={l.id === activeId} onPress={() => update(activateLayout(cur(), l.id))} />
            ))}
          </View>
        )}
        {active ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField label="Layout name" value={active.name} onChangeText={(n) => update(renameLayout(cur(), active.id, n))} />
            </View>
            <IconButton icon="trash-outline" label="Delete layout" color={t.bad} onPress={() => removeLayout(active.id, active.name)} />
          </View>
        ) : null}
        <SectionTitle right={<Button title="Reset" variant="ghost" small onPress={reset} />}>Pages</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
          {pages.map((p, j) => (
            <Chip key={p.id} label={p.name || `Page ${j + 1}`} selected={j === i} onPress={() => setSel(j)} />
          ))}
          <Chip label="+ Add page" onPress={addPage} />
        </View>
        <Card style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField label="Page name" value={page.name} onChangeText={(name) => patch({ name })} />
            </View>
            {i > 0 ? <IconButton icon="arrow-back" label="Move page earlier" onPress={() => movePage(-1)} /> : null}
            {i < pages.length - 1 ? <IconButton icon="arrow-forward" label="Move page later" onPress={() => movePage(1)} /> : null}
            {pages.length > 1 ? <IconButton icon="trash-outline" label="Delete page" color={t.bad} onPress={deletePage} /> : null}
          </View>
          <Text size="xs" tone="faint">
            Long-press a tile and drag it onto another position. Tap × to remove it.
          </Text>
          <View style={{ alignSelf: 'center', padding: 4, borderRadius: radius.md, backgroundColor: t.bg }}>
            <PageLayout
              width={pw - 8}
              height={ph}
              tiles={sample}
              graphs={page.graphs}
              position={page.graphPosition}
              renderGraph={(g, w, h) => (
                <GraphFrame width={w} height={h}>
                  {() => (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="analytics-outline" size={22} color={t.textFaint} />
                      <Text size="sm" tone="faint">
                        {GRAPH_LABELS[g]}
                      </Text>
                    </View>
                  )}
                </GraphFrame>
              )}
              renderTile={(v, idx, box, boxes) => (
                <DragTile
                  v={v}
                  index={idx}
                  box={box}
                  boxes={boxes}
                  onDragging={setDragging}
                  onMove={(from, to) => patch({ tiles: moveItem(page.tiles, from, to) })}
                  onRemove={() => patch({ tiles: page.tiles.filter((k) => k !== v.id) })}
                />
              )}
            />
          </View>
        </Card>
        <SectionTitle>Add tiles</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {unused.map((k: MetricKey) => (
            <Chip key={k} label={`+ ${METRICS[k].label}`} onPress={() => patch({ tiles: [...page.tiles, k] })} />
          ))}
        </View>
        <SectionTitle>{`Graphs (up to 2, ${page.graphs.length} chosen)`}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {GRAPH_KEYS.map((g) => (
            <Chip key={g} label={GRAPH_LABELS[g]} selected={page.graphs.includes(g)} onPress={() => toggleGraph(g)} />
          ))}
        </View>
        <SectionTitle>Graph position</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {GRAPH_POSITIONS.map((p) => (
            <Chip key={p.key} label={p.label} selected={(page.graphPosition ?? 'auto') === p.key} onPress={() => patch({ graphPosition: p.key })} />
          ))}
        </View>
        <Text size="xs" tone="faint">
          Auto puts graphs on the right in landscape and below the tiles in portrait.
        </Text>
        {page.graphs
          .filter((g) => GRAPH_OPTIONS[g])
          .map((g) => (
            <View key={g} style={{ gap: spacing.xs }}>
              <Text size="sm" weight="700">
                {GRAPH_LABELS[g]} shows
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {GRAPH_OPTIONS[g]!.map((o) => (
                  <Chip
                    key={o.key}
                    label={o.label}
                    selected={graphOptions(page, g, forceDefault).includes(o.key)}
                    onPress={() => patch({ graphOptions: toggleOption(page, g, o.key, forceDefault) })}
                  />
                ))}
              </View>
            </View>
          ))}
      </ScrollView>
    </Screen>
  );
}

function DragTile({
  v,
  index,
  box,
  boxes,
  onMove,
  onRemove,
  onDragging,
}: {
  v: TileValue;
  index: number;
  box: Box;
  boxes: Box[];
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onDragging: (d: boolean) => void;
}) {
  const t = useTheme();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(250)
    .onStart(() => {
      lifted.value = 1;
      onDragging(true);
    })
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      const cx = box.x + box.w / 2 + e.translationX;
      const cy = box.y + box.h / 2 + e.translationY;
      const to = boxes.findIndex((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
      if (to >= 0 && to !== index) onMove(index, to);
    })
    .onFinalize(() => {
      tx.value = 0;
      ty.value = 0;
      lifted.value = 0;
      onDragging(false);
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: lifted.value ? 1.04 : 1 }],
    zIndex: lifted.value ? 10 : 0,
    opacity: lifted.value ? 0.85 : 1,
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityHint="Long-press and drag to move"
        style={[{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }, style]}>
        <MetricTile {...v} width={box.w} height={box.h} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${v.label}`}
          hitSlop={10}
          onPress={onRemove}
          style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt }}>
          <Ionicons name="close" size={14} color={t.bad} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}
