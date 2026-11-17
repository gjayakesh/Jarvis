import { FRAME_HOP, frameDb } from './dsp';

/**
 * Streaming voice-activity segmenter. Feed 16 kHz mono PCM in any chunk size;
 * it calls `onUtterance` with each complete spoken segment (including a short
 * lead-in) once the speaker pauses.
 *
 * The background level is estimated continuously as a low percentile of the
 * last few seconds of frame energy, so it adapts to fans, room noise and
 * microphones with automatic gain instead of assuming a quiet room.
 */
export interface SegmenterOptions {
  onUtterance: (samples: Float32Array) => void;
  /** Speech ran longer than a command could be (or the room never went quiet). */
  onOverflow?: () => void;
  /** dB above the background level that counts as speech. */
  startMarginDb?: number;
  maxSeconds?: number;
}

const PREROLL_FRAMES = 20; // 200 ms
const END_SILENCE_FRAMES = 30; // 300 ms
const MIN_SPEECH_FRAMES = 25; // 250 ms
const HISTORY_FRAMES = 300; // 3 s of background history
const WARMUP_FRAMES = 30; // 300 ms before the first trigger

export class Segmenter {
  private history: number[] = [];
  private noiseDb = -70;
  private framesSeen = 0;
  private pending = new Float32Array(0);
  private preroll: Float32Array[] = [];
  private speech: Float32Array[] = [];
  private inSpeech = false;
  private overflowed = false;
  private loudRun = 0;
  private silentRun = 0;
  private voicedFrames = 0;
  private readonly startMargin: number;
  private readonly maxFrames: number;

  constructor(private readonly options: SegmenterOptions) {
    this.startMargin = options.startMarginDb ?? 10;
    this.maxFrames = Math.round(((options.maxSeconds ?? 3.2) * 16000) / FRAME_HOP);
  }

  get noiseFloorDb(): number {
    return this.noiseDb;
  }

  /** Clear the current segment. Keeps the background estimate unless `full`. */
  reset(full = false): void {
    this.pending = new Float32Array(0);
    this.preroll = [];
    this.speech = [];
    this.inSpeech = false;
    this.overflowed = false;
    this.loudRun = 0;
    this.silentRun = 0;
    this.voicedFrames = 0;
    if (full) {
      this.history = [];
      this.noiseDb = -70;
      this.framesSeen = 0;
    }
  }

  push(chunk: Float32Array): void {
    const joined = new Float32Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    let offset = 0;
    while (offset + FRAME_HOP <= joined.length) {
      this.frame(joined.slice(offset, offset + FRAME_HOP));
      offset += FRAME_HOP;
    }
    this.pending = joined.slice(offset);
  }

  private trackBackground(db: number): void {
    this.history.push(db);
    if (this.history.length > HISTORY_FRAMES) this.history.shift();
    this.framesSeen++;
    if (this.framesSeen % 5 === 0 || this.history.length < 20) {
      const sorted = [...this.history].sort((a, b) => a - b);
      this.noiseDb = sorted[Math.floor(sorted.length * 0.15)];
    }
  }

  private frame(frame: Float32Array): void {
    const db = frameDb(frame, 0, frame.length);
    this.trackBackground(db);
    const loud = db > this.noiseDb + this.startMargin && db > -55;

    if (!this.inSpeech) {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= 3 && this.framesSeen > WARMUP_FRAMES) {
        this.inSpeech = true;
        this.overflowed = false;
        this.speech = [...this.preroll];
        this.preroll = [];
        this.silentRun = 0;
        this.voicedFrames = this.loudRun;
      }
      return;
    }

    this.speech.push(frame);
    if (db > this.noiseDb + this.startMargin - 4) {
      this.silentRun = 0;
      this.voicedFrames++;
    } else {
      this.silentRun++;
    }

    if (this.speech.length > this.maxFrames) {
      // Long sound is a sentence or noise, not a command: report it once and wait for a pause.
      if (!this.overflowed) this.options.onOverflow?.();
      this.overflowed = true;
      this.speech = this.speech.slice(-END_SILENCE_FRAMES);
    }

    if (this.silentRun >= END_SILENCE_FRAMES) {
      const keep = this.speech.slice(0, this.speech.length - (END_SILENCE_FRAMES - 10));
      const wasOverflow = this.overflowed;
      const voiced = this.voicedFrames;
      this.inSpeech = false;
      this.speech = [];
      this.loudRun = 0;
      this.overflowed = false;
      if (wasOverflow || voiced < MIN_SPEECH_FRAMES) return;
      const out = new Float32Array(keep.length * FRAME_HOP);
      keep.forEach((f, i) => out.set(f, i * FRAME_HOP));
      this.options.onUtterance(out);
    }
  }
}
