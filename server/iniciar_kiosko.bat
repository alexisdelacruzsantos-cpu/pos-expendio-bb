@echo off
REM =====================================================
REM  POS EXPENDIO BB - Arranque automatico en modo kiosko
REM  Sin consola. Pensado para la tarea programada ONLOGON.
REM  Abre Firefox con -kiosk: pantalla completa que ESC y
REM  F11 NO pueden quitar (solo Alt+F4 cierra la ventana).
REM =====================================================
cd /d "%~dp0"

set "LOG=..\pos\logs\servidor.log"
if not exist "..\pos\logs" mkdir "..\pos\logs"

if not exist "..\venv\Scripts\python.exe" (
    echo [POS] Entorno virtual no encontrado. Ejecuta instalar_servidor.bat
    pause
    exit /b 1
)

REM El navegador se abre 3 s despues para dar tiempo a que el servidor levante.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$p1=$env:ProgramFiles+'\Mozilla Firefox\firefox.exe'; $p2=${env:ProgramFiles(x86)}+'\Mozilla Firefox\firefox.exe'; $ff=@($p1,$p2)|?{Test-Path $_}|Select -First 1; Start-Sleep -Seconds 3; if($ff){Start-Process -FilePath $ff -ArgumentList '-kiosk','http://127.0.0.1:5000/?kiosk=1'}else{Start-Process 'http://127.0.0.1:5000/?kiosk=1'}"

"..\venv\Scripts\python.exe" app.py 1>>"%LOG%" 2>&1
