"""Tests de modelos y repositorio sobre una copia temporal de data.json."""

import shutil
from pathlib import Path

import pytest
from anytree import PreOrderIter
from pydantic import ValidationError

from app.models import Escena, Opcion
from app.repository import EnUso, IdInmutable, NoEncontrada, RepositorioEscenas, YaExiste

RUTA_ORIGINAL = Path(__file__).resolve().parents[1] / "app" / "data.json"


@pytest.fixture
def repo(tmp_path):
    copia = tmp_path / "data.json"
    shutil.copy(RUTA_ORIGINAL, copia)
    return RepositorioEscenas(copia)


def escena(id_, opciones=(), final=None):
    return Escena(id=id_, titulo=f"Titulo {id_}", texto="Texto", final=final, opciones=list(opciones))


def opcion(destino):
    return Opcion(texto=f"ir a {destino}", destino=destino)


# --- modelos ---

def test_escena_no_final_con_opciones_es_valida():
    assert escena("a", [opcion("b")]).final is None


def test_escena_final_sin_opciones_es_valida():
    assert escena("a", final="muerte").opciones == []


def test_escena_final_con_opciones_falla():
    with pytest.raises(ValidationError):
        escena("a", [opcion("b")], final="victoria")


def test_escena_no_final_sin_opciones_falla():
    with pytest.raises(ValidationError):
        escena("a")


def test_final_fuera_de_valores_permitidos_falla():
    with pytest.raises(ValidationError):
        escena("a", final="empate")


# --- datos reales ---

def test_data_json_es_valida_y_completa():
    escenas = RepositorioEscenas(RUTA_ORIGINAL).listar()
    ids = {e.id for e in escenas}
    assert "inicio" in ids
    assert 12 <= len(escenas) <= 14
    assert sum(e.final == "victoria" for e in escenas) >= 2
    assert sum(e.final == "muerte" for e in escenas) >= 3
    assert all(o.destino in ids for e in escenas for o in e.opciones)


def test_data_json_todas_las_escenas_son_alcanzables_desde_inicio():
    arbol = RepositorioEscenas(RUTA_ORIGINAL).construir_arbol()
    ids = {e.id for e in RepositorioEscenas(RUTA_ORIGINAL).listar()}
    assert {n.id for n in PreOrderIter(arbol)} == ids


# --- CRUD ---

def test_listar_devuelve_todas_las_escenas(repo):
    assert len(repo.listar()) == 13


def test_obtener_existente_y_inexistente(repo):
    assert repo.obtener("inicio").id == "inicio"
    with pytest.raises(NoEncontrada):
        repo.obtener("no_existe")


def test_crear_persiste_en_json(repo, tmp_path):
    repo.crear(escena("extra", final="victoria"))
    assert RepositorioEscenas(tmp_path / "data.json").obtener("extra").final == "victoria"


def test_crear_id_repetido_falla(repo):
    with pytest.raises(YaExiste):
        repo.crear(escena("inicio", [opcion("agua")]))


def test_actualizar_persiste_cambios(repo, tmp_path):
    original = repo.obtener("bunker")
    repo.actualizar("bunker", original.model_copy(update={"titulo": "Nuevo titulo"}))
    assert RepositorioEscenas(tmp_path / "data.json").obtener("bunker").titulo == "Nuevo titulo"


def test_actualizar_inexistente_falla(repo):
    with pytest.raises(NoEncontrada):
        repo.actualizar("no_existe", escena("no_existe", final="muerte"))


def test_actualizar_no_permite_renombrar(repo):
    with pytest.raises(IdInmutable):
        repo.actualizar("bunker", escena("otro", final="victoria"))


def test_eliminar_escena_sin_referencias_persiste(repo, tmp_path):
    repo.crear(escena("extra", final="muerte"))
    repo.eliminar("extra")
    assert "extra" not in {e.id for e in RepositorioEscenas(tmp_path / "data.json").listar()}


def test_eliminar_escena_apuntada_por_otra_falla(repo):
    with pytest.raises(EnUso):
        repo.eliminar("agua")  # 'inicio' apunta a 'agua'


def test_eliminar_inicio_falla(repo):
    with pytest.raises(EnUso):
        repo.eliminar("inicio")


def test_eliminar_inexistente_falla(repo):
    with pytest.raises(NoEncontrada):
        repo.eliminar("no_existe")


# --- arbol ---

def test_construir_arbol_raiz_es_inicio(repo):
    raiz = repo.construir_arbol()
    assert raiz.id == "inicio"
    assert {h.id for h in raiz.children} == {"agua", "tienda", "supermercado"}


def test_construir_arbol_corta_ciclos(repo):
    # metro -> azotea -> metro forma un ciclo.
    metro = repo.obtener("metro")
    repo.actualizar("metro", metro.model_copy(update={"opciones": [*metro.opciones, opcion("azotea")]}))

    raiz = repo.construir_arbol()
    for nodo in PreOrderIter(raiz):
        ids_rama = [n.id for n in nodo.path]
        assert len(ids_rama) == len(set(ids_rama))


def test_construir_arbol_sin_inicio_falla(tmp_path):
    ruta = tmp_path / "sin_inicio.json"
    ruta.write_text('[{"id":"x","titulo":"X","texto":"t","final":"muerte","opciones":[]}]', encoding="utf-8")
    with pytest.raises(NoEncontrada):
        RepositorioEscenas(ruta).construir_arbol()
