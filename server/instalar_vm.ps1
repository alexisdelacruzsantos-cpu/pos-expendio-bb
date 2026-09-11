# ===========================================================================
#  INSTALACION AUTOMATICA DEL POS PARA WINDOWS 8.1 (PowerShell 4+)
#  No requiere Internet Explorer ni navegador: fuerza TLS 1.2 y usa WebClient.
#  Hace: descarga+instala Python y Git en silencio, clona el repo, crea el
#  venv, instala dependencias y registra el arranque automatico.
#  USAR SIEMPRE A TRAVES DE instalar_vm.bat (doble clic) como Administrador.
# ===========================================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$GITHUB_REPO     = 'alexisdelacruzsantos-cpu/pos-expendio-bb'
$PYTHON_URL      = 'https://www.python.org/ftp/python/3.9.13/python-3.9.13-amd64.exe'
$GIT_URL         = 'https://github.com/git-for-windows/git/releases/download/v2.46.2.windows.1/Git-2.46.2-64-bit.exe'
$PYTHON_EXE      = Join-Path $env:TEMP 'python-3.9.13-amd64.exe'
$GIT_EXE         = Join-Path $env:TEMP 'Git-2.46.2-64-bit.exe'
$DEST            = Join-Path $PSScriptRoot 'pos-expendio-bb'
$PYTHON_DIR      = Join-Path $env:ProgramFiles 'Python39\python.exe'
$AUTO_TASK       = 'POS Expendio BB'

function Write-Step([string]$msg) {
    Write-Host ''
    Write-Host ('== ' + $msg) -ForegroundColor Cyan
}

function Test-Command([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Download-File([string]$url, [string]$dest) {
    $wc = New-Object System.Net.WebClient
    try {
        Write-Host ('Descargando: ' + $url)
        $wc.DownloadFile($url, $dest)
    } finally {
        $wc.Dispose()
    }
    if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 10000) {
        throw 'No se pudo descargar o el archivo es demasiado pequeno: ' + $url
    }
    Write-Host ('OK ({0:N1} MB)' -f ((Get-Item $dest).Length / 1MB))
}

function Get-RefreshPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Find-Python {
    $candidates = @($PYTHON_DIR)
    if (Test-Command 'python') { $candidates += 'python' }
    foreach ($cand in $candidates) {
        try {
            $null = & $cand --version 2>$null
            return $cand
        } catch { }
    }
    return $null
}

function Install-Python {
    if (-not (Test-Path $PYTHON_EXE)) {
        Download-File $PYTHON_URL $PYTHON_EXE
    } else {
        Write-Host 'El instalador de Python ya esta descargado, se reutiliza.'
    }
    Write-Host 'Instalando Python 3.9.13 en silencio (Instalar para todos los usuarios)...'
    Start-Process -FilePath $PYTHON_EXE -ArgumentList @(
        '/quiet', 'InstallAllUsers=1', 'PrependPath=1',
        'Include_launcher=1', 'Include_test=0', 'Shortcuts=0'
    ) -Wait
    Get-RefreshPath
}

function Install-Git {
    if (-not (Test-Path $GIT_EXE)) {
        Download-File $GIT_URL $GIT_EXE
    } else {
        Write-Host 'El instalador de Git ya esta descargado, se reutiliza.'
    }
    Write-Host 'Instalando Git 2.46.2 en silencio (solo 64 bits, ultimo compatible con 8.1)...'
    Start-Process -FilePath $GIT_EXE -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'
    ) -Wait
    Get-RefreshPath
}

function Clone-Repo([string]$token) {
    if (Test-Path (Join-Path $DEST '.git')) {
        Write-Host 'El repositorio ya esta clonado, se ignorara el token.'
        Set-Location $DEST
        return
    }
    if (Test-Path $DEST) {
        Write-Host 'Carpeta destino incompleta de un intento previo, se elimina.'
        Remove-Item $DEST -Recurse -Force
    }
    if (-not $token) {
        throw 'No se proporciono el token de GitHub. Reintenta.'
    }
    Write-Host 'Clonando el repositorio...'
    git clone ("https://x-access-token:" + $token + "@github.com/" + $GITHUB_REPO) $DEST
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las credenciales de GitHub. Reintenta.' }
    Set-Location $DEST
    git remote set-url origin ("https://github.com/" + $GITHUB_REPO)
}

