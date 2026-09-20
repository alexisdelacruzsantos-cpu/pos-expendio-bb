#!/usr/bin/env python3
"""
POS EXPENDIO BB - Receptor de la BD subida por la tienda (host, Fase 7).

Solo es útil en el HOST (espejo de solo lectura): recibe el snapshot gzip de la
base, lo valida (integridad + SHA) y lo reemplaza de forma atómica, luego
reconecta la BD y reaplica migraciones/índices.

Autenticación: header `Authorization: Bearer <SYNC_TOKEN>` donde SYNC_TOKEN es
la variable de entorno del host (compare_digest, nunca el JWT).
"""
import gzip
import hashlib
import hmac
import os
import sqlite3
import sys

from flask import Blueprint, current_app, jsonify, request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import SYNC_TOKEN, get_db_path

sync_bp = Blueprint('sync', __name__)

# Tamaño máximo aceptado (descomprimido): DBs típicas pesan cientos de KB.
_MAX_DB_BYTES = 64 * 1024 * 1024


def _bearer_token():
    auth = request.headers.get('Authorization', '')
    if auth.lower().startswith('bearer '):
        return auth.split(' ', 1)[1].strip()
    return ''


def _swap_db(payload):
    """Valida y reemplaza la BD activa de forma atómica."""
    if len(payload) > _MAX_DB_BYTES:
        raise ValueError('La base excede el tamaño máximo permitido')

    db_path = get_db_path()
    tmp_path = db_path + '.syncnew'

    with open(tmp_path, 'wb') as f:
        f.write(payload)

    try:
        conn = sqlite3.connect(tmp_path)
        try:
            row = conn.execute('PRAGMA integrity_check').fetchone()
            if not row or row[0] != 'ok':
                raise ValueError('integridad rechazada (%s)' % (row[0] if row else 'sin resultado'))
        finally:
            conn.close()
    except Exception as e:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise ValueError('Base rechazada: %s' % e)

    # Swap atómico (Linux/Mac/Windows modernos lo soportan).
    os.replace(tmp_path, db_path)

    # La conexión cacheada del app sigue leyendo el inode anterior: forzarla a
    # re-abrir. Después se eliminan restos de WAL/SHM del archivo viejo.
    try:
        current_app.config['DB'].reset_connection()
    except Exception as e:
        raise ValueError('No se pudo reconectar la base: %s' % e)
    for ext in ('.db-wal', '.db-shm'):
        try:
            os.remove(db_path + ext)
        except OSError:
            pass


@sync_bp.route('/db', methods=['POST'])
def upload_db():
    expected = SYNC_TOKEN or ''
    supplied = _bearer_token()
    if not expected or not supplied or not hmac.compare_digest(supplied, expected):
        return jsonify({'error': 'Token de sincronización inválido'}), 401

    file = request.files.get('file')
    if file is None:
        return jsonify({'error': 'Falta el archivo de base de datos'}), 400

    payload = file.read()
    try:
        payload = gzip.decompress(payload)
    except Exception:
        pass  # se envía sin comprimir: igual se procesa

    sha_claimed = (request.form.get('sha') or '').strip()
    sha_real = hashlib.sha256(payload).hexdigest()
    if sha_claimed and sha_claimed != sha_real:
        return jsonify({'error': 'El hash no coincide; base corrupta durante el envío'}), 400

    try:
        _swap_db(payload)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Error al reemplazar la base: %s' % e}), 500

    # Migraciones + índices sobre la BD recién recibida (aditivos/idempotentes).
    try:
        current_app.config['DB'].init_db()
    except Exception as e:
        return jsonify({'error': 'Base reemplazada pero falló la migración: %s' % e}), 500

    return jsonify({
        'ok': True,
        'sha': sha_real,
        'bytes': len(payload),
        'received': request.form.get('received') or '',
    }), 200


@sync_bp.route('/ping', methods=['GET'])
def ping():
    """Probe sin auth para validar conectividad/despertar el host."""
    return jsonify({'ok': True, 'readonly': bool(getattr(current_app, 'config', {}).get('POS_READONLY'))}), 200