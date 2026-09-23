from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

def _current_user_id():
    try:
        v = get_jwt_identity()
        return int(v) if v is not None else None
    except Exception:
        return None
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import datetime as _dt
from config import get_db_path
from utils.database import Database
from utils.movements import log_movement
from utils.permissions import require_permission

lots_bp = Blueprint('lots', __name__)


@lots_bp.route('/', methods=['GET'])
@jwt_required()
def get_lots():
    try:
        db = Database(get_db_path())
        product_id = request.args.get('product_id')
        show_empty = request.args.get('show_empty', '0')

        query = '''
            SELECT l.*, p.name as product_name, p.barcode, p.price,
                   c.id as category_id, c.name as category_name, c.color as category_color
            FROM lots l
            JOIN products p ON l.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE 1=1
        '''
        params = []

        if product_id:
            query += ' AND l.product_id = ?'
            params.append(product_id)

        if show_empty != '1':
            query += ' AND l.current_quantity > 0'

        query += ' ORDER BY l.expiry_date ASC'
        lots = db.fetch_all(query, params)
        lots = [dict(l) for l in lots]
        from datetime import datetime, date
        today = date.today()
        for lot in lots:
            expiry = lot.get('expiry_date')
            try:
                if isinstance(expiry, str):
                    expiry = datetime.strptime(expiry[:10], '%Y-%m-%d').date()
                if hasattr(expiry, 'year'):
                    lot['days_left'] = (expiry - today).days
                    lot['is_expired'] = lot['days_left'] < 0
                else:
                    lot['days_left'] = None
                    lot['is_expired'] = False
            except Exception:
                lot['days_left'] = None
                lot['is_expired'] = False
        return jsonify(lots), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/by-product/<int:product_id>', methods=['GET'])
