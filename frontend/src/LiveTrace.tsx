import { useEffect, useRef } from 'react';
import type { SignalSim } from './demo';

interface LiveTraceProps {
  sim: SignalSim;
  /** Live: scroll a window ending at `clock()`. Static: draw `range` once the samples exist. */
  clock?: () => number;
  range?: readonly [number, number];
  windowS?: number;
  /** Shade each word's response window (result view). */
  showResponses?: boolean;
  /** Number the word markers instead of naming them, so the screen never gives a word away while listening. */
  numbered?: boolean;
  height?: number;
  label: string;
}

const SCALE_UV = 48;

function token(el: Element, name: string, fallback: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export function LiveTrace({ sim, clock, range, windowS = 6, showResponses = false, numbered = false, height = 220, label }: LiveTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(h * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, h);

      const now = clock?.();
      if (now !== undefined) sim.advance(now);
      const [t0, t1] = range ?? [(now ?? 0) - windowS, now ?? windowS];
      const top = 34;
      const bottom = h - 22;
      const mid = (top + bottom) / 2;
      const x = (t: number) => ((t - t0) / (t1 - t0)) * width;
      const y = (uv: number) => mid - (uv / SCALE_UV) * (bottom - top) / 2;

      const trace = token(canvas, '--signal-blue', '#287794');
      const grid = token(canvas, '--chart-grid', '#dae5eb');
      const muted = token(canvas, '--chart-text', '#526975');
      const known = token(canvas, '--status-ok', '#348269');
      const unknown = token(canvas, '--difference-salmon', '#a9503f');
      const ink = token(canvas, '--text', '#293e48');

      // Grid: one line per second, scrolling with the signal.
      context.strokeStyle = grid;
      context.lineWidth = 1;
      for (let s = Math.ceil(t0); s <= t1; s++) {
        context.beginPath();
        context.moveTo(Math.round(x(s)) + 0.5, top);
        context.lineTo(Math.round(x(s)) + 0.5, bottom);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(0, Math.round(mid) + 0.5);
      context.lineTo(width, Math.round(mid) + 0.5);
      context.stroke();

      context.font = '600 13px Epilogue, "Segoe UI", system-ui, sans-serif';
      context.textBaseline = 'middle';
      sim.events.forEach((event, index) => {
        if (event.t < t0 - 1 || event.t > t1) return;
        const color = showResponses && !event.familiar ? unknown : known;
        if (showResponses) {
          context.globalAlpha = event.familiar ? 0.1 : 0.2;
          context.fillStyle = color;
          context.fillRect(x(event.t + 0.22), top, x(event.t + 0.68) - x(event.t + 0.22), bottom - top);
          context.globalAlpha = 1;
        }
        const ex = Math.round(x(event.t)) + 0.5;
        context.strokeStyle = muted;
        context.globalAlpha = 0.6;
        context.setLineDash([3, 4]);
        context.beginPath();
        context.moveTo(ex, top - 4);
        context.lineTo(ex, bottom);
        context.stroke();
        context.setLineDash([]);
        context.globalAlpha = 1;
        context.fillStyle = showResponses ? color : ink;
        context.fillText(numbered ? String(index + 1) : event.label, ex + 6, 14);
      });

      // Trace
      const { times, values } = sim;
      let start = 0;
      for (let lo = 0, hi = times.length - 1; lo <= hi;) {
        const m = (lo + hi) >> 1;
        if (times[m] < t0) { lo = m + 1; start = lo; } else hi = m - 1;
      }
      context.strokeStyle = trace;
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.beginPath();
      let lastX = 0;
      let lastY = mid;
      for (let i = Math.max(0, start - 1); i < times.length && times[i] <= t1; i++) {
        lastX = x(times[i]);
        lastY = y(Math.max(-SCALE_UV * 1.15, Math.min(SCALE_UV * 1.15, values[i])));
        if (i <= start) context.moveTo(lastX, lastY); else context.lineTo(lastX, lastY);
      }
      context.stroke();
      if (now !== undefined) {
        context.fillStyle = trace;
        context.beginPath();
        context.arc(lastX, lastY, 4, 0, Math.PI * 2);
        context.fill();
      }

      // Scale bar
      const bar = (20 / SCALE_UV) * (bottom - top) / 2;
      context.strokeStyle = muted;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(4.5, bottom);
      context.lineTo(4.5, bottom - bar);
      context.stroke();
      context.fillStyle = muted;
      context.font = '500 11px Epilogue, "Segoe UI", system-ui, sans-serif';
      context.fillText('20 µV  ·  grid 1 s', 0, h - 8);

      if (clock || !range) frame = requestAnimationFrame(draw);
    };
    draw();
    // Static traces redraw on resize and theme change only.
    const observer = new ResizeObserver(() => { if (!clock) draw(); });
    observer.observe(canvas);
    const themeWatch = new MutationObserver(() => { if (!clock) draw(); });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); themeWatch.disconnect(); };
  }, [sim, clock, range, windowS, showResponses, numbered]);

  return <canvas ref={canvasRef} className="live-trace" style={{ height }} role="img" aria-label={label} />;
}
