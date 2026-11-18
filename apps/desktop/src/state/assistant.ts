import { useSyncExternalStore } from 'react';
import { perform, type Outcome } from './skills';
import { api, getAgentStatus, refreshAgentStatus, type AssistantAnswer, type Fact } from './agent';

/**
 * Conversation for this window only (spec FR-009). Everyday requests (time,
 * timers, maths, opening apps…) are answered on the spot. Questions about the
 * PC go to the JARVIS agent, which answers from real evidence and lists it.
 * Without the agent, JARVIS says so honestly and never invents measurements.
 */
export interface Turn {
  id: number;
  role: 'user' | 'jarvis';
  text: string;
  at: number;
  kind?: 'status';
  facts?: Fact[];
  limitations?: string[];
  provider?: string;
  pending?: boolean;
}

let turns: Turn[] = [];
let nextId = 1;
let conversationId: string | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const OFFLINE_REPLY =
  "I can't check your PC right now: the JARVIS agent that reads it isn't running. I can still tell you the time, set timers and reminders, do quick maths, open apps and websites, and search the web.";

/** Add an exchange to the conversation (used for voice requests and alerts too). */
export function record(user: string | null, jarvis: string, kind?: Turn['kind'], extra: Partial<Turn> = {}): number {
  const at = Date.now();
  const added: Turn[] = [];
  if (user) added.push({ id: nextId++, role: 'user', text: user, at });
  const id = nextId++;
  added.push({ id, role: 'jarvis', text: jarvis, at, kind, ...extra });
  turns = [...turns, ...added].slice(-100);
  emit();
  return id;
}

function update(id: number, patch: Partial<Turn>): void {
  turns = turns.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

/** Ask the agent a question about the PC. Null when the agent is not available. */
export async function askPc(text: string): Promise<AssistantAnswer | null> {
  // The status may be stale (JARVIS starts hidden while the agent boots): check again first.
  if (getAgentStatus().agent !== 'online') await refreshAgentStatus();
  if (getAgentStatus().agent !== 'online') return null;
  try {
    const answer = await api<AssistantAnswer>('/assistant/turns', { method: 'POST', body: { text, conversation_id: conversationId }, timeoutMs: 150_000 });
    conversationId = answer.conversation_id;
    return answer;
  } catch {
    return null;
  }
}

/**
 * Answer something the built-in skills did not understand: from the agent when it
 * runs (as a pending turn that fills in), otherwise the honest offline reply.
 * Resolves with the text JARVIS should say.
 */
export async function answerPcQuestion(text: string, opts: { showUser: boolean }): Promise<string> {
  const pendingId = record(opts.showUser ? text : null, 'Checking your PC…', undefined, { pending: true });
  const answer = await askPc(text);
  if (!answer) {
    update(pendingId, { text: OFFLINE_REPLY, kind: 'status', pending: false });
    return OFFLINE_REPLY;
  }
  update(pendingId, { text: answer.answer, facts: answer.facts, limitations: answer.limitations, provider: answer.provider, pending: false });
  return answer.answer;
}

/** A typed message: handled like a spoken one, but answered in text. */
export function send(text: string): void {
  const clean = text.trim();
  if (!clean) return;
  const outcome: Outcome = perform(clean);
  if (outcome.intent.kind === 'unknown') {
    void answerPcQuestion(clean, { showUser: true });
    return;
  }
  turns = [...turns, { id: nextId++, role: 'user', text: clean, at: Date.now() }];
  emit();
  window.setTimeout(() => record(null, outcome.say), 250);
}

export function clearConversation(): void {
  turns = [];
  conversationId = undefined;
  emit();
}

export function useConversation(): Turn[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => turns,
  );
}
