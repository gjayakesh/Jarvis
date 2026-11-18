import { matchAtStart, matchCommand, normalize, phraseThreshold, similarity, type CommandAction, type VoiceCommand } from './text';
import { buildVoiceprint, learn, verify, type Voiceprint } from './voiceprint';
import type { WorkerIn, WorkerOut } from './worker';
import type { SpeakerIn, SpeakerOut } from './speaker-worker';
import { count } from '../state/perf';

/**
 * Microphone listener that runs entirely on this device. Audio goes to a local
 * worker (speech detection, Whisper speech-to-text, WavLM voiceprint); only the
 * user's phrases and voiceprint numbers are stored, never audio.
 */

export type { CommandAction, VoiceCommand } from './text';

export type MicStatus = 'off' | 'starting' | 'listening' | 'paused' | 'blocked' | 'unavailable' | 'error';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface HeardEvent {
  id: number;
  at: number;
  outcome: 'accepted' | 'wrong-voice' | 'unknown-phrase' | 'too-long' | 'request';
  /** What speech-to-text heard. */
  text: string;
  /** Command or wake phrase that matched, if any. */
  phrase: string | null;
  phraseScore: number;
  voiceScore: number;
  detail?: { durationSec: number; voiceSimilarity: number; voiceThreshold: number; ms: number };
}

export interface MatchSettings {
  /** 0 = strict, 1 = relaxed. */
  phraseTolerance: number;
  /** 0 = strict, 1 = relaxed. */
  voiceTolerance: number;
}

export interface VoiceState {
  status: MicStatus;
  errorMessage: string | null;
  models: ModelStatus;
  modelMessage: string | null;
  level: number;
  backgroundDb: number | null;
  enabled: boolean;
  awakeUntil: number | null;
  /**
   * In a conversation: woken, and listening to everything the owner says until
   * they say goodbye, ask JARVIS to sleep, press Esc or close the window.
   */
  conversation: boolean;
  speaking: boolean;
  /** The last thing JARVIS said out loud (shown as a caption). */
  lastSaid: { text: string; at: number } | null;
  capturing: boolean;
  commands: VoiceCommand[];
  voiceprint: Voiceprint | null;
  settings: MatchSettings;
  profileReady: boolean;
  heard: HeardEvent[];
}

export interface Sample {
  text: string;
  embedding: number[];
  durationSec: number;
}

export type CaptureIssue = 'too-quiet' | 'clipped' | 'too-short' | 'too-long' | 'timeout' | 'mic' | 'models' | 'wrong-words';

export interface CaptureResult {
  sample: Sample | null;
  issue: CaptureIssue | null;
  heardText?: string;
}

export interface TestResult {
  text: string;
  command: VoiceCommand | null;
  phraseScore: number;
  phraseOk: boolean;
  voiceScore: number;
  voiceOk: boolean;
}

type Listener = () => void;
/** `followUp`: on a wake, a command or request was said in the same breath and will follow at once. */
type CommandHandler = (action: CommandAction | 'request', command: VoiceCommand | null, text: string, info: { followUp: boolean }) => void;

export interface SpeechPrefs {
  voiceURI: string | null;
  rate: number;
}

/** Installed voices only (never a cloud voice), most natural-sounding first. */
export function localVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const rank = (v: SpeechSynthesisVoice) =>
    (/natural/i.test(v.name) ? 0 : 4) + (/^en[-_](us|gb|in|au)/i.test(v.lang) ? 0 : /^en/i.test(v.lang) ? 1 : 3) + (/david|mark|guy|ryan|aria|jenny|zira/i.test(v.name) ? 0 : 1);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.localService)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
type Segment = Extract<WorkerOut, { type: 'segment' }>;

const STORAGE_KEY = 'jarvis.voice.v2';
const AWAKE_MS = 9000;
export const DEFAULT_SETTINGS: MatchSettings = { phraseTolerance: 0.5, voiceTolerance: 0.5 };

