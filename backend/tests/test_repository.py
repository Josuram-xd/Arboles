"""Model and repository tests, run against a temporary copy of data.json."""

import shutil
from pathlib import Path

import pytest
from anytree import PreOrderIter
from pydantic import ValidationError

from app.models import Option, Scene
from app.repository import AlreadyExists, ImmutableId, InUse, NotFound, SceneRepository

ORIGINAL_PATH = Path(__file__).resolve().parents[1] / "app" / "data.json"


@pytest.fixture
def repo(tmp_path):
    copy = tmp_path / "data.json"
    shutil.copy(ORIGINAL_PATH, copy)
    return SceneRepository(copy)


def scene(id_, options=(), ending=None):
    return Scene(id=id_, title=f"Title {id_}", text="Text", ending=ending, options=list(options))


def option(target):
    return Option(text=f"go to {target}", target=target)


# --- models ---

def test_non_ending_scene_with_options_is_valid():
    assert scene("a", [option("b")]).ending is None


def test_ending_scene_without_options_is_valid():
    assert scene("a", ending="death").options == []


def test_ending_scene_with_options_fails():
    with pytest.raises(ValidationError):
        scene("a", [option("b")], ending="victory")


def test_non_ending_scene_without_options_fails():
    with pytest.raises(ValidationError):
        scene("a")


def test_invalid_ending_value_fails():
    with pytest.raises(ValidationError):
        Scene(id="a", title="t", text="t", ending="draw", options=[])


# --- real data ---

def test_data_json_is_valid_and_complete():
    scenes = SceneRepository(ORIGINAL_PATH).list_all()
    ids = {s.id for s in scenes}
    assert "start" in ids
    assert 12 <= len(scenes) <= 14
    assert sum(s.ending == "victory" for s in scenes) >= 2
    assert sum(s.ending == "death" for s in scenes) >= 3
    assert all(o.target in ids for s in scenes for o in s.options)


def test_data_json_every_scene_is_reachable_from_start():
    tree = SceneRepository(ORIGINAL_PATH).build_tree()
    ids = {s.id for s in SceneRepository(ORIGINAL_PATH).list_all()}
    assert {n.id for n in PreOrderIter(tree)} == ids


# --- CRUD ---

def test_list_all_returns_every_scene(repo):
    assert len(repo.list_all()) == 13


def test_get_existing_and_missing(repo):
    assert repo.get("start").id == "start"
    with pytest.raises(NotFound):
        repo.get("no_such_scene")


def test_create_persists_to_json(repo, tmp_path):
    repo.create(scene("extra", ending="victory"))
    assert SceneRepository(tmp_path / "data.json").get("extra").ending == "victory"


def test_create_duplicate_id_fails(repo):
    with pytest.raises(AlreadyExists):
        repo.create(scene("start", [option("water")]))


def test_update_persists_changes(repo, tmp_path):
    original = repo.get("bunker")
    repo.update("bunker", original.model_copy(update={"title": "New title"}))
    assert SceneRepository(tmp_path / "data.json").get("bunker").title == "New title"


def test_update_missing_scene_fails(repo):
    with pytest.raises(NotFound):
        repo.update("no_such_scene", scene("no_such_scene", ending="death"))


def test_update_cannot_rename(repo):
    with pytest.raises(ImmutableId):
        repo.update("bunker", scene("other", ending="victory"))


def test_delete_unreferenced_scene_persists(repo, tmp_path):
    repo.create(scene("extra", ending="death"))
    repo.delete("extra")
    assert "extra" not in {s.id for s in SceneRepository(tmp_path / "data.json").list_all()}


def test_delete_scene_targeted_by_another_fails(repo):
    with pytest.raises(InUse):
        repo.delete("water")  # 'start' targets 'water'


def test_delete_start_fails(repo):
    with pytest.raises(InUse):
        repo.delete("start")


def test_delete_missing_scene_fails(repo):
    with pytest.raises(NotFound):
        repo.delete("no_such_scene")


# --- tree ---

def test_build_tree_root_is_start(repo):
    root = repo.build_tree()
    assert root.id == "start"
    assert {child.id for child in root.children} == {"water", "gunshop", "supermarket"}


def test_build_tree_cuts_cycles(repo):
    # subway -> rooftop -> subway forms a cycle.
    subway = repo.get("subway")
    repo.update("subway", subway.model_copy(update={"options": [*subway.options, option("rooftop")]}))

    root = repo.build_tree()
    for node in PreOrderIter(root):
        branch_ids = [n.id for n in node.path]
        assert len(branch_ids) == len(set(branch_ids))


def test_build_tree_without_start_fails(tmp_path):
    path = tmp_path / "no_start.json"
    path.write_text(
        '[{"id":"x","title":"X","text":"t","ending":"death","options":[]}]', encoding="utf-8"
    )
    with pytest.raises(NotFound):
        SceneRepository(path).build_tree()
