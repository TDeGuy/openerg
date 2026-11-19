import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/ui/theme';

import { useChartWidth } from './useChartWidth';
import { areaPath, downsampleValues, extent, linePath, linearScale, padDomain } from './util';

export function Sparkline({
  values,
  color,
  height = 32,
  invert,
  fill = true,
}: {
  values: readonly number[];
  color?: string;
  height?: number;
  /** Smaller values plot higher (pace). */
  invert?: boolean;
  fill?: boolean;
}) {
  const t = useTheme();
  const c = color ?? t.accent;
  const [width, onLayout] = useChartWidth();
  const reduced = useMemo(() => downsampleValues(values.filter(Number.isFinite), 120), [values]);
  const d = useMemo(() => {
    if (width < 10 || reduced.length < 2) return null;
    const [x0, x1] = extent(reduced.map((p) => p.x));
    const [y0, y1] = padDomain(...extent(reduced.map((p) => p.y)), 0.1);
    const sx = linearScale(x0, x1, 1, width - 1);
    const sy = invert ? linearScale(y0, y1, 2, height - 2) : linearScale(y0, y1, height - 2, 2);
    const pts = reduced.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
    return { line: linePath(pts), area: fill ? areaPath(pts, height) : '' };
  }, [width, height, reduced, invert, fill]);
  return (
    <View onLayout={onLayout} style={{ height, alignSelf: 'stretch' }}>
      {d ? (
        <Svg width={width} height={height}>
          {d.area ? <Path d={d.area} fill={c} fillOpacity={0.14} /> : null}
          <Path d={d.line} stroke={c} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}
