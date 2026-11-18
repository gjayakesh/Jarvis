import { useSyncExternalStore } from 'react';
import { voice } from '../voice/engine';

/**
 * What JARVIS knows about its owner, kept on this PC only: the name it greets
 * them with and how it sounds when it talks.
 */
export interface Profile {
  /** How JARVIS addresses the user ("" = not told yet). */
  name: string;
  /** Chosen speech voice (an installed Windows voice), or null for the default. */
  voiceURI: string | null;
  /** Speaking speed, 0.8 (slower) .. 1.2 (faster). */
  rate: number;
  /** JARVIS has asked for the user's name once already. */
  askedName: boolean;
  /** After waking, keep listening to every request until "goodbye" (instead of a few seconds). */
  keepListening: boolean;
  /** JARVIS has explained once how to end a conversation. */
  explainedGoodbye: boolean;
  /** Show Windows notifications for timers, reminders, alarms and finished scans. */
  notifications: boolean;
}

const KEY = 'jarvis.profile.v1';
const DEFAULTS: Profile = { name: '', voiceURI: null, rate: 1, askedName: false, keepListening: true, explainedGoodbye: false, notifications: true };

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULTS;
}

let profile = load();
const listeners = new Set<() => void>();
voice.setSpeechPrefs({ voiceURI: profile.voiceURI, rate: profile.rate });
voice.setKeepListening(profile.keepListening);

export function getProfile(): Profile {
  return profile;
}

export function updateProfile(patch: Partial<Profile>): void {
  profile = { ...profile, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* keep it in memory */
  }
  voice.setSpeechPrefs({ voiceURI: profile.voiceURI, rate: profile.rate });
  voice.setKeepListening(profile.keepListening);
  listeners.forEach((l) => l());
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => profile,
  );
}
