import asyncio
import logging

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session
from typing import List

from database import get_db, SessionLocal

log = logging.getLogger(__name__)

from models.project import Project
from models.stem import Stem
from schemas import ProjectCreate, ProjectResponse
from services import downloader, extractor
from services.beats import BEAT_MODELS, detect_beats
from services.separator import MODELS, separate

router = APIRouter()


@router.get("/models")
def list_models():
    return {
        mid: {
            "label": cfg["label"],
            "description": cfg["description"],
            "stems": cfg["stems"],
        }
        for mid, cfg in MODELS.items()
    }


@router.get("/beat-models")
def list_beat_models():
    return {
        mid: {"label": cfg["label"], "description": cfg["description"]}
        for mid, cfg in BEAT_MODELS.items()
    }


@router.get("", response_model=List[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()


@router.post("", response_model=ProjectResponse)
def create_project(req: ProjectCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if req.model_id not in MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model_id!r}")
    if req.beat_model_id not in BEAT_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown beat model: {req.beat_model_id!r}")

    project = Project(
        youtube_url=req.youtube_url,
        name=req.name or "New Project",
        model_id=req.model_id,
        beat_model_id=req.beat_model_id,
        status="created",
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    background_tasks.add_task(_process_project, project.id)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"ok": True}


async def _process_project(project_id: str):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return

        # ── Download ──────────────────────────────────────────────
        project.status = "downloading"
        db.commit()

        video_path, metadata = await downloader.download(project.youtube_url, project_id)
        project.video_path = video_path
        project.video_title = metadata.get("title", "")
        project.video_thumbnail = metadata.get("thumbnail", "")
        project.duration = str(metadata.get("duration", ""))
        if not project.name or project.name == "New Project":
            project.name = metadata.get("title", "New Project")
        db.commit()

        # ── Extract audio ─────────────────────────────────────────
        project.status = "extracting"
        db.commit()

        audio_path = await extractor.extract_audio(video_path, project_id)
        project.audio_path = audio_path
        db.commit()

        # ── Separate stems ────────────────────────────────────────
        project.status = "separating"
        db.commit()

        stem_results = await separate(audio_path, project_id, project.model_id)

        for s in stem_results:
            db.add(Stem(
                project_id=project_id,
                stem_name=s["stem_name"],
                file_path=s["file_path"],
            ))

        # ── Detect beats ──────────────────────────────────────────────
        beat_data = await asyncio.get_event_loop().run_in_executor(
            None, detect_beats, audio_path, project.beat_model_id
        )
        project.bpm = beat_data["bpm"]
        project.beats_json = beat_data["beats_json"]

        project.status = "ready"
        db.commit()

    except Exception as e:
        log.exception("Pipeline failed for project %s", project_id)
        project = db.query(Project).filter(Project.id == project_id).first()
        if project:
            project.status = "error"
            project.error_message = str(e)
            db.commit()
    finally:
        db.close()
