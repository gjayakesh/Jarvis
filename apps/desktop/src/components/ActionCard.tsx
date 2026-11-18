import { useEffect, useState } from 'react';
import { Check, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { Button, StatusPill, type Tone } from './ui';
import { approveAndRun, ago, rejectAction, rollbackAction, type ActionProposal } from '../state/agent';

const STATUS: Record<ActionProposal['status'], { label: string; tone: Tone }> = {
  AWAITING_APPROVAL: { label: 'Waiting for you', tone: 'warn' },
  AUTO_AUTHORIZED: { label: 'Safe fix allowed', tone: 'ok' },
  DENIED: { label: 'Not allowed', tone: 'muted' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  EXECUTING: { label: 'Running', tone: 'jarvis' },
  VERIFIED: { label: 'Done · verified', tone: 'ok' },
  NOT_VERIFIED: { label: 'Done · not verified', tone: 'warn' },
  FAILED: { label: 'Failed', tone: 'bad' },
  EXPIRED: { label: 'Expired', tone: 'muted' },
  CANCELLED: { label: 'Declined', tone: 'muted' },
  ROLLED_BACK: { label: 'Undone', tone: 'muted' },
  ROLLBACK_FAILED: { label: 'Undo failed', tone: 'bad' },
};

/**
 * One proposed change (spec §12.4). Approval sends back the exact argument hash
 * that was shown, so a changed or expired proposal cannot be approved by accident.
 */
export function ActionCard({ action, onChange }: { action: ActionProposal; onChange?: (a: ActionProposal) => void }) {
  const [a, setA] = useState(action);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(() => Math.max(0, new Date(action.expires_at).getTime() - Date.now()));
  useEffect(() => setA(action), [action]);
  const waiting = a.status === 'AWAITING_APPROVAL' || a.status === 'AUTO_AUTHORIZED' || a.status === 'APPROVED';

  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setLeft(Math.max(0, new Date(a.expires_at).getTime() - Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [waiting, a.expires_at]);

  const run = async (fn: (x: ActionProposal) => Promise<ActionProposal>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn(a);
      setA(next);
      onChange?.(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const s = STATUS[a.status];
  const expired = waiting && left === 0;
  return (
    <article className={`action risk-${a.risk_class.toLowerCase()}`} aria-labelledby={`act-${a.action_id}`}>
      <header className="action-head">
        <StatusPill tone={expired ? 'muted' : s.tone}>{expired ? 'Expired' : s.label}</StatusPill>
        <h3 id={`act-${a.action_id}`} className="action-title">
          {a.title}
        </h3>
        <span className="mono action-risk" title="Risk class from the spec: R1 safe and reversible, R2 changes settings, R3 never automatic">
          {a.risk_class}
        </span>
      </header>
      <p className="action-what">{a.approval_copy.action}</p>
      <dl className="action-facts">
        <div>
          <dt>Affects</dt>
          <dd>{a.approval_copy.affects}</dd>
        </div>
        <div>
          <dt>Undo</dt>
          <dd>{a.approval_copy.undo}</dd>
        </div>
        {a.reason && (
          <div>
            <dt>Why</dt>
            <dd>{a.reason}</dd>
          </div>
        )}
      </dl>
      {a.approval_copy.needs_admin_prompt && waiting && (
        <p className="action-note">
          <ShieldAlert size={14} aria-hidden="true" /> Windows will ask for administrator permission. JARVIS cannot answer that prompt for you.
        </p>
      )}
      {a.result?.summary && <p className="action-result">{a.result.summary}</p>}
      {a.verification?.summary && (
        <p className={`action-verify tone-${a.verification.verified ? 'ok' : 'warn'}`}>Check: {a.verification.summary}</p>
      )}
      {a.result?.rollback && <p className="action-result">{a.result.rollback}</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="action-actions">
        {waiting && !expired && (
          <>
            <Button variant="primary" size="sm" icon={Check} disabled={busy} onClick={() => void run(approveAndRun)}>
              {busy ? 'Running…' : a.status === 'AWAITING_APPROVAL' ? 'Approve and run' : 'Run'}
            </Button>
            <Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={() => void run(rejectAction)}>
              Decline
            </Button>
            <span className="mono field-hint">expires in {Math.ceil(left / 1000)} s</span>
          </>
        )}
        {a.can_rollback && (
          <Button size="sm" icon={RotateCcw} disabled={busy} onClick={() => void run(rollbackAction)}>
            Undo
          </Button>
        )}
        <span className="mono field-hint action-hash" title="Approval is bound to this exact tool version and arguments">
          {a.tool_id} v{a.tool_version} · {a.argument_hash.slice(7, 19)} · {ago(a.created_at)}
        </span>
      </div>
    </article>
  );
}
