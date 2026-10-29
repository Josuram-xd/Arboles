"""Aplicacion FastAPI: API REST y frontend estatico."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import crear_router, instalar_manejadores
from app.repository import RepositorioEscenas

RAIZ = Path(__file__).resolve().parent
RUTA_DATOS = RAIZ / "data.json"
FRONTEND = RAIZ.parent.parent / "frontend"


def crear_app(ruta_json: Path = RUTA_DATOS) -> FastAPI:
    app = FastAPI(title="Aventura de supervivencia")
    instalar_manejadores(app)
    app.include_router(crear_router(RepositorioEscenas(ruta_json)))
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
    return app


app = crear_app()
