import { useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Button, Empty, Toggle } from './ui';
import { agentMissingText, api, useAgentStatus, usePoll } from '../state/agent';
import { notificationState, setNotifications } from '../state/notify';
import { clearConversation } from '../state/assistant';

interface Prefs {
  auto_safe_fixes: boolean;
  memory_enabled: boolean;
  conversation_retention_days: number;
}

interface MemoryRow {
  memory_id: string;
  text: string;
  status: 'pending' | 'saved';
  source: string;
  created_at: string;
}

function usePrefs() {
  const agent = useAgentStatus();
  const prefs = usePoll<Prefs>(agent.agent === 'online' ? '/settings/preferences' : null, 60_000);
  const save = async (patch: Partial<Prefs>) => {
    await api('/settings/preferences', { method: 'PUT', body: patch });
    prefs.reload();
  };
  return { agent, prefs: prefs.data, save };
}

/** Safe fixes and notifications (spec §12.1 auto-safe default, G5 notifications). */
export function SafetySettings() {
  const { agent, prefs, save } = usePrefs();
  const [notif, setNotif] = useState(notificationState());
  return (
    <>
      <Toggle
        checked={!!prefs?.auto_safe_fixes}
        disabled={!prefs}
        onChange={(on) => void save({ auto_safe_fixes: on })}
        label="Automatically apply safe fixes"
        description="Only R1 fixes that are reversible and touch no personal data, like refreshing the DNS cache. Anything that changes settings still asks you every time."
      />
      <Toggle
        checked={notif === 'on'}
        disabled={notif === 'unsupported' || notif === 'blocked'}
        onChange={async (on) => setNotif(await setNotifications(on))}
        label="Windows notifications"
        description={
          notif === 'blocked'
            ? 'Blocked for the JARVIS window. Allow notifications for it in Chrome site settings.'
            : 'Timers, alarms, reminders and finished scans show as Windows notifications when JARVIS is hidden.'
        }
      />
      {!prefs && <p className="field-hint">{agentMissingText(agent)}</p>}
    </>
  );
}

/** Long-term memory (spec §13.3): off by default, approve, edit and delete every fact. */
export function MemorySettings() {
  const { agent, prefs, save } = usePrefs();
  const online = agent.agent === 'online';
  const list = usePoll<{ enabled: boolean; memories: MemoryRow[] }>(online ? '/memories' : null, 30_000);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmChats, setConfirmChats] = useState(false);
  const memories = list.data?.memories ?? [];

  useEffect(() => setError(null), [prefs?.memory_enabled]);

  const call = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void call(async () => {
      await api('/memories', { method: 'POST', body: { text } });
      setText('');
    });
  };

  if (!online) return <p className="muted">{agentMissingText(agent)}</p>;
  return (
    <>
      <Toggle
        checked={!!prefs?.memory_enabled}
        disabled={!prefs}
        onChange={(on) => void save({ memory_enabled: on }).then(() => list.reload())}
        label="Let JARVIS remember facts about you"
        description="Off by default. Facts are used only as background for answers. You approve each one, and passwords, codes and card numbers are always refused."
      />
      {prefs?.memory_enabled && (
        <form className="profile-form" onSubmit={add}>
          <label htmlFor="memory-new" className="visually-hidden">
            Add a fact
          </label>
          <div className="row">
            <input id="memory-new" className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="e.g. I use this PC for video editing" autoComplete="off" />
            <Button type="submit" size="sm" icon={Plus} disabled={!text.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}
      {memories.length > 0 ? (
        <ul className="memory-list">
          {memories.map((m) => (
            <MemoryItem key={m.memory_id} m={m} onChange={() => list.reload()} onError={setError} />
          ))}
        </ul>
      ) : (
        prefs?.memory_enabled && (
          <Empty icon={Check} title="Nothing remembered yet">
            Add a fact here, or say “Hey Jarvis, remember that…”. Facts you say wait here for your approval.
          </Empty>
        )
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        {memories.length > 0 &&
          (confirmAll ? (
            <>
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => void call(() => api('/memories', { method: 'DELETE' })).then(() => setConfirmAll(false))}>
                Delete all {memories.length}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>
                Keep them
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmAll(true)}>
              Delete all memories
            </Button>
          ))}
        {confirmChats ? (
          <>
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              onClick={() =>
                void call(async () => {
                  await api('/assistant/conversations', { method: 'DELETE' });
                  clearConversation();
                }).then(() => setConfirmChats(false))
              }
            >
              Delete conversation history
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmChats(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmChats(true)}>
            Delete conversation history
          </Button>
        )}
      </div>
      <p className="field-hint">Conversations are kept {prefs?.conversation_retention_days ?? 30} days, then deleted automatically.</p>
    </>
  );
}

function MemoryItem({ m, onChange, onError }: { m: MemoryRow; onChange: () => void; onError: (e: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const call = async (fn: () => Promise<unknown>) => {
    onError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      onError((err as Error).message);
    }
  };
  return (
    <li className={`memory ${m.status === 'pending' ? 'is-pending' : ''}`}>
      {editing ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void call(() => api(`/memories/${m.memory_id}`, { method: 'PATCH', body: { text } })).then(() => setEditing(false));
          }}
        >
          <label htmlFor={`mem-${m.memory_id}`} className="visually-hidden">
            Edit fact
          </label>
          <input id={`mem-${m.memory_id}`} className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      ) : (
        <span className="memory-text">{m.text}</span>
      )}
      <span className="mono muted memory-state">{m.status === 'pending' ? 'waiting for you' : 'saved'}</span>
      <div className="row">
        {m.status === 'pending' && (
          <Button size="sm" variant="primary" icon={Check} onClick={() => void call(() => api(`/memories/${m.memory_id}`, { method: 'PATCH', body: { approve: true } }))}>
            Keep
          </Button>
        )}
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete “${m.text}”`} onClick={() => void call(() => api(`/memories/${m.memory_id}`, { method: 'DELETE' }))}>
          Delete
        </Button>
      </div>
    </li>
  );
}
