import type { CSSProperties, ReactNode } from 'react';

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
  /** Context-specific guidance shown when no samples are available, e.g. what is needed to start a stream. */
  emptyDetail?: ReactNode;
  className?: string;
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
  /** Context-specific guidance shown when no ERP data is available. */
  emptyDetail?: ReactNode;
  className?: string;
}

const C = {
  panel: '#ffffff',
  plot: '#f4f8fa',
  border: '#ccdbe2',
  grid: '#dae5eb',
  text: '#253c48',
  muted: '#526975',
  cyan: '#287794',
  violet: '#795daa',
  amber: '#a9503f',
  green: '#348269',
};

const panelStyle: CSSProperties = {
  background: C.panel,
  border: 0,
  borderRadius: 0,
  color: C.text,
  fontFamily: 'inherit',
  padding: '0',

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

function emptyState(message: string, detail?: ReactNode) {
  return <div className="chart-empty"><strong>{message}</strong>{detail && <p>{detail}</p>}</div>;
}

function chartHeader(title: string, subtitle: string, badges: string[]) {
  return (
    <div className="chart-header">
      <div>
        <div className="chart-title">{title}</div>
        <div className="chart-subtitle">{subtitle}</div>
      </div>
      {badges.length > 0 && <div className="chart-badges">
        {badges.map((badge) => <span className="chart-badge" key={badge}>{badge}</span>)}
      </div>}
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

export function EEGChart({ samples = [], channels, channelMap, markers = [], source, emptyDetail, className }: EEGChartProps) {
  const ordered = [...samples].filter((sample) => finite(sample.time_s)).sort((a, b) => a.time_s - b.time_s);
  const names = [...new Set([...(channels ?? []), ...ordered.flatMap((sample) => Object.keys(sample.channels))])];
  const subtitle = 'Time (s) · Amplitude (µV), Positive Up';
  if (!ordered.length || !names.length) {
    return <section className={`eeg-chart ${className ?? ''}`.trim()} style={panelStyle}>{chartHeader('Continuous EEG', subtitle, [])}{emptyState('No EEG Data Available', emptyDetail)}</section>;
  }
  const title = chartHeader('Continuous EEG', subtitle, [source ? `Source · ${source}` : 'Source Unavailable', `${names.length} Channels`]);
  if (!ordered.some((sample) => names.some((name) => finite(sample.channels[name])))) {
    return <section className={`eeg-chart ${className ?? ''}`.trim()} style={panelStyle}>{title}{emptyState('Signal Unavailable', 'Samples are arriving without valid values on any channel. Check electrode contact and the headset connection.')}</section>;
  }

  const width = 960;
  const left = 110;
  const right = 26;
  const top = 35;
  const lane = 94;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = names.length * lane;
  const height = top + plotHeight + bottom;
  const [minTime, maxTime] = extent(ordered.map((sample) => sample.time_s));
  const x = (time: number) => left + ((time - minTime) / (maxTime - minTime)) * plotWidth;
  const amplitudes = ordered.flatMap((sample) => names.map((name) => sample.channels[name]).filter(finite));
  const scale = amplitudes.reduce((current, value) => Math.max(current, Math.abs(value)), 1);
  const y = (index: number, uv: number) => top + lane * (index + 0.5) - (uv / scale) * (lane * 0.36);
  const timeTicks = Array.from({ length: 5 }, (_, index) => minTime + (maxTime - minTime) * index / 4);
  const visibleMarkers = markers.filter((marker) => finite(marker.time_s) && marker.time_s >= minTime && marker.time_s <= maxTime);
  const markerColor = (kind: EEGMarker['kind']) => kind === 'deviant' ? C.amber : kind === 'response' ? C.green : C.violet;

  return (
    <section className={`eeg-chart ${className ?? ''}`.trim()} style={panelStyle}>
      {title}
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', minWidth: 650, width: '100%' }} role="img" aria-label={`EEG signals for ${names.join(', ')} from ${tick(minTime)} to ${tick(maxTime)} seconds`}>
          <rect x={left} y={top} width={plotWidth} height={plotHeight} rx={8} fill={C.plot} />
          {timeTicks.map((time, index) => <g key={index}>
            <line x1={x(time)} x2={x(time)} y1={top} y2={top + plotHeight} stroke={C.grid} strokeWidth={1} />
            <text x={x(time)} y={height - 17} textAnchor="middle" fill={C.muted} fontSize={12}>{tick(time)}</text>
          </g>)}
          {names.map((name, index) => {
            const center = top + lane * (index + 0.5);
            const paths = lineSegments(ordered, (sample) => {
              const uv = sample.channels[name];
              return finite(uv) ? [x(sample.time_s), y(index, uv)] : null;
            });
            return <g key={name}>
              {index > 0 && <line x1={left} x2={left + plotWidth} y1={top + lane * index} y2={top + lane * index} stroke={C.border} />}
              <line x1={left} x2={left + plotWidth} y1={center} y2={center} stroke={C.grid} strokeDasharray="4 5" />
              <text x={left - 13} y={center - (channelMap?.[name] ? 5 : 0)} textAnchor="end" fill={C.text} fontSize={13} fontWeight={700}>{name}</text>
              {channelMap?.[name] && <text x={left - 13} y={center + 12} textAnchor="end" fill={C.muted} fontSize={10}>{channelMap[name]}</text>}
              {paths.map((path, segment) => <path key={segment} d={path} fill="none" stroke={C.cyan} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />)}
            </g>;
          })}
          {visibleMarkers.map((marker, index) => <g key={`${marker.time_s}-${marker.label}-${index}`}>
            <line x1={x(marker.time_s)} x2={x(marker.time_s)} y1={top} y2={top + plotHeight} stroke={markerColor(marker.kind)} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.8} />
            <text x={x(marker.time_s) + 4} y={top - 12} fill={markerColor(marker.kind)} fontSize={11}>{marker.label}</text>
          </g>)}
          <text x={left} y={height - 3} fill={C.muted} fontSize={11}>Scale ±{tick(scale)} µV</text>
          <text x={left + plotWidth} y={height - 3} textAnchor="end" fill={C.muted} fontSize={11}>Time (s)</text>
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
  return <div className="erp-metrics">
    <span>P300-Window Mean Amplitude <strong>{summaryValue(data.meanAmplitudeUv, 'µV')}</strong></span>
    <span>Peak Amplitude <strong>{summaryValue(data.peakAmplitudeUv, 'µV')}</strong></span>
    <span>Peak Latency <strong>{summaryValue(data.peakLatencyMs, 'ms')}</strong></span>
  </div>;
}

export function ERPChart({ data, baselineWindowMs = [-200, 0], p300WindowMs = [300, 600], emptyDetail, className }: ERPChartProps) {
  const subtitle = `Time (ms) · Amplitude (µV), Positive Up · P300 Window ${tick(p300WindowMs[0])}–${tick(p300WindowMs[1])} ms`;
  const heading = chartHeader('Averaged ERP', subtitle, data ? [`Channel · ${data.channel}`, `Source · ${data.source}`, ...((data.provisional ?? data.counts.pending > 0) ? ['Provisional'] : [])] : []);
  if (!data) {
    return <section className={`erp-chart ${className ?? ''}`.trim()} style={panelStyle}>{heading}{emptyState('No ERP Data Available', emptyDetail)}</section>;
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
  const countBadges = <div className="erp-counts">
    <span className="chart-badge">Accepted · {counts.accepted}</span>
    <span className="chart-badge">Rejected · {counts.rejected}</span>
    <span className="chart-badge">Pending · {counts.pending}</span>
  </div>;
  if (!hasMean) {
    return <section className={`erp-chart ${className ?? ''}`.trim()} style={panelStyle}>{heading}{countBadges}{emptyState('Insufficient Data for an Averaged ERP', 'Further accepted standard and deviant trials are needed before an average can be shown.')}{erpMetrics(data)}</section>;
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
          {p300 && <g className="erp-p300-window"><rect x={p300.x} y={top} width={p300.width} height={plotHeight} fill={C.amber} opacity={0.09} /><text x={p300.x + 7} y={top + 16} fill={C.amber} fontSize={11}>P300 Window</text></g>}
          {xTicks.map((time, index) => <g key={index}><line x1={x(time)} x2={x(time)} y1={top} y2={top + plotHeight} stroke={C.grid} /><text x={x(time)} y={height - 28} textAnchor="middle" fill={C.muted} fontSize={12}>{tick(time)}</text></g>)}
          {yTicks.map((uv, index) => <g key={index}><line x1={left} x2={left + plotWidth} y1={y(uv)} y2={y(uv)} stroke={uv === 0 ? '#8097a3' : C.grid} strokeWidth={uv === 0 ? 1.5 : 1} /><text x={left - 10} y={y(uv) + 4} textAnchor="end" fill={C.muted} fontSize={11}>{tick(uv)}</text></g>)}
          {sorted.map((curve) => <g key={curve.key} className={`erp-curve erp-${curve.key}`}>
            {ciAreas(curve.points, x, y).map((path, index) => <path key={`ci-${index}`} className="erp-ci" d={path} fill={curve.color} opacity={0.15} />)}
            {lineSegments(curve.points, (point) => finite(point.mean_uv) ? [x(point.time_ms), y(point.mean_uv)] : null).map((path, index) => <path key={`mean-${index}`} className="erp-mean" d={path} fill="none" stroke={curve.color} strokeWidth={curve.key === 'difference' ? 3 : 2.4} strokeLinecap="round" strokeLinejoin="round" />)}
          </g>)}
          <text x={left} y={height - 6} fill={C.muted} fontSize={11}>Amplitude (µV)</text>
          <text x={left + plotWidth} y={height - 6} textAnchor="end" fill={C.muted} fontSize={11}>Time (ms)</text>
        </svg>
      </div>
      <div className="erp-footer">
        <div className="erp-legend">
          {curves.map((curve) => <span key={curve.key}><span aria-hidden="true" style={{ background: curve.color, borderRadius: 3, display: 'inline-block', height: 3, width: 18 }} />{curve.label}</span>)}
          <span>Shading = Pointwise CI</span>
        </div>
        {erpMetrics(data)}
      </div>
    </section>
  );
}
