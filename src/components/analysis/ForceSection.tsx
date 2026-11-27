import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { analyzeForceCurve, analyzeForceSession, describeFlag, describeShape, idealForceCurve } from '@/analysis';
import type { ForceCurveShape, TechniqueFlag, WorkoutRecord } from '@/core/types';
import { convertForce, formatDuration, formatPace, paceUnit } from '@/core/units';
import { DistributionBars, ForceCurveChart, LineChart, type ForceCurve, type LineSeries } from '@/components/charts';
import { useSettings } from '@/storage/settings';
import { Card, EmptyState, SectionTitle, Text } from '@/ui/kit';
import { radius, spacing, useTheme } from '@/ui/theme';

import { Badge, InsightList, StatGrid } from './ui';

const CHIP_W = 44;

export function ForceSection({ record }: { record: WorkoutRecord }) {
  const t = useTheme();
  const unit = useSettings((s) => s.settings.forceUnit);
  const heightCm = useSettings((s) => s.settings.profile.heightCm);

  const curved = useMemo(() => record.strokes.filter((s) => s.forceCurve.length >= 4), [record.strokes]);
  const session = useMemo(() => (curved.length ? analyzeForceSession(record.strokes) : null), [curved.length, record.strokes]);
  const ideal = useMemo(() => (session ? idealForceCurve(session.avgPeakForceN, 32) : []), [session]);

  const [sel, setSel] = useState(0);
  const idx = Math.min(sel, Math.max(0, curved.length - 1));
  const stroke = curved[idx];
  const strokeListRef = useRef<FlatList<(typeof curved)[number]>>(null);
  useEffect(() => {
    // Keep the selected stroke's chip on screen when it is changed by the chevrons or the score chart.
    strokeListRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
  }, [idx]);
  const strokeAnalysis = useMemo(
    () =>
      stroke
        ? analyzeForceCurve(stroke.forceCurve, {
            driveTimeMs: stroke.driveTimeMs,
            recoveryTimeMs: stroke.recoveryTimeMs,
            driveLengthM: stroke.driveLengthM,
            strokeRate: stroke.strokeRate,
            heightCm,
          })
        : null,
    [stroke, heightCm],
  );

  const mainCurves = useMemo<ForceCurve[]>(
    () =>
      session
        ? [
            { key: 'avg', label: 'Session average', values: session.averageCurve, color: t.force, fill: true, peak: true },
            { key: 'ideal', label: 'Ideal shape', values: ideal, color: t.forceAlt, dashed: true },
          ]
        : [],
    [session, ideal, t],
  );
  const band = useMemo(
    () => (session ? { mean: session.averageCurve, std: session.curveStdDev, color: t.force } : undefined),
    [session, t.force],
  );
  const fatigueCurves = useMemo<ForceCurve[]>(
    () =>
      session
        ? [
            { key: 'early', label: 'First third', values: session.earlyCurve, color: t.force, peak: true },
            { key: 'late', label: 'Last third', values: session.lateCurve, color: t.warn, peak: true },
          ]
        : [],
    [session, t],
  );
  const scoreSeries = useMemo<LineSeries[]>(
    () =>
      session
        ? [
            {
              key: 's',
              label: 'Stroke score',
              points: session.scoreSeries.map((y, i) => ({ x: i + 1, y })),
              color: t.accent,
              format: (v) => v.toFixed(0),
            },
          ]
        : [],
    [session, t.accent],
  );
  const strokeCurves = useMemo<ForceCurve[]>(
    () =>
      stroke && session
        ? [
            { key: 'avg', label: 'Session average', values: session.averageCurve, color: t.forceAlt, dashed: true },
            { key: 'stroke', label: `Stroke ${stroke.strokeNumber}`, values: stroke.forceCurve, color: t.force, fill: true, peak: true },
          ]
        : [],
    [stroke, session, t],
  );

  const onScrub = useCallback(
    (x: number | null) => {
      if (x == null || !session) return;
      // scoreSeries is per analysed stroke; map proportionally onto strokes with curves.
      const f = (x - 1) / Math.max(1, session.scoreSeries.length - 1);
      setSel(Math.round(Math.min(1, Math.max(0, f)) * (curved.length - 1)));
    },
    [session, curved.length],
  );

  if (!session || curved.length === 0) {
    return (
      <EmptyState
        title="No force curve data"
        detail="The PM did not send force curves for this workout. Live force curves need a PM5 connected over Bluetooth (or the simulator)."
      />
    );
  }

  const shape = describeShape(session.dominantShape);
  const shapeItems = (Object.entries(session.shapeDistribution) as [ForceCurveShape, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      key: k,
      label: describeShape(k).title,
      value: v,
      valueText: `${Math.round(v * 100)}%`,
      color: k === 'ideal' ? t.good : t.force,
    }));
  const flagItems = (Object.entries(session.flagFrequency) as [TechniqueFlag, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const f = (n: number) => convertForce(n, unit).toFixed(0);

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <SectionTitle right={<Text tone="accent" weight="700">{`${Math.round(session.avgScore)}/100`}</Text>}>Average force curve</SectionTitle>
        <ForceCurveChart curves={mainCurves} band={band} unit={unit} />
        <Text weight="700">{shape.title}</Text>
        <Text size="sm" tone="dim">
          {shape.detail}
        </Text>
        <StatGrid
          items={[
            { label: 'Strokes', value: String(session.strokesAnalysed) },
            { label: 'Consistency', value: `${Math.round(session.consistency * 100)}%` },
            { label: 'Peak force', value: f(session.avgPeakForceN), unit },
            { label: 'Peak at', value: `${Math.round(session.avgPeakPosition * 100)}%`, unit: 'of drive' },
            { label: 'Fullness', value: session.avgFullness.toFixed(2) },
            { label: 'Smoothness', value: session.avgSmoothness.toFixed(2) },
          ]}
        />
      </Card>

      <Card>
        <SectionTitle>Fatigue: early vs late</SectionTitle>
        <ForceCurveChart curves={fatigueCurves} unit={unit} height={170} />
      </Card>

      {shapeItems.length > 0 ? (
        <Card>
          <SectionTitle>Curve shapes</SectionTitle>
          <DistributionBars items={shapeItems} max={1} />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Technique flags</SectionTitle>
        {flagItems.length === 0 ? (
          <Text tone="good">No recurring technique flags — nice, clean strokes.</Text>
        ) : (
          flagItems.map(([flag, v]) => {
            const d = describeFlag(flag);
            return (
              <View key={flag} style={{ gap: 4, marginBottom: spacing.sm }}>
                <DistributionBars items={[{ key: flag, label: d.title, value: v, valueText: `${Math.round(v * 100)}% of strokes`, color: v > 0.3 ? t.warn : t.force }]} max={1} />
                <Text size="sm" tone="dim">
                  {d.detail}
                </Text>
                <Text size="sm" tone="accent">
                  Drill: {d.drill}
                </Text>
              </View>
            );
          })
        )}
      </Card>

      {session.scoreSeries.length > 1 ? (
        <Card>
          <SectionTitle>Stroke score over the piece</SectionTitle>
          <Text size="xs" tone="faint">
            Drag across the chart to pick a stroke to inspect.
          </Text>
          <LineChart
            series={scoreSeries}
            left={{ domain: [0, 100] }}
            xFormat={(v) => `#${Math.round(v)}`}
            height={140}
            onScrub={onScrub}
            markerX={(idx / Math.max(1, curved.length - 1)) * (session.scoreSeries.length - 1) + 1}
          />
        </Card>
      ) : null}

      {stroke && strokeAnalysis ? (
        <Card>
          <SectionTitle
            right={
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <StepBtn icon="chevron-back" disabled={idx <= 0} onPress={() => setSel(idx - 1)} />
                <StepBtn icon="chevron-forward" disabled={idx >= curved.length - 1} onPress={() => setSel(idx + 1)} />
              </View>
            }>
            {`Stroke ${stroke.strokeNumber} · ${formatDuration(stroke.elapsedMs, { tenths: false })}`}
          </SectionTitle>
          <FlatList
            ref={strokeListRef}
            horizontal
            data={curved}
            keyExtractor={(s, i) => `${s.strokeNumber}-${i}`}
            showsHorizontalScrollIndicator={false}
            initialNumToRender={20}
            getItemLayout={(_, i) => ({ length: CHIP_W + spacing.xs, offset: (CHIP_W + spacing.xs) * i, index: i })}
            contentContainerStyle={{ gap: spacing.xs }}
            renderItem={({ item, index }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Stroke ${item.strokeNumber}`}
                accessibilityState={{ selected: index === idx }}
                onPress={() => setSel(index)}
                style={{
                  width: CHIP_W,
                  paddingVertical: 6,
                  alignItems: 'center',
                  borderRadius: radius.pill,
                  borderWidth: 2,
                  borderColor: index === idx ? t.accent : 'transparent',
                  backgroundColor: t.surfaceAlt,
                }}>
                <Text size="sm" weight="700">
                  {item.strokeNumber}
                </Text>
              </Pressable>
            )}
          />
          <ForceCurveChart curves={strokeCurves} unit={unit} height={170} />
          <Text size="sm" tone="dim">
            {formatPace(stroke.paceMsPer500, record.machineType)} {paceUnit(record.machineType)} · {stroke.strokeRate.toFixed(0)} spm · {stroke.watts.toFixed(0)} W · drive{' '}
            {stroke.driveLengthM.toFixed(2)} m in {(stroke.driveTimeMs / 1000).toFixed(2)} s
          </Text>
          <StatGrid
            items={[
              { label: 'Score', value: strokeAnalysis.valid ? strokeAnalysis.score.toFixed(0) : '–', tone: 'accent' },
              { label: 'Shape', value: strokeAnalysis.valid ? describeShape(strokeAnalysis.shape).title : '–' },
              { label: 'Peak', value: f(strokeAnalysis.peakForceN), unit },
              { label: 'Peak at', value: `${Math.round(strokeAnalysis.peakPosition * 100)}%` },
              { label: 'Fullness', value: strokeAnalysis.fullness.toFixed(2) },
              { label: 'Smoothness', value: strokeAnalysis.smoothness.toFixed(2) },
              { label: 'Catch rise', value: `${Math.round(strokeAnalysis.riseFraction * 100)}%` },
              { label: 'Impulse', value: strokeAnalysis.impulseNs.toFixed(0), unit: 'N·s' },
              { label: 'Avg force', value: f(strokeAnalysis.avgForceN), unit },
            ]}
          />
          {strokeAnalysis.flags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {strokeAnalysis.flags.map((fl) => (
                <Badge key={fl} label={describeFlag(fl).title} color={t.warn} />
              ))}
            </View>
          ) : (
            <Text size="sm" tone="good">
              No technique flags on this stroke.
            </Text>
          )}
        </Card>
      ) : null}

      {session.insights.length > 0 ? (
        <Card>
          <SectionTitle>Technique insights</SectionTitle>
          <InsightList insights={session.insights} />
        </Card>
      ) : null}
    </View>
  );
}

function StepBtn({ icon, onPress, disabled }: { icon: 'chevron-back' | 'chevron-forward'; onPress: () => void; disabled: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={icon === 'chevron-back' ? 'Previous stroke' : 'Next stroke'}
      onPress={onPress}
      disabled={disabled}
      style={{ padding: 6, borderRadius: radius.pill, backgroundColor: t.surfaceAlt, opacity: disabled ? 0.4 : 1 }}>
      <Ionicons name={icon} size={16} color={t.text} />
    </Pressable>
  );
}
