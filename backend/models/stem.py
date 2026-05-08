import uuid
from sqlalchemy import Column, String, ForeignKey
from database import Base


class Stem(Base):
    __tablename__ = "stems"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    stem_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
