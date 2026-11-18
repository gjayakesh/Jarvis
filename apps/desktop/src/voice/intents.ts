/**
 * Everyday requests JARVIS understands without any setup, like a smart speaker:
 * "what time is it", "set a timer for 5 minutes", "open notepad", "tell me a joke".
 * Pure functions (no side effects, time and randomness passed in) so they are unit-tested.
 */

export type Screen = 'home' | 'assistant' | 'voice' | 'diagnostics' | 'monitor' | 'automation' | 'activity' | 'settings';

/** Programs the background host is allowed to start (see host/jarvis-host.mjs). */
export type AppId = 'notepad' | 'calculator' | 'explorer' | 'settings' | 'task-manager' | 'paint';

export type Intent =
  | { kind: 'sleep' }
  | { kind: 'hide' }
  | { kind: 'greet' }
  | { kind: 'good-night' }
  | { kind: 'how-are-you' }
  | { kind: 'feeling'; good: boolean }
  | { kind: 'thanks' }
  | { kind: 'who-are-you' }
  | { kind: 'help' }
  | { kind: 'set-name'; name: string }
  | { kind: 'get-name' }
  | { kind: 'time' }
  | { kind: 'date' }
  | { kind: 'timer'; ms: number; label: string }
  | { kind: 'reminder'; at: number; text: string }
  | { kind: 'alarm'; at: number }
  | { kind: 'ask'; question: 'timer' | 'alarm' | 'reminder' }
  | { kind: 'power'; mode: 'restart' | 'shutdown' }
  | { kind: 'cancel-power' }
  | { kind: 'cancel-timers' }
  | { kind: 'list-timers' }
  | { kind: 'math'; expression: string; result: number }
  | { kind: 'joke' }
  | { kind: 'coin' }
  | { kind: 'dice' }
  | { kind: 'open-screen'; screen: Screen }
  | { kind: 'quick-scan' }
  | { kind: 'open-app'; app: AppId; label: string }
  | { kind: 'open-url'; url: string; label: string }
  | { kind: 'search'; query: string }
  | { kind: 'play'; query: string }
  | { kind: 'weather'; query: string }
  | { kind: 'unknown'; text: string };

/**
 * Lowercase words, keeping digits with their decimal point or clock colon
 * and turning maths symbols into words: "What's 2.5 × 4?" -> "whats 2.5 times 4".
 */
export function prep(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(\d),(?=\d{3})/g, '$1')
    .replace(/(\d)\s*[x×*]\s*(\d)/g, '$1 times $2')
    .replace(/[×*]/g, ' times ')
    .replace(/÷/g, ' divided by ')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 divided by $2')
    .replace(/\+/g, ' plus ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 minus $2')
    .replace(/%/g, ' percent')
    .replace(/\b([ap])\.\s?m\b\.?/g, '$1m')
    .replace(/[^a-z0-9.:\s]/g, ' ')
    .replace(/(?<!\d)[.:]|[.:](?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Polite padding that changes nothing: "jarvis can you please tell me the time" -> "tell me the time". */
function strip(t: string): string {
  let s = t;
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/^(hey |ok |okay |so |um |uh |and )?(jarvis )?/, '')
      .replace(/^(can you |could you |would you |will you |please |i want you to |id like you to |i need you to )+/, '')
      .replace(/^(please )/, '')
      .replace(/( please| jarvis| for me| now)+$/, '')
      .trim();
  }
  return s;
}

// ---- numbers and durations ----------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORD = `(?:\\d+(?:\\.\\d+)?|(?:${Object.keys(TENS).join('|')})(?: (?:${Object.keys(UNITS).filter((w) => w !== 'a' && w !== 'an').join('|')}))?|${Object.keys(UNITS).join('|')}|a hundred|one hundred|half)`;

/** "25", "2.5", "twenty five", "a", "half" -> number, or null. */
export function parseNumber(word: string): number | null {
  const w = word.trim();
  if (/^\d+(\.\d+)?$/.test(w)) return Number(w);
  if (w === 'half') return 0.5;
  if (w === 'a hundred' || w === 'one hundred') return 100;
  if (w in UNITS) return UNITS[w];
  const [tens, unit] = w.split(' ');
  if (tens in TENS) return TENS[tens] + (unit ? (UNITS[unit] ?? NaN) : 0) || null;
  return null;
}

