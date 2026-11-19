/**
 * On-device KittenTTS (nano v0.2) via react-native-sherpa-onnx, played with its native PCM player.
 * Native modules are required lazily so web and vitest can import `@/coach`; every entry point
 * resolves to false / no-op when they are missing, and the caller falls back to the system voice.
 */
import type { CoxswainSettings } from '@/core/types';
import { audioKey, fixedPhrases, INCOMPATIBLE_MODEL_IDS, neuralVoice, NEURAL_MODEL_ID, type NeuralVoice } from './bank';

type TtsMod = typeof import('react-native-sherpa-onnx/tts');
type DlMod = typeof import('react-native-sherpa-onnx/download');
type Fs = typeof import('expo-file-system');
type Engine = Awaited<ReturnType<TtsMod['createStreamingTTS']>>;

/** 'downloaded' = on disk, not yet loaded into memory (loads on prewarm / first call). */
export type NeuralStatus = 'unsupported' | 'absent' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error';
export interface NeuralState {
  status: NeuralStatus;
  /** Download + unpack progress 0-1. */
  progress: number;
  /** Phrase-bank renders done / total for the current voice. */
  rendered: number;
  total: number;
}

const MEM_CAP = 300; // shortcut: ~150 KB per phrase, ~45 MB cap; upgrade to an LRU by bytes if phrase banks grow.

let mods: { tts: TtsMod; dl: DlMod; fs: Fs } | null | undefined;
function native() {
  if (mods !== undefined) return mods;
  try {
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return (mods = null);
    mods = {
      tts: require('react-native-sherpa-onnx/tts') as TtsMod,
      dl: require('react-native-sherpa-onnx/download') as DlMod,
      fs: require('expo-file-system') as Fs,
    };
  } catch {
    mods = null; // dev build without the native module
  }
  return mods;
}

let state: NeuralState = { status: 'absent', progress: 0, rendered: 0, total: 0 };
let checked = false;
const listeners = new Set<() => void>();
function set(patch: Partial<NeuralState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function getNeuralState(): NeuralState {
  if (!checked) {
    checked = true;
    const m = native();
    if (!m) state = { ...state, status: 'unsupported' };
    else
      // Remove models this engine cannot load first: loading one kills the app.
      void Promise.all(INCOMPATIBLE_MODEL_IDS.map((id) => m.dl.deleteModel(m.dl.ModelCategory.Tts, id).catch(() => undefined)))
        .then(() => m.dl.isModelDownloaded(m.dl.ModelCategory.Tts, NEURAL_MODEL_ID))
        .then((yes) => yes && state.status === 'absent' && set({ status: 'downloaded' }))
        .catch(() => undefined);
  }
  return state;
}
export function subscribeNeural(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function audioDir(m: { fs: Fs }) {
  const d = new m.fs.Directory(m.fs.Paths.cache, 'kitten-audio');
  d.create({ intermediates: true, idempotent: true });
  return d;
}

let engine: Engine | null = null;
let sampleRate = 24000;
let loading: Promise<Engine | null> | null = null;
function load(): Promise<Engine | null> {
  const m = native();
  if (engine || !m) return Promise.resolve(engine);
  loading ??= (async () => {
    const path = await m.dl.getModelPath(m.dl.ModelCategory.Tts, NEURAL_MODEL_ID);
    if (!path) throw new Error('not downloaded');
    set({ status: 'loading' });
    const e = await m.tts.createStreamingTTS({ modelPath: { type: 'file', path }, modelType: 'kitten', numThreads: 2 });
    sampleRate = await e.getSampleRate();
    engine = e;
    set({ status: 'ready' });
    return e;
  })().catch(() => {
    if (state.status === 'loading') set({ status: 'error' });
    loading = null;
    return null;
  });
  return loading;
}

/** Downloads + unpacks the model once (resumable), then loads it; progress is published via subscribeNeural. */
export async function downloadNeural(): Promise<boolean> {
  const m = native();
  if (!m) return false;
  set({ status: 'downloading', progress: 0 });
  try {
    await m.dl.refreshModels(m.dl.ModelCategory.Tts);
    // Download is the bulk of the time; unpacking reports its own 0-100, shown as the last 10 %.
    await m.dl.ensureModel(m.dl.ModelCategory.Tts, NEURAL_MODEL_ID, {
      deleteArchiveAfterExtract: true,
      onProgress: (p) => set({ progress: p.phase === 'downloading' ? 0.9 * (p.percent / 100) : 0.9 + 0.1 * (p.percent / 100) }),
    });
  } catch {
    set({ status: 'error' });
    return false;
  }
  set({ status: 'downloaded', progress: 1 });
  return (await load()) != null;
}

// One synthesis at a time; live calls jump ahead of phrase-bank rendering.
const queue: (() => Promise<void>)[] = [];
let pumping = false;
function enqueue<T>(fn: () => Promise<T>, urgent: boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job = () => fn().then(resolve, reject);
    if (urgent) queue.unshift(job);
    else queue.push(job);
    void pump();
  });
}
async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) await queue.shift()!();
  pumping = false;
}

