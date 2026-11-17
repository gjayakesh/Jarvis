import { SAMPLE_RATE, resample } from './dsp';
import { assessQuality, extractUtterance, type QualityIssue, type Utterance } from './features';
import {
  DEFAULT_SETTINGS,
  buildProfile,
  matchUtterance,
  phraseSpread,
  sampleConsistency,
  type CommandAction,
  type MatchSettings,
  type VoiceCommand,
  type VoiceProfile,
} from './matcher';
import { Segmenter } from './segmenter';

/**
 * Microphone listener that runs entirely on this device. It keeps only
 * numeric features of the user's recorded phrases (never audio) in local
 * storage, and only listens while the user has switched listening on.
 */

export type MicStatus = 'off' | 'starting' | 'listening' | 'paused' | 'blocked' | 'unavailable' | 'error';

export interface HeardEvent {
  id: number;
  at: number;
  outcome: 'accepted' | 'wrong-voice' | 'unknown-phrase' | 'too-long';
  phrase: string | null;
  phraseScore: number;
  voiceScore: number;
  /** Raw gate numbers, for tuning and the dev console. */
  detail?: { phraseRatio: number; timbreRatio: number; pitchSemitones: number; durationSec: number };
}

export interface VoiceState {
  status: MicStatus;
  errorMessage: string | null;
  /** 0..1 smoothed input level, for meters and the core visual. */
  level: number;
  /** Estimated steady background level in dBFS while the mic is open (null when closed). */
  backgroundDb: number | null;
  /** Listening was switched on by the user (persisted). */
  enabled: boolean;
  awakeUntil: number | null;
  speaking: boolean;
  capturing: boolean;
  commands: VoiceCommand[];
  settings: MatchSettings;
  profileReady: boolean;
  heard: HeardEvent[];
}

export interface CaptureResult {
  utterance: Utterance | null;
  issue: QualityIssue | 'inconsistent' | 'timeout' | 'mic' | 'noisy' | null;
  durationSec: number;
}

type Listener = () => void;
type CommandHandler = (action: CommandAction, command: VoiceCommand) => void;

const STORAGE_KEY = 'jarvis.voice.v1';
const AWAKE_MS = 9000;

interface Stored {
  version: 1;
  enabled: boolean;
  commands: VoiceCommand[];
  settings: MatchSettings;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      if (parsed.version === 1) return { ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
    }
  } catch {
    /* storage unavailable: start empty */
  }
  return { version: 1, enabled: false, commands: [], settings: DEFAULT_SETTINGS };
}

