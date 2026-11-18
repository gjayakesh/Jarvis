import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { ago, proposeAction, type ActionProposal, type Finding } from '../state/agent';
import { Button, StatusPill, type Tone } from './ui';
import { ActionCard } from './ActionCard';

const SEVERITY_TONE: Record<Finding['severity'], Tone> = { critical: 'bad', high: 'bad', medium: 'warn', low: 'muted', info: 'muted' };

/** One finding (spec §6.2): severity apart from confidence, facts with source and age. */
export function FindingCard({ f }: { f: Finding }) {
  const [proposal, setProposal] = useState<ActionProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fix = async (toolId: string, args: Record<string, unknown>) => {
    setError(null);
    try {
      setProposal(await proposeAction(toolId, args, f.title, [f.finding_id]));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <article className={`finding sev-${f.severity}`} aria-labelledby={`f-${f.finding_id}`}>
      <header className="finding-head">
        <StatusPill tone={SEVERITY_TONE[f.severity]}>{f.severity}</StatusPill>
        <h3 id={`f-${f.finding_id}`} className="finding-title">
          {f.title}
        </h3>
        <span className="finding-conf mono" title="How sure JARVIS is, from the evidence (not from AI)">
          {Math.round(f.confidence * 100)}% sure
        </span>
      </header>
      <p className="finding-statement">{f.statement}</p>
      {f.facts.length > 0 && (
        <dl className="finding-facts">
          {f.facts.map((x, i) => (
            <div key={i}>
              <dt>{x.label}</dt>
              <dd>
                <span className="mono">{String(x.value)}</span>
                <span className="finding-source">
                  {x.source} · {ago(x.observed_at)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {f.likely_causes.length > 0 && (
        <div className="finding-causes">
          <span className="finding-label">Possible causes</span>
          <ul>
            {f.likely_causes.map((c, i) => (
              <li key={i}>
                {c.name} <span className="mono muted">{Math.round(c.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="finding-next">
        <span className="finding-label">Next step</span> {f.next_step}
      </p>
      {f.limitations.length > 0 && <p className="field-hint">{f.limitations.join(' ')}</p>}
      {!proposal && f.suggested_actions && f.suggested_actions.length > 0 && (
        <div className="finding-fixes">
          {f.suggested_actions.map((a, i) => (
            <Button key={i} size="sm" icon={Wrench} onClick={() => void fix(a.tool_id, a.arguments)}>
              {a.title}
              {typeof a.arguments.name === 'string' ? `: ${a.arguments.name}` : ''}
            </Button>
          ))}
          <span className="field-hint">Nothing changes until you approve it.</span>
        </div>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {proposal && <ActionCard action={proposal} onChange={setProposal} />}
      <p className="finding-rule mono">
        {f.rule_id} v{f.rule_version}
      </p>
    </article>
  );
}
