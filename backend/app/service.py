"""Optimizacion y validacion de la aventura, sobre RepositorioEscenas."""
from collections import deque

from app.repository import RepositorioEscenas


class ServicioAventura:
    def __init__(self, repo: RepositorioEscenas):
        self.repo = repo

    def _mapa(self) -> dict:
        return {e.id: e for e in self.repo.listar()}

    @staticmethod
    def _bfs(escenas: dict) -> dict:
        """Devuelve {id: padre} de lo alcanzable desde 'inicio', en orden de distancia (BFS)."""
        prev = {}
        if "inicio" not in escenas:
            return prev
        prev["inicio"] = None
        cola = deque(["inicio"])
        while cola:
            actual = cola.popleft()
            for op in escenas[actual].opciones:
                if op.destino in escenas and op.destino not in prev:
                    prev[op.destino] = actual
                    cola.append(op.destino)
        return prev

    def ruta_optima(self):
        """Ruta mas corta de 'inicio' a una victoria, o None si no hay ninguna."""
        escenas = self._mapa()
        prev = self._bfs(escenas)
        # El dict conserva el orden de descubrimiento BFS: la primera victoria es la mas cercana.
        for id_ in prev:
            if escenas[id_].final == "victoria":
                ruta = []
                nodo = id_
                while nodo is not None:
                    ruta.append(nodo)
                    nodo = prev[nodo]
                ruta.reverse()
                return {"ruta": ruta, "pasos": len(ruta) - 1}
        return None

    def validar(self) -> dict:
        escenas = self._mapa()
        alcanzables = self._bfs(escenas)
        return {
            "inalcanzables": [i for i in escenas if i not in alcanzables],
            "sin_salida": [e.id for e in escenas.values() if e.final is None and not e.opciones],
            "destinos_rotos": [
                e.id for e in escenas.values() if any(o.destino not in escenas for o in e.opciones)
            ],
        }

    def arbol_dict(self) -> dict:
        escenas = self._mapa()

        def convertir(nodo):
            return {
                "nombre": escenas[nodo.name].titulo,
                "id": nodo.name,
                "final": nodo.final,
                "hijos": [convertir(h) for h in nodo.children],
            }

        return convertir(self.repo.construir_arbol())
