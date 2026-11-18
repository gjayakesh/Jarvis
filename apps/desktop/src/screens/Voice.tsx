import { useState } from 'react';
import { AudioLines, FlaskConical, Plus, Save, ShieldAlert, Trash2, X } from 'lucide-react';
import { Button, Empty, LevelMeter, Panel, ScreenHeader, StatusPill, Toggle } from '../components/ui';
import { PhraseRecorder } from '../components/PhraseRecorder';
import { HeardLog } from '../components/HeardLog';
import { useVoice, ACTION_LABELS } from '../state/useVoice';
import { voice, type TestResult } from '../voice/engine';
import type { CommandAction } from '../voice/text';

const COMMAND_ACTIONS: CommandAction[] = [
  'hide-jarvis',
  'open-monitor',
  'open-diagnostics',
  'start-quick-scan',
  'open-assistant',
  'open-activity',
  'open-home',
  'stop-listening',
];

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function VoiceScreen() {
  const v = useVoice();
  const wake = v.commands.find((c) => c.action === 'wake');
  const commands = v.commands.filter((c) => c.action !== 'wake');
  const [editingWake, setEditingWake] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | 'nothing' | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const listening = v.enabled && v.status === 'listening';
  const freeActions = COMMAND_ACTIONS.filter((a) => !commands.some((c) => c.action === a));

  const runTest = async () => {
    setTest(null);
    setTesting(true);
    const r = await voice.testOnce();
    setTesting(false);
    setTest(r ?? 'nothing');
  };

  return (
    <div className="screen">
      <ScreenHeader title="Voice">
        Teach JARVIS your voice. It listens on this PC only, never saves recordings, and ignores phrases spoken by anyone else.
      </ScreenHeader>

      <div className="voice-grid">
        <Panel
          title="Wake phrase"
          className="voice-wake"
          meta={wake ? <StatusPill tone="ok">Set</StatusPill> : <StatusPill tone="muted">Not set</StatusPill>}
        >
          {!wake || editingWake ? (
            <PhraseRecorder
              title={wake ? 'Record a new wake phrase' : 'Step 1 · Record your wake phrase'}
              initialPhrase={wake?.phrase ?? 'Hey Jarvis'}
              onSaved={() => setEditingWake(false)}
              onCancel={wake ? () => setEditingWake(false) : undefined}
            />
          ) : (
            <div className="wake-summary">
              <p className="wake-summary-phrase">“{wake.phrase}”</p>
              <p className="muted">
                Voiceprint from {v.voiceprint?.embeddings.length ?? 0} samples · saved {new Date(wake.createdAt).toLocaleDateString()}
              </p>
              <div className="row">
                <Button icon={AudioLines} onClick={() => setEditingWake(true)}>
                  Record again
                </Button>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Listening" className="voice-listen" meta={<StatusPill tone={listening ? 'live' : 'muted'}>{listening ? 'On' : 'Off'}</StatusPill>}>
          <Toggle
            checked={v.enabled}
            disabled={!wake}
            onChange={(on) => voice.setListening(on)}
            label="Listen for my wake phrase"
            description={wake ? 'When on, JARVIS wakes when it hears your phrase in your voice.' : 'Record a wake phrase first.'}
          />
          <LevelMeter level={v.level} active={listening || v.capturing} />
          {v.errorMessage && (
            <p className="inline-error" role="alert">
              {v.errorMessage}
            </p>
          )}
          {v.modelMessage && (
            <p className={v.models === 'error' ? 'inline-error' : 'field-hint'} role="status">
              {v.modelMessage}
            </p>
          )}
          <ul className="notes">
            <li>The red LIVE light in the top bar is on whenever the microphone is listening.</li>
            <li>Speech is understood by models running on this PC. Only your phrases and voiceprint numbers are kept; no audio is stored or sent.</li>
            <li>Say your wake phrase, then a command or a question. You can also say both in one go: “Hey Jarvis, open monitor”.</li>
            <li>
              Everyday requests work without setup: “What time is it?”, “Set a timer for 10 minutes”, “Remind me to call Mom at 6 pm”, “Open
              Notepad”, “Play lo-fi music”, “What’s 15 times 12?”, “Tell me a joke”. Commands you add below are for JARVIS’s own screens.
            </li>
          </ul>
        </Panel>

        <Panel title="Test" className="voice-test" meta={<FlaskConical size={14} aria-hidden="true" />}>
          <p className="muted">Say your wake phrase or a command once. JARVIS shows how closely it matched, without doing anything.</p>
          <div className="row">
            <Button variant="primary" icon={FlaskConical} disabled={!wake || testing || v.capturing} onClick={runTest}>
              {testing ? 'Listening…' : 'Test once'}
            </Button>
          </div>
          {testing && <LevelMeter level={v.level} active />}
          {test === 'nothing' && <p className="recorder-msg tone-bad" role="status">I didn’t hear a clear phrase. Try again a little closer.</p>}
          {test && test !== 'nothing' && (
            <div className="test-result" role="status">
              <p className="muted">
                Heard: <strong>“{test.text}”</strong>
              </p>
              <p className={`test-verdict tone-${test.command ? 'ok' : 'bad'}`}>
                {test.command
                  ? `Matched “${test.command.phrase}”. JARVIS would answer.`
                  : test.phraseOk && !test.voiceOk
                    ? 'Right phrase, but the voice did not match. JARVIS would ignore it.'
                    : 'No phrase matched. JARVIS would ignore it.'}
              </p>
              <div className="test-bars">
                <TestBar label="Phrase match" value={test.phraseScore} ok={test.phraseOk} />
                <TestBar label="Voice match" value={test.voiceScore} ok={test.voiceOk} />
              </div>
            </div>
          )}
          <p className="field-hint">Ask someone else to say your wake phrase: JARVIS should ignore them.</p>
        </Panel>

        <Panel title="Commands" className="voice-commands" meta={<span className="mono">{commands.length}</span>}>
          {commands.length > 0 && (
            <ul className="cmd-list">
              {commands.map((c) => (
                <li key={c.id} className="cmd">
                  <span className="cmd-phrase">“{c.phrase}”</span>
                  <span className="cmd-action mono">{ACTION_LABELS[c.action]}</span>
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => voice.deleteCommand(c.id)} aria-label={`Delete command ${c.phrase}`}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {adding ? (
            <CommandForm actions={freeActions} onDone={() => setAdding(false)} />
          ) : commands.length === 0 ? (
            <Empty
              icon={AudioLines}
              title="No commands yet"
              action={
                <Button icon={Plus} disabled={!wake} onClick={() => setAdding(true)}>
                  Add a command
                </Button>
              }
            >
              {wake
                ? `Type phrases like “Open monitor”. No recording needed: JARVIS understands the words. Say “${wake.phrase}” first, then the command.`
                : 'Set up your wake phrase first. Then add phrases like “Open monitor”.'}
            </Empty>
          ) : (
            freeActions.length > 0 && (
              <Button icon={Plus} onClick={() => setAdding(true)}>
                Add a command
              </Button>
            )
          )}
        </Panel>

        <Panel title="Matching" className="voice-matching">
          <Slider
            label="Phrase matching"
            value={v.settings.phraseTolerance}
            onChange={(n) => voice.updateSettings({ phraseTolerance: n })}
            hint="Relax it if JARVIS misses your phrase. Tighten it if it wakes on similar words."
          />
          <Slider
            label="Voice matching"
            value={v.settings.voiceTolerance}
            onChange={(n) => voice.updateSettings({ voiceTolerance: n })}
            hint="Relax it if JARVIS ignores you when you sound tired or have a cold. Tighten it if it answers other people."
          />
          <p className="caveat">
            <ShieldAlert size={14} aria-hidden="true" />
            Voice matching keeps other people and the TV from controlling JARVIS. It is not a security lock: a recording of your
            voice could still wake it, so it never approves risky changes by voice alone.
          </p>
        </Panel>

        <Panel title="Heard" className="voice-heard" meta={<span className="mono">this session</span>}>
          {v.heard.length > 0 ? (
            <HeardLog events={v.heard} />
          ) : (
            <Empty icon={AudioLines} title="Nothing heard yet">
              Turn listening on and speak. Every phrase JARVIS hears is listed here, including the ones it ignored and why.
            </Empty>
          )}
          <div className="forget">
            {confirmForget ? (
              <div className="confirm" role="alertdialog" aria-labelledby="forget-q">
                <p id="forget-q">Delete your wake phrase, all commands and voice features from this PC? This cannot be undone.</p>
                <div className="row">
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() => {
                      voice.forgetVoice();
                      setConfirmForget(false);
                    }}
                  >
                    Delete voice data
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmForget(false)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" icon={Trash2} disabled={v.commands.length === 0} onClick={() => setConfirmForget(true)}>
                Delete my voice data
              </Button>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TestBar({ label, value, ok }: { label: string; value: number; ok: boolean }) {
  return (
    <div className="test-bar">
      <span className="test-bar-label">{label}</span>
      <span className="test-bar-track" aria-hidden="true">
        <span className={`test-bar-fill tone-${ok ? 'ok' : 'bad'}`} style={{ transform: `scaleX(${value})` }} />
      </span>
      <span className="mono">
        {pct(value)} · {ok ? 'pass' : 'fail'}
      </span>
    </div>
  );
}

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint: string }) {
  const id = `slider-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="slider">
      <label htmlFor={id} className="slider-label">
        {label}
      </label>
      <div className="slider-row">
        <span className="mono slider-end">Strict</span>
        <input
          id={id}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-describedby={`${id}-hint`}
          style={{ ['--fill' as string]: `${value * 100}%` }}
        />
        <span className="mono slider-end">Relaxed</span>
      </div>
      <p id={`${id}-hint`} className="field-hint">
        {hint}
      </p>
    </div>
  );
}

const SUGGESTED: Partial<Record<CommandAction, string>> = {
  'hide-jarvis': 'Goodbye Jarvis',
  'open-monitor': 'Open monitor',
  'open-diagnostics': 'Open diagnostics',
  'start-quick-scan': 'Run a quick scan',
  'open-assistant': 'Open assistant',
  'open-activity': 'Show activity',
  'open-home': 'Go home',
  'stop-listening': 'Never mind',
};

/** Commands are matched as words by speech-to-text, so they are just typed. */
function CommandForm({ actions, onDone }: { actions: CommandAction[]; onDone: () => void }) {
  const [action, setAction] = useState<CommandAction>(actions[0]);
  const [phrase, setPhrase] = useState(SUGGESTED[actions[0]] ?? '');
  const ok = phrase.trim().length >= 3;
  return (
    <form
      className="recorder"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        voice.saveCommand(phrase, action);
        onDone();
      }}
    >
      <h3 className="recorder-title">New command</h3>
      <div className="recorder-fields">
        <div className="field">
          <label htmlFor="cmd-action">What it does</label>
          <select
            id="cmd-action"
            className="input"
            value={action}
            onChange={(e) => {
              const next = e.target.value as CommandAction;
              setAction(next);
              setPhrase(SUGGESTED[next] ?? '');
            }}
          >
            {actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cmd-phrase">What you say</label>
          <input id="cmd-phrase" className="input" value={phrase} maxLength={40} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <p className="field-hint">
        {action === 'hide-jarvis'
          ? 'This one works at any time, so you can hide JARVIS without waking it first.'
          : 'Works in the few seconds after you say your wake phrase.'}
      </p>
      <div className="recorder-actions">
        <button type="submit" className="btn btn-primary btn-md" disabled={!ok}>
          <Save size={16} aria-hidden="true" />
          <span>Save command</span>
        </button>
        <Button variant="ghost" icon={X} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
