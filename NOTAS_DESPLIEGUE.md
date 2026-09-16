# NOTAS_DESPLIEGUE.md - Errores y soluciones del despliegue en Windows 8.1 (tienda)

> **Propósito:** Documentar los problemas reales encontrados al instalar el POS en la
> VM/tarjeta de pruebas Windows 8.1, con sus soluciones. Si algo se repite en otra PC
> de la tienda, aquí se resuelve sin volver a debuggear desde cero.
>
> **Fecha instalación:** 10-11/09/2026
> **Entorno:** Windows 8.1 x64, VM VirtualBox, cuenta `pcpruebas` (Administradores)
> **Resultado final:** servidor waitress en `http://127.0.0.1:5000`, auto-logon,
> arranque automático "POS Expendio BB" al iniciar sesión, health y login OK.

---

## Índice de errores

| # | Error | Síntoma | Solución |
|---|-------|---------|----------|
| 1 | UCRT ausente en Windows 8.1 | Instalador de Python falla `0x80070643` en `ucrt_JustForMe` | Instalar VC++ Redistributable (incluye UCRT) antes que Python |
| 2 | `requirements.txt` incompatible con Py 3.9 | pip: "No matching distribution found" para JWT y requests | Bajar Flask-JWT-Extended a 4.5.3 y requests a 2.32.4 |
| 3 | `openpyxl` faltaba | `ModuleNotFoundError: No module named 'openpyxl'` en `routes/imports.py` | Agregar `openpyxl==3.1.5` a requirements |
| 4 | IE11 no soporta el login | Botón "Iniciar Sesión" no hace nada | Instalar Firefox 115 ESR (IE11 no soporta `fetch`/`async`) |
| 5 | schtasks ONLOGON requiere admin | `schtasks /Create ... ONLOGON` → "Access is denied" | Usar `Start-Process -Verb RunAs` (clic en UAC) |
| 6 | `start_pos.bat` se cuelga como tarea | Tarea ONLOGON "Running" sin servidor | Crear `iniciar_silencioso.bat` (sin `pause`) y apuntar la tarea a él |
| 7 | Auto-logon | La PC pedía usuario/contraseña al encender | `AutoAdminLogon=1` en HKLM\...\Winlogon |

---

## 1. UCRT (Universal C Runtime) ausente → Python no instala

**Síntoma:** el instalador de Python 3.9.13 fallaba al instalar el paquete
`ucrt_JustForMe` (Universal CRT) con:

```
Error 0x80070643: Failed to install MSI package
Exit code: 0x643
```

**Causa:** Windows 8.1 no trae los DLL de la Universal CRT
(`api-ms-win-crt-runtime-l1-1-0.dll` y similares) como Windows 10+. Sin ellos,
el instalador de Python (que los incluye como paquete MSI `ucrt_JustForMe`) no
puede instalarlos. En el equipo faltaba KB2999226 y el servicio `msiserver`
estaba detenido.

**Solución (funcionó):**
1. Descargar e instalar el **VC++ Redistributable** de Visual Studio 2015-2019,
   que incluye la UCRT:
   - URL: `https://aka.ms/vs/16/release/vc_redist.x64.exe` (≈25 MB)
   - Instalación silenciosa: `vc_redist.x64.exe /install /quiet /norestart`
   - Verificar: `dir C:\Windows\System32\api-ms-win-crt-runtime-l1-1-0.dll` debe existir.
2. Reintentar el instalador de Python.

**Nota:** el MSI service arranca solo cuando hace falta; no es necesario tocar `msiserver`.

---

## 2. requirements.txt pedía Python 3.10+ (no corre en 8.1)

**Síntoma:** `pip install -r requirements.txt` dentro del venv (Python 3.9)
fallaba de golpe (sin instalar nada):
```
ERROR: No matching distribution found for Flask-JWT-Extended==4.7.4
```

**Causa:** el pin `Flask-JWT-Extended==4.7.4` exige Python >=3.10, pero Windows 8.1
solo acepta Python 3.9 (3.10+ no instala ni corre en 8.1). Igual con `requests 2.34.2`
(>=3.10).

**Solución (verificada en PyPI):**
- `Flask-JWT-Extended==4.5.4` **no existe en PyPI (retirada, 0 archivos)** → la última
  disponible que soporta 3.7-3.9 es **`4.5.3`** (`requires_python >=3.7,<4`).
