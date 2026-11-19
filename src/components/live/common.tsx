/** Small Live-UI building blocks on top of @/ui/kit (44 pt touch targets). */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleProp, TextInput, View, ViewStyle } from 'react-native';

import { Text } from '@/ui/kit';
import { font, radius, spacing, useTheme } from '@/ui/theme';

import { type FieldKind, formatField, parseField } from './progress';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 24,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, opacity: pressed ? 0.6 : 1 },
        style,
      ]}>
      <Ionicons name={icon} size={size} color={color ?? t.textDim} />
    </Pressable>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: color + '26' }}>
      <Text size="xs" weight="700" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  multiline?: boolean;
  error?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.textFaint}
        multiline={multiline}
        accessibilityLabel={label}
        style={{
          minHeight: multiline ? 72 : 44,
          color: t.text,
          backgroundColor: t.surfaceAlt,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: error ? t.bad : t.border,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          fontSize: font.size.md,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

/**
 * Numeric / duration input. Keeps its own text; reports parsed value (null = empty,
 * NaN = invalid). Remount with a new `key` to reset from `value`.
 */
export function NumField({
  label,
  kind,
  value,
  onValue,
  placeholder,
  optional,
}: {
  label: string;
  kind: FieldKind;
  value: number | null | undefined;
  onValue: (v: number | null) => void;
  placeholder?: string;
  optional?: boolean;
}) {
  const [text, setText] = useState(() => formatField(kind, value));
  const parsed = parseField(kind, text);
  const invalid = Number.isNaN(parsed) || (!optional && parsed === null);
  const t = useTheme();
  return (
    <View style={{ gap: 2, flex: 1, minWidth: 96 }}>
      <TextField
        label={label}
        value={text}
        placeholder={placeholder}
        error={invalid}
        onChangeText={(s) => {
          setText(s);
          onValue(parseField(kind, s));
        }}
      />
      {invalid ? (
        <Text size="xs" style={{ color: t.bad }}>
          {parsed === null ? 'Required' : kind === 'time' || kind === 'pace' ? 'Use m:ss or m:ss.t' : 'Enter a number'}
        </Text>
      ) : null}
    </View>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
