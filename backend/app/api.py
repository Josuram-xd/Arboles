"""Endpoints REST bajo /api (contrato en CONTRATO.md)."""
from fastapi import APIRouter, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse

from app.models import Escena
from app.repository import EnUso, NoEncontrada, RepositorioEscenas, YaExiste
from app.service import ServicioAventura


def crear_router(repo: RepositorioEscenas) -> APIRouter:
    router = APIRouter(prefix="/api")
    servicio = ServicioAventura(repo)

    @router.get("/escenas", response_model=list[Escena])
    def listar():
        return repo.listar()

    @router.get("/escenas/{id}", response_model=Escena)
    def obtener(id: str):
        return repo.obtener(id)

    @router.post("/escenas", response_model=Escena, status_code=201)
    def crear(escena: Escena):
        repo.crear(escena)
        return escena

    @router.put("/escenas/{id}", response_model=Escena)
    def actualizar(id: str, escena: Escena):
        if escena.id != id:
            raise HTTPException(422, "El id del cuerpo no coincide con el de la URL")
        repo.actualizar(id, escena)
        return escena

    @router.delete("/escenas/{id}", status_code=204)
    def eliminar(id: str):
        repo.eliminar(id)
        return Response(status_code=204)

    @router.get("/arbol")
    def arbol():
        return servicio.arbol_dict()

    @router.get("/ruta-optima")
    def ruta_optima():
        ruta = servicio.ruta_optima()
        if ruta is None:
            raise HTTPException(404, "No hay ninguna victoria alcanzable desde 'inicio'")
        return ruta

    @router.get("/validar")
    def validar():
        return servicio.validar()

    return router


def instalar_manejadores(app: FastAPI) -> None:
    """Mapea las excepciones del repositorio a codigos HTTP."""

    def respuesta(codigo: int):
        def manejador(request, exc):
            return JSONResponse({"detail": str(exc)}, status_code=codigo)

        return manejador

    app.add_exception_handler(NoEncontrada, respuesta(404))
    app.add_exception_handler(YaExiste, respuesta(409))
    app.add_exception_handler(EnUso, respuesta(409))
