import { useEffect, useState } from 'react';
import { Check, Circle, Mic, RotateCcw, Save, X } from 'lucide-react';
import { Button, LevelMeter } from './ui';
import { useVoice } from '../state/useVoice';
import { voice, type CaptureIssue, type Sample } from '../voice/engine';

const TARGET = 4;
const MINIMUM = 3;

const ISSUE_TEXT: Record<CaptureIssue, string> = {
  'too-quiet': 'That was too quiet. Move closer to the microphone and try again.',
  clipped: 'That was too loud and distorted. Move back a little and try again.',
  'too-short': 'That was very short. Say the whole phrase at a normal pace.',
  'too-long': 'That went on too long for a wake phrase. Say just the phrase, then pause.',
  timeout: 'I did not hear anything. Press record and say the phrase.',
  mic: 'The microphone could not be used, so nothing was recorded. See the note below.',
  models: 'The voice models could not load. See the note below.',
  'wrong-words': 'I heard different words. Say the phrase clearly, exactly as typed.',
};

interface Props {
  title: string;
  initialPhrase?: string;
  onSaved: () => void;
  onCancel?: () => void;
}

/** Records the wake phrase a few times: checks the words and learns the voiceprint. */
export function PhraseRecorder({ title, initialPhrase = '', onSaved, onCancel }: Props) {
  const v = useVoice();
  const [phrase, setPhrase] = useState(initialPhrase);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    void voice.loadModels();
    voice.warmSpeaker();
    return () => voice.releaseMic();
  }, []);

  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const phraseOk = phrase.trim().length >= 3;
  const done = samples.length >= TARGET;
  const micProblem = v.status === 'blocked' || v.status === 'unavailable' || v.status === 'error';
  const modelsLoading = v.models === 'loading' || v.models === 'idle';

  const record = async () => {
    setMessage(null);
    setRecording(true);
    const result = await voice.captureSample(phrase);
    setRecording(false);
    if (result.sample) {
      const next = [...samples, result.sample];
      setSamples(next);
      setMessage({
        tone: 'ok',
        text: `Heard “${result.sample.text}”. ${next.length >= TARGET ? 'All samples recorded. Save to finish.' : `${TARGET - next.length} more to go.`}`,
      });
    } else if (result.issue) {
      const heard = result.heardText ? ` (I heard “${result.heardText}”.)` : '';
      setMessage({ tone: 'bad', text: ISSUE_TEXT[result.issue] + heard });
    }
  };

  const save = () => {
    voice.saveWake(phrase, samples);
    voice.releaseMic();
    onSaved();
  };

  return (
    <div className="recorder">
      <h3 className="recorder-title">{title}</h3>
      <div className="field">
        <label htmlFor="wake-phrase-input">Wake phrase</label>
        <input
          id="wake-phrase-input"
          className="input"
          value={phrase}
          maxLength={40}
          disabled={samples.length > 0 || recording}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="e.g. Hey Jarvis"
          aria-describedby="wake-phrase-hint"
        />
        <span id="wake-phrase-hint" className="field-hint">
          {samples.length > 0
            ? 'Clear the samples to change the phrase.'
            : words > 4
              ? 'Shorter is better: two or three words.'
              : 'Two or three words that you would not say by accident. A name helps, like “Hey Jarvis”.'}
        </span>
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
          {modelsLoading ? (
            (v.modelMessage ?? 'Loading voice models…')
          ) : recording ? (
            <>
              Say <strong>“{phrase.trim()}”</strong> now, then pause.
            </>
          ) : done ? (
            'Ready to save.'
          ) : (
            `Press record, say the phrase once in your normal voice, then pause. Sample ${samples.length + 1} of ${TARGET}.`
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
      {v.models === 'error' && v.modelMessage && (
        <p className="inline-error" role="alert">
          {v.modelMessage}
        </p>
      )}

      <div className="recorder-actions">
        {!done && (
          <Button variant="primary" icon={Mic} onClick={record} disabled={!phraseOk || recording || modelsLoading}>
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
        <p className="field-hint">
          Speech is understood on this PC by a local speech-to-text model, and your samples become a voiceprint so JARVIS answers only you. No
          audio is saved or sent.
        </p>
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
