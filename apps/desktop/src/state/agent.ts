import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hosted, hostToken, isWindowShown, onWindowShownChange } from './platform';

/**
 * Client for the local JARVIS agent (apps/agent, spec §7 and §9), reached through
 * the background host at /api/v1. The host adds the agent's own token; the page
 * only ever holds the host token. In a plain browser tab there is no agent.
 */

export type ServiceStatus = 'not-installed' | 'offline' | 'online';

export interface ModelStatus {
  runtime: 'online' | 'offline';
  model: string;
  installed: boolean;
  models: string[];
}

export interface Health {
  status: 'ok';
  version: string;
  sampler: { running: boolean; last_sample: string | null };
  model: ModelStatus;
  scan_running: boolean;
}

export interface Fact {
  label: string;
  value: string | number;
  source: string;
  observed_at: string | null;
  evidence_id: string;
}

export interface Finding {
  finding_id: string;
  session_id: string;
  rule_id: string;
  rule_version: string;
  category: string;
  title: string;
  statement: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  status: string;
  facts: Fact[];
  likely_causes: { name: string; confidence: number }[];
  next_step: string;
  limitations: string[];
  created_at: string;
  suggested_actions?: SuggestedAction[];
}

export interface ScanSession {
  session_id: string;
  profile: string;
  label: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: { collector_id: string; status: string; message: string }[];
  summary: {
    findings?: number;
    by_severity?: Record<string, number>;
    rules_evaluated?: string[];
    rules_not_available?: Record<string, string>;
    unavailable_evidence?: { type: string; reason: string }[];
    seconds?: number;
    error?: string;
  };
  created_at: string;
  finished_at: string | null;
  findings?: Finding[];
}

export interface Metrics {
  observed_at: string;
  freshness_seconds: number;
  cpu_percent: number;
  memory_used_percent: number;
  memory_available_bytes: number;
  disk_busy_percent: number | null;
  disk_read_bps: number | null;
  disk_write_bps: number | null;
  net_recv_bps: number | null;
  net_sent_bps: number | null;
  sources: Record<string, string>;
}

export interface ProcessRow {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_bytes: number;
}

export interface HistoryPoint {
  t: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  net_recv: number | null;
  net_sent: number | null;
}

export interface AssistantAnswer {
  conversation_id: string;
  answer: string;
  facts: Fact[];
  hypotheses: { name: string; confidence: number; finding: string }[];
  limitations: string[];
  provider: string;
  ms: number;
}

export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  if (!hosted) throw new AgentError('NOT_HOSTED', 'JARVIS is running in a browser tab, without its agent.', 0);
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { 'x-jarvis-token': hostToken ?? '', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!res.ok) throw new AgentError(data.code ?? 'INTERNAL_ERROR', data.message ?? `Agent error ${res.status}`, res.status);
    return data as T;
  } catch (err) {
    if (err instanceof AgentError) throw err;
    throw new AgentError('COLLECTOR_UNAVAILABLE', 'The JARVIS agent is not responding.', 0);
  } finally {
    window.clearTimeout(timer);
  }
}

// ---- agent status (shared, polled while the window is shown) --------------------

export interface AgentStatus {
  agent: ServiceStatus | 'browser';
  health: Health | null;
  message: string | null;
}

let status: AgentStatus = { agent: hosted ? 'offline' : 'browser', health: null, message: null };
const statusListeners = new Set<() => void>();
let pollTimer = 0;

async function refreshStatus(): Promise<void> {
  if (!hosted) return;
  try {
    const health = await api<Health>('/health', { timeoutMs: 6000 });
    status = { agent: 'online', health, message: null };
  } catch (err) {
    const e = err as AgentError;
    status = { agent: /not installed/i.test(e.message) ? 'not-installed' : 'offline', health: null, message: e.message };
  }
  statusListeners.forEach((l) => l());
}

function schedulePoll(): void {
  window.clearTimeout(pollTimer);
  if (!hosted || !isWindowShown()) return;
  pollTimer = window.setTimeout(async () => {
    await refreshStatus();
    schedulePoll();
  }, status.agent === 'online' ? 15_000 : 4_000);
}

if (hosted) {
  void refreshStatus().then(schedulePoll);
  onWindowShownChange(() => {
    if (isWindowShown()) void refreshStatus().then(schedulePoll);
    else window.clearTimeout(pollTimer);
  });
}

export function getAgentStatus(): AgentStatus {
  return status;
}

export function useAgentStatus(): AgentStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
  );
}

export function refreshAgentStatus(): Promise<void> {
  return refreshStatus();
}

