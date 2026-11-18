import { FileSearch, History, Play } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader, StatusPill } from '../components/ui';
import { AGENT_MISSING } from '../state/agent';

/** Scan profiles from the spec (§11.2). Durations are the spec's targets. */
const PROFILES = [
  { id: 'quick_health', name: 'Quick health', checks: 'Windows, CPU, memory, free space, top processes, recent critical events, basic network', time: '10–30 s' },
  { id: 'performance', name: 'Performance', checks: 'CPU, memory, disk and process trends, startup impact, temperatures if available', time: '1–3 min' },
  { id: 'network', name: 'Network', checks: 'Adapter, IP address, router, DNS and HTTPS checks', time: '15–60 s' },
  { id: 'stability', name: 'Stability', checks: 'Blue screens, hardware errors, unexpected shutdowns, app crashes, driver events', time: '15–90 s' },
  { id: 'hardware', name: 'Hardware', checks: 'Inventory, temperature sensors, drive health, battery report', time: '30–120 s' },
  { id: 'full', name: 'Full system', checks: 'Everything above, over a limited time window', time: '2–5 min' },
];

export function Diagnostics() {
  return (
    <div className="screen">
      <ScreenHeader title="Diagnostics">Run a check and JARVIS explains what it found, with the evidence behind every finding.</ScreenHeader>

      <div className="diag-grid">
        <Panel title="Scans" className="diag-scans" meta={<StatusPill tone="muted">Agent not installed</StatusPill>}>
          <ul className="profiles">
            {PROFILES.map((p, i) => (
              <li key={p.id} className="profile">
                <div className="profile-text">
                  <span className="profile-name">{p.name}</span>
                  <span className="profile-checks">{p.checks}</span>
                </div>
                <span className="profile-time mono">{p.time}</span>
                <Button variant={i === 0 ? 'primary' : 'secondary'} size="sm" icon={Play} disabled title={AGENT_MISSING}>
                  Run
                </Button>
              </li>
            ))}
          </ul>
          <p className="field-hint">Scans only read information. Nothing on your PC is changed without your approval.</p>
        </Panel>

        <Panel title="Findings" className="diag-findings">
          <Empty icon={FileSearch} title="No findings yet">
            Each finding will show what was found in plain words, how serious it is, how sure JARVIS is, the measurements and events behind it, and
            the safest next step.
          </Empty>
        </Panel>

        <Panel title="History" className="diag-history">
          <Empty icon={History} title="No scans yet">
            Past scans and their results will be kept here for 180 days, so you can see what changed.
          </Empty>
        </Panel>
      </div>
    </div>
  );
}
