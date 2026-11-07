/** Audio scheduling primitives. This module deliberately has no HTTP endpoints. */

export interface ClockSync {
  /** Server seconds minus performance.now() seconds. */
  serverOffsetSeconds: number;
  rttSeconds: number;
  /** Half the measured RTT: a network timing estimate, not a guaranteed error bound. */
  uncertaintySeconds: number;
  sampledAtPerformanceMs: number;
}

export interface ClockSyncOptions {
  /** Return a server timestamp in seconds, measured during this request. */
  fetchServerTime: (signal: AbortSignal) => Promise<number>;
  attempts?: number;
  nowMs?: () => number;
  signal?: AbortSignal;
}

/** Take the lowest-RTT sample and map its server timestamp to the client midpoint. */
export async function syncBestClock(options: ClockSyncOptions): Promise<ClockSync> {
  const attempts = options.attempts ?? 5;
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("attempts must be a positive integer");
  const nowMs = options.nowMs ?? (() => performance.now());
  const signal = options.signal ?? new AbortController().signal;
  let best: ClockSync | undefined;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const sent = nowMs();
    try {
      const server = await options.fetchServerTime(signal);
      const received = nowMs();
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (![sent, received, server].every(Number.isFinite) || received < sent) {
        throw new Error("Invalid clock sample");
      }
      const rttSeconds = (received - sent) / 1000;
      const sample: ClockSync = {
        serverOffsetSeconds: server - (sent + received) / 2000,
        rttSeconds,
        uncertaintySeconds: rttSeconds / 2,
        sampledAtPerformanceMs: (sent + received) / 2,
      };
      if (!best || sample.rttSeconds < best.rttSeconds) best = sample;
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      lastError = error;
    }
  }
  if (!best) throw lastError ?? new Error("Clock synchronization failed");
  return best;
}

export interface OutputTiming {
  contextTime: number;
  performanceTimeMs: number;
  serverSeconds: number;
  /** Network timing estimate from half the sampled RTT; not a physical output bound. */
  networkUncertaintySeconds: number;
  /** getOutputTimestamp does not measure speaker or headphone physical latency. */
  physicalLatencySeconds: null;
}

/** Convert a server-plan time through Web Audio's output timestamp correlation. */
export function serverSecondsToContextTime(
  context: Pick<AudioContext, "getOutputTimestamp">,
  sync: ClockSync,
  serverSeconds: number,
): OutputTiming {
  const stamp = context.getOutputTimestamp();
  const stampContextTime = stamp.contextTime;
  const stampPerformanceTime = stamp.performanceTime;
  if (![serverSeconds, sync.serverOffsetSeconds, sync.uncertaintySeconds,
    stampContextTime, stampPerformanceTime].every(Number.isFinite) ||
    stampContextTime === undefined || stampPerformanceTime === undefined) {
    throw new Error("A valid getOutputTimestamp() and clock sync are required");
  }
  const performanceTimeMs = (serverSeconds - sync.serverOffsetSeconds) * 1000;
  return {
    contextTime: stampContextTime + (performanceTimeMs - stampPerformanceTime) / 1000,
    performanceTimeMs,
    serverSeconds,
    networkUncertaintySeconds: sync.uncertaintySeconds,
    physicalLatencySeconds: null,
  };
}

export interface PreparedAudioAsset {
  id: string;
  kind: "upload" | "synthetic-demo";
  displayName: string;
  buffer: AudioBuffer;
  sha256?: string;
}

/** Hash original bytes before decoding; duplicate files therefore share an identity. */
export async function prepareAudioUpload(
  file: Blob & { name?: string },
  context: Pick<AudioContext, "decodeAudioData">,
  digest: SubtleCrypto = globalThis.crypto.subtle,
): Promise<PreparedAudioAsset> {
  const bytes = await file.arrayBuffer();
  const [hash, buffer] = await Promise.all([
    digest.digest("SHA-256", bytes),
    context.decodeAudioData(bytes.slice(0)),
  ]);
  const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    id: `sha256:${sha256}`,
    kind: "upload",
    displayName: file.name || "Uploaded audio",
    buffer,
    sha256,
  };
}

