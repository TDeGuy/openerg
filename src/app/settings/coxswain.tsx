import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';

import { createVoice, coxFor, sampleCalls } from '@/coach';
import { wantsDuck } from '@/coach/voice';
import { NEURAL_DOWNLOAD_MB, NEURAL_VOICES, neuralVoice } from '@/coach/neural/bank';
import { downloadNeural, getNeuralState, prewarmNeural, speakNeural, subscribeNeural, type NeuralState } from '@/coach/neural/kitten';
import { describeFlag, FLAG_COPY } from '@/analysis';
import { Field, Stepper } from '@/components/analysis/ui';
import type { CoxswainSettings, TechniqueFlag } from '@/core/types';
import { useSettings } from '@/storage/settings';
import { Button, Card, Divider, Row, Screen, SectionTitle, Segmented, Text, Toggle } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

type Voice = { id: string; name: string; language: string };

export default function CoxswainSettingsScreen() {
  const t = useTheme();
  const cox = useSettings((s) => s.settings.coxswain);
  const updateCoxswain = useSettings((s) => s.updateCoxswain);
  const voice = useMemo(() => createVoice(), []);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voiceQuery, setVoiceQuery] = useState('');
  const sampleIdx = useRef(0);

  useEffect(() => {
    let alive = true;
    voice
      .listVoices()
      .then((v) => alive && setVoices(v))
      .catch(() => alive && setVoices([]));
    return () => {
      alive = false;
      voice.stop();
    };
  }, [voice]);

  const set = (patch: Partial<CoxswainSettings>) => updateCoxswain(patch);
  const neural = useSyncExternalStore(subscribeNeural, getNeuralState);
  const isNeural = cox.voiceEngine === 'neural';
  const neuralOnDisk = neural.status === 'downloaded' || neural.status === 'loading' || neural.status === 'ready';

  // Re-render the phrase bank whenever what it depends on changes (already-rendered phrases are skipped).
  useEffect(() => {
    if (isNeural && neuralOnDisk) prewarmNeural(cox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNeural, neuralOnDisk, cox.neuralVoiceId, cox.voiceRate, cox.personality, cox.style]);

  const chooseEngine = (engine: CoxswainSettings['voiceEngine']) => {
    set({ voiceEngine: engine });
    if (engine === 'neural' && neural.status === 'absent') void downloadNeural();
  };

  const preview = () => {
    const lines = sampleCalls(coxFor(null, cox).personality);
    if (lines.length === 0) return;
    const text = lines[sampleIdx.current++ % lines.length];
    const call = { id: `preview-${Date.now()}`, elapsedMs: 0, text, category: 'motivation' as const, priority: 2 as const };
    const s = { ...cox, voiceEnabled: true, enabled: true };
    voice.stop();
    // Preview waits for the neural voice instead of using the in-workout 1.5 s fallback deadline.
    if (isNeural && neuralOnDisk) void speakNeural(text, s, null).then((ok) => ok || voice.speak(call, { ...s, voiceEngine: 'system' }));
    else voice.speak(call, s);
  };

  // shortcut: plain substring filter capped at 40 rows; upgrade to a sectioned picker if voice lists get unwieldy.
  const shownVoices = useMemo(() => {
    const q = voiceQuery.trim().toLowerCase();
    return (voices ?? []).filter((v) => !q || v.name.toLowerCase().includes(q) || v.language.toLowerCase().includes(q)).slice(0, 40);
  }, [voices, voiceQuery]);
  const currentVoice = voices?.find((v) => v.id === cox.voiceId);

  const categories: { key: keyof CoxswainSettings; label: string; hint: string }[] = [
    { key: 'pacingCalls', label: 'Pacing', hint: 'Pace vs target, pace boat, plan segments' },
    { key: 'techniqueCalls', label: 'Technique', hint: 'Force-curve and rhythm feedback' },
    { key: 'motivationCalls', label: 'Motivation', hint: 'Encouragement and pushes' },
    { key: 'splitCalls', label: 'Splits', hint: 'Split times and distance milestones' },
    { key: 'rateCalls', label: 'Rate', hint: 'Stroke rate vs target' },
  ];
  const flags = Object.keys(FLAG_COPY) as TechniqueFlag[];
  const muted = cox.mutedFlags ?? [];
  const toggleFlag = (f: TechniqueFlag, on: boolean) => set({ mutedFlags: on ? muted.filter((m) => m !== f) : [...muted, f] });

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Coxswain' }} />
      <Card>
        <Row label="Coxswain" hint="Live coaching calls during workouts" right={<Toggle value={cox.enabled} onChange={(v) => set({ enabled: v })} />} />
        <Divider />
        <Row label="Voice" hint="Speak calls aloud" right={<Toggle value={cox.voiceEnabled} onChange={(v) => set({ voiceEnabled: v })} />} />
        <Divider />
        <Row label="Banner" hint="Show calls on screen" right={<Toggle value={cox.bannerEnabled} onChange={(v) => set({ bannerEnabled: v })} />} />
        <Divider />
        <Row label="Haptics" hint="Vibrate on urgent calls" right={<Toggle value={cox.hapticsEnabled} onChange={(v) => set({ hapticsEnabled: v })} />} />
      </Card>

      <SectionTitle>Style</SectionTitle>
      <Card>
        <Text size="sm" tone="dim">
          Default coxing (a workout can override it; tests default to Race)
        </Text>
        <Segmented
          value={cox.style}
          onChange={(v) => set({ style: v })}
          options={[
            { value: 'training', label: 'Training' },
            { value: 'race', label: 'Race' },
          ]}
        />
        <Text size="sm" tone="dim">
          Training voice
        </Text>
        <Segmented
          value={cox.personality === 'race' ? 'calm' : cox.personality}
          onChange={(v) => set({ personality: v })}
          options={[
            { value: 'calm', label: 'Calm' },
            { value: 'encouraging', label: 'Encouraging' },
          ]}
        />
        <Text size="sm" tone="dim">
          How often
        </Text>
        <Segmented
          value={cox.frequency}
          onChange={(v) => set({ frequency: v })}
          options={[
            { value: 'minimal', label: 'Minimal' },
            { value: 'normal', label: 'Normal' },
            { value: 'chatty', label: 'Chatty' },
          ]}
        />
        <Text size="xs" tone="faint">
          e.g. “{sampleCalls(coxFor(null, cox).personality)[0] ?? ''}”
        </Text>
      </Card>

      <SectionTitle>Calls</SectionTitle>
      <Card>
        {categories.map((c, i) => (
          <React.Fragment key={c.key}>
            {i > 0 ? <Divider /> : null}
            <Row label={c.label} hint={c.hint} right={<Toggle value={Boolean(cox[c.key])} onChange={(v) => set({ [c.key]: v } as Partial<CoxswainSettings>)} />} />
          </React.Fragment>
        ))}
      </Card>

      <SectionTitle>Technique faults</SectionTitle>
      <Card>
        <Row
          label="Repeat a fault at most"
          hint="Times per piece; the last one is announced as the last"
          right={<Stepper value={cox.maxCuesPerFault} onChange={(v) => set({ maxCuesPerFault: v })} step={1} min={1} max={6} format={(v) => String(Math.round(v))} />}
        />
        {flags.map((f) => (
          <React.Fragment key={f}>
            <Divider />
            <Row label={describeFlag(f).title} right={<Toggle value={!muted.includes(f)} onChange={(on) => toggleFlag(f, on)} />} />
          </React.Fragment>
        ))}
      </Card>

      <SectionTitle>Voice</SectionTitle>
      <Card>
        <Text size="sm" tone="dim">
          Voice engine
        </Text>
        <Segmented
          value={cox.voiceEngine}
          onChange={chooseEngine}
          options={[
            { value: 'system', label: 'System' },
            { value: 'neural', label: 'Neural' },
          ]}
        />
        <Text size="xs" tone="faint">
          Neural is a more natural voice (KittenTTS) that runs on your phone, offline after a one-time ~{NEURAL_DOWNLOAD_MB} MB download.
        </Text>
        {isNeural ? (
          <>
            <NeuralStatusLine state={neural} />
            {neural.status === 'absent' || neural.status === 'error' ? (
              <Button title={`${neural.status === 'error' ? 'Retry download' : 'Download'} (~${NEURAL_DOWNLOAD_MB} MB)`} variant="secondary" onPress={() => void downloadNeural()} />
            ) : null}
            {NEURAL_VOICES.map((v) => (
              <VoiceOption key={v.id} label={v.name} sub={v.sub} selected={neuralVoice(cox.neuralVoiceId).id === v.id} onPress={() => set({ neuralVoiceId: v.id })} color={t.accent} />
            ))}
          </>
        ) : null}
        <Divider />
        <Row
          label="Lower music while the coxswain speaks"
          hint="System voice: iOS lowers other audio; Android depends on the speech engine. The on-device neural voice cannot lower music yet and plays over it."
          right={<Toggle value={wantsDuck(cox)} onChange={(v) => set({ duckMusic: v })} />}
        />
        <Divider />
        <Row label="Speech rate" right={<Stepper value={cox.voiceRate} onChange={(v) => set({ voiceRate: v })} step={0.1} min={0.5} max={1.5} />} />
        <Divider />
        <Row label="Pitch" right={<Stepper value={cox.voicePitch} onChange={(v) => set({ voicePitch: v })} step={0.1} min={0.5} max={2} />} />
        <Button title="Preview" variant="secondary" onPress={preview} />
        <Divider />
        <Text size="sm" tone="dim">
          {isNeural ? 'System voice (fallback)' : 'Voice'}: <Text weight="700">{cox.voiceId ? (currentVoice?.name ?? cox.voiceId) : 'System default'}</Text>
        </Text>
        {voices === null ? (
          <Text tone="faint" size="sm">
            Loading voices…
          </Text>
        ) : voices.length === 0 ? (
          <Text tone="faint" size="sm">
            No extra voices are installed; the system default is used. You can add voices in your phone's accessibility / text-to-speech settings.
          </Text>
        ) : (
          <>
            <Field value={voiceQuery} onChangeText={setVoiceQuery} placeholder={`Search ${voices.length} voices (name or language, e.g. en-GB)`} autoCapitalize="none" autoCorrect={false} />
            <VoiceOption label="System default" sub="" selected={cox.voiceId == null} onPress={() => set({ voiceId: null })} color={t.accent} />
            {shownVoices.map((v) => (
              <VoiceOption key={v.id} label={v.name} sub={v.language} selected={cox.voiceId === v.id} onPress={() => set({ voiceId: v.id })} color={t.accent} />
            ))}
          </>
        )}
      </Card>
    </Screen>
  );
}

function NeuralStatusLine({ state }: { state: NeuralState }) {
  const text = {
    unsupported: 'Not available in this build; the system voice is used. Update the app to enable it.',
    absent: 'Not downloaded yet; the system voice is used until it is.',
    downloading: `Downloading… ${Math.round(state.progress * 100)}% of ~${NEURAL_DOWNLOAD_MB} MB`,
    downloaded: `Downloaded (~${NEURAL_DOWNLOAD_MB} MB). Loads when a workout starts.`,
    loading: 'Loading voice model…',
    ready: state.total > 0 && state.rendered < state.total ? `Ready. Preparing phrases ${state.rendered}/${state.total}…` : 'Ready.',
    error: 'Download or load failed; the system voice is used.',
  }[state.status];
  return (
    <Text size="sm" tone="dim" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

function VoiceOption({ label, sub, selected, onPress, color }: { label: string; sub: string; selected: boolean; onPress: () => void; color: string }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 }}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text size="sm">{label}</Text>
        {sub ? (
          <Text size="xs" tone="faint">
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
