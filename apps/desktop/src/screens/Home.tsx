import { AudioLines, MessageSquare, Power, Radio } from 'lucide-react';
import { Core, type CoreInput } from '../components/Core';
import { Button, Empty, LevelMeter, Panel, StatusPill, Toggle } from '../components/ui';
import { HeardLog } from '../components/HeardLog';
import { useVoice } from '../state/useVoice';
import { navigate } from '../state/router';
import { voice } from '../voice/engine';
import { AGENT } from '../state/agent';

export function Home() {
  const v = useVoice();
  const wake = v.commands.find((c) => c.action === 'wake');
  const listening = v.enabled && v.status === 'listening';
  const commandCount = v.commands.filter((c) => c.action !== 'wake').length;

  const inputs: CoreInput[] = [
    {
      id: 'voice',
      label: 'Voice',
      detail: listening ? 'Listening' : wake ? 'Set up · off' : 'Not set up',
      state: listening ? 'live' : wake ? 'idle' : 'missing',
      color: '#3ee38c',
    },
    { id: 'cpu', label: 'CPU', detail: 'Needs agent', state: 'missing', color: '#3fb8ff' },
    { id: 'memory', label: 'Memory', detail: 'Needs agent', state: 'missing', color: '#ffb547' },
    { id: 'disk', label: 'Disk', detail: 'Needs agent', state: 'missing', color: '#b48cff' },
    { id: 'network', label: 'Network', detail: 'Needs agent', state: 'missing', color: '#ff7a59' },
  ];

  let headline: string;
  let detail: string;
  if (!wake) {
    headline = 'JARVIS is ready to learn your voice.';
    detail = 'Record a wake phrase so JARVIS answers only you. Your PC’s health appears here once the JARVIS agent is installed.';
  } else if (!listening) {
    headline = 'Your voice is set up. Listening is off.';
    detail = `Turn listening on and say “${wake.phrase}” to wake JARVIS. Nothing is recorded or sent anywhere.`;
  } else {
    headline = `Say “${wake.phrase}” and I’ll answer.`;
    detail = 'JARVIS is listening on this PC only and responds to your voice alone. PC health appears here once the agent is installed.';
  }

  return (
    <div className="home">
      <Panel
        title="JARVIS core"
        className="home-core"
        meta={<StatusPill tone={listening ? 'live' : wake ? 'muted' : 'warn'}>{listening ? 'Listening' : wake ? 'Asleep' : 'Voice not set up'}</StatusPill>}
      >
        <div className="home-core-stage">
          <Core
            inputs={inputs}
            level={listening ? v.level : 0}
            mode={listening ? 'listening' : 'idle'}
            pulseKey={0}
            label={`JARVIS core. ${headline}`}
          />
        </div>
        <div className="home-status">
          <h1 className="home-headline">{headline}</h1>
          <p className="home-detail">{detail}</p>
          <div className="home-actions">
            {!wake && (
              <Button variant="primary" icon={AudioLines} onClick={() => navigate('voice')}>
                Set up your voice
              </Button>
            )}
            {wake && !listening && (
              <Button variant="primary" icon={Radio} onClick={() => voice.setListening(true)}>
                Start listening
              </Button>
            )}
            {wake && listening && (
              <Button variant="primary" icon={Power} onClick={() => voice.wake()}>
                Wake JARVIS now
              </Button>
            )}
            <Button icon={MessageSquare} onClick={() => navigate('assistant')}>
              Ask JARVIS
            </Button>
          </div>
        </div>
      </Panel>

      <div className="home-side">
        <Panel title="Voice" meta={<span className="mono">{commandCount} command{commandCount === 1 ? '' : 's'}</span>}>
          <dl className="facts">
            <div>
              <dt>Wake phrase</dt>
              <dd>{wake ? `“${wake.phrase}”` : 'Not set'}</dd>
            </div>
            <div>
              <dt>Microphone</dt>
              <dd>
                <LevelMeter level={v.level} active={listening || v.capturing} />
              </dd>
            </div>
          </dl>
          {v.errorMessage && <p className="inline-error" role="alert">{v.errorMessage}</p>}
          <Toggle
            checked={v.enabled}
            disabled={!wake}
            onChange={(on) => voice.setListening(on)}
            label="Listen for my wake phrase"
            description={wake ? 'Runs on this PC only. Off by default.' : 'Set up your voice first.'}
          />
          <Button variant="ghost" size="sm" icon={AudioLines} onClick={() => navigate('voice')}>
            {wake ? 'Edit voice and commands' : 'Set up voice'}
          </Button>
        </Panel>

        <Panel title="System" tone="warn" meta={<span className="mono">local</span>}>
          <ul className="sysrows">
            <li>
              <span className="sysrow-name">JARVIS agent</span>
              <StatusPill tone="warn">{AGENT.agent === 'online' ? 'Online' : 'Not installed'}</StatusPill>
              <span className="sysrow-note">Reads CPU, memory, disk, network and Windows events.</span>
            </li>
            <li>
              <span className="sysrow-name">Local AI</span>
              <StatusPill tone="warn">Not connected</StatusPill>
              <span className="sysrow-note">Ollama on this PC explains findings in plain language.</span>
            </li>
            <li>
              <span className="sysrow-name">Cloud AI</span>
              <StatusPill tone="muted">Off</StatusPill>
              <span className="sysrow-note">Stays off unless you turn it on and approve what is sent.</span>
            </li>
            <li>
              <span className="sysrow-name">Last scan</span>
              <StatusPill tone="muted">Never</StatusPill>
              <span className="sysrow-note">Scans start from Diagnostics once the agent is installed.</span>
            </li>
          </ul>
        </Panel>
      </div>

      <Panel title="Heard" className="home-heard" meta={<span className="mono">this session</span>}>
        {v.heard.length > 0 ? (
          <HeardLog events={v.heard} />
        ) : (
          <Empty icon={AudioLines} title="Nothing heard yet">
            When listening is on, every phrase JARVIS hears shows up here with how well it matched your phrase and your voice, including
            the ones it ignored.
          </Empty>
        )}
      </Panel>
    </div>
  );
}
