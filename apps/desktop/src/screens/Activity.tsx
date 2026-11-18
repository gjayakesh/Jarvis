import { useEffect, useState } from 'react';
import { CheckCircle2, ListChecks, Wrench } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader, StatusPill } from '../components/ui';
import { ActionCard } from '../components/ActionCard';
import { HeardLog } from '../components/HeardLog';
import { useVoice } from '../state/useVoice';
import { agentMissingText, onActionsChanged, proposeAction, useAgentStatus, usePoll, type ActionProposal } from '../state/agent';

/** Risk classes from the spec (§12.1). */
const RISK = [
  { id: 'R0', name: 'Read only', tone: 'ok' as const, rule: 'Runs on its own.', example: 'Reading CPU use, checking events, testing DNS.' },
  { id: 'R1', name: 'Safe and reversible', tone: 'ok' as const, rule: 'Runs on its own only if you turn on “apply safe fixes”.', example: 'Clearing the DNS cache.' },
  { id: 'R2', name: 'Changes settings', tone: 'warn' as const, rule: 'Asks you every time and shows exactly what will change.', example: 'Restarting a service, changing DNS, repairing system files.' },
  { id: 'R3', name: 'Risky or destructive', tone: 'bad' as const, rule: 'Never automatic. JARVIS only guides you.', example: 'BIOS updates, formatting drives, deleting files.' },
];

