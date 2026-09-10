#!/usr/bin/env python3
"""
POS EXPENDIO BB - Servidor Principal
Sistema de Punto de Venta para Expendio de Pan Bimbo y Productos Barcel
"""

from flask import Flask, jsonify, request, render_template, send_from_directory
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
from config import get_db_path

# Crear la aplicación Flask
app = Flask(__name__,
            template_folder=os.path.join(os.path.dirname(__file__), 'templates'),
            static_folder=os.path.join(os.path.dirname(__file__), 'static'))

# Configuración CORS
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Configuración JWT
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'POS-EXPENDIO-BB-SECRET-KEY-2026')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = 3600  # 1 hora
jwt = JWTManager(app)

# Configuración de la base de datos
db_path = get_db_path()
os.makedirs(os.path.dirname(db_path), exist_ok=True)
app.config['DB_PATH'] = db_path

# Inicializar base de datos
db = Database(app.config['DB_PATH'])
db.init_db()

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


@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'static'), path)


# Rutas catch-all para SPA (devuelve index.html)
@app.route('/<path:path>')
def catch_all(path):
    if _is_sensitive_static(path):
        return jsonify({"error": "Archivo no disponible"}), 403
    if '.' not in path:
        return render_template('dashboard.html')
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'static'), path)


# ---------------------------------------------------------------------------
# Respaldo automático + salud
# ---------------------------------------------------------------------------
from utils.backup import create_backup


def _backup_dir():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, 'pos', 'backup')


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

    # Respaldo automático al arrancar (y luego cada 24h)
    threading.Timer(1, _autobackup).start()

    port = int(os.environ.get('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)