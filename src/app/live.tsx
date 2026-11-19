import * as ScreenOrientation from 'expo-screen-orientation';
import { router, Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/live/common';
import { ConnectionBanner, LivePageView, RestPanel, useLiveProgress, WaitingPanel } from '@/components/live/dashboard';
import { CoxBanner } from '@/components/live/overlays';
import { isRestState, repLabel } from '@/components/live/progress';
import { SummaryCard, type SummarySnapshot } from '@/components/live/Summary';
import { averageHeartRate, reconnectNow, retrySave, useSession, useSessionExtras } from '@/session';
import { useSettings } from '@/storage/settings';
import { dialog } from '@/ui/dialog';
import { Button, EmptyState, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';
import { planTitle } from '@/workouts';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

// Locking can be unsupported (web, some tablets); the layout copes with either orientation.
const lock = (o: ScreenOrientation.OrientationLock) =>
  Promise.resolve()
    .then(() => ScreenOrientation.lockAsync(o))
    .catch(() => {});

const SETTLE_MS = 220;
// Called from the gesture's UI-thread callback, so it must be a worklet (a plain function crashes there).
const settle = (reduce: boolean) => {
  'worklet';
  return { duration: reduce ? 0 : SETTLE_MS, easing: Easing.out(Easing.cubic) };
};

/** Pager slot: slides with the shared fractional page position. */
function Slot({ i, pos, w, children }: { i: number; pos: SharedValue<number>; w: number; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: (i - pos.value) * w }] }));
  return <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: w }, style]}>{children}</Animated.View>;
}

