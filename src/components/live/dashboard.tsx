/** Live page pieces: fixed-size page layout, tiles, graphs, rest / waiting / connection panels. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { analyzeForceCurve } from '@/analysis';
import { emptyMetrics } from '@/core/defaults';
import type { LiveGraphKey, LiveMetrics, LivePageConfig, MetricKey, StrokeSample } from '@/core/types';
import { formatDelta, formatDuration, formatPace } from '@/core/units';
import { useSession } from '@/session';
import { useSettings } from '@/storage/settings';
import { Text } from '@/ui/kit';
import { ShellIcon } from '@/ui/ShellIcon';
import { font, radius, spacing, useTheme } from '@/ui/theme';

import { ForceCurvePanel } from './ForceCurve';
import { type MetricValue, type TileValue, tileValues } from './metrics';
import { PaceBoat } from './overlays';
import { buildPaceHistory } from './paceHistory';
import {
  type Box,
  computeProgress,
  currentTarget,
  formatIntervalValue,
  layoutPage,
  type LiveProgress,
  type LiveTone,
  nextRep,
  repIndex,
  repLabel,
  tileFonts,
} from './progress';

const EMPTY = emptyMetrics();
const GAP = spacing.sm;
const WINDOW = 60;

export const GRAPH_LABELS: Record<LiveGraphKey, string> = {
  forceCurve: 'Force curve',
  paceRate: 'Pace & rate',
  paceHistory: 'Split over piece',
  watts: 'Watts',
  heartRate: 'Heart rate',
  strokeScore: 'Stroke score',
  splits: 'Splits',
  paceBoat: 'Pace boat',
};

export function useLiveMetrics(): LiveMetrics {
  return useSession((s) => s.metrics) ?? EMPTY;
}

export function useLiveProgress(): LiveProgress | null {
  const m = useLiveMetrics();
  const plan = useSession((s) => s.plan);
  const splits = useSession((s) => s.splits);
  return useMemo(() => computeProgress(plan, m, splits), [plan, m, splits]);
}

const abs = (b: Box) => ({ position: 'absolute' as const, left: b.x, top: b.y, width: b.w, height: b.h });

/* ───────────── Metric tiles ───────────── */

function toneColor(t: ReturnType<typeof useTheme>, tone: LiveTone | undefined, zone: MetricValue['zone']): string {
  if (zone) return t.zones[zone - 1];
  switch (tone) {
    case 'good':
      return t.good;
    case 'warn':
      return t.warn;
    case 'bad':
      return t.bad;
    case 'accent':
      return t.accent;
    case 'dim':
      return t.textDim;
    default:
      return t.text;
  }
}

