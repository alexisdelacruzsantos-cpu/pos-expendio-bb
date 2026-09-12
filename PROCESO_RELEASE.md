# PROCESO_RELEASE.md - Cómo llegan los cambios a las tiendas

> **Propósito:** Documentar el flujo exacto para publicar cambios (código o base de
> datos) del POS y que lleguen a las máquinas en las tiendas. Es la fuente de verdad
> para saber "qué pasa después de un commit".

---

## Resumen del sistema de actualizaciones

- El POS **no se actualiza solo**: la tienda tiene que abrir la web
  (`Ajustes → Actualizaciones → 🔍 Buscar actualizaciones → Aplicar`).
- El módulo web compara `APP_VERSION` local vs el de `server/config.py` en GitHub
  (`main`). **Solo decide "hay o no hay novedad"**: si difieren, ofrece aplicar.
- Al aplicar, descarga el **zipball completo de `main`** (GitHub API), no parches
  incrementales. Por eso una tienda en 1.1.0 puede saltar directo a 1.1.6 sin riesgo
  (si no hay migración no auto-contenida; ver abajo).
- Antes de aplicar: respaldo automático de la BD (`pos/backup/pos_backup_update_*`).
- Después de aplicar: reinicio automático (`.bat` en Windows, `.sh` en Linux;
  bajo systemd deja que `Restart=always` haga el trabajo).

## Regla de oro del versionado

> **Cada release que deba llegar a las tiendas sube `APP_VERSION` en
> `server/config.py` y se commitea como commit de release.**

Un cambio sin subir `APP_VERSION` **NO llega a las tiendas** (queda solo acá / para
la próxima versión). Si es urgente, es válido subir la versión solo por ese cambio.

## Flujo de trabajo al hacer un cambio

1. **Editar código** en el repo local.
2. **Verificar** lo que corresponda:
   - Python: `python3 -m py_compile <archivo>.py`
   - JS: `node --check server/static/js/app.js`
   - Bash: `bash -n <archivo>.sh`
3. **Subir `APP_VERSION`** (si el cambio debe llegar a tiendas):
   - bugfix = `+1` en el patch (`1.1.0 → 1.1.1`)
   - funcionalidad nueva = `+1` en el minor (`1.1.x → 1.2.0`)
4. **Commit** con mensaje que describa el cambio. Los commits de release llevan
   prefijo `release <versión>: <descripción>` (ej: `release 1.1.1: ...`).
5. **Push** a `origin/main` (repo público,
   `github.com/alexisdelacruzsantos-cpu/pos-expendio-bb`).
6. **(Opcional) avisar a la tienda** para que haga clic en Actualizar. No es
   automático.

### Ejemplo real (sesión de trabajo)

```
git add server/routes/updates.py
git commit -m "fix(updates): bajo systemd no relanzar con nohup"
git push origin main

git add server/config.py
git commit -m "release 1.1.1: ..."
git push origin main
```

## Cómo se comporta la tienda

| Paso | Quién | Cómo |
|------|-------|------|
| Descubrir novedad | Tienda | Abre Ajustes → Actualizaciones → 🔍 Buscar |
| Aplicar | Tienda (un clic) | Descarga zipball de main, respalda BD, reemplaza archivos, reinicia |
| Migrar BD | Automático | Al arrancar corre `init_db()` → `run_migrations()` |

## Convención para cambios de ESQUEMA de base de datos

**TODO cambio de esquema va a `run_migrations()` en `server/utils/database.py`
(`server/utils/database.py:470`)** como operación **aditiva + idempotente**:

- Estilo permitido: `ALTER TABLE ... ADD COLUMN ...` con verificación previa
  `PRAGMA table_info(<tabla>)` (si la columna ya existe, no re-ejecutar).
- Estilo NO permitido (hasta nuevo aviso): renombrar/reestructurar tablas, cambiar
  tipos, o transformaciones de datos que dependan del estado previo de la BD.
- Las migraciones corren **en cada arranque sobre la BD existente**: por eso los
  saltos de versión (1.1.0 → 1.1.6) son seguros — la versión nueva "ve" qué le falta
  y lo agrega sola.

> **Si algún día se necesita una migración destructiva** (renombrado de tabla,
> recálculo histórico), la regla es: la migración debe ser **auto-contenida** —
> detectar el estado viejo y transformarlo ella misma al arrancar — para que el salto
> de versión siga siendo indistinguible. Documentar en este archivo antes de hacerla.

## Recordatorios operativos

- La BD real vive fuera de Git: `server/static/data/pos.db` (en `.gitignore`). El
  zipball nunca la pisa.
- Respaldos: `pos/backup/` — automático cada 24 h (`_autobackup` en `app.py`), al
  apagar, y antes de cada actualización (se conservan los últimos 15).
- Índices: se crean con `CREATE INDEX IF NOT EXISTS` en cada arranque
  (`create_indexes()`, `database.py:359`). Idempotente, aplica sobre BD existente.
- El `.jwt_secret`, `venv/` y `CATALOGO.xlsx` también están fuera de Git.

---
<!-- Versión de ejemplo usada en el texto: v1.1.x -->