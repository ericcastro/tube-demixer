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

---

## YouTube authentication

YouTube requires authentication for downloads. The recommended approach is a `cookies.txt` file:

1. Install the [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/) extension (Firefox) or [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) (Chrome)
2. Log into YouTube in your browser
3. Export cookies for `youtube.com`
4. Save the file as `backend/cookies.txt`

The file is gitignored and never leaves your machine.

**Alternative — browser auto-detection (opt-in):**

If you'd rather not export a file, the app can read cookies directly from your browser's local cookie store. This is disabled by default:

```bash
ALLOW_BROWSER_COOKIES=true uv run uvicorn main:app --reload --port 8001
```

The cookies are read locally and only sent to YouTube — the app never stores or logs them.

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
