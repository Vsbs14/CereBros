"""Run locally: python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000"""
import asyncio
from contextlib import asynccontextmanager
import csv
import io
import os
from pathlib import Path
import time
import uuid

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .models import (AnalysisResult, ConnectRequest, DeviceStatus, SessionRequest, SessionResponse,
                     SessionSummary, StimulusEvent, StimulusEventRequest, StudentRequest, StudentResponse, StopRequest)
from .service import Service, SOUND_PAIRS


DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "temp" / "data"


def create_app(data_dir: Path | None = None):
    allowed_origins = os.getenv("NEUROLINGO_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000").split(",")

    @asynccontextmanager
    async def lifespan(app):
        app.state.service = Service(data_dir or Path(os.getenv("NEUROLINGO_DATA_DIR", str(DEFAULT_ROOT))))
        yield
        await asyncio.to_thread(app.state.service.close)

    app = FastAPI(title="NeuroLingo EEG API", version="0.1.0", lifespan=lifespan,
                  description="Local research backend. Real hardware is never replaced with simulation. No diagnostic or recognition claims.")
    app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def local_write_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and origin not in allowed_origins:
            return JSONResponse(status_code=403, content={"detail": "Origin is not allowed"})
        return await call_next(request)

    @app.exception_handler(ValueError)
    async def invalid_state(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse(status_code=404, content={"detail": exc.args[0]})

    def svc():
        return app.state.service

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": "0.1.0", "hardware_verification": "pending_physical_test"}

    @app.get("/api/clock")
    def clock() -> dict:
        return {"server_timestamp": time.time(), "unit": "unix_seconds", "note": "Response transit time and audio output latency are separate uncertainties."}

    @app.get("/api/device")
    def device_status() -> DeviceStatus:
        with svc().lock:
            return svc().status()

    @app.post("/api/device/connect")
    def connect(body: ConnectRequest) -> DeviceStatus:
        try:
            return svc().connect(body)
        except ValueError:
            raise
        except Exception as exc:
            raise HTTPException(503, f"Hardware connection failed; simulation was not enabled. {exc}") from exc

    @app.get("/api/device/signal-check")
    def signal_check(seconds: float = Query(5.0, ge=3, le=15), channels: str | None = Query(None, description="Zero-based channel indices, comma separated")):
        try:
            selected = None if not channels else [int(c) for c in channels.split(",") if c.strip()]
        except ValueError as exc:
            raise ValueError("channels must be comma-separated integers") from exc
        return svc().signal_check(seconds, selected)

    @app.post("/api/device/disconnect")
    def disconnect() -> DeviceStatus:
        return svc().disconnect()

    @app.get("/api/students")
    def students() -> list[StudentResponse]:
        return svc().store.list("students")

    @app.post("/api/students", status_code=201)
    def create_student(body: StudentRequest) -> StudentResponse:
        student = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": time.time()}
        svc().store.put("students", student)
        return student

    @app.get("/api/students/{student_id}")
    def student(student_id: uuid.UUID) -> StudentResponse:
        result = svc().store.get("students", str(student_id))
        if result is None:
            raise KeyError("Student not found")
        return result

    @app.get("/api/students/{student_id}/sessions")
    def student_sessions(student_id: uuid.UUID) -> list[SessionSummary]:
        student(student_id)
        return [s for s in list_sessions() if s["student_id"] == str(student_id)]

    @app.get("/api/sound-pairs")
    def sound_pairs() -> list[dict]:
        return SOUND_PAIRS

    @app.post("/api/sessions", status_code=201)
    def start_session(body: SessionRequest) -> SessionResponse:
        return svc().start(body)

    @app.get("/api/sessions")
    def list_sessions() -> list[SessionSummary]:
        # Trial plans and waveforms are available from detail/analysis routes.
        return [{k: v for k, v in s.items() if k not in {"analysis", "events", "trial_plan"}} for s in svc().store.list("sessions")]

    @app.get("/api/sessions/{session_id}")
    def session_detail(session_id: uuid.UUID) -> SessionResponse:
        return svc().session(str(session_id))

    @app.post("/api/sessions/{session_id}/events", status_code=201)
    def record_event(session_id: uuid.UUID, body: StimulusEventRequest) -> StimulusEvent:
        return svc().marker(str(session_id), body)

    @app.post("/api/sessions/{session_id}/stop")
    def stop_session(session_id: uuid.UUID, body: StopRequest | None = None) -> SessionResponse:
        return svc().stop(str(session_id), body)

    @app.get("/api/sessions/{session_id}/analysis")
    def analysis(session_id: uuid.UUID) -> AnalysisResult:
        return svc().analysis(str(session_id))

    @app.get("/api/sessions/{session_id}/recording.npz")
    def recording(session_id: uuid.UUID):
        session = svc().session(str(session_id))
        if session["status"] == "recording":
            raise ValueError("Stop the session before exporting its recording")
        path = svc().store.root / f"{session_id}.npz"
        if not path.exists():
            raise HTTPException(404, "No checkpoint recording exists")
        return FileResponse(path, media_type="application/octet-stream", filename=f"{session['source']}-{session_id}.npz")

    @app.get("/api/sessions/{session_id}/export.csv")
    def export_csv(session_id: uuid.UUID):
        result = svc().analysis(str(session_id))
        output = io.StringIO()
        fields = ["session_id", "source", "quality", "pipeline_version", "electrode", "channel_index", "condition",
                  "window_start_ms", "window_end_ms", "accepted_standard", "accepted_deviant", "rejected", "pending",
                  "window_mean_uv", "mean_ci95_half_width_uv", "peak_amplitude_uv", "peak_latency_ms"]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for metric in result["metrics"]:
            row = {"session_id": str(session_id), "source": result["source"], "quality": result["quality"],
                   "pipeline_version": result["pipeline_version"], "window_start_ms": result["config"]["p300_start_ms"],
                   "window_end_ms": result["config"]["p300_end_ms"], "accepted_standard": result["counts"]["accepted"]["standard"],
                   "accepted_deviant": result["counts"]["accepted"]["deviant"], "rejected": result["counts"]["rejected"],
                   "pending": result["counts"]["pending"], **metric}
            # Prevent spreadsheet formula interpretation of operator-supplied electrode names.
            row["electrode"] = "'" + row["electrode"] if row["electrode"].startswith(("=", "+", "-", "@", "\t", "\r")) else row["electrode"]
            writer.writerow(row)
        return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{result["source"]}-{session_id}.csv"'})

    @app.get("/api/compare")
    def compare(session_ids: list[uuid.UUID] = Query(min_length=2, max_length=10)) -> dict:
        return svc().compare([str(s) for s in session_ids])

    @app.websocket("/ws/eeg")
    async def eeg_stream(websocket: WebSocket):
        origin = websocket.headers.get("origin")
        if origin and origin not in allowed_origins:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        last_sequence = -1
        heartbeat = 0
        try:
            while True:
                # A slow websocket client never holds the acquisition lock while sending.
                def snapshot():
                    with svc().lock:
                        return svc().latest, svc().status()
                batch, status = await asyncio.to_thread(snapshot)
                if batch and batch["sequence"] != last_sequence and status["connected"]:
                    await asyncio.wait_for(websocket.send_json(batch), timeout=5)
                    last_sequence = batch["sequence"]
                if time.monotonic() - heartbeat > 1:
                    await asyncio.wait_for(websocket.send_json({"type": "status", **status}), timeout=5)
                    heartbeat = time.monotonic()
                await asyncio.sleep(.02)
        except (WebSocketDisconnect, RuntimeError, TimeoutError):
            return

    # Build the frontend before startup to run both parts from one local origin.
    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend_dist.is_dir():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return app


app = create_app()
