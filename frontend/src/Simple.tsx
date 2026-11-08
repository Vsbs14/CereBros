import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, AudioLines, Check, Ear, Headphones, MessageSquareText, Mic, RotateCcw, Sparkles, TrendingUp, Volume2 } from 'lucide-react';
import { LiveTrace } from './LiveTrace';
import { DEMO_STUDENTS, PAIR, SENTENCE_WORDS, SignalSim, UNFAMILIAR_INDEX, daysAgo, detectWordOnsets, pairCurve, type DemoOptions, type DemoStep, type PairWord, type WordEvent, type WordResponse } from './demo';

type Stage = Exclude<DemoStep, 'progress'>;
const ELECTRODES = ['Fz', 'Cz', 'Pz'];

export function StudentChips({ students, value, onChange, disabled }: { students: readonly { id: string; name: string }[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return <div className="student-chips" role="radiogroup" aria-label="Student">
    {students.map((s, i) => <button key={s.id} role="radio" aria-checked={value === s.id} className="student-chip" data-color={i % 4} disabled={disabled} onClick={() => onChange(s.id)}>
      <span className="avatar" aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span>{s.name}
    </button>)}
  </div>;
}

/** One dot per word the brain registered; the program counts words, it never knows what they were. */
export function ResponseDots({ responses }: { responses: WordResponse[] }) {
  return <ol className="response-dots" aria-label={`${responses.filter((r) => r !== 'unknown').length} of ${responses.length} words recognized`}>
    {responses.map((r, i) => <li key={i} data-response={r}><span>{r === 'unknown' ? '?' : <Check size={14} strokeWidth={3} />}</span>{i + 1}</li>)}
  </ol>;
}

type Test = 'sentence' | 'pair';
type Voice = 'teacher' | 'recording';
interface Recording { name: string; buffer: AudioBuffer; onsets: number[] }
const NEXT_KEYS = [' ', 'ArrowRight', 'Enter', 'PageDown'];
const OTHER_KEYS = ['b', 'B', 'ArrowLeft', 'PageUp'];
/** The sentence ends once the dip has played out, or after a pause with no new words. */
const STOP_AFTER_DIP_MS = 2200;
const STOP_AFTER_PAUSE_MS = 3000;

/**
 * Scripted session used for presentations. Words are heard (spoken or played), never shown: the operator marks each
 * word as it is said, and the signal responds as the script needs.
 */
export function DemoPractice({ options, onShowProgress }: { options: DemoOptions; onShowProgress: () => void }) {
  const sim = useMemo(() => new SignalSim(), []);
  // Start the clock a few seconds in so the trace is already full when a screen opens.
  const origin = useRef(performance.now() - 8000);
  const clock = useCallback(() => (performance.now() - origin.current) / 1000, []);
  const initial: Stage = options.step === 'progress' ? 'pick' : options.step;
  const [stage, setStage] = useState<Stage>(initial);
  const [test, setTest] = useState<Test>(initial === 'pair' || initial === 'pair-result' ? 'pair' : 'sentence');
  const [student, setStudent] = useState('evan');
  const [voice, setVoice] = useState<Voice>('teacher');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [audioError, setAudioError] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const player = useRef<AudioBufferSourceNode | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipped = initial !== 'pick' && initial !== 'setup';
  const [check, setCheck] = useState<'idle' | 'checking' | 'good'>(skipped ? 'good' : 'idle');
  const [checked, setChecked] = useState(skipped ? ELECTRODES.length : 0);
  const [heard, setHeard] = useState<WordEvent[]>([]);
  const [dipSeen, setDipSeen] = useState(false);
  // Opening straight on the result replays a sentence at a steady pace so the trace has something to show.
  const [range, setRange] = useState<readonly [number, number] | null>(() => {
    if (skipped) sim.settle();
    if (initial !== 'result') return null;
    for (let i = 0; i < SENTENCE_WORDS; i++) { sim.advance(6 + i * 1.5); sim.mark(String(i + 1), sentenceResponse(i)); }
    sim.advance(6 + SENTENCE_WORDS * 1.5 + 0.8);
    origin.current = performance.now() - sim.now * 1000;
    return [5.2, sim.now];
  });
  const name = DEMO_STUDENTS.find((s) => s.id === student)?.name ?? 'Student';
  const usingRecording = voice === 'recording' && recording !== null;
  const heardRef = useRef(0);
  const finishedRef = useRef(false);

  function sentenceResponse(index: number): WordResponse {
    return options.round === 1 && index === UNFAMILIAR_INDEX ? 'unknown' : 'known';
  }

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    clearTimeout(stopTimer.current);
    player.current?.stop();
    player.current = null;
  }
  useEffect(() => () => { clearTimers(); void audio.current?.close(); }, []);

  async function loadRecording(file: File | undefined) {
    if (!file) return;
    setAudioError('');
    try {
      audio.current ??= new AudioContext();
      const buffer = await audio.current.decodeAudioData(await file.arrayBuffer());
      setRecording({ name: file.name, buffer, onsets: detectWordOnsets(buffer.getChannelData(0), buffer.sampleRate, SENTENCE_WORDS) });
    } catch {
      setAudioError('That file could not be played. Try an MP3, M4A or WAV recording.');
    }
  }

  function runCheck() {
    setCheck('checking');
    setChecked(0);
    sim.settle();
    ELECTRODES.forEach((_, i) => setTimeout(() => setChecked(i + 1), 700 + i * 650));
    setTimeout(() => setCheck('good'), 700 + ELECTRODES.length * 650);
  }

  const finish = useCallback((next: Stage) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTimers();
    const end = clock();
    sim.advance(end);
    if (sim.events.length) setRange([sim.events[0].t - 0.8, end]);
    setStage(next);
  }, [clock, sim]);

  const markWord = useCallback((label: string, response: WordResponse, result: Stage, pauseMs = STOP_AFTER_PAUSE_MS) => {
    if (finishedRef.current) return;
    sim.advance(clock());
    sim.mark(label, response);
    heardRef.current += 1;
    setHeard([...sim.events]);
    clearTimeout(stopTimer.current);
    if (response === 'unknown') {
      timers.current.push(setTimeout(() => setDipSeen(true), 600));
      stopTimer.current = setTimeout(() => finish(result), STOP_AFTER_DIP_MS);
    } else stopTimer.current = setTimeout(() => finish(result), pauseMs);
  }, [clock, sim, finish]);

  const nextSentenceWord = useCallback(() => {
    const i = heardRef.current;
    markWord(String(i + 1), sentenceResponse(i), 'result');
  }, [markWord, options.round]);

  const pairWord = useCallback((word: PairWord) => {
    markWord(word, word === PAIR[1] && options.round === 2 ? 'different' : 'same', 'pair-result', 4000);
  }, [markWord, options.round]);

  async function begin(next: Test) {
    clearTimers();
    sim.events.length = 0;
    heardRef.current = 0;
    finishedRef.current = false;
    setHeard([]);
    setDipSeen(false);
    setRange(null);
    setTest(next);
    setStage(next === 'sentence' ? 'reading' : 'pair');
    if (next !== 'sentence' || !usingRecording || !recording) return;
    audio.current ??= new AudioContext();
    await audio.current.resume();
    const node = audio.current.createBufferSource();
    node.buffer = recording.buffer;
    node.connect(audio.current.destination);
    player.current = node;
    const lead = 0.6;
    node.start(audio.current.currentTime + lead);
    // Each word registers when it starts playing.
    recording.onsets.forEach((onset) => timers.current.push(setTimeout(nextSentenceWord, (lead + onset) * 1000)));
  }

  useEffect(() => {
    if (stage === 'reading' && !usingRecording) {
      const onKey = (e: KeyboardEvent) => { if (NEXT_KEYS.includes(e.key)) { e.preventDefault(); nextSentenceWord(); } };
      window.addEventListener('keydown', onKey);
      const timer = options.autoSeconds ? setInterval(() => { if (heardRef.current < SENTENCE_WORDS) nextSentenceWord(); }, options.autoSeconds * 1000) : undefined;
      return () => { window.removeEventListener('keydown', onKey); clearInterval(timer); };
    }
    if (stage === 'pair') {
      const onKey = (e: KeyboardEvent) => {
        if (NEXT_KEYS.includes(e.key)) { e.preventDefault(); pairWord(PAIR[0]); }
        else if (OTHER_KEYS.includes(e.key)) { e.preventDefault(); pairWord(PAIR[1]); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [stage, nextSentenceWord, pairWord, options.autoSeconds, usingRecording]);

  function stopListening() { clearTimers(); setStage('setup'); }

  if (stage === 'pick') return <div className="simple-page">
    <section className="panel">
      <h2>Who's practicing today?</h2>
      <StudentChips students={DEMO_STUDENTS} value={student} onChange={setStudent} />
    </section>
    <section className="panel">
      <h2>What should we check?</h2>
      <div className="test-cards" role="radiogroup" aria-label="Check">
        <button role="radio" aria-checked={test === 'sentence'} className="lesson-card" onClick={() => setTest('sentence')}>
          <span className="lesson-text"><MessageSquareText size={22} />Sentence check</span>
        </button>
        <button role="radio" aria-checked={test === 'pair'} className="lesson-card" onClick={() => setTest('pair')}>
          <span className="lesson-text"><AudioLines size={22} />Sound pair check</span>
        </button>
      </div>
      {test === 'sentence' && <>
        <div className="voice-choice" role="radiogroup" aria-label="How the sentence is heard">
          <button role="radio" aria-checked={voice === 'teacher'} className="choice" onClick={() => setVoice('teacher')}><Mic size={16} />Teacher says it</button>
          <button role="radio" aria-checked={voice === 'recording'} className="choice" onClick={() => setVoice('recording')}><Volume2 size={16} />Play a recording</button>
        </div>
        {voice === 'recording' && <label className="file-pick">{recording ? recording.name : 'Choose the sentence recording'}<input type="file" accept="audio/*" onChange={(e) => void loadRecording(e.target.files?.[0])} /></label>}
        {audioError && <p className="warning">{audioError}</p>}
      </>}
      <div className="setup-actions"><button className="big-button primary" disabled={test === 'sentence' && voice === 'recording' && !recording} onClick={() => setStage('setup')}>Next <ArrowRight size={18} /></button></div>
    </section>
  </div>;

  if (stage === 'setup') return <div className="simple-page">
    <section className="panel setup-panel">
      <div className="setup-head">
        <div>
          <p className="eyebrow">{name} · {test === 'sentence' ? 'Sentence check' : 'Sound pair check'}</p>
          <h2>{check === 'good' ? 'Signal looks great' : 'Let’s check the headset'}</h2>
        </div>
        <div className="electrodes" aria-live="polite">
          {ELECTRODES.map((e, i) => <span key={e} className="electrode" data-state={i < checked ? 'good' : check === 'checking' && i === checked ? 'checking' : 'idle'}>
            <span className="electrode-dot" aria-hidden="true">{i < checked && <Check size={14} strokeWidth={3} />}</span>{e}
          </span>)}
        </div>
      </div>
      <div className="trace-frame"><LiveTrace sim={sim} clock={clock} label="Live brain activity" /></div>
      <div className="setup-actions">
        {check !== 'good'
          ? <button className="big-button secondary" disabled={check === 'checking'} onClick={runCheck}>{check === 'checking' ? 'Checking signal…' : 'Check signal'}</button>
          : <button className="big-button primary" onClick={() => void begin(test)}>Start <ArrowRight size={20} /></button>}
        <button className="text-button" onClick={() => setStage('pick')}>Back</button>
      </div>
    </section>
  </div>;

  if (stage === 'reading' || stage === 'pair') {
    const pair = stage === 'pair';
    const counts = PAIR.map((word) => heard.filter((e) => e.label === word).length);
    return <div className="simple-page">
      <section className="panel reading-panel">
        <div className="reading-top">
          <span className="rec-dot" aria-hidden="true" /><span className="eyebrow">Recording · {name}</span>
          <button className="text-button push-end" onClick={stopListening}>Stop</button>
        </div>
        <div className="listen-hero">
          <span className="listen-icon" data-active={heard.length > 0 && !dipSeen} aria-hidden="true"><Ear size={34} /></span>
          <div>
            <h2>{dipSeen ? 'Big dip detected' : 'Listen closely'}</h2>
            <p className="muted">{dipSeen ? 'Wrapping up…' : pair ? 'Your teacher will say two similar words in a mixed order.' : usingRecording ? 'Playing the sentence…' : 'Your teacher will say a sentence in Spanish.'}</p>
          </div>
          <span className="heard-count" aria-live="polite">{pair ? <>{PAIR[0]} <strong>{counts[0]}</strong> · {PAIR[1]} <strong>{counts[1]}</strong></> : <>Words heard <strong>{heard.length}</strong></>}</span>
        </div>
        <div className="trace-frame"><LiveTrace sim={sim} clock={clock} windowS={7} height={260} numbered={!pair} label="Live brain activity while words are heard" /></div>
        {pair && <div className="setup-actions"><button className="big-button secondary" disabled={!counts[0] || !counts[1]} onClick={() => finish('pair-result')}>Done</button></div>}
      </section>
    </div>;
  }

  if (stage === 'pair-result') {
    const counts = PAIR.map((word) => heard.filter((e) => e.label === word).length);
    const same = options.round === 1;
    return <div className="simple-page">
      <section className="panel result-panel">
        <p className="eyebrow">{name} · Sound pair check</p>
        <div className="pair-result-head">
          <h2>{PAIR[0]} <span className="vs">vs</span> {PAIR[1]}</h2>
          <span className={same ? 'pill big' : 'pill big good'}>{same ? 'Sound the same' : 'Clearly different'}</span>
        </div>
        <p className="lead">{same
          ? <>Both words made nearly the same brain response. {name} isn't hearing the difference yet.</>
          : <>The two words now get clearly different responses. {name}'s brain hears the difference.</>}</p>
        <figure className="pair-figure">
          <PairChart phase={same ? 'before' : 'after'} />
          <figcaption className="trace-legend">
            <span><i className="swatch a" />{PAIR[0]}{counts[0] ? ` · heard ${counts[0]}×` : ''}</span>
            <span><i className="swatch b" />{PAIR[1]}{counts[1] ? ` · heard ${counts[1]}×` : ''}</span>
            <span>Average response after each word</span>
          </figcaption>
        </figure>
        <div className="setup-actions">
          <button className="big-button primary" onClick={onShowProgress}><TrendingUp size={18} />See progress</button>
          <button className="big-button secondary" onClick={() => setStage('pick')}><RotateCcw size={18} />Done</button>
        </div>
      </section>
    </div>;
  }

  const responses = sim.events.map((e) => e.response);
  const known = responses.filter((r) => r === 'known').length;
  const dip = responses.indexOf('unknown');
  return <div className="simple-page">
    <section className="panel result-panel">
      <div className="result-head">
        <div className="score"><strong>{known}</strong><span>of {responses.length}</span></div>
        <div>
          <h2>words familiar</h2>
          <p className="lead">{dip < 0
            ? `${name}'s brain recognized every word.`
            : <>{name}'s brain recognized {known} of {responses.length} words. <b>Word {dip + 1}</b> caused a big dip: that's the one it didn't know.</>}</p>
        </div>
      </div>
      <ResponseDots responses={responses} />
      {range && <div className="trace-frame"><LiveTrace sim={sim} range={range} showResponses numbered height={240} label={dip < 0 ? 'Brain response to each word' : `Brain response to each word; word ${dip + 1} dips`} /></div>}
      <div className="trace-legend">
        <span><i className="swatch known" />Word heard and recognized</span>
        {dip >= 0 && <span><i className="swatch new" />Dip: word not recognized</span>}
      </div>
      <div className="setup-actions">
        <button className="big-button primary" onClick={() => void begin('pair')}><AudioLines size={18} />Next: sound pair check</button>
        <button className="big-button secondary" onClick={onShowProgress}><TrendingUp size={18} />See progress</button>
      </div>
    </section>
  </div>;
}

export function PairChart({ phase }: { phase: 'before' | 'after' }) {
  const a = pairCurve(PAIR[0], phase);
  const b = pairCurve(PAIR[1], phase);
  const width = 420, height = 180, left = 8, right = 8, top = 12, bottom = 26;
  const x = (ms: number) => left + ((ms + 100) / 900) * (width - left - right);
  const y = (uv: number) => top + (1 - (uv + 8) / 24) * (height - top - bottom);
  const path = (points: [number, number][]) => points.map(([ms, uv], i) => `${i ? 'L' : 'M'}${x(ms).toFixed(1)},${y(uv).toFixed(1)}`).join(' ');
  return <svg className="pair-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Average brain response to ${PAIR[0]} and ${PAIR[1]}, ${phase === 'before' ? 'three weeks ago: nearly identical' : 'now: clearly different'}`}>
    <rect className="pair-window" x={x(300)} y={top} width={x(500) - x(300)} height={height - top - bottom} rx={4} />
    <line className="pair-axis" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
    <line className="pair-axis" x1={x(0)} x2={x(0)} y1={top} y2={height - bottom} strokeDasharray="3 4" />
    <path className="pair-line a" d={path(a)} />
    <path className="pair-line b" d={path(b)} />
    {[0, 400, 800].map((ms) => <text key={ms} className="pair-tick" x={x(ms)} y={height - 8} textAnchor={ms === 800 ? 'end' : 'middle'}>{ms === 800 ? '800 ms' : ms}</text>)}
  </svg>;
}

export function DemoProgress({ onPractice }: { onPractice: () => void }) {
  const before: WordResponse[] = Array.from({ length: SENTENCE_WORDS }, (_, i) => i === UNFAMILIAR_INDEX ? 'unknown' : 'known');
  const after: WordResponse[] = before.map(() => 'known');
  return <div className="simple-page">
    <div className="progress-head">
      <div><p className="eyebrow">Evan · Spanish</p><h2 className="page-title">Progress</h2></div>
      <span className="streak"><Sparkles size={16} />9 sessions in 3 weeks</span>
    </div>
    <section className="panel">
      <h3 className="panel-title">Sentence check · same sentence</h3>
      <div className="compare-rows">
        <div className="compare-row">
          <span className="when">{daysAgo(21)}</span>
          <ResponseDots responses={before} />
          <span className="count">5 of 6</span>
        </div>
        <div className="compare-row now">
          <span className="when">Today</span>
          <ResponseDots responses={after} />
          <span className="count">6 of 6</span>
        </div>
      </div>
    </section>
    <section className="panel">
      <div className="panel-title-row">
        <h3 className="panel-title">Sound pair check · same pair</h3>
        <div className="trace-legend"><span><i className="swatch a" />{PAIR[0]}</span><span><i className="swatch b" />{PAIR[1]}</span></div>
      </div>
      <div className="pair-grid">
        <figure><figcaption><span className="when">{daysAgo(21)}</span><span className="pill">Sound the same</span></figcaption><PairChart phase="before" /></figure>
        <figure><figcaption><span className="when">Today</span><span className="pill good">Clearly different</span></figcaption><PairChart phase="after" /></figure>
      </div>
    </section>
    <div className="setup-actions"><button className="big-button primary" onClick={onPractice}><Headphones size={18} />Practice again</button></div>
  </div>;
}
