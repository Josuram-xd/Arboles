import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import crear_app  # noqa: E402


def E(id, titulo=None, final=None, opciones=()):
    return {
        "id": id,
        "titulo": titulo or id.upper(),
        "texto": f"texto de {id}",
        "final": final,
        "opciones": [{"texto": f"ir a {d}", "destino": d} for d in opciones],
    }


# inicio -> a -> v (victoria, 2 pasos); inicio -> b -> c -> w (victoria, 3 pasos)
# c -> inicio es un ciclo. d no es alcanzable y tiene un destino roto. e es un callejon sin salida.
ESCENAS = [
    E("inicio", opciones=["a", "b"]),
    E("a", opciones=["v"]),
    E("b", opciones=["c"]),
    E("c", opciones=["w", "inicio"]),
    E("v", final="victoria"),
    E("w", final="victoria"),
    E("d", opciones=["nope"]),
    E("e"),
]


def cliente(tmp_path, escenas=ESCENAS):
    ruta = tmp_path / "data.json"
    ruta.write_text(json.dumps(escenas), encoding="utf-8")
    return TestClient(crear_app(ruta))


def test_listar_y_obtener(tmp_path):
    c = cliente(tmp_path)
    assert len(c.get("/api/escenas").json()) == len(ESCENAS)
    assert c.get("/api/escenas/a").json()["id"] == "a"
    assert c.get("/api/escenas/zzz").status_code == 404


def test_crear(tmp_path):
    c = cliente(tmp_path)
    nueva = E("nueva", opciones=["inicio"])
    assert c.post("/api/escenas", json=nueva).status_code == 201
    assert c.get("/api/escenas/nueva").json()["texto"] == "texto de nueva"
    assert c.post("/api/escenas", json=nueva).status_code == 409
    assert c.post("/api/escenas", json={"id": "x"}).status_code == 422
    assert c.post("/api/escenas", json={**nueva, "final": "otro"}).status_code == 422


def test_actualizar(tmp_path):
    c = cliente(tmp_path)
    cambiada = E("a", titulo="Nuevo titulo", opciones=["v", "w"])
    r = c.put("/api/escenas/a", json=cambiada)
    assert r.status_code == 200
    assert c.get("/api/escenas/a").json()["titulo"] == "Nuevo titulo"
    assert c.put("/api/escenas/zzz", json=E("zzz")).status_code == 404
    assert c.put("/api/escenas/a", json=E("otra")).status_code == 422


def test_eliminar(tmp_path):
    c = cliente(tmp_path)
    assert c.delete("/api/escenas/e").status_code == 204
    assert c.get("/api/escenas/e").status_code == 404
    assert c.delete("/api/escenas/v").status_code == 409  # a apunta a v
    assert c.delete("/api/escenas/inicio").status_code == 409
    assert c.delete("/api/escenas/zzz").status_code == 404


def test_arbol_corta_ciclos(tmp_path):
    raiz = cliente(tmp_path).get("/api/arbol").json()
    assert raiz["id"] == "inicio" and raiz["nombre"] == "INICIO"
    hijos = {h["id"]: h for h in raiz["hijos"]}
    assert set(hijos) == {"a", "b"}
    c_nodo = hijos["b"]["hijos"][0]
    assert c_nodo["id"] == "c"
    # El ciclo c -> inicio no se repite como hijo infinito.
    assert all(h["id"] != "inicio" for h in c_nodo["hijos"])
    assert [h["id"] for h in hijos["a"]["hijos"]] == ["v"]
    assert hijos["a"]["hijos"][0]["final"] == "victoria"


def test_ruta_optima(tmp_path):
    r = cliente(tmp_path).get("/api/ruta-optima")
    assert r.status_code == 200
    assert r.json() == {"ruta": ["inicio", "a", "v"], "pasos": 2}


def test_ruta_optima_sin_victoria(tmp_path):
    sin_victoria = [E("inicio", opciones=["a"]), E("a")]
    assert cliente(tmp_path, sin_victoria).get("/api/ruta-optima").status_code == 404


def test_validar(tmp_path):
    r = cliente(tmp_path).get("/api/validar").json()
    assert r == {
        "inalcanzables": ["d", "e"],
        "sin_salida": ["e"],
        "destinos_rotos": ["d"],
    }


def test_frontend_en_raiz(tmp_path):
    assert cliente(tmp_path).get("/").status_code == 200
