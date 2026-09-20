# NOTAS_FASE7.md - Sincronización en la nube (app móvil + host gratuito)

> **Propósito:** Documentar la Fase 7: cómo el POS sube una copia de **solo
> lectura** de su base a un host gratuito (PythonAnywhere) y cómo la app móvil
> (Flutter web) se consulta desde el celular sin depender de la red de la tienda.
>
> **Estado:** implementado (release 1.4.0) y listo para desplegar el host.

---

## Arquitectura

```
TIENDA (POS:5000)                     HOST PythonAnywhere (free, solo lectura)
  · vende / ajusta (única escritura)   · misma app Flask con POS_READONLY=1
  · cada 5 min (configurable):          · POST /api/sync/db (token) -> swap atómico
      snapshot WAL-safe + gzip           · GET /api/* consulta para el móvil
      + solo si el contenido cambió      · /movil/* sirve la app Flutter (build web)
                     ▼                          ▲
CELULAR: https://<usuario>.pythonanywhere.com/movil/  → mis /api al mismo origen
```

Decisión clave: el host es un **espejo de solo lectura**. La única escritura que
acepta es el push de la BD desde la tienda (autenticado con un token aparte).
Las ventas y los ajustes de inventario se siguen haciendo únicamente en la tienda.

## Cómo funciona la subida (lado tienda)

- Thread daemon `sync-push` arranca con el servidor (`utils/sync_push.py`).
- Cada ciclo (por defecto **300 s**, mínimo 60):
  1. Lee la configuración de la tabla `settings` (`sync_enabled`, `sync_host`,
     `sync_token`, `sync_interval`).
  2. Calcula un **digest lógico** del contenido (`iterdump` de SQLite). Si no
     cambió desde el último envío, no sube nada.
  3. Toma un **snapshot WAL-safe** (`sqlite3.backup()`), lo comprime en gzip y
     hace `POST /api/sync/db` con `Authorization: Bearer <token>`.
  4. Guarda el resultado en `pos/.last_sync.json` (fuera de la BD, para no crear
     un bucle de subidas por el propio timestamp de estado).
- Configuración y estado en **Ajustes → Sincronización** del POS (URL del host,
  token, intervalo, toggle, botón "Sincronizar ahora", último resultado).

## Cómo recibe el host (lado host)

- `POST /api/sync/db` (`routes/sync.py`): valida el token (`SYNC_TOKEN` de
  entorno, comparación constante), descomprime, comprueba `integrity_check`,
  reemplaza la BD con `os.replace()` (swap atómico), reconecta la BD
  (`Database.reset_connection()`) y reaplica migraciones/índices.
- Con `POS_READONLY=1`, `app.py` rechaza toda escritura salvo:
  - `POST /api/auth/login`, `POST /api/auth/validate` (necesarios para el login
    del móvil),
  - `POST /api/sync/db`, `GET /api/sync/ping`.
  Todo lo demás no-GET responde **403**. Así, ni la app ni un tercero pueden
  alterar el espejo.
- El `GET /` con `POS_HOST=1` redirige a `/movil/` (la app), que en PythonAnywhere
  se sirve como archivo estático por nginx (no consume el worker).
- La BD **no es descargable**: el blindaje de `app.py` (`_block_sensitive_paths`)
  bloquea `/static/data/*`, `/backup/*` y cualquier `*.db/.wal/.shm`.

## Cómo consulta la app móvil

- `ApiService._deriveBaseUrl()`: si la app web se abre por **https/dominio
  remoto**, usa el **mismo origen** (`https://cuenta.pythonanywhere.com/api`);
  si se abre por IP de LAN (puerto 8080 de pruebas), apunta a `:5000` de la
  tienda. El selector de servidor sigue disponible.
- En modo nube (`isCloudMode()`), la pantalla de inicio **oculta "Ajustes de
  Inventario"** y muestra un aviso de solo lectura. Reportes, historial y
  productos funcionan igual (es la misma API).

---

## Despliegue del host en PythonAnywhere (gratis, sin tarjeta)

### 1. Crear la cuenta
- Crear cuenta free en <https://www.pythonanywhere.com/>, anotar tu usuario
  `<usuario>`. Tu dominio será `https://<usuario>.pythonanywhere.com`.

### 2. Clonar el repo y preparar el entorno (consola Bash del sitio)
```bash
git clone https://github.com/alexisdelacruzsantos-cpu/pos-expendio-bb.git
cd pos-expendio-bb
python3 -m venv venv
source venv/bin/activate
pip install -r server/requirements.txt
```

