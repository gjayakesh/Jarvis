import { describe, expect, it } from 'vitest';
import { describeDuration, greeting, parseDuration, partOfDay, prep, reply, understand, whenText } from '../src/voice/intents';

// Wednesday 18 November 2026, 08:15 local time.
const now = new Date(2026, 10, 18, 8, 15, 0);
const kind = (text: string) => understand(text, now).kind;
const first = () => 0;

describe('greeting', () => {
  it('greets by name and time of day', () => {
    expect(greeting({ name: 'Jay', now, lastWakeAt: null, rand: first })).toBe('Good morning, Jay! What can I do for you?');
    expect(greeting({ name: 'Jay', now: new Date(2026, 10, 18, 14), lastWakeAt: null, rand: first })).toBe('Good afternoon, Jay! What can I do for you?');
    expect(greeting({ name: 'Jay', now: new Date(2026, 10, 18, 19), lastWakeAt: null, rand: first })).toBe('Good evening, Jay! What can I do for you?');
    expect(greeting({ name: 'Jay', now: new Date(2026, 10, 18, 1), lastWakeAt: null, rand: first })).toContain('up late');
  });

  it('works without a name', () => {
    expect(greeting({ name: '', now, lastWakeAt: null, rand: first })).toBe('Good morning! What can I do for you?');
  });

  it('is short when woken again soon after', () => {
    expect(greeting({ name: 'Jay', now, lastWakeAt: now.getTime() - 60_000, rand: first })).toBe('Yes, Jay?');
    expect(greeting({ name: 'Jay', now, lastWakeAt: now.getTime() - 3_600_000, rand: first })).toContain('Good morning');
  });

  it('knows the part of the day', () => {
    expect(partOfDay(new Date(2026, 0, 1, 4, 59))).toBe('night');
    expect(partOfDay(new Date(2026, 0, 1, 5))).toBe('morning');
    expect(partOfDay(new Date(2026, 0, 1, 12))).toBe('afternoon');
    expect(partOfDay(new Date(2026, 0, 1, 17))).toBe('evening');
    expect(partOfDay(new Date(2026, 0, 1, 22))).toBe('night');
  });
});

