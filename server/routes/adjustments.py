from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database
from utils.movements import log_movement
from utils.permissions import require_permission

adjustments_bp = Blueprint('adjustments', __name__)


def _current_user_id():
    try:
        v = get_jwt_identity()
        return int(v) if v is not None else None
    except Exception:
        return None


@adjustments_bp.route('/product/<int:product_id>', methods=['GET'])
@jwt_required()
@require_permission('products', 'edit')
def get_adjustment_product(product_id):
    """Detalle completo de un producto para la vista de ajustes."""
    try:
        db = Database(get_db_path())
        product = db.fetch_one('''
            SELECT p.*, c.name as category_name, c.color as category_color
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = ? AND p.active = 1
        ''', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404

        d = dict(product)
        lots = db.fetch_all('''
            SELECT l.*, p.price as product_price, p.cost as product_cost,
                   c.name as category_name
            FROM lots l
            JOIN products p ON l.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE l.product_id = ?
            ORDER BY l.expiry_date ASC
        ''', (product_id,))
        lots = [dict(l) for l in lots]

        # Inyectar stock general como lote ficticio
        general_stock = float(d.get('stock') or 0)
        lots.insert(0, {
            'id': 0,
            'batch_number': 'GENERAL',
            'current_quantity': general_stock,
            'expiry_date': None,
            'is_expired': False
        })

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

        lots_total = sum(float(l.get('current_quantity') or 0) for l in lots)
        product_stock = float(d.get('stock') or 0)
        d['effective_stock'] = product_stock + lots_total
        d['product_stock'] = product_stock
        d['lots_total'] = lots_total
        d['has_lots'] = len(lots) > 0
        d['lots'] = lots
        return jsonify(d), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@adjustments_bp.route('/', methods=['POST'])
@jwt_required()
@require_permission('products', 'edit')
def apply_adjustment():
    """
    Ajuste de inventario estilo "ajustar inventario":
    - Ajusta stock general del producto o un lote específico
    - Ajusta precio de venta y costo del producto
    - Nunca permite stock negativo (mínimo 0)
    """
    try:
        data = request.get_json()
        product_id = data.get('product_id')
        lot_id = data.get('lot_id')
        reason = (data.get('reason') or '').strip()

        db = Database(get_db_path())

        # Transacción atómica: el ajuste (stock/lotes/precios/movimientos) es todo o nada
        with db.write():
            product = db.fetch_one('''
                SELECT p.*, c.name as category_name, c.color as category_color
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.id = ? AND p.active = 1
            ''', (product_id,))
            if not product:
                return jsonify({'error': 'Producto no encontrado'}), 404

            lot = None
            if lot_id:
                lot = db.fetch_one('SELECT * FROM lots WHERE id = ? AND product_id = ?', (lot_id, product_id))
                if not lot:
                    return jsonify({'error': 'El lote seleccionado no pertenece al producto'}), 400

            # Determinar cantidad actual y nueva cantidad
            if lot:
                current_quantity = float(lot['current_quantity'] or 0)
            else:
                current_quantity = float(product['stock'] or 0)

            new_quantity = data.get('new_quantity')
            adjustment = data.get('adjustment')
            if new_quantity is None and adjustment is None:
                # Sin ajuste de stock: se permite guardar solo precios/costo
                new_quantity = current_quantity

            if new_quantity is None:
                try:
                    adjustment = float(adjustment)
                except (TypeError, ValueError):
                    return jsonify({'error': 'El ajuste debe ser un número válido'}), 400
                new_quantity = current_quantity + adjustment

            try:
                new_quantity = float(new_quantity)
            except (TypeError, ValueError):
                return jsonify({'error': 'La nueva cantidad debe ser un número válido'}), 400

            if new_quantity < 0:
                return jsonify({
                    'error': 'El stock no puede ser negativo. El mínimo permitido es 0',
                    'minimum': 0
                }), 400

            # Validaciones adicionales
            if lot:
                # Al subir un lote se toma del stock general; al bajar regresa al stock general
                diff = new_quantity - current_quantity
                if diff > 0:
                    base_row = db.fetch_one('SELECT stock FROM products WHERE id = ?', (product_id,))
                    avail = float(base_row['stock'] or 0) if base_row else 0
                    if diff > avail:
                        return jsonify({
                            'error': f'Solo hay {avail:g} pieza(s) en el stock general para subir el lote',
                            'available': avail
                        }), 400
                    db.execute('UPDATE products SET stock = stock - ? WHERE id = ?', (diff, product_id))
                elif diff < 0:
                    db.execute('UPDATE products SET stock = stock + ? WHERE id = ?', (abs(diff), product_id))
                db.execute('UPDATE lots SET current_quantity = ? WHERE id = ?', (new_quantity, lot_id))
                target_label = f'lote {lot["batch_number"] or "#" + str(lot_id)}'
            else:
                diff = new_quantity - current_quantity
                db.execute('UPDATE products SET stock = ? WHERE id = ?', (new_quantity, product_id))
                target_label = 'stock general'

            # Ajuste de precio de venta del producto
            price_changed = False
            if data.get('new_price') is not None and str(data.get('new_price')).strip() != '':
                try:
                    new_price = float(data['new_price'])
                    if new_price < 0:
                        return jsonify({'error': 'El precio de venta no puede ser negativo'}), 400
                    old_price = float(product['price'] or 0)
                    if new_price != old_price:
                        db.execute('UPDATE products SET price = ? WHERE id = ?', (new_price, product_id))
                        log_movement(db, product_id=product_id, movement_type='price_changed',
                                     notes=f'Precio: ${old_price:.2f} → ${new_price:.2f} (Ajuste: {reason})')
                        price_changed = True
                except (TypeError, ValueError):
                    return jsonify({'error': 'El precio de venta debe ser un número válido'}), 400

            # Ajuste de costo del producto
            cost_changed = False
            if data.get('new_cost') is not None and str(data.get('new_cost')).strip() != '':
                try:
                    new_cost = float(data['new_cost'])
                    if new_cost < 0:
                        return jsonify({'error': 'El costo no puede ser negativo'}), 400
                    old_cost = float(product['cost'] or 0)
                    if new_cost != old_cost:
                        db.execute('UPDATE products SET cost = ? WHERE id = ?', (new_cost, product_id))
                        cost_changed = True
                except (TypeError, ValueError):
                    return jsonify({'error': 'El costo debe ser un número válido'}), 400

            # Ajuste de precio del lote (si aplica)
            lot_price_changed = False
            if lot and data.get('new_lot_price') is not None and str(data.get('new_lot_price')).strip() != '':
                try:
                    new_lot_price = float(data['new_lot_price'])
                    if new_lot_price < 0:
                        return jsonify({'error': 'El precio del lote no puede ser negativo'}), 400
                    old_lot_price = float(lot['sale_price'] or 0)
                    if new_lot_price != old_lot_price:
                        db.execute('UPDATE lots SET sale_price = ? WHERE id = ?', (new_lot_price, lot_id))
                        log_movement(db, product_id=product_id, lot_id=lot_id, movement_type='lot_updated',
                                     notes=f'Precio de lote: ${old_lot_price:.2f} → ${new_lot_price:.2f} (Ajuste: {reason})')
                        lot_price_changed = True
                except (TypeError, ValueError):
                    return jsonify({'error': 'El precio del lote debe ser un número válido'}), 400

            # Si no hubo ningún cambio real (stock ni precios), no hay nada que guardar
            if diff == 0 and not price_changed and not cost_changed and not lot_price_changed:
                return jsonify({'error': 'No se detectaron cambios para guardar'}), 400

            # Registrar movimiento de inventario (solo si hubo cambio de stock)
            if diff != 0:
                movement_type = 'adjustment'
                log_movement(db, product_id=product_id, lot_id=lot_id if lot else None,
                             movement_type=movement_type, quantity=diff,
                             notes=f'Ajuste: {reason}. Objetivo: {target_label}')

            # Registro en change_log
            db.execute('''
                INSERT INTO change_log (table_name, record_id, action, data, source, device_id, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                'inventory_adjustment',
                product_id,
                'adjustment',
                f'{{"product_id":{product_id},"lot_id":{lot_id if lot else "null"},"previous":{current_quantity},"new":{new_quantity},"reason":"{reason}"}}',
                'pos',
                'server',
                _current_user_id()
            ))

            return jsonify({
                'message': 'Ajuste realizado exitosamente',
                'product_id': product_id,
                'product_name': product['name'],
                'lot_id': lot_id if lot else None,
                'target': target_label,
                'previous': current_quantity,
                'new': new_quantity,
                'diff': diff,
                'price_changed': price_changed,
                'cost_changed': cost_changed,
                'lot_price_changed': lot_price_changed
            }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
