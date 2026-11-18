/**
 * Voiceprint from WavLM speaker embeddings (x-vectors). Stores only the
 * embedding numbers, never audio.
 */

export interface Voiceprint {
  /** One embedding per enrolment sample (unit length). */
  embeddings: number[][];
  centroid: number[];
  /** Lowest similarity of an enrolment sample to the others (leave-one-out). */
  selfSimilarity: number;
  createdAt: string;
  /** How many of the embeddings came from the enrolment recordings. */
  enrolled?: number;
}

export function unit(v: ArrayLike<number>): number[] {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

function mean(vectors: number[][]): number[] {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i] / vectors.length;
  return unit(out);
}

export function buildVoiceprint(embeddings: number[][]): Voiceprint {
  const units = embeddings.map(unit);
  let selfSimilarity = 1;
  if (units.length > 1) {
    for (let k = 0; k < units.length; k++) {
      const others = units.filter((_, i) => i !== k);
      selfSimilarity = Math.min(selfSimilarity, cosine(units[k], mean(others)));
    }
  }
  return { embeddings: units, centroid: mean(units), selfSimilarity, createdAt: new Date().toISOString(), enrolled: units.length };
}

/**
 * Similarity needed to accept a voice. Calibrated from how consistent the
 * user's own samples were, then kept inside sensible bounds.
 * Tolerance 0 = strict, 1 = relaxed.
 */
export function voiceThreshold(print: Voiceprint, tolerance: number): number {
  const t = Math.min(1, Math.max(0, tolerance));
  // Real voices vary more between days than between back-to-back samples, so leave headroom.
  const fromSamples = print.selfSimilarity - 0.08 - 0.08 * t;
  // Never below a firm floor (strict 0.78, default 0.74, relaxed 0.70) so other people stay out.
  return Math.min(0.86, Math.max(0.78 - 0.08 * t, fromSamples));
}

const MAX_SAMPLES = 12;

/**
 * Learn from a confident match: add the new embedding (keeping the 4 enrolment
 * samples and the most recent learned ones) so the voiceprint follows how the
 * owner normally sounds. Only called well above the pass mark.
 */
export function learn(print: Voiceprint, embedding: ArrayLike<number>, enrolled: number): Voiceprint {
  const kept = [...print.embeddings.slice(0, enrolled), ...print.embeddings.slice(enrolled).slice(-(MAX_SAMPLES - enrolled - 1)), unit(embedding)];
  const next = buildVoiceprint(kept);
  // Keep the calibration from the original enrolment; learning must not loosen the pass mark.
  return { ...next, selfSimilarity: Math.max(print.selfSimilarity, next.selfSimilarity), enrolled };
}

export function verify(print: Voiceprint, embedding: ArrayLike<number>, tolerance: number) {
  // Best of centroid and closest sample: robust to one odd enrolment take.
  const sim = Math.max(cosine(print.centroid, embedding), ...print.embeddings.map((e) => cosine(e, embedding)).sort((a, b) => b - a).slice(0, 2));
  const threshold = voiceThreshold(print, tolerance);
  return { similarity: sim, threshold, ok: sim >= threshold };
}
