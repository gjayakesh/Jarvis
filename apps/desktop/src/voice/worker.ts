/// <reference lib="webworker" />
/**
 * JARVIS voice worker. Runs off the main thread, entirely on this PC:
 *  - a cheap loudness gate skips silence without running any model,
 *  - Silero VAD finds where speech starts and ends,
 *  - Whisper tiny.en turns short spoken segments into text,
 *  - the voiceprint runs in a separate, short-lived worker (speaker-worker.ts).
 * Built to stay light on an 8 GB laptop: 2 threads, no work during silence,
 * and long stretches of talking are skipped while JARVIS is asleep.
 */
import { AutoModel, Tensor, env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm' };
  // Two threads at most, so JARVIS never competes with the rest of the PC.
  onnx.wasm.numThreads = self.crossOriginIsolated ? 2 : 1;
}

export type WorkerIn =
  | { type: 'init' }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'reset' }
  | { type: 'awake'; awake: boolean };

export type WorkerOut =
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'ready'; threads: number }
  | { type: 'stats'; frames: number; vad: number; vadMs: number }
  | { type: 'error'; message: string }
  | { type: 'speech-start' }
  | { type: 'too-long' }
  | { type: 'segment'; id: number; durationSec: number; peak: number; clipped: number; text: string; ms: number; audio: Float32Array };

const post = (msg: WorkerOut) => self.postMessage(msg);

// ---------------------------------------------------------------------------
// Models

/* eslint-disable @typescript-eslint/no-explicit-any */
let vad: any = null;
let asr: AutomaticSpeechRecognitionPipeline | null = null;
let vadState: Tensor | null = null;
const sr = new Tensor('int64', [16000n], []);
let stage = 'starting';
// Don't keep a reserve pool of memory; WebAssembly memory never shrinks, so pools only add to the peak.
// Helper threads sleep between runs instead of spinning: speech detection runs several times a
// second, and spinning after each run cost more CPU than the runs themselves.
const lean = {
  enableCpuMemArena: false,
  enableMemPattern: false,
  extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
} as any;