function synth(e: Engine, text: string, voice: NeuralVoice, speed: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const parts: number[][] = [];
    void e
      .generateSpeechStream(text, { sid: voice.sid, speed }, {
        onChunk: (c) => parts.push(c.samples),
        onEnd: () => resolve(Float32Array.from(parts.flat())),
        onError: (err) => reject(new Error(err.message)),
      })
      .catch(reject);
  });
}

const mem = new Map<string, Float32Array>();
function remember(key: string, audio: Float32Array) {
  if (mem.size >= MEM_CAP) mem.delete(mem.keys().next().value!);
  mem.set(key, audio);
}

const speedOf = (s: CoxswainSettings) => Math.round(Math.min(1.5, Math.max(0.5, s.voiceRate || 1)) * 10) / 10;

/** Cached (memory, then disk) or freshly synthesized audio; null when unavailable or past the deadline. */
async function audioFor(text: string, voice: NeuralVoice, speed: number, deadlineMs: number | null, urgent = true): Promise<Float32Array | null> {
  const key = audioKey(voice.id, speed, text);
  const hit = mem.get(key);
  if (hit) return hit;
  const m = native();
  if (!m) return null;
  try {
    const f = new m.fs.File(audioDir(m), `${key}.f32`);
    if (f.exists) {
      const a = new Float32Array((await f.bytes()).slice().buffer);
      remember(key, a);
      return a;
    }
    const e = engine ?? (await load());
    if (!e) return null;
    const job = enqueue(() => synth(e, text, voice, speed), urgent).then(async (a) => {
      remember(key, a);
      await f.write(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
      return a;
    });
    if (deadlineMs == null) return await job;
    return await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), deadlineMs))]);
  } catch {
    return null;
  }
}

let renderToken = 0;
/** Load the model and render the fixed phrase bank in the background (skips phrases already on disk). */
export function prewarmNeural(settings: CoxswainSettings): void {
  if (settings.voiceEngine !== 'neural' || !native()) return;
  const token = ++renderToken;
  void load().then(async (e) => {
    if (!e) return;
    const voice = neuralVoice(settings.neuralVoiceId);
    const speed = speedOf(settings);
    const lines = fixedPhrases(settings.personality);
    set({ rendered: 0, total: lines.length });
    for (let i = 0; i < lines.length && token === renderToken; i++) {
      await audioFor(lines[i]!, voice, speed, null, false);
      set({ rendered: i + 1 });
    }
  });
}

let playerOn = false;
let playingUntil = 0;
let generation = 0;

async function play(e: Engine, audio: Float32Array) {
  if (!playerOn) {
    await e.startPcmPlayer(sampleRate, 1);
    playerOn = true;
  }
  // The native player queues chunks back to back, so the end time is estimated from the sample count.
  playingUntil = Math.max(Date.now(), playingUntil) + (audio.length / sampleRate) * 1000;
  await e.writePcmChunk(Array.from(audio));
}

export const isNeuralSpeaking = () => Date.now() < playingUntil;

export function stopNeural(): void {
  generation++;
  playingUntil = 0;
  if (engine && playerOn) {
    playerOn = false;
    engine.stopPcmPlayer().catch(() => undefined);
  }
}

/**
 * Speak `text` with the neural voice if audio is ready within ~1.5 s, queued behind the current
 * call; resolves false (nothing played) so the caller can use the system voice instead.
 */
export async function speakNeural(text: string, settings: CoxswainSettings, deadlineMs: number | null = 1500): Promise<boolean> {
  if (!native()) return false;
  const gen = generation;
  const audio = await audioFor(text, neuralVoice(settings.neuralVoiceId), speedOf(settings), deadlineMs);
  if (gen !== generation) return true; // stopped while synthesizing: stay silent
  if (!audio?.length || !engine) return false;
  try {
    await play(engine, audio);
    return true;
  } catch {
    return false;
  }
}
