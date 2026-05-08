import asyncio
import logging
from pathlib import Path
import yt_dlp

log = logging.getLogger(__name__)

# Drop a cookies.txt file here (exported from your browser) to use it instead
# of browser auto-detection. See the README for instructions.
COOKIES_FILE = Path(__file__).parent.parent / "cookies.txt"

# Browsers tried in order when no cookies.txt is present and
# ALLOW_BROWSER_COOKIES=true is set in the environment.
_BROWSERS = ["firefox", "chrome", "edge", "brave", "chromium", "safari", "opera", "vivaldi"]

_BROWSER_ERR_HINTS = (
    "browser", "cookie", "could not find", "could not copy",
    "no module", "profile", "keychain", "decrypting",
)


def _base_opts(project_dir: Path) -> dict:
    return {
        # Let yt-dlp pick the best streams; FFmpeg merges into mp4
        "format": "bestvideo+bestaudio/best",
        "merge_output_format": "mp4",
        "outtmpl": str(project_dir / "video.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        # yt-dlp defaults to Deno for JS challenge solving; override to
        # use Node/quickjs/bun instead (Deno is rarely installed).
        "js_runtimes": {"node": {}, "quickjs": {}, "bun": {}},
        # Allow yt-dlp to fetch the EJS solver script from GitHub on first
        # run; it is cached locally afterwards.
        "remote_components": ["ejs:github"],
    }


def _attempt_download(url: str, project_dir: Path) -> dict:
    # ── 1. Explicit cookies.txt — always preferred, no implicit access ──
    if COOKIES_FILE.exists():
        log.info("Using cookies.txt for authentication")
        opts = {**_base_opts(project_dir), "cookiefile": str(COOKIES_FILE)}
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)

    # ── 2. Browser auto-detect — opt-in via env var ────────────────────
    import os
    allow_browser = os.getenv("ALLOW_BROWSER_COOKIES", "false").lower() == "true"

    if allow_browser:
        last_exc: Exception | None = None
        for browser in _BROWSERS:
            try:
                opts = {**_base_opts(project_dir), "cookiesfrombrowser": (browser,)}
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                log.info("Downloaded using %s cookies", browser)
                return info
            except Exception as exc:
                msg = str(exc).lower()
                if any(k in msg for k in _BROWSER_ERR_HINTS):
                    log.debug("Browser %s unavailable, trying next", browser)
                    last_exc = exc
                    continue
                if "sign in" in msg or "confirm" in msg or "bot" in msg:
                    log.debug("Browser %s cookies rejected, trying next", browser)
                    last_exc = exc
                    continue
                raise
        if last_exc:
            raise RuntimeError(
                "All browsers failed. Export a cookies.txt and place it in backend/."
            ) from last_exc

    # ── 3. No cookies — try anyway, fail with a clear message ──────────
    try:
        opts = _base_opts(project_dir)
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)
    except Exception as exc:
        if "sign in" in str(exc).lower() or "bot" in str(exc).lower():
            raise RuntimeError(
                "YouTube requires authentication. "
                "Export cookies.txt from your browser and place it in backend/. "
                "See README for instructions."
            ) from exc
        raise


async def download(url: str, project_id: str) -> tuple[str, dict]:
    project_dir = Path(f"data/projects/{project_id}")
    project_dir.mkdir(parents=True, exist_ok=True)

    loop = asyncio.get_event_loop()
    info = await loop.run_in_executor(None, _attempt_download, url, project_dir)

    video_file = next(
        (str(f) for f in project_dir.iterdir() if f.stem == "video"),
        None,
    )
    if not video_file:
        raise RuntimeError("Download failed: no video file found after extraction")

    return video_file, {
        "title": info.get("title", ""),
        "thumbnail": info.get("thumbnail", ""),
        "duration": info.get("duration", 0),
    }
