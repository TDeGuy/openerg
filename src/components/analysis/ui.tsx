import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, TextInput, TextInputProps, View } from 'react-native';

import type { Insight } from '@/core/types';
import { Row, Stat, Text } from '@/ui/kit';
import { font, radius, spacing, useTheme } from '@/ui/theme';

type Tone = 'default' | 'dim' | 'faint' | 'accent' | 'good' | 'warn' | 'bad';

/** Themed labelled text input. */
export function Field({
  label,
  hint,
  error,
  style,
  flex,
  ...rest
}: TextInputProps & { label?: string; hint?: string; error?: string | null; /** Grow inside a row. */ flex?: boolean }) {
  const t = useTheme();
  return (
    <View style={[{ gap: 4 }, flex ? { flex: 1 } : null]}>
      {label ? (
        <Text size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={t.textFaint}
        {...rest}
        style={[
          {
            color: t.text,
            backgroundColor: t.surfaceAlt,
            borderColor: error ? t.bad : t.border,
            borderWidth: 1,
            borderRadius: radius.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: font.size.md,
            minHeight: 42,
          },
          style,
        ]}
      />
      {error ? (
        <Text size="xs" tone="bad">
          {error}
        </Text>
      ) : hint ? (
        <Text size="xs" tone="faint">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export interface StatItem {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
}

/** Responsive grid of Stat tiles (3 per row on phones). */
export function StatGrid({ items, columns = 3 }: { items: StatItem[]; columns?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md }}>
      {items.map((it) => (
        <Stat
          key={it.label}
          label={it.label}
          value={it.value}
          unit={it.unit}
          tone={it.tone}
          size="lg"
          style={{ width: `${100 / columns}%`, paddingRight: spacing.sm }}
        />
      ))}
    </View>
  );
}

export function InsightList({ insights }: { insights: Insight[] }) {
  const t = useTheme();
  if (insights.length === 0) return null;
  return (
    <View style={{ gap: spacing.md }}>
      {insights.map((i, n) => {
        const c = i.severity === 'good' ? t.good : i.severity === 'warn' ? t.warn : t.accent;
        const icon = i.severity === 'good' ? 'checkmark-circle' : i.severity === 'warn' ? 'alert-circle' : 'information-circle';
        return (
          <View key={`${i.title}-${n}`} style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Ionicons name={icon} size={18} color={c} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="700">{i.title}</Text>
              <Text size="sm" tone="dim">
                {i.detail}
              </Text>
              {i.drill ? (
                <Text size="sm" tone="accent">
                  Drill: {i.drill}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function Badge({ label, color, icon }: { label: string; color?: string; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const t = useTheme();
  const c = color ?? t.accent;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: c + '22',
        borderWidth: 1,
        borderColor: c + '66',
        alignSelf: 'flex-start',
      }}>
      {icon ? <Ionicons name={icon} size={11} color={c} /> : null}
      <Text size="xs" weight="700" style={{ color: c }}>
        {label}
      </Text>
    </View>
  );
}

/** − value + control. */
export function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  format = (v) => v.toFixed(1),
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  format?: (v: number) => string;
}) {
  const t = useTheme();
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 1000) / 1000);
  const btn = (icon: 'remove' | 'add', next: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={icon === 'add' ? 'Increase' : 'Decrease'}
      disabled={disabled}
      onPress={() => set(next)}
      style={{
        width: 34,
        height: 34,
        borderRadius: radius.pill,
        backgroundColor: t.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}>
      <Ionicons name={icon} size={18} color={t.text} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      {btn('remove', value - step, value <= min)}
      <Text weight="700" style={{ minWidth: 40, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
        {format(value)}
      </Text>
      {btn('add', value + step, value >= max)}
    </View>
  );
}

/** Settings row that navigates somewhere. */
export function NavRow({ label, hint, onPress, icon }: { label: string; hint?: string; onPress: () => void; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const t = useTheme();
  return (
    <Row
      label={label}
      hint={hint}
      onPress={onPress}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          {icon ? <Ionicons name={icon} size={18} color={t.textDim} /> : null}
          <Ionicons name="chevron-forward" size={18} color={t.textFaint} />
        </View>
      }
    />
  );
}

export interface Column<T> {
  title: string;
  /** Flex weight. */
  flex?: number;
  align?: 'left' | 'right' | 'center';
  render: (row: T, index: number) => string;
  tone?: (row: T, index: number) => Tone | undefined;
}

/** Simple non-virtualised table for short lists (splits, reps, zones). */
export function Table<T>({ columns, rows, onPressRow }: { columns: Column<T>[]; rows: T[]; onPressRow?: (row: T, i: number) => void }) {
  const t = useTheme();
  const cell = (c: Column<T>) => ({ flex: c.flex ?? 1, textAlign: c.align ?? 'right' }) as const;
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.border }}>
        {columns.map((c) => (
          <Text key={c.title} size="xs" tone="faint" weight="700" style={cell(c)} numberOfLines={1}>
            {c.title}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => {
        const body = (
          <View
            style={{
              flexDirection: 'row',
              paddingVertical: 7,
              borderBottomWidth: i === rows.length - 1 ? 0 : 0.5,
              borderBottomColor: t.border,
            }}>
            {columns.map((c) => (
              <Text key={c.title} size="sm" tone={c.tone?.(r, i)} style={[cell(c), { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
                {c.render(r, i)}
              </Text>
            ))}
          </View>
        );
        return onPressRow ? (
          <Pressable key={i} onPress={() => onPressRow(r, i)}>
            {body}
          </Pressable>
        ) : (
          <React.Fragment key={i}>{body}</React.Fragment>
        );
      })}
    </View>
  );
}

/** "Loading…" / centred spinner-free message. */
export function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <Text tone="dim">{children}</Text>
    </View>
  );
}

export function forceUnitLabel(u: 'N' | 'kgf' | 'lbf'): string {
  return u;
}

export function pct(v: number, digits = 0): string {
  return Number.isFinite(v) ? `${v.toFixed(digits)}%` : '–';
}
