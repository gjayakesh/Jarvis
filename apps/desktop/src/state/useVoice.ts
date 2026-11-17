import { useSyncExternalStore } from 'react';
import { voice, type VoiceState } from '../voice/engine';

export function useVoice(): VoiceState {
  return useSyncExternalStore(voice.subscribe, voice.getState, voice.getState);
}

export const ACTION_LABELS: Record<import('../voice/matcher').CommandAction, string> = {
  wake: 'Wake JARVIS',
  'open-home': 'Open Home',
  'open-assistant': 'Open Assistant',
  'open-monitor': 'Open Monitor',
  'open-diagnostics': 'Open Diagnostics',
  'start-quick-scan': 'Start a quick scan',
  'open-activity': 'Open Activity & safety',
  'stop-listening': 'Go back to sleep',
};
