/**
 * Pure signal-processing helpers for the on-device voice matcher.
 * Everything here works on mono Float32 PCM in the range [-1, 1] and has no
 * browser dependencies, so it runs the same in the app and in unit tests.
 */

export const SAMPLE_RATE = 16000;
export const FRAME_LENGTH = 400; // 25 ms
export const FRAME_HOP = 160; // 10 ms
const FFT_SIZE = 512;
const MEL_FILTERS = 26;
const CEPSTRA = 13; // c0..c12
const LIFTER = 22;

/** Windowed-sinc low-pass + linear interpolation resampler (offline, whole buffer). */
export function resample(input: Float32Array, fromRate: number, toRate: number = SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  let source = input;
  if (toRate < fromRate) {
    const cutoff = (0.45 * toRate) / fromRate; // normalised to fromRate
    const taps = 63;
    const half = (taps - 1) / 2;
    const kernel = new Float32Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const n = i - half;
      const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
      kernel[i] = sinc * window;
      sum += kernel[i];
    }
    for (let i = 0; i < taps; i++) kernel[i] /= sum;
    source = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let acc = 0;
      for (let k = 0; k < taps; k++) {
        const idx = i + k - half;
        if (idx >= 0 && idx < input.length) acc += input[idx] * kernel[k];
      }
      source[i] = acc;
    }
  }
  const ratio = fromRate / toRate;
  const outLength = Math.floor(source.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, source.length - 1);
    const frac = pos - i0;
    out[i] = source[i0] * (1 - frac) + source[i1] * frac;
  }
  return out;
}

/** Energy of one frame in dBFS (RMS). */
export function frameDb(samples: Float32Array, start: number, length: number): number {
  let sum = 0;
  const end = Math.min(start + length, samples.length);
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, end - start));
  return 20 * Math.log10(rms + 1e-9);
}

export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return 20 * Math.log10(peak + 1e-9);
}

export function clippedRatio(samples: Float32Array): number {
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.985) clipped++;
  return clipped / Math.max(1, samples.length);
}

// ---------------------------------------------------------------------------
// FFT + mel cepstrum

const hamming = new Float32Array(FRAME_LENGTH);
for (let i = 0; i < FRAME_LENGTH; i++) hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1));

const bitReverse = new Uint16Array(FFT_SIZE);
{
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    bitReverse[i] = r;
  }
}
const cosTable = new Float32Array(FFT_SIZE / 2);
const sinTable = new Float32Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosTable[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
  sinTable[i] = -Math.sin((2 * Math.PI * i) / FFT_SIZE);
}

function powerSpectrum(frame: Float32Array, re: Float32Array, im: Float32Array, out: Float32Array): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    re[bitReverse[i]] = i < frame.length ? frame[i] : 0;
    im[i] = 0;
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cosTable[k * step];
        const wi = sinTable[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  for (let i = 0; i <= FFT_SIZE / 2; i++) out[i] = (re[i] * re[i] + im[i] * im[i]) / FFT_SIZE;
}

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

const melBank: { start: number; weights: Float32Array }[] = (() => {
  const low = hzToMel(60);
  const high = hzToMel(7600);
  const points: number[] = [];
  for (let i = 0; i < MEL_FILTERS + 2; i++) points.push(melToHz(low + ((high - low) * i) / (MEL_FILTERS + 1)));
  const bins = points.map((hz) => (hz * FFT_SIZE) / SAMPLE_RATE);
  const bank: { start: number; weights: Float32Array }[] = [];
  for (let m = 1; m <= MEL_FILTERS; m++) {
    const left = bins[m - 1];
    const centre = bins[m];
    const right = bins[m + 1];
    const start = Math.floor(left);
    const end = Math.ceil(right);
    const weights = new Float32Array(end - start + 1);
    for (let k = start; k <= end; k++) {
      let w = 0;
      if (k >= left && k <= centre) w = (k - left) / (centre - left);
      else if (k > centre && k <= right) w = (right - k) / (right - centre);
      weights[k - start] = Math.max(0, w);
    }
    bank.push({ start, weights });
  }
  return bank;
})();

const dctMatrix: Float32Array[] = (() => {
  const rows: Float32Array[] = [];
  for (let c = 0; c < CEPSTRA; c++) {
    const row = new Float32Array(MEL_FILTERS);
    for (let m = 0; m < MEL_FILTERS; m++) row[m] = Math.cos((Math.PI * c * (m + 0.5)) / MEL_FILTERS) * Math.sqrt(2 / MEL_FILTERS);
    rows.push(row);
  }
  return rows;
})();
const lifter = Float32Array.from({ length: CEPSTRA }, (_, c) => 1 + (LIFTER / 2) * Math.sin((Math.PI * c) / LIFTER));

export interface CepstralFrames {
  /** c0..c12 per frame, liftered, no mean normalisation. */
  cepstra: Float32Array[];
  /** dBFS energy per frame. */
  energyDb: Float32Array;
}

