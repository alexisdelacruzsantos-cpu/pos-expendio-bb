# DOCUMENTACIÓN FASE 7 — Sincronización en la nube (app móvil web + espejo de solo lectura)

> **Sistema:** POS EXPENDIO BB (Flask + SQLite, servidor en la tienda; app Flutter web).
> **Fase:** 7 — "Ver el negocio desde el celular estés donde estés".
> **Release:** 1.4.0 (commit `5d5ae34`, rama `main`, repo público).
> **Estado del documento:** vigente. Despliegue del host en curso (PythonAnywhere).

---

## 1. Idea y problema de fondo

El punto de venta corre **solo dentro de la tienda** (LAN, puerto 5000). La app
móvil Flutter, hasta la Fase 6, solo funcionaba apuntando a la IP local de esa
LAN: desde fuera de la tienda el dueño **no podía ver ventas, stock o reportes**
en su teléfono.

**Idea:** poner una copia de los datos **en un host público gratuito** para que
la app móvil los consulte desde cualquier red, sin necesidad de VPN ni
port-forwarding. Como la mayoría de las consultas son reportes/productos/historial
(lectura), la solución no exige escritura remota: **basta con un espejo de solo
lectura** que la tienda actualiza periódicamente.

**De forma concreta:** el POS de la tienda sube periódicamente su base de datos
(comprimida y autenticada) a un servidor en PythonAnywhere; ese servidor ejecuta
el mismo Flask con `POS_READONLY=1` y además sirve la app web Flutter. El celular
abre `https://<usuario>.pythonanywhere.com/movil/` y consulta la API del mismo
dominio.

---

## 2. Alcance

### En alcance (Fase 7)
- Espejo de **solo lectura** de la BD del POS en un host gratuito.
- Consultas desde el móvil: productos, ventas/ventas generales, reportes,
  historial, stats puntuales.
- Login/validación de JWT en el host (los usuarios viajan en la BD subida).
- Sincronización configurable desde el POS: activar/desactivar, URL del host,
  token, intervalo (60–3600 s, por defecto 300 s) y botón "Sincronizar ahora".
- App Flutter compilada a **web** y servida por el mismo host en `/movil/`.
- Detección de "no hay cambios" para no subir basura cada ciclo.

### Fuera de alcance (explícito)
- **Ventas, ajustes y escrituras remotas**: todo cambio de datos se hace en la
  tienda. El host rechaza toda escritura (403).
- Multi-tenant: un POS = una cuenta + un token.
- APK para Android (solo web, por decisión de despliegue).
- Sincronización bidireccional / resolución de conflictos.
- Alta disponibilidad o SLA: el host es un espejo de consulta, no el sistema de
  venta.

---

## 3. Decisiones de diseño (y por qué)

| Decisión | Opción | Justificación |
|---|---|---|
| Host gratuito | **PythonAnywhere (plan FREE)** | Sin tarjeta, **archivos persistentes** (no borra disco al dormir), web app activo ~1 mes refrencado con un clic por email (~3 meses cada vez), 512 MB de disco, 1 dominio HTTPS. Descartados: **Render free** (borra el filesystem en cada spin-down), **Vercel Hobby** (prohíbe uso comercial y no persiste archivos), **Glitch** (limitado/no apto). |
| Escritura remota | **No; espejo de solo lectura** | No hay conflictos de sincronización, no se puede perder dinero por ediciones remotas y el único que escribe es la tienda. Simplicidad máxima. |
| Periodicidad | **5 minutos por defecto, configurable 60–3600 s** | Balance entre frescura de los datos y carga de red. |
| Seguridad del push | **Token aparte** (`SYNC_TOKEN`), **nunca el JWT** | Si se filtra, no permite operar el POS; solo actualizar el espejo. |
| Transporte | **HTTPS + gzip** | La BD (~280 KB) comprime a pocos KB. |
| Cómo se decide subir | **"Digest lógico" del contenido** | El hash de un snapshot SQLite no es estable entre copias de los mismos datos (los bytes se reordenan): se compara el hash del volcado SQL (estable si nada cambió) para no subir snapshots idénticos cada ciclo. |
| Detección de cambio | Forzar una re-subida | `force=True` sube aunque diga "sin cambios" (botón manual). |
| Swap en el host | **`os.replace()` atómico + reconexión** | Nunca queda la mitad: el archivo nuevo se valida (integridad + SHA) antes de reemplazar y se fuerza a la app a reabrir la conexión (`reset_connection()`). |
| App móvil | **Web (no APK)** en el mismo host, prefijo `/movil/` | Un solo dominio HTTPS para API + web; el mapping estático lo sirve nginx sin gastar worker. |
| Estado de la sync | Archivo `pos/.last_sync.json` (fuera de la BD) | Si el timestamp de estado viviera en la tabla `settings`, se subiría consigo mismo → el contenido cambia cada ciclo → reinicios infinitos. |

