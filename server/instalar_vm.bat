@echo off
REM ===========================================================
REM  POS EXPENDIO BB - Instalacion automatica (Windows 8.1)
REM  Simplemente hazle doble clic AQUI (o "Ejecutar como
REM  administrador"). Se encarga de bajar Python + Git, clonar
REM  el repo, crear el venv, instalar y registrar el autoarranque.
REM  Debe estar en la misma carpeta que instalar_vm.ps1
REM ===========================================================
setlocal
title POS - Instalacion automatica

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: no se encontro PowerShell. Esto es raro en Windows 8.1.
    pause
    exit /b 1
)

echo Invocando el instalador (PowerShell) - puede tardar varios minutos.
echo No cierres esta ventana.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar_vm.ps1"

echo.
echo Fin del instalador.
pause