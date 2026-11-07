import numpy as np
import pytest

from backend.device import Device
from backend.models import ConnectRequest


def test_real_adapter_activation_scaling_metadata_and_cleanup(monkeypatch):
    import brainflow.board_shim as sdk
    calls = []

    class FakeBoard:
        def __init__(self, board_id, params):
            assert board_id == sdk.BoardIds.NEUROPAWN_KNIGHT_BOARD_IMU.value
            assert params.other_info == '{"gain": 12}'
            assert params.serial_port == "/test"
        def prepare_session(self):
            calls.append("prepare")
        def start_stream(self, size):
            calls.append("stream")
        def config_board(self, command):
            calls.append(command)
        def get_board_data(self):
            data = np.zeros((13, 5))
            data[11] = np.arange(5) / 125 + 100
            data[1:9] = 7
            return data
        def stop_stream(self):
            calls.append("stop")
        def release_session(self):
            calls.append("release")
        get_eeg_channels = staticmethod(lambda board_id: list(range(1, 9)))
        get_timestamp_channel = staticmethod(lambda board_id: 11)
        get_sampling_rate = staticmethod(lambda board_id: 125)

    monkeypatch.setattr(sdk, "BoardShim", FakeBoard)
    monkeypatch.setattr("backend.device.time.sleep", lambda _: None)
    device = Device()
    device.connect(ConnectRequest(source="hardware", serial_port="/test"))
    assert calls[:2] == ["prepare", "stream"]
    assert calls[2:] == [cmd for i in range(1, 9) for cmd in (f"chon_{i}_12", f"rldadd_{i}")]
    ts, values = device.read()
    assert values.shape == (5, 8)
    # BrainFlow <= 5.23 omits the 79.57 front-end gain; it is corrected exactly once.
    from backend.device import knight_scale_correction
    assert values[0, 0] == pytest.approx(7 * knight_scale_correction())
    assert ts[0] == 100
    device.disconnect()
    assert calls[-2:] == ["stop", "release"]
    assert device.source is None


def test_only_attached_channels_are_enabled_and_routed_to_bias(monkeypatch):
    import brainflow.board_shim as sdk
    calls = []

    class FakeBoard:
        def __init__(self, board_id, params): pass
        def prepare_session(self): pass
        def start_stream(self, size): pass
        def config_board(self, command): calls.append(command)
        def get_board_data(self): return np.zeros((22, 0))
        def stop_stream(self): pass
        def release_session(self): pass
        get_eeg_channels = staticmethod(lambda board_id: list(range(1, 9)))
        get_timestamp_channel = staticmethod(lambda board_id: 20)
        get_sampling_rate = staticmethod(lambda board_id: 125)

    monkeypatch.setattr(sdk, "BoardShim", FakeBoard)
    monkeypatch.setattr("backend.device.time.sleep", lambda _: None)
    Device().connect(ConnectRequest(source="hardware", serial_port="COM3", active_channels=[2, 3]))
    assert calls[:4] == ["rldremove_1", "choff_1", "chon_2_12", "rldadd_2"]
    assert "rldadd_8" not in calls and "choff_8" in calls
    with pytest.raises(ValueError):
        ConnectRequest(source="hardware", serial_port="COM3", active_channels=[0])


def test_analysis_config_rejects_semantic_mislabeling():
    from backend.models import SessionRequest
    with pytest.raises(ValueError):
        SessionRequest(student_id="test", analysis={"exploratory_component": "n400"})


def test_knight_scale_correction_follows_version_and_override(monkeypatch):
    import importlib.metadata
    from backend.device import knight_scale_correction
    monkeypatch.delenv("NEUROLINGO_KNIGHT_SCALE_FIX", raising=False)
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "5.23.0")
    assert knight_scale_correction() == pytest.approx(1 / 79.57)
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "5.24.0")
    assert knight_scale_correction() == 1.0
    monkeypatch.setenv("NEUROLINGO_KNIGHT_SCALE_FIX", "0")
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "5.23.0")
    assert knight_scale_correction() == 1.0
