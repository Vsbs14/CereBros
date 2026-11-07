import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EEGChart, ERPChart, type ERPData } from './Charts';

const erpData: ERPData = {
  channel: 'Pz',
  source: 'Live headset',
  counts: { accepted: 18, rejected: 2, pending: 1 },
  standard: [
    { time_ms: -200, mean_uv: 0, ci_low_uv: -0.3, ci_high_uv: 0.3 },
    { time_ms: 0, mean_uv: -0.5, ci_low_uv: -0.8, ci_high_uv: -0.2 },
    { time_ms: 400, mean_uv: 1, ci_low_uv: 0.6, ci_high_uv: 1.4 },
    { time_ms: 800, mean_uv: 0, ci_low_uv: -0.3, ci_high_uv: 0.3 },
  ],
  deviant: [
    { time_ms: -200, mean_uv: 0, ci_low_uv: -0.4, ci_high_uv: 0.4 },
    { time_ms: 0, mean_uv: -0.4, ci_low_uv: -0.8, ci_high_uv: 0 },
    { time_ms: 400, mean_uv: 4, ci_low_uv: 3.4, ci_high_uv: 4.6 },
    { time_ms: 800, mean_uv: 0, ci_low_uv: -0.4, ci_high_uv: 0.4 },
  ],
  difference: [
    { time_ms: -200, mean_uv: 0, ci_low_uv: -0.4, ci_high_uv: 0.4 },
    { time_ms: 0, mean_uv: 0.1, ci_low_uv: -0.3, ci_high_uv: 0.5 },
    { time_ms: 400, mean_uv: 3, ci_low_uv: 2.4, ci_high_uv: 3.6 },
    { time_ms: 800, mean_uv: 0, ci_low_uv: -0.4, ci_high_uv: 0.4 },
  ],
  meanAmplitudeUv: 3,
  peakAmplitudeUv: 3.6,
  peakLatencyMs: 400,
};

describe('EEGChart', () => {
  it('shows an empty state without inventing a waveform', () => {
    const html = renderToStaticMarkup(<EEGChart emptyDetail="Start the backend" />);
    expect(html).toContain('No EEG Data Available');
    expect(html).toContain('Start the backend');
    expect(html).not.toContain('<path');
    expect(html).not.toContain('chart-badge');
  });

  it('reports an unavailable signal when samples carry no valid values', () => {
    const html = renderToStaticMarkup(<EEGChart source="Live headset" samples={[
      { time_s: 0, channels: { Fz: null } },
      { time_s: 1, channels: { Fz: null } },
    ]} />);
    expect(html).toContain('Signal Unavailable');
    expect(html).toContain('Source · Live headset');
    expect(html).not.toContain('<path');
  });

  it('renders every channel, mapping, source, marker, and seconds axis', () => {
    const html = renderToStaticMarkup(<EEGChart
      samples={[
        { time_s: 0, channels: { Fz: 2, Pz: -1 } },
        { time_s: 1, channels: { Fz: -2, Pz: 1 } },
        { time_s: 2, channels: { Fz: 1, Pz: 0 } },
      ]}
      channelMap={{ Fz: 'Frontal', Pz: 'Parietal' }}
      markers={[{ time_s: 1, label: 'Oddball', kind: 'deviant' }]}
      source="Live headset"
    />);
    expect(html).toContain('Source · Live headset');
    expect(html).toContain('2 Channels');
    expect(html).toContain('Frontal');
    expect(html).toContain('Parietal');
    expect(html).toContain('Oddball');
    expect(html).toContain('Time (s)');
    expect(html).toMatch(/Lane Height ±\d+ µV/);
    // One colour per channel lane.
    expect((html.match(/stroke="#5ed8e7"/g) ?? []).length).toBe(1);
    expect((html.match(/stroke="#b69aff"/g) ?? []).length).toBe(1);
  });

  it('breaks a trace at null rather than joining across missing samples', () => {
    const html = renderToStaticMarkup(<EEGChart samples={[
      { time_s: 0, channels: { Fz: 1 } },
      { time_s: 1, channels: { Fz: null } },
      { time_s: 2, channels: { Fz: -1 } },
    ]} />);
    expect((html.match(/stroke="#5ed8e7"/g) ?? []).length).toBe(2);
  });

  it('places positive microvolts above negative microvolts', () => {
    const html = renderToStaticMarkup(<EEGChart samples={[
      { time_s: 0, channels: { Fz: 2 } },
      { time_s: 1, channels: { Fz: -2 } },
    ]} />);
    const trace = html.match(/<path d="M[\d.]+,([\d.]+) L[\d.]+,([\d.]+)"[^>]*stroke="#5ed8e7"/);
    expect(trace).not.toBeNull();
    expect(Number(trace?.[1])).toBeLessThan(Number(trace?.[2]));
  });
});

