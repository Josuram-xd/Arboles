import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app  # noqa: E402


def S(id, title=None, ending=None, options=()):
    return {
        "id": id,
        "title": title or id.upper(),
        "text": f"text of {id}",
        "ending": ending,
        "options": [{"text": f"go to {t}", "target": t} for t in options],
    }


# start -> a -> v (victory, 2 steps); start -> b -> c -> w (victory, 3 steps)
# c -> start is a cycle. d and e are unreachable; d has a broken target.
SCENES = [
    S("start", options=["a", "b"]),
    S("a", options=["v"]),
    S("b", options=["c"]),
    S("c", options=["w", "start"]),
    S("v", ending="victory"),
    S("w", ending="victory"),
    S("d", options=["nope"]),
    S("e", ending="death"),
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
    changed = S("a", title="New title", options=["v", "w"])
    assert c.put("/api/scenes/a", json=changed).status_code == 200
    assert c.get("/api/scenes/a").json()["title"] == "New title"
    assert c.put("/api/scenes/zzz", json=S("zzz", ending="death")).status_code == 404
    assert c.put("/api/scenes/a", json=S("other", options=["v"])).status_code == 422


def test_delete(tmp_path):
    c = client(tmp_path)
    assert c.delete("/api/scenes/e").status_code == 204
    assert c.get("/api/scenes/e").status_code == 404
    assert c.delete("/api/scenes/v").status_code == 409  # a targets v
    assert c.delete("/api/scenes/start").status_code == 409
    assert c.delete("/api/scenes/zzz").status_code == 404


def test_tree_cuts_cycles(tmp_path):
    root = client(tmp_path).get("/api/tree").json()
    assert root["id"] == "start" and root["name"] == "START"
    children = {h["id"]: h for h in root["children"]}
    assert set(children) == {"a", "b"}
    c_node = children["b"]["children"][0]
    assert c_node["id"] == "c"
    # The cycle c -> start is not expanded again.
    assert all(h["id"] != "start" for h in c_node["children"])
    assert [h["id"] for h in children["a"]["children"]] == ["v"]
    assert children["a"]["children"][0]["ending"] == "victory"


def test_optimal_path(tmp_path):
    r = client(tmp_path).get("/api/optimal-path")
    assert r.status_code == 200
    assert r.json() == {"path": ["start", "a", "v"], "steps": 2}


def test_optimal_path_without_victory(tmp_path):
    no_victory = [S("start", options=["a"]), S("a", ending="death")]
    r = client(tmp_path, no_victory).get("/api/optimal-path")
    assert r.status_code == 200 and r.json()["path"] is None


def test_validate(tmp_path):
    r = client(tmp_path).get("/api/validate").json()
    # dead_ends is always empty: Scene already forbids non-ending scenes without options.
    assert r == {
        "unreachable": ["d", "e"],
        "dead_ends": [],
        "broken_targets": ["d"],
    }


def test_frontend_served_at_root(tmp_path):
    assert client(tmp_path).get("/").status_code == 200
