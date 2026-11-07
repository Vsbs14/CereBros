import { describe, expect, it, vi } from "vitest";
import {
  captureWindowForPlan, createSyntheticToneDemo, prepareAudioUpload, scheduleOrderedPlan,
  serverSecondsToContextTime, syncBestClock,
  type ClockSync, type PlanEvent, type PreparedAudioAsset, type VisibilityMonitor,
} from "./audio";

const sync: ClockSync = {
  serverOffsetSeconds: 100, rttSeconds: 0.04, uncertaintySeconds: 0.02, sampledAtPerformanceMs: 1000,
};
const plan: PlanEvent[] = [
  { kind: "stimulus", id: "s1", markerId: "m1", atServerSeconds: 102, assetId: "a", durationSeconds: 1 },
  { kind: "stimulus", id: "s2", markerId: "m2", atServerSeconds: 102.5, assetId: "a", durationSeconds: 1 },
];
const assets = new Map<string, PreparedAudioAsset>([["a", {
  id: "a", kind: "upload", displayName: "audio", buffer: {} as AudioBuffer,
}]]);

function fakeContext(startError?: Error) {
  const events = new EventTarget();
  const sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const raw = {
    state: "running", currentTime: 12, destination: {},
    getOutputTimestamp: () => ({ contextTime: 12, performanceTime: 1000 }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    createBufferSource: () => {
      const source = { buffer: null, connect: vi.fn(),
        start: vi.fn(() => { if (startError) throw startError; }), stop: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    },
  };
  return { context: raw as unknown as AudioContext, raw, events, sources };
}

function fakeVisibility() {
  const events = new EventTarget();
  const raw = { hidden: false, addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events) };
  return { monitor: raw as VisibilityMonitor, raw, events };
}

describe("clock and assets", () => {
  it("chooses the lowest RTT sample and reports its network timing estimate", async () => {
    const times = [0, 100, 200, 220, 300, 360];
    const servers = [10.05, 10.21, 10.33];
    expect(await syncBestClock({ attempts: 3, nowMs: () => times.shift()!,
      fetchServerTime: async () => servers.shift()! })).toEqual({
        serverOffsetSeconds: 10, rttSeconds: 0.02, uncertaintySeconds: 0.01, sampledAtPerformanceMs: 210,
      });
  });

  it("maps through getOutputTimestamp without claiming physical latency", () => {
    const getOutputTimestamp = vi.fn(() => ({ contextTime: 12, performanceTime: 1000 }));
    expect(serverSecondsToContextTime({ getOutputTimestamp }, sync, 102)).toEqual({
      contextTime: 13, performanceTimeMs: 2000, serverSeconds: 102,
      networkUncertaintySeconds: 0.02, physicalLatencySeconds: null,
    });
    expect(getOutputTimestamp).toHaveBeenCalledOnce();
    expect(() => serverSecondsToContextTime({ getOutputTimestamp: () => ({ contextTime: NaN, performanceTime: 1 }) }, sync, 102)).toThrow();
  });

  it("hashes original upload bytes and decodes a copy", async () => {
    const upload = Object.assign(new Blob([new Uint8Array([1, 2, 3])]), { name: "sample.wav" });
    const buffer = {} as AudioBuffer;
    const decodeAudioData = vi.fn(async (data: ArrayBuffer) => {
      expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3]); return buffer;
    });
    const digest = { digest: vi.fn(async (_algorithm: string, data: ArrayBuffer) => {
      expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3]);
      return new Uint8Array([0, 15, 255]).buffer;
    }) } as unknown as SubtleCrypto;
    expect(await prepareAudioUpload(upload, { decodeAudioData }, digest)).toEqual({
      id: "sha256:000fff", kind: "upload", displayName: "sample.wav", buffer, sha256: "000fff",
    });
  });

  it("labels a generated asset as a synthetic demo", () => {
    const data = new Float32Array(100);
    const buffer = { getChannelData: () => data } as unknown as AudioBuffer;
    const asset = createSyntheticToneDemo({ sampleRate: 1000, createBuffer: () => buffer }, { durationSeconds: 0.1 });
    expect(asset.kind).toBe("synthetic-demo");
    expect(asset.displayName).toMatch(/Synthetic tone demo/);
    expect(data.some(value => value !== 0)).toBe(true);
  });
});

