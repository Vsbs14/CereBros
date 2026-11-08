/** Scripted presentation mode (?demo). Everything here runs in the browser; nothing touches the backend. */

/**
 * The program never knows the sentence. Every heard word evokes a small onset blip (N1/P2), which is how words are
 * counted; a word the listener does not recognise adds a large negative dip about 400 ms later (N400-like).
 * In the script the sixth word, "azafrán", is the unfamiliar one.
 */
export const SENTENCE_WORDS = 6;
export const UNFAMILIAR_INDEX = 5;
/** The pair check works for any two words: the teacher's keys say which of the two was spoken, never what it was. */
export const PAIR = ['Word A', 'Word B'] as const;
export type PairWord = typeof PAIR[number];

export const DEMO_STUDENTS = [
  { id: 'evan', name: 'Evan', color: 'blue' },
  { id: 'maya', name: 'Maya', color: 'green' },
  { id: 'jonah', name: 'Jonah', color: 'violet' },
  { id: 'lucia', name: 'Lucía', color: 'amber' },
] as const;

export type DemoStep = 'pick' | 'setup' | 'reading' | 'result' | 'pair' | 'pair-result' | 'progress';
const STEPS: DemoStep[] = ['pick', 'setup', 'reading', 'result', 'pair', 'pair-result', 'progress'];
export interface DemoOptions { enabled: boolean; round: 1 | 2; autoSeconds: number | null; step: DemoStep }

/**
 * `?demo` turns it on. `&round=2` is three weeks later: no dip, and the two pair words clearly different.
 * `&auto=1.6` marks sentence words on a timer instead of key presses. `&step=<screen>` opens on that screen (handy for retakes).
 */
