# NeuroLingo

A local EEG-assisted language-learning research app. The React frontend connects to a FastAPI backend for Knight Board acquisition, auditory oddball sessions, averaged ERP analysis, session history and exports. Simulation is explicitly labeled and never replaces hardware automatically.

## Run the whole app locally

Install **Python 3.12+** and **Node.js 22.22+** (supported Node 24 also works). From the repository root:

```bash
python -m venv temp/venv
source temp/venv/bin/activate
pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

On Windows PowerShell, activate with `temp\venv\Scripts\Activate.ps1` instead of `source temp/venv/bin/activate`.

Open **http://127.0.0.1:8000**. The same server serves the built frontend and the API; no second server or GitHub Pages is needed. Build the frontend **before** starting Python. After frontend changes, rebuild and refresh; restart Python if it was started before `frontend/dist/` existed. Stop the server with Ctrl+C.

API documentation: http://127.0.0.1:8000/docs

For frontend development, run `npm run dev --prefix frontend` in a second terminal and open http://127.0.0.1:5173. Keep the backend running on port 8000.

## First experiment: simulation

1. Open **Settings**. Leave the source as **SIMULATION** and click **Connect source**.
2. Open **Students**, enter a display name and click **Create student**.
3. Open **Sound Recognition**. Select the student and the synthetic-tone oddball demo. This uses 1000 Hz standard and 1500 Hz deviant tones; it is not a language-recognition experiment.
4. Use headphones, check **Headphones are connected**, and click **Enable browser audio**. Preview each sound at a comfortable volume using your system volume controls.
5. For a short workflow demo, use **20 trials**, **0.2 deviant probability**, **1.1 second interval**. This block is deliberately too short for the default measurement threshold, so expect an insufficient-data result. For a longer exploratory block, defaults are 120 trials / 0.2 / 1.5 seconds, about three minutes plus recording lead-in/tail.
6. Click **Start experiment**. Stay still, silently count infrequent sounds, and keep the tab visible. The dashboard shows live EEG and accumulating ERP waveforms. Browser onset timing is uncalibrated, so peak latency stays unavailable. Synthetic EEG is not experimental evidence.
7. Recording stops automatically after the last sound's poststimulus epoch and safety margin. **Early stop** aborts playback and marks the session interrupted; canceled sounds are excluded from ERP analysis.
8. Open **Session History**, select a session timestamp, and review the ERP, counts, rejection reasons and quality warnings. Export CSV measurements, full-rate NPZ samples, and JSON metadata. Keep NPZ and JSON together.
9. Select two saved sessions and click **Compare selected sessions**. Differences are descriptive; they do not establish learning. Source/protocol/settings mismatches produce warnings.

## Real Knight Board

Connect the board by a data-capable USB cable and follow the manufacturer's electrode/reference and electrical setup instructions: https://docs.neuropawn.tech/getting-started/.

In **Settings**, disconnect simulation, select **LIVE HARDWARE**, enter the serial port (`/dev/ttyACM0`, a macOS `/dev/cu...` path, or `COM3` on Windows), and provide **eight labels** matching physical channel placement plus the electrode reference. Click **Connect source**; the paced manufacturer startup sequence takes about 20 seconds.

Under analysis settings, select **only the physically connected EEG channels**, using channel numbers 1–8 separated by commas. Example: `2,3` analyzes the second and third board channels. All eight acquired channels remain in the original recording. Any bad selected channel rejects that entire epoch. Check the live signal before beginning.

For the Spanish word pair, select **Caballo / cabello**, upload a distinct standard `caballo` recording and deviant `cabello` recording, and preview both. Recordings are decoded locally, must be shorter than the stimulus interval, and their SHA-256 identities are saved in session metadata. No prerecorded word files are bundled.

**Physical hardware acquisition and acoustic onset calibration have not been verified on a board in this development environment.** SDK metadata and adapter commands have been checked and tested with a fake board. A successful connection is not verification of electrode contact, EEG quality or ERP suitability. Device failure interrupts recording; it never activates simulation.

## What the analysis means

The pipeline filters continuous EEG (.5–20 Hz by default), extracts −200 to +800 ms epochs, baseline-corrects against −200 to 0 ms, rejects artifacts/gaps/flatlines, and averages standard/deviant trials separately. It also shows deviant-minus-standard and pointwise 95% trial-variability intervals.

The primary summary is the mean voltage within 300–600 ms. Default minimum accepted trial count is 20 **in each condition**; this is a configurable heuristic, not validated detection accuracy. Waveforms may be available before measurements qualify. No isolated voltage spike is classified as a P300. A weak/absent response does not establish failed discrimination. A positive response does not prove conscious recognition or successful learning.

Browser timing uses synchronized server time and Web Audio output timestamps; physical output latency remains unknown. The UI reports `browser_estimate` and withholds peak latency. A numerical clock RTT alone is not acoustic calibration. The API supports explicitly declared calibrated timing, with a calibration reference and uncertainty, for a separately validated presentation setup.

Exploratory MMN and N400 difference-window means are available through the API when the operator declares suitable controlled conditions and electrode placement. N400 requires a semantic-contrast protocol and an explicit appropriate window. The UI does not yet configure these protocols or implement translation practice.

Knight Board documentation lists a 1–62.5 Hz acquisition bandwidth. Software filtering cannot recover attenuated slow ERP activity. No impedance measurement, clinical diagnosis or validated proficiency score is provided.

## Data and recovery

Local SQLite metadata and compressed full-rate recordings live in **`temp/data/`**, ignored by git. Back up this directory if you want to retain sessions. Treat it as participant data, not disposable scratch space. Set `NEUROLINGO_DATA_DIR` to another location if needed.

Only one active recording and one backend process are supported. Do not use multiple Uvicorn workers. Recordings are checkpointed about every five seconds; a crash can lose samples after the last checkpoint. Restart marks unfinished sessions interrupted. After a browser refresh, click **Check connection** if needed; an active recording can be stopped with **Early stop**. Playback is never resumed or replayed automatically. If the backend is unavailable during an abort, reconnect and stop the recovered recording explicitly.

This is a local research MVP without authentication. Bind to loopback as shown, rather than exposing the acquisition API publicly.

## Test

```bash
pip install -r requirements-dev.txt
python -m pytest -q
npm test --prefix frontend
npm run build --prefix frontend
```

Tests cover ERP processing, artifacts, timing gates, canceled trials, acquisition adapter commands, persistence, HTTP/WebSocket routes, frontend chart adapters and audio scheduling. Passing simulation/mock tests does not verify physical hardware.

## Optional hosting

GitHub Pages can serve only the React static files, not Python, BrainFlow, USB access, SQLite or recording storage. The simplest complete deployment is the local server above. A cloud Python server cannot directly access a learner's USB board; a local acquisition component is still needed.

An optional manually triggered Pages workflow is supplied. To use it, select **GitHub Actions** as the repository's Pages publishing source, then run **Publish frontend to GitHub Pages** from Actions. It is not triggered automatically and has not been deployed by this change. You can supply a repository variable `VITE_API_URL`, or change **Backend address** in the frontend's Settings. The latter is stored in that browser only.

A Pages frontend accessing this machine's local backend also needs the Pages origin in `NEUROLINGO_ORIGINS`, e.g. `https://vsbs14.github.io`. Browser local-network permissions and HTTP/WebSocket restrictions may prevent that arrangement; use the local app if blocked. Remote backend hosting requires HTTPS/WSS, appropriate access controls, a durable data directory and a separate hardware acquisition design. CORS alone is not authentication.

GitHub's hosting limitations: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
