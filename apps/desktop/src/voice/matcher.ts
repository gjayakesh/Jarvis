import type { Utterance } from './features';

/**
 * Template matcher for user-recorded voice commands.
 *
 * Two independent gates must pass:
 *  1. Phrase gate: dynamic time warping between the new utterance and the
 *     user's recorded samples of that phrase (mean-normalised cepstra).
 *  2. Voice gate: the speaker's long-term spectral shape and pitch must sit
 *     close to the voice profile built from every enrolment sample.
 *
 * This is a convenience lock against other people and the TV, not a
 * security boundary: a close recording of the owner can still pass.
 */

export type CommandAction =
  | 'wake'
  | 'open-home'
  | 'open-assistant'
  | 'open-monitor'
  | 'open-diagnostics'
  | 'start-quick-scan'
  | 'open-activity'
  | 'stop-listening';

export interface VoiceCommand {
  id: string;
  phrase: string;
  action: CommandAction;
  samples: Utterance[];
  /** Largest DTW distance between the user's own samples. */
  spread: number;
  createdAt: string;
}

export interface VoiceProfile {
  centroid: number[];
  scale: number[];
  pitchHz: number;
  pitchSpreadSemitones: number;
  /** Largest leave-one-out timbre distance among enrolment samples. */
  timbreSpread: number;
  sampleCount: number;
}

export interface MatchSettings {
  /** 0 = strict, 1 = relaxed. How loosely the phrase may match. */
  phraseTolerance: number;
  /** 0 = strict, 1 = relaxed. How loosely the voice may match. */
  voiceTolerance: number;
}

export const DEFAULT_SETTINGS: MatchSettings = { phraseTolerance: 0.5, voiceTolerance: 0.5 };

export interface MatchResult {
  command: VoiceCommand | null;
  /** 0..1, 1 = identical phrase. */
  phraseScore: number;
  /** 0..1, 1 = identical voice. */
  voiceScore: number;
  phraseOk: boolean;
  voiceOk: boolean;
  /** Raw numbers for the diagnostics readout. */
  detail: { phraseRatio: number; timbreRatio: number; pitchSemitones: number };
}

// ---------------------------------------------------------------------------
// Phrase gate

