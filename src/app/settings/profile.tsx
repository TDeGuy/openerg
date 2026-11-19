import { Stack, router, usePreventRemove } from 'expo-router';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';

import { estimateMaxHr } from '@/components/analysis/helpers';
import { Field } from '@/components/analysis/ui';
import type { AthleteProfile } from '@/core/types';
import { formatDuration, formatPace, parseDuration } from '@/core/units';
import { useSettings } from '@/storage/settings';
import { dialog } from '@/ui/dialog';
import { Button, Card, Screen, Segmented, Text } from '@/ui/kit';
import { spacing } from '@/ui/theme';

type Sex = 'male' | 'female' | 'other' | 'unset';

/** Parses an optional number within a range; '' → null, invalid → undefined. */
function optNum(text: string, lo: number, hi: number): number | null | undefined {
  const s = text.trim().replace(',', '.');
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

export default function ProfileScreen() {
  const profile = useSettings((s) => s.settings.profile);
  const updateProfile = useSettings((s) => s.updateProfile);
  const str = (v: number | null) => (v == null ? '' : String(v));

  const [name, setName] = useState(profile.name);
  const [weight, setWeight] = useState(str(profile.weightKg));
  const [height, setHeight] = useState(str(profile.heightCm));
  const [birth, setBirth] = useState(str(profile.birthYear));
  const [sex, setSex] = useState<Sex>(profile.sex ?? 'unset');
  const [maxHr, setMaxHr] = useState(str(profile.maxHeartRate));
  const [restHr, setRestHr] = useState(str(profile.restingHeartRate));
  const [ref2k, setRef2k] = useState(profile.reference2kMs ? formatDuration(profile.reference2kMs) : '');

  const form = [name, weight, height, birth, sex, maxHr, restHr, ref2k].join('|');
  const initial = useRef(form);
  const dirty = form !== initial.current;
  const stopGuard = usePreventRemove(dirty, ({ repeat }) =>
    dialog('Discard changes?', 'Your profile edits have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { stopGuard(); repeat(); } },
    ]),
  );

  const year = new Date().getFullYear();
  const w = optNum(weight, 25, 250);
  const h = optNum(height, 100, 250);
  const b = optNum(birth, 1900, year - 5);
  const mx = optNum(maxHr, 100, 230);
  const rs = optNum(restHr, 25, 120);
  const twoK = ref2k.trim() ? parseDuration(ref2k) : null;
  const twoKOk = twoK === null || (Number.isFinite(twoK) && twoK >= 4 * 60000 && twoK <= 20 * 60000);
  const hrOrder = mx == null || rs == null || mx === undefined || rs === undefined || rs < mx;
  const valid = w !== undefined && h !== undefined && b !== undefined && mx !== undefined && rs !== undefined && twoKOk && hrOrder;
  const estMax = estimateMaxHr(b ?? null, Date.now());

  const save = () => {
    if (!valid) return;
    const patch: Partial<AthleteProfile> = {
      name: name.trim(),
      weightKg: w ?? null,
      heightCm: h ?? null,
      birthYear: b == null ? null : Math.round(b),
      sex: sex === 'unset' ? null : sex,
      maxHeartRate: mx == null ? null : Math.round(mx),
      restingHeartRate: rs == null ? null : Math.round(rs),
      reference2kMs: twoK,
    };
    updateProfile(patch);
    stopGuard();
    router.back();
  };

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Athlete profile' }} />
      <Card>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Optional" maxLength={40} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Field flex label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" error={w === undefined ? '25–250 kg' : null} />
          <Field flex label="Height (cm)" value={height} onChangeText={setHeight} keyboardType="number-pad" error={h === undefined ? '100–250 cm' : null} />
        </View>
        <Field label="Birth year" value={birth} onChangeText={setBirth} keyboardType="number-pad" placeholder="1990" error={b === undefined ? `1900–${year - 5}` : null} />
        <Text size="xs" tone="faint" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Sex
        </Text>
        <Segmented
          value={sex}
          onChange={setSex}
          options={[
            { value: 'unset', label: 'Prefer not to say' },
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Text size="xs" tone="faint">
          Weight powers W/kg, weight-adjusted results and calorie estimates. Height refines stroke-length analysis.
        </Text>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Field
            flex
            label="Max HR"
            value={maxHr}
            onChangeText={setMaxHr}
            keyboardType="number-pad"
            placeholder={estMax ? String(estMax) : '190'}
            error={mx === undefined ? '100–230 bpm' : null}
            hint={!maxHr.trim() && estMax ? `Estimated ${estMax} bpm from your age` : undefined}
          />
          <Field
            flex
            label="Resting HR"
            value={restHr}
            onChangeText={setRestHr}
            keyboardType="number-pad"
            placeholder="55"
            error={rs === undefined ? '25–120 bpm' : !hrOrder ? 'Must be below max HR' : null}
          />
        </View>
        <Field
          label="Reference 2k"
          value={ref2k}
          onChangeText={setRef2k}
          keyboardType="numbers-and-punctuation"
          placeholder="7:30.0"
          error={twoKOk ? null : 'Use m:ss.t between 4:00 and 20:00'}
          hint={`${twoK ? `${formatPace(twoK / 4)} /500m — used for training zones and coxswain targets. ` : 'Used for training zones. '}Updates automatically when you row a faster 2k on the RowErg (simulator rows excluded).`}
        />
      </Card>
      <Button title="Save profile" onPress={save} disabled={!valid} />
    </Screen>
  );
}
