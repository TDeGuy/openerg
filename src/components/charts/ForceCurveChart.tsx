import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { convertForce } from '@/core/units';
import { Text } from '@/ui/kit';
import { font, spacing, useTheme } from '@/ui/theme';

import { useChartWidth } from './useChartWidth';
import { areaPath, argMax, bandPath, linePath, linearScale, niceTicks } from './util';

export interface ForceCurve {
  key: string;
  label: string;
  /** Newtons, evenly spaced across the drive. */
  values: readonly number[];
  color: string;
  fill?: boolean;
  dashed?: boolean;
  /** Mark the peak of this curve. */
  peak?: boolean;
}

export interface ForceCurveChartProps {
  curves: ForceCurve[];
  /** Mean ± std-dev band (newtons). */
  band?: { mean: readonly number[]; std: readonly number[]; color: string };
  unit?: 'N' | 'kgf' | 'lbf';
  height?: number;
  showLegend?: boolean;
}

const PAD_L = 42;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 22;

export function ForceCurveChart({ curves, band, unit = 'N', height = 190, showLegend = true }: ForceCurveChartProps) {
  const t = useTheme();
  const [width, onLayout] = useChartWidth();

  const geo = useMemo(() => {
    const usable = curves.filter((c) => c.values.length >= 2);
    if (width < 80 || (usable.length === 0 && !band)) return null;
    let maxN = 0;
    for (const c of usable) for (const v of c.values) if (Number.isFinite(v) && v > maxN) maxN = v;
    if (band) band.mean.forEach((m, i) => (maxN = Math.max(maxN, m + (band.std[i] ?? 0))));
    const maxU = Math.max(1, convertForce(maxN, unit) * 1.1);
    const bottom = height - PAD_B;
    const sy = linearScale(0, maxU, bottom, PAD_T);
    const sx = linearScale(0, 1, PAD_L, width - PAD_R);
    const toPts = (vals: readonly number[]) =>
      vals.map((v, i) => ({ x: sx(vals.length > 1 ? i / (vals.length - 1) : 0), y: sy(convertForce(Math.max(0, v || 0), unit)) }));
    const lines = usable.map((c) => {
      const pts = toPts(c.values);
      const pi = c.peak ? argMax(c.values as number[]) : -1;
      return {
        key: c.key,
        d: linePath(pts),
        area: c.fill ? areaPath(pts, bottom) : '',
        peak: pi >= 0 ? { ...pts[pi], v: convertForce(c.values[pi], unit), pos: pi / Math.max(1, c.values.length - 1) } : null,
      };
    });
    let bandD = '';
    if (band && band.mean.length >= 2) {
      const up = toPts(band.mean.map((m, i) => m + (band.std[i] ?? 0)));
      const lo = toPts(band.mean.map((m, i) => Math.max(0, m - (band.std[i] ?? 0))));
      bandD = bandPath(up, lo);
    }
    return { sy, sx, bottom, lines, bandD, ticks: niceTicks(0, maxU, 4), usable };
  }, [width, height, curves, band, unit]);

  return (
    <View style={{ gap: spacing.xs }}>
      {showLegend ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md }}>
          {curves.map((c) => (
            <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: c.color, opacity: c.dashed ? 0.6 : 1 }} />
              <Text size="xs" tone="dim">
                {c.label}
              </Text>
            </View>
          ))}
          {band ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 8, borderRadius: 2, backgroundColor: band.color, opacity: 0.25 }} />
              <Text size="xs" tone="dim">
                ±1 SD
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View onLayout={onLayout} style={{ height }}>
        {geo ? (
          <Svg width={width} height={height}>
            {geo.ticks.map((v) => (
              <G key={v}>
                <Line x1={PAD_L} x2={width - PAD_R} y1={geo.sy(v)} y2={geo.sy(v)} stroke={t.border} strokeWidth={0.5} />
                <SvgText x={PAD_L - 6} y={geo.sy(v) + 4} fontSize={font.size.xs - 1} fill={t.textFaint} textAnchor="end">
                  {v.toFixed(0)}
                </SvgText>
              </G>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <SvgText
                key={f}
                x={geo.sx(f)}
                y={height - 6}
                fontSize={font.size.xs - 1}
                fill={t.textFaint}
                textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                {f === 0 ? 'Catch' : f === 1 ? 'Finish' : `${f * 100}%`}
              </SvgText>
            ))}
            <Line x1={PAD_L} x2={width - PAD_R} y1={geo.bottom} y2={geo.bottom} stroke={t.border} strokeWidth={1} />
            {geo.bandD && band ? <Path d={geo.bandD} fill={band.color} fillOpacity={0.22} /> : null}
            {geo.lines.map((l, i) => {
              const c = geo.usable[i];
              return (
                <G key={l.key}>
                  {l.area ? <Path d={l.area} fill={c.color} fillOpacity={0.16} /> : null}
                  <Path
                    d={l.d}
                    stroke={c.color}
                    strokeWidth={c.dashed ? 1.5 : 2.4}
                    fill="none"
                    strokeDasharray={c.dashed ? '5 4' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {l.peak ? (
                    <G>
                      <Circle cx={l.peak.x} cy={l.peak.y} r={4.5} fill={c.color} stroke={t.surface} strokeWidth={1.5} />
                      <SvgText
                        x={Math.min(width - PAD_R - 2, Math.max(PAD_L + 2, l.peak.x))}
                        y={Math.max(PAD_T + 10, l.peak.y - 8)}
                        fontSize={font.size.xs}
                        fill={c.color}
                        fontWeight="700"
                        textAnchor="middle">
                        {`${l.peak.v.toFixed(0)} ${unit} @ ${Math.round(l.peak.pos * 100)}%`}
                      </SvgText>
                    </G>
                  ) : null}
                </G>
              );
            })}
          </Svg>
        ) : width > 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text tone="faint" size="sm">
              No force curve data
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
