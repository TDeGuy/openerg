/**
 * Small shared UI kit. Screens should build from these so the app looks consistent.
 * Owned by the integrator — module agents must not edit this file; add screen-specific
 * components in your own folder instead.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text as RNText,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { font, radius, spacing, useTheme } from './theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_TRANSITION = { transitionDuration: 160, transitionTimingFunction: 'ease-out' as const };

type Tone = 'default' | 'dim' | 'faint' | 'accent' | 'good' | 'warn' | 'bad';

export function Text({
  tone = 'default',
  size = 'md',
  weight,
  style,
  ...rest
}: TextProps & { tone?: Tone; size?: keyof typeof font.size; weight?: TextStyle['fontWeight'] }) {
  const t = useTheme();
  const color = {
    default: t.text,
    dim: t.textDim,
    faint: t.textFaint,
    accent: t.accent,
    good: t.good,
    warn: t.warn,
    bad: t.bad,
  }[tone];
  return <RNText {...rest} style={[{ color, fontSize: font.size[size], fontWeight: weight }, style]} />;
}

/** Page wrapper: themed background, safe area, optional scroll. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const pad = padded ? { padding: spacing.lg, gap: spacing.md } : null;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[pad, { paddingBottom: spacing.xxl }, style]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const t = useTheme();
  const [down, setDown] = useState(false);
  const base: ViewStyle = {
    backgroundColor: t.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    padding: spacing.lg,
    gap: spacing.sm,
  };
  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={() => setDown(true)}
        onPressOut={() => setDown(false)}
        style={[base, { opacity: down ? 0.75 : 1, transform: [{ scale: down ? 0.985 : 1 }], transitionProperty: ['opacity', 'transform'], ...PRESS_TRANSITION }, style]}>
        {children}
      </AnimatedPressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
      <Text size="sm" tone="dim" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  small,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [down, setDown] = useState(false);
  const bg = { primary: t.accent, secondary: t.surfaceAlt, ghost: 'transparent', danger: t.bad }[variant];
  const fg = { primary: t.accentText, secondary: t.text, ghost: t.accent, danger: '#FFFFFF' }[variant];
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          paddingVertical: small ? spacing.sm : spacing.md + 2,
          paddingHorizontal: small ? spacing.md : spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          opacity: disabled ? 0.4 : down ? 0.75 : 1,
          transform: [{ scale: down && !disabled ? 0.97 : 1 }],
          transitionProperty: ['opacity', 'transform'],
          ...PRESS_TRANSITION,
          minHeight: small ? 36 : 48,
        },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : null}
      <RNText style={{ color: fg, fontWeight: '700', fontSize: small ? font.size.sm : font.size.md }}>{title}</RNText>
    </AnimatedPressable>
  );
}

/** Label + big tabular number + optional unit. The basic metric tile. */
export function Stat({
  label,
  value,
  unit,
  size = 'xl',
  tone = 'default',
  align = 'left',
  style,
}: {
  label: string;
  value: string;
  unit?: string;
  size?: keyof typeof font.size;
  tone?: Tone;
  align?: 'left' | 'center';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ alignItems: align === 'center' ? 'center' : 'flex-start' }, style]}>
      <Text size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text size={size} tone={tone} style={font.metric} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {unit ? (
          <Text size="xs" tone="dim">
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const t = useTheme();
  const c = color ?? t.accent;
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      hitSlop={7}
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? c : t.border,
        backgroundColor: selected ? c + '26' : 'transparent',
        transitionProperty: ['backgroundColor', 'borderColor'],
        ...PRESS_TRANSITION,
      }}>
      <Animated.Text
        style={{
          color: selected ? c : t.textDim,
          fontSize: font.size.sm,
          fontWeight: '600',
          transitionProperty: 'color',
          ...PRESS_TRANSITION,
        }}>
        {label}
      </Animated.Text>
    </AnimatedPressable>
  );
}

/** Horizontal wrap of chips acting as a single-select. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

/** Settings-style row: label (+ hint) on the left, control/value on the right. */
export function Row({
  label,
  hint,
  right,
  onPress,
}: {
  label: string;
  hint?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const [down, setDown] = useState(false);
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 }}>
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {hint ? (
          <Text size="sm" tone="faint">
            {hint}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return body;
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      style={{ opacity: down ? 0.7 : 1, transform: [{ scale: down ? 0.99 : 1 }], transitionProperty: ['opacity', 'transform'], ...PRESS_TRANSITION }}>
      {body}
    </AnimatedPressable>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.border }} />;
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
      <Text size="lg" weight="700" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {detail ? (
        <Text tone="dim" style={{ textAlign: 'center' }}>
          {detail}
        </Text>
      ) : null}
      {action}
    </View>
  );
}
