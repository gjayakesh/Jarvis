import { useEffect, useState } from 'react';
import { Shell } from './components/Shell';
import { WakeOverlay } from './components/WakeOverlay';
import { navigate, useRoute, type Route } from './state/router';
import { voice } from './voice/engine';
import { hideWindow, isWindowShown, onWindowShownChange, showWindow, startHeartbeat } from './state/platform';
import type { CommandAction } from './voice/text';
import { record } from './state/assistant';
import { perform, ringText, wakeGreeting } from './state/skills';
import { startAlerts } from './state/timers';
import { getProfile } from './state/profile';
import { takePerf } from './state/perf';
import { Home } from './screens/Home';
import { Assistant } from './screens/Assistant';
import { VoiceScreen } from './screens/Voice';
import { Diagnostics } from './screens/Diagnostics';
import { Monitor } from './screens/Monitor';
import { Automation } from './screens/Automation';
import { ActivitySafety } from './screens/Activity';
import { SettingsScreen } from './screens/Settings';

const SCREENS: Record<Route, () => React.JSX.Element> = {
  home: Home,
  assistant: Assistant,
  voice: VoiceScreen,
  diagnostics: Diagnostics,
  monitor: Monitor,
  automation: Automation,
  activity: ActivitySafety,
  settings: SettingsScreen,
};

/** Replies to the commands the user recorded on the Voice screen. */
const RESPONSES: Record<Exclude<CommandAction, 'wake'>, { route?: Route; say: (n: string) => string }> = {
  'open-home': { route: 'home', say: () => 'Here’s your home screen.' },
  'open-assistant': { route: 'assistant', say: () => 'Sure, opening the assistant.' },
  'open-monitor': { route: 'monitor', say: () => 'Opening the monitor.' },
  'open-diagnostics': { route: 'diagnostics', say: () => 'Here are your diagnostics.' },
  'start-quick-scan': { route: 'diagnostics', say: () => "I can't scan your PC yet. The JARVIS agent isn't installed." },
  'open-activity': { route: 'activity', say: () => 'Opening activity and safety.' },
  'stop-listening': { say: () => 'Okay.' },
  'hide-jarvis': { say: (n) => `Goodbye${n}. Just say my name when you need me.` },
};

export function App() {
  const route = useRoute();
  const [pulseKey, setPulseKey] = useState(0);
  const Screen = SCREENS[route];

  useEffect(() => {
    // Resume listening if the user left it on last time.
    if (voice.getState().enabled) void voice.setListening(true);
    // Closing or hiding the window ends a conversation (the wake phrase still works).
    // A hidden window also stops redrawing the screens for every mic-level change.
    const offShown = onWindowShownChange(() => {
      const shown = isWindowShown();
      voice.setUiQuiet(!shown);
      if (!shown) voice.sleep();
    });
    // Timers, alarms and reminders set by voice: say them out loud when due.
    startAlerts((alert) => {
      const say = ringText(alert);
      void showWindow();
      record(null, say);
      voice.speak(say);
    });
    const offCommand = voice.onCommand((action, _command, text, { followUp }) => {
      if (action === 'request') {
        // Anything said after the wake phrase that is not a recorded command: answer it like a smart speaker.
        const inConversation = voice.getState().conversation;
        const outcome = perform(text);
        if (outcome.intent.kind === 'unknown' && inConversation) {
          // In a conversation the owner may also be talking to someone else: ignore
          // fragments ("okay", "hmm"), and keep the "can't do that" answer short.
          if (text.trim().split(/\s+/).length < 3) return;
          const short = "Sorry, I can't do that yet. Try saying search for, and then your question.";
          record(text, short, 'status');
          voice.speak(short);
          return;
        }
        record(text, outcome.say, outcome.intent.kind === 'unknown' ? 'status' : undefined);
        voice.speak(outcome.say, { listenAfter: outcome.listen });
        return;
      }
      if (action === 'wake') {
        void showWindow();
        setPulseKey((k) => k + 1);
        // "Hey Jarvis, what time is it": skip the greeting and just answer.
        if (followUp) return;
        const hello = wakeGreeting();
        voice.speak(hello.say, { listenAfter: hello.listen });
        return;
      }
      const response = RESPONSES[action];
      const name = getProfile().name;
      if (response.route) navigate(response.route);
      voice.speak(response.say(name ? `, ${name}` : ''));
      // Outside a conversation a command ends the listening window; inside one, JARVIS keeps listening.
      if (action !== 'stop-listening' && !voice.getState().conversation) voice.sleep();
      if (action === 'hide-jarvis') window.setTimeout(() => void hideWindow(), 2600);
    });
    return () => {
      offCommand();
      offShown();
    };
  }, []);

  useEffect(
    () =>
      startHeartbeat(() => {
        const s = voice.getState();
        return {
          ready: true,
          status: s.status,
          enabled: s.enabled,
          chunks: voice.chunksReceived,
          backgroundDb: s.backgroundDb,
          wake: s.commands.find((c) => c.action === 'wake')?.phrase ?? null,
          commands: s.commands.filter((c) => c.action !== 'wake').map((c) => `${c.phrase} -> ${c.action}`),
          models: s.models,
          shown: isWindowShown(),
          perf: takePerf(),
          voiceprintSamples: s.voiceprint?.embeddings.length ?? 0,
          heard: s.heard.slice(0, 6).map((h) => ({
            at: new Date(h.at).toLocaleTimeString(),
            outcome: h.outcome,
            text: h.text,
            phrase: h.phrase,
            phraseScore: Math.round(h.phraseScore * 100),
            voiceScore: Math.round(h.voiceScore * 100),
            detail: h.detail,
          })),
        };
      }),
    [],
  );

  useEffect(() => {
    document.title = `JARVIS · ${route[0].toUpperCase()}${route.slice(1)}`;
    document.getElementById('main')?.scrollTo({ top: 0 });
  }, [route]);

  return (
    <>
      <Shell route={route}>
        <Screen key={route} />
      </Shell>
      <WakeOverlay pulseKey={pulseKey} />
    </>
  );
}
