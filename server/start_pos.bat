@echo off
echo ===================================
echo POS EXPENDIO BB - Iniciando
echo ===================================

cd /d "%~dp0"

if not exist "..\venv" (
    echo Creando entorno virtual...
    python -m venv ..\venv
    call ..\venv\Scripts\activate
    pip install -r requirements.txt
) else (
    call ..\venv\Scripts\activate
)

echo.
echo Iniciando servidor POS...
echo URL: http://localhost:5000
echo.
echo Para abrir la interfaz, navega a:
echo http://localhost:5000
echo.
echo Credenciales por defecto:
echo   Admin:      admin / admin123
echo   Supervisor:  supervisor / super123
echo   Cajero:      cajero / cajero123
echo.
echo Presiona Ctrl+C para detener el servidor
echo ===================================

python app.py

pause