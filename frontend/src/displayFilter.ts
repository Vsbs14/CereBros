/**
 * Display-only EEG filtering, similar to the NeuroPawn EXG Visualizer (detrend, band-pass, 50/60 Hz notch).
 * Stateful per channel so it can run on streamed batches. Recordings and analysis always use raw data.
 */

type Coeffs = {b0: number; b1: number; b2: number; a1: number; a2: number};

function biquad(kind: 'highpass' | 'lowpass' | 'notch', fs: number, f0: number, q: number): Coeffs {
  const w = 2 * Math.PI * f0 / fs, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (kind === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2 }
  else if (kind === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2 }
  else { b0 = 1; b1 = -2 * cos; b2 = 1 }
  const a0 = 1 + alpha;
  return {b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * cos / a0, a2: (1 - alpha) / a0};
}

class Stage {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private c: Coeffs) {}
  prime(value: number) {
    // Start at steady state for a constant input so the electrode offset doesn't ring.
    const {b0, b1, b2, a1, a2} = this.c;
    const y = value * (b0 + b1 + b2) / (1 + a1 + a2);
    this.x1 = this.x2 = value; this.y1 = this.y2 = y;
  }
  step(x: number): number {
    const {b0, b1, b2, a1, a2} = this.c;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export interface DisplayFilterOptions {lowHz: number; highHz: number; notch: number[]}
export const DEFAULT_DISPLAY_FILTER: DisplayFilterOptions = {lowHz: 1, highHz: 40, notch: [50, 60]};

export class DisplayFilter {
  private chains: Stage[][] | null = null;
  private lastTime: number | null = null;
  constructor(private fs: number, private options: DisplayFilterOptions = DEFAULT_DISPLAY_FILTER) {}

  private build(): Stage[] {
    const nyquist = this.fs / 2, q = Math.SQRT1_2;
    const stages = [new Stage(biquad('highpass', this.fs, this.options.lowHz, q)), new Stage(biquad('highpass', this.fs, this.options.lowHz, q))];
    for (const f of this.options.notch) if (f < nyquist - 1) stages.push(new Stage(biquad('notch', this.fs, f, 8)));
    if (this.options.highHz < nyquist - 1) stages.push(new Stage(biquad('lowpass', this.fs, this.options.highHz, q)), new Stage(biquad('lowpass', this.fs, this.options.highHz, q)));
    return stages;
  }

  reset() { this.chains = null; this.lastTime = null }

  /** samples: sample x channel microvolts. Returns filtered copy; null/nonfinite values stay null and restart the filter. */
  process(timestamps: number[], samples: (number | null)[][]): (number | null)[][] {
    return samples.map((row, i) => {
      const t = timestamps[i];
      if (this.lastTime !== null && (t - this.lastTime > 1.5 / this.fs || t <= this.lastTime)) this.chains = null;
      this.lastTime = t;
      if (!this.chains) this.chains = row.map(() => this.build());
      if (this.chains.length !== row.length) this.chains = row.map(() => this.build());
      return row.map((value, c) => {
        const chain = this.chains![c];
        if (typeof value !== 'number' || !Number.isFinite(value)) { this.chains![c] = this.build(); return null }
        if ((chain as Stage[] & {primed?: boolean}).primed !== true) {
          let v = value; for (const stage of chain) { stage.prime(v); v = stage.step(v) }
          (chain as Stage[] & {primed?: boolean}).primed = true;
          return 0;
        }
        return chain.reduce((v, stage) => stage.step(v), value);
      });
    });
  }
}
