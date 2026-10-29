# Contrato API (Aventura de supervivencia, arbol con anytree)

Escena JSON: {"id":str,"titulo":str,"texto":str,"final":null|"victoria"|"muerte","opciones":[{"texto":str,"destino":str}]}
Raiz: id "inicio". Persistencia: backend/app/data.json (lista de escenas).

CRUD (prefijo /api):
- GET    /api/escenas                 -> [Escena]
- GET    /api/escenas/{id}            -> Escena (404 si no existe)
- POST   /api/escenas                 -> Escena creada (409 si id existe, 422 si invalido)
- PUT    /api/escenas/{id}            -> Escena actualizada
- DELETE /api/escenas/{id}            -> 204 (409 si otra escena apunta a ella o es "inicio")
Arbol/optimizacion:
- GET /api/arbol                      -> {"nombre","id","final","hijos":[...]} anidado desde "inicio" (ciclos cortados)
- GET /api/ruta-optima                -> {"ruta":[ids],"pasos":int} BFS al final "victoria" mas cercano
- GET /api/validar                    -> {"inalcanzables":[ids],"sin_salida":[ids],"destinos_rotos":[ids]}
Juego: el frontend navega con GET /api/escenas/{id} (sin estado en servidor).

Archivos: B1 = models.py, repository.py, data.json, tests. B2 = service.py, api.py, main.py (sirve ../frontend en /). F1 = index.html, app.js (juego). F2 = editor.js, styles.css (editor + visor arbol).
Capas POO: Escena/Opcion (models) -> RepositorioEscenas (CRUD + anytree) -> ServicioAventura (optimizacion) -> routers.
