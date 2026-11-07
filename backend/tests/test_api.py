import time

from fastapi.testclient import TestClient
import numpy as np
import pytest

from backend.app import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


def create_session(client):
    student = client.post("/api/students", json={"name": "Test learner"}).json()
    client.post("/api/device/connect", json={"source": "simulation"}).raise_for_status()
    result = client.post("/api/sessions", json={"student_id": student["id"], "trials": 20})
    assert result.status_code == 201, result.text
    return result.json()


def test_full_simulation_record_export_and_restart(client):
    session = create_session(client)
    identifier = session["id"]
    assert sum(t["condition"] == "deviant" for t in session["trial_plan"]) == 4
    event = {"trial_index": 0, "onset_timestamp": session["started_at"] + .8,
             "timing_method": "browser_estimate", "timing_uncertainty_ms": None}
    path = f"/api/sessions/{identifier}"
    assert client.post(path + "/events", json=event).status_code == 201
    assert client.post(path + "/events", json=event).status_code == 201
    assert client.post(path + "/events", json={**event, "onset_timestamp": event["onset_timestamp"] + .1}).status_code == 409
    assert client.post(path + "/events", json={**event, "trial_index": 3}).status_code == 409
    time.sleep(.15)
    result = client.post(path + "/stop").json()
    assert result["analysis"]["finalized"] is True
    assert result["source"] == "simulation"
    assert result["analysis"]["counts"]["rejected"] == 1
    assert client.post(path + "/stop").status_code == 200
    assert "simulation" in client.get(path + "/export.csv").text
    download = client.get(path + "/recording.npz")
    assert download.status_code == 200
    import io
    with np.load(io.BytesIO(download.content)) as recording:
        assert len(recording["timestamps"]) > 0
        assert recording["samples"].shape[1] == 8
    assert client.get(path + "/analysis").json() == result["analysis"]
    assert len(client.get(f"/api/students/{session['student_id']}/sessions").json()) == 1


def test_validation_origin_and_hardware_failure(client, monkeypatch):
    assert client.post("/api/device/connect", json={"source": "hardware"}).status_code == 422
    assert client.post("/api/device/connect", json={"source": "simulation"}, headers={"Origin": "https://untrusted.example"}).status_code == 403
    import brainflow.board_shim
    def fail(*args):
        raise RuntimeError("Test board unavailable")
    monkeypatch.setattr(brainflow.board_shim.BoardShim, "prepare_session", fail)
    assert client.post("/api/device/connect", json={"source": "hardware", "serial_port": "/test"}).status_code == 503
    assert client.get("/api/device").json()["source"] is None
    assert client.get("/api/sessions/not-a-uuid").status_code == 422
    assert client.post("/api/device/connect", json={"source": "simulation"}).status_code == 200
    assert client.post("/api/sessions", json={"student_id": "missing"}).status_code == 409


def test_websocket_disconnect_and_compare(client):
    session = create_session(client)
    with client.websocket_connect("/ws/eeg") as ws:
        messages = [ws.receive_json() for _ in range(2)]
        assert any(m["source"] == "simulation" for m in messages)
        batch = next(m for m in messages if m["type"] == "eeg")
        assert len(batch["samples"][0]) == 8
    client.post("/api/device/disconnect").raise_for_status()
    ended = client.get(f"/api/sessions/{session['id']}").json()
    assert ended["status"] == "interrupted"
    next_session = create_session(client)
    client.post(f"/api/sessions/{next_session['id']}/stop").raise_for_status()
    result = client.get("/api/compare", params=[("session_ids", session["id"]), ("session_ids", next_session["id"])]).json()
    assert result["compatible"] is False
    assert any("student_id" in w for w in result["warnings"])


def test_api_schema(client):
    schema = client.get("/openapi.json").json()
    assert "/api/sessions/{session_id}/events" in schema["paths"]
    assert "StimulusEventRequest" in schema["components"]["schemas"]


def test_persistence_after_process_lifespan(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        session = create_session(client)
        time.sleep(.1)
        stopped = client.post(f"/api/sessions/{session['id']}/stop").json()
    with TestClient(create_app(tmp_path)) as client:
        loaded = client.get(f"/api/sessions/{session['id']}").json()
        assert loaded == stopped
        assert client.get(f"/api/sessions/{session['id']}/analysis").json() == stopped["analysis"]
        assert client.get("/api/device").json()["source"] is None


def test_unclean_restart_marks_recording_interrupted(tmp_path):
    from backend.storage import Store
    with TestClient(create_app(tmp_path)) as client:
        session = create_session(client)
        client.post(f"/api/sessions/{session['id']}/stop").raise_for_status()
    store = Store(tmp_path)
    persisted = store.get("sessions", session["id"])
    persisted["status"] = "recording"
    persisted["analysis"] = None
    store.put("sessions", persisted)
    with TestClient(create_app(tmp_path)) as client:
        loaded = client.get(f"/api/sessions/{session['id']}").json()
        assert loaded["status"] == "interrupted"
        assert any("restarted" in w for w in loaded["warnings"])


def test_csv_labels_simulation_even_without_any_trials(client):
    session = create_session(client)
    identifier = session["id"]
    client.post(f"/api/sessions/{identifier}/stop").raise_for_status()
    export = client.get(f"/api/sessions/{identifier}/export.csv")
    assert "simulation" in export.text
    assert "insufficient_data" in export.text
    assert "simulation" in export.headers["content-disposition"]


def test_interrupted_audio_is_excluded_and_local_origin_is_allowed(client):
    session = create_session(client)
    path = f"/api/sessions/{session['id']}"
    marker = {"trial_index": 0, "onset_timestamp": session["started_at"] + 1.0}
    assert client.post(path + "/events", json=marker, headers={"Origin": "http://127.0.0.1:8000"}).status_code == 201
    stopped = client.post(path + "/stop", json={"interrupted": True, "reason": "Audio interrupted", "canceled_trial_indices": [0]}).json()
    assert stopped["status"] == "interrupted"
    assert stopped["events"][0]["canceled"] is True
    assert stopped["analysis"]["rejection_reasons"]["canceled_stimulus"] == 1
    assert stopped["analysis"]["counts"]["accepted"] == {"standard": 0, "deviant": 0}


def test_device_exposes_active_recording_for_recovery(client):
    session = create_session(client)
    assert client.get("/api/device").json()["active_session_id"] == session["id"]
    client.post(f"/api/sessions/{session['id']}/stop").raise_for_status()
    assert client.get("/api/device").json()["active_session_id"] is None