@jwt_required()
def get_lots_by_product(product_id):
    try:
        db = Database(get_db_path())
        rows = db.fetch_all('''
            SELECT l.id, l.product_id, l.batch_number, l.expiry_date,
                   l.current_quantity, l.sale_price, p.price as product_price,
                   p.barcode, p.name as product_name, p.cost
            FROM lots l
            JOIN products p ON l.product_id = p.id
            WHERE l.product_id = ? AND l.current_quantity > 0
            ORDER BY l.sale_price ASC, l.expiry_date ASC
        ''', (product_id,))
        return jsonify([dict(r) for r in rows]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/by-product/<int:product_id>/summary', methods=['GET'])
@jwt_required()
def get_product_stock_summary(product_id):
    try:
        db = Database(get_db_path())
        product = db.fetch_one('''
            SELECT p.id, p.name, p.barcode, p.price, p.cost, p.stock,
                   c.name as category_name, c.color as category_color
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = ? AND p.active = 1
        ''', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404
        d = dict(product)
        lots = db.fetch_all('''
            SELECT id, batch_number, expiry_date, current_quantity, sale_price
            FROM lots
            WHERE product_id = ? AND current_quantity > 0
            ORDER BY expiry_date ASC
        ''', (product_id,))
        lots_list = [dict(l) for l in lots]
        lots_total = sum(float(l.get('current_quantity') or 0) for l in lots_list)
        product_stock = float(d.get('stock') or 0)
        effective = lots_total + product_stock
        d['effective_stock'] = effective
        d['product_stock'] = product_stock
        d['lots_total'] = lots_total
        d['has_lots'] = lots_total > 0
        d['lots'] = lots_list
        return jsonify(d), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/<int:lot_id>', methods=['GET'])
@jwt_required()
def get_lot(lot_id):
    try:
        db = Database(get_db_path())
        lot = dict(db.fetch_one('''
            SELECT l.*, p.name as product_name, p.barcode, p.price
            FROM lots l
            JOIN products p ON l.product_id = p.id
            WHERE l.id = ?
        ''', (lot_id,)))

        if not lot:
            return jsonify({'error': 'Lote no encontrado'}), 404

        return jsonify(dict(lot)), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/', methods=['POST'])
@jwt_required()
@require_permission('products', 'create')
def create_lot():
    try:
        data = request.get_json()
        product_id = data.get('product_id')
        batch_number = data.get('batch_number', '')
        production_date = data.get('production_date')
        expiry_date = data.get('expiry_date')
        initial_quantity = data.get('initial_quantity', 0)
        location = data.get('location', 'principal')
        sale_price = data.get('sale_price', 0)

        if not product_id or not expiry_date:
            return jsonify({'error': 'Producto y fecha de caducidad son requeridos'}), 400

        if not sale_price or float(sale_price) <= 0:
            return jsonify({'error': 'El precio de venta del lote es requerido (mayor a 0)'}), 400

        db = Database(get_db_path())

        product = db.fetch_one('SELECT id, name, price, stock FROM products WHERE id = ?', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404

        avail = float(product['stock'] or 0)
        if float(initial_quantity or 0) > avail:
            return jsonify({
                'error': f'No hay suficientes existencias en el stock general: solo {avail:g} pieza(s) disponible(s)',
                'available': avail
            }), 400

        cursor = db.execute('''
            INSERT INTO lots (product_id, batch_number, production_date, expiry_date, initial_quantity, current_quantity, location, sale_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (product_id, batch_number, production_date, expiry_date, initial_quantity, initial_quantity, location, sale_price))

        lot_id = cursor.lastrowid

        db.execute('UPDATE products SET stock = stock - ? WHERE id = ?', (initial_quantity, product_id))

        log_movement(db, product_id=product_id, lot_id=lot_id, movement_type='entry',
                     quantity=initial_quantity, notes=f'Entrada de lote #{lot_id} (desde stock general)')

        return jsonify({
            'message': 'Lote creado exitosamente',
            'id': lot_id
        }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/<int:lot_id>', methods=['PUT'])
@jwt_required()
@require_permission('products', 'edit')
def update_lot(lot_id):
    try:
        data = request.get_json()
        db = Database(get_db_path())

        lot = db.fetch_one('SELECT * FROM lots WHERE id = ?', (lot_id,))
        if not lot:
            return jsonify({'error': 'Lote no encontrado'}), 404

        batch_number = data.get('batch_number')
        expiry_date = data.get('expiry_date')
        location = data.get('location')

        updates = []
        params = []

        if batch_number is not None:
            updates.append('batch_number = ?')
            params.append(batch_number)

        if expiry_date is not None:
            updates.append('expiry_date = ?')
            params.append(expiry_date)

        if location is not None:
            updates.append('location = ?')
            params.append(location)

        if data.get('sale_price') is not None:
            updates.append('sale_price = ?')
            params.append(float(data['sale_price']))

        if not updates:
            return jsonify({'error': 'No hay datos para actualizar'}), 400

        params.append(lot_id)
        query = f'UPDATE lots SET {", ".join(updates)} WHERE id = ?'
        db.execute(query, params)

        changes = []
        if batch_number is not None and batch_number != lot['batch_number']:
            changes.append(f'Lote: {lot["batch_number"] or "—"} → {batch_number or "—"}')
        if expiry_date is not None and expiry_date != lot['expiry_date']:
            changes.append(f'Caducidad: {lot["expiry_date"] or "—"} → {expiry_date}')
        if location is not None and location != lot['location']:
            changes.append(f'Ubicación: {lot["location"] or "—"} → {location}')
        if data.get('sale_price') is not None and float(data['sale_price']) != float(lot['sale_price'] or 0):
            changes.append(f'Precio de venta: ${float(lot["sale_price"] or 0)} → ${float(data["sale_price"])}')
        if changes:
            log_movement(db, product_id=lot['product_id'], lot_id=lot_id, movement_type='lot_updated',
                         notes='; '.join(changes))

        return jsonify({'message': 'Lote actualizado exitosamente'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/<int:lot_id>', methods=['DELETE'])
@jwt_required()
@require_permission('products', 'delete')
def delete_lot(lot_id):
    try:
        db = Database(get_db_path())

        lot = db.fetch_one('SELECT * FROM lots WHERE id = ?', (lot_id,))
        if not lot:
            return jsonify({'error': 'Lote no encontrado'}), 404

        remaining = float(lot['current_quantity'] or 0)

        if remaining > 0:
            db.execute('UPDATE products SET stock = stock + ? WHERE id = ?', (remaining, lot['product_id']))
            log_movement(db, product_id=lot['product_id'], movement_type='entry',
                         quantity=remaining, lot_batch=lot['batch_number'],
                         notes=f'Lote #{lot_id} eliminado: {remaining:g} pieza(s) regresadas al stock general')

        db.execute('UPDATE inventory_movements SET lot_id = NULL WHERE lot_id = ?', (lot_id,))
        db.execute('DELETE FROM lots WHERE id = ?', (lot_id,))

        log_movement(db, product_id=lot['product_id'], movement_type='lot_deleted',
                     lot_batch=lot['batch_number'],
                     notes=f'Lote eliminado: {lot["batch_number"] or ""}'.strip())

        return jsonify({'message': 'Lote eliminado exitosamente'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/for-product/<int:product_id>', methods=['GET'])
@jwt_required()
def get_lots_for_product(product_id):
    try:
        db = Database(get_db_path())

        lots = db.fetch_all('''
            SELECT * FROM lots
            WHERE product_id = ? AND current_quantity > 0
            ORDER BY expiry_date ASC
        ''', (product_id,))
        lots = [dict(l) for l in lots]

        for lot in lots:
            from datetime import datetime, date
            expiry = lot['expiry_date']
            try:
                if isinstance(expiry, str):
                    expiry = datetime.strptime(expiry[:10], '%Y-%m-%d').date()
                elif not hasattr(expiry, 'year'):
                    expiry = date.fromordinal(int(expiry))
            except Exception:
                expiry = date.today()
            lot['days_left'] = (expiry - date.today()).days

        return jsonify([dict(l) for l in lots]), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/best-for/<int:product_id>', methods=['GET'])
@jwt_required()
def get_best_lot(product_id):
    try:
        db = Database(get_db_path())

        lot = dict(db.fetch_one('''
            SELECT * FROM lots
            WHERE product_id = ? AND current_quantity > 0
            ORDER BY expiry_date ASC
            LIMIT 1
        ''', (product_id,)))

        if not lot:
            return jsonify({'error': 'No hay lotes disponibles para este producto'}), 404

        return jsonify(dict(lot)), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@lots_bp.route('/adjust-stock', methods=['POST'])
@jwt_required()
@require_permission('products', 'edit')
def adjust_stock():
    try:
        data = request.get_json()
        lot_id = data.get('lot_id')
        new_quantity = data.get('current_quantity')
        reason = data.get('reason', '')

        if not lot_id or new_quantity is None:
            return jsonify({'error': 'Lote y nueva cantidad son requeridos'}), 400

        db = Database(get_db_path())

        lot = db.fetch_one('SELECT * FROM lots WHERE id = ?', (lot_id,))
        if not lot:
            return jsonify({'error': 'Lote no encontrado'}), 404

        base_prev = float(db.fetch_one('SELECT stock FROM products WHERE id = ?', (lot['product_id'],))['stock'] or 0)

        diff = new_quantity - lot['current_quantity']

        if diff > 0:
            base_row = db.fetch_one('SELECT stock FROM products WHERE id = ?', (lot['product_id'],))
            avail = float(base_row['stock'] or 0) if base_row else 0
            if diff > avail:
                return jsonify({
                    'error': f'Solo hay {avail:g} pieza(s) en el stock general para subir el lote',
                    'available': avail
                }), 400
            db.execute('UPDATE products SET stock = stock - ? WHERE id = ?', (diff, lot['product_id']))
        elif diff < 0:
            db.execute('UPDATE products SET stock = stock + ? WHERE id = ?', (abs(diff), lot['product_id']))

        db.execute('UPDATE lots SET current_quantity = ? WHERE id = ?', (new_quantity, lot_id))

        log_movement(db, product_id=lot['product_id'], lot_id=lot_id, movement_type='adjustment',
                     quantity=diff, notes=reason)

        return jsonify({
            'message': 'Stock ajustado',
            'previous': lot['current_quantity'],
            'new': new_quantity,
            'difference': diff,
            'base_previous': base_prev,
            'base_new': round(base_prev - diff, 2),
            'sync': True
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