/** Plain-language reason a data surface is empty. */
export function agentMissingText(s: AgentStatus): string {
  if (s.agent === 'browser') return 'JARVIS is running in a browser tab, so the PC agent is not available here.';
  if (s.agent === 'not-installed') return 'The JARVIS agent is not installed yet, so there is no PC data to show.';
  if (s.agent === 'offline') return 'The JARVIS agent is starting or not responding, so there is no PC data right now.';
  return '';
}

// ---- polling hook for live data ------------------------------------------------------

/** Poll an agent endpoint while the window is shown and the agent is online. */
export function usePoll<T>(path: string | null, everyMs: number): { data: T | null; error: string | null; reload: () => void } {
  const s = useAgentStatus();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path || s.agent !== 'online') return;
    let timer = 0;
    const load = async () => {
      try {
        const next = await api<T>(path);
        if (alive.current) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (alive.current) setError((err as Error).message);
      }
      if (alive.current && isWindowShown()) timer = window.setTimeout(load, everyMs);
    };
    void load();
    return () => window.clearTimeout(timer);
  }, [path, everyMs, s.agent, tick]);

  return { data, error, reload: () => setTick((t) => t + 1) };
}

export const formatBytes = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '--';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(n / 1024)} KB`;
};

export const formatRate = (bps: number | null | undefined, bits = false): string => {
  if (bps === null || bps === undefined) return '--';
  if (bits) {
    const mbps = (bps * 8) / 1e6;
    return mbps >= 10 ? `${mbps.toFixed(0)} Mb/s` : `${mbps.toFixed(1)} Mb/s`;
  }
  const mb = bps / 1024 ** 2;
  return mb >= 10 ? `${mb.toFixed(0)} MB/s` : `${mb.toFixed(1)} MB/s`;
};

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ---- safe actions (spec §12) ------------------------------------------------------------

export interface ActionProposal {
  action_id: string;
  tool_id: string;
  tool_version: string;
  title: string;
  risk_class: 'R0' | 'R1' | 'R2' | 'R3';
  arguments: Record<string, unknown>;
  argument_hash: string;
  reason: string;
  status:
    | 'AWAITING_APPROVAL'
    | 'AUTO_AUTHORIZED'
    | 'DENIED'
    | 'APPROVED'
    | 'EXECUTING'
    | 'VERIFIED'
    | 'NOT_VERIFIED'
    | 'FAILED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'ROLLED_BACK'
    | 'ROLLBACK_FAILED';
  decision: 'auto_allowed' | 'approval_required' | 'denied';
  approval_copy: { action: string; what_it_does: string; affects: string; undo: string; needs_admin_prompt: boolean };
  result: { ok?: boolean; summary?: string; rollback?: string };
  verification: { verified?: boolean; summary?: string };
  can_rollback: boolean;
  created_at: string;
  expires_at: string;
  finished_at: string | null;
}

export interface SuggestedAction {
  tool_id: string;
  arguments: Record<string, unknown>;
  title: string;
  risk_class: string;
}

const actionListeners = new Set<() => void>();
/** Tell open screens that an action changed (so Activity refreshes at once). */
export function actionsChanged(): void {
  actionListeners.forEach((l) => l());
}
export function onActionsChanged(l: () => void): () => void {
  actionListeners.add(l);
  return () => actionListeners.delete(l);
}

export function proposeAction(tool_id: string, args: Record<string, unknown>, reason = '', findingIds: string[] = []): Promise<ActionProposal> {
  return api<ActionProposal>('/actions', { method: 'POST', body: { tool_id, arguments: args, reason, source_finding_ids: findingIds } }).finally(actionsChanged);
}

/** Approve exactly what was shown (its argument hash), then run it. */
export async function approveAndRun(a: ActionProposal): Promise<ActionProposal> {
  try {
    if (a.status === 'AWAITING_APPROVAL') await api<ActionProposal>(`/actions/${a.action_id}/approve`, { method: 'POST', body: { argument_hash: a.argument_hash } });
    return await api<ActionProposal>(`/actions/${a.action_id}/execute`, { method: 'POST', timeoutMs: 200_000 });
  } finally {
    actionsChanged();
  }
}

export function rejectAction(a: ActionProposal): Promise<ActionProposal> {
  return api<ActionProposal>(`/actions/${a.action_id}/reject`, { method: 'POST' }).finally(actionsChanged);
}

export function rollbackAction(a: ActionProposal): Promise<ActionProposal> {
  return api<ActionProposal>(`/actions/${a.action_id}/rollback`, { method: 'POST' }).finally(actionsChanged);
}
