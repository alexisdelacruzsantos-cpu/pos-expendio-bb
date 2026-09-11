@echo off
REM ===================================
REM  POS EXPENDIO BB - Inicio
REM  Ejecutar siempre desde esta carpeta.
REM  No requiere Python en el PATH si el venv ya existe.
REM ===================================
setlocal
cd /d "%~dp0"
title POS EXPENDIO BB

if not exist "..\venv\Scripts\python.exe" (
    echo [POS] Entorno virtual no encontrado. Revisa el README o ejecuta instalar_servidor.bat
    pause
    exit /b 1
)

set "LOG=..\pos\logs\servidor.log"
if not exist "..\pos\logs" mkdir "..\pos\logs"

echo ===================================
echo  POS EXPENDIO BB - Servidor principal
echo ===================================
echo  URL:  http://localhost:5000
echo  Log:  %LOG%
echo  Cierra esta ventana o presiona Ctrl+C para detener.
echo ===================================
echo.

REM Abre el navegador en cuanto el servidor apunte
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:5000"

"..\venv\Scripts\python.exe" app.py 1>>"%LOG%" 2>&1

echo.
echo Servidor detenido.
pause