import json
import logging

import numpy as np
import soundfile as sf

log = logging.getLogger(__name__)

BEAT_MODELS = {
    "beat_this": {
        "label": "beat-this (GPU)",
        "description": "Transformer beat tracker (2024) — state-of-the-art accuracy, GPU-accelerated",
        "requires_gpu": False,
    },
    "librosa": {
        "label": "librosa",
        "description": "Classic onset-envelope tracker — CPU only, no extra deps",
        "requires_gpu": False,
    },
}


def detect_beats(audio_path: str, model_id: str = "librosa") -> dict:
    fn = {"librosa": _detect_librosa, "beat_this": _detect_beat_this}[model_id]
    return fn(audio_path)


def _detect_librosa(audio_path: str) -> dict:
    import librosa
    data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
    y = data.mean(axis=1)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    bpm = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    return {"bpm": round(bpm, 2), "beats_json": json.dumps(beat_times)}


def _detect_beat_this(audio_path: str) -> dict:
    import torch
    from beat_this.inference import File2Beats

    device = "cuda" if torch.cuda.is_available() else "cpu"
    log.info("beat-this using device: %s", device)
    predictor = File2Beats(checkpoint_path="final0", device=device, dbn=False)
    beats, _ = predictor(audio_path)
    beat_times = sorted(float(b) for b in beats)
    bpm = float(60.0 / np.median(np.diff(beat_times))) if len(beat_times) > 1 else 120.0
    return {"bpm": round(bpm, 2), "beats_json": json.dumps(beat_times)}
