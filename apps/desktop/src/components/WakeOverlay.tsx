import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import { Core } from './Core';
import { useVoice, ACTION_LABELS } from '../state/useVoice';
import { voice } from '../voice/engine';
import { navigate } from '../state/router';
import { send } from '../state/assistant';

/**
 * The listening moment. Waking fills the window with the sun; once a
 * conversation is under way (JARVIS has acted on something), it docks to a
 * bar at the bottom so the screens JARVIS opens stay visible, and keeps
 * listening until "goodbye", Esc, or the window closes.
 */
export function WakeOverlay({ pulseKey }: { pulseKey: number }) {
  const v = useVoice();
  const awake = v.awakeUntil !== null;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [remaining, setRemaining] = useState(1);
  /** Newest heard event when JARVIS woke; anything newer means the conversation has started. */
  const [baseline, setBaseline] = useState<number | null>(null);

  useEffect(() => {
    if (!awake) {
      setBaseline(null);
      return;
    }
    setBaseline(voice.getState().heard[0]?.id ?? 0);
  }, [awake]);

  useEffect(() => {
    if (!awake || v.conversation) return;
    const start = Date.now();
    const total = Math.max(1, (v.awakeUntil ?? start) - start);
    const id = window.setInterval(() => setRemaining(Math.max(0, ((v.awakeUntil ?? 0) - Date.now()) / total)), 100);
    return () => window.clearInterval(id);
  }, [awake, v.awakeUntil, v.conversation]);

  useEffect(() => {
    if (!awake) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') voice.sleep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [awake]);

  const newest = v.heard[0];
  const docked =
    v.conversation && baseline !== null && !!newest && newest.id > baseline && (newest.outcome === 'request' || newest.outcome === 'accepted');

  useEffect(() => {
    if (awake && !docked) inputRef.current?.focus({ preventScroll: true });
  }, [awake, docked]);

  if (!awake) return null;
  const commands = v.commands.filter((c) => c.action !== 'wake');
  // Caption of what JARVIS just said (the greeting, an answer, or its question).
  const said = v.lastSaid && Date.now() - v.lastSaid.at < 60_000 ? v.lastSaid.text : null;
  const heardRecently = newest && Date.now() - newest.at < 4000 && (newest.outcome === 'wrong-voice' || newest.outcome === 'unknown-phrase');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text);
    setText('');
    if (v.conversation) return; // keep talking; the answer shows in the Assistant log
    voice.sleep();
    navigate('assistant');
  };

  return (
    <div
      className={`wake ${docked ? 'is-docked' : ''}`}
      role={docked ? 'region' : 'dialog'}
      aria-modal={docked ? undefined : true}
      aria-labelledby="wake-title"
    >
      <div className="wake-core">
        <Core inputs={[]} showInputs={false} level={v.level} mode="awake" pulseKey={pulseKey} label="JARVIS is listening" />
      </div>
      <div className="wake-panel">
        <div className="wake-status">
          <h2 id="wake-title" className="wake-title">
            {v.speaking ? 'Speaking' : 'Listening'}
          </h2>
          {v.conversation && <span className="wake-mode">Until you say goodbye</span>}
        </div>
        <p className="wake-lead" aria-live="polite">
          {said ?? 'Ask me anything, or type what you need.'}
        </p>
        <p className="wake-try">
          <span className="mono">Try</span> “What time is it?” · “Set a timer for 5 minutes” · “Open Notepad” · “Search for…” · “Tell me a joke”
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
            {newest.outcome === 'wrong-voice' ? 'That voice did not match yours, so I ignored it.' : "I didn't recognise that phrase."}
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
              if (!v.conversation) voice.wake(); // typing keeps the window open
            }}
            placeholder="Type a request…"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary btn-md" disabled={!text.trim()}>
            <CornerDownLeft size={16} aria-hidden="true" />
            <span>Send</span>
          </button>
        </form>
        {!v.conversation && (
          <div className="wake-timer" aria-hidden="true">
            <span style={{ transform: `scaleX(${remaining})` }} />
          </div>
        )}
        <button type="button" className="wake-close btn btn-ghost btn-sm" onClick={() => voice.sleep()}>
          <X size={14} aria-hidden="true" />
          <span>{v.conversation ? 'End conversation (Esc)' : 'Not now (Esc)'}</span>
        </button>
      </div>
    </div>
  );
}
