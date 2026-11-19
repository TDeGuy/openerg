import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { errorMessage } from '@/components/live/common';
import { HomePicker } from '@/components/live/HomePicker';
import { StartSheet, totalsLine } from '@/components/live/plans';
import { startOrConnect } from '@/components/live/start';
import type { WorkoutListItem, WorkoutPlan } from '@/core/types';
import { formatDistance, formatDuration, formatPace, paceUnit } from '@/core/units';
import { useIntegrations } from '@/integrations/store';
import { useSession, useSessionExtras } from '@/session';
import { getFavoritePlanIds, listCustomPlans, listWorkouts, useDbVersion } from '@/storage/db';
import { useSettings } from '@/storage/settings';
import { dialog } from '@/ui/dialog';
import { Button, Card, SectionTitle, Screen, Text } from '@/ui/kit';
import { radius, spacing, useTheme } from '@/ui/theme';
import { BUILT_IN_WORKOUTS, QUICK_WORKOUTS, planTitle } from '@/workouts';

const STATUS_TEXT = {
  idle: 'Not connected',
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
  error: 'Connection error',
} as const;

function weekStart(now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

/** Tappable surface with a ≥44 pt target and an accessible label. */
function Tile({ label, onPress, style, children }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        { backgroundColor: t.surface, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, minHeight: 44, gap: 2 },
        pressed && { opacity: 0.7 },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

function ConnectionPill() {
  const t = useTheme();
  const connection = useSession((s) => s.connection);
  const hr = useSession((s) => s.hrConnected);
  const simulator = useSettings((s) => s.settings.useSimulator);
  const dev = connection.device;
  const connected = connection.status === 'connected';
  const color = connected ? t.good : connection.status === 'error' ? t.bad : connection.status === 'idle' || connection.status === 'disconnected' ? t.textFaint : t.warn;
  const label = connected && dev ? `${dev.name}${dev.simulated || simulator ? ' · Simulator' : ''}` : `${STATUS_TEXT[connection.status]} · Tap to connect`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${hr ? ', heart-rate strap connected' : ''}. Open connection settings`}
      onPress={() => router.push('/connect')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: spacing.sm,
        minHeight: 44,
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        backgroundColor: t.surfaceAlt,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text size="sm" weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Ionicons name="heart" size={14} color={hr ? t.heart : t.textFaint} />
    </Pressable>
  );
}

function IntegrationBanner() {
  const t = useTheme();
  const alert = useIntegrations((s) => s.alert);
  const dismiss = useIntegrations((s) => s.dismissAlert);
  if (!alert) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: t.warn, backgroundColor: t.surface, paddingLeft: spacing.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${alert.message} Open connected services`}
        onPress={() => router.push('/settings/services')}
        style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: spacing.sm }}>
        <Text size="sm" weight="600">
          {alert.message}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={dismiss} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={20} color={t.textFaint} />
      </Pressable>
    </View>
  );
}

function PlanRow({ title, plans, onPick }: { title: string; plans: WorkoutPlan[]; onPick: (p: WorkoutPlan) => void }) {
  if (!plans.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {plans.map((p) => (
          <Tile key={p.id} label={`${p.name || planTitle(p)}, open start options`} onPress={() => onPick(p)} style={{ width: 160 }}>
            <Text weight="700" numberOfLines={1}>
              {p.name || planTitle(p)}
            </Text>
            <Text size="sm" tone="accent" weight="600" numberOfLines={1}>
              {planTitle(p)}
            </Text>
            {totalsLine(p) ? (
              <Text size="xs" tone="faint" numberOfLines={1}>
                {totalsLine(p)}
              </Text>
            ) : null}
          </Tile>
        ))}
      </ScrollView>
    </>
  );
}

