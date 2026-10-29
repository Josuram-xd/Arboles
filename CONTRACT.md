# API contract (zombie survival graphic novel, anytree)

All code is in English: identifiers, comments, JSON keys, endpoints, tests, CSS classes.
Only user-facing UI text and story content (data.json values) stay in Spanish.

Scene JSON: {"id":str,"title":str,"text":str,"ending":null|"victory"|"death","options":[{"text":str,"target":str}]}
Root scene id: "start". Persistence: backend/app/data.json (list of scenes).

CRUD (prefix /api):
- GET    /api/scenes             -> [Scene]
- GET    /api/scenes/{id}        -> Scene (404 if missing)
- POST   /api/scenes             -> created Scene (409 if id exists, 422 if invalid)
- PUT    /api/scenes/{id}        -> updated Scene
- DELETE /api/scenes/{id}        -> 204 (409 if another scene targets it or id is "start")
Tree / optimization:
- GET /api/tree                  -> {"name","id","ending","children":[...]} nested from "start" (cycles cut)
- GET /api/optimal-path          -> {"path":[ids],"steps":int} BFS to nearest "victory" ending (path null if none)
- GET /api/validate              -> {"unreachable":[ids],"dead_ends":[ids],"broken_targets":[ids]}
Gameplay: frontend walks with GET /api/scenes/{id} (no server state).

Layers (OOP): Scene/Option (models) -> SceneRepository (CRUD + anytree; NotFound, AlreadyExists, InUse) -> AdventureService (optimal_path, validate, tree_dict) -> routers.
Frontend classes: Game (app.js), SceneEditor (editor.js, exposes window.initEditor(container)).
Ownership: B1 models.py/repository.py/data.json/tests; B2 service.py/api.py/main.py/tests; F1 index.html/app.js/styles.css; F2 editor.js/editor.css.

---
# v2 (escape from a building) - additions, all code in English, UI/story text in Spanish

Scene gains: "enemy": null|"walker"|"runner"|"brute"|"horde"  (enemy shown in that scene)
             "escape": null|"helicopter"|"neighbor"|"sewers"   (REQUIRED when ending=="victory", null otherwise)
Option gains: "effects": {"health":int,"supplies":int,"noise":int}  each -3..3, default 0 (all optional).
Client-side stats only (frontend tracks them, clamps health 0..5 start 5, supplies 0..5 start 3, noise 0..5 start 0).
The ending is decided ONLY by the scene graph, never by the stats.

Story: escape a zombie-infested office/apartment building. ~30-36 scenes, several floors/areas, enemies along the way.
Exactly 3 victory endings: helicopter (rooftop), neighbor (hold out in the building until a neighbor appears later, then escape with her),
sewers (via basement/sewers). At least 6 death endings. Root id stays "start". Mostly tree-like with a few merges.

GET /api/tree nodes: {"name","id","ending","escape","enemy","option_text","repeated","children":[...]}.
  option_text = text of the option leading to that node (null at root). A scene already expanded elsewhere in the tree
  reappears as a leaf with "repeated": true and "children": [] (keeps the tree small; cycles are covered by this too).
GET /api/escape-paths -> {"helicopter":{"path":[ids],"steps":int}|null,"neighbor":...|null,"sewers":...|null}  (BFS per escape type)
GET /api/stats        -> {"scenes":int,"endings":{"victory":int,"death":int},"max_depth":int,"leaf_count":int,"avg_branching":float}
/api/optimal-path and /api/validate unchanged. validate additionally reports "bad_victories":[ids] (victory without escape).

Frontend shared globals (script order in index.html: audio.js, treeview.js, editor.js, app.js; css: styles.css, editor.css, treeview.css):
- audio.js (F2): window.GameAudio = { play(name), toggleMute(), isMuted() }. Names: click, hit, heal, pickup, walker, runner, brute, horde,
  victory, death, tree. Synthesized with WebAudio (no asset files), AudioContext created lazily on first user gesture, mute persisted
  in localStorage (try/catch). play() must never throw.
- treeview.js + treeview.css (F2): window.TreeView.render(container, treeData, {pathIds, currentId, optimalPath, animate}) -> controller
  {update({pathIds,currentId})}. Draws the nested /api/tree as an SVG or nested-list tree; visited path highlighted, current node pulsing,
  unvisited branches dimmed, victory nodes labelled by escape type, enemy nodes marked, repeated nodes shown as links/ghosts; if animate,
  nodes appear progressively. Used by BOTH the editor and the game.
Ownership v2: B1 models/repository/data.json/tests; B2 service/api/tests; F1 index.html/app.js/styles.css; F2 audio.js/treeview.js/treeview.css/editor.js/editor.css.
