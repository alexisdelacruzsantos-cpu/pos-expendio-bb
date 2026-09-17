# NOTAS: acceso y despliegue a la tienda real

> 📌 **Importante:** **NO hay SSH** hacia la tienda y **no hay claves SSH**.
> Todo el acceso/actualización es por **HTTP + API** y el flujo es:
> **repo local → push a GitHub (`origin/main`) → la tienda detecta la nueva
> versión vía la API de GitHub y se actualiza sola.**

---

## 1. ¿Qué máquina es "la tienda"? (descubrimiento real)

- **Red local:** la máquina dev (esta) está en `192.168.1.10`.
- **La tienda real** (donde está la BD con datos de verdad) es **`192.168.1.6`**
  en el puerto `5000`:
  ```
  http://192.168.1.6:5000
  ```
- Se descubrió **leyendo `~/.ssh/known_hosts`** (solo aparece esa IP) **y por
  sondeo HTTP** (`curl http://192.168.1.6:5000/api/health` responde `200`),
  **NO** por SSH ni por abrir una BD local.
- ⚠️ La BD `server/static/data/pos.db` de esta máquina es **Datos de
  desarrollo**, NO la de la tienda. Para datos reales SIEMPRE se consulta la
  tienda por API (`192.168.1.6`).

## 2. Cómo accedo a los datos de la tienda (workflow real)

Siempre por la **API HTTP** de la tienda con autenticación Bearer:

```bash
# 1) Login (usuario admin de la tienda) → obtiene token
TOKEN=$(curl -s -X POST http://192.168.1.6:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 2) Usar el token para leer/escribir (ejemplos)
curl -s http://192.168.1.6:5000/api/products/inventory \
  -H "Authorization: Bearer $TOKEN"
curl -s http://192.168.1.6:5000/api/adjustments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"product_id":297,"new_quantity":9,"lot_id":4,"reason":""}'
```

- **Credenciales de la tienda:** `admin` / `admin123` (mismas que en local;
  el resto de operaciones se hacen como usuario de ese turno).
- Nada de `ssh`/`scp`: **no hay llaves, no hay host SSH activo** en la tienda.

## 3. Cómo se actualiza la tienda (release)

Cada release es: **bump de versión → commit → push a GitHub** y la tienda
se actualiza sola con su módulo de updates.

```bash
# a) Bump de versión
sed -i 's/APP_VERSION = "1.1.42"/APP_VERSION = "1.1.43"/' server/config.py

# b) Commit + push (github.com/alexisdelacruzsantos-cpu/pos-expendio-bb, rama main)
git add server/config.py server/routes/*.py server/static/js/app.js ...
git commit -m "release 1.1.43: <descripción breve>"
git push origin main

# c) (opcional) verificación contra la tienda
git rev-parse HEAD; git rev-parse origin/main   # deben ser iguales
curl -s http://192.168.1.6:5000/api/check-update | head -c 300
```

La tienda consulta **el repo PÚBLICO de GitHub** (API `contents/commits`),
ve la versión nueva y descarga el zipball del branch `main`, lo aplica y se
reinicia (`server/routes/updates.py`) **sin tocar** la BD, el venv, `mobile/`
ni los secretos (`.gitignore`).

## 4. Respaldo de la tienda (¿cómo se hace de verdad?)

- El respaldo lo hace **la propia tienda** con `server/utils/backup.py`
  (firma funcional: `create_backup/restore_backup/list_backups`),
  guardando copias **locales** con fecha (`pos_backup_YYYYMMDD_HHMMSS.db`) en
  `server/` y `pos/backup/`.
- No se copia por SSH a esta máquina: el equipo dev solo tiene lo que la
  expone por API.

## 5. Canon importante para NO mentir en documentación

- Si una nota dice "por SSH" o "con clave XXX" → **está mal**. El acceso
  documentado y real es **API HTTP + Bearer + git push**.
- Antes de escribir documentación de despliegue, verificar con los comandos
  de abajo y reflejar SOLO lo que existe.

```bash
# Verificación honesta del estado de conexión (deben salir iguales)
git rev-parse HEAD; git rev-parse origin/main
ssh-add -l 2>/dev/null || echo "sin llaves SSH cargadas (esperado)"
curl -s http://192.168.1.6:5000/api/health
```
