import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { Text } from '@/ui/kit';
import { font, spacing, useTheme } from '@/ui/theme';

import { useChartWidth } from './useChartWidth';
import { usePinGesture } from './usePinGesture';
import { extent, linearScale, niceTicks, padDomain, slotIndex } from './util';

export interface Bar {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  bars: Bar[];
  height?: number;
  /** Formats values for the y axis and tap readout. */
  format?: (v: number) => string;
  reference?: { value: number; label?: string; color?: string };
  /** Plot smaller values higher (e.g. pace). Bars still grow from the baseline. */
  invert?: boolean;
  /** Fixed domain; defaults to data extent including 0 (or the reference). */
  domain?: [number, number];
  includeZero?: boolean;
  onPressBar?: (index: number) => void;
  /** Extra text shown in the readout for the tapped bar. */
  describe?: (index: number) => string;
}

const PAD_L = 46;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;

export function BarChart({
  bars,
  height = 160,
  format = (v) => v.toFixed(0),
  reference,
  invert,
  domain,
  includeZero = true,
  onPressBar,
  describe,
}: BarChartProps) {
  const t = useTheme();
  const [width, onLayout] = useChartWidth();
  const [sel, setSel] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (width < 80 || bars.length === 0) return null;
    const vals = bars.map((b) => b.value).filter(Number.isFinite);
    if (reference) vals.push(reference.value);
    if (includeZero) vals.push(0);
    const [lo, hi] = domain ?? padDomain(...extent(vals), 0.06);
    const bottom = height - PAD_B;
    const sy = invert ? linearScale(lo, hi, PAD_T, bottom) : linearScale(lo, hi, bottom, PAD_T);
    const base = includeZero ? 0 : invert ? hi : lo;
    const baseY = sy(Math.min(hi, Math.max(lo, base)));
    const slot = (width - PAD_L - PAD_R) / bars.length;
    const bw = Math.max(1, Math.min(48, slot * 0.72));
    const rects = bars.map((b, i) => {
      const v = Number.isFinite(b.value) ? b.value : base;
      const y = sy(Math.min(hi, Math.max(lo, v)));
      return {
        x: PAD_L + i * slot + (slot - bw) / 2,
        y: Math.min(y, baseY),
        h: Math.max(1, Math.abs(baseY - y)),
        cx: PAD_L + i * slot + slot / 2,
      };
    });
    const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor((width - PAD_L) / 34))));
    return { sy, baseY, rects, slot, bw, ticks: niceTicks(lo, hi, 4), labelEvery, bottom };
  }, [width, height, bars, reference, invert, domain, includeZero]);

  const gesture = usePinGesture(true, sel != null, (px) => {
    if (px == null) return setSel(null);
    const i = geo ? slotIndex(px, PAD_L, geo.slot, bars.length) : -1;
    if (i >= 0) {
      setSel(i);
      onPressBar?.(i);
    }
  });

  const selected = sel != null && sel < bars.length ? bars[sel] : null;

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ minHeight: 18 }}>
        {selected ? (
          <Text size="xs" tone="dim" weight="700">
            {selected.label}: {format(selected.value)}
            {describe && sel != null ? `  ·  ${describe(sel)}` : ''}
          </Text>
        ) : (
          <Text size="xs" tone="faint">
            Tap a bar for details
          </Text>
        )}
      </View>
      <GestureDetector gesture={gesture}>
      <View onLayout={onLayout} style={{ height }}>
        {geo ? (
          <Svg width={width} height={height}>
            {geo.ticks.map((v) => (
              <G key={v}>
                <Line x1={PAD_L} x2={width - PAD_R} y1={geo.sy(v)} y2={geo.sy(v)} stroke={t.border} strokeWidth={0.5} />
                <SvgText x={PAD_L - 6} y={geo.sy(v) + 4} fontSize={font.size.xs - 1} fill={t.textFaint} textAnchor="end">
                  {format(v)}
                </SvgText>
              </G>
            ))}
            {geo.rects.map((r, i) => (
              <Rect
                key={i}
                x={r.x}
                y={r.y}
                width={geo.bw}
                height={r.h}
                rx={Math.min(3, geo.bw / 3)}
                fill={bars[i].color ?? t.accent}
                opacity={sel == null || sel === i ? 1 : 0.55}
              />
            ))}
            <Line x1={PAD_L} x2={width - PAD_R} y1={geo.baseY} y2={geo.baseY} stroke={t.textFaint} strokeWidth={1} />
            {reference ? (
              <G>
                <Line
                  x1={PAD_L}
                  x2={width - PAD_R}
                  y1={geo.sy(reference.value)}
                  y2={geo.sy(reference.value)}
                  stroke={reference.color ?? t.text}
                  strokeWidth={1.2}
                  strokeDasharray="5 4"
                />
                {reference.label ? (
                  <SvgText
                    x={width - PAD_R - 2}
                    y={geo.sy(reference.value) - 4}
                    fontSize={font.size.xs - 1}
                    fill={reference.color ?? t.text}
                    textAnchor="end">
                    {reference.label}
                  </SvgText>
                ) : null}
              </G>
            ) : null}
            {geo.rects.map((r, i) =>
              i % geo.labelEvery === 0 ? (
                <SvgText key={`lb${i}`} x={r.cx} y={height - 6} fontSize={font.size.xs - 1} fill={t.textFaint} textAnchor="middle">
                  {bars[i].label}
                </SvgText>
              ) : null,
            )}
          </Svg>
        ) : null}
      </View>
      </GestureDetector>
    </View>
  );
}