describe('EEGChart lanes', () => {
  it('removes each channel offset so a large DC offset does not squash other channels', () => {
    const html = renderToStaticMarkup(<EEGChart samples={[0, 1, 2, 3].map((t) => ({ time_s: t, channels: { CH1: -50000 + (t % 2 ? 10 : -10), CH2: t % 2 ? 10 : -10 } }))} />);
    expect(html).toContain('Lane Height ±10 µV');
    expect(html).not.toContain('Clipped');
  });

  it('marks channels that exceed a fixed scale as clipped and only shows requested channels', () => {
    const html = renderToStaticMarkup(<EEGChart scaleUv={10} channels={['CH2']} samples={[0, 1, 2].map((t) => ({ time_s: t, channels: { CH1: 0, CH2: t * 100 } }))} />);
    expect(html).toContain('Clipped');
    expect(html).toContain('1 Channel<');
  });
});

describe('ERPChart', () => {
  it('shows an empty state without source or fake curves', () => {
    const html = renderToStaticMarkup(<ERPChart />);
    expect(html).toContain('No ERP Data Available');
    expect(html).not.toContain('erp-mean');
  });

  it('renders three means, pointwise confidence bands, windows, counts, and summaries', () => {
    const html = renderToStaticMarkup(<ERPChart data={erpData} />);
    expect(html).toContain('Channel · Pz');
    expect(html).toContain('Source · Live headset');
    expect(html).toContain('Accepted · 18');
    expect(html).toContain('Rejected · 2');
    expect(html).toContain('Pending · 1');
    expect(html).toContain('Provisional');
    expect(html).toContain('Baseline');
    expect(html).toContain('P300 Window');
    expect(html).toContain('Mean P300 Amplitude');
    expect(html).toContain('3 µV');
    expect(html).toContain('Peak Amplitude');
    expect(html).toContain('3.6 µV');
    expect(html).toContain('400 ms');
    expect(html).toContain('Shading = Pointwise CI');
    expect((html.match(/class="erp-mean"/g) ?? []).length).toBe(3);
    expect((html.match(/class="erp-ci"/g) ?? []).length).toBe(3);
  });

  it('uses configured windows and treats null means and metrics as unavailable', () => {
    const data: ERPData = {
      ...erpData,
      standard: [
        { time_ms: -200, mean_uv: 0 },
        { time_ms: 0, mean_uv: null, ci_low_uv: -1, ci_high_uv: 1 },
        { time_ms: 400, mean_uv: 1 },
      ],
      deviant: [],
      difference: [],
      meanAmplitudeUv: null,
      peakAmplitudeUv: null,
      peakLatencyMs: null,
    };
    const html = renderToStaticMarkup(<ERPChart data={data} baselineWindowMs={[-100, 50]} p300WindowMs={[250, 450]} />);
    expect(html).toContain('P300 Window 250–450 ms');
    expect((html.match(/class="erp-mean"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('class="erp-ci"');
    expect((html.match(/Unavailable/g) ?? []).length).toBe(3);
    expect(html).toContain('erp-baseline-window');
    expect(html).toContain('erp-p300-window');
  });

  it('keeps unavailable summaries visible when no ERP means exist', () => {
    const html = renderToStaticMarkup(<ERPChart data={{ ...erpData, standard: [], deviant: [], difference: [], meanAmplitudeUv: null, peakAmplitudeUv: null, peakLatencyMs: null }} />);
    expect(html).toContain('Insufficient Data for an Averaged ERP');
    expect(html).toContain('Accepted · 18');
    expect((html.match(/Unavailable/g) ?? []).length).toBe(3);
    expect(html).not.toContain('erp-mean');
  });
});
