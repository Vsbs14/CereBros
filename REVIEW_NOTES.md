# Reliability review — 2026-11-07

Reviewed main `fd9b016` and UI branch `ee773c5`, with context from the project chat “Add P300 ERP analysis”.

## Changes

- Persist enabled channels in device status, restore them after a browser refresh, default analysis to enabled channels, and reject requests to analyze switched-off channels. Channel changes require reconnecting.
- Bind passing signal checks to their checked channel list. Empty selections and duplicate/backward sample timestamps cannot pass. Nonfinite unused channels do not affect the selected-channel check.
- Carry over the new welcome page, instructional diagrams and light styling while retaining the live backend adapter, recording controls, charts, exports and session comparisons. The UI branch alone was based on the earlier unwired scaffold.
- Linux quick tests use aplay or ffplay, or fail explicitly before acquisition when neither is available. They no longer silently record markers without sound. Trial planning is bounded and invalid arguments fail before opening the device.

## Verification

Backend regression suite: 41 passed. Frontend suite: 41 passed. Production build passed. Browser integration completed a 20-trial simulation: 16 standards and 4 deviants accepted, no rejected trials, no browser exceptions. Saved results, CSV export, early stop, comparison and mobile layout were exercised. Synthetic results do not validate real EEG acquisition.

## Official Linux visualizer comparison

Downloaded from https://docs.neuropawn.tech/downloads/ to `temp/vendor/neuropawn/`. The ZIP contains a PyInstaller Linux x64 executable. Inspected its Python 3.10 bytecode without executing the application. Inspection output is alongside the download.

The bundled metadata identifies BrainFlow 5.21.0. Its `connection` function chooses the plain or IMU board, calls `prepare_session`, then `start_stream(450000)`. Channel controls use `chon_N_12`, `choff_N`, `rldadd_N` and `rldremove_N`, matching this project's command family. Its EEG display removes constant offset, applies a second-order zero-phase 5–40 Hz bandpass, then fourth-order zero-phase 48–52 and 58–62 Hz bandstops. A visually clean trace is not evidence of passing this project's ERP artifact checks; the visualizer suppresses slow drift aggressively. These display cutoffs were not copied into ERP analysis.

## Physical-device result and remaining limitation

Only `/dev/ttyUSB0`, an FTDI FT232R USB UART, was visible. Initial acquisition failed because the current user lacked permission (`root:uucp`, user not in uucp). The user authorized and applied a temporary ACL. A second attempt opened the port using the confirmed IMU board type, but received no samples; BrainFlow repeatedly logged inability to read a byte. The port was released after the bounded diagnostic. No firmware was flashed and no permanent group membership was changed. Logs are in `temp/hardware-review/` and `temp/hardware-review-output.log`.

No real recording was available locally to diagnose the earlier trial rejection. Confirm that this serial adapter belongs to the headset, reseat the USB connection and confirm the official visualizer streams from it before comparing ERP rejection. Only one app should own the port at a time. The temporary ACL can be removed with `sudo setfacl -x u:vs /dev/ttyUSB0`; unplugging generally recreates the device without it.

## Follow-up: software line filtering and quality gate

Pipeline 1.4.0 uses fourth-order zero-phase 48–52/58–62 Hz bandstops on continuous data, matching the official visualizer's line-filter bands. Removed the unvalidated raw-line-RMS >200 µV readiness veto and electrode-disconnection claim. Readiness still requires acceptable post-filter artifacts, nonflat channels and unclipped raw samples. The UI distinguishes pre-filter hum from post-notch amplitude and lists rejection counts. Backend suite: 42 passed; production build passed. Reprocessing the saved live capture still found large residual artifacts on several channels, so this is not a claim that the headset data now qualify for ERP analysis.