async function init() {
  try {
    const progress = (name: string) => (p: { status?: string; progress?: number }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') post({ type: 'progress', stage: name, percent: Math.round(p.progress) });
    };
    stage = 'speech detection';
    post({ type: 'progress', stage, percent: 0 });
    vad = await AutoModel.from_pretrained('onnx-community/silero-vad', {
      config: { model_type: 'custom' } as any,
      dtype: 'fp32',
      session_options: lean,
      progress_callback: progress(stage) as any,
    });
    resetVadState();
    stage = 'speech-to-text';
    post({ type: 'progress', stage, percent: 0 });
    asr = (await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } as any,
      device: 'wasm',
      session_options: lean,
      progress_callback: progress(stage) as any,
    })) as AutomaticSpeechRecognitionPipeline;
    stage = 'warm-up';
    const warm = new Float32Array(16000).map((_, i) => Math.sin(i / 8) * 0.05);
    await transcribe(warm);
    post({ type: 'ready', threads: onnx.wasm?.numThreads ?? 1 });
  } catch (err) {
    post({ type: 'error', message: `${stage}: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function resetVadState() {
  vadState = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}

/** Work counters, posted every ~10 s so JARVIS can check its own running cost. */
const stats = { frames: 0, vad: 0, vadMs: 0, since: 0 };

async function speechProbability(frame: Float32Array): Promise<number> {
  stats.vad++;
  const t0 = performance.now();
  const out = await vad({ input: new Tensor('float32', frame, [1, frame.length]), sr, state: vadState });
  vadState = out.stateN;
  stats.vadMs += performance.now() - t0;
  return out.output.data[0] as number;
}

async function transcribe(audio: Float32Array): Promise<string> {
  const result = (await asr!(audio)) as { text: string };
  return (result.text ?? '').trim();
}


// ---------------------------------------------------------------------------
// Segmentation on 32 ms frames

const FRAME = 512;
const START_PROB = 0.5;
const END_PROB = 0.35;
const START_FRAMES = 2;
const END_FRAMES = 14; // ~450 ms of silence ends a phrase
const PREROLL = 10; // ~320 ms kept before speech
const MIN_SPEECH_FRAMES = 7; // ~220 ms
const ASLEEP_MAX_FRAMES = Math.round((3.5 * 16000) / FRAME); // a wake phrase (+ short command) is short
const AWAKE_MAX_FRAMES = Math.round((8 * 16000) / FRAME); // a request can be a full sentence
const GATE_DB = 6; // frames this close to the room's background level are silence
const MIN_BACKGROUND_DB = -62;

let awake = false;
let pending = new Float32Array(0);
let preroll: Float32Array[] = [];
let speech: Float32Array[] = [];
let inSpeech = false;
let overflow = false;
let loudRun = 0;
let quietRun = 0;
let voiced = 0;
let skipped = 0;
let nextId = 1;
let busy: Promise<void> = Promise.resolve();
const history: number[] = [];
let background = MIN_BACKGROUND_DB;

function resetSegment() {
  preroll = [];
  speech = [];
  inSpeech = false;
  overflow = false;
  loudRun = 0;
  quietRun = 0;
  voiced = 0;
}

function frameDb(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return 20 * Math.log10(Math.sqrt(sum / frame.length) + 1e-9);
}

function trackBackground(db: number) {
  history.push(db);
  if (history.length > 94) history.shift(); // ~3 s
  if (history.length % 8 === 0) {
    const sorted = [...history].sort((a, b) => a - b);
    background = Math.max(MIN_BACKGROUND_DB, sorted[Math.floor(sorted.length * 0.15)]);
  }
}

async function processFrame(frame: Float32Array) {
  stats.frames++;
  if (performance.now() - stats.since > 10_000) {
    post({ type: 'stats', frames: stats.frames, vad: stats.vad, vadMs: Math.round(stats.vadMs) });
    Object.assign(stats, { frames: 0, vad: 0, vadMs: 0, since: performance.now() });
  }
  const db = frameDb(frame);
  trackBackground(db);

  if (!inSpeech) {
    preroll.push(frame);
    if (preroll.length > PREROLL) preroll.shift();
    // Cheap gate: silence never reaches the speech model.
    if (db < background + GATE_DB) {
      loudRun = 0;
      if (++skipped === 30) resetVadState(); // ~1 s of quiet: start fresh next time
      return;
    }
    skipped = 0;
    const p = await speechProbability(frame);
    loudRun = p >= START_PROB ? loudRun + 1 : 0;
    if (loudRun >= START_FRAMES) {
      inSpeech = true;
      speech = [...preroll];
      preroll = [];
      quietRun = 0;
      voiced = loudRun;
      post({ type: 'speech-start' });
    }
    return;
  }

  speech.push(frame);
  const p = db < background + GATE_DB ? 0 : await speechProbability(frame);
  if (p >= END_PROB) {
    quietRun = 0;
    voiced++;
  } else {
    quietRun++;
  }
  const maxFrames = awake ? AWAKE_MAX_FRAMES : ASLEEP_MAX_FRAMES;
  if (speech.length > maxFrames) {
    // Long talking while asleep cannot be the wake phrase: skip it without any speech-to-text.
    if (!overflow) post({ type: 'too-long' });
    overflow = true;
    speech = speech.slice(-END_FRAMES);
  }
  if (quietRun >= END_FRAMES) {
    const keep = speech.slice(0, speech.length - (END_FRAMES - 4));
    const wasOverflow = overflow;
    const voicedFrames = voiced;
    resetSegment();
    if (wasOverflow || voicedFrames < MIN_SPEECH_FRAMES) return;
    const audio = new Float32Array(keep.length * FRAME);
    keep.forEach((f, i) => audio.set(f, i * FRAME));
    let peak = 0;
    let clipped = 0;
    for (const s of audio) {
      const a = Math.abs(s);
      if (a > peak) peak = a;
      if (a >= 0.985) clipped++;
    }
    const id = nextId++;
    const t0 = performance.now();
    const text = await transcribe(audio);
    post({
      type: 'segment',
      id,
      durationSec: audio.length / 16000,
      peak: 20 * Math.log10(peak + 1e-9),
      clipped: clipped / audio.length,
      text,
      ms: Math.round(performance.now() - t0),
      audio,
    });
  }
}

function pushAudio(samples: Float32Array) {
  const joined = new Float32Array(pending.length + samples.length);
  joined.set(pending);
  joined.set(samples, pending.length);
  let offset = 0;
  const frames: Float32Array[] = [];
  while (offset + FRAME <= joined.length) {
    frames.push(joined.slice(offset, offset + FRAME));
    offset += FRAME;
  }
  pending = joined.slice(offset);
  busy = busy.then(async () => {
    if (!vad) return;
    for (const f of frames) await processFrame(f);
  });
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      void init();
      break;
    case 'audio':
      pushAudio(msg.samples);
      break;
    case 'reset':
      pending = new Float32Array(0);
      resetSegment();
      break;
    case 'awake':
      awake = msg.awake;
      break;
  }
};
