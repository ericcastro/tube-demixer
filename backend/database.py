from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = "sqlite:///./tube_demixer.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def create_tables():
    from models.project import Project  # noqa: F401
    from models.stem import Stem        # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate()


def _migrate():
    """Add columns introduced after initial schema creation."""
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE projects ADD COLUMN model_id  VARCHAR NOT NULL DEFAULT 'htdemucs'",
            "ALTER TABLE projects ADD COLUMN bpm        REAL",
            "ALTER TABLE projects ADD COLUMN beats_json TEXT",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
