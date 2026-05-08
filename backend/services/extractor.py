import asyncio
from pathlib import Path
import ffmpeg


async def extract_audio(video_path: str, project_id: str) -> str:
    project_dir = Path(f"data/projects/{project_id}")
    audio_path = str(project_dir / "audio.wav")

    loop = asyncio.get_event_loop()

    def _extract():
        (
            ffmpeg
            .input(video_path)
            .output(audio_path, acodec="pcm_s16le", ar=44100, ac=2)
            .overwrite_output()
            .run(quiet=True)
        )

    await loop.run_in_executor(None, _extract)
    return audio_path
