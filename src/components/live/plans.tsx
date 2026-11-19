/** Plan card, pace-plan preview and the start sheet (goal, strategy, ghost race). */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildPacePlan } from '@/coach';
import type { CoxStyle, PacePlan, PaceStrategy, PlanCox, WorkoutCategory, WorkoutListItem, WorkoutPlan } from '@/core/types';
import { formatDistance, formatDuration, formatPace, paceBasisM, paceFor, paceUnit } from '@/core/units';
import { useSession } from '@/session';
import { listWorkouts } from '@/storage/db';
import { Button, Card, Chip, Divider, SectionTitle, Segmented, Text } from '@/ui/kit';
import { radius, spacing, useTheme } from '@/ui/theme';
import { describePlan, planTitle, planTotals } from '@/workouts';

import { IconButton, NumField } from './common';
import { startOrConnect } from './start';
import { ShellIcon } from '@/ui/ShellIcon';

export const CATEGORY_LABEL: Record<WorkoutCategory, string> = {
  test: 'Tests',
  'steady-state': 'Steady state',
  threshold: 'Threshold',
  vo2max: 'VO2 max',
  sprint: 'Sprint',
  technique: 'Technique',
  warmup: 'Warm-up',
  custom: 'Custom',
};

export const STRATEGY_OPTIONS: { value: Exclude<PaceStrategy, 'custom'>; label: string }[] = [
  { value: 'even', label: 'Even' },
  { value: 'negative-split', label: 'Negative split' },
  { value: 'fast-start-settle-sprint', label: 'Fast start · settle · sprint' },
];

export function totalsLine(plan: WorkoutPlan): string {
  const tot = planTotals(plan);
  const bits: string[] = [];
  if (tot.distanceM) bits.push(formatDistance(tot.distanceM));
  if (tot.durationMs) bits.push(formatDuration(tot.durationMs, { tenths: false }));
  if (tot.restMs) bits.push(`${formatDuration(tot.restMs, { tenths: false })} rest`);
  return bits.join(' · ');
}

export function PlanCard({
  plan,
  favorite,
  onPress,
  onToggleFavorite,
  actions,
}: {
  plan: WorkoutPlan;
  favorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  actions?: React.ReactNode;
}) {
  const t = useTheme();
  const totals = totalsLine(plan);
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="lg" weight="700">
            {plan.name || planTitle(plan)}
          </Text>
          <Text size="sm" tone="accent" weight="600">
            {planTitle(plan)}
            {totals ? `  ·  ${totals}` : ''}
          </Text>
        </View>
        <IconButton
          icon={favorite ? 'star' : 'star-outline'}
          color={favorite ? t.warn : t.textFaint}
          label={favorite ? 'Remove from favourites' : 'Add to favourites'}
          onPress={onToggleFavorite}
        />
      </View>
      <Text tone="dim" size="sm">
        {plan.description || describePlan(plan)}
      </Text>
      {actions ? <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>{actions}</View> : null}
    </Card>
  );
}

