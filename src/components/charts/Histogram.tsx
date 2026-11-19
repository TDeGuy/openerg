import React, { useMemo } from 'react';
import { View } from 'react-native';

import { Text } from '@/ui/kit';
import { radius, spacing, useTheme } from '@/ui/theme';

import { BarChart } from './BarChart';
import { binValues } from './util';

export interface DistributionItem {
  key: string;
  label: string;
  /** Raw value; bar length is value / max (or value itself when `max` = 1 for fractions). */
  value: number;
  color?: string;
  /** Right-hand text; defaults to the value. */
  valueText?: string;
  hint?: string;
}

/** Horizontal labelled bars — shape distribution, flag frequency, time in zone. */
export function DistributionBars({ items, max }: { items: DistributionItem[]; max?: number }) {
  const t = useTheme();
  const top = max ?? Math.max(1e-9, ...items.map((i) => i.value));
  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((it) => (
        <View key={it.key} style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <Text size="sm" style={{ flex: 1 }} numberOfLines={1}>
              {it.label}
            </Text>
            <Text size="sm" tone="dim" style={{ fontVariant: ['tabular-nums'] }}>
              {it.valueText ?? it.value.toFixed(0)}
            </Text>
          </View>
          <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
            <View
              style={{
                width: `${Math.max(0, Math.min(1, it.value / top)) * 100}%`,
                height: '100%',
                borderRadius: radius.pill,
                backgroundColor: it.color ?? t.accent,
              }}
            />
          </View>
          {it.hint ? (
            <Text size="xs" tone="faint">
              {it.hint}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Vertical histogram of raw values in equal-width bins. */
export function Histogram({
  values,
  bins = 12,
  color,
  height = 140,
  format = (v: number) => v.toFixed(0),
}: {
  values: readonly number[];
  bins?: number;
  color?: string;
  height?: number;
  /** Formats bin edges. */
  format?: (v: number) => string;
}) {
  const t = useTheme();
  const bars = useMemo(
    () =>
      binValues(values, bins).map((b) => ({
        label: format((b.from + b.to) / 2),
        value: b.count,
        color: color ?? t.accent,
      })),
    [values, bins, color, t.accent, format],
  );
  if (bars.length === 0) return null;
  return <BarChart bars={bars} height={height} format={(v) => v.toFixed(0)} />;
}
