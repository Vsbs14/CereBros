import type { CSSProperties } from 'react';

/** Values are microvolts at the indicated time in seconds. A null channel value is a gap. */
export interface EEGSample {
  time_s: number;
  channels: Record<string, number | null>;
}

export interface EEGMarker {
  time_s: number;
  label: string;
  kind?: 'standard' | 'deviant' | 'response' | 'other';
}

export interface EEGChartProps {
  samples?: EEGSample[];
  /** Display order. When omitted, every channel found in the samples is shown. */
  channels?: string[];
  /** Human-readable electrode positions or names, keyed by channel ID. */
  channelMap?: Record<string, string>;
  markers?: EEGMarker[];
  source?: string;
  className?: string;
  /** Fixed lane half-height in µV, or 'auto' to fit the largest channel. */
  scaleUv?: number | 'auto';
  subtitle?: string;
}

/** Null means the mean is unavailable at that time; it must not be interpolated. */
export interface ERPPoint {
  time_ms: number;
  mean_uv: number | null;
  ci_low_uv?: number | null;
  ci_high_uv?: number | null;
}

export interface ERPCounts {
  accepted: number;
  rejected: number;
  pending: number;
}

export interface ERPData {
  channel: string;
  source: string;
  counts: ERPCounts;
  standard: ERPPoint[];
  deviant: ERPPoint[];
  difference: ERPPoint[];
  /** A null summary value is explicitly unavailable. */
  meanAmplitudeUv?: number | null;
  peakAmplitudeUv?: number | null;
  peakLatencyMs?: number | null;
  /** Defaults to provisional while any trials are pending. */
  provisional?: boolean;
}

export interface ERPChartProps {
  data?: ERPData | null;
  baselineWindowMs?: readonly [number, number];
  p300WindowMs?: readonly [number, number];
  className?: string;
}

const C = {
  panel: '#101c33',
  plot: '#0b162a',
  border: '#293b58',
  grid: '#263853',
  text: '#e8f0fc',
  muted: '#9aacc6',
  cyan: '#5ed8e7',
  violet: '#b69aff',
  amber: '#ffc879',
  green: '#79d6af',
};

