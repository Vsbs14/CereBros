"""Short auditory oddball test that runs without the web app.

Connects to the Knight board (or a simulated source), runs the signal check, plays a short
oddball tone sequence, records with host-clock onsets, and reports usable trials and the
300-600 ms window means using the same analysis pipeline as the app.

Close the NeuroPawn visualizer and stop the NeuroLingo server first: only one program can
use the serial port.

Examples (run from the repository root):
    python -m tools.quick_oddball --port COM3 --channels 1,2
    python -m tools.quick_oddball --simulate
    python -m tools.quick_oddball --write-wav          # background WAV for the NeuroPawn app

Timing uses the host clock around a blocking sound call (winsound, aplay or ffplay).
Sound-at-ear latency is not calibrated, so peak latency is withheld.
"""
import argparse
import io
import json
import random
import shutil
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.analysis import analyze  # noqa: E402
from backend.device import Device  # noqa: E402
from backend.models import AnalysisConfig, ConnectRequest  # noqa: E402
from backend.signal_check import check_signal  # noqa: E402

AUDIO_RATE = 44100
STANDARD_HZ, DEVIANT_HZ = 1000, 1500


def tone(freq_hz: float, duration_s: float = 0.1, ramp_s: float = 0.01, volume: float = 0.4) -> np.ndarray:
    t = np.arange(int(AUDIO_RATE * duration_s)) / AUDIO_RATE
    y = np.sin(2 * np.pi * freq_hz * t)
    ramp = int(AUDIO_RATE * ramp_s)
    envelope = np.ones_like(y)
    envelope[:ramp] = np.linspace(0, 1, ramp)
    envelope[-ramp:] = np.linspace(1, 0, ramp)
    return (y * envelope * volume * 32767).astype(np.int16)


