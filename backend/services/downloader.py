import asyncio
import logging
from pathlib import Path
import yt_dlp

log = logging.getLogger(__name__)

# yt-dlp will try each browser in order and use the first one whose cookie
# store it can read. None at the end means "try without cookies" as a last
# resort (rarely works for YouTube anymore).
_BROWSERS = ["chrome", "edge", "firefox", "brave", "chromium", "opera", "vivaldi"]


def _build_opts(project_dir: Path, browser: str | None) -> dict:
    opts = {
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": str(project_dir / "video.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    if browser:
        opts["cookiesfrombrowser"] = (browser,)
    return opts


def _attempt_download(url: str, project_dir: Path) -> dict:
    """Try each browser cookie store in sequence; fall back to no cookies."""
    browsers_to_try: list[str | None] = list(_BROWSERS) + [None]
    last_exc: Exception | None = None

    for browser in browsers_to_try:
        try:
            opts = _build_opts(project_dir, browser)
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            if browser:
                log.info("Downloaded using %s cookies", browser)
            else:
                log.warning("Downloaded without browser cookies (may be rate-limited)")
            return info
        except Exception as exc:
            msg = str(exc).lower()
            # Browser not installed or profile unreadable — try next
            if any(k in msg for k in ("browser", "could not find", "no module")):
                log.debug("Browser %s unavailable: %s", browser, exc)
                last_exc = exc
                continue
            # YouTube bot-check — current browser cookies didn't work, try next
            if "sign in" in msg or "confirm" in msg or "bot" in msg:
                log.debug("Browser %s cookies rejected by YouTube, trying next", browser)
                last_exc = exc
                continue
            # Anything else (bad URL, private video, etc.) — fail immediately
            raise

    raise RuntimeError(
        "YouTube rejected the download. Log into YouTube in Chrome or Edge and retry."
    ) from last_exc


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