const panelStyle: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 18,
  color: C.text,
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  padding: '18px 20px 16px',
  boxShadow: '0 12px 36px rgba(3, 10, 24, 0.18)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 12,
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: `1px solid ${C.border}`,
  borderRadius: 999,
  background: '#172640',
  padding: '5px 10px',
  color: C.muted,
  fontSize: 12,
  fontWeight: 600,
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function tick(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function extent(values: number[]): [number, number] {
  const min = values.reduce((current, value) => Math.min(current, value), Infinity);
  const max = values.reduce((current, value) => Math.max(current, value), -Infinity);
  return min === max ? [min - 0.5, max + 0.5] : [min, max];
}

function emptyState(message: string) {
  return (
    <div className="chart-empty" style={{ alignItems: 'center', background: C.plot, border: `1px dashed ${C.border}`, borderRadius: 12, color: C.muted, display: 'flex', justifyContent: 'center', minHeight: 210, textAlign: 'center' }}>
      {message}
    </div>
  );
}

function chartHeader(title: string, subtitle: string, badges: string[]) {
  return (
    <div className="chart-header" style={headerStyle}>
      <div>
        <div style={{ color: C.text, fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {badges.map((badge) => <span className="chart-badge" style={badgeStyle} key={badge}>{badge}</span>)}
      </div>
    </div>
  );
}

function lineSegments<T>(points: T[], value: (point: T) => [number, number] | null): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    const xy = value(point);
    if (xy) {
      current.push(`${current.length ? 'L' : 'M'}${xy[0].toFixed(2)},${xy[1].toFixed(2)}`);
    } else if (current.length) {
      segments.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) segments.push(current.join(' '));
  return segments;
}

const LANE_COLORS = ['#5ed8e7', '#b69aff', '#79d6af', '#ffc879', '#ff8fa3', '#7fb2ff', '#e6a1ff', '#c6e27a'];

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = p * (sorted.length - 1), lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Rounds an amplitude up to a readable scale step (1, 2, 5 x 10^n). */
export function niceScale(value: number): number {
  if (!(value > 0)) return 10;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
}

export function EEGChart({ samples = [], channels, channelMap, markers = [], source, className, scaleUv = 'auto', subtitle }: EEGChartProps) {
  const ordered = [...samples].filter((sample) => finite(sample.time_s)).sort((a, b) => a.time_s - b.time_s);
  const present = new Set(ordered.flatMap((sample) => Object.keys(sample.channels)));
  const names = channels?.length ? channels.filter((name) => present.has(name) || !ordered.length) : [...present];
  const badges = [source ? `Source · ${source}` : 'Source unavailable', `${names.length} channels`];
  const title = chartHeader('EEG signals', subtitle ?? 'Time (s) · amplitude (µV), positive up', badges);
  if (!ordered.length || !names.length) {
    return <section className={`eeg-chart ${className ?? ''}`.trim()} style={panelStyle}>{title}{emptyState('No EEG data available')}</section>;
  }

  const lane = names.length <= 2 ? 120 : names.length <= 4 ? 92 : 68;
  const width = 960;
  const left = 96;
  const right = 78;
  const top = 34;
  const bottom = 40;
  const plotWidth = width - left - right;
  const plotHeight = names.length * lane;
  const height = top + plotHeight + bottom;
  const [minTime, maxTime] = extent(ordered.map((sample) => sample.time_s));
  const x = (time: number) => left + ((time - minTime) / (maxTime - minTime)) * plotWidth;
  // Each lane is centred on its own median, so electrode offsets never squash other channels.
  const centers = Object.fromEntries(names.map((name) => [name, percentile(ordered.map((s) => s.channels[name]).filter(finite), 0.5)]));
  const spread = names.map((name) => percentile(ordered.map((s) => s.channels[name]).filter(finite).map((v) => Math.abs(v - centers[name])), 0.98));
  const scale = scaleUv === 'auto' ? niceScale(Math.max(...spread, 1)) : scaleUv;
  const half = lane * 0.46;
  const y = (index: number, uv: number) => top + lane * (index + 0.5) - (uv / scale) * half;
  const timeTicks = Array.from({ length: 6 }, (_, index) => minTime + (maxTime - minTime) * index / 5);
  const visibleMarkers = markers.filter((marker) => finite(marker.time_s) && marker.time_s >= minTime && marker.time_s <= maxTime);
  const markerColor = (kind: EEGMarker['kind']) => kind === 'deviant' ? C.amber : kind === 'response' ? C.green : C.violet;
  const clipId = `eeg-clip-${names.join('-').replace(/[^A-Za-z0-9-]/g, '')}`;

  return (
    <section className={`eeg-chart ${className ?? ''}`.trim()} style={panelStyle}>
      {title}
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', minWidth: 650, width: '100%' }} role="img" aria-label={`EEG signals for ${names.join(', ')} from ${tick(minTime)} to ${tick(maxTime)} seconds`}>
          <rect x={left} y={top} width={plotWidth} height={plotHeight} rx={8} fill={C.plot} />
          {timeTicks.map((time, index) => <g key={index}>
            <line x1={x(time)} x2={x(time)} y1={top} y2={top + plotHeight} stroke={C.grid} strokeWidth={1} opacity={0.6} />
            <text x={x(time)} y={height - 16} textAnchor="middle" fill={C.muted} fontSize={12}>{tick(time)}</text>
          </g>)}
          {names.map((name, index) => {
            const center = top + lane * (index + 0.5);
            const color = LANE_COLORS[index % LANE_COLORS.length];
            const paths = lineSegments(ordered, (sample) => {
              const uv = sample.channels[name];
              return finite(uv) ? [x(sample.time_s), y(index, uv - centers[name])] : null;
            });
            const clipped = spread[index] > scale * 1.05;
            return <g key={name}>
              <clipPath id={`${clipId}-${index}`}><rect x={left} y={top + lane * index + 1} width={plotWidth} height={lane - 2} /></clipPath>
              {index > 0 && <line x1={left} x2={left + plotWidth} y1={top + lane * index} y2={top + lane * index} stroke={C.border} />}
              <line x1={left} x2={left + plotWidth} y1={center} y2={center} stroke={C.grid} strokeDasharray="2 6" opacity={0.7} />
              <rect x={6} y={center - 11} width={5} height={22} rx={2} fill={color} />
              <text x={18} y={center - (channelMap?.[name] && channelMap[name] !== name ? 4 : -4)} fill={C.text} fontSize={13} fontWeight={700}>{name}</text>
              {channelMap?.[name] && channelMap[name] !== name && <text x={18} y={center + 12} fill={C.muted} fontSize={10}>{channelMap[name]}</text>}
              <g clipPath={`url(#${clipId}-${index})`}>
                {paths.map((path, segment) => <path key={segment} d={path} fill="none" stroke={color} strokeWidth={1.15} strokeLinecap="round" strokeLinejoin="round" />)}
              </g>
              <text x={left + plotWidth + 8} y={center + 4} fill={clipped ? C.amber : C.muted} fontSize={10}>{clipped ? 'clipped' : `±${tick(Math.round(spread[index]))}`}</text>
            </g>;
          })}
          {visibleMarkers.map((marker, index) => <g key={`${marker.time_s}-${marker.label}-${index}`}>
            <line x1={x(marker.time_s)} x2={x(marker.time_s)} y1={top} y2={top + plotHeight} stroke={markerColor(marker.kind)} strokeWidth={1.2} strokeDasharray="4 4" opacity={0.75} />
            <text x={x(marker.time_s) + 4} y={top - 10} fill={markerColor(marker.kind)} fontSize={10}>{marker.label}</text>
          </g>)}
          <g aria-label={`Scale bar ${scale} microvolts`}>
            <line x1={left + plotWidth + 64} x2={left + plotWidth + 64} y1={top + lane / 2 - half} y2={top + lane / 2 + half} stroke={C.text} strokeWidth={2} />
          </g>
          <text x={left} y={height - 2} fill={C.muted} fontSize={11}>Lane height ±{tick(scale)} µV · offset removed per channel · right column: 98th-percentile amplitude</text>
          <text x={left + plotWidth} y={height - 2} textAnchor="end" fill={C.muted} fontSize={11}>Time (s)</text>
        </svg>
      </div>
    </section>
  );
}

type Curve = { key: 'standard' | 'deviant' | 'difference'; label: string; color: string; points: ERPPoint[] };

function ciAreas(points: ERPPoint[], x: (time: number) => number, y: (uv: number) => number): string[] {
  const runs: ERPPoint[][] = [];
  let run: ERPPoint[] = [];
  for (const point of points) {
    if (finite(point.time_ms) && finite(point.mean_uv) && finite(point.ci_low_uv) && finite(point.ci_high_uv)) {
      run.push(point);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((items) => items.length > 1).map((items) => {
    const upper = items.map((point) => `${x(point.time_ms).toFixed(2)},${y(point.ci_high_uv as number).toFixed(2)}`);
    const lower = [...items].reverse().map((point) => `${x(point.time_ms).toFixed(2)},${y(point.ci_low_uv as number).toFixed(2)}`);
    return `M${upper.join(' L')} L${lower.join(' L')} Z`;
  });
}

function summaryValue(value: number | null | undefined, unit: string): string {
  return finite(value) ? `${tick(value)} ${unit}` : 'Unavailable';
}

function erpMetrics(data: ERPData) {
  return <div className="erp-metrics" style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
    <span style={{ color: C.muted, fontSize: 12 }}>Mean P300 amplitude <strong style={{ color: C.text, display: 'block', fontSize: 16, marginTop: 2 }}>{summaryValue(data.meanAmplitudeUv, 'µV')}</strong></span>
    <span style={{ color: C.muted, fontSize: 12 }}>Peak amplitude <strong style={{ color: C.text, display: 'block', fontSize: 16, marginTop: 2 }}>{summaryValue(data.peakAmplitudeUv, 'µV')}</strong></span>
    <span style={{ color: C.muted, fontSize: 12 }}>Peak latency <strong style={{ color: C.text, display: 'block', fontSize: 16, marginTop: 2 }}>{summaryValue(data.peakLatencyMs, 'ms')}</strong></span>
  </div>;
}

export function ERPChart({ data, baselineWindowMs = [-200, 0], p300WindowMs = [300, 600], className }: ERPChartProps) {
  const heading = chartHeader('Event-related potential', 'Time (ms) · amplitude (µV), positive up', data ? [`Channel · ${data.channel}`, `Source · ${data.source}`, ...((data.provisional ?? data.counts.pending > 0) ? ['Provisional'] : [])] : []);
  if (!data) {
    return <section className={`erp-chart ${className ?? ''}`.trim()} style={panelStyle}>{heading}{emptyState('No ERP data available')}</section>;
  }

  const curves: Curve[] = [
    { key: 'standard', label: 'Standard', color: C.cyan, points: data.standard },
    { key: 'deviant', label: 'Deviant', color: C.violet, points: data.deviant },
    { key: 'difference', label: 'Difference', color: C.amber, points: data.difference },
  ];
  const sorted = curves.map((curve) => ({ ...curve, points: [...curve.points].filter((point) => finite(point.time_ms)).sort((a, b) => a.time_ms - b.time_ms) }));
  const all = sorted.flatMap((curve) => curve.points);
  const hasMean = all.some((point) => finite(point.mean_uv));
  const counts = data.counts;
  const countBadges = <div className="erp-counts" style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
    <span style={badgeStyle}>Accepted · {counts.accepted}</span>
    <span style={badgeStyle}>Rejected · {counts.rejected}</span>
    <span style={badgeStyle}>Pending · {counts.pending}</span>
  </div>;
  if (!hasMean) {
    return <section className={`erp-chart ${className ?? ''}`.trim()} style={panelStyle}>{heading}{countBadges}{emptyState('No ERP data available')}<div style={{ marginTop: 16 }}>{erpMetrics(data)}</div></section>;
  }

  const width = 960;
  const height = 430;
  const left = 66;
  const right = 26;
  const top = 33;
  const bottom = 55;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const [minTime, maxTime] = extent(all.map((point) => point.time_ms));
  const amplitudes = all.flatMap((point) => [point.mean_uv, point.ci_low_uv, point.ci_high_uv].filter(finite));
  const scale = amplitudes.reduce((current, value) => Math.max(current, Math.abs(value)), 1);
  const x = (time: number) => left + (time - minTime) / (maxTime - minTime) * plotWidth;
  const y = (uv: number) => top + plotHeight / 2 - uv / scale * plotHeight * 0.43;
  const xTicks = Array.from({ length: 6 }, (_, index) => minTime + (maxTime - minTime) * index / 5);
  const yTicks = [-scale, -scale / 2, 0, scale / 2, scale];
  const windowRect = (window: readonly [number, number]) => {
    const start = Math.max(minTime, Math.min(window[0], window[1]));
    const end = Math.min(maxTime, Math.max(window[0], window[1]));
    return end > start ? { x: x(start), width: x(end) - x(start) } : null;
  };
  const baseline = windowRect(baselineWindowMs);
  const p300 = windowRect(p300WindowMs);

  return (
    <section className={`erp-chart ${className ?? ''}`.trim()} style={panelStyle}>
      {heading}
      {countBadges}
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', minWidth: 650, width: '100%' }} role="img" aria-label={`ERP standard, deviant, and difference for ${data.channel} from ${tick(minTime)} to ${tick(maxTime)} milliseconds`}>
          <rect x={left} y={top} width={plotWidth} height={plotHeight} rx={8} fill={C.plot} />
          {baseline && <g className="erp-baseline-window"><rect x={baseline.x} y={top} width={baseline.width} height={plotHeight} fill={C.cyan} opacity={0.07} /><text x={baseline.x + 7} y={top + 16} fill={C.muted} fontSize={11}>Baseline</text></g>}
          {p300 && <g className="erp-p300-window"><rect x={p300.x} y={top} width={p300.width} height={plotHeight} fill={C.amber} opacity={0.09} /><text x={p300.x + 7} y={top + 16} fill={C.amber} fontSize={11}>P300 window</text></g>}
          {xTicks.map((time, index) => <g key={index}><line x1={x(time)} x2={x(time)} y1={top} y2={top + plotHeight} stroke={C.grid} /><text x={x(time)} y={height - 28} textAnchor="middle" fill={C.muted} fontSize={12}>{tick(time)}</text></g>)}
          {yTicks.map((uv, index) => <g key={index}><line x1={left} x2={left + plotWidth} y1={y(uv)} y2={y(uv)} stroke={uv === 0 ? '#536984' : C.grid} strokeWidth={uv === 0 ? 1.5 : 1} /><text x={left - 10} y={y(uv) + 4} textAnchor="end" fill={C.muted} fontSize={11}>{tick(uv)}</text></g>)}
          {sorted.map((curve) => <g key={curve.key} className={`erp-curve erp-${curve.key}`}>
            {ciAreas(curve.points, x, y).map((path, index) => <path key={`ci-${index}`} className="erp-ci" d={path} fill={curve.color} opacity={0.15} />)}
            {lineSegments(curve.points, (point) => finite(point.mean_uv) ? [x(point.time_ms), y(point.mean_uv)] : null).map((path, index) => <path key={`mean-${index}`} className="erp-mean" d={path} fill="none" stroke={curve.color} strokeWidth={curve.key === 'difference' ? 3 : 2.4} strokeLinecap="round" strokeLinejoin="round" />)}
          </g>)}
          <text x={left} y={height - 6} fill={C.muted} fontSize={11}>Amplitude (µV)</text>
          <text x={left + plotWidth} y={height - 6} textAnchor="end" fill={C.muted} fontSize={11}>Time (ms)</text>
        </svg>
      </div>
      <div className="erp-footer" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '12px 26px', justifyContent: 'space-between', marginTop: 10 }}>
        <div className="erp-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: C.muted, fontSize: 12 }}>
          {curves.map((curve) => <span key={curve.key} style={{ alignItems: 'center', display: 'inline-flex', gap: 7 }}><span aria-hidden="true" style={{ background: curve.color, borderRadius: 3, display: 'inline-block', height: 3, width: 18 }} />{curve.label}</span>)}
          <span>Shading = pointwise CI</span>
        </div>
        {erpMetrics(data)}
      </div>
    </section>
  );
}