const UNIT_MS: Record<string, number> = { second: 1000, sec: 1000, minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000 };
const DURATION_PART = new RegExp(`\\b(${NUMBER_WORD}) (?:and a half )?(second|sec|minute|min|hour|hr)s?\\b(?: and a half)?`, 'g');
const BARE_DURATION = new RegExp(
  `^(?:for |in )?(?:(?:${NUMBER_WORD}) (?:and a half )?(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)(?: and a half)?(?: and )?)+$|^(?:for |in )?half an hour$`,
);

/** "1 hour and 30 minutes", "five minutes", "half an hour", "an hour and a half" -> ms, or null. */
export function parseDuration(text: string): number | null {
  if (/\bhalf an hour\b/.test(text)) return 30 * 60_000 + (parseDuration(text.replace(/\bhalf an hour\b/, '')) ?? 0);
  let total = 0;
  let found = false;
  for (const m of text.matchAll(DURATION_PART)) {
    const n = parseNumber(m[1]);
    if (n === null) continue;
    const half = m[0].includes('and a half') ? 0.5 : 0;
    total += (n + half) * UNIT_MS[m[2]];
    found = true;
  }
  return found && total > 0 ? Math.round(total) : null;
}

/** 300000 -> "5 minutes"; 5400000 -> "1 hour and 30 minutes". */
export function describeDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [
    h && `${h} hour${h === 1 ? '' : 's'}`,
    m && `${m} minute${m === 1 ? '' : 's'}`,
    sec && `${sec} second${sec === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return '0 seconds';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const CLOCK = `(\\d{1,2})(?:[:.](\\d{2}))? ?(am|pm|in the morning|in the evening|at night|tonight)?|noon|midnight`;

/** "7 am", "7:30 pm", "noon" after `now` (today, or tomorrow if already past) -> epoch ms. */
export function parseClock(text: string, now: Date): number | null {
  const m = text.match(new RegExp(`\\b(?:${CLOCK})\\b`));
  if (!m) return null;
  let hour: number;
  let minute = 0;
  if (m[0] === 'noon') hour = 12;
  else if (m[0] === 'midnight') hour = 0;
  else {
    hour = Number(m[1]);
    minute = m[2] ? Number(m[2]) : 0;
    if (hour > 23 || minute > 59) return null;
    const suffix = m[3];
    const pm = suffix === 'pm' || suffix === 'in the evening' || suffix === 'at night' || suffix === 'tonight';
    if (pm && hour < 12) hour += 12;
    if (suffix === 'am' || suffix === 'in the morning') hour %= 12;
    if (!suffix && hour <= 12) {
      // No am/pm: pick the next time that hour comes round.
      const candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() <= now.getTime() && hour < 12) hour += 12;
    }
  }
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

// ---- maths ----------------------------------------------------------------------

const OPS: [RegExp, string, (a: number, b: number) => number][] = [
  [/^(?:plus|add|and)$/, '+', (a, b) => a + b],
  [/^(?:minus|less|take away)$/, '-', (a, b) => a - b],
  [/^(?:times|multiplied by|into|x)$/, '×', (a, b) => a * b],
  [/^(?:divided by|over|by)$/, '÷', (a, b) => a / b],
];

function parseMath(t: string): { expression: string; result: number } | null {
  const num = `(-?\\d+(?:\\.\\d+)?|${NUMBER_WORD})`;
  const pct = t.match(new RegExp(`^(?:(?:whats|what is|calculate|how much is) )?${num} percent of ${num}$`));
  if (pct) {
    const a = parseNumber(pct[1]);
    const b = parseNumber(pct[2]);
    if (a !== null && b !== null) return { expression: `${a}% of ${b}`, result: (a / 100) * b };
  }
  const root = t.match(new RegExp(`^(?:(?:whats|what is|calculate) )?(?:the )?square root of ${num}$`));
  if (root) {
    const a = parseNumber(root[1]);
    if (a !== null && a >= 0) return { expression: `the square root of ${a}`, result: Math.sqrt(a) };
  }
  const bin = t.match(
    new RegExp(`^(?:(?:whats|what is|calculate|how much is|what does) )?${num} (plus|add|and|minus|less|take away|times|multiplied by|into|x|divided by|over|by) ${num}(?: equal| equals| make)?$`),
  );
  if (!bin) return null;
  const a = parseNumber(bin[1]);
  const b = parseNumber(bin[3]);
  const op = OPS.find(([re]) => re.test(bin[2]));
  if (a === null || b === null || !op) return null;
  if (op[1] === '÷' && b === 0) return null;
  return { expression: `${a} ${op[1]} ${b}`, result: op[2](a, b) };
}

/** 12.3456 -> "12.35"; 1e6 -> "1,000,000". */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ---- places JARVIS can open ------------------------------------------------------

const SCREENS: [RegExp, Screen][] = [
  [/^(?:the )?(?:home|dashboard|main)(?: screen| page)?$/, 'home'],
  [/^(?:the )?(?:assistant|chat)(?: screen| page)?$/, 'assistant'],
  [/^(?:the )?(?:voice|voice setup|voice settings)(?: screen| page)?$/, 'voice'],
  [/^(?:the )?diagnostics?(?: screen| page)?$/, 'diagnostics'],
  [/^(?:the )?(?:monitor|monitoring|system monitor)(?: screen| page)?$/, 'monitor'],
  [/^(?:the )?automations?(?: screen| page)?$/, 'automation'],
  [/^(?:the )?(?:activity|activity and safety|safety|history)(?: screen| page)?$/, 'activity'],
  [/^(?:the |your |jarvis )?settings(?: screen| page)?$/, 'settings'],
];

const APPS: [RegExp, AppId, string][] = [
  [/^(?:the )?(?:notepad|note pad|notes app)$/, 'notepad', 'Notepad'],
  [/^(?:the )?(?:calculator|calc)$/, 'calculator', 'the Calculator'],
  [/^(?:the )?(?:file explorer|files|my files|explorer|file manager|my computer|this pc|documents)$/, 'explorer', 'File Explorer'],
  [/^(?:the )?(?:windows|pc|system|computer) settings$/, 'settings', 'Windows Settings'],
  [/^(?:the )?task manager$/, 'task-manager', 'Task Manager'],
  [/^(?:ms )?paint$/, 'paint', 'Paint'],
];

const SITES: [RegExp, string, string][] = [
  [/^youtube$/, 'https://www.youtube.com/', 'YouTube'],
  [/^(?:google|the browser|browser|chrome|the internet|internet)$/, 'https://www.google.com/', 'Google'],
  [/^(?:gmail|my email|my mail|email|mail)$/, 'https://mail.google.com/', 'Gmail'],
  [/^(?:google )?maps$/, 'https://www.google.com/maps', 'Google Maps'],
  [/^github$/, 'https://github.com/', 'GitHub'],
  [/^wikipedia$/, 'https://en.wikipedia.org/', 'Wikipedia'],
  [/^amazon$/, 'https://www.amazon.com/', 'Amazon'],
  [/^netflix$/, 'https://www.netflix.com/', 'Netflix'],
  [/^spotify$/, 'https://open.spotify.com/', 'Spotify'],
  [/^whatsapp$/, 'https://web.whatsapp.com/', 'WhatsApp'],
  [/^instagram$/, 'https://www.instagram.com/', 'Instagram'],
  [/^linkedin$/, 'https://www.linkedin.com/', 'LinkedIn'],
  [/^facebook$/, 'https://www.facebook.com/', 'Facebook'],
  [/^reddit$/, 'https://www.reddit.com/', 'Reddit'],
  [/^(?:twitter|x)$/, 'https://x.com/', 'X'],
  [/^outlook$/, 'https://outlook.live.com/', 'Outlook'],
  [/^(?:google )?(?:calendar|my calendar)$/, 'https://calendar.google.com/', 'Google Calendar'],
  [/^(?:google )?drive$/, 'https://drive.google.com/', 'Google Drive'],
];

export const searchUrl = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
export const youtubeUrl = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

/** "jayakesh", "j k" -> "Jayakesh", "J K". Letters only, up to three words. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ---- understanding ---------------------------------------------------------------

/** What the user asked for, from what speech-to-text heard (or what they typed). */
export function understand(text: string, now: Date = new Date()): Intent {
  const raw = prep(text);
  const t = strip(raw);
  if (!t) return { kind: 'unknown', text };

  if (/^(?:stop|cancel|never ?mind|nothing|forget it|go to sleep|sleep|be quiet|quiet|shush|thats all|that s all|no|nope)$/.test(t)) return { kind: 'sleep' };
  if (/^(?:goodbye|good bye|bye|bye bye|see you|see you later|see ya|hide|hide yourself|go away|close|close yourself|close jarvis|minimi[sz]e)$/.test(t))
    return { kind: 'hide' };

  const name = t.match(/^(?:my name is|call me|you can call me|please call me) ([a-z][a-z ]{0,40})$/);
  if (name) {
    const clean = cleanName(name[1].replace(/\b(?:from now on|instead|please)\b/g, ''));
    if (clean) return { kind: 'set-name', name: clean };
  }
  if (/\b(?:whats my name|what is my name|who am i|do you know my name|do you know who i am)\b/.test(t)) return { kind: 'get-name' };

  // Restart / shutdown are never done directly: they become an action that waits for approval.
  if (/\b(?:cancel|stop|abort|don ?t)\b.*\b(?:restart|reboot|shut ?down|shutting down|restarting)\b/.test(t)) return { kind: 'cancel-power' };
  const power = t.match(/^(?:restart|reboot|shut ?down|turn off)(?: my| the)? (?:pc|computer|laptop|system)$/);
  if (power) return { kind: 'power', mode: /restart|reboot/.test(power[0]) ? 'restart' : 'shutdown' };

  // Timers, reminders and alarms (before "time").
  if (/\b(?:cancel|stop|delete|clear|remove|turn off)\b.*\b(?:timers?|reminders?|alarms?)\b/.test(t)) return { kind: 'cancel-timers' };
  if (/\b(?:how much time|how long)\b.*\b(?:left|remaining)\b|\b(?:what|any|check|show|list)( my)? (?:timers|reminders|alarms)\b/.test(t))
    return { kind: 'list-timers' };
  // "remind me in 10 minutes to stretch" or "remind me to stretch in 10 minutes" (the last "in"/"at" wins).
  const lead = t.match(/^remind me (in|at) (.+?) (?:to|about) (.+)$/);
  const tail = lead ? null : t.match(/^remind me (?:to |about )?(.+) (in|at) (.+)$/);
  const remind = lead ? { what: lead[3], when: lead[1], how: lead[2] } : tail ? { what: tail[1], when: tail[2], how: tail[3] } : null;
  if (remind) {
    const { what, when, how } = remind;
    const ms = when === 'in' ? parseDuration(how) : null;
    const at = when === 'in' ? (ms ? now.getTime() + ms : null) : parseClock(how, now);
    if (at && at > now.getTime()) return { kind: 'reminder', at, text: what.replace(/^to /, '') };
  }
  if (/\balarm\b|\bwake me\b/.test(t)) {
    const inDur = t.match(/\bin (.+)$/);
    const ms = inDur ? parseDuration(inDur[1]) : null;
    if (ms) return { kind: 'alarm', at: now.getTime() + ms };
    const at = parseClock(t.replace(/^.*?\b(?:for|at)\b/, ''), now);
    if (at) return { kind: 'alarm', at };
  }
  if (/\btimer\b|\bcount ?down\b/.test(t)) {
    const ms = parseDuration(t);
    if (ms) {
      const label = t.match(/\b(?:for (?:the |my )?)?([a-z]+) timer\b/)?.[1];
      const named = label && !/^(?:a|the|my|minute|second|hour|minutes|seconds|hours)$/.test(label) && !(label in UNITS) && !(label in TENS);
      return { kind: 'timer', ms, label: named ? label : '' };
    }
  }

  // A bare answer to "for how long?" / "for what time?".
  if (BARE_DURATION.test(t)) {
    const ms = parseDuration(t);
    if (ms) return { kind: 'timer', ms, label: '' };
  }
  if (/^(?:for |at )?(?:\d{1,2}(?:[:.]\d{2})? ?(?:am|pm)|noon|midnight)$/.test(t)) {
    const at = parseClock(t, now);
    if (at) return { kind: 'alarm', at };
  }
  if (/\btimer\b/.test(t)) return { kind: 'ask', question: 'timer' };
  if (/\balarm\b/.test(t)) return { kind: 'ask', question: 'alarm' };
  if (/^remind me\b/.test(t)) return { kind: 'ask', question: 'reminder' };

  const math = parseMath(t);
  if (math) return { kind: 'math', ...math };

  if (/\b(?:what time|the time|time is it|time now|current time)\b/.test(t)) return { kind: 'time' };
  if (/\b(?:whats the date|what is the date|todays date|what date|what day|which day|the date today|date today)\b/.test(t)) return { kind: 'date' };

  if (/\b(?:weather|forecast|temperature outside|going to rain|is it raining|will it rain)\b/.test(t))
    return { kind: 'weather', query: /\bweather\b/.test(t) ? t.replace(/^(?:whats|what is|how is|hows|tell me|show me|check) (?:the )?/, '') : 'weather' };
  if (/\b(?:joke|make me laugh|something funny|cheer me up)\b/.test(t)) return { kind: 'joke' };
  if (/\b(?:flip a coin|coin flip|toss a coin|heads or tails)\b/.test(t)) return { kind: 'coin' };
  if (/\broll (?:a |the )?(?:die|dice)\b/.test(t)) return { kind: 'dice' };
  if (/\b(?:quick scan|scan my (?:pc|computer|system)|run a scan|start a scan|check my (?:pc|computer))\b/.test(t)) return { kind: 'quick-scan' };

  const play = t.match(/^play (.+?)(?: on youtube)?$/);
  if (play) return { kind: 'play', query: play[1] };
  const search = t.match(/^(?:search|google|look up|search for|search the web for|search google for|search online for|find)(?: for)? (.+)$/);
  if (search) return { kind: 'search', query: search[1].replace(/ on (?:google|the web|the internet)$/, '') };

  if (/^go (?:back )?home$/.test(t)) return { kind: 'open-screen', screen: 'home' };
  const open = t.match(/^(?:open|launch|start|run|show(?: me)?|go to|switch to|take me to|bring up|pull up)(?: up)? (.+)$/);
  if (open) {
    const target = open[1].replace(/ (?:app|application|program|website|site|for me)$/, '');
    const screen = SCREENS.find(([re]) => re.test(target));
    if (screen) return { kind: 'open-screen', screen: screen[1] };
    const app = APPS.find(([re]) => re.test(target));
    if (app) return { kind: 'open-app', app: app[1], label: app[2] };
    const site = SITES.find(([re]) => re.test(target.replace(/ (?:com|org|in|co in|co uk)$/, '')));
    if (site) return { kind: 'open-url', url: site[1], label: site[2] };
  }

  if (/\b(?:good ?night|going to bed|off to bed)\b/.test(t)) return { kind: 'good-night' };
  if (/\b(?:how are you|hows it going|how is it going|how do you do|how are things|how have you been|you doing ok|hows your day)\b/.test(t)) return { kind: 'how-are-you' };
  if (/^(?:im|i am|i m|feeling|i feel)? ?(?:good|fine|great|ok|okay|well|awesome|alright|not bad|pretty good|doing (?:good|well|great|fine|ok|okay))(?: too| thanks| thank you)?$/.test(t))
    return { kind: 'feeling', good: true };
  if (/^(?:im|i am|i m|feeling|i feel) (?:tired|sad|bored|stressed|exhausted|sick|bad|not (?:good|great|well|ok|okay)|down|upset)\b/.test(t))
    return { kind: 'feeling', good: false };
  if (/\b(?:thank|thanks|thx|cheers|appreciate it|good job|well done|nice work)\b/.test(t)) return { kind: 'thanks' };
  if (/\b(?:who are you|what are you|whats your name|what is your name|introduce yourself)\b/.test(t)) return { kind: 'who-are-you' };
  if (/\b(?:what can you do|what do you do|what can i say|what can i ask|help me|what commands|how do i use you)\b|^help$/.test(t)) return { kind: 'help' };
  if (/^(?:hi|hello|hey|hey there|hi there|hello there|yo|whats up|sup|good (?:morning|afternoon|evening)|morning|are you there|you there)$/.test(t))
    return { kind: 'greet' };

  return { kind: 'unknown', text };
}

// ---- what JARVIS says --------------------------------------------------------------

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export function partOfDay(now: Date): PartOfDay {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

type Rand = () => number;
const pick = <T,>(items: T[], rand: Rand): T => items[Math.min(items.length - 1, Math.floor(rand() * items.length))];

export interface GreetingContext {
  name: string;
  now: Date;
  /** When JARVIS was last woken (null = not this session). */
  lastWakeAt: number | null;
  rand?: Rand;
}

/** Greeting when woken: by name and time of day, shorter if it was just woken. */
export function greeting({ name, now, lastWakeAt, rand = Math.random }: GreetingContext): string {
  const n = name ? `, ${name}` : '';
  if (lastWakeAt !== null && now.getTime() - lastWakeAt < 10 * 60_000) {
    return pick([`Yes${n}?`, `I'm here${n}.`, `What else can I do for you${n}?`, `Go ahead${n}, I'm listening.`, `Back again${n}? How can I help?`], rand);
  }
  const part = partOfDay(now);
  const options: Record<PartOfDay, string[]> = {
    morning: [
      `Good morning${n}! What can I do for you?`,
      `Good morning${n}. Hope you slept well. How can I help?`,
      `Morning${n}! Ready when you are.`,
    ],
    afternoon: [`Good afternoon${n}! What can I do for you?`, `Good afternoon${n}. How's your day going? What do you need?`, `Hi${n}, good afternoon. How can I help?`],
    evening: [`Good evening${n}! What can I do for you?`, `Good evening${n}. Hope you had a good day. How can I help?`, `Evening${n}! What do you need?`],
    night: [`Hey${n}, you're up late. What can I do for you?`, `Hi${n}. Burning the midnight oil? How can I help?`, `Hello${n}. What can I do for you tonight?`],
  };
  return pick(options[part], rand);
}