/**
 * 13-coefficient MFCCs for every 10 ms frame.
 *
 * Quiet parts are masked per mel band before the log: the quietest frames of
 * the clip estimate the steady background (fan, room hum, mic hiss), and every
 * band is floored at that level (and at 40 dB below the clip's loudest band),
 * so clips from a quiet room and a noisy one look more alike.
 */
export function mfcc(samples: Float32Array): CepstralFrames {
  const count = samples.length < FRAME_LENGTH ? 0 : 1 + Math.floor((samples.length - FRAME_LENGTH) / FRAME_HOP);
  const energyDb = new Float32Array(count);
  const frame = new Float32Array(FRAME_LENGTH);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const power = new Float32Array(FFT_SIZE / 2 + 1);
  const mel: Float32Array[] = [];
  for (let f = 0; f < count; f++) {
    const offset = f * FRAME_HOP;
    let prev = offset > 0 ? samples[offset - 1] : 0;
    for (let i = 0; i < FRAME_LENGTH; i++) {
      const s = samples[offset + i];
      frame[i] = (s - 0.97 * prev) * hamming[i];
      prev = s;
    }
    energyDb[f] = frameDb(samples, offset, FRAME_LENGTH);
    powerSpectrum(frame, re, im, power);
    const bands = new Float32Array(MEL_FILTERS);
    for (let m = 0; m < MEL_FILTERS; m++) {
      const { start, weights } = melBank[m];
      let acc = 0;
      for (let k = 0; k < weights.length; k++) {
        const bin = start + k;
        if (bin < power.length) acc += power[bin] * weights[k];
      }
      bands[m] = acc;
    }
    mel.push(bands);
  }

  // Steady background per band = 20th percentile over the clip.
  const noise = new Float32Array(MEL_FILTERS);
  let peak = 1e-12;
  if (count > 0) {
    const column = new Float32Array(count);
    for (let m = 0; m < MEL_FILTERS; m++) {
      for (let f = 0; f < count; f++) column[f] = mel[f][m];
      const sorted = Array.from(column).sort((a, b) => a - b);
      noise[m] = sorted[Math.floor((count - 1) * 0.2)];
      peak = Math.max(peak, sorted[count - 1]);
    }
  }
  const floor = peak * 1e-4;

  const cepstra: Float32Array[] = [];
  const logBands = new Float32Array(MEL_FILTERS);
  for (let f = 0; f < count; f++) {
    for (let m = 0; m < MEL_FILTERS; m++) logBands[m] = Math.log(Math.max(mel[f][m], noise[m] * 2, floor));
    const c = new Float32Array(CEPSTRA);
    for (let i = 0; i < CEPSTRA; i++) {
      let acc = 0;
      const row = dctMatrix[i];
      for (let m = 0; m < MEL_FILTERS; m++) acc += row[m] * logBands[m];
      c[i] = acc * lifter[i];
    }
    cepstra.push(c);
  }
  return { cepstra, energyDb };
}

/** Regression deltas over +-2 frames. */
export function deltas(frames: Float32Array[]): Float32Array[] {
  const n = frames.length;
  const out: Float32Array[] = [];
  for (let t = 0; t < n; t++) {
    const d = new Float32Array(frames[0]?.length ?? 0);
    for (let k = 1; k <= 2; k++) {
      const a = frames[Math.min(n - 1, t + k)];
      const b = frames[Math.max(0, t - k)];
      for (let i = 0; i < d.length; i++) d[i] += k * (a[i] - b[i]);
    }
    for (let i = 0; i < d.length; i++) d[i] /= 10;
    out.push(d);
  }
  return out;
}

/**
 * Fundamental frequency (Hz) per 10 ms hop via normalised autocorrelation.
 * Returns 0 for unvoiced frames.
 */
export function pitchTrack(samples: Float32Array, voicedFrames: boolean[]): Float32Array {
  const window = 640; // 40 ms
  const minLag = Math.floor(SAMPLE_RATE / 400);
  const maxLag = Math.ceil(SAMPLE_RATE / 70);
  const out = new Float32Array(voicedFrames.length);
  for (let f = 0; f < voicedFrames.length; f++) {
    if (!voicedFrames[f]) continue;
    const start = f * FRAME_HOP;
    if (start + window + maxLag > samples.length) continue;
    let energy0 = 0;
    for (let i = 0; i < window; i++) energy0 += samples[start + i] * samples[start + i];
    if (energy0 <= 1e-8) continue;
    let bestLag = 0;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acc = 0;
      let energy1 = 0;
      for (let i = 0; i < window; i++) {
        const b = samples[start + i + lag];
        acc += samples[start + i] * b;
        energy1 += b * b;
      }
      const r = acc / Math.sqrt(energy0 * energy1 + 1e-12);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    if (best > 0.5 && bestLag > 0) out[f] = SAMPLE_RATE / bestLag;
  }
  return out;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