describe('understanding everyday requests', () => {
  it('prepares speech-to-text output', () => {
    expect(prep("What's 2.5 × 4?")).toBe('whats 2.5 times 4');
    expect(prep('Wake me at 7:30 p.m.')).toBe('wake me at 7:30 pm');
    expect(prep('Set a timer for 1,000 seconds.')).toBe('set a timer for 1000 seconds');
  });

  it('answers time and date', () => {
    expect(kind('What time is it?')).toBe('time');
    expect(kind('Jarvis, can you tell me the time please')).toBe('time');
    expect(kind("What's the date today?")).toBe('date');
    expect(kind('What day is it?')).toBe('date');
    expect(reply(understand('what time is it', now), { name: '', now, canOpenApps: true }).say).toBe("It's 8:15 AM.");
  });

  it('sets timers from words or digits', () => {
    expect(understand('Set a timer for 5 minutes.', now)).toEqual({ kind: 'timer', ms: 300_000, label: '' });
    expect(understand('set a timer for five minutes', now)).toMatchObject({ ms: 300_000 });
    expect(understand('timer for twenty five minutes', now)).toMatchObject({ ms: 25 * 60_000 });
    expect(understand('Start a 10 minute timer', now)).toMatchObject({ ms: 600_000, label: '' });
    expect(understand('set a pasta timer for 8 minutes', now)).toMatchObject({ ms: 480_000, label: 'pasta' });
    expect(understand('set a timer for 1 hour and 30 minutes', now)).toMatchObject({ ms: 90 * 60_000 });
    expect(understand('set a timer for half an hour', now)).toMatchObject({ ms: 30 * 60_000 });
    expect(understand('set a timer for an hour and a half', now)).toMatchObject({ ms: 90 * 60_000 });
    expect(understand('5 minutes', now)).toMatchObject({ kind: 'timer', ms: 300_000 });
    expect(understand('Set a timer.', now)).toEqual({ kind: 'ask', question: 'timer' });
    expect(kind('cancel the timer')).toBe('cancel-timers');
    expect(kind('how much time is left on my timer')).toBe('list-timers');
  });

  it('sets reminders and alarms', () => {
    expect(understand('Remind me to call mom in 10 minutes.', now)).toEqual({ kind: 'reminder', at: now.getTime() + 600_000, text: 'call mom' });
    expect(understand('remind me in 10 minutes to stretch', now)).toEqual({ kind: 'reminder', at: now.getTime() + 600_000, text: 'stretch' });
    expect(understand('remind me to check in at 5 pm', now)).toEqual({ kind: 'reminder', at: new Date(2026, 10, 18, 17).getTime(), text: 'check in' });
    expect(understand('Set an alarm for 7 a.m.', now)).toEqual({ kind: 'alarm', at: new Date(2026, 10, 19, 7).getTime() });
    expect(understand('wake me up at 9:30', now)).toEqual({ kind: 'alarm', at: new Date(2026, 10, 18, 9, 30).getTime() });
    expect(understand('set an alarm in 20 minutes', now)).toEqual({ kind: 'alarm', at: now.getTime() + 20 * 60_000 });
    expect(understand('at 6 pm', now)).toEqual({ kind: 'alarm', at: new Date(2026, 10, 18, 18).getTime() });
  });

  it('does quick maths', () => {
    expect(understand('What is 25 times 4?', now)).toMatchObject({ kind: 'math', result: 100 });
    expect(understand("what's 12 into 12", now)).toMatchObject({ result: 144 });
    expect(understand('100 divided by 8', now)).toMatchObject({ result: 12.5 });
    expect(understand('what is 20% of 150', now)).toMatchObject({ result: 30 });
    expect(understand('what is twenty plus seven', now)).toMatchObject({ result: 27 });
    expect(understand('square root of 81', now)).toMatchObject({ result: 9 });
    expect(reply(understand('what is 7 minus 10', now), { name: '', now, canOpenApps: true }).say).toBe('7 minus 10 is -3.');
    expect(kind('what is 5 divided by 0')).toBe('unknown');
  });

  it('opens screens, apps and websites', () => {
    expect(understand('Open notepad', now)).toMatchObject({ kind: 'open-app', app: 'notepad' });
    expect(understand('launch the calculator app', now)).toMatchObject({ kind: 'open-app', app: 'calculator' });
    expect(understand('open file explorer', now)).toMatchObject({ kind: 'open-app', app: 'explorer' });
    expect(understand('open windows settings', now)).toMatchObject({ kind: 'open-app', app: 'settings' });
    expect(understand('open settings', now)).toEqual({ kind: 'open-screen', screen: 'settings' });
    expect(understand('show me the monitor', now)).toEqual({ kind: 'open-screen', screen: 'monitor' });
    expect(understand('go home', now)).toEqual({ kind: 'open-screen', screen: 'home' });
    expect(understand('Open YouTube.', now)).toMatchObject({ kind: 'open-installed', fallbackUrl: 'https://www.youtube.com/' });
    expect(understand('open youtube.com', now)).toMatchObject({ kind: 'open-installed', label: 'YouTube' });
    expect(understand('open gmail', now)).toMatchObject({ kind: 'open-installed', label: 'Gmail', fallbackUrl: 'https://mail.google.com/' });
  });

  it('opens any installed app by name', () => {
    expect(understand('Okay open Microsoft store.', now)).toEqual({ kind: 'open-installed', name: 'microsoft store', label: 'Microsoft Store' });
    expect(understand('Open Microsoft Store app.', now)).toMatchObject({ kind: 'open-installed', name: 'microsoft store' });
    expect(understand('Can you open clock?', now)).toMatchObject({ kind: 'open-installed', name: 'clock' });
    expect(understand('Open Google Chrome.', now)).toMatchObject({ kind: 'open-installed', name: 'google chrome' });
    expect(understand('open notepad', now)).toMatchObject({ kind: 'open-app', app: 'notepad' });
  });

  it('understands "open X and search for Y"', () => {
    expect(understand('Then open google chrome and search for Netflix', now)).toEqual({ kind: 'search', query: 'netflix' });
    expect(understand('open youtube and play lofi beats', now)).toEqual({ kind: 'play', query: 'lofi beats' });
  });

  it('understands more ways to ask for a reminder', () => {
    const r = understand("Will you remind me of two o'clock about my meeting today?", now);
    expect(r).toMatchObject({ kind: 'reminder', text: 'my meeting today' });
    expect(new Date((r as { at: number }).at).getHours()).toBe(14);
    expect(understand('set a reminder at 5 pm to call mom', now)).toMatchObject({ kind: 'reminder', text: 'call mom' });
    expect(understand('Can you tell me my name?', now)).toEqual({ kind: 'get-name' });
  });

  it('searches, plays and checks the weather', () => {
    expect(understand('Search for best pizza near me', now)).toEqual({ kind: 'search', query: 'best pizza near me' });
    expect(understand('google how tall is mount everest', now)).toEqual({ kind: 'search', query: 'how tall is mount everest' });
    expect(understand('Play lo-fi music on YouTube', now)).toEqual({ kind: 'play', query: 'lo fi music' });
    expect(understand("What's the weather in Chennai?", now)).toEqual({ kind: 'weather', query: 'weather in chennai' });
    expect(understand('will it rain today', now)).toEqual({ kind: 'weather', query: 'weather' });
  });

  it('handles small talk like a friend', () => {
    expect(kind('Hello!')).toBe('greet');
    expect(kind('good morning jarvis')).toBe('greet');
    expect(kind('Good night')).toBe('good-night');
    expect(kind('How are you?')).toBe('how-are-you');
    expect(reply(understand('how are you', now), { name: 'Jay', now, canOpenApps: true, rand: first })).toEqual({
      say: "I'm doing great, Jay, thanks for asking! How about you?",
      listen: true,
    });
    expect(understand("I'm good, thanks", now)).toEqual({ kind: 'feeling', good: true });
    expect(understand("I'm tired", now)).toEqual({ kind: 'feeling', good: false });
    expect(kind('Thank you')).toBe('thanks');
    expect(kind('thats great thanks')).toBe('thanks');
    expect(kind('Who are you?')).toBe('who-are-you');
    expect(kind('What can you do?')).toBe('help');
    expect(kind('Tell me a joke')).toBe('joke');
    expect(kind('flip a coin')).toBe('coin');
    expect(kind('roll a dice')).toBe('dice');
  });

  it('learns and recalls the user’s name', () => {
    expect(understand('My name is jayakesh.', now)).toEqual({ kind: 'set-name', name: 'Jayakesh' });
    expect(understand('Call me Jay', now)).toEqual({ kind: 'set-name', name: 'Jay' });
    expect(kind('call mom')).toBe('unknown');
    expect(kind("what's my name")).toBe('get-name');
  });

  it('goes to sleep or hides', () => {
    expect(kind('Never mind.')).toBe('sleep');
    expect(kind('stop')).toBe('sleep');
    expect(kind('Goodbye Jarvis')).toBe('hide');
  });

  it('admits what it does not know', () => {
    expect(kind('What is the capital of France?')).toBe('unknown');
    expect(reply(understand('why is my pc slow', now), { name: 'Jay', now, canOpenApps: true, rand: first }).say).toContain('search for');
  });
});

