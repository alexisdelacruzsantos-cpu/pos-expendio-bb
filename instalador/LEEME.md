# LEEME - Instalador POS EXPENDIO BB (Windows, 100% offline desde USB)

## Qué es

Un instalador gráfico (`InstaladorPOS.exe`, un solo archivo) que despliega el
sistema de Punto de Venta en la PC real de la tienda **sin internet**, replicando
exactamente la secuencia validada en la VM de Windows 8.1 (`NOTAS_DESPLIEGUE.md`):

1. **UCRT / VC++ Redistributable** si falta `api-ms-win-crt-*` (Windows 8.1).
2. **Python 3.9.13** (la única versión que instala y corre en Windows 8.1).
3. Extrae el **repositorio completo** (`pos-expendio-bb.zip`) a `C:\POS\pos-expendio-bb`.
4. Crea **venv** e instala las dependencias **offline** desde `wheels/`.
5. **Firefox 115 ESR** (IE11 no soporta el login del sistema).
6. **Auto-logon** opcional (arranca solo al encender la PC).
7. Tarea **ONLOGON "POS Expendio BB"** → `iniciar_silencioso.bat`.
8. **Verificación**: arranca el servidor, comprueba `/api/health` y login `admin/admin123`.

Al terminar, la PC queda encendida → inicia sesión sola → arranca el servidor → se
abre Firefox con el POS en `http://127.0.0.1:5000`.

---

## Estructura de la carpeta

```
instalador/
├── installer.py            # Guión del instalador (tkinter, no requiere nada más)
├── build_exe.bat           # Compila installer.py a InstaladorPOS.exe (en la VM)
├── LEEME.md                # Este archivo
└── assets/                 # Se incrusta dentro del .exe (--add-data)
    ├── vc_redist.x64.exe       # VC++ 2015-2019 (incluye UCRT)
    ├── python-3.9.13-amd64.exe # Python 3.9 (32/64)
    ├── firefox_setup.exe       # Firefox 115 ESR (win64, es)
    ├── pos-expendio-bb.zip     # Código del sistema (sin venv, sin BD, sin .git)
    └── wheels/                 # 20 wheels para pip --no-index (offline)
```

---

## Cómo COMPILAR el .exe (en la VM Windows de prueba)

PyInstaller **no compila de Linux a Windows**, así que se compila en la VM:

1. Arranca la VM Windows 8.1 (`vboxmanage startvm ...`).
2. Copia la carpeta `instalador/` a la VM por la carpeta compartida:
   - En el host: `cp -r /home/alexis/POS-EXPENDIO-BB/instalador /home/alexis/Shared/`
   - En la VM: `Z:` → `instalador/`.
3. En la VM, con **doble clic** en `instalador\build_exe.bat`.
   - Usa el Python 3.9 ya instalado en la VM; si falta PyInstaller lo instala
     (es el único paso que pide internet, solo en la máquina de compilación).
4. Queda `instalador\dist\InstaladorPOS.exe` (un único archivo autocontenido).

> Alternativa si prefieres no instalar PyInstaller: en la VM
> `Z:\instalador\` ya existe `installer.py`. Puedes copiarlo junto con `assets\`
> y ejecutarlo con `python installer.py` (doble clic). No es un .exe, pero
> funciona igual si Python está instalado.

---

## Cómo INSTALAR en la PC real de la tienda (offline / USB)

1. Copia **solo** `InstaladorPOS.exe` a un USB (no hace falta nada más: todo va
   incrustado dentro).
2. En la PC de la tienda, doble clic en `InstaladorPOS.exe` (Windows 8.1 o 10 x64).
3. Si hay UAC, pulsa **Sí**.
4. Configuración:
   - **Carpeta destino**: dejar `C:\POS\pos-expendio-bb` (sin espacios).
   - **Firefox 115 ESR**: dejar marcado la primera vez.
   - **Auto-logon**: opcional. Si se marca, escribir el usuario y contraseña de
     Windows de la PC para que arranque sola.
5. Pulsa **Iniciar instalación** y espera (5–10 min, la barra avanza los 8 pasos).
6. Al final verás _Instalación completada_. En `C:\POS\pos-expendio-bb\pos\logs\servidor.log`
   queda el registro del servidor.

Con el equipo encendido: se enciende solo → login automático (si se configuró) →
tarea ONLOGON levanta el servidor → Firefox se abre en el POS.

**Credenciales de entrada al sistema POS:** `admin` / `admin123` (se cambia luego
desde el módulo de configuración si se desea).

---

## Uso del repo ya extraído (sin reinstalar todo)

Si solo se quiere arrancar el servidor en una PC que ya fue instalada:

- `C:\POS\pos-expendio-bb\server\start_pos.bat` — consola manual (con ventana y `pause`).
- La tarea programada "POS Expendio BB" (ONLOGON) llama al launcher silencioso
  `C:\POS\iniciar_silencioso.bat` (sin ventana).

---

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `python-3.9.13-amd64.exe` falla `0x80070643` | Instalar antes el VC++ Redistributable **(_esto lo hace el paso 1_)**. |
| pip: "No matching distribution found" | No usar internet: los wheels de `assets\wheels` cubren todo el `requirements.txt` (verificado con `pip install --dry-run --no-index --find-links wheels`). |
| El botón Iniciar Sesión "no hace nada" | El navegador es IE11 → el paso 5 instala Firefox 115 ESR. No usar Google Chrome (no soporta Windows 8.1). |
| `schtasks ONLOGON` → "Access is denied" | Falta elevación. El instalador se relanza con UAC automáticamente. |
| La tarea ONLOGON queda en "Running" sin servidor | Se apuntó a `start_pos.bat` (con `pause`). La tarea debe apuntar a `iniciar_silencioso.bat` (sin `pause`) — es lo que hace el paso 7. |
| Auto-logon no funciona al prender | Verificar `reg query "HKLM\...\Winlogon" /v AutoAdminLogon` → debe ser `1`, y en el instalador debe marcarse la casilla y escribir el usuario/dominio/contraseña correctos. |

Detalles completos de cada incidente en `NOTAS_DESPLIEGUE.md` (raíz del repo).