interface Stored {
  version: 2;
  enabled: boolean;
  commands: VoiceCommand[];
  voiceprint: Voiceprint | null;
  settings: MatchSettings;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      if (parsed.version === 2) return { ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
    }
    // Voice data from the first engine cannot be reused.
    localStorage.removeItem('jarvis.voice.v1');
  } catch {
    /* storage unavailable: start empty */
  }
  return { version: 2, enabled: false, commands: [], voiceprint: null, settings: DEFAULT_SETTINGS };
}

const WORKLET = `
class JarvisTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('jarvis-tap', JarvisTap);
`;

/** Map a raw score onto 0..1 where 0.5 is exactly the pass mark. */
export const toPercent = (score: number, threshold: number) =>
  Math.max(0, Math.min(1, score >= threshold ? 0.5 + (0.5 * (score - threshold)) / Math.max(0.01, 1 - threshold) : (0.5 * score) / threshold));

class VoiceEngine {
  private state: VoiceState;
  private listeners = new Set<Listener>();
  private handlers = new Set<CommandHandler>();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private modelsReady: Promise<boolean> | null = null;
  private captureResolver: ((s: Segment | null) => void) | null = null;
  private captureTooLong = false;
  private embedWaiters = new Map<number, (e: number[] | null) => void>();
  private segmentAudio = new Map<number, Float32Array>();
  private speaker: Worker | null = null;
  private speakerIdle = 0;
  private eventId = 0;
  private resumeAt = 0;
  private sleepTimer: number | null = null;
  private recentDb: number[] = [];
  private speechPrefs: SpeechPrefs = { voiceURI: null, rate: 1 };
  private speechGuard = 0;
  /** Stay in a conversation after waking instead of a short listening window. */
  private keepListening = true;
  private uiQuiet = false;
  chunksReceived = 0;

  constructor() {
    const stored = load();
    this.state = {
      status: 'off',
      errorMessage: null,
      models: 'idle',
      modelMessage: null,
      level: 0,
      backgroundDb: null,
      enabled: stored.enabled,
      awakeUntil: null,
      conversation: false,
      speaking: false,
      lastSaid: null,
      capturing: false,
      commands: stored.commands,
      voiceprint: stored.voiceprint,
      settings: stored.settings,
      profileReady: false,
      heard: [],
    };
    this.refreshReady();
  }

