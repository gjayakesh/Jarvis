// Downloads the on-device voice models once into public/models (kept out of git)
// and copies the ONNX Runtime WebAssembly files into public/ort, so JARVIS never
// fetches code or models from the internet at run time.
//
// Models (all run locally in the browser sandbox):
//   onnx-community/whisper-tiny.en   speech-to-text          (MIT)
//   Xenova/wavlm-base-plus-sv        speaker verification    (MIT)
//   onnx-community/silero-vad        voice activity detection (MIT)
//
// Usage: node scripts/fetch-models.mjs
import { createWriteStream, existsSync, mkdirSync, statSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'models');

const MODELS = {
  'onnx-community/whisper-tiny.en': [
    'config.json',
    'generation_config.json',
    'added_tokens.json',
    'merges.txt',
    'normalizer.json',
    'preprocessor_config.json',
    'special_tokens_map.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ],
  'Xenova/wavlm-base-plus-sv': ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx'],
  'onnx-community/silero-vad': ['onnx/model.onnx', 'LICENSE'],
};

async function download(repo, file) {
  const dest = join(out, repo, file);
  if (existsSync(dest) && statSync(dest).size > 0) return 'cached';
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  const res = await fetch(url, { headers: { 'user-agent': 'jarvis-desktop-model-fetch' } });
  if (!res.ok || !res.body) throw new Error(`${url} -> HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return `${(statSync(dest).size / 1e6).toFixed(1)} MB`;
}

for (const [repo, files] of Object.entries(MODELS)) {
  for (const file of files) {
    process.stdout.write(`${repo}/${file} ... `);
    console.log(await download(repo, file));
  }
}

// ONNX Runtime web files that match the version transformers.js was built against.
const require = createRequire(import.meta.url);
const transformersDir = dirname(require.resolve('@huggingface/transformers'));
const ortPkg = require.resolve('onnxruntime-web', { paths: [transformersDir] });
let ortDist = dirname(ortPkg);
while (!existsSync(join(ortDist, 'package.json'))) ortDist = dirname(ortDist);
ortDist = join(ortDist, 'dist');
const ortOut = join(root, 'public', 'ort');
mkdirSync(ortOut, { recursive: true });
for (const f of readdirSync(ortDist)) {
  if (/^ort-wasm-simd-threaded\.(asyncify\.)?(wasm|mjs)$/.test(f)) {
    copyFileSync(join(ortDist, f), join(ortOut, f));
    console.log(`ort/${f}`);
  }
}
console.log('Models ready.');
