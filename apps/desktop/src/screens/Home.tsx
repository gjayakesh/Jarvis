import { AudioLines, MessageSquare, Power, Radio } from 'lucide-react';
import { Core, type CoreInput } from '../components/Core';
import { Button, Empty, LevelMeter, Panel, StatusPill, Toggle } from '../components/ui';
import { HeardLog } from '../components/HeardLog';
import { useVoice } from '../state/useVoice';
import { navigate } from '../state/router';
import { voice } from '../voice/engine';
import { agentMissingText, ago, formatRate, useAgentStatus, usePoll, type Metrics, type ScanSession } from '../state/agent';
import { useProfile } from '../state/profile';
import { partOfDay } from '../voice/intents';
import { count } from '../state/perf';

export function Home() {
  count('homeRenders');
  const v = useVoice();
  const profile = useProfile();
  const wake = v.commands.find((c) => c.action === 'wake');
  const listening = v.enabled && v.status === 'listening';
  const commandCount = v.commands.filter((c) => c.action !== 'wake').length;
  const agent = useAgentStatus();
  const online = agent.agent === 'online';
  const m = usePoll<Metrics>(online ? '/metrics/current' : null, 10_000).data;
  const lastScan = usePoll<{ sessions: ScanSession[] }>(online ? '/diagnostics/sessions?limit=1' : null, 60_000).data?.sessions[0];
  const model = agent.health?.model;

  const inputs: CoreInput[] = [
    {
      id: 'voice',
      label: 'Voice',
      detail: listening ? 'Listening' : wake ? 'Set up · off' : 'Not set up',
      state: listening ? 'live' : wake ? 'idle' : 'missing',
    },
    m
      ? { id: 'cpu', label: 'CPU', detail: `${m.cpu_percent.toFixed(0)}% busy`, state: 'live' }
      : { id: 'cpu', label: 'CPU', detail: 'No data', state: 'missing' },
    m
      ? { id: 'memory', label: 'Memory', detail: `${m.memory_used_percent.toFixed(0)}% used`, state: 'live' }
      : { id: 'memory', label: 'Memory', detail: 'No data', state: 'missing' },
    m && m.disk_busy_percent != null
      ? { id: 'disk', label: 'Disk', detail: `${m.disk_busy_percent.toFixed(0)}% active`, state: 'live' }
      : { id: 'disk', label: 'Disk', detail: 'No data', state: 'missing' },
    m && m.net_recv_bps != null
      ? { id: 'network', label: 'Network', detail: `${formatRate(m.net_recv_bps, true)} down`, state: 'live' }
      : { id: 'network', label: 'Network', detail: 'No data', state: 'missing' },
  ];

  let headline: string;
  let detail: string;
  if (!wake) {
    headline = 'JARVIS is ready to learn your voice.';
    detail = `Record a wake phrase so JARVIS answers only you.${online ? ' Live PC readings are wired into the core above.' : ' ' + agentMissingText(agent)}`;
  } else if (!listening) {
    headline = 'Your voice is set up. Listening is off.';
    detail = `Turn listening on and say “${wake.phrase}” to wake JARVIS. Nothing is recorded or sent anywhere.`;
  } else {
    const part = partOfDay(new Date());
    const hello = part === 'night' ? 'Hello' : `Good ${part}`;
    headline = `${hello}${profile.name ? `, ${profile.name}` : ''}. Say “${wake.phrase}” and I’ll answer.`;
    detail = `JARVIS is listening on this PC only and responds to your voice alone.${online ? ' Ask me why your PC is slow, or run a scan from Diagnostics.' : ' ' + agentMissingText(agent)}`;
  }

  return (
    <div className="home">
      <Panel
        title="JARVIS core"
        tone="jarvis"
        className="home-core"
        meta={<StatusPill tone={listening ? 'live' : 'muted'}>{listening ? 'Listening' : wake ? 'Asleep' : 'Voice not set up'}</StatusPill>}
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

        <Panel title="System" meta={<span className="mono">local</span>}>
          <ul className="sysrows">
            <li>
              <span className="sysrow-name">JARVIS agent</span>
              <StatusPill tone={online ? 'ok' : 'muted'}>{online ? 'Online' : agent.agent === 'not-installed' ? 'Not installed' : agent.agent === 'browser' ? 'Browser tab' : 'Offline'}</StatusPill>
              <span className="sysrow-note">{online ? 'Reading CPU, memory, disk, network and Windows events on this PC.' : agentMissingText(agent)}</span>
            </li>
            <li>
              <span className="sysrow-name">Local AI</span>
              <StatusPill tone={model?.installed ? 'ok' : 'muted'}>{!model ? 'Unknown' : model.runtime === 'offline' ? 'Not running' : model.installed ? 'Ready' : 'No model'}</StatusPill>
              <span className="sysrow-note">
                {model?.installed
                  ? `${model.model} on this PC explains findings in plain language.`
                  : model?.runtime === 'online'
                    ? `Ollama is running; the ${model.model} model is not downloaded yet.`
                    : 'Install Ollama to let JARVIS explain findings in plain language. It answers from its own rules until then.'}
              </span>
            </li>
            <li>
              <span className="sysrow-name">Cloud AI</span>
              <StatusPill tone="muted">Off</StatusPill>
              <span className="sysrow-note">Stays off unless you turn it on and approve what is sent.</span>
            </li>
            <li>
              <span className="sysrow-name">Last scan</span>
              <StatusPill tone={lastScan?.status === 'completed' ? 'ok' : 'muted'}>{lastScan ? ago(lastScan.created_at) : 'Never'}</StatusPill>
              <span className="sysrow-note">
                {lastScan?.status === 'completed'
                  ? `${lastScan.label}: ${lastScan.summary.findings ?? 0} item${lastScan.summary.findings === 1 ? '' : 's'} found.`
                  : online
                    ? 'Run a Quick Health scan from Diagnostics.'
                    : 'Scans start from Diagnostics once the agent is running.'}
              </span>
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