- `requests==2.32.4` (soporta >=3.8).
- La API de JWT que usa la app es idéntica entre 4.5.x y 4.7.x
  (`create_access_token`, `jwt_required`, `get_jwt`, `get_jwt_identity`,
  `verify_jwt_in_request`).

Commit aplicado: `aa0ea62` ("Compatibilidad dependencias con Python 3.9").

---

## 3. openpyxl faltaba en requirements

**Síntoma:** al arrancar, `app.py` moría en el import:
```
  File "C:\POS\pos-expendio-bb\server\routes\imports.py", line 12
    from openpyxl import Workbook, load_workbook
ModuleNotFoundError: No module named 'openpyxl'
```

**Causa:** `routes/imports.py` (módulo de importación de productos por Excel) importa
`openpyxl` pero el paquete no estaba en `requirements.txt` → el servidor ni siquiera
levantaba.

**Solución:** agregar `openpyxl==3.1.5` (soporta Python >=3.8) a `requirements.txt`
en el commit `aa0ea62`. Al instalar de nuevo el requirements, `app.py` arranca.

---

## 4. IE11 no soporta el login (botón "no hace nada")

**Síntoma:** con el navegador por defecto de Windows 8.1 (Internet Explorer 11), la
página de login se veía bien, pero al hacer clic en "Iniciar Sesión" **no pasaba nada**
y el botón quedaba en "Iniciando sesión...".

**Causa:** el JS del login en `server/templates/index.html` usa
`fetch()`, `async/await` y arrow functions, que **IE11 no soporta**. Al pulsar,
el `addEventListener` lanzaba un error silencioso (`fetch is not defined`).

**Solución:** instalar un navegador moderno. Detalles importantes:
- **Chrome NO sirve**: desde 2023 dejó de soportar Windows 8.1 (el instalador actual
  no corre en 8.1).
- **Firefox 115 ESR** es la última familia que soporta 8.1 (con actualizaciones de
  seguridad). Descarga: `https://download.mozilla.org/?product=firefox-115.20.0esr-ssl&os=win64&lang=es-ES`
- Instalación silenciosa (NSIS): `firefox_setup.exe /S`
- Ruta: `C:\Program Files\Mozilla Firefox\firefox.exe` (se abre `firefox.exe http://127.0.0.1:5000`)

**Recomendación para la tienda:** instalar Firefox 115 ESR en la PC física real del
POS (no depender de IE).

---

## 5. guestcontrol/schtasks no puede elevar (UAC) — automatización

**Síntoma:** cuando se automatiza vía `VBoxManage guestcontrol` (o `schtasks` desde
esa sesión), las operaciones que requieren admin fallan con "Access is denied":
- `schtasks /Create /SC ONLOGON ...` (arranque al iniciar sesión)
- habilitar la cuenta `Administrator` (`net user Administrator /active:yes`)
- escribir claves en `HKLM` (ej. el auto-logon)

**Causa:** guestcontrol abre una sesión **no elevada** (UAC activo,
`ConsentPromptBehaviorAdmin=5`), aunque la cuenta sea de "Administradores".

**Solución usada:** lanzar el bat con **elevación interactiva** desde la sesión visible
de la VM, y que el operador haga un clic en el diálogo UAC:
```
start "" powershell -Command "Start-Process -FilePath 'C:\POS\mi_tarea.bat' -Verb RunAs -Wait"
```
- Las tareas `/SC ONCE` (instalaciones) funcionan sin elevar con `/RU <user> /IT`.
- Las tareas `/SC ONLOGON`, `/RU SYSTEM` y `/RL HIGHEST` NO se pueden crear sin elevar.

---

## 6. start_pos.bat se cuelga como tarea de autoarranque

**Síntoma:** la tarea ONLOGON "POS Expendio BB" quedaba en estado **"Running"** para
siempre, sin servidor y con `servidor.log` vacío.

**Causa:** la tarea apuntaba a `server/start_pos.bat`, que está pensado para
**consola manual** (termina en `pause` y abre navegador). Como tarea programada, el
`pause` bloquea el hilo y el servidor nunca termina de levantarse bien.

