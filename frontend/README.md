# NeuroLingo frontend

React + TypeScript + Vite research workspace. This directory contains no backend or signal processing.

## Run

Use Node.js 22.12+ (or a newer supported LTS) and npm:

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://127.0.0.1:5173. `VITE_API_URL` defaults to `http://127.0.0.1:8000`. The backend must allow the frontend origin through CORS. Use localhost or HTTPS for Web Audio and secure-context SHA-256 file identity.

```sh
npm test
npm run build
```

The production files are generated in `dist/`. No API credentials belong in Vite environment variables, which are public browser configuration.

## Current integration status

**The backend was not running at delivery.** Requests to `http://127.0.0.1:8000/openapi.json` returned connection refused. No backend files were present in this checkout. Per the contract-first requirement, protocol requests are intentionally not wired from the planned endpoint descriptions. The only application network request is the OpenAPI document. A successful contract fetch does not enable unreviewed operations.

Implemented: all six responsive page layouts, explicit loading/error/unavailable states, source selection draft, headphone-gated audio context, predecoded local audio with SHA-256 identity and local previews, a labeled synthetic-tone preview, scientific EEG/ERP components, contract validation, and tested clock/scheduling primitives. No scientific demo data are generated. Student creation, acquisition, session execution, persistence, live streams, analysis polling, exports, and comparisons remain disabled pending the actual contract. Settings and experiment inputs are local drafts, not saved backend configuration.

## Backend developer handoff

Start the existing backend on port 8000 and supply its generated OpenAPI, plus the WebSocket message schema (WebSockets may not appear in OpenAPI). Verify:

- Exact clock response and its timestamp semantics.
- Device connection status, explicit source, serial/electrode configuration, and disconnect notifications.
- Student and sound-pair schemas, audio URLs, and how uploaded audio identities are stored in session metadata.
- Session creation settings, randomized ordered trial plan and stimulus/audio identity, event schema, stop semantics, and canceled scheduled-trial handling.
- EEG batch timestamps, units, dimensions, source and channel mapping; heartbeat/disconnect handling.
- Analysis waveforms and pointwise intervals, counts and rejection audit, null metrics, quality, provisional/final state, and protocol/electrode eligibility.
- Export source labeling and comparison compatibility warnings.

Then implement a typed adapter in `src/api.ts` based on that document, mapping backend responses to `Charts.tsx` view models. Poll analysis independently every 2–5 seconds; keep EEG acquisition independent of display pause. Connect student/session state and exports only after verifying their actual response shapes. Never enable a capability merely because a route name exists.

`audio.ts` provides clock estimation, output-timestamp conversion, decoding, synthesis for explicitly labeled tone demos, capture bounds, and ordered scheduling. It does not decide server stimulus categories or make HTTP calls. Map its scheduling metadata to the verified event contract. Use session-wide deduplication ledgers, abort on network/device loss, and acquire the final poststimulus epoch plus safety margin before normal stop. A production runner must coordinate aborts and scheduled-but-canceled trials with the backend. If `getOutputTimestamp()` is unsupported or invalid, recording must remain unavailable; there is no function-call timestamp fallback.

Browser onset estimates are not measured sound-at-ear onset. Network half-RTT uncertainty is preserved separately from physical output latency, which remains unknown without loopback calibration.

## Scientific display

`Charts.tsx` accepts actual data only. Raw EEG uses seconds and microvolts, all supplied channels, event markers and positive-up polarity. ERP uses milliseconds and microvolts, standard/deviant/difference traces, pointwise confidence intervals, baseline/P300 shading, channel/source identity and separate accepted/rejected/pending counts. P300-window mean amplitude is primary; unavailable metrics stay unavailable. Simulation labels are preserved. MMN/N400 and translation remain unavailable until the backend establishes eligibility/protocol support.

Tests cover API failures and contract gaps, null metrics, simulation labeling, units/polarity and uncertainty bands, clock conversion and uncertainty, audio preparation, capture bounds, abort behavior and deduplication. Browser/hardware end-to-end verification still requires the backend and a browser-connected test environment.