export default function RowHome() {
  const t = useTheme();
  const version = useDbVersion();
  const init = useSession((s) => s.init);
  const connect = useSession((s) => s.connect);
  const status = useSession((s) => s.connection.status);
  const phase = useSession((s) => s.phase);
  const lastErgId = useSettings((s) => s.settings.lastErgId);
  const [initDone, setInitDone] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [recent, setRecent] = useState<WorkoutListItem[]>([]);
  const [custom, setCustom] = useState<WorkoutPlan[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState<WorkoutPlan | null>(null);
  const [picking, setPicking] = useState(false);
  const homeIds = useSettings((s) => s.settings.homeWorkoutIds);
  const updateSettings = useSettings((s) => s.update);

  useEffect(() => {
    if (useSession.getState().connection.status === 'connected') {
      setInitDone(true);
      return;
    }
    init()
      .then((r) => setInitError(r.ok ? null : (r.reason ?? 'Bluetooth unavailable')))
      .catch((e) => setInitError(errorMessage(e)))
      .finally(() => setInitDone(true));
  }, [init]);

  useEffect(() => {
    let alive = true;
    // shortcut: "This week" counts only the latest 100 workouts, plenty for one week.
    Promise.all([listWorkouts({ limit: 100 }), listCustomPlans(), getFavoritePlanIds()])
      .then(([w, c, f]) => {
        if (!alive) return;
        setRecent(w);
        setCustom(c);
        setFavIds(f);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);

  const pool = useMemo(() => [...QUICK_WORKOUTS, ...custom, ...BUILT_IN_WORKOUTS], [custom]);
  const homePlans = useMemo(() => homeIds.map((id) => pool.find((p) => p.id === id)).filter((p): p is WorkoutPlan => !!p), [homeIds, pool]);
  const favourites = useMemo(() => [...custom, ...BUILT_IN_WORKOUTS].filter((p) => favIds.includes(p.id)), [custom, favIds]);
  const recentPlans = useMemo(() => {
    const seen = new Set<string>();
    const out: WorkoutPlan[] = [];
    for (const w of recent) {
      const p = w.plan;
      if (!p || seen.has(p.id) || p.kind === 'just-row') continue;
      seen.add(p.id);
      out.push(p);
      if (out.length >= 8) break;
    }
    return out;
  }, [recent]);
  const week = useMemo(() => {
    const from = weekStart();
    // Real sessions only, on the machine used most recently (metres of different machines do not add up).
    const real = recent.filter((w) => !w.simulated);
    const items = real.filter((w) => w.startedAt >= from && w.machineType === (real[0]?.machineType ?? w.machineType));
    return { metres: items.reduce((a, w) => a + w.distanceM, 0), sessions: items.length, ms: items.reduce((a, w) => a + w.elapsedMs, 0) };
  }, [recent]);
  const last = recent[0] ?? null;

  const pmLost = useSessionExtras((s) => s.pmLost);
  // "Not now" hides it until the link is newly lost again (pmLost overriding it kept the card stuck).
  useEffect(() => {
    if (pmLost) setDismissed(false);
  }, [pmLost]);
  const offerReconnect = initDone && !initError && !dismissed && !!lastErgId && (status === 'idle' || status === 'disconnected' || status === 'error');
  const inProgress = phase === 'rowing' || phase === 'rest' || phase === 'ready' || phase === 'paused';

  const reconnect = async () => {
    if (!lastErgId) return;
    setReconnecting(true);
    try {
      await connect(lastErgId);
    } catch (e) {
      dialog('Could not reconnect', `${errorMessage(e)}\n\nWake the PM5 and open Connect on it, then pick it from the list.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open list', onPress: () => router.push('/connect') },
      ]);
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text size="xxl" weight="800">
          Row
        </Text>
        <View style={{ flexShrink: 1 }}>
          <ConnectionPill />
        </View>
      </View>
      <IntegrationBanner />
      {initError && status !== 'connected' ? (
        <Text size="sm" tone="warn">
          {initError}
        </Text>
      ) : null}

      {offerReconnect ? (
        <Card>
          <Text weight="700">{pmLost ? 'Lost the PM5. Tap to reconnect' : 'Reconnect to your last erg?'}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="Connect" onPress={() => void reconnect()} loading={reconnecting} style={{ flex: 1 }} />
            <Button title="Not now" variant="ghost" onPress={() => setDismissed(true)} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {inProgress ? (
        <Card onPress={() => router.push('/live')} style={{ borderColor: t.accent }}>
          <Text weight="700" tone="accent">
            Workout in progress — tap to return
          </Text>
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Just row"
        onPress={() => startOrConnect(null)}
        style={({ pressed }) => ({
          backgroundColor: t.accent,
          borderRadius: radius.lg,
          minHeight: 112,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          opacity: pressed ? 0.8 : 1,
        })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Ionicons name="play" size={36} color={t.accentText} />
          <Text size="xxl" weight="800" style={{ color: t.accentText }}>
            Just Row
          </Text>
        </View>
        <Text size="sm" weight="600" style={{ color: t.accentText }}>
          No set distance or time
        </Text>
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <SectionTitle>Standard pieces</SectionTitle>
        </View>
        <Button title="Edit" small variant="ghost" style={{ minHeight: 44 }} onPress={() => setPicking(true)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {homePlans.map((p) => (
          <Tile
            key={p.id}
            label={`${p.name || planTitle(p)}, open start options`}
            onPress={() => setSheet(p)}
            style={{ flexBasis: '31%', flexGrow: 1, minHeight: 76, alignItems: 'center', justifyContent: 'center' }}>
            <Text size="xl" weight="800">
              {p.name || planTitle(p)}
            </Text>
            <Text size="xs" tone="faint" numberOfLines={1}>
              {planTitle(p)}
            </Text>
          </Tile>
        ))}
      </View>

      <PlanRow title="Favourites" plans={favourites} onPick={setSheet} />
      <PlanRow title="Recent" plans={recentPlans} onPick={setSheet} />

      <SectionTitle>This week</SectionTitle>
      <Card style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md }}>
        {[
          { label: 'Metres', value: Math.round(week.metres).toLocaleString() },
          { label: 'Sessions', value: String(week.sessions) },
          { label: 'Time', value: formatDuration(week.ms, { tenths: false }) },
        ].map((x) => (
          <View key={x.label} style={{ flex: 1, alignItems: 'center' }}>
            <Text size="lg" weight="800">
              {x.value}
            </Text>
            <Text size="xs" tone="faint">
              {x.label}
            </Text>
          </View>
        ))}
      </Card>

      {last ? (
        <>
          <SectionTitle>Last workout</SectionTitle>
          <Card onPress={() => router.push(`/workout/${last.id}`)}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text size="lg" weight="700">
                  {last.title || (last.plan ? planTitle(last.plan) : 'Workout')}
                </Text>
                <Text size="sm" tone="faint">
                  {new Date(last.startedAt).toLocaleString()}
                  {last.simulated ? ' · simulator' : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={t.textFaint} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text weight="700">{formatDuration(last.elapsedMs)}</Text>
              <Text weight="700">{formatDistance(last.distanceM)}</Text>
              <Text weight="700">{formatPace(last.avgPaceMsPer500, last.machineType)} {paceUnit(last.machineType)}</Text>
            </View>
          </Card>
        </>
      ) : null}

      <SectionTitle>More workouts</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[
          { icon: 'library-outline' as const, title: 'Workout library', hint: 'Tests, intervals, steady state', to: '/workouts' as const },
          { icon: 'construct-outline' as const, title: 'Build your own', hint: 'Distance, time or intervals', to: '/workouts/builder' as const },
        ].map((x) => (
          <Tile key={x.to} label={x.title} onPress={() => router.push(x.to)} style={{ flex: 1, minHeight: 88 }}>
            <Ionicons name={x.icon} size={22} color={t.accent} />
            <Text weight="700">{x.title}</Text>
            <Text size="xs" tone="faint">
              {x.hint}
            </Text>
          </Tile>
        ))}
      </View>

      <StartSheet plan={sheet} onClose={() => setSheet(null)} />
      <HomePicker visible={picking} pool={pool} ids={homeIds} onChange={(ids) => updateSettings({ homeWorkoutIds: ids })} onClose={() => setPicking(false)} />
    </Screen>
  );
}
