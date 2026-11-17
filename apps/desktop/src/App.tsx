import { useEffect, useState } from 'react';
import { Shell } from './components/Shell';
import { WakeOverlay } from './components/WakeOverlay';
import { navigate, useRoute, type Route } from './state/router';
import { voice } from './voice/engine';
import type { CommandAction } from './voice/matcher';
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

const RESPONSES: Record<Exclude<CommandAction, 'wake'>, { route?: Route; say: string }> = {
  'open-home': { route: 'home', say: 'Opening home.' },
  'open-assistant': { route: 'assistant', say: 'Opening the assistant.' },
  'open-monitor': { route: 'monitor', say: 'Opening the monitor.' },
  'open-diagnostics': { route: 'diagnostics', say: 'Opening diagnostics.' },
  'start-quick-scan': { route: 'diagnostics', say: "I can't scan yet. The JARVIS agent isn't installed." },
  'open-activity': { route: 'activity', say: 'Opening activity and safety.' },
  'stop-listening': { say: 'Okay.' },
};

/** In the Tauri shell this will also restore and focus the native window. */
function bringToFront() {
  try {
    window.focus();
  } catch {
    /* not allowed in this context */
  }
}

export function App() {
  const route = useRoute();
  const [pulseKey, setPulseKey] = useState(0);
  const Screen = SCREENS[route];

  useEffect(() => {
    // Resume listening if the user left it on last time.
    if (voice.getState().enabled) void voice.setListening(true);
    return voice.onCommand((action) => {
      if (action === 'wake') {
        bringToFront();
        setPulseKey((k) => k + 1);
        voice.speak("Yes? I'm listening.");
        return;
      }
      const response = RESPONSES[action];
      if (response.route) navigate(response.route);
      voice.speak(response.say);
      if (action !== 'stop-listening') voice.sleep();
    });
  }, []);

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