describe("capture and playback", () => {
  it("covers baseline, last epoch endpoint, and safety margin", () => {
    expect(captureWindowForPlan(plan, 2, 3, 1)).toEqual({
      startServerSeconds: 100, endServerSeconds: 106.5, baselineSeconds: 2,
      epochEndpointSeconds: 3, safetyMarginSeconds: 1,
    });
    expect(() => captureWindowForPlan([...plan].reverse(), 2, 3, 1)).toThrow();
    expect(() => captureWindowForPlan([{ ...plan[0] }, { ...plan[1], markerId: "m1" }], 2, 3, 1)).toThrow();
  });

  it("schedules audio and markers only once across repeated calls", () => {
    const { context, sources } = fakeContext();
    const trialLedger = new Set<string>();
    const markerLedger = new Set<string>();
    const sendMarker = vi.fn();
    const options = { context, sync, plan, assets, trialLedger, markerLedger, sendMarker, visibility: null };
    scheduleOrderedPlan(options).dispose();
    scheduleOrderedPlan(options).dispose();
    expect(sources.map(source => source.start.mock.calls[0][0])).toEqual([13, 13.5]);
    expect(sendMarker).toHaveBeenCalledTimes(2);
    expect(sendMarker).toHaveBeenNthCalledWith(1, {
      id: "m1", trialId: "s1", label: undefined, scheduledServerSeconds: 102,
      scheduledContextTime: 13, timing_method: "getOutputTimestamp",
      networkUncertaintySeconds: 0.02, physicalLatencySeconds: null,
    });
    expect(trialLedger).toEqual(new Set(["s1", "s2"]));
    expect(markerLedger).toEqual(new Set(["m1", "m2"]));
  });

  it("skips a reused marker ID even with a new trial ID", () => {
    const { context, sources } = fakeContext();
    const sendMarker = vi.fn();
    scheduleOrderedPlan({ context, sync, plan: [{ ...plan[0], id: "replacement" }], assets,
      trialLedger: new Set(), markerLedger: new Set(["m1"]), sendMarker, visibility: null }).dispose();
    expect(sources).toHaveLength(0);
    expect(sendMarker).not.toHaveBeenCalled();
  });

  it("never sends a marker when source.start fails", () => {
    const { context } = fakeContext(new Error("device unavailable"));
    const sendMarker = vi.fn();
    const trialLedger = new Set<string>();
    const markerLedger = new Set<string>();
    expect(() => scheduleOrderedPlan({ context, sync, plan, assets, trialLedger, markerLedger,
      sendMarker, visibility: null })).toThrow("device unavailable");
    expect(sendMarker).not.toHaveBeenCalled();
    expect(markerLedger.size).toBe(0);
    expect(trialLedger.has("s1")).toBe(true);
  });

  it("aborts on failed marker delivery", async () => {
    const { context, sources } = fakeContext();
    const markerLedger = new Set<string>();
    const onAbort = vi.fn();
    const sendMarker = vi.fn(() => Promise.reject(new Error("offline")));
    const handle = scheduleOrderedPlan({ context, sync, plan: [plan[0]], assets, trialLedger: new Set(),
      markerLedger, sendMarker, onAbort, visibility: null });
    await Promise.resolve();
    expect(handle.abortReason).toBe("marker-error");
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(markerLedger.has("m1")).toBe(true);
    expect(onAbort).toHaveBeenCalledWith("marker-error", expect.any(Error));
  });

  it("aborts on hidden document, audio state loss, and sink change", () => {
    const visibility = fakeVisibility();
    const hiddenContext = fakeContext();
    const hidden = scheduleOrderedPlan({ context: hiddenContext.context, sync, plan, assets,
      trialLedger: new Set(), markerLedger: new Set(), sendMarker: vi.fn(), visibility: visibility.monitor });
    visibility.raw.hidden = true;
    visibility.events.dispatchEvent(new Event("visibilitychange"));
    expect(hidden.abortReason).toBe("hidden");
    expect(hiddenContext.sources[0].stop).toHaveBeenCalledOnce();

    const stateContext = fakeContext();
    const state = scheduleOrderedPlan({ context: stateContext.context, sync, plan, assets,
      trialLedger: new Set(), markerLedger: new Set(), sendMarker: vi.fn(), visibility: null });
    stateContext.raw.state = "suspended";
    stateContext.events.dispatchEvent(new Event("statechange"));
    expect(state.abortReason).toBe("audio-lost");
    expect(stateContext.sources[0].stop).toHaveBeenCalledOnce();

    const sinkContext = fakeContext();
    const sink = scheduleOrderedPlan({ context: sinkContext.context, sync, plan, assets,
      trialLedger: new Set(), markerLedger: new Set(), sendMarker: vi.fn(), visibility: null });
    sinkContext.events.dispatchEvent(new Event("sinkchange"));
    expect(sink.abortReason).toBe("audio-lost");
    expect(sinkContext.sources[0].stop).toHaveBeenCalledOnce();
  });
});
