import { dialog } from '@/ui/dialog';
import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { buildPacePlan } from '@/coach';
import { IconButton, NumField, TextField } from '@/components/live/common';
import { CATEGORY_LABEL, CoxOverride, PacePlanPreview, STRATEGY_OPTIONS, totalsLine } from '@/components/live/plans';
import { startOrConnect } from '@/components/live/start';
import type { IntervalDef, PaceStrategy, PlanSegment, WorkoutCategory, WorkoutKind, WorkoutPlan } from '@/core/types';
import { uid } from '@/core/units';
import { listCustomPlans, savePlan } from '@/storage/db';
import { Button, Card, Divider, Row, Screen, SectionTitle, Segmented, Text, Toggle } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';
import { addRepeats, BUILT_IN_WORKOUTS, newPlan, planTitle, segmentsTotal, validatePlan } from '@/workouts';
import { formatDistance, formatDuration } from '@/core/units';

const KINDS: { value: WorkoutKind; label: string }[] = [
  { value: 'single-distance', label: 'Distance' },
  { value: 'single-time', label: 'Time' },
  { value: 'single-calorie', label: 'Calories' },
  { value: 'intervals', label: 'Intervals' },
  { value: 'just-row', label: 'Just row' },
];
const CATEGORIES = Object.keys(CATEGORY_LABEL) as WorkoutCategory[];
const TYPES: { value: IntervalDef['type']; label: string }[] = [
  { value: 'distance', label: 'Distance' },
  { value: 'time', label: 'Time' },
  { value: 'calorie', label: 'Calories' },
];
type Strat = PaceStrategy | 'none';

const sameDef = (a: IntervalDef, b: IntervalDef) => JSON.stringify(a) === JSON.stringify(b);
const defaultDef = (): IntervalDef => ({ type: 'distance', value: 500, restMs: 120000 });

function IntervalEditor({
  def,
  onChange,
  fieldKey,
  mark,
}: {
  def: IntervalDef;
  onChange: (d: IntervalDef) => void;
  fieldKey: string;
  mark: (key: string, bad: boolean) => void;
}) {
  const valueKind = def.type === 'time' ? 'time' : def.type === 'calorie' ? 'calorie' : 'distance';
  const num = (k: string, v: number | null, apply: (n: number | undefined) => void) => {
    mark(`${fieldKey}.${k}`, Number.isNaN(v));
    if (!Number.isNaN(v)) apply(v ?? undefined);
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <Segmented options={TYPES} value={def.type} onChange={(type) => onChange({ ...def, type, value: type === 'distance' ? 500 : type === 'time' ? 60000 : 20 })} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <NumField
          key={`${fieldKey}-v-${def.type}`}
          label={def.type === 'distance' ? 'Work (m)' : def.type === 'time' ? 'Work (m:ss)' : 'Work (cal)'}
          kind={valueKind}
          value={def.value}
          onValue={(v) => num('value', v === null ? NaN : v, (n) => n !== undefined && onChange({ ...def, value: n }))}
        />
        <NumField
          key={`${fieldKey}-r`}
          label={def.undefinedRest ? 'Max rest (m:ss)' : 'Rest (m:ss)'}
          kind="time"
          optional
          value={def.restMs}
          onValue={(v) => num('rest', v, (n) => onChange({ ...def, restMs: n ?? 0 }))}
        />
      </View>
      <Row label="Undefined rest" hint="Rest ends when you start rowing" right={<Toggle value={!!def.undefinedRest} onChange={(u) => onChange({ ...def, undefinedRest: u })} />} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <NumField
          key={`${fieldKey}-p`}
          label="Target pace"
          kind="pace"
          optional
          value={def.target?.paceMsPer500}
          placeholder="1:50.0"
          onValue={(v) => num('pace', v, (n) => onChange({ ...def, target: { ...def.target, paceMsPer500: n } }))}
        />
        <NumField
          key={`${fieldKey}-s`}
          label="Target rate"
          kind="rate"
          optional
          value={def.target?.strokeRate}
          placeholder="28"
          onValue={(v) => num('rate', v, (n) => onChange({ ...def, target: { ...def.target, strokeRate: n } }))}
        />
      </View>
    </View>
  );
}

