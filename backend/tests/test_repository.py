"""Model and repository tests, run against a temporary copy of data.json."""

import shutil
from pathlib import Path

import pytest
from anytree import PreOrderIter
from pydantic import ValidationError

from app.models import Effects, Option, Scene
from app.repository import AlreadyExists, ImmutableId, InUse, NotFound, SceneRepository

ORIGINAL_PATH = Path(__file__).resolve().parents[1] / "app" / "data.json"


@pytest.fixture
def repo(tmp_path):
    copy = tmp_path / "data.json"
    shutil.copy(ORIGINAL_PATH, copy)
    return SceneRepository(copy)


def scene(id_, options=(), ending=None, escape=None, enemy=None):
    return Scene(
        id=id_, title=f"Title {id_}", text="Text", ending=ending, escape=escape,
        enemy=enemy, options=list(options),
    )


def option(target, **effects):
    return Option(text=f"go to {target}", target=target, effects=Effects(**effects))


# --- models ---

def test_non_ending_scene_with_options_is_valid():
    assert scene("a", [option("b")]).ending is None


def test_victory_scene_with_escape_is_valid():
    assert scene("a", ending="victory", escape="sewers").escape == "sewers"


def test_ending_scene_with_options_fails():
    with pytest.raises(ValidationError):
        scene("a", [option("b")], ending="death")


def test_non_ending_scene_without_options_fails():
    with pytest.raises(ValidationError):
        scene("a")


def test_victory_without_escape_fails():
    with pytest.raises(ValidationError):
        scene("a", ending="victory")


def test_escape_on_non_victory_fails():
    with pytest.raises(ValidationError):
        scene("a", ending="death", escape="helicopter")


def test_invalid_enemy_and_escape_values_fail():
    with pytest.raises(ValidationError):
        scene("a", [option("b")], enemy="zombie")
    with pytest.raises(ValidationError):
        scene("a", ending="victory", escape="car")


def test_effects_default_to_zero():
    assert Option(text="t", target="b").effects == Effects(health=0, supplies=0, noise=0)


@pytest.mark.parametrize("value", [-4, 4])
def test_effects_outside_range_fail(value):
    with pytest.raises(ValidationError):
        Effects(health=value)


# --- real data ---

def test_data_json_is_valid_and_complete():
    scenes = SceneRepository(ORIGINAL_PATH).list_all()
    ids = {s.id for s in scenes}
    assert "start" in ids
    assert 30 <= len(scenes) <= 36
    assert sum(s.ending == "death" for s in scenes) >= 6
    assert all(o.target in ids for s in scenes for o in s.options)


def test_data_json_has_exactly_three_victories_with_distinct_escapes():
    victories = [s for s in SceneRepository(ORIGINAL_PATH).list_all() if s.ending == "victory"]
    assert len(victories) == 3
    assert {v.escape for v in victories} == {"helicopter", "neighbor", "sewers"}


def test_data_json_uses_every_enemy_type():
    enemies = {s.enemy for s in SceneRepository(ORIGINAL_PATH).list_all()}
    assert {"walker", "runner", "brute", "horde"} <= enemies


def test_data_json_every_scene_is_reachable_from_start():
    tree = SceneRepository(ORIGINAL_PATH).build_tree()
    ids = {s.id for s in SceneRepository(ORIGINAL_PATH).list_all()}
    assert {n.id for n in PreOrderIter(tree)} == ids


def test_data_json_each_victory_is_reachable_by_a_different_path():
    tree = SceneRepository(ORIGINAL_PATH).build_tree()
    paths = {
        n.escape: [a.id for a in n.path]
        for n in PreOrderIter(tree)
        if n.ending == "victory"
    }
    assert set(paths) == {"helicopter", "neighbor", "sewers"}
    # Each victory is reached through a different scene chain.
    assert len({tuple(p) for p in paths.values()}) == 3


# --- CRUD ---

def test_list_all_returns_every_scene(repo):
    assert len(repo.list_all()) == len(SceneRepository(ORIGINAL_PATH).list_all())


def test_get_existing_and_missing(repo):
    assert repo.get("start").id == "start"
    with pytest.raises(NotFound):
        repo.get("no_such_scene")


def test_create_persists_to_json(repo, tmp_path):
    repo.create(scene("extra", ending="victory", escape="helicopter"))
    assert SceneRepository(tmp_path / "data.json").get("extra").escape == "helicopter"


def test_create_duplicate_id_fails(repo):
    with pytest.raises(AlreadyExists):
        repo.create(scene("start", [option("elevator")]))


def test_update_persists_changes(repo, tmp_path):
    original = repo.get("helicopter")
    repo.update("helicopter", original.model_copy(update={"title": "New title"}))
    assert SceneRepository(tmp_path / "data.json").get("helicopter").title == "New title"


def test_update_missing_scene_fails(repo):
    with pytest.raises(NotFound):
        repo.update("no_such_scene", scene("no_such_scene", ending="death"))


def test_update_cannot_rename(repo):
    with pytest.raises(ImmutableId):
        repo.update("helicopter", scene("other", ending="victory", escape="helicopter"))


def test_delete_unreferenced_scene_persists(repo, tmp_path):
    repo.create(scene("extra", ending="death"))
    repo.delete("extra")
    assert "extra" not in {s.id for s in SceneRepository(tmp_path / "data.json").list_all()}


def test_delete_scene_targeted_by_another_fails(repo):
    with pytest.raises(InUse):
        repo.delete("elevator")  # 'start' targets 'elevator'


def test_delete_start_fails(repo):
    with pytest.raises(InUse):
        repo.delete("start")


def test_delete_missing_scene_fails(repo):
    with pytest.raises(NotFound):
        repo.delete("no_such_scene")


# --- tree ---

def test_build_tree_root_is_start_with_its_three_branches(repo):
    root = repo.build_tree()
    assert root.id == "start"
    assert {child.id for child in root.children} == {"stairs3", "hr_office", "elevator"}


def test_build_tree_nodes_carry_v2_attributes(repo):
    nodes = {n.id: n for n in PreOrderIter(repo.build_tree())}
    assert nodes["neighbor"].escape == "neighbor"
    assert nodes["neighbor"].ending == "victory"
    assert nodes["stairs3"].enemy == "walker"
    assert nodes["start"].option_text is None
    assert nodes["stairs3"].option_text == "Bajar por las escaleras de emergencia"
    assert nodes["stairs3"].repeated is False


def test_build_tree_marks_repeated_scenes_as_leaves(repo):
    # 'elevator' is reachable from 'start' and 'hr_office': the second visit is a leaf.
    repeated = [n for n in PreOrderIter(repo.build_tree()) if n.repeated]
    assert repeated
    assert all(n.children == () for n in repeated)


def test_build_tree_cuts_cycles(repo):
    # roof_signal -> roof_door closes a cycle (roof_door -> roof_signal -> roof_door).
    signal = repo.get("roof_signal")
    repo.update("roof_signal", signal.model_copy(update={"options": [*signal.options, option("roof_door")]}))

    root = repo.build_tree()
    for node in PreOrderIter(root):
        if node.repeated:
            assert node.children == ()  # the repeated copy is a leaf, its id may match an ancestor
        else:
            branch_ids = [n.id for n in node.path]
            assert len(branch_ids) == len(set(branch_ids))


def test_build_tree_without_start_fails(tmp_path):
    path = tmp_path / "no_start.json"
    path.write_text(
        '[{"id":"x","title":"X","text":"t","ending":"death","escape":null,"enemy":null,"options":[]}]',
        encoding="utf-8",
    )
    with pytest.raises(NotFound):
        SceneRepository(path).build_tree()
