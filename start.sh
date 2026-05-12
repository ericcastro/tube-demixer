#!/usr/bin/env bash
set -euo pipefail

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: '$1' not found on PATH. See CLAUDE.md for prerequisites." >&2
    exit 1
  fi
}

check_cmd uv
check_cmd ffmpeg

cd "$(dirname "$0")/backend"
exec uv run uvicorn main:app --reload --port 8001
