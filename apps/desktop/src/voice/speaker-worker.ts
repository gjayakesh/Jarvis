/// <reference lib="webworker" />
/**
 * Voiceprint worker (WavLM speaker verification). Started only when a phrase
 * needs checking and closed again after a few idle minutes, so its memory is
 * fully returned to Windows while JARVIS just listens.
 */
import { AutoModel, AutoProcessor, env } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm' };
  onnx.wasm.numThreads = self.crossOriginIsolated ? 2 : 1;
}

export type SpeakerIn = { type: 'embed'; id: number; audio: Float32Array };
export type SpeakerOut = { type: 'ready' } | { type: 'error'; message: string } | { type: 'embedding'; id: number; embedding: number[] | null };

const post = (msg: SpeakerOut) => self.postMessage(msg);

/* eslint-disable @typescript-eslint/no-explicit-any */
let processor: any = null;
let model: any = null;
let queue: Promise<void> = Promise.resolve();

const ready = (async () => {
  try {
    processor = await AutoProcessor.from_pretrained('Xenova/wavlm-base-plus-sv');
    model = await AutoModel.from_pretrained('Xenova/wavlm-base-plus-sv', {
      dtype: 'q8',
      device: 'wasm',
      session_options: { enableCpuMemArena: false, enableMemPattern: false } as any,
    });
    post({ type: 'ready' });
    return true;
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    return false;
  }
})();

/** Voiceprint of the first 3 s only: enough to know the speaker, and it caps memory use. */
async function embed(audio: Float32Array): Promise<number[]> {
  const inputs = await processor(audio.length > 48000 ? audio.subarray(0, 48000) : audio);
  const { embeddings } = await model(inputs);
  return Array.from(embeddings.data as Float32Array);
}

self.onmessage = (e: MessageEvent<SpeakerIn>) => {
  const msg = e.data;
  if (msg.type !== 'embed') return;
  queue = queue.then(async () => {
    const ok = await ready;
    post({ type: 'embedding', id: msg.id, embedding: ok ? await embed(msg.audio) : null });
  });
};