  // ---- store plumbing -----------------------------------------------------
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = (): VoiceState => this.state;
  onCommand(handler: CommandHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  private set(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private persist(): void {
    const data: Stored = {
      version: 2,
      enabled: this.state.enabled,
      commands: this.state.commands,
      voiceprint: this.state.voiceprint,
      settings: this.state.settings,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage blocked: keep working in memory */
    }
  }
  private refreshReady(): void {
    this.set({ profileReady: this.state.voiceprint !== null && this.state.commands.some((c) => c.action === 'wake') });
  }

  // ---- models ---------------------------------------------------------------
  /** Load the local voice models once (a few seconds). */
  loadModels(): Promise<boolean> {
    if (this.modelsReady) return this.modelsReady;
    const attempt = this.startWorker();
    // One automatic retry: a first load can be interrupted (for example while the dev server rebuilds).
    this.modelsReady = attempt.then((ok) => {
      if (ok) return true;
      this.worker?.terminate();
      this.worker = null;
      return new Promise<boolean>((r) => window.setTimeout(r, 1500)).then(() => this.startWorker());
    }).then((ok) => {
      if (!ok) this.modelsReady = null; // allow a manual retry later
      return ok;
    });
    return this.modelsReady;
  }

  private startWorker(): Promise<boolean> {
    this.set({ models: 'loading', modelMessage: 'Loading voice models…' });
    return new Promise<boolean>((resolve) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            this.set({ modelMessage: `Loading ${msg.stage}… ${msg.percent}%` });
            break;
          case 'ready':
            this.set({ models: 'ready', modelMessage: null });
            resolve(true);
            break;
          case 'error':
            this.set({ models: 'error', modelMessage: `Voice models could not load: ${msg.message}` });
            resolve(false);
            break;
          case 'speech-start':
            break;
          case 'stats':
            count('vadFrames', msg.frames);
            count('vadCalls', msg.vad);
            count('vadMs', msg.vadMs);
            break;
          case 'too-long':
            if (this.captureResolver) this.captureTooLong = true;
            else if (this.state.enabled) this.record({ outcome: 'too-long', text: '', phrase: null, phraseScore: 0, voiceScore: 0 });
            break;
          case 'segment':
            count('transcriptions');
            count('transcribeMs', msg.ms);
            this.segmentAudio.set(msg.id, msg.audio);
            for (const old of this.segmentAudio.keys()) if (old < msg.id - 3) this.segmentAudio.delete(old);
            void this.handleSegment(msg);
            break;
        }
      };
      worker.onerror = (e) => {
        this.set({ models: 'error', modelMessage: `Voice models could not load: ${e.message}` });
        resolve(false);
      };
      this.send({ type: 'init' });
    });
  }

  private send(msg: WorkerIn, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  // ---- microphone ---------------------------------------------------------
  get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined';
  }

  async startMic(): Promise<boolean> {
    if (this.stream) return true;
    if (!this.supported) {
      this.set({ status: 'unavailable', errorMessage: 'This window cannot use a microphone.' });
      return false;
    }
    this.set({ status: 'starting', errorMessage: null });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.context = new AudioContext({ sampleRate: 16000 });
      if (this.context.sampleRate !== 16000) throw new Error('16 kHz audio is not available');
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, 'jarvis-tap');
      this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.handleChunk(e.data);
      source.connect(this.node);
      if (this.context.state === 'suspended') await this.context.resume();
      this.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        this.stopMic();
        this.set({ status: 'error', errorMessage: 'The microphone was disconnected.' });
      });
      this.send({ type: 'reset' });
      this.set({ status: this.state.enabled ? 'listening' : 'paused' });
      return true;
    } catch (err) {
      this.stopMic();
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.set({
          status: 'blocked',
          errorMessage:
            'Microphone access is blocked for this window. The Claude app’s built-in browser never allows the mic: open JARVIS in Chrome or Edge instead. Elsewhere, allow the microphone in the browser’s site settings and in Windows Settings > Privacy & security > Microphone.',
        });
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        this.set({ status: 'unavailable', errorMessage: 'No microphone was found. Plug one in and try again.' });
      } else {
        this.set({ status: 'error', errorMessage: 'The microphone could not be started.' });
      }
      return false;
    }
  }

  stopMic(): void {
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.cancelCapture();
    this.recentDb = [];
    this.set({ status: 'off', level: 0, backgroundDb: null, awakeUntil: null, conversation: false });
  }

  /** Switch wake-phrase listening on or off (persisted). */
  async setListening(on: boolean): Promise<void> {
    this.set({ enabled: on });
    this.persist();
    if (on) {
      const [modelsOk, micOk] = await Promise.all([this.loadModels(), this.startMic()]);
      if (modelsOk && micOk) this.set({ status: 'listening' });
    } else if (!this.state.capturing) {
      this.stopMic();
    } else {
      this.set({ status: 'paused' });
    }
  }

  private handleChunk(chunk: Float32Array): void {
    this.chunksReceived++;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const db = 20 * Math.log10(Math.sqrt(sum / chunk.length) + 1e-9);
    const level = Math.min(1, Math.max(0, (db + 60) / 50));
    this.recentDb.push(db);
    if (this.recentDb.length > 120) this.recentDb.shift();
    // The background level moves slowly: re-estimate it every 8 chunks (~1 s), not every chunk.
    let background = this.state.backgroundDb;
    if (background === null || this.recentDb.length % 8 === 0) {
      const sorted = [...this.recentDb].sort((a, b) => a - b);
      background = Math.max(-80, Math.round(sorted[Math.floor(sorted.length * 0.15)]));
    }
    const meter = { level: this.state.level * 0.6 + level * 0.4, backgroundDb: background };
    // While the window is hidden nobody sees the meter, so update it without re-drawing the screens.
    if (this.uiQuiet) this.state = { ...this.state, ...meter };
    else this.set(meter);
    if (this.state.speaking || performance.now() < this.resumeAt) return; // never hear our own voice
    if (!this.state.capturing && !this.state.enabled) return;
    if (this.state.models !== 'ready') return;
    const copy = chunk.slice(0);
    this.send({ type: 'audio', samples: copy }, [copy.buffer]);
  }

  // ---- enrolment ------------------------------------------------------------
  /** Record one spoken sample. Resolves after the user pauses and it has been understood. */
  async captureSample(expectedPhrase: string | null, timeoutMs = 10000): Promise<CaptureResult> {
    const [modelsOk, micOk] = await Promise.all([this.loadModels(), this.startMic()]);
    if (!micOk) return { sample: null, issue: 'mic' };
    if (!modelsOk) return { sample: null, issue: 'models' };
    this.cancelCapture();
    // No reset here: the user may already be speaking, and the mic resets when it starts.
    this.captureTooLong = false;
    this.send({ type: 'awake', awake: true }); // allow a full sentence while recording/testing
    this.set({ capturing: true, status: 'listening' });
    let timer = 0;
    const seg = await new Promise<Segment | null>((resolve) => {
      this.captureResolver = resolve;
      timer = window.setTimeout(() => resolve(null), timeoutMs);
    });
    window.clearTimeout(timer);
    this.captureResolver = null;
    this.set({ capturing: false, status: this.state.enabled ? 'listening' : 'paused' });
    this.send({ type: 'awake', awake: this.isAwake() });
    if (!seg) return { sample: null, issue: this.captureTooLong ? 'too-long' : 'timeout' };
    if (seg.peak < -40) return { sample: null, issue: 'too-quiet', heardText: seg.text };
    if (seg.clipped > 0.01) return { sample: null, issue: 'clipped', heardText: seg.text };
    if (seg.durationSec < 0.4) return { sample: null, issue: 'too-short', heardText: seg.text };
    if (expectedPhrase && matchAtStart(expectedPhrase, seg.text).score < phraseThreshold(this.state.settings.phraseTolerance)) {
      return { sample: null, issue: 'wrong-words', heardText: seg.text };
    }
    const embedding = await this.embedding(seg.id);
    if (!embedding) return { sample: null, issue: 'models', heardText: seg.text };
    return { sample: { text: seg.text, embedding, durationSec: seg.durationSec }, issue: null, heardText: seg.text };
  }

  cancelCapture(): void {
    if (this.captureResolver) this.captureResolver(null);
    this.captureResolver = null;
    if (this.state.capturing) this.set({ capturing: false });
  }

  /** Close the microphone after recording or testing, unless listening is on. */
  releaseMic(): void {
    this.cancelCapture();
    if (!this.state.enabled && this.stream) this.stopMic();
  }

  /** Save the wake phrase and the voiceprint learned from its samples. */
  saveWake(phrase: string, samples: Sample[]): void {
    const wake: VoiceCommand = { id: 'wake', phrase: phrase.trim(), action: 'wake', createdAt: new Date().toISOString() };
    const others = this.state.commands.filter((c) => c.action !== 'wake');
    this.set({ commands: [wake, ...others], voiceprint: buildVoiceprint(samples.map((s) => s.embedding)) });
    this.refreshReady();
    this.persist();
  }

  /** Commands are understood from speech-to-text, so they need no recordings. */
  saveCommand(phrase: string, action: CommandAction): VoiceCommand {
    const command: VoiceCommand = { id: `cmd_${Date.now().toString(36)}`, phrase: phrase.trim(), action, createdAt: new Date().toISOString() };
    this.set({ commands: [...this.state.commands.filter((c) => c.action !== action), command] });
    this.refreshReady();
    this.persist();
    return command;
  }

  deleteCommand(id: string): void {
    this.set({ commands: this.state.commands.filter((c) => c.id !== id) });
    this.refreshReady();
    this.persist();
  }

  /** Remove every stored phrase and the voiceprint, and switch listening off. */
  forgetVoice(): void {
    this.stopMic();
    this.set({ commands: [], voiceprint: null, enabled: false, heard: [] });
    this.refreshReady();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  updateSettings(patch: Partial<MatchSettings>): void {
    this.set({ settings: { ...this.state.settings, ...patch } });
    this.persist();
  }

  // ---- recognition ------------------------------------------------------------
  /** Grow the voiceprint from clear, confident wake-ups only. */
  private learnFrom(embedding: number[], sim: number, threshold: number): void {
    const print = this.state.voiceprint;
    if (!print || sim < threshold + 0.06) return;
    this.set({ voiceprint: learn(print, embedding, print.enrolled ?? Math.min(4, print.embeddings.length)) });
    this.persist();
  }

  /**
   * The voiceprint model lives in its own worker that is started on demand and
   * closed after 3 idle minutes, so its memory goes back to Windows.
   */
  private speakerWorker(): Worker {
    if (!this.speaker) {
      const w = new Worker(new URL('./speaker-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<SpeakerOut>) => {
        if (e.data.type === 'embedding') {
          const done = this.embedWaiters.get(e.data.id);
          this.embedWaiters.delete(e.data.id);
          done?.(e.data.embedding);
        }
      };
      this.speaker = w;
    }
    window.clearTimeout(this.speakerIdle);
    this.speakerIdle = window.setTimeout(() => {
      if (this.state.capturing || this.embedWaiters.size > 0) {
        this.speakerWorker(); // still in use: check again later
        return;
      }
      this.speaker?.terminate();
      this.speaker = null;
    }, 3 * 60_000);
    return this.speaker;
  }

  /** Start the voiceprint model early (used while recording samples). */
  warmSpeaker(): void {
    this.speakerWorker();
  }

  /** Voiceprint of a segment (only computed when the words matched). */
  private embedding(id: number): Promise<number[] | null> {
    const audio = this.segmentAudio.get(id);
    if (!audio) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.embedWaiters.set(id, resolve);
      const msg: SpeakerIn = { type: 'embed', id, audio };
      this.speakerWorker().postMessage(msg);
      window.setTimeout(() => {
        if (this.embedWaiters.delete(id)) resolve(null);
      }, 30000);
    });
  }

  private voiceCheck(embedding: number[] | null) {
    if (!this.state.voiceprint || !embedding) return { ok: false, similarity: 0, threshold: 1, score: 0, embedding: null };
    const v = verify(this.state.voiceprint, embedding, this.state.settings.voiceTolerance);
    return { ...v, score: toPercent(v.similarity, v.threshold), embedding };
  }

  private isAwake(): boolean {
    return this.state.awakeUntil !== null && Date.now() < this.state.awakeUntil;
  }

  private async handleSegment(seg: Segment): Promise<void> {
    if (this.captureResolver) {
      this.captureResolver(seg);
      return;
    }
    if (!this.state.enabled || !this.state.profileReady) return;
    const text = seg.text;
    if (!normalize(text)) return;
    const threshold = phraseThreshold(this.state.settings.phraseTolerance);
    const awake = this.isAwake();
    const wake = this.state.commands.find((c) => c.action === 'wake')!;
    const others = this.state.commands.filter((c) => c.action !== 'wake');
    const w = matchAtStart(wake.phrase, text);
    const candidates = awake ? others : others.filter((c) => c.action === 'hide-jarvis');
    const m = w.score >= threshold ? null : matchCommand(text, candidates, this.state.settings.phraseTolerance);
    const relevant = w.score >= threshold || m !== null || awake;
    // The voiceprint is only computed when the words matter; other speech costs no more work.
    const voice = this.voiceCheck(relevant ? await this.embedding(seg.id) : null);
    const detail = {
      durationSec: Number(seg.durationSec.toFixed(2)),
      voiceSimilarity: Number(voice.similarity.toFixed(3)),
      voiceThreshold: Number(voice.threshold.toFixed(3)),
      ms: seg.ms,
    };

    // 1. Wake phrase at the start ("Hey Jarvis", or "Hey Jarvis, open monitor").
    if (w.score >= threshold) {
      if (!voice.ok) {
        this.record({ outcome: 'wrong-voice', text, phrase: null, phraseScore: toPercent(w.score, threshold), voiceScore: voice.score, detail });
        return;
      }
      this.record({ outcome: 'accepted', text, phrase: wake.phrase, phraseScore: toPercent(w.score, threshold), voiceScore: voice.score, detail });
      if (voice.embedding) this.learnFrom(voice.embedding, voice.similarity, voice.threshold);
      const next = w.rest ? this.followUp(w.rest, others, detail) : null;
      this.trigger(wake, text, next !== null);
      next?.();
      return;
    }

    // 2. Commands: closing works any time; the rest only while awake.
    if (m) {
      if (!voice.ok) {
        this.record({ outcome: 'wrong-voice', text, phrase: null, phraseScore: toPercent(m.score, threshold), voiceScore: voice.score, detail });
        return;
      }
      this.record({ outcome: 'accepted', text, phrase: m.command.phrase, phraseScore: toPercent(m.score, threshold), voiceScore: voice.score, detail });
      this.trigger(m.command, text);
      return;
    }

    // 3. Awake and in the owner's voice: anything else is a request for the assistant.
    if (awake && voice.ok) {
      this.record({ outcome: 'request', text, phrase: null, phraseScore: 0, voiceScore: voice.score, detail });
      if (!this.state.conversation) this.sleep();
      this.handlers.forEach((h) => h('request', null, text, { followUp: false }));
      return;
    }
    const near = Math.max(similarity(wake.phrase, text), w.score);
    if (awake || near > 0.6) {
      this.record({
        outcome: awake ? 'wrong-voice' : 'unknown-phrase',
        text,
        phrase: null,
        phraseScore: toPercent(near, threshold),
        voiceScore: voice.score,
        detail,
      });
    }
  }

  /**
   * Words said straight after the wake phrase in one breath. Returns the step
   * to run right after the wake, or null when there is nothing to act on.
   */
  private followUp(rest: string, commands: VoiceCommand[], detail: HeardEvent['detail']): (() => void) | null {
    const m = matchCommand(rest, commands, this.state.settings.phraseTolerance);
    if (m) {
      return () => {
        this.record({ outcome: 'accepted', text: rest, phrase: m.command.phrase, phraseScore: 1, voiceScore: 1, detail });
        this.trigger(m.command, rest);
      };
    }
    const words = normalize(rest).split(' ').filter(Boolean);
    // Two words or more is a request; one word only if it is a whole request ("time", "hello", "stop").
    if (words.length >= 2 || (words.length === 1 && /^(time|date|hello|hi|thanks|stop|joke|help|weather)$/.test(words[0]))) {
      return () => {
        this.record({ outcome: 'request', text: rest, phrase: null, phraseScore: 0, voiceScore: 1, detail });
        if (!this.state.conversation) this.sleep();
        this.handlers.forEach((h) => h('request', null, rest, { followUp: false }));
      };
    }
    return null;
  }

  private trigger(command: VoiceCommand, text: string, followUp = false): void {
    if (command.action === 'wake') this.wake();
    else if (command.action === 'stop-listening' || command.action === 'hide-jarvis') this.sleep();
    else this.wake(AWAKE_MS / 2);
    this.handlers.forEach((h) => h(command.action, command, text, { followUp }));
  }

  setKeepListening(on: boolean): void {
    this.keepListening = on;
  }

  /** Hidden window: stop pushing mic-level changes to the screens (listening carries on). */
  setUiQuiet(quiet: boolean): void {
    if (quiet === this.uiQuiet) return;
    this.uiQuiet = quiet;
    if (!quiet) this.listeners.forEach((l) => l()); // catch the screens up once
  }

  /**
   * Enter the listening window (also used by the on-screen button). With
   * keep-listening on, this opens a conversation that has no countdown.
   */
  wake(ms = AWAKE_MS): void {
    if (this.sleepTimer) window.clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.send({ type: 'awake', awake: true });
    if (this.keepListening || this.state.conversation) {
      this.set({ awakeUntil: Number.MAX_SAFE_INTEGER, conversation: true });
      return;
    }
    this.set({ awakeUntil: Date.now() + ms });
    this.sleepTimer = window.setTimeout(() => this.sleep(), ms);
  }

  /** Stop listening for requests (ends a conversation too); the wake phrase still works. */
  sleep(): void {
    if (this.sleepTimer) window.clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.set({ awakeUntil: null, conversation: false });
    if (!this.state.capturing) this.send({ type: 'awake', awake: false });
  }

  private record(e: Omit<HeardEvent, 'id' | 'at'>): void {
    const event: HeardEvent = { ...e, id: ++this.eventId, at: Date.now() };
    this.set({ heard: [event, ...this.state.heard].slice(0, 12) });
  }

  /** Say something once and see how it matches, without triggering anything. */
  async testOnce(): Promise<TestResult | null> {
    const res = await this.captureSample(null, 10000);
    this.releaseMic();
    const sample = res.sample;
    if (!sample) return null;
    const threshold = phraseThreshold(this.state.settings.phraseTolerance);
    const wake = this.state.commands.find((c) => c.action === 'wake') ?? null;
    const wakeScore = wake ? matchAtStart(wake.phrase, sample.text).score : 0;
    const m = matchCommand(sample.text, this.state.commands.filter((c) => c.action !== 'wake'), 1);
    const best = m && m.score > wakeScore ? m : { command: wake, score: wakeScore };
    const voice = this.voiceCheck(sample.embedding);
    const phraseOk = best.score >= threshold;
    return {
      text: sample.text,
      command: phraseOk && voice.ok ? best.command : null,
      phraseScore: toPercent(best.score, threshold),
      phraseOk,
      voiceScore: voice.score,
      voiceOk: voice.ok,
    };
  }

  // ---- speech output ------------------------------------------------------------
  setSpeechPrefs(prefs: SpeechPrefs): void {
    this.speechPrefs = prefs;
  }

  /**
   * Speak with a voice installed on this PC (never a cloud voice).
   * `listenAfter` opens the listening window once JARVIS has finished talking,
   * so the user can answer a question without saying the wake phrase again.
   */
  speak(text: string, { listenAfter = false }: { listenAfter?: boolean } = {}): void {
    this.set({ lastSaid: { text, at: Date.now() } });
    const voices = localVoices();
    const chosen = voices.find((v) => v.voiceURI === this.speechPrefs.voiceURI) ?? voices[0];
    if (!chosen) {
      if (listenAfter) this.wake();
      return;
    }
    speechSynthesis.cancel();
    window.clearTimeout(this.speechGuard);
    const u = new SpeechSynthesisUtterance(text);
    u.voice = chosen;
    u.rate = Math.min(1.3, Math.max(0.7, this.speechPrefs.rate));
    u.pitch = 1;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(this.speechGuard);
      this.resumeAt = performance.now() + 400;
      this.send({ type: 'reset' });
      this.set({ speaking: false });
      if (listenAfter) this.wake();
    };
    u.onend = u.onerror = done;
    // The microphone is muted while JARVIS talks; never leave it muted if Chrome drops the end event.
    const guardMs = 4000 + ((text.length / 10) * 1000) / u.rate;
    this.speechGuard = window.setTimeout(done, guardMs);
    this.set({ speaking: true });
    if (listenAfter && this.isAwake()) this.wake(guardMs + AWAKE_MS); // stay open while talking; reset when done
    speechSynthesis.speak(u);
  }
}

export const voice = new VoiceEngine();
