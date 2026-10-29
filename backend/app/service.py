"""Path optimization, validation and tree export for the adventure, built on SceneRepository."""
from collections import deque

from app.repository import SceneRepository


class AdventureService:
    def __init__(self, repo: SceneRepository):
        self.repo = repo

    def _scene_map(self) -> dict:
        return {s.id: s for s in self.repo.list_all()}

    @staticmethod
    def _bfs(scenes: dict) -> dict:
        """Return {id: parent} for every scene reachable from 'start', in BFS discovery order."""
        prev = {}
        if "start" not in scenes:
            return prev
        prev["start"] = None
        queue = deque(["start"])
        while queue:
            current = queue.popleft()
            for option in scenes[current].options:
                if option.target in scenes and option.target not in prev:
                    prev[option.target] = current
                    queue.append(option.target)
        return prev

    def optimal_path(self):
        """Shortest path from 'start' to a victory scene, or None if there is none."""
        scenes = self._scene_map()
        prev = self._bfs(scenes)
        # BFS discovery order is nondecreasing in distance, so the first victory found is the nearest.
        for scene_id in prev:
            if scenes[scene_id].ending == "victory":
                path = []
                node = scene_id
                while node is not None:
                    path.append(node)
                    node = prev[node]
                path.reverse()
                return {"path": path, "steps": len(path) - 1}
        return None

    def validate(self) -> dict:
        scenes = self._scene_map()
        reachable = self._bfs(scenes)
        return {
            "unreachable": [i for i in scenes if i not in reachable],
            "dead_ends": [s.id for s in scenes.values() if s.ending is None and not s.options],
            "broken_targets": [
                s.id for s in scenes.values() if any(o.target not in scenes for o in s.options)
            ],
        }

    def tree_dict(self) -> dict:
        def convert(node):
            return {
                "name": node.name,
                "id": node.id,
                "ending": node.ending,
                "children": [convert(child) for child in node.children],
            }

        return convert(self.repo.build_tree())
