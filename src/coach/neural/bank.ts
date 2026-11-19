/** Pure helpers for the on-device neural (KittenTTS nano) coxswain voice. */
import type { CoxPersonality } from '@/core/types';
import { PHRASES, TECHNIQUE_CUES } from '../phrases';

/**
 * sherpa-onnx release asset id (tts-models tag) of the KittenTTS nano v0.2 English model, Apache-2.0.
 * Must be a model the bundled engine can load: react-native-sherpa-onnx 0.4.4 ships sherpa-onnx 1.12.35,
 * and KittenTTS v0.8 models need 1.13.2+ (loading one aborts the whole app natively, uncatchable).
 */
export const NEURAL_MODEL_ID = 'kitten-nano-en-v0_2-fp16';
/** Earlier model ids that the bundled engine cannot load; deleted from disk on startup. */
export const INCOMPATIBLE_MODEL_IDS = ['kitten-micro-en-v0_8'];
/** Archive size on the sherpa-onnx release (model + voices + espeak-ng data). */
export const NEURAL_DOWNLOAD_MB = 25;

/** sherpa-onnx speaker ids for nano v0.2: expr-voice-2-m 0, 2-f 1, 3-m 2, 3-f 3, 4-m 4, 4-f 5, 5-m 6, 5-f 7. Ids kept so saved choices stay valid. */
export const NEURAL_VOICES = [
  { id: 'bella', name: 'Bella', sub: 'US English, female', sid: 1 },
  { id: 'jasper', name: 'Jasper', sub: 'US English, male', sid: 0 },
  { id: 'luna', name: 'Luna', sub: 'US English, female', sid: 3 },
  { id: 'bruno', name: 'Bruno', sub: 'US English, male', sid: 2 },
] as const;
export type NeuralVoice = (typeof NEURAL_VOICES)[number];

export function neuralVoice(id: string | null | undefined): NeuralVoice {
  return NEURAL_VOICES.find((v) => v.id === id) ?? NEURAL_VOICES[0];
}

/** Every phrase with no {placeholder} for this personality: rendered ahead of time so calls land instantly. */
export function fixedPhrases(personality: CoxPersonality): string[] {
  const lines = [...Object.values(PHRASES[personality]).flat(), ...Object.values(TECHNIQUE_CUES).flatMap((c) => c.cues[personality])];
  return [...new Set(lines.filter((l) => typeof l === 'string' && l.trim() && !l.includes('{')))];
}

/** Stable file-safe key for one rendering (voice, speed, text). */
export function audioKey(voice: string, speed: number, text: string): string {
  const s = `${voice}|${speed.toFixed(2)}|${text}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return `${voice}-${Math.round(speed * 100)}-${h.toString(36)}-${s.length}`;
}
