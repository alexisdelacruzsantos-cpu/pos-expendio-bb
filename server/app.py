#!/usr/bin/env python3
"""
POS EXPENDIO BB - Servidor Principal
Sistema de Punto de Venta para Expendio de Pan Bimbo y Productos Barcel
"""

from flask import Flask, jsonify, request, render_template, send_from_directory, redirect
from flask_cors import CORS
from flask_jwt_extended import JWTManager
import os
import sys
import signal
import threading
import time

# Agregar el directorio routes al path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

# Importar utilidades internas
from utils.database import Database
from utils.security import Security
from config import get_db_path, POS_READONLY, POS_HOST

# Crear la aplicación Flask
app = Flask(__name__,
            template_folder=os.path.join(os.path.dirname(__file__), 'templates'),
            static_folder=os.path.join(os.path.dirname(__file__), 'static'))

# Configuración CORS
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Configuración JWT
def _resolve_jwt_secret():
    """Secreto JWT: 1) variable de entorno, 2) archivo persistente fuera del repo, 3) generado y guardado."""
    env_secret = os.environ.get('JWT_SECRET_KEY')
    if env_secret:
        return env_secret
    secret_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'pos', '.jwt_secret')
    try:
        if os.path.exists(secret_file):
            with open(secret_file, 'r') as f:
                content = f.read().strip()
            if content:
                return content
        secret = os.urandom(48).hex()
        os.makedirs(os.path.dirname(secret_file), exist_ok=True)
        with open(secret_file, 'w') as f:
            f.write(secret)
        os.chmod(secret_file, 0o600)
        return secret
    except Exception:
        return os.environ.get('JWT_SECRET_KEY') or os.urandom(48).hex()

app.config['JWT_SECRET_KEY'] = _resolve_jwt_secret()
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = 43200  # 12 horas (turno completo)
jwt = JWTManager(app)

# Configuración de la base de datos
db_path = get_db_path()
os.makedirs(os.path.dirname(db_path), exist_ok=True)
app.config['DB_PATH'] = db_path

# Inicializar base de datos
db = Database(app.config['DB_PATH'])
db.init_db()

# Referencia compartida a la instancia de BD (el receptor de sync la necesita
# para reconectar tras reemplazar pos.db en el host).
app.config['DB'] = db
app.config['POS_READONLY'] = POS_READONLY

# Importar y registrar rutas
from routes.auth import auth_bp
from routes.products import products_bp
from routes.sales import sales_bp
from routes.cash import cash_bp
from routes.reports import reports_bp
from routes.settings import settings_bp
from routes.promotions import promotions_bp
from routes.lots import lots_bp
from routes.imports import imports_bp
from routes.adjustments import adjustments_bp
from routes.maintenance import maintenance_bp
from routes.updates import updates_bp
from routes.point import point_bp
from routes.sync import sync_bp

app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(products_bp, url_prefix='/api/products')
app.register_blueprint(sales_bp, url_prefix='/api/sales')
app.register_blueprint(cash_bp, url_prefix='/api/cash')
app.register_blueprint(reports_bp, url_prefix='/api/reports')
app.register_blueprint(settings_bp, url_prefix='/api/settings')
app.register_blueprint(promotions_bp, url_prefix='/api/promotions')
app.register_blueprint(lots_bp, url_prefix='/api/lots')
app.register_blueprint(imports_bp, url_prefix='/api/imports')
app.register_blueprint(adjustments_bp, url_prefix='/api/adjustments')
app.register_blueprint(maintenance_bp, url_prefix='/api/maintenance')
app.register_blueprint(updates_bp, url_prefix='/api/updates')
app.register_blueprint(point_bp, url_prefix='/api/mp')
app.register_blueprint(sync_bp, url_prefix='/api/sync')


# ---------------------------------------------------------------------------
# Blindaje de archivos sensibles
# ---------------------------------------------------------------------------
_FORBIDDEN_EXT = ('.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3', '.wal', '.shm')


def _is_sensitive_static(path):
    """Detecta rutas/carpetas que nunca deben servirse públicamente."""
    lowered = (path or '').lower().lstrip('/')
    if '?' in lowered:
        lowered = lowered.split('?')[0]
    if lowered.startswith('static/data') or '/static/data' in lowered or lowered.endswith('/data'):
        return True
    if '/backup/' in lowered or lowered.startswith('backup/'):
        return True
    if lowered.endswith(_FORBIDDEN_EXT):
        return True
    return False


@app.before_request
def _block_sensitive_paths():
    """Corta cualquier intento de leer archivos de BD/copias antes de enrutar.
    Cubre /static/data/..., /backup/... y cualquier *.db/*.wal/*.shm."""
    if _is_sensitive_static(request.path):
        return jsonify({"error": "Archivo no disponible"}), 403
    return None


# ---------------------------------------------------------------------------
# Modo HOST (espejo de solo lectura, Fase 7)
# Con POS_READONLY=1 el backend acepta lecturas (GET/OPTIONS) y un puñado de
# POST mínimos (login, validación de token y el push de la BD). Todo lo demás
# que escriba devuelve 403: así nada puede alterar el espejo desde fuera.
# ---------------------------------------------------------------------------
_READONLY_FRONT = (
    '/api/sync/ping',
    '/api/sync/db',
    '/api/auth/login',
    '/api/auth/validate',
)


