# NeuroLingo frontend

React + TypeScript + Vite frontend connected to the FastAPI EEG backend in `../backend`.

For complete setup, hardware instructions and scientific limitations, see [the project README](../README.md).

## Develop

With Node.js 22.22+ and the Python backend running on port 8000:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. `VITE_API_URL` defaults to http://127.0.0.1:8000. You can also save a backend URL in Settings; that browser-local override takes precedence. Do not put credentials in Vite configuration.

## Build and test

```sh
npm test
npm run build
```

The Python server serves `dist/` when that directory exists at startup. Vite uses relative asset URLs for both local hosting and optional Pages hosting.

## Integration

`api.ts` provides contract checks and HTTP error handling. `client.ts` defines the backend adapter and converts sample-major live EEG and channel-major ERP waveforms to chart view models. `experiment.ts` schedules server-planned trials one at a time within the two-second marker horizon, preserves an initial baseline and final epoch tail, resynchronizes clocks during longer blocks, and marks interrupted audio as canceled. `audio.ts` provides Web Audio scheduling and file identities.

The workspace supports explicit hardware/simulation connection, student creation/selection, sound experiments, live EEG, ERP polling, trial audits, session review, comparisons and exports. Waveforms come only from the backend. Null measurements remain unavailable. Pausing the live display does not stop acquisition.

Browser onset estimates are not calibrated acoustic timing. Hidden tabs, lost audio, disconnects and failed markers stop experiments. No trial is silently replayed. Translation practice and UI configuration of MMN/N400 remain unavailable; the backend's controlled exploratory protocols are API-only.
