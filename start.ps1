#Requires -Version 5
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Check-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Error "ERROR: '$name' not found on PATH. See CLAUDE.md for prerequisites."
        exit 1
    }
}

Check-Command uv
Check-Command ffmpeg

$backendDir = Join-Path $PSScriptRoot "backend"
Set-Location $backendDir

uv run uvicorn main:app --reload --port 8001
