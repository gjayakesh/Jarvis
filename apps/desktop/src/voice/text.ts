/**
 * Matching what Whisper heard against the user's phrases.
 * Pure functions, so they are unit-tested without audio or models.
 */

export type CommandAction =
  | 'wake'
  | 'open-home'
  | 'open-assistant'
  | 'open-monitor'
  | 'open-diagnostics'
  | 'start-quick-scan'
  | 'open-activity'
  | 'stop-listening'
  | 'hide-jarvis';

export interface VoiceCommand {
  id: string;
  phrase: string;
  action: CommandAction;
  createdAt: string;
}

/** Lowercase words without punctuation: "Hey, Jarvis!" -> "hey jarvis". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 0..1 character similarity between two normalised strings. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Minimum similarity for a match. Tolerance 0 = strict (0.92), 1 = relaxed (0.75). */
export function phraseThreshold(tolerance: number): number {
  return 0.92 - 0.17 * Math.min(1, Math.max(0, tolerance));
}

export interface PrefixMatch {
  score: number;
  /** Words after the matched phrase ("hey jarvis open monitor" -> "open monitor"). */
  rest: string;
}

/**
 * Best match of `phrase` at the start of `text`, allowing one word more or
 * less (Whisper sometimes splits or joins words).
 */
export function matchAtStart(phrase: string, text: string): PrefixMatch {
  const p = normalize(phrase);
  const words = normalize(text).split(' ').filter(Boolean);
  const n = p.split(' ').length;
  let best: PrefixMatch = { score: 0, rest: '' };
  for (let k = Math.max(1, n - 1); k <= Math.min(words.length, n + 1); k++) {
    const score = similarity(p, words.slice(0, k).join(' '));
    if (score > best.score) best = { score, rest: words.slice(k).join(' ') };
  }
  return best;
}

/** Best command for a whole utterance, or null when nothing is close enough. */
export function matchCommand(
  text: string,
  commands: VoiceCommand[],
  tolerance: number,
): { command: VoiceCommand; score: number } | null {
  const t = normalize(text);
  if (!t) return null;
  let best: { command: VoiceCommand; score: number } | null = null;
  for (const command of commands) {
    // Whole-utterance match, or the phrase said as the opening words ("open monitor please").
    const start = matchAtStart(command.phrase, t);
    const score = Math.max(similarity(command.phrase, t), start.rest ? start.score - 0.03 : 0);
    if (!best || score > best.score) best = { command, score };
  }
  return best && best.score >= phraseThreshold(tolerance) ? best : null;
}
