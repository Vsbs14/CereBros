from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ConnectRequest(Model):
    source: Literal["simulation", "hardware"]
    serial_port: str = Field(default="", max_length=200)
    electrode_reference: str = Field(default="Unspecified", min_length=1, max_length=100)
    electrode_labels: list[str] = Field(default_factory=lambda: [f"CH{i}" for i in range(1, 9)], min_length=8, max_length=8)
    # One-based board channels with electrodes attached. Only these are switched on and routed
    # to the bias drive (RLD), matching the NeuroPawn visualizer. Floating channels routed into
    # RLD inject noise into every channel.
    active_channels: list[int] = Field(default_factory=lambda: list(range(1, 9)), min_length=1, max_length=8)

    @model_validator(mode="after")
    def validate_hardware(self):
        if self.source == "hardware" and not self.serial_port.strip():
            raise ValueError("A serial port is required for hardware")
        if len(set(self.active_channels)) != len(self.active_channels) or any(c < 1 or c > 8 for c in self.active_channels):
            raise ValueError("Active channels must be unique board channel numbers between 1 and 8")
        if any(not s.strip() or len(s) > 30 for s in self.electrode_labels):
            raise ValueError("Provide eight nonempty electrode labels, each at most 30 characters")
        return self


class AnalysisConfig(Model):
    channel_indices: list[int] | None = Field(default=None, min_length=1, max_length=8)
    epoch_start_ms: float = Field(default=-200, ge=-1000, le=-50)
    epoch_end_ms: float = Field(default=800, ge=650, le=2000)
    baseline_start_ms: float = Field(default=-200, ge=-1000, le=-10)
    baseline_end_ms: float = Field(default=0, ge=-500, le=0)
    p300_start_ms: float = Field(default=300, ge=200, le=800)
    p300_end_ms: float = Field(default=600, ge=300, le=1200)
    low_hz: float = Field(default=0.5, ge=0.05, le=2)
    high_hz: float = Field(default=20, ge=10, le=40)
    artifact_peak_to_peak_uv: float = Field(default=150, ge=20, le=1000)
    artifact_absolute_uv: float = Field(default=150, ge=20, le=1000)
    flatline_std_uv: float = Field(default=0.05, ge=0, le=5)
    min_trials_per_condition: int = Field(default=20, ge=5, le=200)
    max_timing_uncertainty_ms: float = Field(default=20, ge=1, le=100)
    exploratory_component: Literal["mmn", "n400"] | None = None
    exploratory_start_ms: float = Field(default=150, ge=50, le=700)
    exploratory_end_ms: float = Field(default=250, ge=100, le=1000)
    electrode_configuration_confirmed: bool = False
    controlled_conditions_confirmed: bool = False

    @model_validator(mode="after")
    def validate_windows(self):
        if self.channel_indices is not None and (len(set(self.channel_indices)) != len(self.channel_indices) or any(i < 0 or i > 7 for i in self.channel_indices)):
            raise ValueError("Channel indices must be unique zero-based indices between 0 and 7")
        if not self.epoch_start_ms <= self.baseline_start_ms < self.baseline_end_ms <= 0:
            raise ValueError("Baseline must lie within the prestimulus epoch")
        if not 0 < self.p300_start_ms < self.p300_end_ms <= self.epoch_end_ms:
            raise ValueError("P300 window must lie within the poststimulus epoch")
        if not 0 < self.exploratory_start_ms < self.exploratory_end_ms <= self.epoch_end_ms:
            raise ValueError("Exploratory window must lie within the epoch")
        return self


class SessionRequest(Model):
    student_id: str
    sound_pair_id: str = "tone-demo"
    trials: int = Field(default=120, ge=20, le=500)
    deviant_probability: float = Field(default=0.2, ge=0.1, le=0.4)
    interval_s: float = Field(default=1.5, ge=1.1, le=10)
    protocol: Literal["auditory_oddball", "semantic_contrast"] = "auditory_oddball"
    attention_task: str = Field(default="Silently count the deviant sounds", min_length=5, max_length=300)
    stimulus_metadata: dict[str, str] = Field(default_factory=dict, max_length=20)
    analysis: AnalysisConfig = Field(default_factory=AnalysisConfig)

    @model_validator(mode="after")
    def validate_protocol(self):
        if self.interval_s * 1000 <= self.analysis.epoch_end_ms - self.analysis.epoch_start_ms:
            raise ValueError("Stimulus interval must exceed the full epoch duration")
        if self.analysis.exploratory_component == "n400" and self.protocol != "semantic_contrast":
            raise ValueError("N400 requires a controlled semantic contrast protocol")
        if self.analysis.exploratory_component == "mmn" and self.protocol != "auditory_oddball":
            raise ValueError("MMN requires an auditory oddball protocol")
        return self


