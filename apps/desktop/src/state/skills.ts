import { cleanName, describeDuration, greeting, reply, searchUrl, understand, whenText, youtubeUrl, type Intent } from '../voice/intents';
import { voice } from '../voice/engine';
import { navigate } from './router';
import { hideWindow, hosted, openApp, openUrl } from './platform';
import { getProfile, updateProfile } from './profile';
import { addAlert, cancelAlerts, getAlerts, type Alert } from './timers';

/**
 * Carries out what the user asked for (by voice or typed) and returns what
 * JARVIS says back. Everything runs on this PC; web pages open only when the
 * user asks for a search, a site, the weather or something to play.
 */
export interface Outcome {
  intent: Intent;
  say: string;
  /** Keep listening after speaking, because JARVIS asked something. */
  listen: boolean;
}

let lastWakeAt: number | null = null;
/** JARVIS just asked for the user's name, so a bare "Jay" is the answer. */
let expectingName = false;

/** What JARVIS says when woken with just the wake phrase. */
export function wakeGreeting(): { say: string; listen: boolean } {
  const now = new Date();
  const { name, askedName, keepListening, explainedGoodbye } = getProfile();
  let say = greeting({ name, now, lastWakeAt });
  lastWakeAt = now.getTime();
  if (!name && !askedName) {
    updateProfile({ askedName: true });
    expectingName = true;
    say = `${say.replace(/ What can I do for you\?$/, '')} By the way, what should I call you?`;
  } else if (keepListening && !explainedGoodbye) {
    updateProfile({ explainedGoodbye: true });
    say = `${say} I'll keep listening until you say goodbye.`;
  }
  return { say, listen: true };
}

export function perform(text: string): Outcome {
  const now = new Date();
  let intent = understand(text, now);
  if (expectingName) {
    expectingName = false;
    const bare = cleanName(text.replace(/^(?:it'?s|i'?m|i am|just)\s+/i, ''));
    if (intent.kind === 'unknown' && bare && bare.split(' ').length <= 2) intent = { kind: 'set-name', name: bare };
  }
  const { name } = getProfile();
  const ctx = { name, now, canOpenApps: hosted };
  let { say, listen = false } = reply(intent, ctx);

  switch (intent.kind) {
    case 'sleep':
      voice.sleep();
      break;
    case 'hide':
      voice.sleep();
      window.setTimeout(() => void hideWindow(), 2600);
      break;
    case 'set-name':
      updateProfile({ name: intent.name, askedName: true });
      break;
    case 'open-screen':
      navigate(intent.screen);
      break;
    case 'quick-scan':
      navigate('diagnostics');
      break;
    case 'timer':
      addAlert({ kind: 'timer', label: intent.label, at: now.getTime() + intent.ms, durationMs: intent.ms });
      break;
    case 'reminder':
      addAlert({ kind: 'reminder', label: intent.text, at: intent.at });
      break;
    case 'alarm':
      addAlert({ kind: 'alarm', label: '', at: intent.at });
      break;
    case 'cancel-timers': {
      const n = cancelAlerts();
      say = n === 0 ? "You don't have any timers or reminders running." : n === 1 ? 'Done, I cancelled it.' : `Done, I cancelled all ${n}.`;
      break;
    }
    case 'list-timers':
      say = describeAlerts(getAlerts(), now);
      break;
    case 'open-app':
      if (hosted) {
        void openApp(intent.app).then((ok) => {
          if (!ok) voice.speak(`Sorry, I couldn't open ${intent.label}.`);
        });
      }
      break;
    case 'open-url':
      void openUrl(intent.url);
      break;
    case 'search':
      void openUrl(searchUrl(intent.query));
      break;
    case 'play':
      void openUrl(youtubeUrl(intent.query));
      break;
    case 'weather':
      void openUrl(searchUrl(intent.query));
      break;
    default:
      break;
  }
  return { intent, say, listen };
}

function describeAlerts(alerts: Alert[], now: Date): string {
  if (alerts.length === 0) return "You don't have any timers, alarms or reminders right now.";
  const parts = alerts.slice(0, 3).map((a) => {
    const left = describeDuration(Math.max(1000, Math.round((a.at - now.getTime()) / 1000) * 1000));
    if (a.kind === 'timer') return `your ${a.label ? `${a.label} ` : ''}timer has ${left} left`;
    if (a.kind === 'alarm') return `your alarm goes off ${whenText(a.at, now)}`;
    return `I'll remind you to ${a.label} ${whenText(a.at, now)}`;
  });
  const more = alerts.length > 3 ? ` And ${alerts.length - 3} more.` : '';
  return `${parts.join('; ')}.${more}`.replace(/^./, (c) => c.toUpperCase());
}

/** What JARVIS says when a timer, alarm or reminder is due. */
export function ringText(alert: Alert): string {
  const { name } = getProfile();
  const hey = name ? `${name}, ` : '';
  if (alert.kind === 'timer') {
    // "5 minute timer", not "5 minutes timer".
    const length = alert.durationMs ? describeDuration(alert.durationMs).replace(/(second|minute|hour)s\b/g, '$1') : '';
    const what = alert.label ? `${alert.label} timer` : length ? `${length} timer` : 'timer';
    return `${hey}your ${what} is done!`;
  }
  if (alert.kind === 'alarm') {
    const time = new Date(alert.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${name ? `Hey ${name}` : 'Hey'}, it's ${time}. This is your alarm.`;
  }
  return `${name ? `Hey ${name}` : 'Hey'}, here's your reminder: ${alert.label}.`;
}