### Restricciones operativas clave
1. **El token en el POS vive en la BD (`settings`)**, nunca en git.
2. **El token en el host es una variable de entorno**, nunca en git.
3. **Nunca editar `server/static/data/` desde el host manualmente**: la BD del
   host solo se reemplaza vía `POST /api/sync/db`.
4. **Prefijo `/movil/` obligatorio**: un mapping en `/` robaría las rutas
   `/api/*` y el backend dejaría de responder.

---

## 4. Arquitectura

```
                      +------------------------------------------------------+
  TIENDA (POS)        |  HOST PythonAnywhere (free, SOLO LECTURA)            |
  Flask :5000         |                                                      |
                      |   https://<usuario>.pythonanywhere.com               |
  ┌─────────────────┐ |   ┌──────────────────────────────────────────────┐  |
  │ sales, ajustes, │ |   │ nginx (estático /movil/ = app Flutter web)  │  |
  │ productos ...   │ |   │       ▲                                   │  │
  │ (única escritura)│ |   │       │ /movil/                          │  │
  └────────┬────────┘ |   │  Flask (mismo server/) con POS_READONLY=1 │  |
           │          |   │  ├ GET  /api/*        → consultas (200)   │  |
           │ snapshot │   │  ├ POST /api/sync/db  → push desde tienda │  |
           │ + gzip   │   │  ├ POST /api/auth/*   → login/mobile       │  |
  sync-push│ Bearer   ▼   │  └ POST de VENTAS /…  → 403 (vedado)      │  |
  (daemon 5 min) ────────▶│        │                                   │  |
           │          |   └────────┼───────────────────────────────────┘ |
  ┌────────┴────────┐ |            ▼                                     |
  │ BD tienda pos.db│ |   pos.db (espejo, swap atómico desde el push)     |
  │ .last_sync.json │ |                                                  |
  │ .last_sync.sig  │ +---------------------------------------------------+
  └─────────────────┘
          ▲
          │                                      +----------------------+
   CELULAR (cualquier red):                       │ App Flutter web      |
   https://<usuario>.pythonanywhere.com/movil/ ───▶│ /movil/ + /api mismo─┘
                                                     origen
```

- **Un solo repositorio**, dos roles desde las variables de entorno:
  - Tienda: `POS_READONLY` vacío → escribe y además **sube** (`sync-push` thread).
  - Host: `POS_READONLY=1 POS_HOST=1` → solo lee, **redirige `/` → `/movil/`**.

---

## 5. Protocolo de sincronización

### Envío (tienda → host), `POST https://host/api/sync/db`
- Header: `Authorization: Bearer <SYNC_TOKEN>` (comparación de tiempo constante
  `hmac.compare_digest`; sin token → **401**).
- Body `multipart/form-data`:
  - `file = pos.db.gz` → snapshot SQLite (`sqlite3.backup`) **gzip** (el host
    tolera plano si llega sin comprimir).
  - `sha` = SHA256 del archivo descomprimido (detección de corrupción en tránsito).
- Respuestas:
  - `200` `{ok, sha, bytes, received}` → swap + migraciones ok.
  - `400` hash/estructura/integridad inválida.
  - `401` token malo.
  - `403` si el flag RO global interviniera (no debería: `/api/sync/db` está en
    la lista blanca).
- Flujo completo por ciclo (`run_sync`):
  1. Si `sync_enabled != 1` → `(False, 'Sincronización desactivada')`.
  2. Si falta host o token → mensaje de configuración.
  3. `digest = sha256(iterdump(BD))`; si coincide con `pos/.last_sync.sig` y no
     hay `force` → `(True, 'Sin cambios desde la última subida')` → **nada sube**.
  4. Snapshot temporal → gzip → POST con timeout 60 s.
  5. Éxito: guarda `digest` en `.sig` y estado en `.last_sync.json`.
  6. Fallo de red/HTTP: guarda el error en `.last_sync.json` y lo devuelve.

