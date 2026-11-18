import { AudioLines, Cloud, Cpu, Database, EyeOff, Lock, Power, MonitorSmartphone, Save, UserRound, Volume2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { hideWindow, hosted, quitJarvis } from '../state/platform';
import { Button, Panel, ScreenHeader, StatusPill, Toggle } from '../components/ui';
import { navigate } from '../state/router';
import { useVoice } from '../state/useVoice';
import { updateProfile, useProfile } from '../state/profile';
import { localVoices, voice } from '../voice/engine';
import { cleanName, greeting } from '../voice/intents';

/** Privacy defaults from the spec (§13.3). */
const PRIVACY = [
  { name: 'Cloud AI', value: 'Off', note: 'You choose a provider and approve what is sent each time.' },
  { name: 'Background monitoring', value: 'Off until you opt in', note: 'Pause it, schedule it, or limit it on battery.' },
  { name: 'Wake phrase listening', value: 'Off by default', note: 'Separate switch, with a LIVE light while listening.' },
  { name: 'Conversation history', value: 'Kept 30 days', note: 'Clear one chat or all chats at any time.' },
  { name: 'Long-term memory', value: 'Off', note: 'You approve, edit or delete each fact JARVIS remembers.' },
  { name: 'File contents', value: 'Off', note: 'Only files you select, for one task at a time.' },
  { name: 'Sharing diagnostics', value: 'Off', note: 'Exports hide usernames, serial numbers, paths and IP addresses.' },
];

export function SettingsScreen() {
  const v = useVoice();
  const wake = v.commands.find((c) => c.action === 'wake');
  const profile = useProfile();
  return (
    <div className="screen">
      <ScreenHeader title="Settings">AI, privacy, voice and data. Private by default; nothing leaves this PC unless you decide it should.</ScreenHeader>

      <div className="settings-grid">
        <Panel title="AI" meta={<Cpu size={14} aria-hidden="true" />}>
          <ul className="sysrows">
            <li>
              <span className="sysrow-name">Local AI (Ollama)</span>
              <StatusPill tone="muted">Not detected</StatusPill>
              <span className="sysrow-note">Install Ollama and a small model to let JARVIS explain findings. On 8 GB of RAM, use a model of about 3–4B parameters.</span>
            </li>
            <li>
              <span className="sysrow-name">Cloud AI</span>
              <StatusPill tone="muted">Off</StatusPill>
              <span className="sysrow-note">Optional. Off until you add a provider and agree to what is shared.</span>
            </li>
          </ul>
          <Button size="sm" icon={Cloud} disabled title="Available once the agent is installed">
            Set up cloud AI
          </Button>
        </Panel>

        <Panel title="Voice" meta={<AudioLines size={14} aria-hidden="true" />}>
          <Toggle
            checked={v.enabled}
            disabled={!wake}
            onChange={(on) => voice.setListening(on)}
            label="Listen for my wake phrase"
            description={wake ? `Wake phrase: “${wake.phrase}”` : 'Not set up yet'}
          />
          <Toggle
            checked={profile.keepListening}
            onChange={(on) => updateProfile({ keepListening: on })}
            label="Keep listening until I say goodbye"
            description={
              profile.keepListening
                ? 'After you wake JARVIS, it answers everything you say in your voice until “Goodbye Jarvis”, Esc, or closing the window.'
                : 'JARVIS listens for a few seconds after each wake-up, then waits for its name again.'
            }
          />
          <Button size="sm" icon={AudioLines} onClick={() => navigate('voice')}>
            Voice setup and commands
          </Button>
        </Panel>

        <Panel title="About you" meta={<UserRound size={14} aria-hidden="true" />}>
          <PersonalPanel />
        </Panel>

        <Panel title="Background" meta={<MonitorSmartphone size={14} aria-hidden="true" />}>
          <BackgroundPanel />
        </Panel>

        <Panel title="Privacy" className="settings-privacy" meta={<Lock size={14} aria-hidden="true" />}>
          <table className="table">
            <caption className="visually-hidden">Privacy defaults</caption>
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Default</th>
                <th scope="col">What you control</th>
              </tr>
            </thead>
            <tbody>
              {PRIVACY.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="mono">{p.value}</td>
                  <td className="muted">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Data" meta={<Database size={14} aria-hidden="true" />}>
          <p className="muted">
            Stored on this PC: your voice features ({v.commands.length} phrase{v.commands.length === 1 ? '' : 's'}) and voice settings. No audio,
            no PC data yet.
          </p>
          <Button size="sm" variant="ghost" onClick={() => navigate('voice')}>
            Manage or delete voice data
          </Button>
        </Panel>
      </div>
    </div>
  );
}

const SPEEDS = [
  { value: 0.9, label: 'Relaxed' },
  { value: 1, label: 'Normal' },
  { value: 1.1, label: 'Brisk' },
];

/** How JARVIS addresses you and how it sounds. */
function PersonalPanel() {
  const profile = useProfile();
  const [name, setName] = useState(profile.name);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => localVoices());
  const dirty = cleanName(name) !== profile.name;

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const update = () => setVoices(localVoices());
    speechSynthesis.addEventListener('voiceschanged', update);
    update();
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  useEffect(() => setName(profile.name), [profile.name]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanName(name);
    updateProfile({ name: clean, askedName: true });
    setName(clean);
  };

  return (
    <>
      <form className="profile-form" onSubmit={save}>
        <div className="field">
          <label htmlFor="profile-name">What should JARVIS call you?</label>
          <div className="row">
            <input
              id="profile-name"
              className="input"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your first name"
              autoComplete="given-name"
            />
            <Button type="submit" size="sm" icon={Save} disabled={!dirty}>
              Save
            </Button>
          </div>
          <p className="field-hint">
            {profile.name ? `JARVIS greets you as ${profile.name}.` : 'Or just say “Hey Jarvis, call me…” and your name.'}
          </p>
        </div>
      </form>
      <div className="field">
        <label htmlFor="profile-voice">JARVIS’s voice</label>
        <select
          id="profile-voice"
          className="input"
          value={profile.voiceURI ?? ''}
          onChange={(e) => updateProfile({ voiceURI: e.target.value || null })}
          disabled={voices.length === 0}
        >
          <option value="">Automatic{voices[0] ? ` (${shortVoiceName(voices[0])})` : ''}</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {shortVoiceName(v)}
            </option>
          ))}
        </select>
        <p className="field-hint">
          {voices.length === 0 ? 'No voices are installed for speech on this PC.' : 'Voices installed on this PC. Nothing is sent online to speak.'}
        </p>
      </div>
      <div className="field">
        <span className="field-label" id="profile-speed-label">
          Speaking speed
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="profile-speed-label">
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={profile.rate === s.value}
              className={`segmented-option${profile.rate === s.value ? ' is-on' : ''}`}
              onClick={() => updateProfile({ rate: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <Button
        size="sm"
        icon={Volume2}
        disabled={voices.length === 0}
        onClick={() => voice.speak(greeting({ name: profile.name, now: new Date(), lastWakeAt: null }))}
      >
        Hear a greeting
      </Button>
    </>
  );
}

/** "Microsoft David - English (United States)" -> "David · English (United States)". */
function shortVoiceName(v: SpeechSynthesisVoice): string {
  const [who, lang] = v.name.replace(/^Microsoft\s+/, '').split(/\s+-\s+/);
  return lang ? `${who} · ${lang}` : who;
}

function BackgroundPanel() {
  const [confirmQuit, setConfirmQuit] = useState(false);
  if (!hosted) {
    return (
      <>
        <StatusPill tone="muted">Browser tab</StatusPill>
        <p className="muted">
          JARVIS is running in a browser tab, so it only hears you while this tab is open. To have it start with Windows and wake on your
          phrase at any time, run <span className="mono">apps\desktop\host\install-startup.ps1</span>.
        </p>
      </>
    );
  }
  return (
    <>
      <StatusPill tone="ok">Background mode</StatusPill>
      <p className="muted">
        JARVIS starts when you sign in to Windows and keeps listening while its window is hidden. Say your wake phrase to bring it back, or
        your close command to hide it.
      </p>
      <div className="row">
        <Button size="sm" icon={EyeOff} onClick={() => void hideWindow()}>
          Hide to background
        </Button>
        {confirmQuit ? (
          <>
            <Button size="sm" variant="danger" icon={Power} onClick={() => void quitJarvis()}>
              Quit until next sign-in
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmQuit(false)}>
              Keep running
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon={Power} onClick={() => setConfirmQuit(true)}>
            Quit JARVIS
          </Button>
        )}
      </div>
      {confirmQuit && <p className="field-hint">After quitting, JARVIS stops listening until you sign in again or open it from the Start menu.</p>}
    </>
  );
}
