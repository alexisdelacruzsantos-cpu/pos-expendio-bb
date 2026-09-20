#!/usr/bin/env python3
"""
POS EXPENDIO BB - Emisor de sincronización hacia el host (Fase 7).

La tienda sube un snapshot WAL-safe de su base de datos (gzip) al endpoint
/api/sync/db del host configurado. Solo se sube si el contenido cambió (SHA256
por snapshot), para no llenar el host de peticiones vacías cada 5 minutos.

Configuración (tabla `settings`, fuera de git):
  sync_enabled  '1'/'0'
  sync_host     https://<usuario>.pythonanywhere.com
  sync_token    token compartido con el host
  sync_interval segundos (mínimo 60)

El thread daemon se arranca solo en la TIENDA (no en el host).
"""

import gzip
import hashlib
import os
import sqlite3
import sys
import tempfile
import threading
import time
from datetime import datetime

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import get_db_path
from utils.database import Database

SYNC_DEFAULTS = {
    'sync_enabled': '0',
    'sync_host': '',
    'sync_token': '',
    'sync_interval': '300',
}

_SIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(get_db_path())), '.last_sync.sig'
)

# Estado de la última sincronización: vive en un archivo FUERA de la BD para no
# alterar el contenido que se sube (un timestamp aquí cambiaría el digest y
# provocaría subidas en bucle).
_STATUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(get_db_path())), '.last_sync.json'
)

_STATUS_DEFAULTS = {
    'sync_last_ok': '',
    'sync_last_attempt': '',
    'sync_last_error': '',
    'sync_last_msg': '',
}


def _set_setting(db, key, value):
    db.execute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        (key, str(value)),
    )


def _read_status():
    try:
        with open(_STATUS_PATH, 'r') as f:
            import json
            data = json.load(f)
        merged = dict(_STATUS_DEFAULTS)
        merged.update({k: v for k, v in data.items() if k in _STATUS_DEFAULTS})
        return merged
    except Exception:
        return dict(_STATUS_DEFAULTS)


def _write_status(ok, msg):
    import json
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    prev = _read_status()
    data = {
        'sync_last_ok': now if ok else prev.get('sync_last_ok', ''),
        'sync_last_attempt': now,
        'sync_last_error': '' if ok else msg,
        'sync_last_msg': msg,
    }
    try:
        with open(_STATUS_PATH, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass


def _get_settings(db=None):
    db = db or Database(get_db_path())
    values = dict(SYNC_DEFAULTS)
    for row in db.fetch_all('SELECT key, value FROM settings'):
        values[row['key']] = row['value']
    return values


def _read_sig():
    try:
        with open(_SIG_PATH, 'r') as f:
            return (f.read() or '').strip()
    except Exception:
        return ''


def _write_sig(sha):
    try:
        with open(_SIG_PATH, 'w') as f:
            f.write(sha)
    except Exception:
        pass


def _snapshot(db_path, dst_path):
    """Foto consistente WAL-safe (sqlite backup API)."""
    if not os.path.exists(db_path):
        return False
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(dst_path)
    try:
        with dst:
            src.backup(dst)
        return True
    finally:
        dst.close()
        src.close()


def _digest(db_path):
    """Hash del CONTENIDO lógico de la BD (dump SQL), estable si no cambian los
    datos. El hash de un snapshot SQLite NO es estable entre copias de los
    mismos datos (los bytes del archivo se reordenan), por eso se compara aquí."""
    if not os.path.exists(db_path):
        return ''
    conn = sqlite3.connect('file:%s?mode=ro' % db_path, uri=True)
    try:
        h = hashlib.sha256()
        for line in conn.iterdump():
            h.update(line.encode('utf-8', errors='replace'))
        return h.hexdigest()
    finally:
        conn.close()


def _settings_summary(settings, ok, msg):
    _write_status(ok, msg)


def run_sync(force=False):
    """Ejecuta una sincronización. Devuelve (ok, mensaje).

    force=True ignora el hash guardado y sube igual (botón 'Sincronizar ahora').
    """
    db = Database(get_db_path())
    s = _get_settings(db)
    enabled = str(s.get('sync_enabled', '0')).strip() in ('1', 'true', 'yes', 'on')
    host = (s.get('sync_host') or '').strip()
    token = (s.get('sync_token') or '').strip()

    if not enabled:
        return False, 'Sincronización desactivada'
    if not host or not token:
        return False, 'Configura la URL del host y el token'
    if not host.lower().startswith('http'):
        return False, 'El host debe comenzar con http(s)://'

    try:
        with tempfile.TemporaryDirectory(prefix='pos_sync_') as tmp:
            # Cambio detectado por digest lógico (dump), no por bytes del archivo.
            digest = _digest(get_db_path())
            if digest == _read_sig() and not force:
                return True, 'Sin cambios desde la última subida'

            snap = os.path.join(tmp, 'snap.db')
            if not _snapshot(get_db_path(), snap):
                return False, 'No se pudo crear el snapshot de la base de datos'

            with open(snap, 'rb') as f:
                raw = f.read()
            sha = hashlib.sha256(raw).hexdigest()
            payload = gzip.compress(raw)
            headers = {'Authorization': 'Bearer ' + token}
            files = {'file': ('pos.db.gz', payload, 'application/gzip')}
            data = {'sha': sha}
            resp = requests.post(
                host.rstrip('/') + '/api/sync/db',
                headers=headers,
                files=files,
                data=data,
                timeout=60,
            )
            if resp.status_code == 200:
                _write_sig(digest)
                _settings_summary(s, True, 'Subida exitosa (SHA %s…)' % sha[:8])
                return True, 'Subida exitosa (SHA %s…)' % sha[:8]
            msg = 'El host respondió HTTP %s: %s' % (resp.status_code, resp.text[:200])
            _settings_summary(s, False, msg)
            return False, msg
    except requests.exceptions.RequestException as e:
        msg = 'Fallo de conexión con el host: %s' % e
        _settings_summary(s, False, msg)
        return False, msg
    except Exception as e:
        msg = 'Error en la sincronización: %s' % e
        _settings_summary(s, False, msg)
        return False, msg


def _current_interval():
    try:
        s = _get_settings()
        interval = float(str(s.get('sync_interval', '300') or 300))
        return int(max(60, min(3600, interval)))
    except Exception:
        return 300


def _loop(stop_event):
    while not stop_event.is_set():
        try:
            s = _get_settings()
            enabled = str(s.get('sync_enabled', '0')).strip() in ('1', 'true', 'yes', 'on')
            if enabled and s.get('sync_host', '').strip() and s.get('sync_token', '').strip():
                run_sync()
        except Exception as e:
            try:
                _settings_summary(_get_settings(), False, 'Error en el ciclo: %s' % e)
            except Exception:
                pass
        stop_event.wait(_current_interval())


def start_sync_thread():
    """Arranca el daemon de sincronización (una sola vez). Store-side only."""
    if getattr(start_sync_thread, '_sync_thread', None) is not None:
        return start_sync_thread._sync_thread
    stop = threading.Event()
    thread = threading.Thread(
        target=_loop, args=(stop,), name='sync-push', daemon=True
    )
    thread.start()
    start_sync_thread._sync_thread = thread
    return thread