### Recepción (host), `routes/sync.py`
1. Autentica `SYNC_TOKEN` (env var del host ≠ token del JWT).
2. Lee, descomprime y comprueba `sha` (si viene).
3. Escribe a `pos.db.syncnew`, valida `PRAGMA integrity_check` = `ok`.
4. `os.replace(pos.db.syncnew → pos.db)` (**atómico**).
5. `app.config['DB'].reset_connection()` (la conexión cacheada aún mira el inode
   viejo) y borra `pos.db-wal`/`pos.db-shm`.
6. `init_db()` (migraciones + índices idempotentes sobre la BD nueva).

### Probe
- `GET /api/sync/ping` → `{ok: True, readonly: <bool>}`, sin auth; útil para
  diagnosticar desde el POS.

---

## 6. Componentes implementados

### Emisor (tienda) — `server/utils/sync_push.py`
- `run_sync(force=False)` → `(ok, mensaje)`; bactable manualmente (botón).
- `start_sync_thread()` → daemon `sync-push`, un solo arranque, ciclo según
  `_current_interval()` (60–3600 s). Se inicia en `__main__` de `app.py`.
- `_digest()`: sha256 sobre el volcado SQL (estable si el contenido no cambia).
- `_snapshot()`: `sqlite3.backup()` WAL-safe.
- Estado en `pos/.last_sync.{json,sig}` → no altera el contenido subido.

### Receptor (host) — `server/routes/sync.py`
- `POST /db` y `GET /ping` descritos en §5.

### Envoltorio de la app — `server/app.py`
- `POS_READONLY`/`POS_HOST` desde `server/config.py`.
- `_readonly_enforce()` (before_request): con `POS_READONLY=1`, GET/OPTIONS
  pasan; los POST de `_READONLY_FRONT` (`/api/sync/ping`, `/api/sync/db`,
  `/api/auth/login`, `/api/auth/validate`) pasan; **todo lo demás que escriba →
  403**.
- `_block_sensitive_paths()`: **403** a `/static/data/*`, `/backup/*` y cualquier
  `*.db|*.wal|*.shm` → la BD del host **no es descargable**.
- `GET /` con `POS_HOST=1` → `302 /movil/`.
- `app.config['DB']` compartida (la necesita el receptor para reconectar).

### Configuración y UI — `server/routes/settings.py` + `app.js` + `styles.css`
- `GET/POST /api/settings/sync` (login requerido; permiso `settings` view/edit).
  Guarda `sync_enabled`, `sync_host`, `sync_token`, `sync_interval`
  (clamp 60–3600 en el servidor) + valida que la URL empiece por http(s).
  El GET fusiona la configuración con el estado de `.last_sync.json`
  (`sync_last_ok/attempt/error/msg`).
