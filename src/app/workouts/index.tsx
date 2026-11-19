import { dialog } from '@/ui/dialog';
import { router, Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { IconButton, TextField } from '@/components/live/common';
import { CATEGORY_LABEL, PlanCard, StartSheet } from '@/components/live/plans';
import { startOrConnect } from '@/components/live/start';
import type { WorkoutCategory, WorkoutPlan } from '@/core/types';
import { deletePlan, getFavoritePlanIds, listCustomPlans, setPlanFavorite, useDbVersion } from '@/storage/db';
import { Button, Chip, EmptyState, Screen, SectionTitle } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';
import { BUILT_IN_WORKOUTS, describePlan, planTitle } from '@/workouts';

type Filter = 'favorites' | 'mine' | WorkoutCategory;
const CATEGORIES: WorkoutCategory[] = ['test', 'steady-state', 'threshold', 'vo2max', 'sprint', 'technique', 'warmup', 'custom'];

export default function WorkoutLibrary() {
  const t = useTheme();
  const version = useDbVersion();
  const [custom, setCustom] = useState<WorkoutPlan[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  // Multi-select; empty = All. Categories are OR-ed, Favourites / Mine narrow further.
  const [filters, setFilters] = useState<Filter[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<WorkoutPlan | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listCustomPlans(), getFavoritePlanIds()])
      .then(([plans, ids]) => {
        if (!alive) return;
        setCustom(plans);
        setFavs(new Set(ids));
      })
      .catch((e) => dialog('Could not load workouts', String(e)));
    return () => {
      alive = false;
    };
  }, [version]);

  const all = useMemo(() => [...custom.map((p) => ({ ...p, builtIn: false })), ...BUILT_IN_WORKOUTS], [custom]);

  const cats = useMemo(() => filters.filter((f): f is WorkoutCategory => f !== 'favorites' && f !== 'mine'), [filters]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((p) => {
      if (filters.includes('favorites') && !favs.has(p.id)) return false;
      if (filters.includes('mine') && p.builtIn) return false;
      if (cats.length && !cats.includes((p.category ?? 'custom'))) return false;
      if (!q) return true;
      return [p.name, p.description ?? '', planTitle(p), describePlan(p)].some((s) => s.toLowerCase().includes(q));
    });
  }, [all, filters, cats, query, favs]);

  const groups = useMemo(() => {
    if (filters.length || query.trim()) return [{ key: 'results', title: null as string | null, plans: visible }];
    const out: { key: string; title: string | null; plans: WorkoutPlan[] }[] = [];
    const mine = visible.filter((p) => !p.builtIn);
    if (mine.length) out.push({ key: 'mine', title: 'My workouts', plans: mine });
    for (const c of CATEGORIES) {
      const plans = visible.filter((p) => p.builtIn && (p.category ?? 'custom') === c);
      if (plans.length) out.push({ key: c, title: CATEGORY_LABEL[c], plans });
    }
    return out;
  }, [visible, filters, query]);

  const toggleFav = useCallback(
    (id: string) => {
      const next = !favs.has(id);
      setFavs((s) => {
        const n = new Set(s);
        if (next) n.add(id);
        else n.delete(id);
        return n;
      });
      setPlanFavorite(id, next).catch(() => {});
    },
    [favs],
  );

  // The copy lives only in the builder until the user saves it.
  const duplicate = (p: WorkoutPlan) => router.push({ pathname: '/workouts/builder', params: { id: p.id, copy: '1' } });

  const remove = useCallback((p: WorkoutPlan) => {
    dialog(`Delete "${p.name || planTitle(p)}"?`, 'This custom workout will be removed. Your logged results are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePlan(p.id).catch((e) => dialog('Could not delete', String(e))) },
    ]);
  }, []);

  const chips: { value: Filter; label: string }[] = [
    { value: 'favorites', label: '★ Favourites' },
    { value: 'mine', label: 'Mine' },
    ...CATEGORIES.filter((c) => c !== 'custom').map((c) => ({ value: c as Filter, label: CATEGORY_LABEL[c] })),
  ];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Workouts',
          headerRight: () => <IconButton icon="add" color={t.accent} label="Build a workout" onPress={() => router.push('/workouts/builder')} />,
        }}
      />
      <Screen edges={['left', 'right']}>
        <TextField label="Search" value={query} onChangeText={setQuery} placeholder="2k, intervals, steady…" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label="All" selected={filters.length === 0} onPress={() => setFilters([])} />
          {chips.map((c) => (
            <Chip
              key={c.value}
              label={c.label}
              selected={filters.includes(c.value)}
              onPress={() => setFilters((f) => (f.includes(c.value) ? f.filter((x) => x !== c.value) : [...f, c.value]))}
            />
          ))}
        </View>
        {visible.length === 0 ? (
          <EmptyState
            title={filters.length === 1 && filters[0] === 'favorites' ? 'No favourites yet' : 'No workouts found'}
            detail={filters.length === 1 && filters[0] === 'favorites' ? 'Tap the star on any workout to keep it here.' : 'Try another search or build your own.'}
            action={<Button title="Build workout" onPress={() => router.push('/workouts/builder')} />}
          />
        ) : null}
        <Animated.View key={`${filters.join(',')}|${query.trim()}`} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ gap: spacing.md }}>
        {groups.map((g) => (
          <View key={g.key} style={{ gap: spacing.sm }}>
            {g.title ? <SectionTitle>{g.title}</SectionTitle> : null}
            {g.plans.map((p) => (
              <Animated.View key={p.id} entering={FadeInDown.duration(180)} layout={LinearTransition}>
              <PlanCard
                plan={p}
                favorite={favs.has(p.id)}
                onPress={() => setSelected(p)}
                onToggleFavorite={() => toggleFav(p.id)}
                actions={
                  <>
                  <Button title="Start" small style={{ minHeight: 44 }} onPress={() => startOrConnect(p)} />
                  {p.builtIn ? (
                    <Button title="Customise" small variant="secondary" style={{ minHeight: 44 }} onPress={() => duplicate(p)} />
                  ) : (
                    <>
                      <Button
                        title="Edit"
                        small
                        variant="secondary"
                        style={{ minHeight: 44 }}
                        onPress={() => router.push({ pathname: '/workouts/builder', params: { id: p.id } })}
                      />
                      <Button title="Duplicate" small variant="secondary" style={{ minHeight: 44 }} onPress={() => duplicate(p)} />
                      <Button title="Delete" small variant="ghost" style={{ minHeight: 44 }} onPress={() => remove(p)} />
                    </>
                  )}
                  </>
                }
              />
              </Animated.View>
            ))}
          </View>
        ))}
        </Animated.View>
      </Screen>
      <StartSheet plan={selected} onClose={() => setSelected(null)} />
    </>
  );
}
