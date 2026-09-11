@echo off
REM ============================================================
REM  COMPILAR INSTALADOR DEL POS -> InstaladorPOS.exe (un solo exe)
REM  Requiere: Windows x64 + Python 3.9 instalado + PyInstaller.
REM
REM  Pasos:
REM   1. Instalar Python 3.9 (si no esta) desde instalador\assets
REM   2. Ejecutar este bat (Doble clic, o como administrador).
REM   3. Queda: instalador\dist\InstaladorPOS.exe (listo para USB)
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo  Compilando InstaladorPOS.exe - PyInstaller one-file
echo.

where python >nul 2>&1
if errorlevel 1 goto sin_python

for /f "delims=" %%i in ('where python') do set "PY=%%i"
echo Python: %PY%
"%PY%" --version

"%PY%" -m PyInstaller --version >nul 2>&1
if not errorlevel 1 goto pyi_ok
echo [INFO] Instalando PyInstaller, internet requerido una sola vez...
"%PY%" -m pip install pyinstaller
if errorlevel 1 goto pyi_fail

:pyi_ok
if exist build  rmdir /s /q build
if exist dist   rmdir /s /q dist

"%PY%" -m PyInstaller --onefile --noconsole --name InstaladorPOS ^
    --add-data "assets;assets" ^
    installer.py

if errorlevel 1 goto build_fail

echo.
echo ============================================================
echo  LISTO: dist\InstaladorPOS.exe
echo ============================================================
echo  Copia ese .exe a un USB y ejecutalo en la PC de la tienda.
echo.
goto fin

:sin_python
echo [ERROR] No se encontro python en el PATH.
echo Usa el python de:
echo   C:\Python39\python.exe
echo   %%LOCALAPPDATA%%\Programs\Python\Python39\python.exe
goto fin

:pyi_fail
echo [ERROR] No se pudo instalar PyInstaller. Revisa la conexion.
goto fin

:build_fail
echo.
echo [ERROR] La compilacion fallo. Revisa el mensaje de arriba.
goto fin

:fin
pause