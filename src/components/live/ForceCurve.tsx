/** Live force curve: smooth filled current stroke, toggleable overlays, peak marker, stable y-axis. */
import React, { memo, useMemo, useRef } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { describeFlag, describeShape, idealForceCurve } from '@/analysis';
import type { AppSettings, ForceOverlay } from '@/core/types';
import { convertForce } from '@/core/units';
import { useSession } from '@/session';
import { useSettings } from '@/storage/settings';
import { Text } from '@/ui/kit';
import { type Palette, radius, spacing, useTheme } from '@/ui/theme';

import { type AxisState, curvePoints, nextAxisMax, smoothPath } from './progress';

type ForceUnit = AppSettings['forceUnit'];
const STEP: Record<ForceUnit, number> = { N: 100, kgf: 10, lbf: 25 };
const PAD_L = 34;
const PAD_B = 4;
const HEADER = 30;

/** Each overlay gets its own colour and dash so several can be read at once. */
const OVERLAYS: { key: ForceOverlay; label: string; dash?: string; color: (t: Palette) => string }[] = [
  { key: 'ideal', label: 'Ideal', dash: '7 4', color: (t) => t.good },
  { key: 'previous', label: 'Previous', dash: '2 4', color: (t) => t.textDim },
  { key: 'average', label: 'Average', color: (t) => t.rate },
];

interface OverlayCurve {
  key: ForceOverlay;
  curve: number[];
  color: string;
  dash?: string;
}

export const ForceCurveChart = memo(function ForceCurveChart({
  curve,
  overlays,
  unit,
  width: w,
  height,
}: {
  /** Newtons. */
  curve: number[];
  overlays: OverlayCurve[];
  unit: ForceUnit;
  width: number;
  height: number;
}) {
  const t = useTheme();
  const axis = useRef<AxisState>({ max: 0, low: 0 });

  const geo = useMemo(() => {
    // A single NaN would poison the axis and the whole SVG path.
    const conv = (c: number[]) => c.map((v) => (Number.isFinite(v) ? convertForce(v, unit) : 0));
    const cur = conv(curve);
    const ovs = overlays.map((o) => ({ ...o, curve: conv(o.curve) }));
    const peak = Math.max(0, ...cur, ...ovs.flatMap((o) => o.curve));
    if (peak > 0) axis.current = nextAxisMax(axis.current, peak, STEP[unit]);
    const yMax = axis.current.max || STEP[unit] * 4;
    const pw = Math.max(0, w - PAD_L);
    const ph = Math.max(0, height - PAD_B);
    const toPts = (c: number[]) => curvePoints(c, pw, ph, yMax).map((p) => ({ x: p.x + PAD_L, y: p.y }));
    const pts = toPts(cur);
    const line = smoothPath(pts, ph);
    const fill = line && pts.length ? `${line} L${pts[pts.length - 1].x},${ph} L${PAD_L},${ph} Z` : '';
    const ovLines = ovs.map((o) => ({ ...o, d: smoothPath(toPts(o.curve), ph) }));
    let peakPt: { x: number; y: number; v: number } | null = null;
    if (cur.length > 1) {
      let i = 0;
      cur.forEach((v, j) => {
        if (v > cur[i]) i = j;
      });
      if (pts[i]) peakPt = { x: pts[i].x, y: pts[i].y, v: cur[i] };
    }
    const grid = [0.25, 0.5, 0.75, 1].map((f) => ({ y: ph - f * ph, label: Math.round(f * yMax) }));
    return { line, fill, ovLines, peakPt, grid, ph };
  }, [curve, overlays, unit, w, height]);

  if (w <= 0 || height <= 0) return null;
  return (
    <Svg width={w} height={height} accessibilityLabel="Force curve of the last stroke">
      {geo.grid.map((g) => (
        <React.Fragment key={g.y}>
          <Line x1={PAD_L} x2={w} y1={g.y} y2={g.y} stroke={t.border} strokeDasharray="3 5" />
          <SvgText x={PAD_L - 4} y={g.y + 4} fontSize={10} fill={t.textFaint} textAnchor="end">
            {g.label}
          </SvgText>
        </React.Fragment>
      ))}
      <Line x1={PAD_L} x2={w} y1={geo.ph} y2={geo.ph} stroke={t.border} />
      {geo.fill ? <Path d={geo.fill} fill={t.force} fillOpacity={0.25} /> : null}
      {geo.ovLines.map((o) =>
        o.d ? <Path key={o.key} d={o.d} stroke={o.color} strokeWidth={2} strokeDasharray={o.dash} fill="none" /> : null,
      )}
      {geo.line ? <Path d={geo.line} stroke={t.force} strokeWidth={3} fill="none" strokeLinejoin="round" /> : null}
      {geo.peakPt ? (
        <>
          <Circle cx={geo.peakPt.x} cy={geo.peakPt.y} r={5} fill={t.force} stroke={t.surface} strokeWidth={2} />
          <SvgText
            x={Math.min(w - 4, Math.max(PAD_L + 4, geo.peakPt.x))}
            y={Math.max(12, geo.peakPt.y - 10)}
            fontSize={12}
            fontWeight="700"
            fill={t.text}
            textAnchor="middle">
            {unit === 'N' ? Math.round(geo.peakPt.v) : geo.peakPt.v.toFixed(1)}
          </SvgText>
        </>
      ) : null}
    </Svg>
  );
});

