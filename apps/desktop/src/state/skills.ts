import { cleanName, describeDuration, greeting, reply, searchUrl, understand, whenText, youtubeUrl, type Intent } from '../voice/intents';
import { voice } from '../voice/engine';
import { navigate } from './router';
import { hideWindow, hosted, openApp, openInstalled, openUrl } from './platform';
import { getProfile, updateProfile } from './profile';
import { addAlert, cancelAlerts, getAlerts, type Alert } from './timers';
import { api, getAgentStatus, proposeAction, rollbackAction, setModelLoaded, type ActionProposal } from './agent';
import { notify } from './notify';

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
      setModelLoaded(false);
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
      if (getAgentStatus().agent === 'online') {
        say = "Starting a quick health scan. It takes about half a minute; I'll show the results in Diagnostics.";
        void api<{ session_id: string }>('/diagnostics/sessions', { method: 'POST', body: { profile: 'quick_health', reason: 'voice_request' } })
          .then(({ session_id }) => reportWhenDone(session_id))
          .catch(() => voice.speak('A scan is already running.'));
      }
      break;
    case 'power':
      navigate('activity');
      if (getAgentStatus().agent === 'online') {
        void proposeAction('power.shutdown_restart', { mode: intent.mode, delay_seconds: 60 }, 'You asked by voice').catch(() => voice.speak('I could not prepare that.'));
      } else {
        say = "I can't do that right now: the JARVIS agent isn't running.";
      }
      break;
    case 'cancel-power':
      say = 'Cancelling the scheduled restart.';
      void api<{ actions: ActionProposal[] }>('/actions?limit=20')
        .then(({ actions }) => {
          const scheduled = actions.find((a) => a.tool_id === 'power.shutdown_restart' && a.can_rollback);
          if (!scheduled) return voice.speak("I don't have a restart or shutdown scheduled.");
          return rollbackAction(scheduled).then((r) => voice.speak(r.status === 'ROLLED_BACK' ? 'Cancelled. Nothing will restart.' : 'I could not cancel it. Run shutdown slash a.'));
        })
        .catch(() => voice.speak('I could not reach the JARVIS agent.'));
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
    case 'open-installed':
      if (hosted || intent.fallbackUrl) {
        void openInstalled(intent.name, intent.fallbackUrl).then(({ ok }) => {
          if (!ok) voice.speak(`Sorry, I couldn't find an app called ${intent.label} on this PC. You can say search for ${intent.name}.`);
        });
      }
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

/** Say (and notify) the result of a scan started by voice once it finishes. */
async function reportWhenDone(sessionId: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => window.setTimeout(r, 3000));
    const s = await api<{ status: string; summary: { findings?: number; by_severity?: Record<string, number> } }>(`/diagnostics/sessions/${sessionId}`).catch(() => null);
    if (!s || s.status === 'queued' || s.status === 'running') continue;
    const n = s.summary.findings ?? 0;
    const serious = (s.summary.by_severity?.high ?? 0) + (s.summary.by_severity?.critical ?? 0);
    const say =
      s.status !== 'completed'
        ? 'The scan could not finish.'
        : n === 0
          ? 'The quick health scan is done and found nothing that needs attention.'
          : `The scan is done. I found ${n} thing${n === 1 ? '' : 's'} to look at${serious ? `, ${serious} of them serious` : ''}. The details are in Diagnostics.`;
    voice.speak(say);
    notify('Quick health scan finished', say, 'jarvis-scan');
    return;
  }
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
