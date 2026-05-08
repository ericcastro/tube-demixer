# Tube DeMixer

Drop a YouTube link, get back isolated audio stems. A local web app that downloads a video, runs AI source separation, and gives you a browser-based mixer to play back each stem independently — with per-stem volume, mute, solo, and speed controls, all in sync.

---

## What it does

1. Paste a YouTube URL → the app downloads the video and extracts audio
2. An AI model separates the audio into stems (vocals, drums, bass, guitar, piano, other)
3. Open the mixer: every stem has its own waveform, playback controls, and volume fader
4. All stems play in perfect sync via the Web Audio API

---

## Requirements

- Python 3.11+
- [FFmpeg](https://ffmpeg.org/download.html) — must be on `PATH`
- NVIDIA GPU strongly recommended; CPU fallback works but separation is slow

---

## Installation

Requires [uv](https://docs.astral.sh/uv/getting-started/installation/).

```bash
cd backend
uv sync
```

This installs everything including PyTorch nightly with CUDA 12.8 (works on RTX 20xx through 50xx / Blackwell). To use a different PyTorch build, edit the `[[tool.uv.index]]` URL in `backend/pyproject.toml` before running `uv sync`:

```
# Stable CUDA 12.4:
url = "https://download.pytorch.org/whl/cu124"

# CPU only:
# remove the [tool.uv.sources] and [[tool.uv.index]] blocks entirely
```

---

## Running

```bash
cd backend
uv run uvicorn main:app --reload --port 8001
```

Open **http://localhost:8001**

Project data (downloaded video, audio, stems) is stored in `backend/data/projects/` and is gitignored.

---

## Separation models

| Model | Stems | Speed | Notes |
|---|---|---|---|
| HTDemucs | 4 | fast | vocals / drums / bass / other |
| HTDemucs 6-stem | 6 | moderate | + guitar, piano |
| HTDemucs Fine-tuned | 4 | slow | best quality of the Demucs family |
| BS-RoFormer | 2 | moderate | state-of-the-art vocal isolation |
| MDX23C | 4 | moderate | competition model, different character |

Models are downloaded automatically on first use. Demucs weights come from Meta's CDN; BS-RoFormer and MDX23C via `audio-separator`.

---

## Tech

- **Backend:** Python, FastAPI, SQLite, yt-dlp, FFmpeg, Demucs, audio-separator
- **Frontend:** Vanilla HTML/CSS/JS — no build step, ES modules, Web Audio API
- **Font:** JetBrains Mono