**Solución:** crear un launcher silencioso `iniciar_silencioso.bat` sin `pause`, que
corre Python directo y apunta la tarea ONLOGON a él:
```bat
@echo off
cd /d C:\POS\pos-expendio-bb\server
set PORT=5000
start /b cmd /c "ping -n 4 127.0.0.1 >nul & \"C:\Program Files\Mozilla Firefox\firefox.exe\" http://127.0.0.1:5000"
"C:\POS\pos-expendio-bb\venv\Scripts\python.exe" app.py >> "C:\POS\pos-expendio-bb\pos\logs\servidor.log" 2>&1
```
Y fijar la tarea:
```
schtasks /Create /TN "POS Expendio BB" /TR C:\POS\iniciar_silencioso.bat /SC ONLOGON /RL LIMITED /F
```
(este paso requiere elevación, ver #5)

---

## 7. Auto-logon (encender la PC y que entre solo)

Para que al prender la PC de la tienda arranque la sesión y el servidor sin teclear
nada, se configuró el registro Winlogon (requiere elevación, ver #5):

```
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon   /t REG_SZ /d 1 /f
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultUserName  /t REG_SZ /d pcpruebas /f
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultDomainName /t REG_SZ /d PRUEBAS /f
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultPassword  /t REG_SZ /d <clave> /f
```

> **Seguridad:** la contraseña queda en el registro como texto plano. En una máquina
> de tienda expuesta al público, evaluar si vale la pena (o usar usuario sin permisos
> de admin). Verificar con:
> `reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon`

---

## 8. Modo kiosko: ESC/F11 no deben salir de pantalla completa

**Problema:** con la Fullscreen API (`element.requestFullscreen()`), ESC sale de
pantalla completa. **No existe `about:config` que lo evite**: `browser.fullscreen.exit_on_escape`
solo aplica al fullscreen del navegador (F11 / pantalla nativa), **no** a la API web.
Firefox sí respeta `event.preventDefault()` en el `keydown` de ESC, pero si por algo se
escapa, reentrar es imposible porque ESC no cuenta como gesto de usuario (el navegador
rechaza el `requestFullscreen()`).

**Solución de raíz:** abrir Firefox en **modo kiosko**, donde ESC y F11 no salen de
pantalla completa (solo `Alt+F4` cierra la ventana). La app detecta `?kiosk=1` y deja de
usar la Fullscreen API (`KIOSK_MODE` en `server/static/js/app.js`), así ESC solo cierra
los menús (Resultados de búsqueda, historial, lote, etc.).

Lanzador incluido en el repo: `server/iniciar_kiosko.bat` (sin `pause`, para la tarea
ONLOGON). Apuntar la tarea a él:
```
schtasks /Create /TN "POS Expendio BB" /TR C:\POS\pos-expendio-bb\server\iniciar_kiosko.bat /SC ONLOGON /RL LIMITED /F
```
(requiere elevación, ver #5). Si ya existía `C:\POS\iniciar_silencioso.bat`, basta con
reemplazar su contenido por el de `server/iniciar_kiosko.bat`.

- Para volver al fullscreen de la API (sin kiosko, p. ej. para pruebas) abrir
  `http://127.0.0.1:5000/?kiosk=0`.
- En modo kiosko la única salida es `Alt+F4` (o Task Manager).

---

## Notas de la VM de prueba (usadas durante el despliegue)

- VM: `Windows 8.1`, carpeta compartida `compartida` = `/home/alexis/Shared` → `Z:` en el guest.
- Instalación: repo en `C:\POS\pos-expendio-bb`, venv en `C:\POS\pos-expendio-bb\venv`.
- **BD real = `C:\POS\pos-expendio-bb\server\static\data\pos.db`** (NO `pos\pos.db`,
  que es un archivo vacío/placeholder). Está vacía de productos por ahora (8 categorías).
- Backup automático: `pos\backup\pos_auto_*.db` (cada 24 h) y `pos_shutdown_*` al apagar.
- Estado al final: auto-logon OK, tarea "POS Expendio BB" activa, waitress en :5000,
  health `200`, login `200` con `admin/admin123`.
- Los instaladores `instalar_vm.bat`/`instalar_vm.ps1` **no cubren** los pasos 1, 4, 6 y 7
  (UCRT, Firefox, launcher silencioso, auto-logon). Si se va a reutilizar el instalador
  automático, hay que integrar estos pasos (ver secciones anteriores y el commit de
  instalar_vm).