import { useSyncExternalStore } from 'react';
import { perform } from './skills';

/**
 * Conversation for this window only (spec FR-009). Everyday requests (time,
 * timers, maths, opening apps…) are answered on the spot. Questions about the
 * PC need the local AI; until it is connected, JARVIS says so honestly and
 * never invents measurements.
 */
export interface Turn {
  id: number;
  role: 'user' | 'jarvis';
  text: string;
  at: number;
  kind?: 'status';
}

let turns: Turn[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const OFFLINE_REPLY =
  "I can't answer that yet. The local AI (Ollama) and the JARVIS agent that reads your PC aren't connected, so I have no evidence to work from. I can already tell you the time, set timers and reminders, do quick maths, open apps and websites, and search the web.";

/** Add an exchange to the conversation (used for voice requests and alerts too). */
export function record(user: string | null, jarvis: string, kind?: Turn['kind']): void {
  const at = Date.now();
  const added: Turn[] = [];
  if (user) added.push({ id: nextId++, role: 'user', text: user, at });
  added.push({ id: nextId++, role: 'jarvis', text: jarvis, at, kind });
  turns = [...turns, ...added].slice(-100);
  emit();
}

/** A typed message: handled like a spoken one, but answered in text. */
export function send(text: string): void {
  const clean = text.trim();
  if (!clean) return;
  turns = [...turns, { id: nextId++, role: 'user', text: clean, at: Date.now() }];
  emit();
  const outcome = perform(clean);
  const unknown = outcome.intent.kind === 'unknown';
  window.setTimeout(() => {
    turns = [...turns, { id: nextId++, role: 'jarvis', text: unknown ? OFFLINE_REPLY : outcome.say, at: Date.now(), kind: unknown ? 'status' : undefined }];
    emit();
  }, 250);
}

export function clearConversation(): void {
  turns = [];
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
