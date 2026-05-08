import json
from pathlib import Path as FilePath
from pydantic import BaseModel, ConfigDict, computed_field
from datetime import datetime
from typing import Optional, List


class StemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    stem_name: str
    file_path: str

    @computed_field
    @property
    def url(self) -> str:
        """Convert local file path to a /media/… URL the browser can fetch."""
        parts = FilePath(self.file_path.replace("\\", "/")).parts
        try:
            idx = list(parts).index("projects")
            return "/media/" + "/".join(parts[idx + 1:])
        except ValueError:
            return "/media/" + self.file_path.replace("\\", "/")


class ProjectCreate(BaseModel):
    youtube_url: str
    name: str = ""
    model_id: str = "htdemucs"


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    youtube_url: str
    model_id: str
    status: str
    error_message: Optional[str] = None
    video_path: Optional[str] = None
    audio_path: Optional[str] = None
    video_title: Optional[str] = None
    video_thumbnail: Optional[str] = None
    duration: Optional[str] = None
    stems:      List[StemResponse] = []
    bpm:        Optional[float] = None
    beats_json: Optional[str]   = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @computed_field
    @property
    def beats(self) -> List[float]:
        if self.beats_json:
            return json.loads(self.beats_json)
        return []
