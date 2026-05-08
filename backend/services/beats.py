import json
import numpy as np
import soundfile as sf
import librosa


def detect_beats(audio_path: str) -> dict:
    """Return {"bpm": float, "beats_json": str} for a WAV file."""
    data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
    y = data.mean(axis=1)  # mono

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    bpm = float(np.atleast_1d(tempo)[0])
    beat_times: list[float] = librosa.frames_to_time(beat_frames, sr=sr).tolist()

    return {"bpm": bpm, "beats_json": json.dumps(beat_times)}
