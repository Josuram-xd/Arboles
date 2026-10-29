"""Repositorio JSON de escenas: CRUD persistente y arbol anytree desde 'inicio'."""

import json
import os
from pathlib import Path

from anytree import Node

from .models import Escena

RAIZ = "inicio"


class ErrorRepositorio(Exception):
    """Base de los errores del repositorio."""


class NoEncontrada(ErrorRepositorio):
    pass


class YaExiste(ErrorRepositorio):
    pass


class EnUso(ErrorRepositorio):
    """La escena no puede borrarse: es 'inicio' o otra escena apunta a ella."""


class IdInmutable(ErrorRepositorio):
    """actualizar() no renombra escenas: romperia los destinos que apuntan a ella."""


class RepositorioEscenas:
    def __init__(self, ruta_json: str | Path) -> None:
        self._ruta = Path(ruta_json)

    def listar(self) -> list[Escena]:
        if not self._ruta.exists():
            return []
        datos = json.loads(self._ruta.read_text(encoding="utf-8"))
        return [Escena.model_validate(d) for d in datos]

    def obtener(self, escena_id: str) -> Escena:
        return self.listar()[self._indice(self.listar(), escena_id)]

    def crear(self, escena: Escena) -> Escena:
        escenas = self.listar()
        if any(e.id == escena.id for e in escenas):
            raise YaExiste(escena.id)
        escenas.append(escena)
        self._guardar(escenas)
        return escena

    def actualizar(self, escena_id: str, escena: Escena) -> Escena:
        escenas = self.listar()
        indice = self._indice(escenas, escena_id)
        if escena.id != escena_id:
            raise IdInmutable(escena_id)
        escenas[indice] = escena
        self._guardar(escenas)
        return escena

    def eliminar(self, escena_id: str) -> None:
        escenas = self.listar()
        self._indice(escenas, escena_id)
        apuntada = any(
            o.destino == escena_id for e in escenas if e.id != escena_id for o in e.opciones
        )
        if escena_id == RAIZ or apuntada:
            raise EnUso(escena_id)
        self._guardar([e for e in escenas if e.id != escena_id])

    def construir_arbol(self) -> Node:
        mapa = {e.id: e for e in self.listar()}
        if RAIZ not in mapa:
            raise NoEncontrada(RAIZ)
        return self._nodo(mapa, mapa[RAIZ], frozenset())

    def _nodo(
        self,
        mapa: dict[str, Escena],
        escena: Escena,
        ancestros: frozenset[str],
        padre: Node | None = None,
        opcion: str | None = None,
    ) -> Node:
        nodo = Node(
            escena.titulo, parent=padre, id=escena.id, final=escena.final, opcion=opcion
        )
        # Cortar ciclos: un destino ya presente en la rama no se vuelve a expandir.
        rama = ancestros | {escena.id}
        for op in escena.opciones:
            if op.destino in mapa and op.destino not in rama:
                self._nodo(mapa, mapa[op.destino], rama, nodo, op.texto)
        return nodo

    @staticmethod
    def _indice(escenas: list[Escena], escena_id: str) -> int:
        for i, e in enumerate(escenas):
            if e.id == escena_id:
                return i
        raise NoEncontrada(escena_id)

    def _guardar(self, escenas: list[Escena]) -> None:
        datos = [e.model_dump() for e in escenas]
        temporal = self._ruta.with_name(self._ruta.name + ".tmp")
        temporal.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporal, self._ruta)  # reemplazo atomico: no deja el JSON a medias