export function demoOptions(search = typeof window === 'undefined' ? '' : window.location.search): DemoOptions {
  const params = new URLSearchParams(search);
  const auto = Number(params.get('auto'));
  const step = params.get('step');
  return { enabled: params.has('demo'), round: params.get('round') === '2' ? 2 : 1, autoSeconds: auto > 0 ? auto : null,
    step: STEPS.find((s) => s === step) ?? 'pick' };
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bump = (x: number, mu: number, sigma: number) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

/** known/unknown: sentence words. same/different: pair words, depending on whether the contrast is heard. */
export type WordResponse = 'known' | 'unknown' | 'same' | 'different';

/** Single-trial response in µV, `dt` seconds after a word. */
function wordResponse(dt: number, response: WordResponse): number {
  const onset = -8 * bump(dt, 0.1, 0.03) + 10 * bump(dt, 0.2, 0.045);
  switch (response) {
    case 'known': return onset + 2.5 * bump(dt, 0.4, 0.12);
    case 'unknown': return onset - 26 * bump(dt, 0.42, 0.11) + 5 * bump(dt, 0.78, 0.1);
    case 'same': return onset + 3 * bump(dt, 0.38, 0.09);
    case 'different': return onset - 4 * bump(dt, 0.17, 0.035) + 14 * bump(dt, 0.39, 0.085);
  }
}

export interface WordEvent { t: number; label: string; response: WordResponse }

/** Plausible-looking single channel at 250 Hz: alpha/theta/beta rhythms, 1/f-ish noise and word responses. */
export class SignalSim {
  readonly rate = 250;
  readonly times: number[] = [];
  readonly values: number[] = [];
  readonly events: WordEvent[] = [];
  /** 1 while electrodes settle (drift, extra noise); eases toward `targetNoise`. */
  private noise = 1;
  private targetNoise = 1;
  private random: () => number;
  private pink = 0;
  private drift = 0;
  private n = 0;

  constructor(seed = 19) { this.random = mulberry32(seed); }

  settle() { this.targetNoise = 0; }
  get settled() { return this.noise < 0.08; }
  get now() { return this.n / this.rate; }

  private gauss() {
    const u = Math.max(this.random(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
  }

  advance(to: number) {
    while (this.n / this.rate < to) {
      const t = this.n / this.rate;
      this.noise += (this.targetNoise - this.noise) * 0.0025;
      const slow = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.13 * t);
      const alpha = (4 + 5 * slow) * Math.sin(2 * Math.PI * 10.2 * t + 0.6 * Math.sin(2 * Math.PI * 0.21 * t));
      const theta = 3 * Math.sin(2 * Math.PI * 5.7 * t + 1.3);
      const beta = 1.5 * Math.sin(2 * Math.PI * 19 * t + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
      this.pink = 0.96 * this.pink + this.gauss() * 1.4;
      this.drift = 0.997 * this.drift + this.gauss() * 1.1;
      let value = alpha + theta + beta + this.pink * (0.7 + 0.8 * this.noise) + this.gauss() * (1 + 3 * this.noise) + this.drift * this.noise;
      for (let i = this.events.length - 1; i >= 0; i--) {
        const dt = t - this.events[i].t;
        if (dt > 1.3) break;
        if (dt >= 0) value += wordResponse(dt, this.events[i].response);
      }
      this.times.push(t);
      this.values.push(value);
      this.n++;
    }
    // Keep roughly the last two minutes; a reading takes well under that.
    if (this.times.length > 40000) {
      this.times.splice(0, 10000);
      this.values.splice(0, 10000);
    }
  }

  mark(label: string, response: WordResponse, t = this.now) { this.events.push({ t, label, response }); }
}

/** Averaged response to one word of a pair, 0–800 ms, as [ms, µV] points. */
export function pairCurve(word: PairWord, phase: 'before' | 'after'): [number, number][] {
  const random = mulberry32(word === PAIR[0] ? 3 : phase === 'before' ? 5 : 11);
  const phases = Array.from({ length: 4 }, () => random() * Math.PI * 2);
  const points: [number, number][] = [];
  for (let ms = -100; ms <= 800; ms += 5) {
    const s = ms / 1000;
    let uv = -4 * bump(s, 0.1, 0.025) + 4 * bump(s, 0.19, 0.04) + 3 * bump(s, 0.38, 0.09);
    if (word === PAIR[1]) uv += phase === 'after' ? -4 * bump(s, 0.17, 0.035) + 11 * bump(s, 0.39, 0.085) : 0.8 * bump(s, 0.36, 0.1);
    uv += 0.45 * Math.sin(2 * Math.PI * 6 * s + phases[0]) + 0.3 * Math.sin(2 * Math.PI * 11 * s + phases[1]) + 0.25 * Math.sin(2 * Math.PI * 3 * s + phases[2]);
    points.push([ms, ms < 0 ? uv * 0.4 : uv]);
  }
  return points;
}

/** A date `days` before today, formatted like "Oct 17". */
export function daysAgo(days: number, today = new Date()): string {
  const date = new Date(today);
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Word onsets (seconds) in a recorded sentence, from gaps in its loudness envelope.
 * Falls back to even spacing over the voiced span when the speech runs words together.
 */
export function detectWordOnsets(data: Float32Array, rate: number, count: number): number[] {
  const hop = Math.max(1, Math.round(rate * 0.01));
  const envelope: number[] = [];
  for (let i = 0; i + hop <= data.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += data[j] * data[j];
    envelope.push(Math.sqrt(sum / hop));
  }
  const peak = envelope.reduce((max, v) => Math.max(max, v), 0);
  if (!peak) return Array.from({ length: count }, (_, i) => i * 0.8);
  const threshold = peak * 0.12;
  const segments: [number, number][] = [];
  let start = -1;
  envelope.forEach((v, i) => {
    if (v >= threshold) { if (start < 0) start = i; } else if (start >= 0) { segments.push([start, i]); start = -1; }
  });
  if (start >= 0) segments.push([start, envelope.length]);
  // Drop clicks, then join syllables separated by short pauses.
  const words: [number, number][] = [];
  for (const segment of segments.filter(([a, b]) => b - a >= 5)) {
    const last = words[words.length - 1];
    if (last && segment[0] - last[1] < 15) last[1] = segment[1]; else words.push([...segment]);
  }
  while (words.length > count) {
    let smallest = 0;
    for (let i = 1; i < words.length - 1; i++) if (words[i + 1][0] - words[i][1] < words[smallest + 1][0] - words[smallest][1]) smallest = i;
    words.splice(smallest, 2, [words[smallest][0], words[smallest + 1][1]]);
  }
  if (words.length === count) return words.map(([a]) => (a * hop) / rate);
  const from = words[0]?.[0] ?? 0;
  const to = words[words.length - 1]?.[1] ?? envelope.length;
  return Array.from({ length: count }, (_, i) => ((from + ((to - from) * i) / count) * hop) / rate);
}