/** Horizontal bar of pace-plan segments with labels and paces. */
export function PacePlanPreview({ plan }: { plan: PacePlan }) {
  const t = useTheme();
  const machine = useSession((s) => s.connection.device?.machineType);

  const paces = plan.segments.map((s) => s.targetPaceMsPer500);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', height: 56, alignItems: 'flex-end', gap: 2 }}>
        {plan.segments.map((s, i) => {
          const span = slowest - fastest;
          const h = span > 0 ? 24 + ((slowest - s.targetPaceMsPer500) / span) * 32 : 40;
          return (
            <View
              key={i}
              style={{
                flex: Math.max(0.02, s.endFraction - s.startFraction),
                height: h,
                backgroundColor: s.targetPaceMsPer500 < plan.goalPaceMsPer500 ? t.accent : t.pace + '80',
                borderRadius: radius.sm,
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {plan.segments.map((s, i) => (
          <View key={i} style={{ flex: Math.max(0.02, s.endFraction - s.startFraction) }}>
            <Text size="xs" tone="dim" numberOfLines={1}>
              {s.label}
            </Text>
            <Text size="xs" weight="700" numberOfLines={1}>
              {formatPace(s.targetPaceMsPer500, machine)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type CoxMode = 'global' | 'on' | 'off';
const STYLES: { value: CoxStyle | 'global'; label: string }[] = [
  { value: 'global', label: 'Default' },
  { value: 'training', label: 'Training' },
  { value: 'race', label: 'Race' },
];

/** Per-workout coxswain override: on / off / follow settings, plus Race or Training style (default: Race for tests, else settings). */
export function CoxOverride({ value, onChange }: { value: PlanCox | undefined; onChange: (v: PlanCox | undefined) => void }) {
  const mode: CoxMode = value?.enabled === undefined ? 'global' : value.enabled ? 'on' : 'off';
  const set = (enabled: boolean | undefined, style: CoxStyle | undefined) =>
    onChange(enabled === undefined && !style ? undefined : { ...(enabled === undefined ? {} : { enabled }), ...(style ? { style } : {}) });
  return (
    <View style={{ gap: spacing.sm }}>
      <Segmented<CoxMode>
        options={[
          { value: 'global', label: 'Coxswain: settings' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
        value={mode}
        onChange={(m) => set(m === 'global' ? undefined : m === 'on', m === 'off' ? undefined : value?.style)}
      />
      {mode !== 'off' ? (
        <Segmented<CoxStyle | 'global'>
          options={STYLES}
          value={value?.style ?? 'global'}
          onChange={(p) => set(value?.enabled, p === 'global' ? undefined : p)}
        />
      ) : null}
    </View>
  );
}

type GoalMode = 'pace' | 'time' | 'distance';

/** Bottom sheet to configure targets for a plan, then start it. */
export function StartSheet({ plan, onClose }: { plan: WorkoutPlan | null; onClose: () => void }) {
  return (
    <Modal visible={!!plan} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {plan ? <StartSheetBody key={plan.id} plan={plan} onClose={onClose} /> : null}
    </Modal>
  );
}

function StartSheetBody({ plan, onClose }: { plan: WorkoutPlan; onClose: () => void }) {
  const t = useTheme();
  const machine = useSession((s) => s.connection.device?.machineType);
  const basis = paceBasisM(machine);
  const single = plan.kind === 'single-distance' || plan.kind === 'single-time';
  const title = planTitle(plan);
  const [mode, setMode] = useState<GoalMode>('pace');
  const [goalPace, setGoalPace] = useState<number | null>(paceFor(plan.pacePlan?.goalPaceMsPer500 || plan.target?.paceMsPer500 || 0, machine) || null);
  const [goalOther, setGoalOther] = useState<number | null>(null);
  const [rate, setRate] = useState<number | null>(plan.target?.strokeRate ?? null);
  const [strategy, setStrategy] = useState<Exclude<PaceStrategy, 'custom'>>(
    plan.pacePlan && plan.pacePlan.strategy !== 'custom' ? plan.pacePlan.strategy : 'even',
  );
  const [past, setPast] = useState<WorkoutListItem[]>([]);
  const [ghost, setGhost] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cox, setCox] = useState(plan.cox);

  useEffect(() => {
    let alive = true;
    listWorkouts({ search: title, limit: 30 })
      .then((items) => alive && setPast(items.filter((i) => i.title === title || i.plan?.id === plan.id).slice(0, 8)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [title, plan.id]);

  const pace = useMemo(() => {
    const valid = (v: number | null) => (v !== null && Number.isFinite(v) && v > 0 ? v : null);
    if (mode === 'pace') {
      const g = valid(goalPace);
      return g && (g * 500) / basis;
    }
    const g = valid(goalOther);
    if (!g || !plan.value) return null;
    if (mode === 'time' && plan.kind === 'single-distance') return (g / plan.value) * 500;
    if (mode === 'distance' && plan.kind === 'single-time') return (plan.value / g) * 500;
    return null;
  }, [mode, goalPace, goalOther, plan, basis]);

  const pacePlan = useMemo(() => {
    if (!single || !pace || !plan.value) return null;
    try {
      return buildPacePlan({ kind: plan.kind === 'single-distance' ? 'distance' : 'time', value: plan.value, goalPaceMsPer500: pace, strategy });
    } catch {
      return null;
    }
  }, [single, pace, plan, strategy]);

  const invalid = (mode === 'pace' ? Number.isNaN(goalPace) : Number.isNaN(goalOther)) || Number.isNaN(rate);

  const start = () => {
    const configured: WorkoutPlan = {
      ...plan,
      target: { ...plan.target, paceMsPer500: pace ?? plan.target?.paceMsPer500, strokeRate: rate && rate > 0 ? rate : plan.target?.strokeRate },
      pacePlan: pacePlan ?? (pace ? undefined : plan.pacePlan),
      cox,
    };
    onClose();
    startOrConnect(configured, ghost ? { ghostWorkoutId: ghost } : undefined);
  };

  const goalModes: { value: GoalMode; label: string }[] = [{ value: 'pace', label: 'Target pace' }];
  if (plan.kind === 'single-distance') goalModes.push({ value: 'time', label: 'Goal time' });
  if (plan.kind === 'single-time') goalModes.push({ value: 'distance', label: 'Goal distance' });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md }}>
        <Text size="lg" weight="800" style={{ flex: 1 }} numberOfLines={1}>
          {plan.name || title}
        </Text>
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        <Text tone="accent" weight="700">
          {title}
          {totalsLine(plan) ? `  ·  ${totalsLine(plan)}` : ''}
        </Text>
        <Text tone="dim">{plan.description || describePlan(plan)}</Text>
        {plan.segments?.length ? (
          <Text tone="dim" size="sm">
            {plan.segments.length} segments: the target changes as you row, and the coxswain calls each change.
          </Text>
        ) : null}
        <Button title="Row" onPress={start} disabled={invalid} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text weight="700" style={{ flex: 1 }}>
            Options: goal, pacing, ghost, coxswain
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={t.textDim} />
        </Pressable>
        {open ? (
          <>
        <SectionTitle>Goal (optional)</SectionTitle>
        {goalModes.length > 1 ? <Segmented options={goalModes} value={mode} onChange={setMode} /> : null}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {mode === 'pace' ? (
            <NumField key="pace" label={`Pace ${paceUnit(machine)}`} kind="pace" optional value={goalPace} onValue={setGoalPace} placeholder="1:55.0" />
          ) : mode === 'time' ? (
            <NumField key="time" label="Goal time" kind="time" optional value={goalOther} onValue={setGoalOther} placeholder="7:30.0" />
          ) : (
            <NumField key="dist" label="Goal metres" kind="distance" optional value={goalOther} onValue={setGoalOther} placeholder="7500" />
          )}
          <NumField label="Rate (spm)" kind="rate" optional value={rate} onValue={setRate} placeholder="24" />
        </View>
        {pace && mode !== 'pace' ? (
          <Text tone="dim" size="sm">
            That is an average of {formatPace(pace, machine)} {paceUnit(machine)}.
          </Text>
        ) : null}

        {single && pace ? (
          <>
            <SectionTitle>Pacing strategy</SectionTitle>
            <Segmented options={STRATEGY_OPTIONS} value={strategy} onChange={setStrategy} />
            {pacePlan ? <PacePlanPreview plan={pacePlan} /> : null}
          </>
        ) : null}

        <SectionTitle>Race a previous result</SectionTitle>
        {past.length === 0 ? (
          <Text tone="faint" size="sm">
            Row this workout once and you can race your own ghost here next time.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Chip label="No ghost" selected={!ghost} onPress={() => setGhost(null)} />
            {past.map((w) => (
              <Chip
                key={w.id}
                selected={ghost === w.id}
                onPress={() => setGhost(w.id)}
                label={`${new Date(w.startedAt).toLocaleDateString()} · ${plan.kind === 'single-time' ? formatDistance(w.distanceM) : formatDuration(w.elapsedMs)} · ${formatPace(w.avgPaceMsPer500, w.machineType)}`}
              />
            ))}
          </View>
        )}
        {ghost ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <ShellIcon size={18} color={t.accent} />
            <Text size="sm" tone="dim" style={{ flex: 1 }}>
              The pace boat will row your previous result stroke for stroke.
            </Text>
          </View>
        ) : null}
        <SectionTitle>Coxswain for this workout</SectionTitle>
        <CoxOverride value={cox} onChange={setCox} />
        <Divider />
        <Button title="Row" onPress={start} disabled={invalid} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