function Dot({ i, pos, active, label, onPress }: { i: number; pos: SharedValue<number>; active: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(pos.value - i));
    return { backgroundColor: interpolateColor(d, [0, 1], [t.accent, t.border]), transform: [{ scale: 1.3 - 0.3 * d }] };
  });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Show page ${label}`} accessibilityState={{ selected: active }} hitSlop={14} onPress={onPress}>
      <Animated.View style={[{ width: 10, height: 10, borderRadius: 5 }, style]} />
    </Pressable>
  );
}

function snapshotOf(s: ReturnType<typeof useSession.getState>): SummarySnapshot {
  return { title: s.plan ? planTitle(s.plan) : 'Just Row', metrics: s.metrics, splits: s.splits, avgHr: averageHeartRate(s.strokes, s.splits) };
}
const takeSnapshot = () => snapshotOf(useSession.getState());

export default function LiveScreen() {
  const t = useTheme();

  const phase = useSession((s) => s.phase);
  const plan = useSession((s) => s.plan);
  const lastSaved = useSession((s) => s.lastSavedWorkoutId);
  const resting = useSession((s) => isRestState(s.phase, s.metrics));
  const waiting = useSession((s) => s.phase === 'ready' || (s.phase === 'rowing' && !s.lastStroke));
  const finishWorkout = useSession((s) => s.finishWorkout);
  const discardWorkout = useSession((s) => s.discardWorkout);
  const setCoxMuted = useSession((s) => s.setCoxMuted);
  const coxOn = useSettings((s) => s.settings.coxswain.enabled);
  const bannerOn = useSettings((s) => s.settings.coxswain.bannerEnabled);
  const pages = useSettings((s) => s.settings.livePages);
  const progress = useLiveProgress();

  const [pageIdx, setPageIdx] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const muted = useSessionExtras((s) => s.muted);
  const saveFailed = useSessionExtras((s) => s.saveFailed);
  const pmLost = useSessionExtras((s) => s.pmLost);
  const connected = useSession((s) => s.connection.status === 'connected');
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState<{ id: string | null; snapshot: SummarySnapshot } | null>(null);
  const snapRef = useRef<SummarySnapshot>(takeSnapshot());

  // Landscape while rowing; portrait for the summary (and its dialogs) and once the screen unmounts.
  const summary = !!finished || phase === 'finished';
  useEffect(() => {
    void lock(summary ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE);
  }, [summary]);
  useEffect(() => () => void lock(ScreenOrientation.OrientationLock.PORTRAIT_UP), []);

  // Keep a fresh snapshot while rowing so the summary survives the store being reset.
  useEffect(
    () =>
      useSession.subscribe((s) => {
        if (s.metrics && s.phase !== 'idle' && s.phase !== 'finished') {
          snapRef.current = snapshotOf(s);
        }
      }),
    [],
  );

  // PM-driven finish (autosave on workoutEnd).
  useEffect(() => {
    if (phase === 'finished' && !finished) setFinished({ id: lastSaved, snapshot: snapRef.current });
  }, [phase, lastSaved, finished]);
  useEffect(() => {
    if (finished && !finished.id && lastSaved && phase === 'finished') setFinished({ ...finished, id: lastSaved });
  }, [finished, lastSaved, phase]);

  const toggleMute = useCallback(() => setCoxMuted(!useSessionExtras.getState().muted), [setCoxMuted]);

  const reconnect = useCallback(() => {
    reconnectNow().catch((e) => dialog('Could not reconnect', e instanceof Error ? e.message : String(e)));
  }, []);

  // A save that failed is still in memory: do not let Done throw it away unasked.
  const done = useCallback(() => {
    if (!useSessionExtras.getState().saveFailed) return leave();
    dialog('Discard unsaved workout?', 'It could not be saved yet. Leaving now loses it for good.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          discardWorkout();
          leave();
        },
      },
    ]);
  }, [discardWorkout]);

  const doFinish = useCallback(async () => {
    const snapshot = takeSnapshot();
    setSaving(true);
    try {
      const id = await finishWorkout();
      if (useSession.getState().phase === 'idle') return leave(); // nothing was rowed: no summary
      setFinished({ id, snapshot });
    } catch (e) {
      dialog('Could not save the workout', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [finishWorkout]);

  const confirmEnd = useCallback(() => {
    dialog('End workout?', 'Save what you have rowed to the logbook, or throw it away.', [
      { text: 'Keep rowing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () =>
          dialog('Discard this workout?', 'It will not be saved and cannot be recovered.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Discard',
              style: 'destructive',
              onPress: () => {
                discardWorkout();
                leave();
              },
            },
          ]),
      },
      { text: 'Finish & save', onPress: () => void doFinish() },
    ]);
  }, [discardWorkout, doFinish]);

  const active = !finished && phase !== 'idle' && phase !== 'finished';

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (active) confirmEnd();
        else if (finished || phase === 'finished') done();
        else leave();
        return true;
      });
      return () => sub.remove();
    }, [active, confirmEnd, finished, phase, done]),
  );

  const n = pages.length;
  const reduce = useReducedMotion();
  const pos = useSharedValue(0); // fractional page index, driven on the UI thread
  const base = useSharedValue(0);
  const w = size.w;
  const goTo = useCallback(
    (i: number) => {
      // Far jumps start one page away: only the target's neighbours are mounted.
      if (Math.abs(i - pageIdx) > 1) pos.value = i + Math.sign(pageIdx - i);
      setPageIdx(i);
      pos.value = withTiming(i, settle(reduce));
    },
    [pos, reduce, pageIdx],
  );
  // Settings can drop pages while we are on the last one.
  useEffect(() => {
    if (pageIdx > n - 1) {
      setPageIdx(n - 1);
      pos.value = n - 1;
    }
  }, [n, pageIdx, pos]);

  const swipe = usePanGesture({
    activeOffsetX: [-20, 20],
    failOffsetY: [-30, 30],
    onActivate: () => {
      'worklet';
      base.value = pos.value;
    },
    onUpdate: (e) => {
      'worklet';
      if (w <= 0) return;
      const raw = base.value - e.translationX / w;
      // Rubber band: a third of the overshoot past the first/last page.
      pos.value = raw < 0 ? raw / 3 : raw > n - 1 ? n - 1 + (raw - (n - 1)) / 3 : raw;
    },
    onDeactivate: (e) => {
      'worklet';
      if (w <= 0) return;
      const delta = -e.translationX / w;
      const dir = Math.abs(e.velocityX) > 500 ? (e.velocityX < 0 ? 1 : -1) : Math.abs(delta) > 0.25 ? (delta > 0 ? 1 : -1) : 0;
      const target = Math.max(0, Math.min(n - 1, Math.round(base.value) + dir));
      pos.value = withTiming(target, settle(reduce));
      scheduleOnRN(setPageIdx, target);
    },
  });

  if (finished || phase === 'finished') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom', 'left', 'right']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <SummaryCard
            workoutId={finished?.id ?? lastSaved}
            snapshot={finished?.snapshot ?? snapRef.current}
            onViewAnalysis={(id) => router.replace(`/workout/${id}`)}
            saveFailed={saveFailed}
            onRetry={retrySave}
            onDone={done}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (phase === 'idle') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center' }}>
        <EmptyState title="No workout in progress" detail="Pick a workout or Just Row from the Row tab." action={<Button title="Back" onPress={leave} />} />
      </SafeAreaView>
    );
  }

  const page = pages[Math.min(pageIdx, n - 1)];
  const state = phase === 'paused' ? 'PAUSED' : resting ? 'REST' : waiting ? 'READY' : 'ROWING';
  const rep = progress?.rep !== null && progress?.rep !== undefined ? repLabel(progress.rep, progress.reps) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm }}>
        <Text size="lg" weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>
          {plan ? planTitle(plan) : 'Just Row'}
        </Text>
        <Text size="sm" tone={resting ? 'warn' : 'faint'} weight="700" numberOfLines={1}>
          {rep ? `${rep} · ${state}` : state}
        </Text>
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          {n > 1
            ? pages.map((p, i) => <Dot key={p.id} i={i} pos={pos} active={p.id === page?.id} label={p.name} onPress={() => goTo(i)} />)
            : null}
        </View>
        {coxOn ? (
          <IconButton
            icon={muted ? 'volume-mute' : 'volume-high'}
            label={muted ? 'Unmute coxswain' : 'Mute coxswain'}
            onPress={toggleMute}
            color={muted ? t.textFaint : t.accent}
          />
        ) : null}
        <Button title={saving ? 'Saving…' : 'End'} variant="danger" small loading={saving} onPress={confirmEnd} style={{ minHeight: 40, minWidth: 72 }} />
      </View>
      <GestureDetector gesture={swipe}>
        <View
          style={{ flex: 1, marginHorizontal: spacing.md, marginBottom: spacing.sm }}
          onLayout={(e) => setSize({ w: Math.floor(e.nativeEvent.layout.width), h: Math.floor(e.nativeEvent.layout.height) })}>
          {size.w > 0 && page ? (
            resting ? (
              <RestPanel width={size.w} height={size.h} />
            ) : (
              // Only the current and neighbouring pages are mounted; all stay live while sliding.
              <View style={{ flex: 1, overflow: 'hidden' }}>
                {pages.map((p, i) =>
                  Math.abs(i - pageIdx) <= 1 ? (
                    <Slot key={p.id} i={i} pos={pos} w={size.w}>
                      <LivePageView page={p} width={size.w} height={size.h} />
                    </Slot>
                  ) : null,
                )}
              </View>
            )
          ) : null}
          {waiting && !resting ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
              <WaitingPanel />
            </View>
          ) : null}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, gap: spacing.xs }}>
            <ConnectionBanner />
            {pmLost && !connected ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: t.bad }}>
                <Text tone="bad" weight="700" style={{ flex: 1 }}>
                  Lost the PM5. Tap to reconnect
                </Text>
                <Button title="Reconnect" small onPress={reconnect} />
              </View>
            ) : null}
          </View>
          {coxOn && bannerOn ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.sm }}>
              <CoxBanner />
            </View>
          ) : null}
        </View>
      </GestureDetector>
    </SafeAreaView>
  );
}
