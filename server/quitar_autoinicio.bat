@echo off
REM ===========================================================
REM  POS EXPENDIO BB - Quitar arranque automatico (Windows)
REM  Elimina la tarea que inicia el servidor al iniciar sesion.
REM  Ejecutar como Administrador desde la carpeta server.
REM ===========================================================
setlocal
echo.
echo Quitando arranque automatico del servidor POS...
schtasks /Delete /TN "POS Expendio BB" /F
if errorlevel 1 (
    echo La tarea no existia o no se pudo quitar.
) else (
    echo Arranque automatico eliminado.
)
echo El servidor ya no se iniciara solo. Puedes iniciarlo manualmente con start_pos.bat
pause