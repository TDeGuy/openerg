/** Sheet to choose and order the workouts shown in the home "Standard pieces" grid. */
import React, { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { WorkoutPlan } from '@/core/types';
import { Button, Card, SectionTitle, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';
import { describePlan, planTitle } from '@/workouts';

import { IconButton, TextField } from './common';

const SHOWN = 40;

export function HomePicker({ visible, pool, ids, onChange, onClose }: { visible: boolean; pool: WorkoutPlan[]; ids: string[]; onChange: (ids: string[]) => void; onClose: () => void }) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const byId = new Map(pool.map((p) => [p.id, p]));
  const chosen = ids.map((id) => byId.get(id)).filter((p): p is WorkoutPlan => !!p);
  const q = query.trim().toLowerCase();
  const available = pool
    .filter((p) => !ids.includes(p.id) && (!q || [p.name, planTitle(p), describePlan(p)].some((x) => x.toLowerCase().includes(q))))
    .slice(0, SHOWN);
  const move = (i: number, d: number) => {
    const n = chosen.map((p) => p.id);
    [n[i], n[i + d]] = [n[i + d]!, n[i]!];
    onChange(n);
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom', 'left', 'right']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md }}>
          <Text size="lg" weight="800" style={{ flex: 1 }}>
            Home pieces
          </Text>
          <IconButton icon="close" label="Done" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
          <SectionTitle>On your home screen</SectionTitle>
          {chosen.length === 0 ? <Text tone="faint">Nothing yet. Add a workout below.</Text> : null}
          {chosen.map((p, i) => (
            <Card key={p.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text weight="700" numberOfLines={1}>
                  {p.name || planTitle(p)}
                </Text>
                <Text size="xs" tone="faint" numberOfLines={1}>
                  {planTitle(p)}
                </Text>
              </View>
              <IconButton icon="arrow-up" label={`Move ${p.name} up`} onPress={() => i > 0 && move(i, -1)} />
              <IconButton icon="arrow-down" label={`Move ${p.name} down`} onPress={() => i < chosen.length - 1 && move(i, 1)} />
              <IconButton icon="close-circle-outline" color={t.bad} label={`Remove ${p.name}`} onPress={() => onChange(ids.filter((x) => x !== p.id))} />
            </Card>
          ))}
          <SectionTitle>Add a workout</SectionTitle>
          <TextField label="Search" value={query} onChangeText={setQuery} placeholder="2k, intervals, my workouts…" />
          {available.map((p) => (
            <Card key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text weight="700" numberOfLines={1}>
                  {p.name || planTitle(p)}
                </Text>
                <Text size="xs" tone="faint" numberOfLines={1}>
                  {planTitle(p)}
                </Text>
              </View>
              <Button title="Add" small variant="secondary" style={{ minHeight: 44 }} onPress={() => onChange([...ids, p.id])} />
            </Card>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
