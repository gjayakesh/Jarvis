import { CheckCircle2, ListChecks } from 'lucide-react';
import { Empty, Panel, ScreenHeader, StatusPill } from '../components/ui';
import { HeardLog } from '../components/HeardLog';
import { useVoice } from '../state/useVoice';

/** Risk classes from the spec (§12.1). */
const RISK = [
  { id: 'R0', name: 'Read only', tone: 'ok' as const, rule: 'Runs on its own.', example: 'Reading CPU use, checking events, testing DNS.' },
  { id: 'R1', name: 'Safe and reversible', tone: 'ok' as const, rule: 'Runs on its own only if you turn on “apply safe fixes”.', example: 'Clearing the DNS cache.' },
  { id: 'R2', name: 'Changes settings', tone: 'warn' as const, rule: 'Asks you every time and shows exactly what will change.', example: 'Restarting a service, changing DNS, repairing system files.' },
  { id: 'R3', name: 'Risky or destructive', tone: 'bad' as const, rule: 'Never automatic. JARVIS only guides you.', example: 'BIOS updates, formatting drives, deleting files.' },
];

export function ActivitySafety() {
  const v = useVoice();
  return (
    <div className="screen">
      <ScreenHeader title="Activity & safety">Everything JARVIS is asked to change waits here for your decision, and every action is recorded.</ScreenHeader>

      <div className="activity-grid">
        <Panel title="Waiting for you" meta={<span className="mono">0</span>}>
          <Empty icon={CheckCircle2} title="Nothing needs approval">
            When JARVIS proposes a change, you’ll see what it does, why, what it affects, how to undo it, and when the offer expires.
          </Empty>
        </Panel>

        <Panel title="How JARVIS decides" className="risk-panel">
          <ul className="risk">
            {RISK.map((r) => (
              <li key={r.id} className="risk-row">
                <StatusPill tone={r.tone}>{r.id}</StatusPill>
                <span className="risk-name">{r.name}</span>
                <span className="risk-rule">{r.rule}</span>
                <span className="risk-example">{r.example}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Voice activity" className="activity-log" meta={<span className="mono">this session</span>}>
          {v.heard.length > 0 ? (
            <HeardLog events={v.heard} />
          ) : (
            <Empty icon={ListChecks} title="No activity yet">
              Voice commands JARVIS answered or ignored appear here. Approvals and changes will be added once the agent is installed.
            </Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
