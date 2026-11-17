import type { HeardEvent } from '../voice/engine';
import { StatusPill } from './ui';

const OUTCOME: Record<HeardEvent['outcome'], { text: string; tone: 'ok' | 'bad' | 'muted' | 'warn' }> = {
  accepted: { text: 'Answered', tone: 'ok' },
  'wrong-voice': { text: 'Not your voice', tone: 'bad' },
  'unknown-phrase': { text: 'Unknown phrase', tone: 'muted' },
  'too-long': { text: 'Too long', tone: 'muted' },
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function HeardLog({ events }: { events: HeardEvent[] }) {
  return (
    <table className="table">
      <caption className="visually-hidden">What JARVIS heard, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Result</th>
          <th scope="col">Phrase</th>
          <th scope="col" className="num">Phrase match</th>
          <th scope="col" className="num">Voice match</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td className="mono">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
            <td>
              <StatusPill tone={OUTCOME[e.outcome].tone}>{OUTCOME[e.outcome].text}</StatusPill>
            </td>
            <td>{e.phrase ? `“${e.phrase}”` : '—'}</td>
            <td className="num mono">{e.outcome === 'too-long' ? '—' : pct(e.phraseScore)}</td>
            <td className="num mono">{e.outcome === 'too-long' ? '—' : pct(e.voiceScore)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
