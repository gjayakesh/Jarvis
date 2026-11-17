import { useSyncExternalStore } from 'react';

/**
 * Conversation for this window only (spec FR-009). Until the local AI is
 * connected, JARVIS answers honestly that it cannot reason about the PC yet;
 * it never invents measurements.
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
  "I can't answer that yet. The local AI (Ollama) and the JARVIS agent that reads your PC aren't connected, so I have no evidence to work from. Voice commands, navigation and voice setup already work.";

export function send(text: string): void {
  const clean = text.trim();
  if (!clean) return;
  turns = [...turns, { id: nextId++, role: 'user', text: clean, at: Date.now() }];
  emit();
  window.setTimeout(() => {
    turns = [...turns, { id: nextId++, role: 'jarvis', text: OFFLINE_REPLY, at: Date.now(), kind: 'status' }];
    emit();
  }, 350);
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
