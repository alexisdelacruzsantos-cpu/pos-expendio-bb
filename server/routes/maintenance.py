from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

import os
import sqlite3
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database
from utils.movements import current_user_id
from utils.permissions import require_permission

maintenance_bp = Blueprint('maintenance', __name__)

_backup_counter = [0]


def _backup_path():
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    backup_dir = os.path.join(base, 'pos', 'backup')
    os.makedirs(backup_dir, exist_ok=True)
    _backup_counter[0] = (_backup_counter[0] + 1) % 10000
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    return os.path.join(backup_dir, f'pos_backup_mantenimiento_{stamp}_{_backup_counter[0]:04d}.db')


def _make_backup():
    """Copia de seguridad consistente antes de una operación destructiva."""
    dst = _backup_path()
    src = sqlite3.connect(get_db_path())
    bk = sqlite3.connect(dst)
    try:
        with bk:
            src.backup(bk)
    finally:
        bk.close()
        src.close()
    return dst


@maintenance_bp.route('/purge-sales', methods=['POST'])
@jwt_required()
@require_permission('settings', 'delete')
def purge_sales():
    """Borra tickets vendidos, devoluciones, historial de movimientos y registros de auditoría."""
    try:
        backup = _make_backup()
        db = Database(get_db_path())

        counts = {
            'returns': db.fetch_one('SELECT COUNT(*) FROM returns')[0],
            'sale_items': db.fetch_one('SELECT COUNT(*) FROM sale_items')[0],
            'sales': db.fetch_one('SELECT COUNT(*) FROM sales')[0],
            'inventory_movements': db.fetch_one('SELECT COUNT(*) FROM inventory_movements')[0],
            'change_log': db.fetch_one('SELECT COUNT(*) FROM change_log')[0],
        }

        with db.transaction() as conn:
            conn.execute('DELETE FROM returns')
            conn.execute('DELETE FROM sale_items')
            conn.execute('DELETE FROM sales')
            conn.execute('DELETE FROM inventory_movements')
            conn.execute('DELETE FROM change_log')
            for t in ('returns', 'sale_items', 'sales', 'inventory_movements', 'change_log'):
                conn.execute('DELETE FROM sqlite_sequence WHERE name = ?', (t,))

        return jsonify({
            'message': 'Ventas, devoluciones e historial depurados correctamente',
            'deleted': counts,
            'backup': os.path.basename(backup)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@maintenance_bp.route('/reset-stock', methods=['POST'])
@jwt_required()
@require_permission('settings', 'delete')
def reset_stock():
    """Pone en 0 el stock general de todos los productos y las cantidades de lotes pendientes."""
    try:
        backup = _make_backup()
        db = Database(get_db_path())

        products = db.fetch_all('''
            SELECT id, name, barcode, stock FROM products WHERE active = 1 AND stock <> 0
        ''')

        lots = db.fetch_all('''
            SELECT id, product_id, batch_number, current_quantity FROM lots WHERE current_quantity <> 0
        ''')

        n_products = 0
        user_id = current_user_id()
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with db.transaction() as conn:
            # Stock general de productos
            for p in products:
                conn.execute('''
                    INSERT INTO inventory_movements
                        (product_id, lot_id, movement_type, quantity, reference_id, notes,
                         created_at, created_by, product_name, product_barcode, lot_batch)
                    VALUES (?, NULL, 'adjustment', ?, NULL, 'Puesta en cero de stock general (Mantenimiento)',
                            ?, ?, ?, ?, NULL)
                ''', (p['id'], -float(p['stock'] or 0), now, user_id, p['name'], p['barcode']))
                conn.execute('UPDATE products SET stock = 0 WHERE id = ?', (p['id'],))
                n_products += 1

            # Cantidades de lotes pendientes
            for l in lots:
                conn.execute('UPDATE lots SET current_quantity = 0 WHERE id = ?', (l['id'],))

        return jsonify({
            'message': 'Stock general puesto en 0',
            'products_adjusted': n_products,
            'lots_updated': len(lots),
            'backup': os.path.basename(backup)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@maintenance_bp.route('/purge-catalog', methods=['POST'])
@jwt_required()
@require_permission('settings', 'delete')
def purge_catalog():
    """Vacía productos, categorías, lotes y dependencias para reimportar el catálogo desde cero."""
    try:
        backup = _make_backup()
        db = Database(get_db_path())

        tables = ['returns', 'sale_items', 'sales', 'promotion_products', 'promotion_categories',
                  'promotions', 'lots', 'price_history', 'inventory_movements', 'change_log',
                  'products', 'categories']
        counts = {t: db.fetch_one(f'SELECT COUNT(*) FROM {t}')[0] for t in tables}

        with db.transaction() as conn:
            for t in tables:
                conn.execute(f'DELETE FROM {t}')
                conn.execute('DELETE FROM sqlite_sequence WHERE name = ?', (t,))

        return jsonify({
            'message': 'Catálogo vaciado correctamente',
            'deleted': counts,
            'backup': os.path.basename(backup)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500