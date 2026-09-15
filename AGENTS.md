# AGENTS.md - Convenciones del repositorio POS-EXPENDIO-BB

Guía para trabajar en este repo sin romper las reglas operativas del sistema.

## Estructura clave

- `server/` — aplicación Flask (backend + estáticos + plantillas).
- `server/app.py` — entrada; sirve con `waitress` por defecto (8 threads), fallback Werkzeug.
- `server/config.py` — `APP_VERSION`, `GITHUB_OWNER/REPO/BRANCH`. Repo público `main`.
- `server/routes/updates.py` — módulo de actualizaciones web (check/apply/restart).
- `server/utils/database.py` — esquema, `run_migrations()`, `create_indexes()`.
- `server/static/js/app.js` — toda la lógica frontend (SPA).
- `server/templates/{index.html,dashboard.html}` — login y la app.

## Reglas estrictas

1. **Versión**: los cambios que deban llegar a las tiendas **suben `APP_VERSION`**
   en `server/config.py` y se commitean como `release <v>: <desc>`. Sin bump = no llega.
   El commit **debe subirse a `origin/main`** (`git push origin main`): las tiendas
   consultan `config.py` **del repo público en GitHub** (API), no del repo local;
   un release sin `push` se queda "sin actualizaciones pendientes" en las tiendas.
2. **Restart en updates**: `apply()` termina con `_restart_script()` (en
   `updates.py`); NO reemplazar por otra lógica de reinicio. Bajo systemd se detecta
   `INVOCATION_ID` para no relanzar con `nohup` (deja que `Restart=always` lo haga).
3. **Esquema BD**: cambios aditivos e idempotentes SOLO en `run_migrations()`.
   Verificar columna con `PRAGMA table_info` antes de `ALTER`. Nada destructivo.
4. **Índices**: `create_indexes()` con `CREATE INDEX IF NOT EXISTS` (idempotente).
5. **No vender sin turno**: el backend bloquea (`sales.py` → `shift_required`), el
   frontend bloquea con `blockUntilShiftOpen()`. No romper esa cadena.
6. **Boots/autoinicio**: Linux = systemd (`instalar_linux.sh`); Windows =
   `iniciar_silencioso.bat` + tarea ONLOGON.
7. **Archivos fuera de Git** (nunca commitear): `DB_PATH`, `venv/`, `pos/`,
   `CATALOGO.xlsx`, `.jwt_secret`. El zipball de update no los pisa (`.gitignore`).

## Verificaciones antes de commitear

- Python: `python3 -m py_compile <archivo>.py`
- JS: `node --check server/static/js/app.js`
- Bash: `bash -n <archivo>.sh`
- Probar al menos `GET /api/health` contra una instancia local.

## Documentos de referencia

- `PROCESO_RELEASE.md` — flujo completo de publicación/actualizaciones.
- `NOTAS_DESPLIEGUE.md` — errores reales de instalación Windows 8.1.
- `README.md` — instalación, stack, estructura.