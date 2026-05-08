import uuid
from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    youtube_url = Column(String, nullable=False)
    model_id = Column(String, nullable=False, default="htdemucs", server_default="htdemucs")
    # created | downloading | extracting | separating | ready | error
    status = Column(String, default="created")
    error_message = Column(Text, nullable=True)
    video_path = Column(String, nullable=True)
    audio_path = Column(String, nullable=True)
    video_title = Column(String, nullable=True)
    video_thumbnail = Column(String, nullable=True)
    duration = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    stems = relationship("Stem", cascade="all, delete-orphan", lazy="selectin")
