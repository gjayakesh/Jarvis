import { useEffect, useState } from 'react';
import { Download, FileSearch, History, Loader2, Play } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader, StatusPill } from '../components/ui';
import { FindingCard } from '../components/FindingCard';
import { agentMissingText, ago, api, AgentError, streamSse, useAgentStatus, usePoll, type ScanSession } from '../state/agent';

/** Scan profiles from the spec (§11.2). Durations are the spec's targets. */
const PROFILES = [
  { id: 'quick_health', name: 'Quick health', checks: 'Windows, CPU, memory, GPU, free space, top processes, recent critical events, drivers, security, basic network', time: '10–30 s' },
  { id: 'performance', name: 'Performance', checks: 'CPU, memory, GPU, disk and process trends, boot time, startup apps, recent events', time: '15–40 s' },
  { id: 'network', name: 'Network', checks: 'Adapter, router, packet loss, DNS and HTTPS checks', time: '60–80 s' },
  { id: 'stability', name: 'Stability', checks: 'Blue screens, hardware errors, unexpected shutdowns, app crashes, display driver resets (7 days)', time: '15–40 s' },
  { id: 'hardware', name: 'Hardware', checks: 'Drive health, GPU temperature, battery wear, Bluetooth, audio, devices and services', time: '15–40 s' },
  { id: 'full', name: 'Full system', checks: 'Everything above', time: '1–2 min' },
];

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export function Diagnostics() {
  const s = useAgentStatus();
  const online = s.agent === 'online';
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = usePoll<{ sessions: ScanSession[] }>(online ? '/diagnostics/sessions?limit=12' : null, 8000);
  const sessions = list.data?.sessions ?? [];
  const running = sessions.find((x) => x.status === 'queued' || x.status === 'running');
  const shownId = selected ?? running?.session_id ?? sessions[0]?.session_id ?? null;
  const detail = usePoll<ScanSession>(shownId ? `/diagnostics/sessions/${shownId}` : null, running?.session_id === shownId ? 8000 : 60_000);

  // Live progress while a scan runs (SSE); polling above is only the fallback.
  useEffect(() => {
    if (!running) return;
    const ctrl = new AbortController();
    void streamSse(`/diagnostics/sessions/${running.session_id}/events`, { signal: ctrl.signal }, (event) => {
      if (event === 'collector.progress') detail.reload();
      if (event === 'session.completed') {
        detail.reload();
        list.reload();
      }
    }).catch(() => undefined);
    return () => ctrl.abort();
  }, [running?.session_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = detail.data?.session_id === shownId ? detail.data : null;

  // When a running scan finishes, refresh the list once.
  useEffect(() => {
    if (shown && shown.status === 'completed' && running?.session_id === shown.session_id) list.reload();
  }, [shown?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (profile: string) => {
    setError(null);
    setStarting(profile);
    try {
      const r = await api<{ session_id: string }>('/diagnostics/sessions', { method: 'POST', body: { profile } });
      setSelected(r.session_id);
      list.reload();
    } catch (err) {
      setError(err instanceof AgentError && err.code === 'RATE_LIMITED' ? 'A scan is already running. Wait for it to finish.' : (err as Error).message);
    } finally {
      setStarting(null);
    }
  };

  const findings = [...(shown?.findings ?? [])].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const busy = !!running || !!starting;

  return (
    <div className="screen">
      <ScreenHeader title="Diagnostics">Run a check and JARVIS explains what it found, with the evidence behind every finding.</ScreenHeader>

      <div className="diag-grid">
        <Panel
          title="Scans"
          className="diag-scans"
          meta={<StatusPill tone={online ? 'ok' : 'muted'}>{online ? 'Agent ready' : s.agent === 'browser' ? 'Browser tab' : 'Agent offline'}</StatusPill>}
        >
          {!online && <p className="muted">{agentMissingText(s)}</p>}
          <ul className="profiles">
            {PROFILES.map((p, i) => (
              <li key={p.id} className="profile">
                <div className="profile-text">
                  <span className="profile-name">{p.name}</span>
                  <span className="profile-checks">{p.checks}</span>
                </div>
                <span className="profile-time mono">{p.time}</span>
                <Button
                  variant={i === 0 ? 'primary' : 'secondary'}
                  size="sm"
                  icon={starting === p.id || running?.profile === p.id ? Loader2 : Play}
                  disabled={!online || busy}
                  onClick={() => void run(p.id)}
                  aria-label={`Run ${p.name} scan`}
                >
                  {running?.profile === p.id ? 'Running' : 'Run'}
                </Button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <p className="field-hint">Scans only read information. Nothing on your PC is changed without your approval.</p>
        </Panel>

        <Panel
          title="Findings"
          className="diag-findings"
          meta={shown ? <span className="mono">{shown.label} · {ago(shown.created_at)}</span> : undefined}
        >
          {!shown ? (
            <Empty icon={FileSearch} title="No findings yet">
              Run a scan. Each finding shows what was found in plain words, how serious it is, how sure JARVIS is, the measurements and events behind it,
              and the safest next step.
            </Empty>
          ) : shown.status !== 'completed' ? (
            <ScanProgress session={shown} />
          ) : (
            <>
              <ScanSummary session={shown} />
              {findings.length === 0 ? (
                <Empty icon={FileSearch} title="Nothing needs attention">
                  None of the {shown.summary.rules_evaluated?.length ?? 0} checks that ran found a problem. The list below says what this version cannot check yet.
                </Empty>
              ) : (
                <div className="findings">
                  {findings.map((f) => (
                    <FindingCard key={f.finding_id} f={f} />
                  ))}
                </div>
              )}
              <NotChecked session={shown} />
              <ExportRow sessionId={shown.session_id} />
            </>
          )}
        </Panel>

        <Panel title="History" className="diag-history" meta={<History size={14} aria-hidden="true" />}>
          {sessions.length === 0 ? (
            <Empty icon={History} title="No scans yet">
              Past scans and their results are kept for 180 days, so you can see what changed.
            </Empty>
          ) : (
            <ul className="history">
              {sessions.map((x) => (
                <li key={x.session_id}>
                  <button type="button" className={`history-item ${x.session_id === shownId ? 'is-active' : ''}`} onClick={() => setSelected(x.session_id)}>
                    <span>{x.label}</span>
                    <span className="mono muted">{x.status === 'completed' ? `${x.summary.findings ?? 0} found` : x.status}</span>
                    <span className="mono muted">{ago(x.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

const STEP_LABEL: Record<string, string> = {
  'system.psutil': 'CPU, memory, drives and apps',
  'sampler.windows': 'Recent trends',
  'windows.probe': 'Windows events, drivers, security and services',
  'network.probes': 'Router, DNS and internet checks',
  'gpu.nvidia': 'Graphics card temperature and load',
  'windows.sfc_result': 'Last system file check',
  rules: 'Checking the rules',
};

function ScanProgress({ session }: { session: ScanSession }) {
  return (
    <div className="scan-progress" role="status" aria-live="polite">
      <p className="muted">{session.status === 'failed' ? `The scan failed${session.summary.error ? ` (${session.summary.error})` : ''}.` : `${session.label} scan running…`}</p>
      <ul className="steps">
        {session.progress.map((p) => (
          <li key={p.collector_id} className={`step is-${p.status}`}>
            <span className="mono">{p.status === 'done' ? 'DONE' : p.status === 'error' ? 'ERROR' : 'RUN'}</span>
            <span>{STEP_LABEL[p.collector_id] ?? p.collector_id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScanSummary({ session }: { session: ScanSession }) {
  const by = session.summary.by_severity ?? {};
  const unavailable = session.summary.unavailable_evidence ?? [];
  return (
    <div className="scan-summary">
      <p className="mono muted">
        {session.summary.rules_evaluated?.length ?? 0} checks ran in {session.summary.seconds ?? '?'} s ·{' '}
        {SEVERITY_ORDER.filter((k) => by[k]).map((k) => `${by[k]} ${k}`).join(' · ') || 'no problems'}
      </p>
      {unavailable.length > 0 && <p className="field-hint">Could not collect: {unavailable.map((u) => `${u.type} (${u.reason})`).join('; ')}</p>}
    </div>
  );
}

function NotChecked({ session }: { session: ScanSession }) {
  const missing = Object.entries(session.summary.rules_not_available ?? {});
  if (missing.length === 0) return null;
  return (
    <details className="not-checked">
      <summary>Not checked in this version ({missing.length})</summary>
      <ul>
        {missing.map(([id, why]) => (
          <li key={id}>
            <span className="mono">{id}</span> {why}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ExportRow({ sessionId }: { sessionId: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportAs = async (format: 'html' | 'json') => {
    setError(null);
    try {
      const r = await api<{ path: string; content: string }>('/exports', { method: 'POST', body: { session_id: sessionId, format } });
      setSaved(r.path);
      const blob = new Blob([r.content], { type: format === 'html' ? 'text/html' : 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = r.path.split(/[\\/]/).pop() ?? `jarvis-report.${format}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="export-row">
      <Button size="sm" icon={Download} onClick={() => void exportAs('html')}>
        Export report (HTML)
      </Button>
      <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportAs('json')}>
        JSON
      </Button>
      <span className="field-hint">Usernames, PC name, paths, IP and MAC addresses and serial numbers are removed.</span>
      {saved && <span className="field-hint">Saved a copy to {saved}</span>}
      {error && <span className="inline-error">{error}</span>}
    </div>
  );
}
