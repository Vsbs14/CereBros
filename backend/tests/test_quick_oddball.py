import wave

from tools.quick_oddball import make_plan, write_background_wav


def test_plan_has_requested_deviants_never_first_or_consecutive():
    for seed in range(20):
        plan = make_plan(40, 0.2, seed)
        assert plan.count("deviant") == 8 and plan[0] == "standard"
        assert not any(a == b == "deviant" for a, b in zip(plan, plan[1:]))


def test_background_wav_and_schedule_match(tmp_path):
    path = tmp_path / "test.wav"
    plan = write_background_wav(path, trials=10, interval_s=1.5, deviant_probability=0.2)
    with wave.open(str(path)) as w:
        assert w.getframerate() == 44100 and abs(w.getnframes() / 44100 - (3 + 15 + 1)) < 0.01
    rows = path.with_suffix(".schedule.csv").read_text().strip().splitlines()[1:]
    assert [r.split(",")[2] for r in rows] == plan
