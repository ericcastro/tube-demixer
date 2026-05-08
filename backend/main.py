from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import create_tables
from routers.projects import router as projects_router

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
DATA_DIR = Path(__file__).parent / "data" / "projects"


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Tube DeMixer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router, prefix="/api/projects", tags=["projects"])

# Serve project media files (video/audio/stems)
app.mount("/media", StaticFiles(directory=str(DATA_DIR)), name="media")

# Serve frontend last so API routes take precedence
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
