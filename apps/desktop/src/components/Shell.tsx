import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AudioLines,
  Gauge,
  House,
  MessageSquare,
  Mic,
  MicOff,
  ScanSearch,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { navigate, type Route } from '../state/router';
import { useVoice } from '../state/useVoice';
import { voice, type VoiceState } from '../voice/engine';
import { AGENT } from '../state/agent';

const NAV: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: 'home', label: 'Home', icon: House },
  { route: 'assistant', label: 'Assistant', icon: MessageSquare },
  { route: 'voice', label: 'Voice', icon: AudioLines },
  { route: 'diagnostics', label: 'Diagnostics', icon: ScanSearch },
  { route: 'monitor', label: 'Monitor', icon: Gauge },
  { route: 'automation', label: 'Automation', icon: Workflow },
  { route: 'activity', label: 'Activity & safety', icon: ShieldCheck },
  { route: 'settings', label: 'Settings', icon: Settings },
];

function micSummary(v: VoiceState): { text: string; tone: 'live' | 'muted' | 'warn' } {
  if (v.status === 'blocked') return { text: 'Mic blocked', tone: 'warn' };
  if (v.status === 'unavailable' || v.status === 'error') return { text: 'No mic', tone: 'warn' };
  if (v.capturing) return { text: 'Recording sample', tone: 'live' };
  if (v.enabled && v.status === 'listening') return { text: 'Listening', tone: 'live' };
  if (v.enabled && v.status === 'starting') return { text: 'Starting mic', tone: 'muted' };
  return { text: 'Mic off', tone: 'muted' };
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function tickerItems(v: VoiceState): string[] {
  const wake = v.commands.find((c) => c.action === 'wake');
  const items = [
    wake ? `Wake phrase: "${wake.phrase}"` : 'Wake phrase: not set',
    v.enabled ? 'Voice listening: on (this device only)' : 'Voice listening: off',
    `Voice commands: ${v.commands.filter((c) => c.action !== 'wake').length}`,
    AGENT.agent === 'online' ? 'Agent: online' : 'Agent: not installed',
    'Local AI: not connected',
    'Cloud AI: off',
    'Diagnostics: no scans yet',
  ];
  const last = v.heard[0];
  if (last) {
    const when = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const what =
      last.outcome === 'accepted'
        ? `Heard "${last.phrase}" in your voice`
        : last.outcome === 'wrong-voice'
          ? 'Heard a command in a voice that is not yours: ignored'
          : last.outcome === 'too-long'
            ? 'Heard a long sentence: ignored'
            : 'Heard speech that is not one of your phrases';
    items.unshift(`${when} ${what}`);
  }
  return items;
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const v = useVoice();
  const clock = useClock();
  const mic = micSummary(v);
  const items = tickerItems(v);
  const micOn = v.enabled && v.status === 'listening';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="11" cy="11" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2.2" />
            <circle cx="11" cy="11" r="1.6" fill="currentColor" />
          </svg>
          <span className="brand-name">JARVIS</span>
          <span className="brand-sub mono">PC INTELLIGENCE</span>
        </div>
        <div className={`live-chip ${micOn || v.capturing ? 'is-live' : ''}`} aria-hidden="true">
          {micOn || v.capturing ? 'LIVE' : 'IDLE'}
        </div>
        <div className="ticker" aria-label="Status feed">
          <div className="ticker-track mono">
            {[...items, ...items].map((item, i) => (
              <span key={i} className="ticker-item" aria-hidden={i >= items.length}>
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className={`mic-indicator tone-${mic.tone}`}
            onClick={() => (v.enabled ? voice.setListening(false) : navigate('voice'))}
            aria-label={v.enabled ? `${mic.text}. Turn listening off` : `${mic.text}. Open voice setup`}
            title={v.enabled ? 'Turn listening off' : 'Voice setup'}
          >
            {micOn || v.capturing ? <Mic size={14} aria-hidden="true" /> : <MicOff size={14} aria-hidden="true" />}
            <span>{mic.text}</span>
          </button>
          <span className="clock mono" aria-label="Local time">
            {clock}
          </span>
        </div>
      </header>

      <nav className="rail" aria-label="Main">
        <ul>
          {NAV.map(({ route: r, label, icon: Icon }) => (
            <li key={r}>
              <a href={`#/${r}`} className={`rail-link ${route === r ? 'is-active' : ''}`} aria-current={route === r ? 'page' : undefined}>
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                <span className="rail-label">{label}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="rail-foot">
          <Activity size={14} aria-hidden="true" />
          <span>v0.1 · interface preview</span>
        </div>
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
