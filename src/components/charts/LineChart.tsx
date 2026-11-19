import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { Text } from '@/ui/kit';
import { font, spacing, useTheme } from '@/ui/theme';

import { useChartWidth } from './useChartWidth';
import { usePinGesture } from './usePinGesture';
import {
  areaPath,
  cleanPoints,
  downsample,
  extent,
  linePath,
  linearScale,
  nearestIndex,
  niceTicks,
  padDomain,
  stepPath,
  type XY,
} from './util';

export interface LineSeries {
  key: string;
  label: string;
  points: readonly XY[];
  color: string;
  axis?: 'left' | 'right';
  dashed?: boolean;
  /** Draw as a staircase (plans / targets). */
  step?: boolean;
  width?: number;
  fill?: boolean;
  /** Formats this series' y value for the scrub readout. */
  format?: (y: number) => string;
  /** Exclude from the readout (e.g. reference overlays). */
  hideInReadout?: boolean;
}

export interface AxisSpec {
  format?: (v: number) => string;
  /** Flip so smaller values plot higher (pace: faster is up). */
  invert?: boolean;
  domain?: [number, number];
  ticks?: number;
}

export interface ReferenceLine {
  y: number;
  axis?: 'left' | 'right';
  color?: string;
  label?: string;
}

export interface LineChartProps {
  series: LineSeries[];
  height?: number;
  left?: AxisSpec;
  right?: AxisSpec;
  xFormat?: (x: number) => string;
  xDomain?: [number, number];
  xTicks?: number;
  maxPoints?: number;
  scrub?: boolean;
  onScrub?: (x: number | null) => void;
  references?: ReferenceLine[];
  /** Persistent vertical marker (e.g. currently selected stroke). */
  markerX?: number | null;
  showLegend?: boolean;
}

const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const AXIS_W = 46;

const defaultFmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toPrecision(3)).toString());

