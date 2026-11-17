import { useState } from 'react';
import { AudioLines, FlaskConical, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Button, Empty, LevelMeter, Panel, ScreenHeader, StatusPill, Toggle } from '../components/ui';
import { PhraseRecorder } from '../components/PhraseRecorder';
import { HeardLog } from '../components/HeardLog';
import { useVoice, ACTION_LABELS } from '../state/useVoice';
import { voice } from '../voice/engine';
import type { CommandAction, MatchResult } from '../voice/matcher';

const COMMAND_ACTIONS: CommandAction[] = [
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
  const [test, setTest] = useState<MatchResult | 'nothing' | null>(null);
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
          meta={wake ? <StatusPill tone="ok">Set</StatusPill> : <StatusPill tone="warn">Not set</StatusPill>}
        >
          {!wake || editingWake ? (
            <PhraseRecorder
              title={wake ? 'Record a new wake phrase' : 'Step 1 · Record your wake phrase'}
              initialPhrase={wake?.phrase ?? 'Hey Jarvis'}
              action="wake"
              onSaved={() => setEditingWake(false)}
              onCancel={wake ? () => setEditingWake(false) : undefined}
            />
          ) : (
            <div className="wake-summary">
              <p className="wake-summary-phrase">“{wake.phrase}”</p>
              <p className="muted">
                {wake.samples.length} samples of your voice · saved {new Date(wake.createdAt).toLocaleDateString()}
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
          <ul className="notes">
            <li>The red LIVE light in the top bar is on whenever the microphone is listening.</li>
            <li>Only numeric features of your samples are kept, in this app’s local storage. No audio is stored or sent.</li>
            <li>Commands only work in the few seconds after JARVIS wakes, so normal conversation cannot trigger them.</li>
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
            <PhraseRecorder title="New command" action={freeActions} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
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
                ? `Add phrases like “Open monitor”. Say “${wake.phrase}” first, then the command.`
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
