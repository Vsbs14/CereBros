import {describe, expect, it} from 'vitest';
import {DisplayFilter} from './displayFilter';

const fs = 125;
function signal(seconds: number, fn: (t: number) => number) {
  const ts = Array.from({length: seconds * fs}, (_, i) => 1000 + i / fs);
  return {ts, rows: ts.map((t) => [fn(t)])};
}
const rms = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);

describe('DisplayFilter', () => {
  it('removes DC offset and 60 Hz hum but keeps 10 Hz alpha', () => {
    const {ts, rows} = signal(6, (t) => -80000 + 100000 * Math.sin(2 * Math.PI * 60 * t) + 20 * Math.sin(2 * Math.PI * 10 * t));
    const out = new DisplayFilter(fs).process(ts, rows).slice(3 * fs).map((r) => r[0] as number);
    expect(rms(out)).toBeGreaterThan(10);
    expect(rms(out)).toBeLessThan(25);
  });

  it('keeps state across batches and restarts on gaps or missing values', () => {
    const f = new DisplayFilter(fs);
    const {ts, rows} = signal(2, (t) => 5 * Math.sin(2 * Math.PI * 10 * t));
    const a = f.process(ts.slice(0, 100), rows.slice(0, 100));
    const b = f.process(ts.slice(100), rows.slice(100));
    expect(a.length + b.length).toBe(rows.length);
    expect(f.process([5000], [[null]])[0][0]).toBeNull();
    expect(f.process([6000], [[123]])[0][0]).toBe(0);
  });
});
