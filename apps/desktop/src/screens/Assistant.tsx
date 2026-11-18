import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CornerDownLeft, Eraser, Mic, MessageSquare } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader } from '../components/ui';
import { clearConversation, send, useConversation } from '../state/assistant';
import { agentMissingText, ago, useAgentStatus } from '../state/agent';
import { useVoice } from '../state/useVoice';
import { voice } from '../voice/engine';

const SUGGESTIONS = ['Why is my PC slow?', 'Is my Wi-Fi OK?', 'Is my disk getting full?', 'Run a quick scan', 'Set a timer for 5 minutes'];

export function Assistant() {
  const turns = useConversation();
  const agent = useAgentStatus();
  const v = useVoice();
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
              Ask about your PC (“Why is it slow?”, “Is my Wi-Fi OK?”) and JARVIS answers from live readings and scan results, showing the
              evidence. Everyday requests work too: the time, timers, quick maths, opening apps and websites.
            </Empty>
          ) : (
            turns.map((t) => (
              <div key={t.id} className={`turn turn-${t.role} ${t.pending ? 'is-pending' : ''}`} aria-busy={t.pending || undefined}>
                <span className="turn-who mono">{t.role === 'user' ? 'You' : 'JARVIS'}</span>
                <p className="turn-text">{t.text}</p>
                {t.facts && t.facts.length > 0 && (
                  <ul className="turn-facts" aria-label="Evidence">
                    {t.facts.slice(0, 6).map((f, i) => (
                      <li key={i}>
                        <span>{f.label}</span> <span className="mono">{String(f.value)}</span>{' '}
                        <span className="turn-source mono">
                          {f.source} · {ago(f.observed_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.limitations?.map((l, i) => (
                  <p key={i} className="turn-evidence">
                    {l}
                  </p>
                ))}
                {t.provider && <p className="turn-provider mono">{t.provider === 'rules' ? 'Explained by JARVIS rules' : `Explained by ${t.provider.replace('ollama:', '')} (local)`}</p>}
                {t.kind === 'status' && <p className="turn-evidence mono">Evidence: none available · {agentMissingText(agent) || 'Agent: not responding'}</p>}
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
          <Button variant="secondary" icon={Mic} disabled={!v.enabled || v.models !== 'ready'} onClick={() => voice.wake()} title={v.enabled ? 'Start talking, same as saying your wake phrase' : 'Turn listening on in Voice first'}>
            Talk
          </Button>
          <button type="submit" className="btn btn-primary btn-md" disabled={!text.trim()}>
            <CornerDownLeft size={16} aria-hidden="true" />
            <span>Send</span>
          </button>
        </form>
        <p className="field-hint">To talk instead of typing, say your wake phrase and then your request. Spoken requests and answers show up here too.</p>
      </Panel>
    </div>
  );
}