const WORKLET = `
class JarvisTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
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

class VoiceEngine {
  private state: VoiceState;
  private listeners = new Set<Listener>();
  private handlers = new Set<CommandHandler>();
  private profile: VoiceProfile | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private segmenter: Segmenter;
  private captureResolver: ((u: Float32Array | null) => void) | null = null;
  private captureOverflow = false;
  private captureTimer: number | null = null;
  private eventId = 0;
  private resumeAt = 0;
  private sleepTimer: number | null = null;

  constructor() {
    const stored = load();
    this.state = {
      status: 'off',
      errorMessage: null,
      level: 0,
      backgroundDb: null,
      enabled: stored.enabled,
      awakeUntil: null,
      speaking: false,
      capturing: false,
      commands: stored.commands,
      settings: stored.settings,
      profileReady: false,
      heard: [],
    };
    this.rebuildProfile();
    this.segmenter = new Segmenter({
      onUtterance: (samples) => this.handleUtterance(samples),
      onOverflow: () => {
        if (this.captureResolver) {
          // Keep waiting for a clean phrase; if none arrives, the timeout reports a noisy room.
          this.captureOverflow = true;
        } else if (this.state.enabled) {
          this.record({ outcome: 'too-long', phrase: null, phraseScore: 0, voiceScore: 0 });
        }
      },
    });
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
    const data: Stored = { version: 1, enabled: this.state.enabled, commands: this.state.commands, settings: this.state.settings };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage full or blocked: keep working in memory */
    }
  }
  private rebuildProfile(): void {
    this.profile = buildProfile(this.state.commands.flatMap((c) => c.samples));
    this.set({ profileReady: this.profile !== null && this.state.commands.some((c) => c.action === 'wake') });
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
        // Automatic gain is off: it lifts background noise in every pause, which hides where speech starts and ends.
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, 'jarvis-tap');
      const rate = this.context.sampleRate;
      this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.handleChunk(rate === SAMPLE_RATE ? e.data : resample(e.data, rate));
      source.connect(this.node);
      this.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        this.stopMic();
        this.set({ status: 'error', errorMessage: 'The microphone was disconnected.' });
      });
      this.segmenter.reset(true);
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
    this.set({ status: 'off', level: 0, backgroundDb: null, awakeUntil: null });
  }

  /** Switch wake-phrase listening on or off (persisted). */
  async setListening(on: boolean): Promise<void> {
    this.set({ enabled: on });
    this.persist();
    if (on) {
      if (await this.startMic()) this.set({ status: 'listening' });
    } else if (!this.state.capturing) {
      this.stopMic();
    } else {
      this.set({ status: 'paused' });
    }
  }

  private handleChunk(chunk: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    const level = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 50));
    this.set({ level: this.state.level * 0.6 + level * 0.4, backgroundDb: Math.round(this.segmenter.noiseFloorDb) });
    const now = performance.now();
    if (this.state.speaking || now < this.resumeAt) return; // do not hear our own voice
    // Always feed the segmenter while the mic is open so it keeps learning the room's background level.
    this.segmenter.push(chunk);
  }

  // ---- enrolment ------------------------------------------------------------
  /** Record one sample of a phrase. Resolves when the user stops speaking. */
  async captureSample(existing: Utterance[], timeoutMs = 8000): Promise<CaptureResult> {
    if (!(await this.startMic())) return { utterance: null, issue: 'mic', durationSec: 0 };
    this.cancelCapture();
    this.segmenter.reset();
    this.captureOverflow = false;
    this.set({ capturing: true, status: 'listening' });
    const samples = await new Promise<Float32Array | null>((resolve) => {
      this.captureResolver = resolve;
      this.captureTimer = window.setTimeout(() => resolve(null), timeoutMs);
    });
    this.captureResolver = null;
    if (this.captureTimer) window.clearTimeout(this.captureTimer);
    // The mic stays open between samples; the recorder calls releaseMic() when done.
    this.set({ capturing: false, status: this.state.enabled ? 'listening' : 'paused' });
    if (!samples) return { utterance: null, issue: this.captureOverflow ? 'noisy' : 'timeout', durationSec: 0 };
    const { issue, quality } = assessQuality(samples);
    if (issue) return { utterance: null, issue, durationSec: quality.durationSec };
    const utterance = extractUtterance(samples);
    if (existing.length > 0 && sampleConsistency(existing, utterance) > 2.2) {
      return { utterance: null, issue: 'inconsistent', durationSec: quality.durationSec };
    }
    return { utterance, issue: null, durationSec: quality.durationSec };
  }

  cancelCapture(): void {
    if (this.captureResolver) this.captureResolver(null);
    this.captureResolver = null;
    if (this.state.capturing) this.set({ capturing: false });
  }

  /** Close the microphone after recording or testing, unless wake listening is on. */
  releaseMic(): void {
    this.cancelCapture();
    if (!this.state.enabled && this.stream) this.stopMic();
  }

  saveCommand(input: { id?: string; phrase: string; action: CommandAction; samples: Utterance[] }): VoiceCommand {
    const command: VoiceCommand = {
      id: input.id ?? `cmd_${Date.now().toString(36)}`,
      phrase: input.phrase.trim(),
      action: input.action,
      samples: input.samples,
      spread: phraseSpread(input.samples),
      createdAt: new Date().toISOString(),
    };
    const others = this.state.commands.filter((c) => c.id !== command.id && !(command.action === 'wake' && c.action === 'wake'));
    this.set({ commands: [...others, command] });
    this.rebuildProfile();
    this.persist();
    return command;
  }

  deleteCommand(id: string): void {
    this.set({ commands: this.state.commands.filter((c) => c.id !== id) });
    this.rebuildProfile();
    this.persist();
  }

  /** Remove every stored voice feature and switch listening off. */
  forgetVoice(): void {
    this.stopMic();
    this.set({ commands: [], enabled: false, heard: [] });
    this.rebuildProfile();
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
  private handleUtterance(samples: Float32Array): void {
    if (this.captureResolver) {
      this.captureResolver(samples);
      return;
    }
    if (!this.state.enabled || !this.state.profileReady) return;
    const utterance = extractUtterance(samples);
    if (utterance.frames.length < 10) return;
    const awake = this.state.awakeUntil !== null && Date.now() < this.state.awakeUntil;
    const candidates = this.state.commands.filter((c) => (awake ? true : c.action === 'wake'));
    const result = matchUtterance(utterance, candidates, this.profile, this.state.settings);
    const bestPhrase = result.command?.phrase ?? null;
    const detail = { ...result.detail, durationSec: utterance.durationSec };
    if (result.command) {
      this.record({ outcome: 'accepted', phrase: bestPhrase, phraseScore: result.phraseScore, voiceScore: result.voiceScore, detail });
      this.trigger(result.command);
    } else if (result.phraseOk && !result.voiceOk) {
      this.record({ outcome: 'wrong-voice', phrase: null, phraseScore: result.phraseScore, voiceScore: result.voiceScore, detail });
    } else if (awake || result.phraseScore > 0.35) {
      this.record({ outcome: 'unknown-phrase', phrase: null, phraseScore: result.phraseScore, voiceScore: result.voiceScore, detail });
    }
  }

  private trigger(command: VoiceCommand): void {
    if (command.action === 'wake') this.wake();
    else if (command.action === 'stop-listening') this.sleep();
    else this.wake(AWAKE_MS / 2);
    this.handlers.forEach((h) => h(command.action, command));
  }

  /** Enter the listening window (also used by the on-screen button). */
  wake(ms = AWAKE_MS): void {
    const until = Date.now() + ms;
    this.set({ awakeUntil: until });
    if (this.sleepTimer) window.clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => this.sleep(), ms);
  }

  sleep(): void {
    if (this.sleepTimer) window.clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.set({ awakeUntil: null });
  }

  private record(e: Omit<HeardEvent, 'id' | 'at'>): void {
    const event: HeardEvent = { ...e, id: ++this.eventId, at: Date.now() };
    this.set({ heard: [event, ...this.state.heard].slice(0, 12) });
  }

  /** Test a phrase without triggering anything (used by the setup flow). */
  async testOnce(): Promise<ReturnType<typeof matchUtterance> | null> {
    const res = await this.captureSample([], 8000);
    this.releaseMic();
    if (!res.utterance) return null;
    return matchUtterance(res.utterance, this.state.commands, this.profile, this.state.settings);
  }

  // ---- speech output ------------------------------------------------------------
  /** Speak with a voice installed on this PC (never a cloud voice). */
  speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices().filter((v) => v.localService);
    const voice = voices.find((v) => /en[-_]/i.test(v.lang) && /david|mark|guy|ryan/i.test(v.name)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? voices[0];
    if (!voice) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.rate = 1.05;
    u.onend = u.onerror = () => {
      this.resumeAt = performance.now() + 400;
      this.segmenter.reset();
      this.set({ speaking: false });
    };
    this.set({ speaking: true });
    speechSynthesis.speak(u);
  }
}

export const voice = new VoiceEngine();