class StimulusEventRequest(Model):
    trial_index: int = Field(ge=0)
    onset_timestamp: float = Field(gt=0)
    timing_uncertainty_ms: float | None = Field(default=None, ge=0, le=10000)
    timing_method: Literal["browser_estimate", "calibrated_audio", "hardware_loopback"] = "browser_estimate"
    calibration_reference: str | None = Field(default=None, min_length=3, max_length=300)

    @model_validator(mode="after")
    def validate_calibration(self):
        if self.timing_method != "browser_estimate" and (
            self.calibration_reference is None or self.timing_uncertainty_ms is None
        ):
            raise ValueError("Calibrated markers need a calibration reference and uncertainty")
        return self


class StudentRequest(Model):
    name: str = Field(min_length=1, max_length=100)
    native_language: str = Field(default="", max_length=100)
    target_language: str = Field(default="Spanish", max_length=100)


class DeviceStatus(Model):
    active_channels: list[int] = Field(default_factory=list)
    active_session_id: str | None = None
    source: Literal["simulation", "hardware"] | None
    connected: bool
    error: str | None
    sampling_rate: int | None
    channel_labels: list[str]
    electrode_reference: str
    last_sample_timestamp: float | None
    signal_quality: Literal["not_measured", "synthetic", "unavailable"]
    units: Literal["microvolts"]
    hardware_verified: bool
    note: str


class EEGBatch(Model):
    type: Literal["eeg"] = "eeg"
    sequence: int
    source: Literal["simulation", "hardware"]
    sampling_rate: int
    channel_labels: list[str]
    timestamps: list[float]
    samples: list[list[float]]
    units: Literal["microvolts"] = "microvolts"


class Waveform(Model):
    # Arrays are channel x epoch time (unlike live batches, which are sample x channel).
    mean_uv: list[list[float]]
    ci95_half_width_uv: list[list[float]] | None


class Metric(Model):
    channel_index: int
    electrode: str
    condition: Literal["standard", "deviant", "difference"]
    window_mean_uv: float | None
    mean_ci95_half_width_uv: float | None
    peak_amplitude_uv: float | None
    peak_latency_ms: float | None


class TrialQuality(Model):
    trial_index: int
    condition: Literal["standard", "deviant"]
    status: Literal["accepted", "rejected", "pending"]
    reasons: list[str]


class TrialCounts(Model):
    accepted: dict[str, int]
    rejected: int
    pending: int
    presented: int


class ExploratoryResult(Model):
    component: Literal["mmn", "n400"]
    eligible: bool
    status: Literal["descriptive_only", "unavailable"]
    window_ms: list[float]
    difference_mean_uv: list[float] | None
    note: str


class AnalysisResult(Model):
    pipeline_version: str
    source: Literal["simulation", "hardware"]
    protocol: Literal["auditory_oddball", "semantic_contrast"]
    finalized: bool
    sampling_rate: int
    channel_labels: list[str]
    time_ms: list[float]
    config: AnalysisConfig
    counts: TrialCounts
    rejection_reasons: dict[str, int]
    quality: Literal["sufficient_for_descriptive_analysis", "insufficient_data", "timing_uncalibrated"]
    timing_calibrated: bool
    waveforms: dict[str, Waveform | None]
    metrics: list[Metric]
    trial_quality: list[TrialQuality]
    exploratory: ExploratoryResult | None
    warnings: list[str]


class StudentResponse(StudentRequest):
    id: str
    created_at: float


class TrialPlanEntry(Model):
    trial_index: int
    condition: Literal["standard", "deviant"]


class StopRequest(Model):
    interrupted: bool = False
    reason: str | None = Field(default=None, max_length=300)
    canceled_trial_indices: list[int] = Field(default_factory=list, max_length=500)


class StimulusEvent(StimulusEventRequest):
    canceled: bool = False
    condition: Literal["standard", "deviant"]
    received_at: float


class SessionSummary(Model):
    id: str
    student_id: str
    started_at: float
    ended_at: float | None
    status: Literal["recording", "completed", "interrupted"]
    source: Literal["simulation", "hardware"]
    sampling_rate: int
    channel_labels: list[str]
    electrode_reference: str
    hardware_metadata: dict[str, str | int | None]
    request: SessionRequest
    warnings: list[str]


class SessionResponse(SessionSummary):
    trial_plan: list[TrialPlanEntry]
    events: list[StimulusEvent]
    analysis: AnalysisResult | None
