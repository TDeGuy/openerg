/** Graphs over the whole piece: pace (with the race plan), watts, rate, heart rate, drive ratio, peak force, split bars. */
import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { heartRateBands } from '@/analysis';
import { emptyMetrics } from '@/core/defaults';
import type { LiveGraphKey, StrokeSample } from '@/core/types';
import { convertForce, formatDelta, formatDuration, formatPace } from '@/core/units';
import { useSession } from '@/session';
import { useSettings } from '@/storage/settings';
import { Text } from '@/ui/kit';
import { font, spacing, useTheme } from '@/ui/theme';

import { buildPaceHistory, buildPiece, valueRange } from './paceHistory';
import { currentTarget, computeProgress, repIndex } from './progress';

const AX = 44;
const HEAD = 20;
const XAX = 14;
const EMPTY = emptyMetrics();

interface ChartLine {
  pts: [number, number][];
  color: string;
  dash?: string;
  width?: number;
}

const xLabel = (unit: 'distance' | 'time', x: number) => (unit === 'distance' ? `${Math.round(x)}m` : formatDuration(x, { tenths: false }));

/** Shared chart: y axis ticks, optional zone bands, lines, plan-change markers and the current-point dot. */
function PieceChart({
  width,
  height,
  head,
  unit,
  xMin,
  xMax,
  yMin,
  yMax,
  invert,
  fmt,
  lines,
  markers = [],
  bands = [],
  dot,
  label,
}: {
  width: number;
  height: number;
  head: React.ReactNode;
  unit: 'distance' | 'time';
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Lower values plot higher (pace). */
  invert?: boolean;
  fmt: (v: number) => string;
  lines: ChartLine[];
  markers?: { x: number; label: string }[];
  bands?: { lo: number; hi: number; color: string }[];
  dot: { x: number; y: number; color: string } | null;
  label: string;
}) {
  const t = useTheme();
  const cw = Math.max(0, width - AX);
  const ch = Math.max(0, height - HEAD - XAX);
  const px = (x: number) => ((x - xMin) / (xMax - xMin || 1)) * cw;
  const py = (v: number) => {
    const n = (v - yMin) / (yMax - yMin || 1);
    return (invert ? n : 1 - n) * ch;
  };
  const geo = useMemo(() => {
    const d = (pts: [number, number][]) => (pts.length > 1 ? pts.map(([x, v], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(v).toFixed(1)}`).join('') : '');
    let lastX = -1e9;
    const marks = markers.map((m) => ({ ...m, x: px(m.x) })).filter((m) => (m.x - lastX >= 52 ? ((lastX = m.x), true) : false));
    return { paths: lines.map((l) => d(l.pts)), marks };
    // px / py depend only on the values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, markers, cw, ch, xMin, xMax, yMin, yMax, invert]);
  const ticks = [yMin + (yMax - yMin) * 0.1, (yMin + yMax) / 2, yMax - (yMax - yMin) * 0.1];
  const hasData = geo.paths.some(Boolean);
  return (
    <View style={{ width, height }} accessibilityLabel={label}>
      <View style={{ height: HEAD, flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>{head}</View>
      {hasData ? (
        <View style={{ height: ch + XAX }}>
          <View style={{ height: ch, flexDirection: 'row' }}>
            <View style={{ width: AX }}>
              {ticks.map((v, i) => (
                <Text key={i} size="xs" tone="faint" style={[font.metric, { position: 'absolute', right: 4, top: Math.min(ch - 14, Math.max(0, py(v) - 7)) }]}>
                  {fmt(v)}
                </Text>
              ))}
            </View>
            <Svg width={cw} height={ch}>
              {bands.map((b, i) => {
                const a = Math.min(py(b.lo), py(b.hi));
                const z = Math.max(py(b.lo), py(b.hi));
                const top = Math.max(0, a);
                const bot = Math.min(ch, z);
                return bot > top ? <Rect key={i} x={0} y={top} width={cw} height={bot - top} fill={b.color} fillOpacity={0.18} /> : null;
              })}
              {ticks.map((v, i) => (
                <Line key={i} x1={0} x2={cw} y1={py(v)} y2={py(v)} stroke={t.border} strokeWidth={StyleSheet.hairlineWidth} />
              ))}
              {geo.marks.map((m, i) => (
                <React.Fragment key={i}>
                  <Line x1={m.x} x2={m.x} y1={0} y2={ch} stroke={t.textDim} strokeWidth={1} strokeDasharray="2,3" />
                  <SvgText x={m.x + (m.x > cw - 60 ? -3 : 3)} y={11} fontSize={11} fontWeight="700" fill={t.text} textAnchor={m.x > cw - 60 ? 'end' : 'start'}>
                    {m.label}
                  </SvgText>
                </React.Fragment>
              ))}
              {lines.map((l, i) => (geo.paths[i] ? <Path key={i} d={geo.paths[i]!} stroke={l.color} strokeWidth={l.width ?? 2} strokeDasharray={l.dash} fill="none" /> : null))}
              {dot ? <Circle cx={Math.min(cw - 4, Math.max(4, px(dot.x)))} cy={py(dot.y)} r={4.5} fill={dot.color} stroke={t.surface} strokeWidth={1.5} /> : null}
            </Svg>
          </View>
          <View style={{ height: XAX, marginLeft: AX, flexDirection: 'row', justifyContent: 'space-between' }}>
            {[xMin, (xMin + xMax) / 2, xMax].map((x, i) => (
              <Text key={i} size="xs" tone="faint">
                {xLabel(unit, x)}
              </Text>
            ))}
          </View>
        </View>
      ) : (
        <Text size="sm" tone="faint">
          Builds up as you row.
        </Text>
      )}
    </View>
  );
}

/** Split over the piece (faster = higher) with average, plan target + change markers and the pace-boat line. */
export const PaceHistoryGraph = memo(function PaceHistoryGraph({ width, height, options }: { width: number; height: number; options: string[] }) {
  const t = useTheme();
  const strokes = useSession((s) => s.strokes);
  const plan = useSession((s) => s.plan);
  const splits = useSession((s) => s.splits);
  const boat = useSession((s) => s.paceBoat?.targetPaceMsPer500 ?? null);
  const machine = useSession((s) => s.connection.device?.machineType);
  const m = useSession((s) => s.metrics) ?? EMPTY;
  const rep = plan?.kind === 'intervals' ? repIndex(plan, m) : null;
  const flat = currentTarget(plan, m, computeProgress(plan, m, splits)).paceMsPer500;
  const on = (k: string) => options.includes(k);
  const avgPace = on('avg') ? m.avgPaceMsPer500 : null;
  const boatPace = on('boat') && boat && boat > 0 ? boat : null;
  // Recomputed per stroke / option change, not per frame.
  const h = useMemo(
    () => buildPaceHistory({ strokes, plan, rep, flatTargetMsPer500: flat, boatPaceMsPer500: boatPace, avgPaceMsPer500: avgPace, showPlan: on('plan') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strokes, plan, rep, flat, boatPace, avgPace, options.join()],
  );
  const lines = useMemo<ChartLine[]>(
    () => [
      { pts: h.avg, color: t.textDim, dash: '2,4', width: 1.5 },
      { pts: h.boat, color: t.accent, dash: '3,3', width: 2 },
      { pts: h.target, color: t.textFaint, dash: '6,4', width: 2 },
      { pts: h.points, color: t.pace, width: 2.5 },
    ],
    [h, t],
  );
  const gap = h.current && h.targetNow ? h.current[1] - h.targetNow : null;
  return (
    <PieceChart
      width={width}
      height={height}
      unit={h.xUnit}
      xMin={h.xMin}
      xMax={h.xMax}
      yMin={h.yMin}
      yMax={h.yMax}
      invert
      fmt={(v) => formatPace(v, machine)}
      lines={lines}
      markers={on('markers') ? h.markers : undefined}
      dot={h.current ? { x: h.current[0], y: h.current[1], color: t.pace } : null}
      label={`Split over the piece${gap !== null ? `, ${formatDelta(gap)} versus target` : ''}`}
      head={
        <>
          <Text size="xs" weight="700" style={{ color: t.pace }}>
            SPLIT {formatPace(h.current?.[1] ?? 0, machine)}
          </Text>
          {gap !== null ? (
            <Text size="xs" weight="700" tone={gap <= 500 ? 'good' : gap <= 2000 ? 'warn' : 'bad'}>
              {formatDelta(gap)} vs target
            </Text>
          ) : null}
        </>
      }
    />
  );
});

type SeriesKind = Extract<LiveGraphKey, 'wattsHistory' | 'rateHistory' | 'hrHistory' | 'ratioTrend' | 'peakForceTrend'>;

const int = (v: number) => String(Math.round(v));

/** Watts / rate / heart rate / drive ratio / peak force over the piece. */
export const SeriesGraph = memo(function SeriesGraph({ kind, width, height, options }: { kind: SeriesKind; width: number; height: number; options: string[] }) {
  const t = useTheme();
  const strokes = useSession((s) => s.strokes);
  const plan = useSession((s) => s.plan);
  const m = useSession((s) => s.metrics) ?? EMPTY;
  const profile = useSettings((s) => s.settings.profile);
  const forceUnit = useSettings((s) => s.settings.forceUnit);
  const rep = plan?.kind === 'intervals' ? repIndex(plan, m) : null;
  const spec = useMemo(() => {
    const ratio = (s: StrokeSample) => (s.driveTimeMs > 0 && s.recoveryTimeMs > 0 ? s.recoveryTimeMs / s.driveTimeMs : 0);
    switch (kind) {
      case 'wattsHistory':
        return { name: 'WATTS', color: t.watts, value: (s: StrokeSample) => s.watts, fmt: int, span: 40 };
      case 'rateHistory':
        return { name: 'RATE', color: t.rate, value: (s: StrokeSample) => s.strokeRate, fmt: int, span: 6 };
      case 'hrHistory':
        return { name: 'HEART RATE', color: t.heart, value: (s: StrokeSample) => s.heartRate ?? 0, fmt: int, span: 30 };
      case 'ratioTrend':
        return { name: 'RATIO', color: t.accent, value: ratio, fmt: (v: number) => `1:${v.toFixed(1)}`, span: 1 };
      case 'peakForceTrend':
        return { name: `PEAK FORCE ${forceUnit}`, color: t.force, value: (s: StrokeSample) => convertForce(s.peakForceN, forceUnit), fmt: (v: number) => (forceUnit === 'N' ? int(v) : v.toFixed(1)), span: forceUnit === 'N' ? 100 : 10 };
    }
  }, [kind, t, forceUnit]);
  const piece = useMemo(() => buildPiece({ strokes, plan, rep, value: spec.value }), [strokes, plan, rep, spec]);
  const bands = useMemo(() => {
    const b = kind === 'hrHistory' && options.includes('zones') ? heartRateBands(profile) : null;
    return (b ?? []).map(([lo, hi], i) => ({ lo, hi, color: t.zones[i]! }));
  }, [kind, options, profile, t]);
  const avg = kind === 'wattsHistory' && options.includes('avg') && m.avgWatts > 0 ? m.avgWatts : 0;
  const { yMin, yMax } = useMemo(() => valueRange([...piece.points.map((p) => p[1]), ...(avg ? [avg] : [])], spec.span), [piece, avg, spec]);
  const lines = useMemo<ChartLine[]>(
    () => [...(avg ? [{ pts: [[piece.xMin, avg], [piece.xMax, avg]] as [number, number][], color: t.textDim, dash: '2,4', width: 1.5 }] : []), { pts: piece.points, color: spec.color, width: 2.5 }],
    [piece, avg, spec, t],
  );
  return (
    <PieceChart
      width={width}
      height={height}
      unit={piece.xUnit}
      xMin={piece.xMin}
      xMax={piece.xMax}
      yMin={yMin}
      yMax={yMax}
      fmt={spec.fmt}
      lines={lines}
      bands={bands}
      dot={piece.current ? { x: piece.current[0], y: piece.current[1], color: spec.color } : null}
      label={`${spec.name.toLowerCase()} over the piece`}
      head={
        <Text size="xs" weight="700" style={{ color: spec.color }}>
          {spec.name} {piece.current ? spec.fmt(piece.current[1]) : '–'}
        </Text>
      }
    />
  );
});

/** One bar per completed split, faster = taller; the fastest is highlighted. */
export const SplitBars = memo(function SplitBars({ width, height }: { width: number; height: number }) {
  const t = useTheme();
  const splits = useSession((s) => s.splits);
  const machine = useSession((s) => s.connection.device?.machineType);
  const BAR = 44;
  const shown = splits.filter((s) => s.avgPaceMsPer500 > 0).slice(-Math.max(1, Math.floor(width / BAR)));
  const paces = shown.map((s) => s.avgPaceMsPer500);
  const lo = Math.min(...paces);
  const hi = Math.max(...paces);
  const labelH = 16;
  const ch = Math.max(0, height - labelH);
  if (!shown.length) {
    return (
      <Text size="sm" tone="faint">
        Split bars appear as you complete splits.
      </Text>
    );
  }
  const bw = Math.min(BAR, width / shown.length);
  return (
    <Svg width={width} height={height} accessibilityLabel="Split pace per completed split">
      {shown.map((s, i) => {
        const bh = ch * (hi - lo < 500 ? 0.8 : 0.35 + (0.65 * (hi - s.avgPaceMsPer500)) / (hi - lo));
        const x = i * bw;
        return (
          <React.Fragment key={s.index}>
            <Rect x={x + 3} y={height - bh} width={bw - 6} height={bh - labelH} fill={s.avgPaceMsPer500 === lo ? t.good : t.pace} fillOpacity={0.85} />
            <SvgText x={x + bw / 2} y={height - bh - 4 + 0} fontSize={11} fontWeight="700" fill={t.text} textAnchor="middle">
              {formatPace(s.avgPaceMsPer500, machine)}
            </SvgText>
            <SvgText x={x + bw / 2} y={height - 3} fontSize={10} fill={t.textFaint} textAnchor="middle">
              {s.index + 1}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
});
