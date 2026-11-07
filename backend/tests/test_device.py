import numpy as np
import pytest

from backend.device import Device
from backend.models import ConnectRequest


def test_real_adapter_activation_scaling_metadata_and_cleanup(monkeypatch):
    import brainflow.board_shim as sdk
    calls = []

    class FakeBoard:
        def __init__(self, board_id, params):
            assert board_id == sdk.BoardIds.NEUROPAWN_KNIGHT_BOARD.value
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
    assert values[0, 0] == 7  # Already microvolts from BrainFlow; do not rescale twice.
    assert ts[0] == 100
    device.disconnect()
    assert calls[-2:] == ["stop", "release"]
    assert device.source is None


def test_analysis_config_rejects_semantic_mislabeling():
    from backend.models import SessionRequest
    with pytest.raises(ValueError):
        SessionRequest(student_id="test", analysis={"exploratory_component": "n400"})
