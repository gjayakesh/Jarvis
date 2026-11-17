import { SAMPLE_RATE, FRAME_HOP, clippedRatio, deltas, median, mfcc, peakDb, pitchTrack } from './dsp';

/** Features kept for one spoken sample. Raw audio is never stored. */
export interface Utterance {
  /** Mean-normalised c1..c12 + deltas per frame, used to match the phrase. */
  frames: number[][];
  /** Mean and spread of c1..c12 over voiced frames, used to match the voice. */
  timbre: number[];
  /** Median fundamental frequency of voiced frames, Hz (0 when unknown). */
  pitchHz: number;
  durationSec: number;
}

export interface AudioQuality {
  durationSec: number;
  peakDb: number;
  clipped: number;
  voicedRatio: number;
}

export type QualityIssue = 'too-short' | 'too-long' | 'too-quiet' | 'clipped' | 'no-voice';

export function assessQuality(samples: Float32Array): { quality: AudioQuality; issue: QualityIssue | null } {
  const durationSec = samples.length / SAMPLE_RATE;
  const peak = peakDb(samples);
  const clipped = clippedRatio(samples);
  const { energyDb } = mfcc(samples);
  const voiced = voicedMask(energyDb);
  const voicedRatio = voiced.filter(Boolean).length / Math.max(1, voiced.length);
  const quality = { durationSec, peakDb: peak, clipped, voicedRatio };
  let issue: QualityIssue | null = null;
  if (peak < -38) issue = 'too-quiet';
  else if (clipped > 0.01) issue = 'clipped';
  else if (voicedRatio < 0.15) issue = 'no-voice';
  else if (durationSec < 0.35) issue = 'too-short';
  else if (durationSec > 3.2) issue = 'too-long';
  return { quality, issue };
}

/** Frames within 25 dB of the loudest frame and above an absolute floor count as speech. */
function voicedMask(energyDb: Float32Array): boolean[] {
  let max = -120;
  for (const e of energyDb) max = Math.max(max, e);
  return Array.from(energyDb, (e) => e > max - 25 && e > -55);
}

/** Trim silence at both ends using frame energy, keeping a short margin. */
function speechBounds(energyDb: Float32Array): [number, number] {
  let max = -120;
  for (const e of energyDb) max = Math.max(max, e);
  const gate = Math.max(max - 30, -60);
  let first = 0;
  while (first < energyDb.length && energyDb[first] < gate) first++;
  let last = energyDb.length - 1;
  while (last > first && energyDb[last] < gate) last--;
  return [Math.max(0, first - 3), Math.min(energyDb.length - 1, last + 3)];
}

export function extractUtterance(samples: Float32Array): Utterance {
  const { cepstra, energyDb } = mfcc(samples);
  if (cepstra.length < 5) return { frames: [], timbre: [], pitchHz: 0, durationSec: 0 };
  const [first, last] = speechBounds(energyDb);
  const span = cepstra.slice(first, last + 1).map((c) => c.subarray(1)); // drop c0 (loudness)
  const voiced = voicedMask(energyDb.subarray(first, last + 1));

  // Phrase features: cepstral mean normalisation removes the microphone/room tilt.
  const dims = span[0].length;
  const mean = new Float32Array(dims);
  for (const c of span) for (let i = 0; i < dims; i++) mean[i] += c[i] / span.length;
  const normalised = span.map((c) => Float32Array.from(c, (v, i) => v - mean[i]));
  const d = deltas(normalised);
  const frames = normalised.map((c, t) => [...c, ...d[t]].map((v) => round(v)));

  // Voice features: long-term spectral shape and its variability over voiced frames.
  const voicedCepstra = span.filter((_, i) => voiced[i]);
  const source = voicedCepstra.length >= 5 ? voicedCepstra : span;
  const vMean = new Array(dims).fill(0);
  for (const c of source) for (let i = 0; i < dims; i++) vMean[i] += c[i] / source.length;
  const vStd = new Array(dims).fill(0);
  for (const c of source) for (let i = 0; i < dims; i++) vStd[i] += (c[i] - vMean[i]) ** 2 / source.length;
  const timbre = [...vMean, ...vStd.map(Math.sqrt)].map((v) => round(v));

  const startSample = first * FRAME_HOP;
  const endSample = Math.min(samples.length, (last + 1) * FRAME_HOP + 400);
  const segment = samples.subarray(startSample, endSample);
  const pitches = pitchTrack(segment, voiced);
  const pitchHz = median(Array.from(pitches).filter((p) => p > 0));

  return { frames, timbre, pitchHz: round(pitchHz), durationSec: round(segment.length / SAMPLE_RATE) };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
