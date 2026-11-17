import { useEffect, useState } from 'react';
import { Check, Circle, Mic, RotateCcw, Save, X } from 'lucide-react';
import { Button, LevelMeter } from './ui';
import { useVoice, ACTION_LABELS } from '../state/useVoice';
import { voice, type CaptureResult } from '../voice/engine';
import type { Utterance } from '../voice/features';
import type { CommandAction } from '../voice/matcher';

const TARGET = 4;
const MINIMUM = 3;

const ISSUE_TEXT: Record<NonNullable<CaptureResult['issue']>, string> = {
  'too-quiet': 'That was too quiet. Move closer to the microphone and try again.',
  clipped: 'That was too loud and distorted. Move back a little and try again.',
  'no-voice': 'I could not hear a voice in that. Try again in a quieter spot.',
  'too-short': 'That was very short. Say the whole phrase at a normal pace.',
  'too-long': 'That was too long for a command. Say just the phrase.',
  inconsistent: 'That sounded different from your other samples. Say the same phrase the same way.',
  timeout: 'I did not hear anything. Press record and say the phrase.',
  noisy: 'There was continuous sound and I could not hear where your phrase started and ended. Pause any music or video, then say the phrase with a short silence before and after.',
  mic: 'The microphone could not be used, so nothing was recorded. See the note below.',
};

interface Props {
  title: string;
  initialPhrase?: string;
  /** Fixed action (wake phrase) or a list to choose from. */
  action: CommandAction | CommandAction[];
  onSaved: () => void;
  onCancel?: () => void;
}

export function PhraseRecorder({ title, initialPhrase = '', action, onSaved, onCancel }: Props) {
  const v = useVoice();
  const [phrase, setPhrase] = useState(initialPhrase);
  const [chosen, setChosen] = useState<CommandAction>(Array.isArray(action) ? action[0] : action);
  const [samples, setSamples] = useState<Utterance[]>([]);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => () => voice.releaseMic(), []);

  const phraseOk = phrase.trim().split(/\s+/).filter(Boolean).length >= 1 && phrase.trim().length >= 3;
  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const done = samples.length >= TARGET;
  const micProblem = v.status === 'blocked' || v.status === 'unavailable' || v.status === 'error';

  const record = async () => {
    setMessage(null);
    setRecording(true);
    const result = await voice.captureSample(samples);
    setRecording(false);
    if (result.utterance) {
      const next = [...samples, result.utterance];
      setSamples(next);
      setMessage({
        tone: 'ok',
        text: next.length >= TARGET ? 'All samples recorded. Save to finish.' : `Got it. ${TARGET - next.length} more to go.`,
      });
    } else if (result.issue) {
      setMessage({ tone: 'bad', text: ISSUE_TEXT[result.issue] });
    }
  };

  const save = () => {
    voice.saveCommand({ phrase, action: chosen, samples });
    voice.releaseMic();
    onSaved();
  };

  return (
    <div className="recorder">
      <h3 className="recorder-title">{title}</h3>
      <div className="recorder-fields">
        <div className="field">
          <label htmlFor={`phrase-${title}`}>Phrase</label>
          <input
            id={`phrase-${title}`}
            className="input"
            value={phrase}
            maxLength={40}
            disabled={samples.length > 0 || recording}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={Array.isArray(action) ? 'e.g. Open monitor' : 'e.g. Hey Jarvis'}
            aria-describedby={`phrase-hint-${title}`}
          />
          <span id={`phrase-hint-${title}`} className="field-hint">
            {samples.length > 0
              ? 'Clear the samples to change the phrase.'
              : words > 5
                ? 'Shorter is better: two to four words.'
                : 'Two to four words you would not say by accident.'}
          </span>
        </div>
        {Array.isArray(action) && (
          <div className="field">
            <label htmlFor={`action-${title}`}>What it does</label>
            <select
              id={`action-${title}`}
              className="input"
              value={chosen}
              onChange={(e) => setChosen(e.target.value as CommandAction)}
              disabled={recording}
            >
              {action.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </select>
            <span className="field-hint">Commands work after you say your wake phrase.</span>
          </div>
        )}
      </div>

      <ol className="samples" aria-label="Recorded samples">
        {Array.from({ length: TARGET }, (_, i) => {
          const state = i < samples.length ? 'done' : i === samples.length && recording ? 'recording' : 'empty';
          return (
            <li key={i} className={`sample is-${state}`}>
              {state === 'done' ? <Check size={14} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
              <span>
                Sample {i + 1}
                <span className="visually-hidden">: {state === 'done' ? 'recorded' : state === 'recording' ? 'recording now' : 'not recorded'}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className={`recorder-live ${recording ? 'is-recording' : ''}`} aria-live="polite">
        <div className="recorder-meter-row">
          <LevelMeter level={v.level} active={recording} />
          <BackgroundReadout db={v.backgroundDb} />
        </div>
        <p className="recorder-prompt">
          {recording ? (
            <>
              Say <strong>“{phrase.trim()}”</strong> now, then pause.
            </>
          ) : done ? (
            'Ready to save.'
          ) : (
            `Press record, say the phrase once, then pause. Sample ${samples.length + 1} of ${TARGET}.`
          )}
        </p>
      </div>
      {message && (
        <p className={`recorder-msg tone-${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {micProblem && v.errorMessage && (
        <p className="inline-error" role="alert">
          {v.errorMessage}
        </p>
      )}

      <div className="recorder-actions">
        {!done && (
          <Button variant="primary" icon={Mic} onClick={record} disabled={!phraseOk || recording}>
            {recording ? 'Listening…' : samples.length === 0 ? 'Record first sample' : 'Record next sample'}
          </Button>
        )}
        {samples.length >= MINIMUM && (
          <Button variant={done ? 'primary' : 'secondary'} icon={Save} onClick={save} disabled={recording}>
            Save
          </Button>
        )}
        {samples.length > 0 && (
          <Button
            variant="ghost"
            icon={RotateCcw}
            onClick={() => {
              setSamples([]);
              setMessage(null);
            }}
            disabled={recording}
          >
            Clear samples
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" icon={X} onClick={onCancel} disabled={recording}>
            Cancel
          </Button>
        )}
      </div>
      {samples.length === 0 && !recording && (
        <p className="field-hint">The first time, Windows asks to let JARVIS use your microphone. Audio stays on this PC and is never saved.</p>
      )}
    </div>
  );
}

/** How loud the room is, so a failed recording has a visible reason. */
export function BackgroundReadout({ db }: { db: number | null }) {
  if (db === null || db < -90) return null;
  const tone = db > -35 ? 'bad' : db > -48 ? 'warn' : 'ok';
  const text = db > -35 ? 'Loud: pause music or videos' : db > -48 ? 'Some noise' : 'Quiet';
  return (
    <span className={`background tone-${tone}`} role="status">
      <span className="mono">Background {db} dB</span> · {text}
    </span>
  );
}
