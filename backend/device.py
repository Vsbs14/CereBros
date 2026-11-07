"""Single-owner acquisition worker. Board access is serialized by the service lock."""
import os
import time

import numpy as np

from .models import ConnectRequest


# BrainFlow <= 5.23 omits the Knight front-end gain (79.57) from its microvolt scale, so values
# are ~80x too large. Fixed upstream in brainflow-dev/brainflow#867 (Oct 2026), not yet released.
KNIGHT_FRONT_END_GAIN = 79.57


def knight_scale_correction() -> float:
    override = os.getenv("NEUROLINGO_KNIGHT_SCALE_FIX")
    if override is not None:
        return 1 / KNIGHT_FRONT_END_GAIN if override.strip() in {"1", "true", "yes"} else 1.0
    try:
        from importlib.metadata import version
        parts = tuple(int(p) for p in version("brainflow").split(".")[:2])
    except Exception:
        return 1 / KNIGHT_FRONT_END_GAIN
    return 1 / KNIGHT_FRONT_END_GAIN if parts <= (5, 23) else 1.0


class Device:
    def __init__(self):
        self.source = None
        self.board = None
        self.labels = []
        self.reference = "Unspecified"
        self.sampling_rate = 125
        self.error = None
        self.last_sample = None
        self.simulation_cursor = 0
        self.rng = np.random.default_rng()
        self.stimuli = []
        self.scale_correction = 1.0

    def connect(self, request: ConnectRequest):
        if self.source is not None:
            raise ValueError("Disconnect the existing source first")
        self.error = None
        self.labels = request.electrode_labels
        self.reference = request.electrode_reference
        if request.source == "simulation":
            self.source = "simulation"
            self.simulation_origin = time.time()
            self.simulation_monotonic = time.monotonic()
            self.simulation_cursor = 0
            self.stimuli = []
            self.sampling_rate = 125
            return
        from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds

        # The Knight IMU board streams a different packet layout (22 rows) than the plain
        # Knight (13 rows). Using the wrong ID opens the port but parses zero samples.
        # Set NEUROLINGO_KNIGHT_BOARD=knight for the non-IMU board.
        variant = os.environ.get("NEUROLINGO_KNIGHT_BOARD", "imu").strip().lower()
        board_id = (BoardIds.NEUROPAWN_KNIGHT_BOARD if variant == "knight"
                    else BoardIds.NEUROPAWN_KNIGHT_BOARD_IMU).value
        # Diagnostic: BrainFlow's own log of what it reads from the serial port.
        try:
            from pathlib import Path
            log_dir = Path(os.getenv("NEUROLINGO_DATA_DIR",
                                     Path(__file__).resolve().parent.parent / "temp" / "data"))
            log_dir.mkdir(parents=True, exist_ok=True)
            BoardShim.enable_dev_board_logger()
            BoardShim.set_log_file(str(log_dir / "brainflow.log"))
        except Exception as exc:
            print(f"BrainFlow log file setup failed: {exc}")
        params = BrainFlowInputParams()
        params.serial_port = request.serial_port
        params.other_info = '{"gain": 12}'
        board = BoardShim(board_id, params)
        try:
            board.prepare_session()
            board.start_stream(450000)
            time.sleep(2)
            active = set(request.active_channels)
            for channel in range(1, 9):
                time.sleep(0.5)
                if channel in active:
                    board.config_board(f"chon_{channel}_12")
                    time.sleep(1)
                    board.config_board(f"rldadd_{channel}")
                else:
                    # Unused inputs float; keep them out of the bias drive.
                    board.config_board(f"rldremove_{channel}")
                    time.sleep(1)
                    board.config_board(f"choff_{channel}")
                time.sleep(0.5)
            self.active_channels = sorted(active)
            self.scale_correction = knight_scale_correction()
            self.eeg_rows = BoardShim.get_eeg_channels(board_id)
            self.timestamp_row = BoardShim.get_timestamp_channel(board_id)
            self.sampling_rate = BoardShim.get_sampling_rate(board_id)
            self.board = board
            self.source = "hardware"
            # Discard startup transients. Connection isn't verification of usable EEG.
            board.get_board_data()
            self.connected_at = time.time()
        except Exception:
            try:
                board.release_session()
            except Exception:
                pass
            raise

    def read(self):
        if self.source == "simulation":
            target = int((time.monotonic() - self.simulation_monotonic) * self.sampling_rate)
            # Realistic scheduler delays are preserved as a time gap if >10s, not backfilled indefinitely.
            start = max(self.simulation_cursor, target - self.sampling_rate * 10)
            indices = np.arange(start, target)
            self.simulation_cursor = target
            ts = self.simulation_origin + indices / self.sampling_rate
            values = self.rng.normal(0, 3, (len(ts), 8))
            values += 4 * np.sin(2 * np.pi * 10 * ts[:, None] + np.arange(8))
            self.stimuli = [e for e in self.stimuli if e["onset_timestamp"] > time.time() - 5]
            for event in self.stimuli:
                relative = ts - event["onset_timestamp"]
                amplitude = 8 if event["condition"] == "deviant" else 1.5
                values += (amplitude * np.exp(-0.5 * ((relative - .43) / .07) ** 2))[:, None]
            return ts, values
        if self.board is not None:
            raw = self.board.get_board_data()
            return raw[self.timestamp_row], raw[self.eeg_rows].T * self.scale_correction
        return np.empty(0), np.empty((0, 8))

    def disconnect(self):
        board, self.board = self.board, None
        self.source = None
        self.last_sample = None
        if board:
            try:
                board.stop_stream()
            finally:
                board.release_session()

    def status(self):
        return {"source": self.source, "connected": self.source is not None, "error": self.error,
                "sampling_rate": self.sampling_rate if self.source else None,
                "channel_labels": self.labels, "electrode_reference": self.reference, "last_sample_timestamp": self.last_sample,
                "signal_quality": "not_measured" if self.source == "hardware" else "synthetic" if self.source else "unavailable",
                "units": "microvolts", "hardware_verified": False,
                "note": "Device connection does not establish electrode contact or ERP suitability."}
