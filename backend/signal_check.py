"""Pre-experiment signal check on the last few seconds of live EEG.

Predicts how many trials the ERP analysis would accept by applying the same
artifact rule (detrended raw epoch, peak-to-peak and absolute thresholds) to
sliding windows of the recent signal. It does not measure electrode impedance.
"""
from collections import Counter

import numpy as np
from scipy.signal import butter, detrend, sosfiltfilt

from .models import AnalysisConfig

# Knight input range after the corrected scale: 4 V / gain 12 / front-end 79.57 = about 4,189 µV.
FULL_SCALE_UV = 4.0e6 / 12 / 79.57
MIN_SECONDS = 3.0


def _band_rms(x, fs, low, high):
    high = min(high, fs / 2 - 0.5)
    if low >= high:
        return float("nan")
    sos = butter(4, [low, high], btype="bandpass", fs=fs, output="sos")
    return float(np.sqrt(np.mean(sosfiltfilt(sos, x) ** 2)))


def remove_line_noise(x: np.ndarray, fs: float) -> np.ndarray:
    """Zero-phase 50 and 60 Hz notches on continuous data (samples x channels or 1-D).
    Power-line hum is not a physiological artifact. Apply to whole segments, not short epochs."""
    x = np.asarray(x, dtype=float)
    for f in (50, 60):
        if f < fs / 2 - 1 and len(x) > 60:
            high = min(f + 2, fs / 2 - 0.5)
            sos = butter(4, [f - 2, high], btype="bandstop", fs=fs, output="sos")
            x = sosfiltfilt(sos, x, axis=0)
    return x


def epoch_artifacts(raw: np.ndarray, config: AnalysisConfig, clean: np.ndarray | None = None) -> list[str]:
    """Artifact rule shared with the ERP analysis. raw and clean are samples x channels.
    clean is the same epoch with power-line hum removed (from continuous data); it is detrended
    here so the electrode offset is ignored. Clipping is checked on raw samples because
    filtering cannot restore them."""
    reasons = []
    if (np.abs(raw) >= 0.98 * FULL_SCALE_UV).any():
        reasons.append("saturated_input")
    clean = detrend(raw if clean is None else clean, axis=0, type="linear")
    if (np.ptp(clean, axis=0) > config.artifact_peak_to_peak_uv).any():
        reasons.append("peak_to_peak_artifact")
    if (np.abs(clean) > config.artifact_absolute_uv).any():
        reasons.append("absolute_amplitude_artifact")
    if (raw.std(axis=0) <= config.flatline_std_uv).any():
        reasons.append("flatline")
    return reasons


def check_signal(times, data, fs, labels, channels, config: AnalysisConfig | None = None) -> dict:
    config = config or AnalysisConfig()
    if not channels:
        raise ValueError("Select at least one channel for the signal check")
    times = np.asarray(times, dtype=float)
    data = np.asarray(data, dtype=float)
    seconds = float(times[-1] - times[0]) if len(times) > 1 else 0.0
    base = {"seconds_analyzed": round(seconds, 2), "sampling_rate": fs,
            "thresholds_uv": {"peak_to_peak": config.artifact_peak_to_peak_uv, "absolute": config.artifact_absolute_uv},
            "note": "Signal check predicts artifact rejection only. It does not measure electrode impedance."}
    if not np.isfinite(times).all() or np.any(np.diff(times) <= 0):
        return {**base, "ready": False, "overall": "invalid_timestamps", "channels": [],
                "advice": ["Sample timestamps are not strictly increasing. Check acquisition before recording; ERP analysis rejects this timing."]}
    if seconds < MIN_SECONDS or not np.isfinite(data[:, channels] if data.size else data).all():
        return {**base, "ready": False, "overall": "insufficient_data", "channels": [],
                "advice": [f"Need at least {MIN_SECONDS:.0f} seconds of continuous data. Wait a moment and run the check again."]}

    epoch_len = int(round((config.epoch_end_ms - config.epoch_start_ms) * fs / 1000)) + 1
    step = max(1, int(fs * 0.25))
    starts = list(range(0, len(data) - epoch_len + 1, step))
    results = []
    for ch in channels:
        x = data[:, ch]
        centered = x - np.median(x)
        line = max(_band_rms(centered, fs, 57, 63), _band_rms(centered, fs, 47, 53))
        eeg = _band_rms(centered, fs, 1, 30)
        railed = float(np.mean(np.abs(x) > 0.95 * FULL_SCALE_UV))
        dehummed = remove_line_noise(centered, fs)
        audits = [epoch_artifacts(x[s:s + epoch_len, None], config, dehummed[s:s + epoch_len, None]) for s in starts]
        rejection_reasons = dict(Counter(reason for reasons in audits for reason in reasons))
        passed = sum(not reasons for reasons in audits)
        acceptance = passed / len(starts) if starts else 0.0
        problems = []
        if railed > 0.01:
            problems.append("Raw samples approach the input limit. Software filtering cannot recover clipped data.")
        if eeg < 0.5:
            problems.append("Signal is nearly flat. Check that this channel is turned on and the lead is plugged in.")
        if line > 20:
            problems.append(f"Before software filtering: {line:.0f} µV line-band RMS. Software 50/60 Hz bandstops are applied before amplitude rejection; this does not measure contact.")
        if eeg > 50 and line <= 20:
            problems.append(f"Large low-frequency activity ({eeg:.0f} µV). Ask the participant to relax, stop moving and unclench the jaw.")
        if acceptance < 0.8:
            problems.append(f"Only {acceptance:.0%} of 1-second windows would pass the ±{config.artifact_absolute_uv:.0f} µV artifact check.")
        # Readiness follows the actual artifact rule, not an unvalidated raw-hum cutoff.
        if railed > 0.01 or eeg < 0.5:
            status = "bad"
        else:
            status = "good" if acceptance >= 0.8 and line <= 20 else "fair" if acceptance >= 0.5 else "bad"
        results.append({"channel": ch + 1, "label": labels[ch] if ch < len(labels) else f"CH{ch + 1}",
                        "status": status, "predicted_acceptance": round(acceptance, 3),
                        "rejection_reasons": rejection_reasons,
                        "post_notch_peak_to_peak_uv": round(float(np.max(np.ptp(detrend(dehummed), axis=0))), 2),
                        "eeg_rms_uv": round(eeg, 2), "line_noise_rms_uv": round(line, 2),
                        "offset_uv": round(float(np.median(x)), 1), "saturated_fraction": round(railed, 3),
                        "problems": problems})
    statuses = {r["status"] for r in results}
    overall = "bad" if "bad" in statuses else "fair" if "fair" in statuses else "good"
    advice = []
    if overall != "good":
        if all(r["line_noise_rms_uv"] > 20 for r in results):
            advice.append("Every selected channel has elevated line-band energy before software filtering. Verify reference/bias wiring against the manufacturer setup; this check cannot diagnose electrode disconnection.")
        advice.append("Only list channels that have electrodes attached in 'EEG channels to analyze'.")
        advice.append("Unplug the laptop charger and move away from power strips if hum persists.")
    return {**base, "ready": overall in {"good", "fair"}, "overall": overall, "channels": results, "advice": advice}
