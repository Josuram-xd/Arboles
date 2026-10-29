"""Path optimization, validation, statistics and tree export for the adventure, built on SceneRepository."""
from collections import deque

from app.repository import SceneRepository

ESCAPES = ("helicopter", "neighbor", "sewers")


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

    def _shortest_path(self, scenes: dict, is_goal):
        """Shortest path from 'start' to a scene satisfying is_goal, or None."""
        prev = self._bfs(scenes)
        # BFS discovery order is nondecreasing in distance, so the first goal found is the nearest.
        for scene_id in prev:
            if is_goal(scenes[scene_id]):
                path = []
                node = scene_id
                while node is not None:
                    path.append(node)
                    node = prev[node]
                path.reverse()
                return {"path": path, "steps": len(path) - 1}
        return None

    def optimal_path(self):
        """Shortest path from 'start' to any victory scene, or None if there is none."""
        return self._shortest_path(self._scene_map(), lambda s: s.ending == "victory")

    def escape_paths(self) -> dict:
        """Shortest path to a victory per escape type; each value is None when unreachable."""
        scenes = self._scene_map()
        return {
            escape: self._shortest_path(
                scenes, lambda s, e=escape: s.ending == "victory" and s.escape == e
            )
            for escape in ESCAPES
        }

    def validate(self) -> dict:
        scenes = self._scene_map()
        reachable = self._bfs(scenes)
        return {
            "unreachable": [i for i in scenes if i not in reachable],
            "dead_ends": [s.id for s in scenes.values() if s.ending is None and not s.options],
            "broken_targets": [
                s.id for s in scenes.values() if any(o.target not in scenes for o in s.options)
            ],
            "bad_victories": [
                s.id for s in scenes.values() if s.ending == "victory" and s.escape is None
            ],
        }

    def stats(self) -> dict:
        scenes = self.repo.list_all()
        root = self.repo.build_tree()
        endings = [s.ending for s in scenes]
        non_ending = [s for s in scenes if s.ending is None]
        total_options = sum(len(s.options) for s in non_ending)
        return {
            "scenes": len(scenes),
            "endings": {"victory": endings.count("victory"), "death": endings.count("death")},
            "max_depth": root.height,
            "leaf_count": len(root.leaves),
            "avg_branching": round(total_options / len(non_ending), 2) if non_ending else 0.0,
        }

    def tree_dict(self) -> dict:
        def convert(node):
            return {
                "name": node.name,
                "id": node.id,
                "ending": node.ending,
                "escape": node.escape,
                "enemy": node.enemy,
                "option_text": node.option_text,
                "repeated": node.repeated,
                "children": [convert(child) for child in node.children],
            }

        return convert(self.repo.build_tree())
