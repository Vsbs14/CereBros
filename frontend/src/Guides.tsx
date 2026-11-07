import { ArrowUpRight } from 'lucide-react';

/** Proposed first-language packs from PRODUCT.md. Instructional examples, not diagnoses of individual learners. */
export const soundPairs = [
  { id: 'ship-sheep', words: ['ship', 'sheep'], contrast: '/ɪ/ vs /iː/', audience: 'Often practised with Spanish speakers' },
  { id: 'right-light', words: ['right', 'light'], contrast: '/r/ vs /l/', audience: 'Often practised with Japanese and Korean speakers' },
  { id: 'vest-west', words: ['vest', 'west'], contrast: '/v/ vs /w/', audience: 'Often practised with Hindi speakers' },
] as const;

export type SoundPair = typeof soundPairs[number];

export function SoundPairCard({ pair, onSelect }: { pair: SoundPair; onSelect: () => void }) {
  return (
    <button className="pair-card" onClick={onSelect}>
      <span className="pair-words">{pair.words[0]}<span aria-hidden="true"> / </span><span className="visually-hidden"> and </span>{pair.words[1]}</span>
      <span className="pair-contrast">{pair.contrast}</span>
      <span className="pair-audience">{pair.audience}</span>
      <span className="badge">Planned Pack</span>
    </button>
  );
}

const NEUROPAWN_DOCS = 'https://docs.neuropawn.tech';

export const resources = [
  { title: 'Getting Started', description: 'Unbox, assemble, and record a first EEG signal with the NeuroPawn kit.', href: `${NEUROPAWN_DOCS}/getting-started/` },
  { title: 'Knight Board', description: 'Board specs, data format, and command set for the acquisition hardware.', href: `${NEUROPAWN_DOCS}/knight-board/` },
  { title: 'Headset and Electrodes', description: 'Fitting the headwear and seating electrodes for good contact.', href: `${NEUROPAWN_DOCS}/headwear/` },
  { title: 'P300 Tutorial', description: 'NeuroPawn’s walkthrough of an oddball P300 recording.', href: `${NEUROPAWN_DOCS}/tutorials/p300/` },
] as const;

export function LinkCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a className="link-card" href={href} target="_blank" rel="noreferrer">
      <span className="link-card-title">{title}<ArrowUpRight size={16} aria-hidden="true" /></span>
      <span className="link-card-description">{description}</span>
      <span className="visually-hidden"> (opens NeuroPawn docs in a new tab)</span>
    </a>
  );
}

const DEVIANTS = new Set([3, 8, 12, 17]);
const SEQUENCE_LENGTH = 20;

/** Stimulus timing and analysis windows only. No waveform is drawn: nothing here is measured data. */
export function SessionDiagram({ baselineMs, windowMs, epochEndMs }: { baselineMs: number; windowMs: readonly [number, number]; epochEndMs: number }) {
  const width = 560;
  const left = 16;
  const right = 16;
  const span = width - left - right;
  const step = span / SEQUENCE_LENGTH;
  const start = Math.min(baselineMs, -1);
  const end = Math.max(epochEndMs, windowMs[1], 1);
  const x = (ms: number) => left + ((ms - start) / (end - start)) * span;
  const ticks = Array.from({ length: Math.floor((end - start) / 200) + 1 }, (_, i) => Math.ceil(start / 200) * 200 + i * 200).filter((ms) => ms <= end);
  const axisY = 150;
  return (
    <figure className="session-diagram">
      <svg viewBox={`0 0 ${width} 190`} role="img" aria-label={`Illustrative oddball sequence with ${DEVIANTS.size} deviants in ${SEQUENCE_LENGTH} sounds, and an epoch from ${start} to ${end} ms with a P300 window of ${windowMs[0]} to ${windowMs[1]} ms`}>
        <text x={left} y={14} className="diagram-label">1 · Sounds Play in Sequence</text>
        {Array.from({ length: SEQUENCE_LENGTH }, (_, i) => {
          const deviant = DEVIANTS.has(i);
          const h = deviant ? 34 : 18;
          return <rect key={i} className={deviant ? 'stim-deviant' : 'stim-standard'} x={left + i * step + step * 0.22} y={62 - h} width={step * 0.56} height={h} rx={4} />;
        })}
        <line x1={left} x2={width - right} y1={66} y2={66} className="diagram-axis" />
        <text x={left} y={100} className="diagram-label">2 · Each Sound Is Cut Into an Epoch and Averaged</text>
        <rect x={x(start)} y={112} width={Math.max(0, x(Math.min(0, end)) - x(start))} height={28} rx={4} className="window-baseline" />
        <rect x={x(windowMs[0])} y={112} width={Math.max(0, x(windowMs[1]) - x(windowMs[0]))} height={28} rx={4} className="window-p300" />
        <text x={x(start) + 6} y={130} className="diagram-window-label">Baseline</text>
        <text x={x(windowMs[0]) + 6} y={130} className="diagram-window-label p300">P300 Window</text>
        <line x1={x(0)} x2={x(0)} y1={106} y2={axisY} className="diagram-onset" />
        <line x1={left} x2={width - right} y1={axisY} y2={axisY} className="diagram-axis" />
        {ticks.map((ms) => <g key={ms}>
          <line x1={x(ms)} x2={x(ms)} y1={axisY} y2={axisY + 4} className="diagram-axis" />
          <text x={x(ms)} y={axisY + 18} textAnchor="middle" className="diagram-tick">{ms}</text>
        </g>)}
        <text x={width - right} y={axisY + 36} textAnchor="end" className="diagram-tick">Milliseconds From Sound Onset</text>
      </svg>
      <figcaption>
        <span className="legend-item"><span className="legend-swatch standard" aria-hidden="true" />Standard</span>
        <span className="legend-item"><span className="legend-swatch deviant" aria-hidden="true" />Deviant (Silently Counted)</span>
        <span className="diagram-note">Illustrative sequence. The server sets the actual randomized order.</span>
      </figcaption>
    </figure>
  );
}

const SITES = [
  { label: 'Fz', y: 66, primary: false },
  { label: 'Cz', y: 106, primary: true },
  { label: 'Pz', y: 146, primary: true },
];

export function ElectrodeMap() {
  return (
    <svg className="electrode-map" viewBox="0 0 200 210" role="img" aria-label="Top view of the head with midline electrode sites Fz, Cz, and Pz; Cz and Pz highlighted">
      <path d="M90 24 L100 8 L110 24" className="head-outline" />
      <ellipse cx={18} cy={106} rx={7} ry={16} className="head-outline" />
      <ellipse cx={182} cy={106} rx={7} ry={16} className="head-outline" />
      <circle cx={100} cy={106} r={82} className="head-fill" />
      <line x1={100} x2={100} y1={26} y2={186} className="head-midline" />
      {SITES.map((site) => <g key={site.label}>
        <circle cx={100} cy={site.y} r={11} className={site.primary ? 'site site-primary' : 'site'} />
        <text x={120} y={site.y + 6} className="site-label">{site.label}</text>
      </g>)}
      <text x={100} y={206} textAnchor="middle" className="diagram-tick">Top View, Nose Up</text>
    </svg>
  );
}
