"""FastAPI application: REST API plus the static frontend."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import create_router, install_error_handlers
from app.repository import SceneRepository

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data.json"
FRONTEND = ROOT.parent.parent / "frontend"


def create_app(data_path: Path = DATA_PATH) -> FastAPI:
    app = FastAPI(title="Zombie survival adventure")
    install_error_handlers(app)
    app.include_router(create_router(SceneRepository(data_path)))
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
    return app


app = create_app()
