import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Ear, Headphones, Mic, RotateCcw, Sparkles, TrendingUp, Volume2 } from 'lucide-react';
import { LiveTrace } from './LiveTrace';
import { DEMO_STUDENTS, SENTENCE, SignalSim, daysAgo, detectWordOnsets, lessonWords, pairCurve, type DemoOptions, type LessonWord } from './demo';

type Stage = 'pick' | 'setup' | 'reading' | 'result';
const ELECTRODES = ['Fz', 'Cz', 'Pz'];

export function StudentChips({ students, value, onChange, disabled }: { students: readonly { id: string; name: string }[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return <div className="student-chips" role="radiogroup" aria-label="Student">
    {students.map((s, i) => <button key={s.id} role="radio" aria-checked={value === s.id} className="student-chip" data-color={i % 4} disabled={disabled} onClick={() => onChange(s.id)}>
      <span className="avatar" aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span>{s.name}
    </button>)}
  </div>;
}

export function WordChips({ words, showStatus = false }: { words: LessonWord[]; showStatus?: boolean }) {
  return <p className="sentence" aria-label={words.map((w) => w.text).join(' ')}>
    {words.map((w, i) => <span key={w.text} className="word" data-status={showStatus ? (w.familiar ? 'known' : 'new') : undefined}>
      {w.text}{i === words.length - 1 ? '.' : ''}
      {showStatus && <span className="word-mark" aria-label={w.familiar ? 'familiar' : 'not yet familiar'}>{w.familiar ? <Check size={14} strokeWidth={3} /> : '?'}</span>}
    </span>)}
  </p>;
}

type Voice = 'teacher' | 'recording';
interface Recording { name: string; buffer: AudioBuffer; onsets: number[] }

/** Scripted practice session used for presentations. The sentence is heard (spoken or played), never shown until the result. */
export function DemoPractice({ options, onShowProgress }: { options: DemoOptions; onShowProgress: () => void }) {
  const sim = useMemo(() => new SignalSim(), []);
  // Start the clock a few seconds in so the trace is already full when a screen opens.
  const origin = useRef(performance.now() - 8000);
  const clock = useCallback(() => (performance.now() - origin.current) / 1000, []);
  const [stage, setStage] = useState<Stage>(options.step === 'progress' ? 'pick' : options.step);
  const [student, setStudent] = useState('evan');
  const [voice, setVoice] = useState<Voice>('teacher');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [audioError, setAudioError] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const player = useRef<AudioBufferSourceNode | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const words = useMemo(() => lessonWords(options.round), [options.round]);
  const skipped = options.step === 'reading' || options.step === 'result';
  const [check, setCheck] = useState<'idle' | 'checking' | 'good'>(skipped ? 'good' : 'idle');
  const [checked, setChecked] = useState(skipped ? ELECTRODES.length : 0);
  const [heard, setHeard] = useState(0);
  // Opening straight on the result replays a sentence at a steady pace so the trace has something to show.
  const [range, setRange] = useState<readonly [number, number] | null>(() => {
    if (skipped) sim.settle();
    if (options.step !== 'result') return null;
    words.forEach((w, i) => { sim.advance(6 + i * 1.5); sim.mark(w.text, w.familiar); });
    sim.advance(6 + words.length * 1.5 + 0.6);
    origin.current = performance.now() - sim.now * 1000;
    return [5.2, sim.now];
  });
  const name = DEMO_STUDENTS.find((s) => s.id === student)?.name ?? 'Student';
  const familiar = words.filter((w) => w.familiar).length;
  const heardRef = useRef(0);
  const usingRecording = voice === 'recording' && recording !== null;

  useEffect(() => () => { timers.current.forEach(clearTimeout); player.current?.stop(); void audio.current?.close(); }, []);

  async function loadRecording(file: File | undefined) {
    if (!file) return;
    setAudioError('');
    try {
      audio.current ??= new AudioContext();
      const buffer = await audio.current.decodeAudioData(await file.arrayBuffer());
      setRecording({ name: file.name, buffer, onsets: detectWordOnsets(buffer.getChannelData(0), buffer.sampleRate, words.length) });
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

  const next = useCallback(() => {
    const i = heardRef.current;
    if (i >= words.length) return;
    sim.advance(clock());
    sim.mark(words[i].text, words[i].familiar);
    heardRef.current = i + 1;
    setHeard(i + 1);
    if (i + 1 === words.length) timers.current.push(setTimeout(() => {
      const first = sim.events[0].t;
      const end = clock();
      sim.advance(end);
      setRange([first - 0.8, end]);
      setStage('result');
    }, 1800));
  }, [clock, sim, words]);

  async function start() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    sim.events.length = 0;
    heardRef.current = 0;
    setHeard(0);
    setRange(null);
    setStage('reading');
    if (!usingRecording || !recording) return;
    audio.current ??= new AudioContext();
    await audio.current.resume();
    const node = audio.current.createBufferSource();
    node.buffer = recording.buffer;
    node.connect(audio.current.destination);
    player.current = node;
    const lead = 0.6;
    node.start(audio.current.currentTime + lead);
    // Each marker lands when its word starts playing.
    recording.onsets.forEach((onset) => timers.current.push(setTimeout(next, (lead + onset) * 1000)));
  }

  useEffect(() => {
    if (stage !== 'reading' || usingRecording) return;
    const onKey = (e: KeyboardEvent) => {
      if ([' ', 'ArrowRight', 'Enter', 'PageDown'].includes(e.key)) { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    const timer = options.autoSeconds ? setInterval(next, options.autoSeconds * 1000) : undefined;
    return () => { window.removeEventListener('keydown', onKey); clearInterval(timer); };
  }, [stage, next, options.autoSeconds, usingRecording]);

  function leaveReading() {
    timers.current.forEach(clearTimeout);
    player.current?.stop();
    setStage('setup');
  }

  if (stage === 'pick') return <div className="simple-page">
    <section className="panel">
      <h2>Who's practicing today?</h2>
      <StudentChips students={DEMO_STUDENTS} value={student} onChange={setStudent} />
    </section>
    <section className="panel">
      <h2>Pick a lesson</h2>
      <div className="lesson-card">
        <span className="lesson-kind">Listen · Spanish sentence</span>
        <span className="lesson-text">{SENTENCE.title}</span>
        <span className="lesson-meta">{words.length} words · heard, not shown, so the brain response is about listening</span>
        <div className="voice-choice" role="radiogroup" aria-label="How the sentence is heard">
          <button role="radio" aria-checked={voice === 'teacher'} className="choice" onClick={() => setVoice('teacher')}><Mic size={16} />Teacher says it</button>
          <button role="radio" aria-checked={voice === 'recording'} className="choice" onClick={() => setVoice('recording')}><Volume2 size={16} />Play a recording</button>
        </div>
        {voice === 'recording' && <label className="file-pick">{recording ? recording.name : 'Choose the sentence recording'}<input type="file" accept="audio/*" onChange={(e) => void loadRecording(e.target.files?.[0])} /></label>}
        {audioError && <p className="warning">{audioError}</p>}
        <details className="teacher-script"><summary>Teacher script</summary><p><strong>{words.map((w) => w.text).join(' ')}.</strong> {SENTENCE.translation}</p></details>
        <button className="big-button primary lesson-start" disabled={voice === 'recording' && !recording} onClick={() => setStage('setup')}>Next <ArrowRight size={18} /></button>
      </div>
    </section>
  </div>;

  if (stage === 'setup') return <div className="simple-page">
    <section className="panel setup-panel">
      <div className="setup-head">
        <div>
          <p className="eyebrow">{name} · {SENTENCE.title}</p>
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
          : <button className="big-button primary" onClick={() => void start()}>Start <ArrowRight size={20} /></button>}
        <button className="text-button" onClick={() => setStage('pick')}>Back</button>
      </div>
    </section>
  </div>;

  if (stage === 'reading') return <div className="simple-page">
    <section className={usingRecording ? 'panel reading-panel' : 'panel reading-panel tappable'} onClick={usingRecording ? undefined : next}>
      <div className="reading-top">
        <span className="rec-dot" aria-hidden="true" /><span className="eyebrow">Recording · {name}</span>
        <button className="text-button push-end" onClick={(e) => { e.stopPropagation(); leaveReading(); }}>Stop</button>
      </div>
      <div className="listen-hero">
        <span className="listen-icon" data-active={heard > 0 && heard < words.length} aria-hidden="true"><Ear size={34} /></span>
        <div>
          <h2>{heard === words.length ? 'Got it' : 'Listen closely'}</h2>
          <p className="muted">{usingRecording ? 'Playing the sentence…' : 'Your teacher will say a sentence in Spanish.'}</p>
        </div>
      </div>
      <ol className="word-slots" aria-label={`${heard} of ${words.length} words heard`}>
        {words.map((w, i) => <li key={w.text} data-heard={i < heard} data-current={i === heard - 1} />)}
      </ol>
      <div className="trace-frame"><LiveTrace sim={sim} clock={clock} windowS={7} height={240} numbered label="Live brain activity while the sentence is heard" /></div>
      {!usingRecording && !options.autoSeconds && <p className="hint">Tap or press space as you say each word.</p>}
    </section>
  </div>;

  return <div className="simple-page">
    <section className="panel result-panel">
      <div className="result-head">
        <div className="score"><strong>{familiar}</strong><span>of {words.length}</span></div>
        <div>
          <h2>words familiar</h2>
          <p className="lead">{familiar === words.length
            ? `${name}'s brain recognized every word in the sentence.`
            : <>{name}'s brain recognized {familiar} of {words.length} words. <b>{SENTENCE.unfamiliar}</b> is the one it didn't know yet.</>}</p>
        </div>
      </div>
      <p className="eyebrow">What {name} heard</p>
      <WordChips words={words} showStatus />
      {range && <div className="trace-frame"><LiveTrace sim={sim} range={range} showResponses height={240} label={`Brain response to each word; the response under ${SENTENCE.unfamiliar} dips`} /></div>}
      <div className="trace-legend">
        <span><i className="swatch known" />Familiar: response rises</span>
        {familiar < words.length && <span><i className="swatch new" />Not yet familiar: response dips</span>}
      </div>
      <div className="setup-actions">
        <button className="big-button primary" onClick={onShowProgress}><TrendingUp size={18} />See progress</button>
        <button className="big-button secondary" onClick={() => setStage('setup')}><RotateCcw size={18} />Practice again</button>
      </div>
    </section>
  </div>;
}

export function PairChart({ phase }: { phase: 'before' | 'after' }) {
  const a = pairCurve('caballo', phase);
  const b = pairCurve('cabello', phase);
  const width = 420, height = 180, left = 8, right = 8, top = 12, bottom = 26;
  const x = (ms: number) => left + ((ms + 100) / 900) * (width - left - right);
  const y = (uv: number) => top + (1 - (uv + 8) / 24) * (height - top - bottom);
  const path = (points: [number, number][]) => points.map(([ms, uv], i) => `${i ? 'L' : 'M'}${x(ms).toFixed(1)},${y(uv).toFixed(1)}`).join(' ');
  return <svg className="pair-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Average brain response to caballo and cabello, ${phase === 'before' ? 'three weeks ago: nearly identical' : 'now: clearly different'}`}>
    <rect className="pair-window" x={x(300)} y={top} width={x(500) - x(300)} height={height - top - bottom} rx={4} />
    <line className="pair-axis" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
    <line className="pair-axis" x1={x(0)} x2={x(0)} y1={top} y2={height - bottom} strokeDasharray="3 4" />
    <path className="pair-line a" d={path(a)} />
    <path className="pair-line b" d={path(b)} />
    {[0, 400, 800].map((ms) => <text key={ms} className="pair-tick" x={x(ms)} y={height - 8} textAnchor={ms === 800 ? 'end' : 'middle'}>{ms === 800 ? '800 ms' : ms}</text>)}
  </svg>;
}

const OTHER_PAIRS = [
  { pair: 'pero / perro', before: 'Close', after: 'Clearly different' },
  { pair: 'caro / carro', before: 'Close', after: 'Clearly different' },
];

export function DemoProgress({ onPractice }: { onPractice: () => void }) {
  const before = lessonWords(1);
  const after = lessonWords(2);
  return <div className="simple-page">
    <div className="progress-head">
      <div><p className="eyebrow">Evan · Spanish</p><h2 className="page-title">Progress</h2></div>
      <span className="streak"><Sparkles size={16} />9 sessions in 3 weeks</span>
    </div>
    <section className="panel">
      <h3 className="panel-title">Same sentence</h3>
      <div className="compare-rows">
        <div className="compare-row">
          <span className="when">{daysAgo(21)}</span>
          <WordChips words={before} showStatus />
          <span className="count">5 of 6</span>
        </div>
        <div className="compare-row now">
          <span className="when">Today</span>
          <WordChips words={after} showStatus />
          <span className="count">6 of 6</span>
        </div>
      </div>
    </section>
    <section className="panel">
      <div className="panel-title-row">
        <h3 className="panel-title">caballo / cabello</h3>
        <div className="trace-legend"><span><i className="swatch a" />caballo</span><span><i className="swatch b" />cabello</span></div>
      </div>
      <div className="pair-grid">
        <figure><figcaption><span className="when">{daysAgo(21)}</span><span className="pill">Sound the same</span></figcaption><PairChart phase="before" /></figure>
        <figure><figcaption><span className="when">Today</span><span className="pill good">Clearly different</span></figcaption><PairChart phase="after" /></figure>
      </div>
      <ul className="pair-list">
        {OTHER_PAIRS.map((p) => <li key={p.pair}><strong>{p.pair}</strong><span className="pill">{p.before}</span><ArrowRight size={14} aria-hidden="true" /><span className="pill good">{p.after}</span></li>)}
      </ul>
    </section>
    <div className="setup-actions"><button className="big-button primary" onClick={onPractice}><Headphones size={18} />Practice again</button></div>
  </div>;
}
