"""Offline, continuous-data ERP processing. Never classify isolated raw peaks."""
from collections import Counter

import numpy as np
from scipy.signal import butter, sosfiltfilt
from scipy.stats import t as student_t

from .models import AnalysisConfig


PIPELINE_VERSION = "1.0.0"


def summarize(epochs: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
    mean = epochs.mean(axis=0)
    ci = None
    if len(epochs) >= 2:
        ci = student_t.ppf(0.975, len(epochs) - 1) * epochs.std(axis=0, ddof=1) / np.sqrt(len(epochs))
    return mean, ci


def analyze(timestamps, samples, events, sampling_rate, labels, config: AnalysisConfig,
            source: str, protocol: str = "auditory_oddball", finalized: bool = False):
    times = np.asarray(timestamps, dtype=float)
    data = np.asarray(samples, dtype=float)
    fs = sampling_rate
    if fs <= 2 * config.high_hz:
        raise ValueError("Filter cutoff must be below Nyquist frequency")
    if data.shape != (len(times), len(labels)):
        raise ValueError("Samples must have shape timestamp_count x channel_count")
    selected = config.channel_indices if config.channel_indices is not None else list(range(len(labels)))
    if any(i >= len(labels) for i in selected):
        raise ValueError("Selected channel is not available in the recording")
    data = data[:, selected]
    labels = [labels[i] for i in selected]
    monotonic = bool(np.isfinite(times).all() and (np.diff(times) > 0).all())
    offsets = np.arange(round(config.epoch_start_ms * fs / 1000), round(config.epoch_end_ms * fs / 1000) + 1)
    axis = offsets * 1000 / fs
    baseline = (axis >= config.baseline_start_ms) & (axis < config.baseline_end_ms)
    window = (axis >= config.p300_start_ms) & (axis <= config.p300_end_ms)
    if not baseline.any() or not window.any():
        raise ValueError("Analysis windows contain no samples at this sampling rate")
    accepted = {"standard": [], "deviant": []}
    audit = []
    warnings = ["Exploratory measurements do not establish conscious recognition, discrimination or learning.",
                "95% intervals describe pointwise trial variability, not component detection probability."]
    if source == "simulation":
        warnings.insert(0, "SIMULATION: synthetic data are not experimental evidence.")
    else:
        warnings.append("Verify electrode reference and acquisition bandwidth; software cannot recover attenuated frequencies.")
    # Filter separately across gaps, never interpolate across missing data or nonfinite values.
    filtered = np.full_like(data, np.nan)
    invalid = np.ones(len(times), dtype=bool)
    if len(times) > 1:
        invalid = ~np.isfinite(data).all(axis=1) | ~np.isfinite(times)
        breaks = np.where((np.diff(times) > 1.5 / fs) | (np.diff(times) <= 0) | invalid[:-1] | invalid[1:])[0] + 1
        for segment in np.split(np.arange(len(times)), breaks):
            if len(segment) < max(30, int(fs)) or invalid[segment].any():
                continue
            sos = butter(4, [config.low_hz, config.high_hz], btype="bandpass", fs=fs, output="sos")
            filtered[segment] = sosfiltfilt(sos, data[segment], axis=0)
    for event in events:
        record = {"trial_index": event["trial_index"], "condition": event["condition"], "status": "rejected", "reasons": []}
        if event.get("canceled"):
            record["reasons"].append("canceled_stimulus")
            audit.append(record)
            continue
        if not monotonic:
            record["reasons"].append("invalid_timestamp_order")
            audit.append(record)
            continue
        onset = event["onset_timestamp"]
        idx = int(np.searchsorted(times, onset)) if len(times) else 0
        if len(times) and idx > 0 and (idx == len(times) or abs(times[idx - 1] - onset) < abs(times[idx] - onset)):
            idx -= 1
        inds = idx + offsets
        reasons = record["reasons"]
        if len(times) == 0 or inds[-1] >= len(times):
            record["status"] = "rejected" if finalized else "pending"
            reasons.append("incomplete_epoch")
        elif inds[0] < 0:
            reasons.append("missing_baseline")
        else:
            raw = data[inds]
            epoch_times = times[inds]
            if not np.isfinite(raw).all() or not np.isfinite(filtered[inds]).all():
                reasons.append("nonfinite_or_short_filter_segment")
            if np.any(np.diff(epoch_times) <= 0) or np.any(np.diff(epoch_times) > 1.5 / fs) or abs(times[idx] - onset) > 0.75 / fs:
                reasons.append("sample_gap_or_onset_alignment")
            # Reject raw artifacts before filtering can smooth them away.
            if np.isfinite(raw).all():
                if (np.ptp(raw, axis=0) > config.artifact_peak_to_peak_uv).any():
                    reasons.append("peak_to_peak_artifact")
                if (np.abs(raw) > config.artifact_absolute_uv).any():
                    reasons.append("absolute_amplitude_artifact")
                if (raw.std(axis=0) <= config.flatline_std_uv).any():
                    reasons.append("flatline")
            # Boundary padding protects against severe edge transients. Final and provisional results share this rule.
            margin = int(fs * 0.5)
            left, right = max(0, inds[0] - margin), min(len(times), inds[-1] + margin + 1)
            if inds[0] < margin or inds[-1] + margin >= len(times):
                if not finalized and inds[-1] + margin >= len(times):
                    record["status"] = "pending"
                reasons.append("filter_edge_margin")
            elif np.any(np.diff(times[left:right]) > 1.5 / fs) or not np.isfinite(filtered[left:right]).all():
                reasons.append("filter_segment_edge")
            if not reasons:
                epoch = filtered[inds].copy()
                epoch -= epoch[baseline].mean(axis=0)
                accepted[event["condition"]].append(epoch)
                record["status"] = "accepted"
        audit.append(record)
    counts = {k: len(v) for k, v in accepted.items()}
    reasons = Counter(reason for row in audit if row["status"] == "rejected" for reason in row["reasons"])
    pending = sum(row["status"] == "pending" for row in audit)
    rejected = sum(row["status"] == "rejected" for row in audit)
    arrays = {k: np.asarray(v) for k, v in accepted.items()}
    waveforms = {}
    means, cis = {}, {}
    for condition, epochs in arrays.items():
        if len(epochs):
            means[condition], cis[condition] = summarize(epochs)
            waveforms[condition] = {"mean_uv": means[condition].T.tolist(),
                                    "ci95_half_width_uv": cis[condition].T.tolist() if cis[condition] is not None else None}
        else:
            waveforms[condition] = None
    if all(k in means for k in ("standard", "deviant")):
        diff = means["deviant"] - means["standard"]
        diff_ci = None
        if all(cis[k] is not None for k in cis):
            # Conservative sum of each condition's pointwise t interval half-width.
            diff_ci = cis["standard"] + cis["deviant"]
        waveforms["difference"] = {"mean_uv": diff.T.tolist(), "ci95_half_width_uv": diff_ci.T.tolist() if diff_ci is not None else None}
        means["difference"] = diff
    else:
        waveforms["difference"] = None
    accepted_ids = {row["trial_index"] for row in audit if row["status"] == "accepted"}
    valid_events = [e for e in events if e["trial_index"] in accepted_ids]
    timing_ok = bool(valid_events) and all(
        e.get("timing_method") != "browser_estimate" and e.get("timing_uncertainty_ms") is not None
        and e["timing_uncertainty_ms"] <= config.max_timing_uncertainty_ms for e in valid_events)
    enough = all(v >= config.min_trials_per_condition for v in counts.values())
    quality = "sufficient_for_descriptive_analysis" if enough and timing_ok else "insufficient_data" if not enough else "timing_uncalibrated"
    if not timing_ok:
        warnings.append("Acoustic onset timing is uncalibrated, unknown or outside the configured tolerance; latency is withheld.")
    if not enough:
        warnings.append(f"Need at least {config.min_trials_per_condition} accepted trials per condition; threshold is a configurable heuristic, not validation.")
    metrics = []
    for channel, label in enumerate(labels):
        for condition in ("standard", "deviant", "difference"):
            mean = means.get(condition)
            amplitude = peak = latency = ci = None
            if enough and mean is not None:
                amplitude = float(mean[window, channel].mean())
                if condition in arrays:
                    trial_means = arrays[condition][:, window, channel].mean(axis=1)
                    ci = float(student_t.ppf(.975, len(trial_means)-1) * trial_means.std(ddof=1) / np.sqrt(len(trial_means)))
                else:
                    half_widths = []
                    for epochs in arrays.values():
                        values = epochs[:, window, channel].mean(axis=1)
                        half_widths.append(float(student_t.ppf(.975, len(values)-1) * values.std(ddof=1) / np.sqrt(len(values))))
                    ci = sum(half_widths)
                if timing_ok:
                    local = mean[window, channel]
                    peak_index = int(np.argmax(local))
                    # Positive, interior peaks only; never label the component as detected.
                    if local[peak_index] > 0 and 0 < peak_index < len(local)-1:
                        peak = float(local[peak_index])
                        latency = float(axis[window][peak_index])
            metrics.append({"channel_index": selected[channel], "electrode": label, "condition": condition,
                            "window_mean_uv": amplitude, "mean_ci95_half_width_uv": ci,
                            "peak_amplitude_uv": peak, "peak_latency_ms": latency})
    exploratory = None
    if config.exploratory_component:
        eligible = config.electrode_configuration_confirmed and config.controlled_conditions_confirmed
        component_window = (axis >= config.exploratory_start_ms) & (axis <= config.exploratory_end_ms)
        exploratory = {"component": config.exploratory_component, "eligible": eligible,
                       "status": "descriptive_only" if eligible and enough and timing_ok else "unavailable",
                       "window_ms": [config.exploratory_start_ms, config.exploratory_end_ms],
                       "difference_mean_uv": means["difference"][component_window].mean(axis=0).tolist()
                       if eligible and enough and timing_ok and "difference" in means else None,
                       "note": "Eligibility is operator-declared, not independently verified. Acoustic confounds and reference effects remain possible."}
    return {"pipeline_version": PIPELINE_VERSION, "source": source, "protocol": protocol, "finalized": finalized,
            "sampling_rate": fs, "channel_labels": labels, "time_ms": axis.tolist(), "config": config.model_dump(),
            "counts": {"accepted": counts, "rejected": rejected, "pending": pending, "presented": len(events)},
            "rejection_reasons": dict(reasons), "quality": quality, "timing_calibrated": timing_ok,
            "waveforms": waveforms, "metrics": metrics, "trial_quality": audit,
            "exploratory": exploratory, "warnings": warnings}