### 3. Filesystem del sitio
Estructura resultante (la API será la app Flask, la BD vivirá por defecto en
`server/static/data/pos.db`, protegida):
```
/home/<usuario>/pos-expendio-bb/
├── server/                      # la app Flask (leer /api)
├── mobile/build/web/            # la app Flutter (se sube aparte)
└── venv/
```

### 4. WSGI
En la página **Web** del sitio crear un web app tipo *Manual config* con Python
3.x y apuntar el WSGI a:
```python
import sys
sys.path.insert(0, '/home/<usuario>/pos-expendio-bb/server')
from app import app as application
```

### 5. Variables de entorno (pestaña Web → Environmental variables)
```
POS_READONLY=1
POS_HOST=1
SYNC_TOKEN=<token FÁCIL de adivinar NO; usa uno largo>
PORT=5000
```
El `SYNC_TOKEN` debe ser **el mismo** que se configure en la tienda
(Ajustes → Sincronización). Generar uno:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 6. Subir la app móvil (build web)
En tu máquina de desarrollo (donde está Flutter):
```bash
export PATH="/home/alexis/.flutter-sdk/bin:$PATH"
cd mobile && flutter build web --release
```
Comprimir y subir `mobile/build/web` al sitio (Files → Upload de un zip, y en la
consola `unzip`; o arrastrar la carpeta). Debe quedar en:
`/home/<usuario>/pos-expendio-bb/mobile/build/web/`.

En **Web → Static files** agregar un mapping:
- URL: `/movil/`
- Path: `/home/<usuario>/pos-expendio-bb/mobile/build/web`

> ⚠️ El prefijo `/movil/` es obligatorio: un mapping en `/` robaría las rutas
> `/api/*` y el backend nunca las vería.

### 7. Verificar
- `https://<usuario>.pythonanywhere.com/api/health` → `{"status":"ok",...}`.
- `https://<usuario>.pythonanywhere.com/movil/` → carga la app Flutter.
- Login con un usuario que viaje en la BD subida (ej. `admin`/`admin123`) y
  consultar productos/historial → funciona.
- `POST https://<usuario>.pythonanywhere.com/api/sales/` → **403**.
- `https://<usuario>.pythonanywhere.com/static/data/pos.db` → **403**.

### 8. Renovación trimestral (free)
PythonAnywhere free **pausa el web app** si no se ingresa por un tiempo (~1 mes)
y envía un correo con un botón "Run until ..." que extiende la actividad
(~3 meses). Para un POS de tienda esto es un recordatorio cada trimestre.

### 9. Puesta en marcha en la tienda (lado POS)
1. Aplicar la versión 1.4.0 (Ajustes → Actualizaciones → Buscar → Aplicar).
2. Ajustes → **Sincronización**: activar, escribir la URL
   `https://<usuario>.pythonanywhere.com`, el mismo `SYNC_TOKEN`, intervalo 300.
3. Pulsar **Sincronizar ahora** y verificar que el status indica "Subida exitosa".
4. Desde el celular abrir `https://<usuario>.pythonanywhere.com/movil/` y entrar.

### 10. Redespliegue de la app cuando cambie `mobile/`
- En tu máquina: `flutter build web --release`, subir de nuevo `build/web` a PA.
- El backend (server/) llega a PA con el git clone/pull manual, SIEMPRE que haya
  quedado en **1.4.0**; los builders de PA free no existen, así que el
  despliegue es manual y poco frecuente.

---

## Seguridad y límites

- `SYNC_TOKEN` es un secreto aparte: **nunca** el JWT. Vive en `settings` (BD,
  fuera de git) en la tienda y en las variables de entorno del host.
- La BD subida contiene los usuarios administradores con su hash de contraseña.
  Es aceptable para este esquema; el archivo no se sirve por HTTP y el host solo
  acepta el push con token.
- La subida transmite la BD **comprimida** por HTTPS.
- El host **no recibe** el `.jwt_secret` local (cada instancia genera el suyo);
  el login en el host valida contra los usuarios de la BD subida.
- Tamaño: la BD actual mide ~280 KB (gzip ≈ unos KB). El host admite hasta
  64 MB descomprimidos por subida. Un cambio de esquema con `run_migrations()`
  es aditivo e idempotente y se reaplica en el host al llegar la BD.
- Descartado para este modelo: **Render free borra el filesystem en cada
  spin-down**; **Vercel Hobby prohíbe uso comercial** y no persiste archivos.

## Pendiente / opcional
- [ ] APK de la app apuntando a la nube (fuera de este alcance; solo web).
- [ ] Redespliegue automático del `build/web` tras cada release de `mobile/`
      (hoy manual).