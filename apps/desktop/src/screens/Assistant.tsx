import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CornerDownLeft, Eraser, Mic, MessageSquare } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader } from '../components/ui';
import { clearConversation, send, useConversation } from '../state/assistant';

const SUGGESTIONS = ['Why is my PC slow?', 'What changed before the last crash?', 'Check my Wi-Fi', 'Open my development setup'];

export function Assistant() {
  const turns = useConversation();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
    setText('');
  };

  return (
    <div className="screen screen-chat">
      <ScreenHeader title="Assistant">Ask about your PC in plain words. Answers will always show the evidence they are based on.</ScreenHeader>

      <Panel
        title="Conversation"
        className="chat"
        meta={
          turns.length > 0 ? (
            <Button variant="ghost" size="sm" icon={Eraser} onClick={clearConversation}>
              Clear
            </Button>
          ) : undefined
        }
      >
        <div className="chat-log" aria-live="polite">
          {turns.length === 0 ? (
            <Empty icon={MessageSquare} title="Start with a question">
              The local AI isn’t connected yet, so JARVIS can’t reason about your PC. It will tell you honestly instead of guessing.
            </Empty>
          ) : (
            turns.map((t) => (
              <div key={t.id} className={`turn turn-${t.role}`}>
                <span className="turn-who mono">{t.role === 'user' ? 'You' : 'JARVIS'}</span>
                <p className="turn-text">{t.text}</p>
                {t.kind === 'status' && (
                  <p className="turn-evidence mono">Evidence: none available · Local AI: not connected · Agent: not installed</p>
                )}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        {turns.length === 0 && (
          <div className="suggestions" aria-label="Suggested questions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <form className="chat-form" onSubmit={submit}>
          <label htmlFor="chat-input" className="visually-hidden">
            Message JARVIS
          </label>
          <input id="chat-input" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask JARVIS…" autoComplete="off" />
          <Button variant="secondary" icon={Mic} disabled title="Talking to JARVIS in full sentences needs speech-to-text, which comes with the agent.">
            Hold to talk
          </Button>
          <button type="submit" className="btn btn-primary btn-md" disabled={!text.trim()}>
            <CornerDownLeft size={16} aria-hidden="true" />
            <span>Send</span>
          </button>
        </form>
        <p className="field-hint">Hold to talk (full sentences) arrives with the agent’s on-device speech-to-text. Your voice commands already work.</p>
      </Panel>
    </div>
  );
}