def wav_bytes(samples: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(AUDIO_RATE)
        w.writeframes(samples.tobytes())
    return buffer.getvalue()


def make_plan(trials: int, deviant_probability: float, seed: int | None = None) -> list[str]:
    if trials < 1 or not 0 <= deviant_probability <= 0.5:
        raise ValueError("Use at least one trial and a deviant probability between 0 and 0.5")
    deviants = round(trials * deviant_probability)
    standards = trials - deviants
    rng = random.Random(seed)
    # Choose gaps after standards directly; shuffle-and-retry can run indefinitely.
    slots = set(rng.sample(range(standards), deviants))
    return [condition for i in range(standards)
            for condition in (["standard", "deviant"] if i in slots else ["standard"])]


def write_background_wav(path: Path, trials: int, interval_s: float, deviant_probability: float, lead_s: float = 3.0):
    if interval_s < 0.1 or lead_s < 0:
        raise ValueError("WAV interval must be at least 0.1 seconds and lead-in must be nonnegative")
    plan = make_plan(trials, deviant_probability, seed=7)
    total = int(AUDIO_RATE * (lead_s + trials * interval_s + 1))
    audio = np.zeros(total, dtype=np.int16)
    sounds = {"standard": tone(STANDARD_HZ), "deviant": tone(DEVIANT_HZ)}
    rows = ["trial,onset_s,condition"]
    for i, condition in enumerate(plan):
        onset = lead_s + i * interval_s
        start = int(onset * AUDIO_RATE)
        audio[start:start + len(sounds[condition])] = sounds[condition]
        rows.append(f"{i},{onset:.3f},{condition}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(wav_bytes(audio))
    path.with_suffix(".schedule.csv").write_text("\n".join(rows) + "\n")
    return plan


class Player:
    def __init__(self):
        try:
            import winsound
            self.winsound = winsound
        except ImportError:
            self.winsound = None
        self.command = ([shutil.which("aplay"), "-q"] if shutil.which("aplay") else
                        [shutil.which("ffplay"), "-nodisp", "-autoexit", "-loglevel", "error", "-i", "pipe:0"]
                        if shutil.which("ffplay") else None)
        if not self.winsound and not self.command:
            raise RuntimeError("No supported audio player found. Use the browser experiment, or install aplay/ffplay.")
        self.sounds = {"standard": wav_bytes(tone(STANDARD_HZ)), "deviant": wav_bytes(tone(DEVIANT_HZ))}

    def play(self, condition: str) -> float:
        onset = time.time()
        if self.winsound:
            self.winsound.PlaySound(self.sounds[condition], self.winsound.SND_MEMORY)
        else:
            subprocess.run(self.command, input=self.sounds[condition], check=True, timeout=10,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return onset


def print_check(result: dict):
    print(f"\nSignal check ({result['seconds_analyzed']} s): {result['overall'].upper()}")
    for c in result["channels"]:
        print(f"  {c['label']:>4}  {c['status']:<5} usable {c['predicted_acceptance']:>4.0%}  "
              f"EEG {c['eeg_rms_uv']:7.1f} µV  hum {c['line_noise_rms_uv']:7.1f} µV  clipped {c['saturated_fraction']:.0%}")
        for problem in c["problems"]:
            print(f"        - {problem}")
    for advice in result["advice"]:
        print(f"  * {advice}")


def run(args):
    make_plan(args.trials, args.deviant_probability)  # Validate before touching hardware.
    if args.interval < 1.1 or args.settle < 3:
        raise ValueError("Use an interval of at least 1.1 seconds and settling time of at least 3 seconds")
    player = None if args.check_only else Player()
    channels = [int(c) for c in args.channels.split(",")]
    labels = [f"CH{i}" for i in range(1, 9)]
    device = Device()
    request = ConnectRequest(source="simulation") if args.simulate else ConnectRequest(
        source="hardware", serial_port=args.port, active_channels=channels)
    print("Connecting" + (" to simulation" if args.simulate else f" to {args.port} (about 20 s)") + "...")
    device.connect(request)
    times, chunks, lock, stop = [], [], threading.Lock(), threading.Event()

    def reader():
        while not stop.wait(0.04):
            ts, values = device.read()
            if len(ts):
                with lock:
                    times.append(ts.copy())
                    chunks.append(values.copy())

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    try:
        print(f"Settling for {args.settle:.0f} s. Sit still, eyes open, relaxed jaw.")
        time.sleep(args.settle)
        with lock:
            if not times:
                raise RuntimeError("No EEG samples received. Check the serial port, board variant and device connection.")
            ts, data = np.concatenate(times), np.concatenate(chunks)
        recent = ts >= ts[-1] - 5
        result = check_signal(ts[recent], data[recent], device.sampling_rate, labels, [c - 1 for c in channels])
        print_check(result)
        if args.check_only:
            return 0
        if not result["ready"] and not args.force:
            print("\nNot starting: fix the issues above and run again, or pass --force for a test run.")
            return 2

        plan = make_plan(args.trials, args.deviant_probability)
        print(f"\nPlaying {args.trials} tones ({plan.count('deviant')} high deviants), one every {args.interval} s. "
              "Silently count the high tones.")
        events, start = [], time.time() + 1.0
        for i, condition in enumerate(plan):
            while time.time() < start + i * args.interval:
                time.sleep(0.002)
            onset = player.play(condition)
            event = {"trial_index": i, "condition": condition, "onset_timestamp": onset,
                     "timing_method": "browser_estimate", "timing_uncertainty_ms": None}
            events.append(event)
            if args.simulate:
                device.stimuli.append(event.copy())
            print(f"\r  {i + 1}/{args.trials}", end="", flush=True)
        time.sleep(1.5)
    finally:
        stop.set()
        thread.join(timeout=2)
        device.disconnect()

    with lock:
        ts, data = np.concatenate(times), np.concatenate(chunks)
    config = AnalysisConfig(channel_indices=[c - 1 for c in channels], min_trials_per_condition=args.min_trials)
    result = analyze(ts, data, events, device.sampling_rate or 125, labels, config,
                     "simulation" if args.simulate else "hardware", finalized=True)
    counts = result["counts"]
    print(f"\n\nAccepted: {counts['accepted']['standard']} standard, {counts['accepted']['deviant']} deviant "
          f"(rejected {counts['rejected']})")
    if result["rejection_reasons"]:
        print("Rejection reasons: " + ", ".join(f"{k} {v}" for k, v in result["rejection_reasons"].items()))
    for m in result["metrics"]:
        if m["window_mean_uv"] is not None:
            ci = m["mean_ci95_half_width_uv"]
            print(f"  {m['electrode']:>4} {m['condition']:<10} 300-600 ms mean {m['window_mean_uv']:6.2f} µV"
                  + (f" ± {ci:.2f}" if ci is not None else ""))
    print(f"Quality: {result['quality'].replace('_', ' ')}")
    for w in result["warnings"]:
        print(f"  note: {w}")

    out = ROOT / "temp" / "quick_tests"
    out.mkdir(parents=True, exist_ok=True)
    stem = out / time.strftime("quick_oddball_%Y%m%d_%H%M%S")
    np.savez_compressed(stem.with_suffix(".npz"), timestamps=ts, samples=data)
    stem.with_suffix(".json").write_text(json.dumps({"events": events, "channels": channels, "analysis": result}, indent=1, default=float))
    print(f"\nSaved {stem.with_suffix('.npz').name} and .json in temp/quick_tests/")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", default="COM3")
    p.add_argument("--channels", default="1,2", help="Board channels with electrodes attached, e.g. 1,2,4")
    p.add_argument("--trials", type=int, default=40)
    p.add_argument("--interval", type=float, default=1.5)
    p.add_argument("--deviant-probability", type=float, default=0.2)
    p.add_argument("--settle", type=float, default=8.0)
    p.add_argument("--min-trials", type=int, default=5, help="Minimum accepted trials per condition to report window means")
    p.add_argument("--check-only", action="store_true", help="Only run the signal check")
    p.add_argument("--force", action="store_true", help="Run tones even if the signal check fails")
    p.add_argument("--simulate", action="store_true", help="Use synthetic EEG instead of the board")
    p.add_argument("--write-wav", nargs="?", const=str(ROOT / "tools" / "oddball_60s.wav"), metavar="PATH",
                   help="Write a background oddball WAV plus a .schedule.csv and exit")
    args = p.parse_args(argv)
    if args.write_wav:
        plan = write_background_wav(Path(args.write_wav), args.trials, args.interval, args.deviant_probability)
        print(f"Wrote {args.write_wav} ({len(plan)} tones, {plan.count('deviant')} deviants) and its schedule CSV.")
        return 0
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
