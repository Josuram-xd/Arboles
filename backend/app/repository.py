"""JSON scene repository: persistent CRUD and an anytree tree rooted at 'start'."""

import json
import os
from pathlib import Path

from anytree import Node

from .models import Scene

ROOT = "start"


class RepositoryError(Exception):
    """Base class for repository errors."""


class NotFound(RepositoryError):
    pass


class AlreadyExists(RepositoryError):
    pass


class InUse(RepositoryError):
    """Scene cannot be deleted: it is 'start' or another scene targets it."""


class ImmutableId(RepositoryError):
    """update() does not rename scenes: renaming would break the targets pointing to it."""


class SceneRepository:
    def __init__(self, json_path: str | Path) -> None:
        self._path = Path(json_path)

    def list_all(self) -> list[Scene]:
        if not self._path.exists():
            return []
        data = json.loads(self._path.read_text(encoding="utf-8"))
        return [Scene.model_validate(d) for d in data]

    def get(self, scene_id: str) -> Scene:
        scenes = self.list_all()
        return scenes[self._index(scenes, scene_id)]

    def create(self, scene: Scene) -> Scene:
        scenes = self.list_all()
        if any(s.id == scene.id for s in scenes):
            raise AlreadyExists(scene.id)
        scenes.append(scene)
        self._save(scenes)
        return scene

    def update(self, scene_id: str, scene: Scene) -> Scene:
        scenes = self.list_all()
        index = self._index(scenes, scene_id)
        if scene.id != scene_id:
            raise ImmutableId(scene_id)
        scenes[index] = scene
        self._save(scenes)
        return scene

    def delete(self, scene_id: str) -> None:
        scenes = self.list_all()
        self._index(scenes, scene_id)
        targeted = any(
            o.target == scene_id for s in scenes if s.id != scene_id for o in s.options
        )
        if scene_id == ROOT or targeted:
            raise InUse(scene_id)
        self._save([s for s in scenes if s.id != scene_id])

    def build_tree(self) -> Node:
        scenes = {s.id: s for s in self.list_all()}
        if ROOT not in scenes:
            raise NotFound(ROOT)
        return self._node(scenes, scenes[ROOT], frozenset())

    def _node(
        self,
        scenes: dict[str, Scene],
        scene: Scene,
        ancestors: frozenset[str],
        parent: Node | None = None,
        option_text: str | None = None,
    ) -> Node:
        node = Node(
            scene.title, parent=parent, id=scene.id, ending=scene.ending, option_text=option_text
        )
        # Cut cycles: a target already on the current branch is not expanded again.
        branch = ancestors | {scene.id}
        for option in scene.options:
            if option.target in scenes and option.target not in branch:
                self._node(scenes, scenes[option.target], branch, node, option.text)
        return node

    @staticmethod
    def _index(scenes: list[Scene], scene_id: str) -> int:
        for i, s in enumerate(scenes):
            if s.id == scene_id:
                return i
        raise NotFound(scene_id)

    def _save(self, scenes: list[Scene]) -> None:
        data = [s.model_dump() for s in scenes]
        temp = self._path.with_name(self._path.name + ".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temp, self._path)  # atomic replace: never leaves a half-written JSON