export interface ReplyContext {
  name: string;
  now: Date;
  rand?: Rand;
  /** False in a browser tab, where JARVIS cannot start Windows programs. */
  canOpenApps: boolean;
}

export interface Reply {
  say: string;
  /** Keep listening after speaking (JARVIS asked a question). */
  listen?: boolean;
}

const JOKES = [
  'Why did the computer go to the doctor? It had a virus.',
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'Why was the computer cold? It left its Windows open.',
  "I'd tell you a joke about UDP, but you might not get it.",
  "There are 10 kinds of people: those who understand binary, and those who don't.",
  'Why did the PC keep sneezing? It had a bad case of the cookies.',
  "My laptop's fan and I have a lot in common. We both get loud when things heat up.",
  'Why did the developer go broke? Because he used up all his cache.',
];

/** Spoken answer for everything except actions whose wording depends on the result (timers etc. use these too). */
export function reply(intent: Intent, { name, now, rand = Math.random, canOpenApps }: ReplyContext): Reply {
  const n = name ? `, ${name}` : '';
  switch (intent.kind) {
    case 'sleep':
      return { say: pick(['Okay.', 'Sure thing.', 'No problem.'], rand) };
    case 'hide':
      return { say: pick([`Goodbye${n}. Call me when you need me.`, `See you soon${n}. Just say my name.`, `Bye${n}! I'll be right here.`], rand) };
    case 'greet':
      return { say: greeting({ name, now, lastWakeAt: null, rand }) };
    case 'good-night':
      return { say: pick([`Good night${n}. Sleep well!`, `Sweet dreams${n}. See you tomorrow.`, `Good night${n}. Rest well, I'll keep an eye on things.`], rand) };
    case 'how-are-you':
      return { say: pick([`I'm doing great${n}, thanks for asking! How about you?`, `All systems running smoothly. How are you doing${n}?`, `I'm good, thank you! How's your day going${n}?`], rand), listen: true };
    case 'feeling':
      return intent.good
        ? { say: pick([`Glad to hear it${n}!`, `That's great${n}. Let me know if you need anything.`, 'Good to hear! I\'m here if you need me.'], rand) }
        : { say: pick([`Sorry to hear that${n}. Maybe take a short break? I'll be right here.`, `That's rough${n}. Want me to put on some music? Just say play, then a song.`], rand) };
    case 'thanks':
      return { say: pick([`You're welcome${n}!`, 'Anytime!', `Happy to help${n}.`, 'My pleasure.'], rand) };
    case 'who-are-you':
      return { say: `I'm JARVIS, your personal assistant. I run right here on your PC and only answer to your voice.` };
    case 'help':
      return {
        say:
          'I can tell you the time and date, set timers, alarms and reminders, do quick maths, open apps like Notepad or Calculator, open websites, search the web, play something on YouTube, or tell you a joke. Just say Hey Jarvis, then ask.',
      };
    case 'set-name':
      return { say: pick([`Nice to meet you, ${intent.name}! I'll remember that.`, `Got it. I'll call you ${intent.name} from now on.`], rand) };
    case 'get-name':
      return { say: name ? `You're ${name}, of course!` : "I don't know your name yet. Tell me by saying: my name is, and then your name." };
    case 'time':
      return { say: `It's ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` };
    case 'date':
      return { say: `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.` };
    case 'timer':
      return { say: `Okay${n}, ${intent.label ? `${intent.label} timer` : 'timer'} set for ${describeDuration(intent.ms)}.` };
    case 'reminder':
      return { say: `Sure. I'll remind you to ${intent.text} ${whenText(intent.at, now)}.` };
    case 'alarm':
      return { say: `Alarm set for ${whenText(intent.at, now)}.` };
    case 'math':
      return {
        say: `${intent.expression.replace(' × ', ' times ').replace(' ÷ ', ' divided by ').replace(' - ', ' minus ').replace(' + ', ' plus ').replace('%', ' percent')} is ${formatNumber(intent.result)}.`,
      };
    case 'ask':
      return {
        say: intent.question === 'timer' ? 'Sure. For how long?' : intent.question === 'alarm' ? 'Sure. For what time?' : 'What should I remind you about, and when?',
        listen: true,
      };
    case 'cancel-timers':
      return { say: 'Okay, cancelled.' }; // the app says how many
    case 'list-timers':
      return { say: "Here's what's running." }; // the app lists them
    case 'power':
      return { say: `I've prepared a ${intent.mode}. Check the details in Activity and safety and approve it if you want it.` };
    case 'cancel-power':
      return { say: 'Cancelling it.' };
    case 'joke':
      return { say: pick(JOKES, rand) };
    case 'coin':
      return { say: `It's ${rand() < 0.5 ? 'heads' : 'tails'}!` };
    case 'dice':
      return { say: `You rolled a ${1 + Math.floor(rand() * 6)}.` };
    case 'open-screen':
      return { say: pick(['Here you go.', 'Sure.', 'Opening it now.'], rand) };
    case 'quick-scan':
      return { say: "I can't scan your PC yet. The JARVIS agent that reads your system isn't installed." };
    case 'open-app':
      return canOpenApps ? { say: `Opening ${intent.label}.` } : { say: `I can open ${intent.label} once I'm running in background mode. Right now I'm just a browser tab.` };
    case 'open-url':
      return { say: `Opening ${intent.label}.` };
    case 'search':
      return { say: `Here's what I found for ${intent.query}.` };
    case 'play':
      return { say: `Playing ${intent.query} on YouTube.` };
    case 'weather':
      return { say: `Here's the ${intent.query === 'weather' ? 'weather forecast' : intent.query}.` };
    case 'unknown':
      return {
        say: pick(
          [
            `Sorry${n}, I don't know how to help with that yet. You can say search for, and then your question.`,
            "Hmm, that one's beyond me for now. Try saying search for, then what you want to know.",
          ],
          rand,
        ),
      };
  }
}

/** "in 5 minutes" for soon, otherwise "at 7:30 AM" / "tomorrow at 7:30 AM". */
export function whenText(at: number, now: Date): string {
  const ms = at - now.getTime();
  if (ms < 60 * 60_000) return `in ${describeDuration(Math.round(ms / 1000) * 1000)}`;
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? `at ${time}` : `tomorrow at ${time}`;
}
