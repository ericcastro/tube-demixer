import asyncio
from pathlib import Path
import yt_dlp


async def download(url: str, project_id: str) -> tuple[str, dict]:
    project_dir = Path(f"data/projects/{project_id}")
    project_dir.mkdir(parents=True, exist_ok=True)

    ydl_opts = {
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": str(project_dir / "video.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }

    loop = asyncio.get_event_loop()

    def _download():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            return ydl.extract_info(url, download=True)

    info = await loop.run_in_executor(None, _download)

    video_file = next(
        (str(f) for f in project_dir.iterdir() if f.stem == "video"),
        None,
    )
    if not video_file:
        raise RuntimeError("Download failed: no video file found")

    metadata = {
        "title": info.get("title", ""),
        "thumbnail": info.get("thumbnail", ""),
        "duration": info.get("duration", 0),
    }
    return video_file, metadata
