/**
 * In-app replacement for Alert.alert (same call shape). React Native's Alert is a
 * no-op on web, which silently broke every confirm dialog there.
 */
import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { create } from 'zustand';

import { Button, Text } from './kit';
import { radius, spacing, useTheme } from './theme';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface DialogSpec {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

const useDialogs = create<{ queue: DialogSpec[] }>(() => ({ queue: [] }));

export function dialog(title: string, message?: string, buttons?: DialogButton[]): void {
  const spec = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] };
  useDialogs.setState((s) => ({ queue: [...s.queue, spec] }));
}

/** Rendered once in the root layout. */
export function DialogHost() {
  const t = useTheme();
  const current = useDialogs((s) => s.queue[0]);
  if (!current) return null;
  const close = (b?: DialogButton) => {
    useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));
    b?.onPress?.();
  };
  const cancel = current.buttons.find((b) => b.style === 'cancel');
  return (
    <Modal
      transparent
      animationType="fade"
      onRequestClose={() => close(cancel)}
      supportedOrientations={['portrait', 'landscape']}>
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={() => cancel && close(cancel)}
        style={{ flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', padding: spacing.xl }}>
        <Pressable
          accessibilityRole="alert"
          style={{
            alignSelf: 'center',
            width: '100%',
            maxWidth: 420,
            backgroundColor: t.surface,
            borderRadius: radius.lg,
            padding: spacing.xl,
            gap: spacing.md,
          }}>
          <Text size="lg" weight="700">
            {current.title}
          </Text>
          {current.message ? <Text tone="dim">{current.message}</Text> : null}
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {current.buttons.map((b, i) => (
              <Button
                key={i}
                title={b.text}
                variant={b.style === 'destructive' ? 'danger' : b.style === 'cancel' ? 'secondary' : 'primary'}
                onPress={() => close(b)}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