@app.before_request
def _readonly_enforce():
    if not app.config.get('POS_READONLY'):
        return None
    if request.method in ('GET', 'OPTIONS'):
        return None
    if request.path in _READONLY_FRONT:
        return None
    return jsonify({"error": "El host es de solo lectura. Los cambios se hacen en la tienda."}), 403


_NO_CACHE = {'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'}


@app.route('/static/<path:path>')
def serve_static(path):
    resp = send_from_directory(os.path.join(os.path.dirname(__file__), 'static'), path)
    resp.headers['Cache-Control'] = _NO_CACHE['Cache-Control']
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


# Rutas catch-all para SPA (devuelve index.html)
@app.route('/<path:path>')
def catch_all(path):
    if _is_sensitive_static(path):
        return jsonify({"error": "Archivo no disponible"}), 403
    if '.' not in path:
        return render_template('dashboard.html')
    resp = send_from_directory(os.path.join(os.path.dirname(__file__), 'static'), path)
    resp.headers['Cache-Control'] = _NO_CACHE['Cache-Control']
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


# ---------------------------------------------------------------------------
# Respaldo automático + salud
# ---------------------------------------------------------------------------
from utils.backup import create_backup


_BACKUP_BASE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pos', 'backup'
)


def _backup_dir():
    return _BACKUP_BASE


def _autobackup():
    """Respaldo WAL-safe al arrancar + cada 24 horas (daemon)."""
    try:
        create_backup(app.config['DB_PATH'], _backup_dir(), prefix='pos_auto_', keep=15)
    except Exception as e:
        print(f"Autobackup error: {e}")
    # Vuelve a programarse a sí mismo cada 24h
    threading.Timer(24 * 3600, _autobackup).start()


@app.route('/api/health', methods=['GET'])
def health():
    try:
        db.checkpoint()
        probe = db.fetch_one('SELECT 1 AS ok')
        return jsonify({
            'status': 'ok' if probe and probe['ok'] == 1 else 'degraded',
            'db': os.path.basename(app.config['DB_PATH'])
        }), 200
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Apagado elegante: compacta el WAL y toma un respaldo final
# ---------------------------------------------------------------------------
def _graceful_shutdown(signum=None, frame=None):
    print("\nDeteniendo servidor: checkpoint del WAL y respaldo final...")
    try:
        db.checkpoint()
    except Exception as e:
        print(f"checkpoint error en apagado: {e}")
    try:
        create_backup(app.config['DB_PATH'], _backup_dir(), prefix='pos_shutdown_', keep=15)
    except Exception as e:
        print(f"backup de apagado error: {e}")
    sys.exit(0)


signal.signal(signal.SIGTERM, _graceful_shutdown)
signal.signal(signal.SIGINT, _graceful_shutdown)

# Ruta principal - Sirve la PWA
@app.route('/')
def index():
    # En el host, la raíz lleva a la app móvil (Flutter web en /movil/).
    if POS_HOST:
        return redirect("/movil/")
    return render_template('index.html')


# Ruta del dashboard
@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')


# Manejo de errores
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Recurso no encontrado"}), 404


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Error interno del servidor"}), 500


if __name__ == '__main__':
    print("=" * 50)
    print("POS EXPENDIO BB - Servidor Principal")
    print("=" * 50)
    print(f"Base de datos: {app.config['DB_PATH']}")
    print(f"URL: http://localhost:{os.environ.get('PORT', '5000')}")
    print("Health: /api/health")
    print("Presiona Ctrl+C para detener el servidor")
    print("=" * 50)

    # Limpia restos de una actualizacion previa que quedo a medias (por ejemplo
    # el bat de reinicio que no se auto-borro). A prueba de fallos.
    try:
        from routes.updates import _cleanup_restart_artifacts
        _cleanup_restart_artifacts()
    except Exception:
        pass

    # Respaldo automático al arrancar (diferido 5 min para no colgar la apertura) y luego cada 24h
    threading.Timer(5 * 60, _autobackup).start()

    # Sincronización hacia el host espejo (Fase 7). Solo en la tienda: el host
    # no debe subirse nada a sí mismo.
    try:
        from utils.sync_push import start_sync_thread
        start_sync_thread()
    except Exception as e:
        print(f"Sync thread error: {e}")

    port = int(os.environ.get('PORT', '5000'))
    host = os.environ.get('HOST', '0.0.0.0')

    # Servidor de producción: waitress (estable en Windows), con respaldo a Werkzeug dev
    _use_waitress = os.environ.get('WSGI', '').lower() not in ('werkzeug', 'dev')
    _waitress_msg = ''
    try:
        from waitress import serve as _waitress_serve
        _waitress_msg = '  (waitress)'
    except ImportError:
        _waitress_msg = ''
        _use_waitress = False

    print(f"URL: http://localhost:{port}")
    if _use_waitress:
        print(f"Sirviendo con waitress{_waitress_msg} en {host}:{port} (Ctrl+C para detener)")
        _waitress_serve(app, host=host, port=port, threads=8, channel_timeout=120)
    else:
        print(f"Sirviendo con Werkzeug dev server en {host}:{port} (Ctrl+C para detener)")
        app.run(host=host, port=port, debug=False, threaded=True)