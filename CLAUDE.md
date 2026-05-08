# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## What this project is

**Tube DeMixer** — a locally-run web app that takes a YouTube URL, downloads the video, extracts audio, and uses a deep-learning model to isolate individual audio stems (vocals, drums, bass, guitar, etc.). The final goal is a browser-based mixing interface where each stem can be independently muted, volume-adjusted, and speed-changed in perfect sync.

## Running the app

**Prerequisites (install once):**
- Python 3.11+
- [FFmpeg](https://ffmpeg.org/download.html) on `PATH`
- NVIDIA GPU driver + CUDA (for stem separation — not yet wired up)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

Then open `http://localhost:8000`.

## Architecture

```
tube-demixer/
├── backend/          Python / FastAPI
│   ├── main.py       App entry point; mounts API + static file routes
│   ├── database.py   SQLAlchemy engine + session factory (SQLite)
│   ├── schemas.py    Pydantic request/response models
│   ├── models/       SQLAlchemy ORM models
│   │   └── project.py
│   ├── routers/
│   │   └── projects.py   CRUD + background processing pipeline
│   └── services/
│       ├── downloader.py  yt-dlp wrapper (async via run_in_executor)
│       └── extractor.py   FFmpeg audio extraction (WAV 44.1 kHz stereo)
├── frontend/         Vanilla HTML/CSS/JS — no build step, ES modules
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── app.js    UI logic, polling, event handling
│       └── api.js    Thin fetch wrapper for the REST API
└── data/projects/    Runtime data (gitignored)
    └── {project_id}/
        ├── video.*   Downloaded video
        ├── audio.wav Extracted audio (44.1 kHz / 16-bit PCM)
        └── stems/    AI-separated stem files (next phase)
```

### Request/processing flow

1. `POST /api/projects` — creates a DB record, returns immediately, kicks off a `BackgroundTask`
2. Background task (`_process_project`) transitions the project through statuses: `created → downloading → extracting → ready` (or `error`)
3. Frontend polls `GET /api/projects/{id}` every 2 s while any project is in an active status; stops when all reach a terminal state (`ready` / `error`)
4. Media files are served from `/media/{project_id}/…` via a dedicated `StaticFiles` mount

### Key design decisions

- **All blocking I/O** (yt-dlp, FFmpeg) runs in `asyncio.run_in_executor` so it doesn't block the event loop
- **SQLite** is sufficient for a local single-user app; no migration tooling yet
- **Frontend uses `type="module"`** so `await` at the top level works in `app.js` without a bundler
- **Static files order matters** in `main.py`: API router → `/media` mount → `/` (frontend) — FastAPI routes take precedence over the catch-all static mount

## Adding stem separation (next phase)

Add to `requirements.txt`:
```
torch  # install with CUDA: pip install torch --index-url https://download.pytorch.org/whl/cu124
torchaudio
demucs
```

Add `backend/services/separator.py` and call it after `extractor.py` in the pipeline. Demucs model `htdemucs_6s` gives 6 stems (vocals, drums, bass, guitar, piano, other) and runs on CUDA automatically when a GPU is available.

## Project status model

| Status       | Meaning                          |
|--------------|----------------------------------|
| `created`    | Record saved, task queued        |
| `downloading`| yt-dlp fetching video            |
| `extracting` | FFmpeg pulling WAV from video    |
| `separating` | AI model running (future)        |
| `ready`      | All files available              |
| `error`      | Pipeline failed; see `error_message` |
