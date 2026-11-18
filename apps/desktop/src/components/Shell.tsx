import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AudioLines,
  Gauge,
  House,
  MessageSquare,
  Mic,
  MicOff,
  Ellipsis,
  ScanSearch,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { navigate, type Route } from '../state/router';
import { useVoice } from '../state/useVoice';
import { voice, type VoiceState } from '../voice/engine';
import { useAgentStatus, type AgentStatus } from '../state/agent';
import { SunMark } from './SunMark';
import { count } from '../state/perf';

/** How many stations get their own tab on a phone; the rest sit under More. */
const PHONE_TABS = 5;

const NAV: { route: Route; label: string; short: string; icon: LucideIcon }[] = [
  { route: 'home', label: 'Home', short: 'Home', icon: House },
  { route: 'assistant', label: 'Assistant', short: 'Ask', icon: MessageSquare },
  { route: 'voice', label: 'Voice', short: 'Voice', icon: AudioLines },
  { route: 'diagnostics', label: 'Diagnostics', short: 'Scan', icon: ScanSearch },
  { route: 'monitor', label: 'Monitor', short: 'Monitor', icon: Gauge },
  { route: 'automation', label: 'Automation', short: 'Auto', icon: Workflow },
  { route: 'activity', label: 'Activity & safety', short: 'Safety', icon: ShieldCheck },
  { route: 'settings', label: 'Settings', short: 'Settings', icon: Settings },
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

function tickerItems(v: VoiceState, a: AgentStatus): string[] {
  const wake = v.commands.find((c) => c.action === 'wake');
  const items = [
    wake ? `Wake phrase: "${wake.phrase}"` : 'Wake phrase: not set',
    v.enabled ? 'Voice listening: on (this device only)' : 'Voice listening: off',
    `Voice commands: ${v.commands.filter((c) => c.action !== 'wake').length}`,
    a.agent === 'online' ? 'Agent: online' : a.agent === 'browser' ? 'Agent: not in browser tabs' : a.agent === 'not-installed' ? 'Agent: not installed' : 'Agent: offline',
    a.health?.model.installed ? `Local AI: ${a.health.model.model}` : a.health?.model.runtime === 'online' ? 'Local AI: no model yet' : 'Local AI: not running',
    'Cloud AI: off',
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
  count('shellRenders');
  const v = useVoice();
  const clock = useClock();
  const mic = micSummary(v);
  const agentStatus = useAgentStatus();
  const items = tickerItems(v, agentStatus);
  const micOn = v.enabled && v.status === 'listening';
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = NAV.slice(PHONE_TABS).some((n) => n.route === route);

  useEffect(() => setMoreOpen(false), [route]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <SunMark live={micOn || v.capturing} />
          <span className="brand-name">JARVIS</span>
          <span className="brand-sub mono">PC console</span>
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
          {NAV.map(({ route: r, label, short, icon: Icon }, i) => (
            <li key={r} className={i >= PHONE_TABS ? 'is-extra' : undefined}>
              <a href={`#/${r}`} className={`rail-link ${route === r ? 'is-active' : ''}`} aria-current={route === r ? 'page' : undefined}>
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                <span className="rail-label">{label}</span>
                <span className="rail-short" aria-hidden="true">
                  {short}
                </span>
              </a>
            </li>
          ))}
          {/* Phones show five tabs; the rest live under More. */}
          <li className="rail-more">
            <button
              type="button"
              className={`rail-link ${moreActive ? 'is-active' : ''}`}
              aria-expanded={moreOpen}
              aria-controls="more-sheet"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <Ellipsis size={18} strokeWidth={1.6} aria-hidden="true" />
              <span className="rail-short">More</span>
            </button>
          </li>
        </ul>
        {moreOpen && (
          <ul id="more-sheet" className="more-sheet" aria-label="More screens">
            {NAV.slice(PHONE_TABS).map(({ route: r, label, icon: Icon }) => (
              <li key={r}>
                <a
                  href={`#/${r}`}
                  className={`more-link ${route === r ? 'is-active' : ''}`}
                  aria-current={route === r ? 'page' : undefined}
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="rail-foot">
          <Activity size={14} aria-hidden="true" />
          <span>v0.2 · local only</span>
        </div>
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