/** Legend chip that also toggles its overlay in settings. */
function OverlayChip({ label, color, dash, on, onPress }: { label: string; color: string; dash?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${label} overlay`}
      hitSlop={8}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: on ? 1 : 0.4 }}>
      <Svg width={16} height={6}>
        <Line x1={0} x2={16} y1={3} y2={3} stroke={color} strokeWidth={2} strokeDasharray={dash} />
      </Svg>
      <Text size="xs" weight="700" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Store-connected panel sized to its box: score, shape / first flag, overlay chips, chart. */
export const ForceCurvePanel = memo(function ForceCurvePanel({ width, height }: { width: number; height: number }) {
  const t = useTheme();
  const stroke = useSession((s) => s.lastStroke);
  const prev = useSession((s) => (s.strokes.length >= 2 ? s.strokes[s.strokes.length - 2] : null));
  const avg = useSession((s) => s.rollingAverageCurve);
  const analysis = useSession((s) => s.lastStrokeAnalysis);
  const enabled = useSettings((s) => s.settings.forceCurveOverlays);
  const unit = useSettings((s) => s.settings.forceUnit);
  const update = useSettings((s) => s.update);

  const curve = stroke?.forceCurve ?? [];
  const overlays = useMemo(() => {
    const source: Record<ForceOverlay, number[] | null> = {
      previous: prev?.forceCurve ?? null,
      average: avg,
      ideal: (() => {
        const peak = stroke?.peakForceN || Math.max(0, ...curve);
        return peak > 0 ? idealForceCurve(peak, 32) : null;
      })(),
    };
    return OVERLAYS.filter((o) => enabled.includes(o.key))
      .map((o) => ({ key: o.key, curve: source[o.key] ?? [], color: o.color(t), dash: o.dash }))
      .filter((o) => o.curve.length > 1);
  }, [enabled, prev, avg, stroke, curve, t]);

  const toggle = (k: ForceOverlay) =>
    update({ forceCurveOverlays: enabled.includes(k) ? enabled.filter((x) => x !== k) : [...enabled, k] });

  const valid = analysis?.valid ?? false;
  const scoreTone = !valid ? 'faint' : analysis!.score >= 80 ? 'good' : analysis!.score >= 60 ? 'warn' : 'bad';
  const flag = valid && analysis!.flags.length ? describeFlag(analysis!.flags[0]).title : null;
  const chartH = height - HEADER;

  return (
    <View style={{ width, height }}>
      <View style={{ height: HEADER, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text size="xl" weight="800" tone={scoreTone} accessibilityLabel="Stroke score">
          {valid ? Math.round(analysis!.score) : '–'}
        </Text>
        <Text size="sm" weight="700" numberOfLines={1} style={{ flex: 1 }} tone={flag ? 'warn' : 'default'}>
          {flag ?? (valid ? describeShape(analysis!.shape).title : curve.length ? 'Analysing…' : 'Force curve')}
        </Text>
        {OVERLAYS.map((o) => (
          <OverlayChip key={o.key} label={o.label} color={o.color(t)} dash={o.dash} on={enabled.includes(o.key)} onPress={() => toggle(o.key)} />
        ))}
        <Text size="xs" tone="faint">
          {unit}
        </Text>
      </View>
      {curve.length > 1 && curve.some((v) => v > 0) ? (
        <ForceCurveChart curve={curve} overlays={overlays} unit={unit} width={width} height={chartH} />
      ) : (
        <View style={{ height: chartH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: t.surfaceAlt }}>
          <Text tone="faint">{stroke ? 'No force data for this stroke' : 'Appears after the first stroke'}</Text>
        </View>
      )}
    </View>
  );
});
