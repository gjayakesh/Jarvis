import { describe, expect, it } from 'vitest';
import { matchAtStart, matchCommand, normalize, phraseThreshold, similarity, type VoiceCommand } from '../src/voice/text';
import { buildVoiceprint, cosine, verify } from '../src/voice/voiceprint';

const t = phraseThreshold(0.5);
const cmd = (phrase: string, action: VoiceCommand['action']): VoiceCommand => ({ id: phrase, phrase, action, createdAt: '' });

describe('phrase matching on speech-to-text output', () => {
  it('ignores case and punctuation', () => {
    expect(normalize('Hey, Jarvis!')).toBe('hey jarvis');
    expect(similarity('Hey Jarvis', 'hey jarvis.')).toBe(1);
  });

  it('finds the wake phrase at the start and returns the rest', () => {
    const m = matchAtStart('Hey Jarvis', 'Hey Jarvis, open the monitor.');
    expect(m.score).toBeGreaterThanOrEqual(t);
    expect(m.rest).toBe('open the monitor');
  });

  it('tolerates small transcription differences', () => {
    expect(matchAtStart('Hey Jarvis', 'Hey Jarvis').score).toBe(1);
    expect(matchAtStart('Hey Jarvis', 'Hey, Jarviss.').score).toBeGreaterThanOrEqual(t);
    expect(matchAtStart('Hey Jarvis', 'Hay Jarvis').score).toBeGreaterThanOrEqual(t);
  });

  it('rejects different words', () => {
    expect(matchAtStart('Hey Jarvis', 'Hey Travis').score).toBeLessThan(t);
    expect(matchAtStart('Hey Jarvis', 'Thank you.').score).toBeLessThan(t);
    expect(matchAtStart('Hey Jarvis', 'Hello there, how are you?').score).toBeLessThan(t);
  });

  it('matches commands, including with trailing words', () => {
    const commands = [cmd('Open monitor', 'open-monitor'), cmd('Goodbye Jarvis', 'hide-jarvis')];
    expect(matchCommand('Open monitor.', commands, 0.5)?.command.action).toBe('open-monitor');
    expect(matchCommand('Open monitor please', commands, 0.5)?.command.action).toBe('open-monitor');
    expect(matchCommand('Goodbye, Jarvis.', commands, 0.5)?.command.action).toBe('hide-jarvis');
    expect(matchCommand('What is the weather?', commands, 0.5)).toBeNull();
  });
});

describe('voiceprint', () => {
  // Synthetic embeddings: one "speaker direction" plus small per-sample noise.
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const speaker = (base: number[], noise: number) => base.map((x) => x + rand() * noise);
  const owner = Array.from({ length: 512 }, () => rand());
  const other = Array.from({ length: 512 }, () => rand());

  it('accepts new samples from the same speaker and rejects another speaker', () => {
    const print = buildVoiceprint([0, 1, 2, 3].map(() => speaker(owner, 0.5)));
    expect(print.selfSimilarity).toBeGreaterThan(0.6);
    expect(verify(print, speaker(owner, 0.5), 0.5).ok).toBe(true);
    expect(verify(print, speaker(other, 0.5), 0.5).ok).toBe(false);
  });

  it('cosine is 1 for identical direction', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});