/** Pick a connected adapter and a DNS preset; becomes a proposal like every other fix. */
function DnsSwitcher({ onPropose }: { onPropose: (iface: string, servers: string) => void }) {
  const summary = usePoll<{ network_interfaces: { name: string; is_up: boolean }[] }>('/system/summary', 120_000);
  const adapters = (summary.data?.network_interfaces ?? []).filter((n) => n.is_up && !/^(vEthernet|Local Area Connection\*|Bluetooth)/i.test(n.name));
  const [iface, setIface] = useState('');
  const [servers, setServers] = useState('automatic');
  const chosen = iface || adapters[0]?.name || '';
  if (adapters.length === 0) return null;
  return (
    <div className="dns-switcher">
      <span className="finding-label">DNS servers</span>
      <div className="row">
        <label htmlFor="dns-iface" className="visually-hidden">
          Network adapter
        </label>
        <select id="dns-iface" className="input" value={chosen} onChange={(e) => setIface(e.target.value)}>
          {adapters.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <label htmlFor="dns-servers" className="visually-hidden">
          DNS servers
        </label>
        <select id="dns-servers" className="input" value={servers} onChange={(e) => setServers(e.target.value)}>
          <option value="automatic">Automatic (router)</option>
          <option value="cloudflare">Cloudflare 1.1.1.1</option>
          <option value="google">Google 8.8.8.8</option>
          <option value="quad9">Quad9 9.9.9.9</option>
        </select>
        <Button size="sm" disabled={!chosen} onClick={() => onPropose(chosen, servers)}>
          Change DNS
        </Button>
      </div>
    </div>
  );
}

export function ActivitySafety() {
  const v = useVoice();
  const agent = useAgentStatus();
  const online = agent.agent === 'online';
  const audit = usePoll<{ total: number; events: { at: string; kind: string; summary: string }[] }>(online ? '/audit?limit=25' : null, 30_000);
  const actions = usePoll<{ actions: ActionProposal[] }>(online ? '/actions?limit=20' : null, 10_000);
  const startup = usePoll<{ entries: { name: string; kind: string; enabled: boolean }[] }>(online ? '/startup' : null, 60_000);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const all = actions.data?.actions ?? [];
  const isWaiting = (a: ActionProposal) => (a.status === 'AWAITING_APPROVAL' || a.status === 'AUTO_AUTHORIZED') && new Date(a.expires_at).getTime() > Date.now();
  const waiting = all.filter(isWaiting);
  const recent = all.filter((a) => !isWaiting(a)).slice(0, 8);

  useEffect(() => onActionsChanged(() => {
    actions.reload();
    audit.reload();
    startup.reload();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const propose = async (tool: string, args: Record<string, unknown>, reason: string) => {
    setProposeError(null);
    try {
      await proposeAction(tool, args, reason);
    } catch (err) {
      setProposeError((err as Error).message);
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title="Activity & safety">Everything JARVIS is asked to change waits here for your decision, and every action is recorded.</ScreenHeader>

      <div className="activity-grid">
        <Panel title="Waiting for you" meta={<span className="mono">{waiting.length}</span>}>
          {waiting.length > 0 ? (
            <div className="actions">
              {waiting.map((a) => (
                <ActionCard key={a.action_id} action={a} onChange={() => actions.reload()} />
              ))}
            </div>
          ) : (
            <Empty icon={CheckCircle2} title="Nothing needs approval">
              When JARVIS proposes a change, you’ll see what it does, why, what it affects, how to undo it, and when the offer expires.
            </Empty>
          )}
        </Panel>

        <Panel title="Tools" meta={<Wrench size={14} aria-hidden="true" />}>
          {online ? (
            <>
              <p className="muted">Start a fix yourself. Each one shows exactly what it will do and waits for your approval.</p>
              <div className="row">
                <Button size="sm" onClick={() => void propose('network.flush_dns_cache', {}, 'Requested from Activity & safety')}>
                  Refresh DNS cache
                </Button>
                <Button size="sm" onClick={() => void propose('jarvis.clear_owned_cache', {}, 'Requested from Activity & safety')}>
                  Delete JARVIS report files
                </Button>
                <Button size="sm" onClick={() => void propose('power.shutdown_restart', { mode: 'restart', delay_seconds: 60 }, 'Requested from Activity & safety')}>
                  Restart PC (60 s)
                </Button>
                <Button size="sm" onClick={() => void propose('windows.run_sfc_dism', {}, 'Requested from Activity & safety')}>
                  Check system files
                </Button>
                <Button size="sm" onClick={() => void propose('driver.open_optional_updates', {}, 'Requested from Activity & safety')}>
                  Find driver updates
                </Button>
              </div>
              <DnsSwitcher onPropose={(iface, servers) => void propose('network.change_dns', { interface: iface, servers }, 'Requested from Activity & safety')} />
              {startup.data && startup.data.entries.length > 0 && (
                <div className="startup-list">
                  <span className="finding-label">Your startup apps</span>
                  <ul>
                    {startup.data.entries.map((e) => (
                      <li key={`${e.kind}-${e.name}`}>
                        <span>{e.name}</span>
                        <span className="mono muted">{e.enabled ? 'starts with Windows' : 'off'}</span>
                        {e.enabled && (
                          <Button size="sm" variant="ghost" onClick={() => void propose('startup.disable_entry', { name: e.name }, 'Requested from Activity & safety')}>
                            Turn off
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="field-hint">Only your own startup items are listed; turning one off does not remove the app, and Undo turns it back on.</p>
                </div>
              )}
              {proposeError && (
                <p className="inline-error" role="alert">
                  {proposeError}
                </p>
              )}
            </>
          ) : (
            <p className="muted">{agentMissingText(agent)}</p>
          )}
        </Panel>

        <Panel title="Recent actions" className="activity-log" meta={<span className="mono">{recent.length}</span>}>
          {recent.length > 0 ? (
            <div className="actions">
              {recent.map((a) => (
                <ActionCard key={a.action_id} action={a} onChange={() => actions.reload()} />
              ))}
            </div>
          ) : (
            <Empty icon={ListChecks} title="No actions yet">
              Approved, declined and expired actions appear here with what was checked afterwards, and Undo where it exists.
            </Empty>
          )}
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

        <Panel title="Audit trail" className="activity-log" meta={audit.data ? <span className="mono">{audit.data.total} recorded</span> : undefined}>
          {audit.data && audit.data.events.length > 0 ? (
            <table className="table">
              <caption className="visually-hidden">What the JARVIS agent did, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Kind</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.events.map((e, i) => (
                  <tr key={i}>
                    <td className="mono">{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{e.summary}</td>
                    <td className="mono muted">{e.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon={ListChecks} title="Nothing recorded yet">
              {agent.agent === 'online'
                ? 'Scans, exports and AI answers are recorded here. JARVIS makes no changes to your PC in this version.'
                : agentMissingText(agent)}
            </Empty>
          )}
        </Panel>

        <Panel title="Voice activity" className="activity-log" meta={<span className="mono">this session</span>}>
          {v.heard.length > 0 ? (
            <HeardLog events={v.heard} />
          ) : (
            <Empty icon={ListChecks} title="No voice activity yet">
              Voice commands JARVIS answered or ignored appear here.
            </Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