/** Explicitly labelled fallback for demos without a recorded stimulus. */
export function createSyntheticToneDemo(
  context: Pick<AudioContext, "sampleRate" | "createBuffer">,
  options: { frequencyHz?: number; durationSeconds?: number; amplitude?: number } = {},
): PreparedAudioAsset {
  const frequencyHz = options.frequencyHz ?? 440;
  const durationSeconds = options.durationSeconds ?? 0.25;
  const amplitude = options.amplitude ?? 0.15;
  if (!(Number.isFinite(context.sampleRate) && context.sampleRate > 0 &&
    Number.isFinite(frequencyHz) && frequencyHz > 0 && frequencyHz < context.sampleRate / 2 &&
    Number.isFinite(durationSeconds) && durationSeconds > 0 &&
    Number.isFinite(amplitude) && amplitude > 0 && amplitude <= 1)) {
    throw new RangeError("Invalid synthetic tone parameters");
  }
  const frames = Math.max(1, Math.round(context.sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const edge = Math.min(1, i / (context.sampleRate * 0.005), (frames - 1 - i) / (context.sampleRate * 0.005));
    samples[i] = amplitude * Math.max(0, edge) * Math.sin(2 * Math.PI * frequencyHz * i / context.sampleRate);
  }
  return {
    id: `synthetic-demo:${frequencyHz}:${durationSeconds}:${amplitude}`,
    kind: "synthetic-demo",
    displayName: "Synthetic tone demo (not a recorded stimulus)",
    buffer,
  };
}

/** One backend-planned trial. Its marker is emitted only after its source is scheduled. */
export interface PlanEvent {
  kind: "stimulus";
  id: string;
  markerId: string;
  atServerSeconds: number;
  assetId: string;
  durationSeconds: number;
  label?: string;
}

export interface CaptureWindow {
  startServerSeconds: number;
  endServerSeconds: number;
  baselineSeconds: number;
  epochEndpointSeconds: number;
  safetyMarginSeconds: number;
}

/** Continue recording through the last epoch endpoint and a positive safety margin. */
export function captureWindowForPlan(
  plan: readonly PlanEvent[], baselineSeconds: number, epochEndpointSeconds: number, safetyMarginSeconds: number,
): CaptureWindow {
  if (!plan.length || !Number.isFinite(baselineSeconds) || baselineSeconds < 0 ||
      !Number.isFinite(epochEndpointSeconds) || epochEndpointSeconds <= 0 ||
      !Number.isFinite(safetyMarginSeconds) || safetyMarginSeconds <= 0) throw new RangeError("Invalid capture window");
  validatePlan(plan);
  const end = Math.max(...plan.map(event => event.atServerSeconds + Math.max(event.durationSeconds, epochEndpointSeconds)));
  return {
    startServerSeconds: plan[0].atServerSeconds - baselineSeconds,
    endServerSeconds: end + safetyMarginSeconds,
    baselineSeconds,
    epochEndpointSeconds,
    safetyMarginSeconds,
  };
}

function validatePlan(plan: readonly PlanEvent[]): void {
  let previous = -Infinity;
  const ids = new Set<string>();
  const markerIds = new Set<string>();
  for (const event of plan) {
    if (event.kind !== "stimulus" || !event.id || ids.has(event.id) || !event.markerId || markerIds.has(event.markerId) ||
        !Number.isFinite(event.atServerSeconds) || event.atServerSeconds < previous || !event.assetId ||
        !Number.isFinite(event.durationSeconds) || event.durationSeconds < 0) {
      throw new Error("Plan must be ordered, finite, and have unique event IDs");
    }
    ids.add(event.id);
    markerIds.add(event.markerId);
    previous = event.atServerSeconds;
  }
}

export interface ScheduledMarker {
  id: string;
  trialId: string;
  label?: string;
  scheduledServerSeconds: number;
  scheduledContextTime: number;
  timing_method: "getOutputTimestamp";
  /** Network timing estimate only; device output latency is unknown. */
  networkUncertaintySeconds: number;
  physicalLatencySeconds: null;
}

export type PlaybackAbortReason = "hidden" | "audio-lost" | "marker-error" | "manual";

export interface PlaybackHandle {
  readonly aborted: boolean;
  readonly abortReason: PlaybackAbortReason | null;
  abort: (reason?: PlaybackAbortReason) => void;
  /** Removes listeners after successful playback; it does not replay markers. */
  dispose: () => void;
}

export interface VisibilityMonitor {
  readonly hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: EventListener) => void;
  removeEventListener: (type: "visibilitychange", listener: EventListener) => void;
}

