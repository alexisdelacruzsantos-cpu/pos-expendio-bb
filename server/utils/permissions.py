import os
import sys
from functools import wraps

from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import get_db_path
from utils.database import Database


def _current_role():
    try:
        v = get_jwt_identity()
        uid = int(v) if v is not None else None
    except Exception:
        uid = None
    if uid is None:
        return None
    try:
        db = Database(get_db_path())
        u = db.fetch_one('SELECT role FROM users WHERE id = ?', (uid,))
        return u['role'] if u else None
    except Exception:
        return None


def current_user_id():
    """ID del usuario autenticado (int) o None."""
    try:
        v = get_jwt_identity()
        return int(v) if v is not None else None
    except Exception:
        return None


def is_admin():
    """True si el usuario autenticado tiene rol admin."""
    return _current_role() == 'admin'


def has_permission(module, action='view'):
    """Comprueba permisos sin bloquear la petición (para uso dentro de rutas).

    module: sales | products | cash_register | reports | settings | users
    action: view | create | edit | delete
    El rol 'admin' siempre tiene acceso total.
    """
    try:
        if is_admin():
            return True
        db = Database(get_db_path())
        role = _current_role()
        perms = db.get_permissions_by_role(role)
        return bool((perms.get(module) or {}).get('can_' + action, 0))
    except Exception:
        return False


def require_permission(module, action='view'):
    """Valida que el usuario autenticado tenga permiso en la BD.

    module: sales | products | cash_register | reports | settings | users
    action: view | create | edit | delete

    El rol 'admin' siempre tiene acceso total.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                verify_jwt_in_request()
            except Exception:
                return jsonify({'error': 'No autorizado'}), 401

            role = _current_role()
            if role == 'admin':
                return fn(*args, **kwargs)

            try:
                db = Database(get_db_path())
                perms = db.get_permissions_by_role(role)
            except Exception:
                return jsonify({'error': 'No autorizado'}), 403

            module_perms = perms.get(module) or {}
            allowed = bool(module_perms.get('can_' + action, 0))
            if not allowed:
                return jsonify({'error': 'No tienes permisos para esta acción'}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator