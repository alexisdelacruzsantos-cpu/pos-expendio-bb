@echo off
REM ===========================================================
REM  POS EXPENDIO BB - Instalacion para Windows 8.1/10/11
REM  Crea el entorno virtual, instala dependencias y registra
REM  el arranque automatico del servidor al iniciar sesion.
REM  Ejecutar como Administrador (clic derecho > Ejecutar como
REM  administrador) desde la carpeta server.
REM ===========================================================
setlocal
cd /d "%~dp0"
echo.
echo ==========================================
echo  POS EXPENDIO BB - Instalacion del servidor
echo ==========================================
echo.

echo [1/4] Creando entorno virtual si no existe...
if exist "..\venv\Scripts\python.exe" (
    echo       El venv ya existe, se reutilizara.
) else (
    python -m venv ..\venv
    if errorlevel 1 (
        echo  ERROR: no se pudo crear el venv. Asegurate de tener Python instalado.
        pause
        exit /b 1
    )
    echo       venv creado.
)

echo [2/4] Instalando dependencias...
"..\venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>&1
"..\venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo  ERROR: fallo la instalacion de dependencias.
    pause
    exit /b 1
)

echo [3/4] Registrando arranque automatico al iniciar sesion...
schtasks /Create /TN "POS Expendio BB" /TR "\"%~dp0start_pos.bat\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
    echo  ADVERTENCIA: no se pudo registrar la tarea. Ejecuta este archivo
    echo  como Administrador, o inicia el servidor manualmente con start_pos.bat
) else (
    echo       Tarea registrada: "POS Expendio BB" (se inicia al iniciar sesion).
)

echo [4/4] Verificando instalacion...
"..\venv\Scripts\python.exe" -c "import flask, waitress, jwt; print('OK: flask + waitress + jwt')"
if errorlevel 1 (
    echo  ADVERTENCIA: la verificacion de imports fallo.
)

echo.
echo ==========================================
echo  Instalacion completada.
echo  El servidor se iniciara al iniciar sesion en Windows.
echo  Para iniciarlo ahora:  haz doble clic en start_pos.bat
echo  Para quitar el arranque automatico:  quitar_autoinicio.bat
echo ==========================================
echo.
pause