import { AudioLines, Cloud, Cpu, Database, Lock } from 'lucide-react';
import { Button, Panel, ScreenHeader, StatusPill, Toggle } from '../components/ui';
import { navigate } from '../state/router';
import { useVoice } from '../state/useVoice';
import { voice } from '../voice/engine';

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
  return (
    <div className="screen">
      <ScreenHeader title="Settings">AI, privacy, voice and data. Private by default; nothing leaves this PC unless you decide it should.</ScreenHeader>

      <div className="settings-grid">
        <Panel title="AI" meta={<Cpu size={14} aria-hidden="true" />}>
          <ul className="sysrows">
            <li>
              <span className="sysrow-name">Local AI (Ollama)</span>
              <StatusPill tone="warn">Not detected</StatusPill>
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
          <Button size="sm" icon={AudioLines} onClick={() => navigate('voice')}>
            Voice setup and commands
          </Button>
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
