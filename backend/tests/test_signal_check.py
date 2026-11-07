import time

import numpy as np
from fastapi.testclient import TestClient

from backend.analysis import analyze
from backend.app import create_app
from backend.models import AnalysisConfig
from backend.signal_check import check_signal

FS = 125
LABELS = [f"CH{i}" for i in range(1, 9)]


def recording(seconds=5, offset=0.0, line_uv=0.0, noise_uv=5.0):
    ts = 1000 + np.arange(0, seconds, 1 / FS)
    rng = np.random.default_rng(3)
    data = offset + rng.normal(0, noise_uv, (len(ts), 8))
    data += line_uv * np.sin(2 * np.pi * 60 * ts)[:, None]
    return ts, data


def test_clean_eeg_with_large_dc_offset_passes():
    # Electrode half-cell offsets of tens of mV are normal on DC-coupled boards.
    result = check_signal(*recording(offset=-2500), FS, LABELS, [0, 1])
    assert result["ready"] is True and result["overall"] == "good"
    assert all(c["predicted_acceptance"] > .95 for c in result["channels"])


def test_floating_inputs_with_power_line_hum_fail_with_advice():
    result = check_signal(*recording(offset=-1000, line_uv=2000), FS, LABELS, list(range(8)))
    assert result["ready"] is False and result["overall"] == "bad"
    assert all(c["line_noise_rms_uv"] > 1000 for c in result["channels"])
    assert all(c["saturated_fraction"] == 0 for c in result["channels"])
    assert any("reference and bias" in a for a in result["advice"])


def test_flat_channel_and_short_window():
    ts, data = recording()
    data[:, 2] = 7.0
    result = check_signal(ts, data, FS, LABELS, [2])
    assert result["channels"][0]["status"] == "bad"
    assert check_signal(ts[:FS], data[:FS], FS, LABELS, [0])["overall"] == "insufficient_data"


def test_analysis_accepts_trials_despite_dc_offset():
    ts, data = recording(seconds=40, offset=3000, noise_uv=3)
    events = [{"trial_index": i, "condition": "standard" if i % 5 else "deviant", "onset_timestamp": ts[0] + 2 + 1.5 * i,
               "timing_method": "hardware_loopback", "timing_uncertainty_ms": 1} for i in range(20)]
    result = analyze(ts, data[:, :2], events, FS, ["Cz", "Pz"], AnalysisConfig(), "hardware", finalized=True)
    assert result["counts"]["accepted"]["standard"] + result["counts"]["accepted"]["deviant"] == 20


def test_signal_check_route_with_simulation(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/device/signal-check").status_code == 409
        client.post("/api/device/connect", json={"source": "simulation"}).raise_for_status()
        time.sleep(3.6)
        response = client.get("/api/device/signal-check", params={"seconds": 3, "channels": "0,1"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["source"] == "simulation" and [c["channel"] for c in body["channels"]] == [1, 2]
        assert client.get("/api/device/signal-check", params={"channels": "9"}).status_code == 409


def test_moderate_hum_is_removed_before_the_artifact_check():
    # 40 µV of 60 Hz would fail a raw ±150 µV peak-to-peak check on its own, but it is not physiology.
    ts, data = recording(seconds=40, offset=1500, line_uv=80, noise_uv=3)
    events = [{"trial_index": i, "condition": "standard", "onset_timestamp": ts[0] + 2 + 1.5 * i,
               "timing_method": "hardware_loopback", "timing_uncertainty_ms": 1} for i in range(20)]
    result = analyze(ts, data[:, :1], events, FS, ["Cz"], AnalysisConfig(), "hardware", finalized=True)
    assert result["counts"]["accepted"]["standard"] == 20


def test_clipped_input_is_rejected_even_though_filtering_would_hide_it():
    ts, data = recording(seconds=6, offset=0, noise_uv=3)
    data[::3, 0] = -4189.4
    result = check_signal(ts, data, FS, LABELS, [0])
    assert result["channels"][0]["status"] == "bad"
    assert result["channels"][0]["saturated_fraction"] > .3
