"""REST endpoints under /api (see CONTRACT.md)."""
from fastapi import APIRouter, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse

from app.models import Scene
from app.repository import AlreadyExists, ImmutableId, InUse, NotFound, SceneRepository
from app.service import AdventureService


def create_router(repo: SceneRepository) -> APIRouter:
    router = APIRouter(prefix="/api")
    service = AdventureService(repo)

    @router.get("/scenes", response_model=list[Scene])
    def list_scenes():
        return repo.list_all()

    @router.get("/scenes/{id}", response_model=Scene)
    def get_scene(id: str):
        return repo.get(id)

    @router.post("/scenes", response_model=Scene, status_code=201)
    def create_scene(scene: Scene):
        repo.create(scene)
        return scene

    @router.put("/scenes/{id}", response_model=Scene)
    def update_scene(id: str, scene: Scene):
        if scene.id != id:
            raise HTTPException(422, "El id de la escena no coincide con el de la URL")
        repo.update(id, scene)
        return scene

    @router.delete("/scenes/{id}", status_code=204)
    def delete_scene(id: str):
        repo.delete(id)
        return Response(status_code=204)

    @router.get("/tree")
    def tree():
        return service.tree_dict()

    @router.get("/optimal-path")
    def optimal_path():
        # Contract: no reachable victory is a valid answer, not an error.
        return service.optimal_path() or {"path": None, "steps": None}

    @router.get("/escape-paths")
    def escape_paths():
        return service.escape_paths()

    @router.get("/stats")
    def stats():
        return service.stats()

    @router.get("/validate")
    def validate():
        return service.validate()

    return router


def install_error_handlers(app: FastAPI) -> None:
    """Map repository exceptions to HTTP status codes, with user-facing messages in Spanish."""

    def respond(status_code: int, message: str):
        def handler(request, exc):
            return JSONResponse({"detail": message}, status_code=status_code)

        return handler

    app.add_exception_handler(NotFound, respond(404, "La escena no existe"))
    app.add_exception_handler(AlreadyExists, respond(409, "Ya existe una escena con ese id"))
    app.add_exception_handler(
        InUse, respond(409, "No se puede eliminar: otra escena apunta a ella o es el inicio")
    )
    app.add_exception_handler(ImmutableId, respond(422, "No se puede cambiar el id de una escena"))
