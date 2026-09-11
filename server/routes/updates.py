from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

import os
import re
import sys
import time
import json
import shutil
import urllib.request
import urllib.error
import zipfile
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path, APP_VERSION, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
from utils.backup import create_backup
from utils.permissions import require_permission

updates_bp = Blueprint('updates', __name__)

_UA = "SPA-POS-EXPENDIO-BB/1.0"
_RAW_VERSION_URL = "https://api.github.com/repos/{owner}/{repo}/contents/server/config.py?ref={branch}"
_COMMITS_URL = "https://api.github.com/repos/{owner}/{repo}/commits?sha={branch}&per_page=30"
_ZIPBALL_URL = "https://api.github.com/repos/{owner}/{repo}/zipball/{branch}"


def _project_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _flag_path():
    return os.path.join(_project_root(), 'pos', '.updating')


def _sha_path():
    return os.path.join(_project_root(), 'pos', '.current_sha')


def _read_or_request(url, timeout=60, accept=None):
    """GET con urllib. Devuelve (status, body_bytes o dict JSON si es API)."""
    req = urllib.request.Request(url, headers={
        'User-Agent': _UA,
        'Accept': accept or 'application/vnd.github+json, application/json;q=0.9, */*;q=0.5',
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            ctype = resp.headers.get('Content-Type', '')
            if 'json' in ctype:
                return resp.status, json.loads(body.decode('utf-8'))
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception:
        return None, None


def _parse_app_version(py_text):
    m = re.search(r'APP_VERSION\s*=\s*[\'"]([^\'"]+)[\'"]', py_text or '')
    return m.group(1) if m else None


def _read_local_sha():
    try:
        p = _sha_path()
        if os.path.exists(p):
            with open(p, 'r') as f:
                return f.read().strip() or None
    except Exception:
        pass
    return None


def _merge_update(src_root, project_root):
    """Copia el contenido de src_root sobre project_root respetando carpetas protegidas.

    Nunca se tocan la base de datos (server/static/data), backups, exportaciones,
    el venv ni los secretos locales. El zipball no las contiene (están en .gitignore)
    pero se protegen igualmente por robustez ante cambios de .gitignore a futuro.
    """
    PROTECTED = {'static/data', 'data', 'venv', 'backup', 'exports'}

    def _make_ignore(src_base):
        def ignore_func(cur, names):
            skipped = []
            for n in names:
                rel = os.path.relpath(os.path.join(cur, n), src_base).replace('\\', '/')
                rel_parts = rel.split('/')
                # matchea si CUALQUIER sufijo del path coincide con un directorio protegido
                if any('/'.join(rel_parts[i:]) in PROTECTED for i in range(len(rel_parts))):
                    print('[update] saltando protegido:', rel)
                    skipped.append(n)
            return skipped
        return ignore_func

    for item in os.listdir(src_root):
        if any(item == p or item.startswith(p + '/') for p in PROTECTED):
            print('[update] saltando protegido:', item)
            continue
        src = os.path.join(src_root, item)
        dst = os.path.join(project_root, item)
        if os.path.isdir(src):
            if not os.path.exists(dst):
                ext = shutil.copy2
                shutil.copytree(src, dst, ignore=_make_ignore(src_root))
            else:
                shutil.copytree(src, dst, dirs_exist_ok=True, ignore=_make_ignore(src_root))
        else:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)


def _restart_bat():
    """Batch que espera, mata el proceso actual y relanza el launcher silencioso."""
    root = _project_root()
    launcher = os.path.join(root, 'iniciar_silencioso.bat')
    bat_path = os.path.join(root, 'pos', '.restart.bat')
    flag = _flag_path()
    lines = [
        '@echo off\r\n',
        'ping -n 4 127.0.0.1 >nul\r\n',
        'taskkill /PID {} /T /F >nul 2>&1\r\n'.format(os.getpid()),
        'cd /d "{}"\r\n'.format(root),
        'del "{}" >nul 2>&1\r\n'.format(flag),
        'del "{}" >nul 2>&1\r\n'.format(bat_path),
        'if exist "{}" start "" /b "{}"\r\n'.format(launcher, launcher),
        'exit\r\n',
    ]
    with open(bat_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    # Lanza el bat de forma desacoplada via PowerShell Start-Process (sin
    # consola, sobrevive a la muerte de este proceso): espera ~3 s, mata este
    # proceso y relanza el launcher silencioso.
    try:
        subprocess.Popen(
            'powershell -NoProfile -WindowStyle Hidden -Command '
            '"Start-Process -FilePath \'{}\' -ArgumentList \'/c {}\' -WindowStyle Hidden"'.format(
                'C:\\Windows\\System32\\cmd.exe', bat_path,
            ),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except Exception:
        pass
    return bat_path


@updates_bp.route('/status', methods=['GET'])
@jwt_required()
@require_permission('settings', 'delete')
def status():
    updating = os.path.exists(_flag_path())
    return jsonify({
        'version': APP_VERSION,
        'sha': _read_local_sha(),
        'updating': updating,
        'repo_public': True,
    }), 200


@updates_bp.route('/check', methods=['POST'])
@jwt_required()
@require_permission('settings', 'delete')
def check():
    if os.path.exists(_flag_path()):
        return jsonify({'error': 'Ya hay una actualización en curso'}), 409

    status_code, body = _read_or_request(
        _RAW_VERSION_URL.format(owner=GITHUB_OWNER, repo=GITHUB_REPO, branch=GITHUB_BRANCH),
        timeout=30,
        accept='application/vnd.github+json',
    )
    if status_code is None:
        return jsonify({
            'online': False,
            'error': 'Sin conexión a internet. Conecta el equipo y vuelve a intentarlo.',
        }), 200
    if status_code != 200:
        return jsonify({
            'online': True,
            'error': 'GitHub respondió HTTP {}. Verifica el repositorio y la rama.'.format(status_code),
        }), 502

    remote_version = None
    if isinstance(body, dict):
        try:
            import base64
            remote_version = _parse_app_version(
                base64.b64decode(body.get('content', '')).decode('utf-8')
            )
        except Exception:
            remote_version = None

    _, commits = _read_or_request(
        _COMMITS_URL.format(owner=GITHUB_OWNER, repo=GITHUB_REPO, branch=GITHUB_BRANCH),
        timeout=30,
    )
    changelog = []
    head_sha = None
    if isinstance(commits, list):
        for c in commits:
            if head_sha is None:
                head_sha = c.get('sha')
            cm = c.get('commit', {}) or {}
            changelog.append({
                'sha': (c.get('sha') or '')[:7],
                'message': (cm.get('message') or '').splitlines()[0],
                'author': ((cm.get('author') or {}).get('name') or ''),
                'date': ((cm.get('author') or {}).get('date') or ''),
            })

    update_disponible = bool(remote_version) and remote_version != APP_VERSION
    return jsonify({
        'online': True,
        'version_actual': APP_VERSION,
        'version_remota': remote_version,
        'update_disponible': update_disponible,
        'head_sha': head_sha,
        'current_sha': _read_local_sha(),
        'changelog': changelog[:30],
    }), 200


@updates_bp.route('/apply', methods=['POST'])
@jwt_required()
@require_permission('settings', 'delete')
def apply():
    if os.path.exists(_flag_path()):
        return jsonify({'error': 'Ya hay una actualización en curso'}), 409

    # Marca "actualización en curso" para evitar dobles clics
    root = _project_root()
    os.makedirs(os.path.join(root, 'pos'), exist_ok=True)
    flag = _flag_path()
    try:
        with open(flag, 'w') as f:
            f.write(str(int(time.time())))
    except Exception as e:
        return jsonify({'error': 'No se pudo crear la marca de actualización: {}'.format(e)}), 500

    tmpdir = None
    try:
        # 1) Respaldo de la base de datos
        backup_dir = os.path.join(root, 'pos', 'backup')
        backup = create_backup(get_db_path(), backup_dir, prefix='pos_backup_update_', keep=15)
        if not backup:
            return jsonify({'error': 'No se pudo crear el respaldo de la base de datos'}), 500

        # 2) Descargar código del repositorio (zipball de main)
        status_code, data = _read_or_request(
            _ZIPBALL_URL.format(owner=GITHUB_OWNER, repo=GITHUB_REPO, branch=GITHUB_BRANCH),
            timeout=300,
            accept='application/vnd.github+json',
        )
        if status_code is None:
            return jsonify({'error': 'Sin conexión a internet. No se pudo descargar la actualización.'}), 502
        if status_code != 200:
            return jsonify({'error': 'La descarga falló (HTTP {}). Revisa el repositorio público.'.format(status_code)}), 502
        if isinstance(data, dict):
            return jsonify({'error': 'El repositorio devolvió un JSON inesperado: {}'.format(data.get('message', ''))}), 502

        # 3) Extraer a temporal y localizar la carpeta raíz del zipball
        tmpdir = tempfile.mkdtemp(prefix='pos_update_')
        zippath = os.path.join(tmpdir, 'repo.zip')
        with open(zippath, 'wb') as f:
            f.write(data)
        extract_dir = os.path.join(tmpdir, 'x')
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zippath) as z:
            z.extractall(extract_dir)

        top = os.path.join(extract_dir, next(d for d in os.listdir(extract_dir) if os.path.isdir(os.path.join(extract_dir, d))))

        # 4) Copiar el código sobre el proyecto.
        #    El zipball solo contiene archivos versionados (la BD, pos/, CATALOGO.xlsx,
        #    .jwt_secret y venv están en .gitignore) por lo que nunca se pisan.
        _merge_update(top, root)

        # 5) Registrar el SHA descargado
        head_sha = None
        try:
            _, commits = _read_or_request(
                _COMMITS_URL.format(owner=GITHUB_OWNER, repo=GITHUB_REPO, branch=GITHUB_BRANCH),
                timeout=30,
            )
            if isinstance(commits, list) and commits:
                head_sha = commits[0].get('sha')
        except Exception:
            pass
        if head_sha:
            with open(_sha_path(), 'w') as f:
                f.write(head_sha)

        # 6) Programa el reinicio automático y responde antes de morir
        _restart_bat()
        return jsonify({
            'message': 'Actualización aplicada. El sistema se reiniciará en unos segundos…',
            'version': APP_VERSION,
            'backup': os.path.basename(backup),
        }), 200

    except Exception as e:
        return jsonify({'error': 'Error al aplicar la actualización: {}'.format(e)}), 500
    finally:
        if tmpdir and os.path.exists(tmpdir):
            try:
                shutil.rmtree(tmpdir, ignore_errors=True)
            except Exception:
                pass
        # Limpia la marca si el procesador no terminó reiniciando
        try:
            if os.path.exists(flag):
                os.remove(flag)
        except Exception:
            pass