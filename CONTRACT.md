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