export function LineChart({
  series,
  height = 200,
  left,
  right,
  xFormat = defaultFmt,
  xDomain,
  xTicks = 4,
  maxPoints = 300,
  scrub = true,
  onScrub,
  references,
  markerX,
  showLegend = true,
}: LineChartProps) {
  const t = useTheme();
  const [width, onLayout] = useChartWidth();
  const [scrubX, setScrubX] = useState<number | null>(null);

  const hasRight = series.some((s) => s.axis === 'right' && s.points.length > 0);
  const padL = AXIS_W;
  const padR = hasRight ? AXIS_W : 12;

  // Downsample once per series change (independent of width).
  const reduced = useMemo(
    () => series.map((s) => ({ ...s, pts: downsample(cleanPoints(s.points), maxPoints) })),
    [series, maxPoints],
  );

  const geo = useMemo(() => {
    if (width <= padL + padR + 10) return null;
    const allX: number[] = [];
    const leftY: number[] = [];
    const rightY: number[] = [];
    for (const s of reduced) {
      for (const p of s.pts) {
        allX.push(p.x);
        (s.axis === 'right' ? rightY : leftY).push(p.y);
      }
    }
    for (const r of references ?? []) (r.axis === 'right' ? rightY : leftY).push(r.y);
    if (allX.length === 0) return null;
    const [x0, x1] = xDomain ?? extent(allX);
    const [l0, l1] = left?.domain ?? padDomain(...extent(leftY.length ? leftY : [0, 1]));
    const [r0, r1] = right?.domain ?? padDomain(...extent(rightY.length ? rightY : [0, 1]));
    const plotTop = PAD_TOP;
    const plotBottom = height - PAD_BOTTOM;
    const sx = linearScale(x0, x1 === x0 ? x0 + 1 : x1, padL, width - padR);
    const syL = left?.invert ? linearScale(l0, l1, plotTop, plotBottom) : linearScale(l0, l1, plotBottom, plotTop);
    const syR = right?.invert ? linearScale(r0, r1, plotTop, plotBottom) : linearScale(r0, r1, plotBottom, plotTop);
    const paths = reduced.map((s) => {
      const sy = s.axis === 'right' ? syR : syL;
      const scaled = s.pts.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
      return {
        key: s.key,
        d: s.step ? stepPath(scaled) : linePath(scaled),
        area: s.fill && !s.step ? areaPath(scaled, plotBottom) : '',
      };
    });
    return {
      x0,
      x1,
      sx,
      syL,
      syR,
      plotTop,
      plotBottom,
      paths,
      xt: niceTicks(x0, x1, xTicks),
      lt: niceTicks(l0, l1, left?.ticks ?? 4),
      rt: hasRight ? niceTicks(r0, r1, right?.ticks ?? 4) : [],
    };
  }, [width, height, reduced, references, xDomain, left, right, padL, padR, hasRight, xTicks]);

  const toDataX = useCallback(
    (px: number) => {
      if (!geo) return null;
      const f = (px - padL) / Math.max(1, width - padL - padR);
      const c = Math.min(1, Math.max(0, f));
      return geo.x0 + c * (geo.x1 - geo.x0);
    },
    [geo, padL, padR, width],
  );

  // Pinned state lives here so a re-render never drops it; null clears.
  const onPin = useCallback(
    (px: number | null) => {
      const x = px == null ? null : toDataX(px);
      setScrubX(x);
      onScrub?.(x);
    },
    [toDataX, onScrub],
  );
  const gesture = usePinGesture(scrub, scrubX != null, onPin);

  const readout = useMemo(() => {
    if (scrubX == null) return null;
    return reduced
      .filter((s) => !s.hideInReadout && s.pts.length > 0)
      .map((s) => {
        const i = nearestIndex(s.pts, scrubX);
        const p = s.pts[i];
        return { key: s.key, label: s.label, color: s.color, p, axis: s.axis, text: (s.format ?? defaultFmt)(p.y) };
      });
  }, [scrubX, reduced]);

  const lFmt = left?.format ?? defaultFmt;
  const rFmt = right?.format ?? defaultFmt;

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2, minHeight: 18 }}>
        {readout ? (
          <>
            <Text size="xs" tone="dim" weight="700">
              {xFormat(scrubX ?? 0)}
            </Text>
            {readout.map((r) => (
              <Text key={r.key} size="xs" style={{ color: r.color }} weight="700">
                {r.label} {r.text}
              </Text>
            ))}
          </>
        ) : showLegend ? (
          series
            .filter((s) => !s.hideInReadout || s.dashed)
            .map((s) => (
              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: s.color, opacity: s.dashed ? 0.6 : 1 }} />
                <Text size="xs" tone="dim">
                  {s.label}
                </Text>
              </View>
            ))
        ) : null}
      </View>
      <GestureDetector gesture={gesture}>
      <View onLayout={onLayout} style={{ height }}>
        {geo ? (
          <Svg width={width} height={height}>
            {/* grid + left ticks */}
            {geo.lt.map((v) => (
              <G key={`l${v}`}>
                <Line x1={padL} x2={width - padR} y1={geo.syL(v)} y2={geo.syL(v)} stroke={t.border} strokeWidth={0.5} />
                <SvgText x={padL - 6} y={geo.syL(v) + 4} fontSize={font.size.xs - 1} fill={t.textFaint} textAnchor="end">
                  {lFmt(v)}
                </SvgText>
              </G>
            ))}
            {geo.rt.map((v) => (
              <SvgText
                key={`r${v}`}
                x={width - padR + 6}
                y={geo.syR(v) + 4}
                fontSize={font.size.xs - 1}
                fill={t.textFaint}
                textAnchor="start">
                {rFmt(v)}
              </SvgText>
            ))}
            {geo.xt.map((v) => (
              <SvgText
                key={`x${v}`}
                x={geo.sx(v)}
                y={height - 6}
                fontSize={font.size.xs - 1}
                fill={t.textFaint}
                textAnchor="middle">
                {xFormat(v)}
              </SvgText>
            ))}
            <Line x1={padL} x2={width - padR} y1={geo.plotBottom} y2={geo.plotBottom} stroke={t.border} strokeWidth={1} />
            {(references ?? []).map((r, i) => {
              const y = (r.axis === 'right' ? geo.syR : geo.syL)(r.y);
              return (
                <G key={`ref${i}`}>
                  <Line
                    x1={padL}
                    x2={width - padR}
                    y1={y}
                    y2={y}
                    stroke={r.color ?? t.textDim}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  {r.label ? (
                    <SvgText x={width - padR - 4} y={y - 4} fontSize={font.size.xs - 1} fill={r.color ?? t.textDim} textAnchor="end">
                      {r.label}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
            {geo.paths.map((p, i) => {
              const s = reduced[i];
              return (
                <G key={p.key}>
                  {p.area ? <Path d={p.area} fill={s.color} fillOpacity={0.12} /> : null}
                  <Path
                    d={p.d}
                    stroke={s.color}
                    strokeWidth={s.width ?? 2}
                    fill="none"
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={s.dashed ? 0.8 : 1}
                  />
                </G>
              );
            })}
            {markerX != null ? (
              <Line
                x1={geo.sx(markerX)}
                x2={geo.sx(markerX)}
                y1={geo.plotTop}
                y2={geo.plotBottom}
                stroke={t.accent}
                strokeWidth={1.5}
              />
            ) : null}
            {scrubX != null ? (
              <G>
                <Line
                  x1={geo.sx(scrubX)}
                  x2={geo.sx(scrubX)}
                  y1={geo.plotTop}
                  y2={geo.plotBottom}
                  stroke={t.textDim}
                  strokeWidth={1}
                />
                {(readout ?? []).map((r) => (
                  <Circle
                    key={r.key}
                    cx={geo.sx(r.p.x)}
                    cy={(r.axis === 'right' ? geo.syR : geo.syL)(r.p.y)}
                    r={4}
                    fill={r.color}
                    stroke={t.surface}
                    strokeWidth={1.5}
                  />
                ))}
              </G>
            ) : null}
          </Svg>
        ) : width > 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text tone="faint" size="sm">
              No data to chart
            </Text>
          </View>
        ) : null}
      </View>
      </GestureDetector>
    </View>
  );
}