describe('durations and times in speech', () => {
  it('parses and describes durations', () => {
    expect(parseDuration('a minute')).toBe(60_000);
    expect(parseDuration('90 seconds')).toBe(90_000);
    expect(parseDuration('nothing here')).toBeNull();
    expect(describeDuration(300_000)).toBe('5 minutes');
    expect(describeDuration(5_430_000)).toBe('1 hour, 30 minutes and 30 seconds');
  });

  it('says when something will happen', () => {
    expect(whenText(now.getTime() + 600_000, now)).toBe('in 10 minutes');
    expect(whenText(new Date(2026, 10, 18, 17).getTime(), now)).toBe('at 5:00 PM');
    expect(whenText(new Date(2026, 10, 19, 7).getTime(), now)).toBe('tomorrow at 7:00 AM');
  });
});

describe('restart and shutdown wait for approval', () => {
  it('recognises power requests and cancelling them', () => {
    expect(understand('Restart my PC', now)).toEqual({ kind: 'power', mode: 'restart' });
    expect(understand('shut down the computer', now)).toEqual({ kind: 'power', mode: 'shutdown' });
    expect(understand('cancel the restart', now)).toEqual({ kind: 'cancel-power' });
    expect(understand("don't shut down", now)).toEqual({ kind: 'cancel-power' });
    expect(kind('restart the timer')).not.toBe('power');
  });
});
