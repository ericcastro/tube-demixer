@echo off
setlocal

where uv >nul 2>&1 || (
    echo ERROR: 'uv' not found on PATH. See CLAUDE.md for prerequisites.
    exit /b 1
)

where ffmpeg >nul 2>&1 || (
    echo ERROR: 'ffmpeg' not found on PATH. See CLAUDE.md for prerequisites.
    exit /b 1
)

cd /d "%~dp0backend"
uv run uvicorn main:app --reload --port 8001
