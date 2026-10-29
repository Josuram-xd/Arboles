import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app  # noqa: E402
from app.models import Scene  # noqa: E402
from app.service import AdventureService  # noqa: E402


def S(id, ending=None, escape=None, enemy=None, options=()):
    return {
        "id": id,
        "title": id.upper(),
        "text": f"text of {id}",
        "ending": ending,
        "escape": escape,
        "enemy": enemy,
        "options": [{"text": f"go to {t}", "target": t} for t in options],
    }


# start -> a (walker) -> heli (victory, helicopter): 2 steps
# start -> b -> c -> neighbor (victory, neighbor): 3 steps; c -> a is a repeated subtree
# c -> start is a cycle. d is a death ending. e and f are unreachable; e has a broken target.
SCENES = [
    S("start", options=["a", "b"]),
    S("a", enemy="walker", options=["heli"]),
    S("heli", ending="victory", escape="helicopter"),
    S("b", options=["c", "d"]),
    S("c", options=["neighbor", "a", "start"]),
    S("neighbor", ending="victory", escape="neighbor"),
    S("d", ending="death"),
    S("e", options=["nope"]),
    S("f", ending="death"),
]


def client(tmp_path, scenes=SCENES):
    path = tmp_path / "data.json"
    path.write_text(json.dumps(scenes), encoding="utf-8")
    return TestClient(create_app(path))


def test_list_and_get(tmp_path):
    c = client(tmp_path)
    assert len(c.get("/api/scenes").json()) == len(SCENES)
    assert c.get("/api/scenes/a").json()["id"] == "a"
    assert c.get("/api/scenes/zzz").status_code == 404


def test_create(tmp_path):
    c = client(tmp_path)
    new = S("new", options=["start"])
    assert c.post("/api/scenes", json=new).status_code == 201
    assert c.get("/api/scenes/new").json()["text"] == "text of new"
    assert c.post("/api/scenes", json=new).status_code == 409
    assert c.post("/api/scenes", json={"id": "x"}).status_code == 422
    assert c.post("/api/scenes", json={**new, "ending": "other"}).status_code == 422


def test_update(tmp_path):
    c = client(tmp_path)
    changed = S("a", enemy="runner", options=["heli"])
    assert c.put("/api/scenes/a", json=changed).status_code == 200
    assert c.get("/api/scenes/a").json()["enemy"] == "runner"
    assert c.put("/api/scenes/zzz", json=S("zzz", ending="death")).status_code == 404
    assert c.put("/api/scenes/a", json=S("other", options=["heli"])).status_code == 422


def test_delete(tmp_path):
    c = client(tmp_path)
    assert c.delete("/api/scenes/f").status_code == 204
    assert c.get("/api/scenes/f").status_code == 404
    assert c.delete("/api/scenes/heli").status_code == 409  # a targets heli
    assert c.delete("/api/scenes/start").status_code == 409
    assert c.delete("/api/scenes/zzz").status_code == 404


def test_tree_nodes_and_repeated(tmp_path):
    root = client(tmp_path).get("/api/tree").json()
    assert root["id"] == "start" and root["name"] == "START"
    assert root["option_text"] is None and root["repeated"] is False
    assert set(root) == {"name", "id", "ending", "escape", "enemy", "option_text", "repeated", "children"}
    children = {h["id"]: h for h in root["children"]}
    assert set(children) == {"a", "b"}

    a_node = children["a"]
    assert a_node["enemy"] == "walker" and a_node["option_text"] == "go to a"
    assert [h["id"] for h in a_node["children"]] == ["heli"]
    assert a_node["children"][0]["escape"] == "helicopter"

    c_node = children["b"]["children"][0]
    assert c_node["id"] == "c"
    # a and the cycle back to start both reappear as repeated leaves (no children).
    assert [h["id"] for h in c_node["children"]] == ["neighbor", "a", "start"]
    for leaf in c_node["children"][1:]:
        assert leaf["repeated"] is True and leaf["children"] == []
    assert c_node["children"][0]["repeated"] is False


def test_optimal_path(tmp_path):
    r = client(tmp_path).get("/api/optimal-path")
    assert r.status_code == 200
    assert r.json() == {"path": ["start", "a", "heli"], "steps": 2}


def test_optimal_path_without_victory(tmp_path):
    no_victory = [S("start", options=["a"]), S("a", ending="death")]
    r = client(tmp_path, no_victory).get("/api/optimal-path")
    assert r.status_code == 200
    assert r.json() == {"path": None, "steps": None}


def test_escape_paths(tmp_path):
    r = client(tmp_path).get("/api/escape-paths").json()
    assert r == {
        "helicopter": {"path": ["start", "a", "heli"], "steps": 2},
        "neighbor": {"path": ["start", "b", "c", "neighbor"], "steps": 3},
        "sewers": None,
    }


def test_stats(tmp_path):
    r = client(tmp_path).get("/api/stats").json()
    assert r == {
        "scenes": 9,
        "endings": {"victory": 2, "death": 2},
        "max_depth": 3,
        "leaf_count": 5,  # heli, neighbor, d, and the repeated a and start
        "avg_branching": 1.8,  # 9 options over 5 non-ending scenes
    }


def test_validate(tmp_path):
    r = client(tmp_path).get("/api/validate").json()
    assert r == {
        "unreachable": ["e", "f"],
        "dead_ends": [],
        "broken_targets": ["e"],
        "bad_victories": [],
    }


def test_bad_victories_and_dead_ends_detected():
    # The model forbids these shapes, so use unvalidated scenes to exercise the checks.
    scenes = [
        Scene.model_construct(id="start", title="S", text="t", ending=None, escape=None,
                              enemy=None, options=[SimpleNamespace(target="v"), SimpleNamespace(target="x")]),
        Scene.model_construct(id="v", title="V", text="t", ending="victory", escape=None,
                              enemy=None, options=[]),
        Scene.model_construct(id="x", title="X", text="t", ending=None, escape=None,
                              enemy=None, options=[]),
    ]
    repo = SimpleNamespace(list_all=lambda: scenes)
    result = AdventureService(repo).validate()
    assert result["bad_victories"] == ["v"]
    assert result["dead_ends"] == ["x"]


def test_frontend_served_at_root(tmp_path):
    assert client(tmp_path).get("/").status_code == 200


def test_real_data_smoke_read_only():
    # Read-only smoke test against the shipped data.json: GET endpoints must answer.
    data = Path(__file__).resolve().parents[1] / "app" / "data.json"
    if not data.exists() or data.stat().st_size == 0:
        pytest.skip("data.json is empty")
    c = TestClient(create_app())
    assert c.get("/api/scenes").status_code == 200
    assert c.get("/api/stats").status_code == 200
    assert c.get("/api/validate").status_code == 200
