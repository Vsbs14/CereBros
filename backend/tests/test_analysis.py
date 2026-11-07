import numpy as np
import pytest

from backend.analysis import analyze
from backend.models import AnalysisConfig


def dataset(trials=50):
    fs = 125
    ts = np.arange(0, trials * 1.5 + 4, 1 / fs)
    rng = np.random.default_rng(17)
    data = rng.normal(0, .5, (len(ts), 2))
    events = []
    for i in range(trials):
        onset = 2 + i * 1.5
        condition = "standard" if i % 2 else "deviant"
        data += ((6 if condition == "deviant" else 1) * np.exp(-.5 * ((ts - onset - .44) / .06) ** 2))[:, None]
        events.append({"trial_index": i, "condition": condition, "onset_timestamp": onset,
                       "timing_method": "hardware_loopback", "timing_uncertainty_ms": 1})
    return ts, data, events


def run(ts, data, events, **kwargs):
    return analyze(ts, data, events, 125, ["Cz", "Pz"], AnalysisConfig(**kwargs), "simulation", finalized=True)


def test_known_erp_and_baseline():
    result = run(*dataset())
    assert result["counts"]["accepted"] == {"standard": 25, "deviant": 25}
    assert result["quality"] == "sufficient_for_descriptive_analysis"
    metric = next(m for m in result["metrics"] if m["condition"] == "deviant")
    assert 1 < metric["window_mean_uv"] < 4
    assert abs(metric["peak_latency_ms"] - 440) < 24
    axis = np.asarray(result["time_ms"])
    mean = np.asarray(result["waveforms"]["deviant"]["mean_uv"])
    assert abs(mean[:, (axis >= -200) & (axis < 0)].mean()) < 1e-10
    np.testing.assert_allclose(np.asarray(result["waveforms"]["difference"]["mean_uv"]), mean - result["waveforms"]["standard"]["mean_uv"])
    assert "SIMULATION" in result["warnings"][0]


def test_spike_flatline_gap_and_incomplete_epochs():
    ts, data, events = dataset()
    data[int(events[0]["onset_timestamp"] * 125) + 50] = 500
    data[int(events[1]["onset_timestamp"] * 125) - 30:int(events[1]["onset_timestamp"] * 125) + 110, 0] = 0
    mask = ~((ts > events[2]["onset_timestamp"] + .3) & (ts < events[2]["onset_timestamp"] + .4))
    result = run(ts[mask], data[mask], events + [{**events[-1], "trial_index": 50, "onset_timestamp": ts[-1]}])
    assert result["rejection_reasons"]["peak_to_peak_artifact"] >= 1
    assert result["rejection_reasons"]["flatline"] >= 1
    assert result["rejection_reasons"]["sample_gap_or_onset_alignment"] >= 1
    assert result["rejection_reasons"]["incomplete_epoch"] == 1


def test_insufficient_trials_never_produce_metrics():
    result = run(*dataset(4))
    assert result["quality"] == "insufficient_data"
    assert all(m["window_mean_uv"] is None and m["peak_latency_ms"] is None for m in result["metrics"])


def test_uncalibrated_timing_withholds_latency():
    ts, data, events = dataset()
    for event in events:
        event["timing_method"] = "browser_estimate"
        event["timing_uncertainty_ms"] = None
    result = run(ts, data, events)
    assert result["quality"] == "timing_uncalibrated"
    assert all(m["peak_latency_ms"] is None for m in result["metrics"])
    assert any(m["window_mean_uv"] is not None for m in result["metrics"])


def test_nonfinite_and_negative_peak_not_detected():
    ts, data, events = dataset()
    data[250, 0] = np.nan
    result = run(ts, data, events)
    assert result["counts"]["rejected"] > 0
    # No binary component classification exists in the output.
    assert "detected" not in result


def test_empty_and_exploratory_eligibility():
    result = run([], np.empty((0, 2)), [], exploratory_component="mmn")
    assert result["waveforms"]["deviant"] is None
    assert result["exploratory"]["status"] == "unavailable"
    result = run(*dataset(), exploratory_component="mmn", electrode_configuration_confirmed=True, controlled_conditions_confirmed=True)
    assert result["exploratory"]["difference_mean_uv"] is not None


def test_invalid_windows():
    with pytest.raises(ValueError):
        AnalysisConfig(baseline_start_ms=-400)
    with pytest.raises(ValueError):
        AnalysisConfig(p300_end_ms=1200)


def test_bad_timestamp_order_rejects_all_trials():
    ts, data, events = dataset()
    ts[300] = ts[299] - .1
    result = run(ts, data, events)
    assert result["counts"]["accepted"] == {"standard": 0, "deviant": 0}
    assert result["rejection_reasons"]["invalid_timestamp_order"] == len(events)


def test_provisional_tail_is_pending_not_rejected():
    ts, data, events = dataset(4)
    event = {**events[-1], "trial_index": 4, "onset_timestamp": ts[-1] - .1}
    result = analyze(ts, data, [event], 125, ["Cz", "Pz"], AnalysisConfig(), "simulation", finalized=False)
    assert result["counts"]["pending"] == 1
    assert result["counts"]["rejected"] == 0


def test_negative_waveform_peak_is_not_reported_as_positive_response():
    ts, data, events = dataset()
    result = run(ts, -data, events)
    for metric in result["metrics"]:
        if metric["condition"] == "deviant":
            assert metric["window_mean_uv"] < 0
            assert metric["peak_amplitude_uv"] is None
            assert metric["peak_latency_ms"] is None


def test_selected_channels_exclude_unused_flatline_but_keep_physical_index():
    ts, data, events = dataset()
    data[:, 0] = 0
    result = run(ts, data, events, channel_indices=[1])
    assert result["counts"]["accepted"]["deviant"] == 25
    assert result["channel_labels"] == ["Pz"]
    assert all(metric["channel_index"] == 1 for metric in result["metrics"])
    assert len(result["waveforms"]["deviant"]["mean_uv"]) == 1
