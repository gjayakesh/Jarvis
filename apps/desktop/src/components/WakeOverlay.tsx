import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import { Core } from './Core';
import { useVoice, ACTION_LABELS } from '../state/useVoice';
import { voice } from '../voice/engine';
import { navigate } from '../state/router';
import { send } from '../state/assistant';

/** The listening moment: takes over the whole window while JARVIS waits for a command. */
export function WakeOverlay({ pulseKey }: { pulseKey: number }) {
  const v = useVoice();
  const awake = v.awakeUntil !== null;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [remaining, setRemaining] = useState(1);

  useEffect(() => {
    if (!awake) return;
    const start = Date.now();
    const total = Math.max(1, (v.awakeUntil ?? start) - start);
    const id = window.setInterval(() => setRemaining(Math.max(0, ((v.awakeUntil ?? 0) - Date.now()) / total)), 100);
    return () => window.clearInterval(id);
  }, [awake, v.awakeUntil]);

  useEffect(() => {
    if (!awake) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') voice.sleep();
    };
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [awake]);

  if (!awake) return null;
  const commands = v.commands.filter((c) => c.action !== 'wake');
  const last = v.heard[0];
  const heardRecently = last && Date.now() - last.at < 4000 && last.outcome !== 'accepted';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text);
    setText('');
    voice.sleep();
    navigate('assistant');
  };

  return (
    <div className="wake" role="dialog" aria-modal="true" aria-labelledby="wake-title">
      <div className="wake-core">
        <Core inputs={[]} showInputs={false} level={v.level} mode="awake" pulseKey={pulseKey} label="JARVIS is listening" />
      </div>
      <div className="wake-panel">
        <h2 id="wake-title" className="wake-title">
          Listening
        </h2>
        <p className="wake-lead">
          {commands.length > 0 ? 'Say one of your commands, or type what you need.' : 'Type what you need. You can add spoken commands in Voice.'}
        </p>
        {commands.length > 0 && (
          <ul className="wake-commands" aria-label="Your voice commands">
            {commands.map((c) => (
              <li key={c.id}>
                <span className="wake-phrase">“{c.phrase}”</span>
                <span className="wake-action mono">{ACTION_LABELS[c.action]}</span>
              </li>
            ))}
          </ul>
        )}
        {heardRecently && (
          <p className="wake-heard" role="status">
            {last.outcome === 'wrong-voice' ? 'That voice did not match yours, so I ignored it.' : "I didn't recognise that phrase."}
          </p>
        )}
        <form className="wake-form" onSubmit={submit}>
          <label htmlFor="wake-input" className="visually-hidden">
            Type a request
          </label>
          <input
            ref={inputRef}
            id="wake-input"
            className="input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              voice.wake(); // typing keeps the window open
            }}
            placeholder="Type a request…"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary btn-md" disabled={!text.trim()}>
            <CornerDownLeft size={16} aria-hidden="true" />
            <span>Send</span>
          </button>
        </form>
        <div className="wake-timer" aria-hidden="true">
          <span style={{ transform: `scaleX(${remaining})` }} />
        </div>
        <button type="button" className="wake-close btn btn-ghost btn-sm" onClick={() => voice.sleep()}>
          <X size={14} aria-hidden="true" />
          <span>Not now (Esc)</span>
        </button>
      </div>
    </div>
  );
}