export interface SchedulePlanOptions {
  context: AudioContext;
  sync: ClockSync;
  plan: readonly PlanEvent[];
  assets: ReadonlyMap<string, PreparedAudioAsset>;
  /** Session-wide ledger prevents stimulus retries or replays. */
  trialLedger: Set<string>;
  /** Session-wide ledger prevents marker retries or replays, even under a new trial ID. */
  markerLedger: Set<string>;
  sendMarker: (marker: ScheduledMarker) => void | Promise<void>;
  onAbort?: (reason: PlaybackAbortReason, error?: unknown) => void;
  visibility?: VisibilityMonitor | null;
}

/** Schedule an already ordered backend plan. Marker callback failures stop all audio. */
export function scheduleOrderedPlan(options: SchedulePlanOptions): PlaybackHandle {
  const { context, sync, plan, assets, trialLedger, markerLedger, sendMarker, onAbort } = options;
  validatePlan(plan);
  const visibility = options.visibility === undefined
    ? (typeof document === "undefined" ? null : document)
    : options.visibility;
  if (visibility?.hidden) throw new Error("Cannot schedule while document is hidden");
  if (context.state !== "running") throw new Error("Audio context is not running");

  // Preflight conversion and assets before creating any source or sending a marker.
  const scheduled = plan.filter(event => !trialLedger.has(event.id) && !markerLedger.has(event.markerId)).map(event => {
    if (!assets.has(event.assetId)) throw new Error(`Missing audio asset: ${event.assetId}`);
    const timing = serverSecondsToContextTime(context, sync, event.atServerSeconds);
    if (timing.contextTime <= context.currentTime) throw new Error(`Trial ${event.id} is scheduled in the past`);
    return { event, timing };
  });
  const sources: AudioBufferSourceNode[] = [];
  let abortReason: PlaybackAbortReason | null = null;
  let disposed = false;
  const cleanup = () => {
    visibility?.removeEventListener("visibilitychange", onVisibility);
    context.removeEventListener("statechange", onStateChange);
    context.removeEventListener("sinkchange", onSinkChange);
  };
  const abort = (reason: PlaybackAbortReason = "manual", error?: unknown) => {
    if (abortReason || disposed) return;
    abortReason = reason;
    cleanup();
    for (const source of sources) {
      try { source.stop(); } catch { /* source may have already ended */ }
      source.disconnect();
    }
    onAbort?.(reason, error);
  };
  const onVisibility: EventListener = () => { if (visibility?.hidden) abort("hidden"); };
  const onStateChange: EventListener = () => { if (context.state !== "running") abort("audio-lost"); };
  const onSinkChange: EventListener = () => { abort("audio-lost"); };
  visibility?.addEventListener("visibilitychange", onVisibility);
  context.addEventListener("statechange", onStateChange);
  context.addEventListener("sinkchange", onSinkChange);

  try {
    for (const { event, timing } of scheduled) {
      if (abortReason) break;
      if (trialLedger.has(event.id) || markerLedger.has(event.markerId)) continue;
      if (visibility?.hidden) { abort("hidden"); break; }
      if (context.state !== "running") { abort("audio-lost"); break; }
      if (timing.contextTime <= context.currentTime) throw new Error(`Trial ${event.id} is scheduled in the past`);
      trialLedger.add(event.id); // a failed start is also a spent attempt
      const source = context.createBufferSource();
      source.buffer = assets.get(event.assetId)!.buffer;
      source.connect(context.destination);
      sources.push(source);
      source.start(timing.contextTime);
      if (abortReason) break;
      if (visibility?.hidden) { abort("hidden"); break; }
      if (context.state !== "running") { abort("audio-lost"); break; }
      markerLedger.add(event.markerId);
      const marker: ScheduledMarker = {
        id: event.markerId,
        trialId: event.id,
        label: event.label,
        scheduledServerSeconds: event.atServerSeconds,
        scheduledContextTime: timing.contextTime,
        timing_method: "getOutputTimestamp",
        networkUncertaintySeconds: timing.networkUncertaintySeconds,
        physicalLatencySeconds: null,
      };
      try {
        Promise.resolve(sendMarker(marker)).catch(error => abort("marker-error", error));
      } catch (error) {
        abort("marker-error", error);
      }
    }
  } catch (error) {
    abort("audio-lost", error);
    throw error;
  }
  return {
    get aborted() { return abortReason !== null; },
    get abortReason() { return abortReason; },
    abort,
    dispose: () => { if (!disposed) { disposed = true; cleanup(); } },
  };
}
