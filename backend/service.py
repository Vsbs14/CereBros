import copy
from collections import deque
from pathlib import Path
import secrets
import threading
import time
import uuid

import numpy as np

from .analysis import MAX_SAMPLE_STEP, analyze
from .signal_check import check_signal
from .device import Device
from .models import AnalysisConfig, ConnectRequest, SessionRequest, StimulusEventRequest, StopRequest
from .storage import Store


SOUND_PAIRS = [
    {"id": "tone-demo", "language": None, "standard": "1000 Hz tone", "deviant": "1500 Hz tone",
     "audio_available": False, "note": "Frontend may synthesize tones. This is an auditory demo, not language recognition."},
    {"id": "caballo-cabello", "language": "Spanish", "standard": "caballo", "deviant": "cabello",
     "audio_available": False, "note": "Supply pre-recorded word buffers and record their identities in stimulus_metadata."},
]


class Service:
    def __init__(self, root: Path):
        self.lock = threading.RLock()
        self.store = Store(root)
        self.device = Device()
        self.active = None
        self.chunks = []
        self.sample_count = 0
        self.sequence = 0
        self.latest = None
        self.recent = deque()  # (timestamps, values) batches for the pre-experiment signal check
        self.stop_event = threading.Event()
        self.worker = threading.Thread(target=self._run, daemon=True, name="eeg-acquisition")
        self.worker.start()
        # A server restart cannot resume uninterrupted acquisition.
        for session in self.store.list("sessions"):
            if session["status"] == "recording":
                session["status"] = "interrupted"
                session["ended_at"] = time.time()
                session["warnings"].append("Server restarted; recording may be truncated at the last checkpoint.")
                self.store.put("sessions", session)

    def _run(self):
        while not self.stop_event.wait(.04):
            with self.lock:
                if self.device.source is None:
                    continue
                try:
                    ts, values = self.device.read()
                    if len(ts):
                        if not np.isfinite(ts).all() or not np.isfinite(values).all():
                            raise ValueError("Device returned nonfinite EEG samples")
                        self.device.last_sample = float(ts[-1])
                        self.recent.append((ts.copy(), values.copy()))
                        while self.recent and self.recent[-1][0][-1] - self.recent[0][0][-1] > 15:
                            self.recent.popleft()
                        self.sequence += 1
                        self.latest = {"type": "eeg", "sequence": self.sequence, "source": self.device.source,
                                       "sampling_rate": self.device.sampling_rate, "channel_labels": self.device.labels,
                                       "timestamps": ts.tolist(), "samples": values.tolist(), "units": "microvolts"}
                        if self.active:
                            self.chunks.append((ts.copy(), values.copy()))
                            self.sample_count += len(ts)
                            # Checkpoint every ~5 seconds; full-rate data are never display-downsampled.
                            if time.monotonic() - self.checkpoint_time > 5:
                                self._checkpoint()
                            max_duration = min(1800, self.active["request"]["trials"] * self.active["request"]["interval_s"] + 60)
                            if time.time() - self.active["started_at"] > max_duration or self.sample_count > self.device.sampling_rate * 1805:
                                self._finish("interrupted", "Recording duration limit reached.")
                    elif self.device.source == "hardware" and time.time() - (self.device.last_sample or self.device.connected_at) > 5:
                        raise RuntimeError("No EEG samples received for five seconds")
                except Exception as exc:
                    self.device.error = str(exc)
                    if self.active:
                        try:
                            self._finish("interrupted", "Acquisition failed: " + str(exc))
                        except Exception:
                            self.active = None
                    try:
                        self.device.disconnect()
                    except Exception:
                        pass

    def close(self):
        self.stop_event.set()
        self.worker.join(timeout=10)
        with self.lock:
            if self.active:
                self._finish("interrupted", "Backend shut down during acquisition.")
            self.device.disconnect()

    def status(self):
        with self.lock:
            return {**self.device.status(), "active_session_id": self.active["id"] if self.active else None}

    def connect(self, request: ConnectRequest):
        with self.lock:
            self.device.connect(request)
            self.latest = None
            self.recent.clear()
            return self.device.status()

    def disconnect(self):
        with self.lock:
            if self.active:
                self._finish("interrupted", "Device disconnected during acquisition.")
            self.device.disconnect()
            return self.device.status()

    def signal_check(self, seconds: float = 5.0, channels: list[int] | None = None):
        """channels are zero-based, like AnalysisConfig.channel_indices."""
        with self.lock:
            if self.device.source is None:
                raise ValueError("Connect a source before running a signal check")
            batches = list(self.recent)
            fs, labels = self.device.sampling_rate, list(self.device.labels)
        channels = list(range(len(labels))) if channels is None else channels
        if any(c < 0 or c >= len(labels) for c in channels) or len(set(channels)) != len(channels):
            raise ValueError("Signal check channels must be unique zero-based indices between 0 and 7")
        if not batches:
            return check_signal([], [[]], fs, labels, channels)
        times = np.concatenate([b[0] for b in batches])
        values = np.concatenate([b[1] for b in batches])
        keep = times >= times[-1] - seconds
        times, values = times[keep], values[keep]
        # Use only the most recent unbroken stretch; gaps would distort the windows.
        gaps = np.where(np.diff(times) > MAX_SAMPLE_STEP / fs)[0]
        if len(gaps):
            times, values = times[gaps[-1] + 1:], values[gaps[-1] + 1:]
        result = check_signal(times, values, fs, labels, channels)
        return {**result, "source": self.device.source, "checked_at": time.time()}

    def start(self, request: SessionRequest):
        with self.lock:
            if self.device.source is None:
                raise ValueError("Connect a hardware or explicitly selected simulation source first")
            if self.active:
                raise ValueError("A session is already recording")
            if not self.store.get("students", request.student_id):
                raise ValueError("Student does not exist")
            if request.sound_pair_id not in {p["id"] for p in SOUND_PAIRS}:
                raise ValueError("Unknown sound pair")
            if request.analysis.channel_indices is not None and any(i >= len(self.device.labels) for i in request.analysis.channel_indices):
                raise ValueError("Selected analysis channel is unavailable")
            if request.analysis.high_hz >= self.device.sampling_rate / 2:
                raise ValueError("Filter cutoff exceeds Nyquist frequency")
            plan = ["deviant"] * round(request.trials * request.deviant_probability)
            plan += ["standard"] * (request.trials - len(plan))
            secrets.SystemRandom().shuffle(plan)
            now = time.time()
            session = {"id": str(uuid.uuid4()), "student_id": request.student_id, "started_at": now,
                       "ended_at": None, "status": "recording", "source": self.device.source,
                       "sampling_rate": self.device.sampling_rate, "channel_labels": self.device.labels.copy(),
                       "electrode_reference": self.device.reference,
                       "hardware_metadata": {"board": "Knight" if self.device.source == "hardware" else None, "gain": 12 if self.device.source == "hardware" else None},
                       "request": request.model_dump(), "trial_plan": [{"trial_index": i, "condition": condition} for i, condition in enumerate(plan)],
                       "events": [], "warnings": [], "analysis": None}
            self.active = session
            self.chunks = []
            self.sample_count = 0
            self.checkpoint_time = time.monotonic()
            self.store.put("sessions", session)
            return copy.deepcopy(session)

    def arrays(self):
        if not self.chunks:
            return np.empty(0), np.empty((0, 8))
        return np.concatenate([x[0] for x in self.chunks]), np.concatenate([x[1] for x in self.chunks])

    def _checkpoint(self):
        if self.active:
            self.store.save_recording(self.active["id"], *self.arrays())
            self.store.put("sessions", self.active)
            self.checkpoint_time = time.monotonic()

    def session(self, identifier):
        with self.lock:
            session = self.active if self.active and self.active["id"] == identifier else self.store.get("sessions", identifier)
            if not session:
                raise KeyError("Session not found")
            return copy.deepcopy(session)

    def marker(self, identifier, request: StimulusEventRequest):
        with self.lock:
            if not self.active or self.active["id"] != identifier:
                raise ValueError("Session is not recording")
            session = self.active
            if request.trial_index >= len(session["trial_plan"]):
                raise ValueError("Trial index is outside the plan")
            event = request.model_dump()
            event["condition"] = session["trial_plan"][request.trial_index]["condition"]
            for previous in session["events"]:
                if previous["trial_index"] == request.trial_index:
                    if all(previous[k] == v for k, v in event.items()):
                        return previous  # Idempotent network retries.
                    raise ValueError("Trial already has a different onset event")
            now = time.time()
            if not session["started_at"] + .7 <= request.onset_timestamp <= now + 2:
                raise ValueError("Onset needs at least 700ms recording lead-in and may be at most 2s in the future")
            if request.trial_index != len(session["events"]):
                raise ValueError("Submit trial markers in plan order")
            if session["events"]:
                delta = request.onset_timestamp - session["events"][-1]["onset_timestamp"]
                if delta < session["request"]["interval_s"] * .95:
                    raise ValueError("Stimulus onsets violate the configured interval")
            event["received_at"] = now
            session["events"].append(event)
            if self.device.source == "simulation":
                self.device.stimuli.append(event.copy())
            self.store.put("sessions", session)
            return copy.deepcopy(event)

    def analysis(self, identifier):
        with self.lock:
            session = self.session(identifier)
            if session.get("analysis"):
                return session["analysis"]
            timestamps, samples = self.arrays() if self.active and self.active["id"] == identifier else self.store.recording(identifier)
            timestamps, samples = timestamps.copy(), samples.copy()
        return analyze(timestamps, samples, session["events"], session["sampling_rate"], session["channel_labels"],
                       AnalysisConfig(**session["request"]["analysis"]), session["source"], session["request"]["protocol"],
                       session["status"] != "recording")

    def _finish(self, status, warning=None):
        session = self.active
        if not session:
            raise ValueError("No active session")
        self._checkpoint()
        for event in session["events"]:
            if event["onset_timestamp"] > time.time():
                event["canceled"] = True
        session["status"] = status
        session["ended_at"] = time.time()
        if warning:
            session["warnings"].append(warning)
        if len(session["events"]) < len(session["trial_plan"]):
            session["warnings"].append("Session ended before all planned stimulus events were submitted.")
        session["analysis"] = self.analysis(session["id"])
        self.store.put("sessions", session)
        self.active = None
        self.chunks = []
        self.sample_count = 0
        return copy.deepcopy(session)

    def stop(self, identifier, request: StopRequest | None = None):
        with self.lock:
            if not self.active or self.active["id"] != identifier:
                existing = self.session(identifier)
                if existing["status"] != "recording":
                    return existing
                raise ValueError("Session is not active")
            request = request or StopRequest()
            for event in self.active["events"]:
                if event["trial_index"] in request.canceled_trial_indices:
                    event["canceled"] = True
            return self._finish("interrupted" if request.interrupted else "completed", request.reason)

    def compare(self, identifiers):
        sessions = [self.session(s) for s in identifiers]
        warnings = []
        base = sessions[0]
        for session in sessions[1:]:
            for field in ("student_id", "source", "sampling_rate", "channel_labels", "electrode_reference", "hardware_metadata"):
                if session[field] != base[field]:
                    warnings.append(f"Sessions differ in {field}.")
            for field in ("sound_pair_id", "protocol", "analysis", "interval_s", "deviant_probability", "attention_task", "stimulus_metadata"):
                if session["request"][field] != base["request"][field]:
                    warnings.append(f"Sessions differ in {field}.")
        analyses = [self.analysis(s["id"]) for s in sessions]
        if any(a["quality"] != "sufficient_for_descriptive_analysis" for a in analyses):
            warnings.append("One or more sessions have insufficient data or uncalibrated timing.")
        return {"sessions": [{"id": s["id"], "source": s["source"], "started_at": s["started_at"],
                               "quality": a["quality"], "metrics": a["metrics"], "counts": a["counts"]} for s, a in zip(sessions, analyses)],
                "compatible": not warnings, "warnings": warnings + ["Differences are descriptive and do not prove learning."]}