export default function Builder() {
  const t = useTheme();
  const { id, copy } = useLocalSearchParams<{ id?: string; copy?: string }>();
  const [plan, setPlan] = useState<WorkoutPlan>(() => ({ ...newPlan('single-distance'), name: '', category: 'custom' }));
  const [loading, setLoading] = useState(!!id);
  const [formKey, setFormKey] = useState(0);
  const [repeatBlock, setRepeatBlock] = useState<PlanSegment[] | null>(null);
  const [fixed, setFixed] = useState(true);
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const [strategy, setStrategy] = useState<Strat>('none');
  const [saving, setSaving] = useState(false);
  // Snapshot of the plan once loaded; any later difference is an unsaved change.
  const base = useRef<string | null>(null);
  if (!loading && base.current === null) base.current = JSON.stringify(plan);
  const stopGuard = usePreventRemove(base.current !== null && JSON.stringify(plan) !== base.current, ({ repeat }) =>
    dialog('Discard changes?', 'Your edits to this workout have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { stopGuard(); repeat(); } },
    ]),
  );

  useEffect(() => {
    if (!id) return;
    let alive = true;
    listCustomPlans()
      .then((custom) => {
        if (!alive) return;
        const found = custom.find((p) => p.id === id) ?? BUILT_IN_WORKOUTS.find((p) => p.id === id);
        if (found) {
          // Built-ins and explicit copies stay unsaved drafts (new id) until the user taps Save.
          const editable: WorkoutPlan = found.builtIn || copy ? { ...found, id: uid('plan-'), name: `${found.name || planTitle(found)} (copy)`, builtIn: false, favorite: false } : found;
          setPlan(editable);
          const defs = editable.intervals ?? [];
          setFixed(defs.length <= 1 || defs.every((d) => sameDef(d, defs[0])));
          setStrategy(editable.pacePlan ? editable.pacePlan.strategy : 'none');
          setFormKey((k) => k + 1);
        }
      })
      .catch((e) => dialog('Could not load workout', String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, copy]);

  const mark = useCallback((key: string, isBad: boolean) => {
    setBad((b) => (!!b[key] === isBad ? b : { ...b, [key]: isBad }));
  }, []);
  const num = (k: string, v: number | null, apply: (n: number | undefined) => void) => {
    mark(k, Number.isNaN(v));
    if (!Number.isNaN(v)) apply(v ?? undefined);
  };
  const patch = (p: Partial<WorkoutPlan>) => setPlan((cur) => ({ ...cur, ...p }));

  const changeKind = (kind: WorkoutKind) => {
    if (kind === plan.kind) return;
    const fresh = newPlan(kind);
    setPlan((cur) => ({ ...fresh, id: cur.id, name: cur.name, description: cur.description, category: cur.category, target: cur.target }));
    setStrategy('none');
    setBad({});
    setFormKey((k) => k + 1);
  };

  const defs = plan.intervals ?? [];
  const setDefs = (d: IntervalDef[]) => patch({ intervals: d });

  const single = plan.kind === 'single-distance' || plan.kind === 'single-time';
  const pacePlan = useMemo(() => {
    if (!single || strategy === 'none') return undefined;
    if (strategy === 'custom') return plan.pacePlan;
    const goal = plan.target?.paceMsPer500;
    if (!goal || !plan.value) return undefined;
    try {
      return buildPacePlan({ kind: plan.kind === 'single-distance' ? 'distance' : 'time', value: plan.value, goalPaceMsPer500: goal, strategy });
    } catch {
      return undefined;
    }
  }, [single, strategy, plan]);

  const finalPlan: WorkoutPlan = useMemo(
    () => ({ ...plan, name: plan.name.trim(), builtIn: false, pacePlan: single ? pacePlan : undefined }),
    [plan, single, pacePlan],
  );
  // Row now needs no name; saving does.
  const runPlan = useMemo(() => ({ ...finalPlan, name: finalPlan.name || planTitle(finalPlan) }), [finalPlan]);
  const runErrors = useMemo(() => {
    const e: string[] = [];
    if (Object.values(bad).some(Boolean)) e.push('Fix the highlighted fields.');
    if (single && strategy !== 'none' && strategy !== 'custom' && !plan.target?.paceMsPer500) e.push('Set a target pace to use a pacing strategy.');
    return [...e, ...validatePlan(runPlan)];
  }, [runPlan, bad, single, strategy, plan.target]);
  const errors = finalPlan.name ? runErrors : ['Give the workout a name.', ...runErrors];

  const rowNow = () => {
    if (!runErrors.length) startOrConnect(runPlan);
  };

  const save = async () => {
    if (errors.length) return;
    setSaving(true);
    try {
      await savePlan(finalPlan);
      stopGuard();
      router.back();
    } catch (e) {
      dialog('Could not save', String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Edit workout' }} />
        <ActivityIndicator color={t.accent} />
      </Screen>
    );
  }

  const valueField =
    plan.kind === 'single-distance' ? (
      <NumField key={`v${formKey}`} label="Distance (m)" kind="distance" value={plan.value} onValue={(v) => num('value', v, (n) => patch({ value: n }))} />
    ) : plan.kind === 'single-time' ? (
      <NumField key={`v${formKey}`} label="Time (h:mm:ss)" kind="time" value={plan.value} onValue={(v) => num('value', v, (n) => patch({ value: n }))} />
    ) : plan.kind === 'single-calorie' ? (
      <NumField key={`v${formKey}`} label="Calories" kind="calorie" value={plan.value} onValue={(v) => num('value', v, (n) => patch({ value: n }))} />
    ) : null;
  const splitKind = plan.kind === 'single-time' ? 'time' : plan.kind === 'single-calorie' ? 'calorie' : 'distance';

  const segs = plan.segments ?? [];
  const setSegs = (n: PlanSegment[]) => patch({ segments: n.length ? n : undefined });
  const segTime = plan.kind === 'single-time';
  const reset = () => {
    setBad({});
    setFormKey((k) => k + 1);
    setRepeatBlock(null);
  };
  const segTotal = segmentsTotal(segs);
  const fmtSeg = (v: number) => (segTime ? formatDuration(v, { tenths: false }) : formatDistance(v));
  const segmentsCard = (
    <>
      <SectionTitle>Segments</SectionTitle>
      <Text tone="dim" size="sm">
        Change the target rate or pace during one continuous piece. The monitor rows it as a single piece; the app shows each target and the coxswain calls the changes.
      </Text>
      {segs.map((sg, i) => (
        <Card key={`${formKey}-${i}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text weight="700" style={{ flex: 1 }}>
              Segment {i + 1}
            </Text>
            <IconButton
              icon="arrow-up"
              label={`Move segment ${i + 1} up`}
              onPress={() => {
                if (i === 0) return;
                const n = [...segs];
                [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                setSegs(n);
                reset();
              }}
            />
            <IconButton
              icon="arrow-down"
              label={`Move segment ${i + 1} down`}
              onPress={() => {
                if (i === segs.length - 1) return;
                const n = [...segs];
                [n[i + 1], n[i]] = [n[i]!, n[i + 1]!];
                setSegs(n);
                reset();
              }}
            />
            <IconButton
              icon="trash-outline"
              color={t.bad}
              label={`Remove segment ${i + 1}`}
              onPress={() => {
                setSegs(segs.filter((_, j) => j !== i));
                reset();
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <NumField
              label={segTime ? 'Length (m:ss)' : 'Length (m)'}
              kind={segTime ? 'time' : 'distance'}
              value={sg.duration}
              onValue={(v) => num(`seg${i}.d`, v === null ? NaN : v, (n) => n !== undefined && setSegs(segs.map((x, j) => (j === i ? { ...x, duration: n } : x))))}
            />
            <NumField
              label="Rate"
              kind="rate"
              optional
              value={sg.strokeRate}
              placeholder="22"
              onValue={(v) => num(`seg${i}.r`, v, (n) => setSegs(segs.map((x, j) => (j === i ? { ...x, strokeRate: n } : x))))}
            />
            <NumField
              label="Pace"
              kind="pace"
              optional
              value={sg.paceMsPer500}
              placeholder="1:55.0"
              onValue={(v) => num(`seg${i}.p`, v, (n) => setSegs(segs.map((x, j) => (j === i ? { ...x, paceMsPer500: n } : x))))}
            />
          </View>
        </Card>
      ))}
      <Button
        title="Add segment"
        variant="secondary"
        onPress={() => {
          const last = segs[segs.length - 1];
          setSegs([...segs, { duration: last?.duration ?? (segTime ? 300000 : 500), strokeRate: last?.strokeRate, paceMsPer500: last?.paceMsPer500 }]);
          reset();
        }}
      />
      {segs.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text tone="dim" size="sm" style={{ flex: 1 }}>
            {repeatBlock
              ? `${segs.length / repeatBlock.length} × block of ${repeatBlock.length}; tap to add more`
              : `Repeat ${segs.length === 1 ? 'this segment' : `these ${segs.length} segments`}`}
          </Text>
          {[2, 3, 4].map((n) => (
            <Button
              key={n}
              title={`${repeatBlock ? '+' : '×'} ${n}`}
              small
              variant="secondary"
              onPress={() => {
                const r = addRepeats(segs, repeatBlock, n);
                // The piece grows with the repeats, so the monitor length matches it.
                patch({ segments: r.segments, value: segmentsTotal(r.segments) });
                reset();
                setRepeatBlock(r.block);
              }}
            />
          ))}
        </View>
      ) : null}
      {segs.length && plan.value ? (
        <Text tone={segTotal > plan.value ? 'bad' : 'dim'} size="sm">
          Segments cover {fmtSeg(segTotal)} of {fmtSeg(plan.value)}; the last one runs to the end.
        </Text>
      ) : null}
    </>
  );

  return (
    <>
      <Stack.Screen options={{ title: id && !copy ? 'Edit workout' : 'Build workout' }} />
      <Screen edges={['left', 'right']}>
        <TextField label="Name" value={plan.name} onChangeText={(name) => patch({ name })} placeholder="e.g. Tuesday pyramid" error={!plan.name.trim()} />
        <TextField label="Description" value={plan.description ?? ''} onChangeText={(description) => patch({ description })} placeholder="What is this session for?" multiline />
        <SectionTitle>Category</SectionTitle>
        <Segmented options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} value={plan.category ?? 'custom'} onChange={(category) => patch({ category })} />

        <SectionTitle>Type</SectionTitle>
        <Segmented options={KINDS} value={plan.kind} onChange={changeKind} />

        {plan.kind === 'just-row' ? (
          <Text tone="dim">An open piece with no target — the monitor records splits as you go.</Text>
        ) : null}

        {valueField ? (
          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              {valueField}
              <NumField
                key={`s${formKey}`}
                label={splitKind === 'time' ? 'Split (m:ss)' : splitKind === 'calorie' ? 'Split (cal)' : 'Split (m)'}
                kind={splitKind}
                optional
                value={plan.splitValue}
                onValue={(v) => num('split', v, (n) => patch({ splitValue: n }))}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <NumField
                key={`p${formKey}`}
                label="Target pace"
                kind="pace"
                optional
                placeholder="1:55.0"
                value={plan.target?.paceMsPer500}
                onValue={(v) => num('pace', v, (n) => patch({ target: { ...plan.target, paceMsPer500: n } }))}
              />
              <NumField
                key={`r${formKey}`}
                label="Target rate"
                kind="rate"
                optional
                placeholder="24"
                value={plan.target?.strokeRate}
                onValue={(v) => num('rate', v, (n) => patch({ target: { ...plan.target, strokeRate: n } }))}
              />
            </View>
            {single ? (
              <>
                <Text size="xs" tone="faint" weight="700">
                  PACING STRATEGY
                </Text>
                <Segmented<Strat>
                  options={[
                    { value: 'none', label: 'None' },
                    ...STRATEGY_OPTIONS,
                    ...(plan.pacePlan?.strategy === 'custom' ? [{ value: 'custom' as Strat, label: 'Custom' }] : []),
                  ]}
                  value={strategy}
                  onChange={setStrategy}
                />
                {pacePlan ? <PacePlanPreview plan={pacePlan} /> : null}
              </>
            ) : null}
          </Card>
        ) : null}

        {single ? segmentsCard : null}

        {plan.kind === 'intervals' ? (
          <>
            <Segmented
              options={[
                { value: 'fixed', label: 'Fixed intervals' },
                { value: 'variable', label: 'Variable intervals' },
              ]}
              value={fixed ? 'fixed' : 'variable'}
              onChange={(v) => {
                const f = v === 'fixed';
                if (f && defs.length) setDefs(defs.map(() => ({ ...defs[0] })));
                if (!f) patch({ repeatForever: undefined });
                setFixed(f);
                setBad({});
                setFormKey((k) => k + 1);
              }}
            />
            {fixed ? (
              <Card>
                <Row
                  label="Unlimited (until I stop)"
                  hint="The monitor repeats the interval until you end the workout"
                  right={
                    <Toggle
                      value={!!plan.repeatForever}
                      onChange={(u) => {
                        const base = defs[0] ?? defaultDef();
                        patch({ repeatForever: u || undefined, intervals: Array.from({ length: u ? 1 : 8 }, () => ({ ...base })) });
                        mark('count', false);
                        setFormKey((k) => k + 1);
                      }}
                    />
                  }
                />
                {plan.repeatForever ? null : (
                  <NumField
                    key={`c${formKey}`}
                    label="Number of intervals"
                    kind="count"
                    value={defs.length}
                    onValue={(v) =>
                      num('count', v, (n) => {
                        if (!n) return;
                        const base = defs[0] ?? defaultDef();
                        setDefs(Array.from({ length: n }, () => ({ ...base })));
                      })
                    }
                  />
                )}
                <IntervalEditor
                  key={`f${formKey}`}
                  fieldKey="fixed"
                  mark={mark}
                  def={defs[0] ?? defaultDef()}
                  onChange={(d) => setDefs(Array.from({ length: Math.max(1, defs.length) }, () => ({ ...d })))}
                />
              </Card>
            ) : (
              <>
                {defs.map((d, i) => (
                  <Animated.View key={i} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} layout={LinearTransition}>
                  <Card key={`${formKey}-${i}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text weight="700" style={{ flex: 1 }}>
                        Interval {i + 1}
                      </Text>
                      <IconButton
                        icon="arrow-up"
                        label={`Move interval ${i + 1} up`}
                        onPress={() => {
                          if (i === 0) return;
                          const n = [...defs];
                          [n[i - 1], n[i]] = [n[i], n[i - 1]];
                          setDefs(n);
                          setFormKey((k) => k + 1);
                        }}
                      />
                      <IconButton
                        icon="arrow-down"
                        label={`Move interval ${i + 1} down`}
                        onPress={() => {
                          if (i === defs.length - 1) return;
                          const n = [...defs];
                          [n[i + 1], n[i]] = [n[i], n[i + 1]];
                          setDefs(n);
                          setFormKey((k) => k + 1);
                        }}
                      />
                      <IconButton
                        icon="trash-outline"
                        color={t.bad}
                        label={`Remove interval ${i + 1}`}
                        onPress={() => {
                          setDefs(defs.filter((_, j) => j !== i));
                          setBad({});
                          setFormKey((k) => k + 1);
                        }}
                      />
                    </View>
                    <IntervalEditor fieldKey={`row${i}`} mark={mark} def={d} onChange={(nd) => setDefs(defs.map((x, j) => (j === i ? nd : x)))} />
                  </Card>
                  </Animated.View>
                ))}
                <Button title="Add interval" variant="secondary" onPress={() => setDefs([...defs, { ...(defs[defs.length - 1] ?? defaultDef()) }])} />
              </>
            )}
          </>
        ) : null}

        <SectionTitle>Coxswain</SectionTitle>
        <CoxOverride value={plan.cox} onChange={(cox) => patch({ cox })} />

        <Divider />
        <Card>
          <Text weight="700">{planTitle(finalPlan)}</Text>
          {totalsLine(finalPlan) ? <Text tone="dim">{totalsLine(finalPlan)}</Text> : null}
          {runErrors.length ? (
            runErrors.map((e) => (
              <Text key={e} tone="bad" size="sm">
                • {e}
              </Text>
            ))
          ) : (
            <Text tone="good" size="sm">
              Ready — the monitor can run this workout.{finalPlan.name ? '' : ' Add a name to save it.'}
            </Text>
          )}
        </Card>
        <Button title="Row now" onPress={rowNow} disabled={runErrors.length > 0} />
        <Button title="Save workout" variant="secondary" onPress={save} disabled={errors.length > 0} loading={saving} />
      </Screen>
    </>
  );
}