export function dtwDistance(a: number[][], b: number[][]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return Infinity;
  const band = Math.max(Math.abs(n - m) + 2, Math.ceil(Math.max(n, m) * 0.3));
  const INF = Number.POSITIVE_INFINITY;
  let prev = new Float64Array(m + 1).fill(INF);
  let curr = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    curr.fill(INF);
    const centre = Math.round((i * m) / n);
    const lo = Math.max(1, centre - band);
    const hi = Math.min(m, centre + band);
    const ai = a[i - 1];
    for (let j = lo; j <= hi; j++) {
      const bj = b[j - 1];
      let cost = 0;
      for (let k = 0; k < ai.length; k++) {
        const d = ai[k] - bj[k];
        cost += d * d;
      }
      cost = Math.sqrt(cost);
      // Diagonal steps count double so the (n + m) normalisation is fair.
      curr[j] = Math.min(prev[j - 1] + 2 * cost, prev[j] + cost, curr[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  const total = prev[m];
  return Number.isFinite(total) ? total / (n + m) : Infinity;
}

/** Spread of a phrase = largest pairwise distance between the user's own samples. */
export function phraseSpread(samples: Utterance[]): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++)
    for (let j = i + 1; j < samples.length; j++) max = Math.max(max, dtwDistance(samples[i].frames, samples[j].frames));
  return max;
}

/** Distance from a new utterance to the phrase: mean of the two closest samples. */
export function phraseDistance(command: VoiceCommand, utterance: Utterance): number {
  const distances = command.samples
    .filter((s) => {
      const ratio = utterance.durationSec / Math.max(0.05, s.durationSec);
      return ratio > 0.5 && ratio < 2;
    })
    .map((s) => dtwDistance(s.frames, utterance.frames))
    .sort((x, y) => x - y);
  if (distances.length === 0) return Infinity;
  return distances.length === 1 ? distances[0] : (distances[0] + distances[1]) / 2;
}

/** How far above the user's own variation a match may sit before it is rejected. */
function phraseLimit(command: VoiceCommand, settings: MatchSettings): number {
  return Math.max(command.spread, 1e-3) * (1 + 0.55 * settings.phraseTolerance);
}

// ---------------------------------------------------------------------------
// Voice gate

export function buildProfile(samples: Utterance[]): VoiceProfile | null {
  const usable = samples.filter((s) => s.timbre.length > 0);
  if (usable.length < 3) return null;
  const dims = usable[0].timbre.length;
  const centroid = new Array(dims).fill(0);
  for (const s of usable) for (let i = 0; i < dims; i++) centroid[i] += s.timbre[i] / usable.length;
  // Per-dimension scale: spread across all samples, floored so one very
  // consistent coefficient cannot make the gate impossibly strict.
  const variance = new Array(dims).fill(0);
  for (const s of usable) for (let i = 0; i < dims; i++) variance[i] += (s.timbre[i] - centroid[i]) ** 2 / usable.length;
  const typical = Math.sqrt(variance.reduce((a, b) => a + b, 0) / dims);
  const scale = variance.map((v) => Math.max(Math.sqrt(v), typical * 0.5, 0.05));

  let timbreSpread = 0;
  for (let k = 0; k < usable.length; k++) {
    const others = usable.filter((_, i) => i !== k);
    const c = new Array(dims).fill(0);
    for (const s of others) for (let i = 0; i < dims; i++) c[i] += s.timbre[i] / others.length;
    timbreSpread = Math.max(timbreSpread, scaledDistance(usable[k].timbre, c, scale));
  }

  const pitches = usable.map((s) => s.pitchHz).filter((p) => p > 0);
  const pitchHz = pitches.length ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 0;
  const pitchSpreadSemitones = pitches.length
    ? Math.max(...pitches.map((p) => Math.abs(semitones(p, pitchHz))))
    : 0;
  return { centroid, scale, pitchHz, pitchSpreadSemitones, timbreSpread, sampleCount: usable.length };
}

function scaledDistance(x: number[], centroid: number[], scale: number[]): number {
  let acc = 0;
  for (let i = 0; i < centroid.length; i++) acc += ((x[i] - centroid[i]) / scale[i]) ** 2;
  return Math.sqrt(acc / centroid.length);
}

const semitones = (a: number, b: number) => (a > 0 && b > 0 ? 12 * Math.log2(a / b) : 0);

function voiceCheck(profile: VoiceProfile, u: Utterance, settings: MatchSettings) {
  const timbre = scaledDistance(u.timbre, profile.centroid, profile.scale);
  const timbreLimit = Math.max(profile.timbreSpread, 0.6) * (1.2 + 0.9 * settings.voiceTolerance);
  const timbreRatio = timbre / timbreLimit;
  const pitchSemi = profile.pitchHz > 0 && u.pitchHz > 0 ? Math.abs(semitones(u.pitchHz, profile.pitchHz)) : 0;
  const pitchLimit = Math.max(2.5, profile.pitchSpreadSemitones * 1.5) + 2.5 * settings.voiceTolerance;
  const pitchRatio = pitchSemi / pitchLimit;
  const ratio = Math.max(timbreRatio, pitchRatio);
  return { ok: ratio <= 1, ratio, timbreRatio, pitchSemi };
}

// ---------------------------------------------------------------------------

const toScore = (ratio: number) => Math.max(0, Math.min(1, 1 - ratio / 2));

/**
 * Find the best matching command among `candidates`.
 * The phrase gate picks the command; the voice gate decides whether to accept it.
 */
export function matchUtterance(
  utterance: Utterance,
  candidates: VoiceCommand[],
  profile: VoiceProfile | null,
  settings: MatchSettings = DEFAULT_SETTINGS,
): MatchResult {
  let best: { command: VoiceCommand; ratio: number } | null = null;
  for (const command of candidates) {
    if (command.samples.length === 0) continue;
    const ratio = phraseDistance(command, utterance) / phraseLimit(command, settings);
    if (!best || ratio < best.ratio) best = { command, ratio };
  }
  const phraseRatio = best?.ratio ?? Infinity;
  const phraseOk = phraseRatio <= 1;
  const voice = profile ? voiceCheck(profile, utterance, settings) : { ok: false, ratio: Infinity, timbreRatio: Infinity, pitchSemi: 0 };
  return {
    command: phraseOk && voice.ok ? best!.command : null,
    phraseScore: Number.isFinite(phraseRatio) ? toScore(phraseRatio) : 0,
    voiceScore: Number.isFinite(voice.ratio) ? toScore(voice.ratio) : 0,
    phraseOk,
    voiceOk: voice.ok,
    detail: { phraseRatio, timbreRatio: voice.timbreRatio, pitchSemitones: voice.pitchSemi },
  };
}

/** How consistent a new enrolment sample is with the ones already recorded. */
export function sampleConsistency(existing: Utterance[], candidate: Utterance): number {
  if (existing.length === 0) return 1;
  const distances = existing.map((s) => dtwDistance(s.frames, candidate.frames));
  const own = existing.length > 1 ? phraseSpread(existing) : Math.min(...distances);
  return Math.min(...distances) / Math.max(own, 1e-3);
}