function Setup-Venv {
    if (Test-Path (Join-Path $DEST 'venv\Scripts\python.exe')) {
        Write-Host 'El venv ya existe, se reutiliza.'
        return
    }
    $py = Find-Python
    if (-not $py) { throw 'No se encontro Python instalado.' }
    Write-Host 'Creando entorno virtual...'
    & $py -m venv (Join-Path $DEST 'venv')
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la creacion del venv.' }
    Write-Host 'Instalando dependencias (Flask, waitress, JWT)...'
    & (Join-Path $DEST 'venv\Scripts\python.exe') -m pip install --upgrade 'pip<25' --quiet
    & (Join-Path $DEST 'venv\Scripts\python.exe') -m pip install -r (Join-Path $DEST 'server\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la instalacion de dependencias.' }
}

function Register-Autostart {
    $startBat = Join-Path $DEST 'server\start_pos.bat'
    Write-Host 'Registrando el arranque automatico al iniciar sesion (tipo ONLOGON)...'
    # Usa Register-ScheduledTask (modulo disponible en Win 8.1 / PowerShell 4)
    try {
        $action  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ""' + $startBat + '""')
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $null = Register-ScheduledTask -TaskName $AUTO_TASK -Action $action -Trigger $trigger `
            -Description 'POS Expendio BB - servidor principal' -Force
        Write-Host 'Tarea registrada correctamente.'
    } catch {
        Write-Host ('No se pudo registrar la tarea: ' + $_.Exception.Message) -ForegroundColor Yellow
    }
}

# ===========================================================================
#  MAIN
# ===========================================================================
Write-Host '==========================================' -ForegroundColor Green
Write-Host '  INSTALADOR AUTOMATICO DEL POS (Win 8.1)' -ForegroundColor Green
Write-Host '==========================================' -ForegroundColor Green

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    Write-Host 'ERROR: este instalador solo soporta 64 bits (AMD64).' -ForegroundColor Red
    exit 1
}
if ((-not (Test-Command 'git')) -or (-not (Test-Path $PYTHON_DIR))) {
    $isAdmin = (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host 'Este instalador requiere permisos de Administrador para instalar Python/Git.' -ForegroundColor Yellow
        Write-Host 'Cierra esta ventana, haz clic derecho en instalar_vm.bat y elige "Ejecutar como administrador".'
        exit 1
    }
}

$token = $null
if (-not (Test-Path (Join-Path $DEST '.git'))) {
    Write-Host ''
    Write-Host 'IMPORTANTE - como pegar el token en esta ventana:'
    Write-Host '  - Haz CLIC DERECHO sobre la ventana para pegar (o Ctrl+Shift+V).'
    Write-Host '  - En Windows 8.1 el Ctrl+V normal NO pega en la consola.'
    Write-Host ''
    while (-not $token) {
        $token = Read-Host 'Pega tu GitHub Personal Access Token (empieza con "github_pat_" o "ghp_") y pulsa Enter'
        $token = $token.Trim()
        if (-not $token) {
            Write-Host 'No se pego nada. Reintenta.' -ForegroundColor Yellow
        }
    }
}

Write-Step '1/6 - Python'
if (Test-Path $PYTHON_DIR) {
    Write-Host 'Python 3.9 ya esta instalado, se omite.'
} else {
    Install-Python
}

Write-Step '2/6 - Git'
if (Test-Command 'git') {
    Write-Host 'Git ya esta instalado, se omite.'
} else {
    Install-Git
}

Write-Step '3/6 - Clonar repositorio '
Clone-Repo $token

Write-Step '4/6 - Entorno virtual y dependencias '
Setup-Venv

Write-Step '5/6 - Arranque automatico '
Register-Autostart

Write-Step '6/6 - Verificacion '
$healthExe = Join-Path $DEST 'venv\Scripts\python.exe'
& $healthExe -c "import flask, waitress, jwt; print('Dependencias OK: flask + waitress + jwt')" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Alguna dependencia fallo.' -ForegroundColor Red
} else {
    Write-Host 'Dependencias OK' -ForegroundColor Green
}

Write-Host ''
Write-Host '==========================================' -ForegroundColor Green
Write-Host '  INSTALACION COMPLETADA' -ForegroundColor Green
Write-Host '==========================================' -ForegroundColor Green
Write-Host ('Proyecto en:  ' + $DEST)
Write-Host 'Para iniciar el POS ahora:'
Write-Host ('  doble clic en:  ' + (Join-Path $DEST 'server\start_pos.bat'))
Write-Host 'Para detenerlo: cerrar esa ventana (crea respaldo automatico).'
Write-Host 'El arranque automatico al iniciar sesion queda registrado como: ' + $AUTO_TASK
Write-Host ''
Write-Host 'Cuando abras el navegador dentro del VM, escribe la URL:'
Write-Host '  http://127.0.0.1:5000'
Write-Host ''