/** A tile that scales its numbers to its box. */
export const MetricTile = memo(function MetricTile({ label, value, unit, tone, zone, width, height }: TileValue & { width: number; height: number }) {
  const t = useTheme();
  const color = toneColor(t, tone, zone);
  const f = tileFonts(width, height, value.length);
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${value} ${unit ?? ''}`}
      style={{
        width,
        height,
        backgroundColor: t.surface,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: zone || (tone && tone !== 'default') ? color : t.border,
        paddingHorizontal: spacing.sm,
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <Text numberOfLines={1} tone="faint" weight="700" style={{ fontSize: f.label, lineHeight: f.label * 1.3, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {unit ? `${label} · ${unit}` : label}
      </Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[font.metric, { color, fontSize: f.value, lineHeight: f.value * 1.1 }]}>
        {value}
      </Text>
    </View>
  );
});

/**
 * One live page drawn into exactly width×height. Shared by the live screen and the
 * dashboard editor preview (which passes its own tile / graph renderers).
 */
export function PageLayout({
  width,
  height,
  tiles,
  graphs,
  renderGraph,
  renderTile,
}: {
  width: number;
  height: number;
  tiles: TileValue[];
  graphs: LiveGraphKey[];
  renderGraph: (g: LiveGraphKey, w: number, h: number) => React.ReactNode;
  /** Must position itself at `box` (absolute). */
  renderTile?: (v: TileValue, index: number, box: Box, all: Box[]) => React.ReactNode;
}) {
  const L = layoutPage(width, height, tiles.length, graphs.length, GAP);
  return (
    <View style={{ width, height }}>
      {graphs.map((g, i) => (
        <View key={`${g}${i}`} style={abs(L.graphs[i])}>
          {renderGraph(g, L.graphs[i].w, L.graphs[i].h)}
        </View>
      ))}
      {tiles.map((v, i) => (
        <React.Fragment key={v.id}>
          {renderTile ? (
            renderTile(v, i, L.tiles[i], L.tiles)
          ) : (
            <View style={abs(L.tiles[i])}>
              <MetricTile {...v} width={L.tiles[i].w} height={L.tiles[i].h} />
            </View>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

function useTileValues(keys: readonly MetricKey[]): TileValue[] {
  const profile = useSettings((s) => s.settings.profile);
  const forceUnit = useSettings((s) => s.settings.forceUnit);
  const m = useLiveMetrics();
  const plan = useSession((s) => s.plan);
  const paceBoat = useSession((s) => s.paceBoat);
  const analysis = useSession((s) => s.lastStrokeAnalysis);
  const machine = useSession((s) => s.connection.device?.machineType);
  const progress = useLiveProgress();
  return useMemo(
    () => tileValues(keys, { machine, m, profile, forceUnit, plan, paceBoat, analysis, progress, target: currentTarget(plan, m, progress) }),
    [keys, m, profile, forceUnit, plan, paceBoat, analysis, progress, machine],
  );
}

/** Store-connected live page. */
export function LivePageView({ page, width, height }: { page: LivePageConfig; width: number; height: number }) {
  const tiles = useTileValues(page.tiles);
  return (
    <PageLayout
      width={width}
      height={height}
      tiles={tiles}
      graphs={page.graphs.slice(0, 2)}
      renderGraph={(g, w, h) => <LiveGraph kind={g} width={w} height={h} />}
    />
  );
}

/* ───────────── Graphs ───────────── */

const PAD = spacing.sm;

/** Card frame; children get the inner size. */
export function GraphFrame({ width, height, children }: { width: number; height: number; children: (w: number, h: number) => React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ width, height, padding: PAD, borderRadius: radius.md, backgroundColor: t.surface, overflow: 'hidden' }}>
      {children(Math.max(0, width - PAD * 2), Math.max(0, height - PAD * 2))}
    </View>
  );
}

export function LiveGraph({ kind, width, height }: { kind: LiveGraphKey; width: number; height: number }) {
  return (
    <GraphFrame width={width} height={height}>
      {(w, h) => {
        switch (kind) {
          case 'forceCurve':
            return <ForceCurvePanel width={w} height={h} />;
          case 'splits':
            return <SplitsTable height={h} />;
          case 'paceBoat':
            return <PaceBoat width={w} height={h} />;
          case 'paceHistory':
            return <PaceHistoryGraph width={w} height={h} />;
          default:
            return <StrokeGraph kind={kind} width={w} height={h} />;
        }
      }}
    </GraphFrame>
  );
}

const scoreCache = new WeakMap<StrokeSample, number>();
function strokeScore(s: StrokeSample, heightCm: number | null | undefined): number {
  let v = scoreCache.get(s);
  if (v === undefined) {
    const a = analyzeForceCurve(s.forceCurve, {
      driveTimeMs: s.driveTimeMs,
      recoveryTimeMs: s.recoveryTimeMs,
      driveLengthM: s.driveLengthM,
      strokeRate: s.strokeRate,
      heightCm: heightCm ?? undefined,
    });
    v = a.valid ? a.score : 0;
    scoreCache.set(s, v);
  }
  return v;
}

interface Series {
  label: string;
  color: string;
  values: number[];
  /** Plot lower values higher (pace: faster = higher). */
  invert?: boolean;
  format: (v: number) => string;
}

const int = (v: number) => (v > 0 ? String(Math.round(v)) : '–');

/** Rolling graph of the last 60 strokes. */
const StrokeGraph = memo(function StrokeGraph({ kind, width, height }: { kind: Exclude<LiveGraphKey, 'forceCurve' | 'splits' | 'paceBoat' | 'paceHistory'>; width: number; height: number }) {
  const t = useTheme();
  const strokes = useSession((s) => s.strokes);
  const heightCm = useSettings((s) => s.settings.profile.heightCm);
  const machine = useSession((s) => s.connection.device?.machineType);
  const win = strokes.slice(-WINDOW);
  const series: Series[] = (() => {
    switch (kind) {
      case 'paceRate':
        return [
          { label: 'Pace', color: t.pace, values: win.map((s) => s.paceMsPer500), invert: true, format: (v) => formatPace(v, machine) },
          { label: 'Rate', color: t.rate, values: win.map((s) => s.strokeRate), format: int },
        ];
      case 'watts':
        return [{ label: 'Watts', color: t.watts, values: win.map((s) => s.watts), format: int }];
      case 'heartRate':
        return [{ label: 'Heart rate', color: t.heart, values: win.map((s) => s.heartRate ?? 0), format: int }];
      case 'strokeScore':
        return [{ label: 'Stroke score', color: t.accent, values: win.map((s) => strokeScore(s, heightCm)), format: int }];
    }
  })();
  const chartH = Math.max(0, height - 20);
  const paths = series.map((se) => buildPath(se.values, se.invert ?? false, width, chartH));
  const any = paths.some(Boolean);
  return (
    <View style={{ width, height }} accessibilityLabel={`${GRAPH_LABELS[kind]} over the last ${WINDOW} strokes`}>
      <View style={{ height: 20, flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        {series.map((se) => (
          <Text key={se.label} size="xs" weight="700" style={{ color: se.color }}>
            {se.label.toUpperCase()} {se.format(se.values[se.values.length - 1] ?? 0)}
          </Text>
        ))}
        <Text size="xs" tone="faint" style={{ marginLeft: 'auto' }}>
          last {win.length} strokes
        </Text>
      </View>
      {any ? (
        <Svg width={width} height={chartH}>
          {paths.map((d, i) => (d ? <Path key={i} d={d} stroke={series[i].color} strokeWidth={i === 0 ? 2.5 : 2} fill="none" /> : null))}
        </Svg>
      ) : (
        <Text size="sm" tone="faint">
          Builds up as you row.
        </Text>
      )}
    </View>
  );
});

/** Split over the whole piece (faster = higher) with the plan / pace-boat target line. */
const PaceHistoryGraph = memo(function PaceHistoryGraph({ width, height }: { width: number; height: number }) {
  const t = useTheme();
  const strokes = useSession((s) => s.strokes);
  const plan = useSession((s) => s.plan);
  const boatPace = useSession((s) => s.paceBoat?.targetPaceMsPer500 ?? null);
  const machine = useSession((s) => s.connection.device?.machineType);
  const m = useLiveMetrics();
  const progress = useLiveProgress();
  const intervalPace = currentTarget(plan, m, progress).paceMsPer500;
  const flat = intervalPace ?? (boatPace && boatPace > 0 ? boatPace : null);
  const h = useMemo(() => buildPaceHistory({ strokes, plan, flatTargetMsPer500: flat }), [strokes, plan, flat]);
  const AX = 44;
  const headH = 20;
  const cw = Math.max(0, width - AX);
  const ch = Math.max(0, height - headH);
  const px = (x: number) => (x / h.xMax) * cw;
  const py = (v: number) => ((v - h.yMin) / (h.yMax - h.yMin)) * ch;
  const { dMain, dTarget } = useMemo(() => {
    const line = (pts: [number, number][]) =>
      pts.length > 1 ? pts.map(([x, v], i) => `${i ? 'L' : 'M'}${((x / h.xMax) * cw).toFixed(1)},${(((v - h.yMin) / (h.yMax - h.yMin)) * ch).toFixed(1)}`).join('') : '';
    return { dMain: line(h.points), dTarget: line(h.target) };
  }, [h, cw, ch]);
  const gap = h.current && h.targetNow ? h.current[1] - h.targetNow : null;
  const ticks = [h.yMin + (h.yMax - h.yMin) * 0.1, (h.yMin + h.yMax) / 2, h.yMax - (h.yMax - h.yMin) * 0.1];
  return (
    <View style={{ width, height }} accessibilityLabel={`Split over the piece${gap !== null ? `, ${formatDelta(gap)} versus target` : ''}`}>
      <View style={{ height: headH, flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Text size="xs" weight="700" style={{ color: t.pace }}>
          SPLIT {formatPace(h.current?.[1] ?? 0, machine)}
        </Text>
        {gap !== null ? (
          <Text size="xs" weight="700" tone={gap <= 500 ? 'good' : gap <= 2000 ? 'warn' : 'bad'}>
            {formatDelta(gap)} vs target
          </Text>
        ) : null}
        <Text size="xs" tone="faint" style={{ marginLeft: 'auto' }}>
          {h.xUnit === 'distance' ? `${Math.round(h.xMax)} m` : formatDuration(h.xMax, { tenths: false })}
        </Text>
      </View>
      {dMain ? (
        <View style={{ height: ch, flexDirection: 'row' }}>
          <View style={{ width: AX }}>
            {ticks.map((v, i) => (
              <Text key={i} size="xs" tone="faint" style={[font.metric, { position: 'absolute', right: 4, top: Math.min(ch - 14, Math.max(0, py(v) - 7)) }]}>
                {formatPace(v, machine)}
              </Text>
            ))}
          </View>
          <Svg width={cw} height={ch}>
            {ticks.map((v, i) => (
              <Line key={i} x1={0} x2={cw} y1={py(v)} y2={py(v)} stroke={t.border} strokeWidth={StyleSheet.hairlineWidth} />
            ))}
            {dTarget ? <Path d={dTarget} stroke={t.textFaint} strokeWidth={2} strokeDasharray="6,4" fill="none" /> : null}
            <Path d={dMain} stroke={t.pace} strokeWidth={2.5} fill="none" />
            {h.current ? <Circle cx={Math.min(cw - 4, px(h.current[0]))} cy={py(h.current[1])} r={4.5} fill={t.pace} stroke={t.surface} strokeWidth={1.5} /> : null}
          </Svg>
        </View>
      ) : (
        <Text size="sm" tone="faint">
          Builds up as you row.
        </Text>
      )}
    </View>
  );
});

function buildPath(vals: number[], invert: boolean, w: number, h: number): string {
  const good = vals.filter((v) => v > 0);
  if (good.length < 2 || w <= 0 || h <= 0) return '';
  let lo = Math.min(...good);
  let hi = Math.max(...good);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  let d = '';
  vals.forEach((v, i) => {
    if (!(v > 0)) return;
    const x = (i / (WINDOW - 1)) * w;
    const n = (v - lo) / (hi - lo);
    const y = invert ? n * h : h - n * h;
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return d;
}

const ROW_H = 24;
const COLS = ['#', 'Time', 'Dist', 'Pace', 'W', 'Rate', 'HR'] as const;

/** Most recent splits that fit the height, newest at the bottom, plus the split in progress. */
export const SplitsTable = memo(function SplitsTable({ height }: { height: number }) {
  const t = useTheme();
  const splits = useSession((s) => s.splits);
  const machine = useSession((s) => s.connection.device?.machineType);
  const m = useLiveMetrics();
  const live = m.strokeCount > 0;
  const fit = Math.max(1, Math.floor((height - ROW_H) / ROW_H) - (live ? 1 : 0));
  const row = (cells: string[], key: string | number, bold?: boolean) => (
    <View key={key} style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }}>
      {cells.map((v, i) => (
        <Text key={i} size="sm" numberOfLines={1} weight={bold ? '700' : undefined} style={[font.metric, { flex: i === 0 ? 0.5 : 1, textAlign: i === 0 ? 'left' : 'right' }]}>
          {v}
        </Text>
      ))}
    </View>
  );
  return (
    <View style={{ height, overflow: 'hidden' }}>
      <View style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center' }}>
        {COLS.map((c, i) => (
          <Text key={c} size="xs" tone="faint" weight="700" style={{ flex: i === 0 ? 0.5 : 1, textAlign: i === 0 ? 'left' : 'right' }}>
            {c.toUpperCase()}
          </Text>
        ))}
      </View>
      {splits.length === 0 && !live ? <Text tone="faint">Splits appear here as you complete them.</Text> : null}
      {splits.slice(-fit).map((s) =>
        row(
          [
            String(s.index + 1),
            formatDuration(s.splitTimeMs),
            `${Math.round(s.splitDistanceM)}`,
            formatPace(s.avgPaceMsPer500, machine),
            int(s.avgWatts),
            int(s.avgStrokeRate),
            s.avgHeartRate ? String(Math.round(s.avgHeartRate)) : '–',
          ],
          s.index,
        ),
      )}
      {live ? row(['›', 'now', '', formatPace(m.splitAvgPaceMsPer500, machine), int(m.splitAvgWatts), '', ''], 'now', true) : null}
    </View>
  );
});

/* ───────────── Rest / waiting ───────────── */

/** Full-area rest panel: countdown and the next rep's target. */
export const RestPanel = memo(function RestPanel({ width, height }: { width: number; height: number }) {
  const t = useTheme();
  const m = useLiveMetrics();
  const plan = useSession((s) => s.plan);
  const machine = useSession((s) => s.connection.device?.machineType);
  const next = nextRep(plan, m);
  const undefinedRest = m.intervalType === 'rest-undefined' || (plan?.intervals?.[plan.repeatForever ? 0 : repIndex(plan, m)]?.undefinedRest ?? false);
  const tgt = next?.def.target ?? plan?.target;
  const targetBits = [tgt?.paceMsPer500 ? `@ ${formatPace(tgt.paceMsPer500, machine)}` : null, tgt?.strokeRate ? `${tgt.strokeRate} spm` : null].filter(Boolean);
  const big = Math.max(40, Math.min(height * 0.45, width * 0.3));
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ width, height, backgroundColor: t.warn + '22', borderColor: t.warn, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.xs }}>
      <Text weight="800" tone="warn" style={{ letterSpacing: 6, fontSize: Math.min(40, big * 0.3) }}>
        REST
      </Text>
      {undefinedRest ? (
        <Text size="xl" weight="700" style={{ textAlign: 'center' }}>
          Start rowing when you are ready
        </Text>
      ) : (
        <Text style={[font.metric, { color: t.text, fontSize: big, lineHeight: big * 1.1 }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatDuration(m.restTimeRemainingMs, { tenths: false })}
        </Text>
      )}
      <Text size="xl" tone="dim" style={{ textAlign: 'center' }} numberOfLines={2} adjustsFontSizeToFit>
        {next
          ? `Next: ${repLabel(next.index, next.total)} · ${formatIntervalValue(next.def)}${targetBits.length ? ` ${targetBits.join(' · ')}` : ''}`
          : 'Last interval done'}
      </Text>
    </View>
  );
});

export function WaitingPanel() {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderColor: t.accent, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.xs, maxWidth: 420 }}>
      <ShellIcon size={32} color={t.accent} />
      <Text size="xxl" weight="800" tone="accent">
        Row to begin
      </Text>
      <Text tone="dim" style={{ textAlign: 'center' }}>
        The monitor is armed — the clock starts on your first stroke.
      </Text>
    </View>
  );
}

/* ───────────── Connection banner ───────────── */

export function ConnectionBanner() {
  const t = useTheme();
  const status = useSession((s) => s.connection.status);
  const error = useSession((s) => s.connection.error);
  if (status === 'connected') return null;
  const reconnecting = status === 'reconnecting' || status === 'connecting';
  const color = reconnecting ? t.warn : t.bad;
  const text = reconnecting ? 'Connection lost — reconnecting…' : status === 'error' ? `Erg error: ${error ?? 'unknown'}` : 'Erg disconnected';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. Tap to open connection settings.`}
      onPress={() => router.push('/connect')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: t.surface, borderWidth: 1, borderColor: color }}>
      <Ionicons name={reconnecting ? 'sync' : 'bluetooth'} size={20} color={color} />
      <Text weight="700" style={{ color, flex: 1 }}>
        {text}
      </Text>
      {!reconnecting ? (
        <Text weight="700" style={{ color }}>
          Reconnect
        </Text>
      ) : null}
    </Pressable>
  );
}
