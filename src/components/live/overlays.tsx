/** Pace boat lanes and coxswain banner. */
import { Ionicons } from '@expo/vector-icons';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import type { CoxCallCategory } from '@/core/types';
import { useSession } from '@/session';
import { Text } from '@/ui/kit';
import { radius, spacing, useTheme } from '@/ui/theme';

import type { IconName } from './common';
import { gapText, layoutBoats, remainingMeters } from './paceBoatLayout';
import { computeProgress } from './progress';

const BOAT_W = 52;
const MARK_SPACING = 40;

/** Pentagon hull pointing right (bow). */
const hull = (h: number) => `M0,${-h} L${BOAT_W * 0.65},${-h} L${BOAT_W},0 L${BOAT_W * 0.65},${h} L0,${h} Z`;

/** Boat that glides to its x (centre, in px) between data updates. */
function Boat({ x, y, color, label, labelColor, h }: { x: number; y: number; color: string; label: string; labelColor: string; h: number }) {
  const tx = useRef(new Animated.Value(x)).current;
  useEffect(() => {
    Animated.timing(tx, { toValue: x, duration: 300, useNativeDriver: true }).start();
  }, [x, tx]);
  return (
    <Animated.View style={{ position: 'absolute', left: -BOAT_W / 2, top: y - h - 15, width: BOAT_W, transform: [{ translateX: tx }] }}>
      <Text size="xs" weight="800" numberOfLines={1} style={{ color: labelColor, width: 120, height: 14 }}>
        {label}
      </Text>
      <Svg width={BOAT_W} height={h * 2 + 2}>
        <Path d={hull(h)} fill={color} transform={`translate(0,${h + 1})`} />
      </Svg>
    </Animated.View>
  );
}

/** PM5-style pace boat: two lanes, you versus the pace/ghost boat, finish line near the end of the piece. */
export const PaceBoat = memo(function PaceBoat({ width: w, height }: { width: number; height: number }) {
  const t = useTheme();
  const boat = useSession((s) => s.paceBoat);
  const plan = useSession((s) => s.plan);
  const m = useSession((s) => s.metrics);
  const splits = useSession((s) => s.splits);
  const remaining = useMemo(() => (boat && m ? remainingMeters(computeProgress(plan, m, splits), boat.targetPaceMsPer500) : null), [boat, plan, m, splits]);
  if (!boat) {
    return (
      <View style={{ width: w, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text tone="faint">No pace boat for this workout</Text>
      </View>
    );
  }
  const g = gapText(boat);
  const color = g.tone === 'good' ? t.good : g.tone === 'bad' ? t.bad : t.accent;
  const L = layoutBoats(boat.gapM, remaining, boat.targetPaceMsPer500);
  const headH = Math.min(44, Math.max(28, height * 0.28));
  const H = Math.max(40, height - headH - 4);
  const laneH = H / 2;
  const hullH = Math.max(4, Math.min(9, laneH * 0.16));
  const scroll = L.finishX === null ? -(((m?.distanceM ?? 0) * L.pxPerM * w) % MARK_SPACING) : 0;
  const marks = Math.ceil(w / MARK_SPACING) + 1;
  const cell = Math.max(4, laneH / 4);
  return (
    <View
      style={{ width: w, height, gap: 4 }}
      accessible
      accessibilityLabel={`${g.main} ${g.sub}`}>
      <View style={{ height: headH, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
        <Text size="xl" weight="800" style={{ color }} numberOfLines={1}>
          {g.main}
        </Text>
        <Text size="sm" weight="700" tone="dim" numberOfLines={1} style={{ flexShrink: 1 }}>
          {g.sub}
        </Text>
      </View>
      <View style={{ height: H, borderRadius: radius.md, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
        <Svg width={w} height={H} style={{ position: 'absolute' }}>
          <Rect x={0} y={laneH - 1} width={w} height={2} fill={t.border} />
          {Array.from({ length: marks }, (_, i) => (
            <Line key={i} x1={i * MARK_SPACING + scroll} x2={i * MARK_SPACING + scroll} y1={0} y2={H} stroke={t.border} strokeWidth={1} strokeDasharray="3 9" />
          ))}
          {L.finishX !== null
            ? Array.from({ length: Math.ceil(H / cell) }, (_, i) => (
                <React.Fragment key={i}>
                  <Rect x={L.finishX! * w - cell} y={i * cell} width={cell} height={cell} fill={i % 2 ? t.text : t.surface} />
                  <Rect x={L.finishX! * w} y={i * cell} width={cell} height={cell} fill={i % 2 ? t.surface : t.text} />
                </React.Fragment>
              ))
            : null}
        </Svg>
        <Boat x={L.paceX * w} y={laneH / 2 + 7} h={hullH} color={t.warn} labelColor={t.warn} label={boat.label || 'PACE BOAT'} />
        <Boat x={L.youX * w} y={laneH * 1.5 + 7} h={hullH} color={t.accent} labelColor={t.accent} label="YOU" />
      </View>
    </View>
  );
});

const CATEGORY_ICON: Record<CoxCallCategory, IconName> = {
  pacing: 'speedometer-outline',
  rate: 'pulse-outline',
  technique: 'construct-outline',
  motivation: 'flame-outline',
  info: 'information-circle-outline',
  'race-plan': 'flag-outline',
  safety: 'warning-outline',
};

/** Latest coxswain call, fades in, auto-fades out after a few seconds. */
export const CoxBanner = memo(function CoxBanner() {
  const t = useTheme();
  const call = useSession((s) => s.lastCoxCall);
  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(call);

  useEffect(() => {
    if (!call) return;
    setShown(call);
    opacity.stopAnimation();
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const hold = call.priority >= 3 ? 9000 : call.priority === 2 ? 7000 : 5000;
    const id = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }).start();
    }, hold);
    return () => clearTimeout(id);
  }, [call, opacity]);

  if (!shown) return null;
  const color = shown.priority >= 3 || shown.category === 'safety' ? t.warn : t.accent;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        opacity,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: t.surface,
        borderLeftWidth: 4,
        borderLeftColor: color,
      }}>
      <Ionicons name={CATEGORY_ICON[shown.category] ?? 'megaphone-outline'} size={26} color={color} />
      <Text size="lg" weight="700" style={{ flex: 1 }} numberOfLines={2}>
        {shown.text}
      </Text>
    </Animated.View>
  );
});