- `POST /api/settings/sync/now` → `run_sync(force=True)` y devuelve `{ok, message}`.
- UI: **Ajustes → Sincronización** (toggle, URL, token, intervalo, "Sincronizar
  ahora", estado de la última subida).

### App móvil — `mobile/`
- `api_service.dart`: `_deriveBaseUrl()` — si la web se abre por **https/dominio
  remoto** usa el **mismo origen**; si se abre por IP LAN (puerto 8080 de
  pruebas) apunta a `:5000` de la tienda; `isCloudMode()`.
- `home_screen.dart`: en modo nube oculta la tarjeta **Ajustes de Inventario** y
  muestra aviso de solo lectura.
- `server_selector.dart`: hint del presupuesto PythonAnywhere.
- `pubspec.yaml`: versión 1.2.0+140.

---

## 7. Requerimientos (todo lo que se necesita)

### 7.1 Del host (PythonAnywhere free)
| Requisito | Detalle |
|---|---|
| Cuenta free | Usuario `<usuario>` → dominio propio `https://<usuario>.pythonanywhere.com`. |
| Python | 3.12 en el web app (Manual configuration). |
| Código servidor | Clonar el repo público (git clone) en el home del sitio. |
| Dependencias | `pip install -r server/requirements.txt` (Flask 3.1.3, CORS 6.0.5, Flask-Login 0.6.3, JWT-Extended 4.5.3, Werkzeug 3.1.8, PyJWT 2.13.0, openpyxl 3.1.5, requests 2.32.4, waitress 3.0.2). |
| WSGI | Apunta al `app` de `server/app.py` (ver §9.x). |
| Env vars | `POS_READONLY=1`, `POS_HOST=1`, `SYNC_TOKEN=<largo>`, `PORT=5000`. |
| SDK móvil (build) | `mobile/build/web/` en `.../mobile/build/web` + mapping estático `/movil/`. |
| Disco | ~45 MB de repo+build en 512 MB libres. |
| Certificado HTTPS | Automático de PythonAnywhere. |
| BD de host | Se crea sola en `server/static/data/pos.db` (default) al primer push; protegida de descargas por `_block_sensitive_paths`. |

### 7.2 De la tienda (POS)
| Requisito | Detalle |
|---|---|
| Versión | 1.4.0 aplicada (Ajustes → Actualizaciones). |
| Servidor reachable a Internet | Para SUBIR → solo necesita **salida HTTPS** al host (no entrada). |
| Configuración | Ajustes → Sincronización: activar, `sync_host=https://<usuario>.pythonanywhere.com`, `sync_token` (el mismo del host), intervalo p.ej. 300 s, botón "Sincronizar ahora". |
| Disco local | ~1 KB extra por `pos/.last_sync.json` y `pos/.last_sync.sig`. |

### 7.3 Del desarrollador/duelo
| Requisito | Detalle |
|---|---|
| Cuenta PythonAnywhere | Crearla a mano (email real, es suya). |
| Flutter (para regenerar el build web) | `flutter build web --release`; subir `mobile/build/web` a PA. |
| Canal de upload al host | Files → subir `web.zip` y descomprimir en la consola (PA free no ofrece SFTP/SSH). |
| Acceso al repo | `git clone` público (sin credenciales) o API de GitHub. |
| Token | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` para `SYNC_TOKEN` (mismo en ambos extremos). |

### 7.4 Funcionales de negocio (críticas de no-regresión)
- ⚠️ **No vender sin turno**: la cadena `shift_required` (backend) y
  `blockUntilShiftOpen()` (frontend) **debe seguir intacta en la tienda**.
- El host, por ser RO, **nunca** abre turnos ni vende: no hereda ese flujo.

### 7.5 Seguridad
- `SYNC_TOKEN` = secreto aparte, largo, en env (host) / `settings` (tienda).
- Nunca commitear `.jwt_secret`, BD, `.fbk` ni `SYNC_TOKEN`.
- La BD subida contiene usuarios con hash PBKDF2: aceptable para consulta RO;
  no se sirve por HTTP (403 en `static/data`).

---

## 8. Límites y mantenimiento
- **Tamaño de subida**: máximo 64 MB descomprimidos (host).
  BD actual ≈ 280 KB → gzip ≈ unos KB; margen enorme.
- **Frescura**: como mucho el intervalo configurado de retraso en consultas.
- **Free web app se pausa** si no se entra ~1 mes y se renueva con el botón del
  correo (~3 meses). Recordatorio trimestral.
- **Cambios de esquema**: `run_migrations()` es aditivo/idempotente y se reaplica
  en el host al recibir la BD.
- **Redespliegue del build web**: manual, cuando cambie `mobile/`.
- **Posible mejora futura**: APK apuntando a la nube; redespliegue automático.

---

## 9. Despliegue paso a paso (operativo)

### 9.1 Crear la cuenta
1. `https://www.pythonanywhere.com` → **Sign up** → plan **FREE (Bash)**.
2. Anotar `<usuario>`; dominio = `https://<usuario>.pythonanywhere.com`.
3. Validar el correo y entrar.

### 9.2 Consola Bash (Dashboard → Consoles → New console → Bash)
```bash
cd
git clone https://github.com/alexisdelacruzsantos-cpu/pos-expendio-bb.git
cd pos-expendio-bb
python3 -m venv venv
source venv/bin/activate
pip install -r server/requirements.txt
```

### 9.3 Crear el web app
- **Web → Add a new web app → Next → Manual configuration → Python 3.12 → Next**.
- Esperar a que termine de crearse (si está "Coming Soon" aún no existía).

### 9.4 WSGI
- Editar `/var/www/<usuario>_pythonanywhere_com_wsgi.py` y dejar:
```python
import sys
sys.path.insert(0, '/home/<usuario>/pos-expendio-bb/server')
from app import app as application
```
- **Save**.

### 9.5 Variables de entorno (Web → tu app → Environmental variables)
```
POS_READONLY=1
POS_HOST=1
SYNC_TOKEN=<generado>
PORT=5000
```
- **Save** y **Reload**.

### 9.6 Verificación básica del backend
(se puede hacer del lado de acá con `curl`)
```
https://<usuario>.pythonanywhere.com/api/health        → {"db":"pos.db","status":"ok"...}
https://<usuario>.pythonanywhere.com/api/sync/ping     → {"ok":true,"readonly":true}
```

### 9.7 Subir la app web Flutter
- Local: `cd mobile && flutter build web --release` y comprimir:
  `cd build && zip -r web.zip web` (≈14 MB, ya generado en
  `/home/alexis/POS-EXPENDIO-BB/mobile/build/web.zip`).
- **Files → Upload** subir `web.zip` al home del sitio; en la consola:
```bash
cd ~ && unzip web.zip -d pos-expendio-bb/mobile/build/web_tmp && \
rm -rf pos-expendio-bb/mobile/build/web && \
mv pos-expendio-bb/mobile/build/web_tmp/web pos-expendio-bb/mobile/build/web
```

### 9.8 Mapping estático /movil/
- **Web → tu app → Static files → Add**:
  - URL: `/movil/`
  - Directory: `/home/<usuario>/pos-expendio-bb/mobile/build/web`
- **Reload**.

### 9.9 Verificación global
- `https://<usuario>.pythonanywhere.com/movil/` carga la app.
- `https://<usuario>.pythonanywhere.com/` redirige a `/movil/`.
- `GET /api/products` con JWT → responde (cuando haya datos).
- `POST /api/sales/` → **403** (solo lectura).
- `GET /static/data/pos.db` → **403** (no descargable).

### 9.10 Activar en la tienda (cuando se aplique 1.4.0 en el local)
1. Ajustes → Actualizaciones → Aplicar 1.4.0.
2. Ajustes → Sincronización: activar, `sync_host`, `sync_token`, intervalo.
3. **Sincronizar ahora** → status "Subida exitosa (SHA …)".
4. Abrir en el celular `https://<usuario>.pythonanywhere.com/movil/` y entrar
   (login con usuario que viaje en la BD).

### 9.11 Renovación trimestral
- PA free envía un correo con un botón "Run until …" (~1 vez al mes pide
  iniciar sesión y extiende ~3 meses). Es un recordatorio de calendario.

---

## 10. Matriz de pruebas (verificación técnica)

| Prueba | Método | Esperado |
|---|---|---|
| Health tienda y host | `GET /api/health` | `{"status":"ok"}` |
| Push con datos | `POST /settings/sync` + `POST /settings/sync/now` (tienda) | `ok:true`, host gana los productos |
| Sin cambios | segundo `run_sync()` | "Sin cambios desde la última subida" |
| Cambio real | editar un producto → `run_sync()` | sube de nuevo |
| Swap atómico | host acepta la BD e integridad | `GET /products` del host devuelve los datos nuevos |
| RO host | `POST /api/sales/`, `/api/adjustments/` | **403** |
| Login host | `POST /api/auth/login` (BD subida) | 200 y JWT |
| Token inválido | push con token malo | **401** |
| BD no descargable | `GET /static/data/pos.db` | **403** |
| Raíz host | `GET /` con `POS_HOST=1` | 302 → `/movil/` |
| Estado UI | `GET /settings/sync` tras sincronizar | `sync_last_ok/msg` poblados |
| Migraciones post-swap | BD vieja sin columnas nuevas | `init_db()` las añade (idempotente) |

*Ejecutadas localmente (tienda :5001 / host :5002) en pre-release: todas OK.*

---

## 11. Documentos relacionados
- `NOTAS_FASE6.md` — app móvil Flutter y auto-detección de servidor.
- `NOTAS_FASE7.md` — puente de despliegue resumido en PythonAnywhere.
- `PROCESO_RELEASE.md` — flujo de publicación (bump + commit `release` + push).
- `AGENTS.md` — convenciones del repo (verificaciones pre-commit, reglas).
- `README.md` — instalación y arquitectura general.