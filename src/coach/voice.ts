/**
 * Text-to-speech for coxswain calls: expo-speech, or the on-device KittenTTS voice when
 * `voiceEngine === 'neural'` (falls back to expo-speech per call). Never throws when TTS is unavailable.
 */
import * as Speech from 'expo-speech';
import type { CoxCall, CoxswainSettings } from '@/core/types';
import { clamp } from '@/core/units';
import { isNeuralSpeaking, prewarmNeural, speakNeural, stopNeural } from './neural/kitten';

export interface CoxVoice {
  speak(call: CoxCall, settings: CoxswainSettings): void;
  stop(): void;
  /** Optional: load the neural model and render the phrase bank before the first call (no-op for 'system'). */
  prewarm?(settings: CoxswainSettings): void;
  listVoices(): Promise<{ id: string; name: string; language: string }[]>;
}

function safe(fn: () => unknown): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
  } catch {
    // TTS unavailable (e.g. web without speechSynthesis) — stay silent.
  }
}

/**
 * Default on (CoxswainSettings.duckMusic).
 * Only the system voice on iOS can duck without a native module; see coxswain settings for the caveats.
 */
export const wantsDuck = (s: CoxswainSettings): boolean => s.duckMusic !== false;

export function createVoice(): CoxVoice {
  let speaking = false;
  let currentPriority = 0;
  let warmed = false;

  function speakSystem(call: CoxCall, settings: CoxswainSettings) {
    speaking = true;
    currentPriority = call.priority;
    const done = () => {
      speaking = false;
      currentPriority = 0;
    };
    safe(() =>
      Speech.speak(call.text, {
        rate: clamp(settings.voiceRate || 1, 0.5, 1.5),
        pitch: clamp(settings.voicePitch || 1, 0.5, 2),
        ...(settings.voiceId ? { voice: settings.voiceId } : { language: 'en' }),
        // iOS: false lets AVSpeechSynthesizer run its own session, which ducks other audio while speaking. Ignored on Android.
        ...(wantsDuck(settings) ? { useApplicationAudioSession: false } : {}),
        onDone: done,
        onStopped: done,
        onError: done,
      }),
    );
  }

  const voice: CoxVoice = {
    speak(call, settings) {
      if (!settings.enabled || !settings.voiceEnabled || !call.text) return;
      const neural = settings.voiceEngine === 'neural';
      // Urgent calls cut in; anything else waits its turn in the queue, but low-priority
      // chatter is not stacked behind a call that is still being spoken.
      if (call.priority === 3) voice.stop();
      else if ((speaking || (neural && isNeuralSpeaking())) && call.priority <= 1 && currentPriority >= call.priority) return;
      if (!neural) return speakSystem(call, settings);
      if (!warmed) voice.prewarm?.(settings);
      currentPriority = call.priority;
      speakNeural(call.text, settings)
        .catch(() => false)
        .then((ok) => ok || speakSystem(call, settings));
    },
    stop() {
      speaking = false;
      currentPriority = 0;
      stopNeural();
      safe(() => Speech.stop());
    },
    prewarm(settings) {
      warmed = true;
      prewarmNeural(settings);
    },
    async listVoices() {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const list = (voices ?? []).map((v) => ({ id: v.identifier, name: v.name, language: v.language }));
        const isEn = (l: string) => /^en([-_]|$)/i.test(l);
        return list.sort((a, b) => {
          const ea = isEn(a.language) ? 0 : 1;
          const eb = isEn(b.language) ? 0 : 1;
          return ea - eb || a.language.localeCompare(b.language) || a.name.localeCompare(b.name);
        });
      } catch {
        return [];
      }
    },
  };
  return voice;
}
