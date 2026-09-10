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
from config import get_db_path
from utils.database import Database
from utils.movements import log_movement
from utils.security import Security
from datetime import datetime as _dt

sales_bp = Blueprint('sales', __name__)

@sales_bp.route('/', methods=['GET'])
@jwt_required()
def get_sales():
    try:
        db = Database(get_db_path())
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        limit = request.args.get('limit', 100)
        q = request.args.get('q', '').strip()
        status = request.args.get('status', '').strip()

        query = '''
            SELECT s.*, u.full_name as cashier_full_name,
                   (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count,
                   (SELECT COALESCE(SUM(ret.amount), 0) FROM returns ret WHERE ret.sale_id = s.id) as returned_amount
            FROM sales s
            LEFT JOIN users u ON s.cashier_id = u.id
            WHERE 1=1
        '''
        params = []

        if date_from:
            query += ' AND DATE(s.sale_date) >= ?'
            params.append(date_from)

        if date_to:
            query += ' AND DATE(s.sale_date) <= ?'
            params.append(date_to)

        if status:
            query += ' AND s.status = ?'
            params.append(status)

        if q:
            like_q = f'%{q}%'
            query += r'''
                AND (CAST(s.id AS TEXT) LIKE ? ESCAPE '\'
                     OR LOWER(s.customer_name) LIKE LOWER(?) ESCAPE '\'
                     OR LOWER(s.cashier_name) LIKE LOWER(?) ESCAPE '\'
                     OR LOWER(s.notes) LIKE LOWER(?) ESCAPE '\'
                     OR EXISTS (
                         SELECT 1 FROM sale_items si2
                         LEFT JOIN products p2 ON p2.id = si2.product_id
                         WHERE si2.sale_id = s.id
                           AND (LOWER(p2.name) LIKE LOWER(?) ESCAPE '\'
                                OR p2.barcode LIKE ? ESCAPE '\')
                     ))
            '''
            params += [like_q, q, q, q, like_q, like_q]

        query += ' ORDER BY s.sale_date DESC LIMIT ?'
        params.append(int(limit))

        sales = db.fetch_all(query, params)
        return jsonify([dict(s) for s in sales]), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@sales_bp.route('/<int:sale_id>', methods=['GET'])
@jwt_required()
def get_sale(sale_id):
    try:
        db = Database(get_db_path())
        sale = db.fetch_one('''
            SELECT s.*, u.full_name as cashier_full_name
            FROM sales s
            LEFT JOIN users u ON s.cashier_id = u.id
            WHERE s.id = ?
        ''', (sale_id,))
        
        if not sale:
            return jsonify({'error': 'Venta no encontrada'}), 404
        
        items = db.fetch_all('''
            SELECT si.*, p.name as product_name, p.barcode,
                   l.batch_number, l.expiry_date,
                   (SELECT COALESCE(SUM(ret.amount), 0) FROM returns ret WHERE ret.sale_item_id = si.id) as returned_amount
            FROM sale_items si
            LEFT JOIN products p ON si.product_id = p.id
            LEFT JOIN lots l ON si.lot_id = l.id
            WHERE si.sale_id = ?
        ''', (sale_id,))
        
        result = dict(sale)
        result['items'] = [dict(item) for item in items]
        
        return jsonify(result), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@sales_bp.route('/', methods=['POST'])
@jwt_required()
def create_sale():
    try:
        data = request.get_json()
        items = data.get('items', [])
        payment_method = data.get('payment_method', 'cash')
        amount_tendered = data.get('amount_tendered', 0)
        cashier_id = get_jwt_identity()
        force_no_stock = data.get('force_no_stock', False)

        if not items:
            return jsonify({'error': 'No se especificaron artículos para la venta'}), 400

        db = Database(get_db_path())

        # Todo el flujo dentro de una transacción atómica + candado de escritura:
        # la validación de stock y el descuento ocurren dentro del mismo bloque,
        # así dos cobros simultáneos no pueden restar stock dos veces.
        with db.write():
            # Bloqueo: requiere un turno de caja activo para registrar ventas
            active_register = db.fetch_one("SELECT id FROM cash_registers WHERE status = 'open' ORDER BY id DESC LIMIT 1")
            if not active_register:
                return jsonify({
                    'error': 'No hay un turno de caja abierto. Abre un turno antes de vender.',
                    'shift_required': True
                }), 409
            cash_register_id = active_register['id']

            cashier = db.fetch_one('SELECT full_name FROM users WHERE id = ?', (cashier_id,))
            cashier_name = cashier['full_name'] if cashier else 'Desconocido'

            subtotal = 0
            total_discount = 0

            for item in items:
                product_id = item.get('product_id')
                quantity = item.get('quantity', 0)
                unit_price = item.get('unit_price', 0)
                line_subtotal = quantity * unit_price
                subtotal += line_subtotal

                product = db.fetch_one('''
                    SELECT p.id, p.category_id, p.price, p.name FROM products p WHERE p.id = ?
                ''', (product_id,))
                if not product:
                    continue

                promotions = db.fetch_all('''
                    SELECT p.*,
                           GROUP_CONCAT(pr.product_id) as product_ids,
                           GROUP_CONCAT(pc.category_id) as category_ids
                    FROM promotions p
                    LEFT JOIN promotion_products pr ON p.id = pr.promotion_id
                    LEFT JOIN promotion_categories pc ON p.id = pc.promotion_id
                    WHERE p.active = 1
                    AND (p.end_date IS NULL OR p.end_date >= DATE('now'))
                    AND (p.start_date IS NULL OR p.start_date <= DATE('now'))
                    GROUP BY p.id
                ''')

                best_discount = 0
                for promo in promotions:
                    promo_ids = [int(x) for x in (promo['product_ids'] or '').split(',') if x]
                    promo_cats = [int(x) for x in (promo['category_ids'] or '').split(',') if x]

                    applies = False
                    if promo_ids and product_id in promo_ids:
                        applies = True
                    elif promo_cats and product['category_id'] in promo_cats:
                        applies = True
                    elif not promo_ids and not promo_cats:
                        applies = True

                    if not applies:
                        continue

                    discount = 0
                    if promo['type'] == 'bogo':
                        if quantity >= promo['buy_quantity']:
                            promo_qty = (quantity // promo['buy_quantity']) * promo['pay_quantity']
                            free_qty = quantity - promo_qty
                            discount = free_qty * unit_price
                    elif promo['type'] == 'fixed_price':
                        buy_q = promo['buy_quantity'] or 0
                        fix_p = promo['fixed_price'] or 0
                        if buy_q > 0 and fix_p > 0 and quantity >= buy_q and fix_p < buy_q * unit_price:
                            groups = quantity // buy_q
                            complete_items = groups * buy_q
                            regular_price = complete_items * unit_price
                            promo_total = groups * fix_p
                            discount = regular_price - promo_total
                    elif promo['type'] == 'percent':
                        discount = line_subtotal * (promo['discount_percent'] / 100)
                    elif promo['type'] == 'fixed_discount':
                        discount = promo['discount_amount'] * quantity

                    if discount > best_discount:
                        best_discount = discount

                item['discount'] = round(best_discount, 2)
                total_discount += best_discount

            manual_discount = data.get('discount', 0)
            total_discount += manual_discount
            total = subtotal - total_discount
            change_given = amount_tendered - total if amount_tendered > total else 0

            if not force_no_stock:
                overstock = []
                reserved_lot = {}
                reserved_base = {}
                reserved_source_lots = {}
                for item in items:
                    product_id = item.get('product_id')
                    quantity = item.get('quantity', 0)
                    lot_id = item.get('lot_id')
                    p = db.fetch_one('SELECT id, name, stock FROM products WHERE id = ?', (product_id,))
                    if not p:
                        overstock.append({'product_id': product_id, 'name': f'#{product_id}', 'available': 0, 'requested': quantity})
                        continue
                    pname = p['name']
                    if lot_id:
                        lot = db.fetch_one('SELECT current_quantity FROM lots WHERE id = ? AND product_id = ?', (lot_id, product_id))
                        avail = float(lot['current_quantity'] or 0) if lot else 0
                        used = reserved_lot.get(lot_id, 0)
                        if used + quantity > avail:
                            overstock.append({'product_id': product_id, 'name': pname, 'available': avail - used, 'requested': quantity})
                        else:
                            reserved_lot[lot_id] = used + quantity
                    else:
                        base = float(p['stock'] or 0)
                        used_base = reserved_base.get(product_id, 0)
                        if base - used_base >= quantity:
                            reserved_base[product_id] = used_base + quantity
                        else:
                            lots_total = db.fetch_one('SELECT COALESCE(SUM(current_quantity), 0) as t FROM lots WHERE product_id = ? AND current_quantity > 0', (product_id,))['t'] or 0
                            if lots_total > 0:
                                used_lots = reserved_source_lots.get(product_id, 0)
                                if used_lots + quantity > float(lots_total):
                                    overstock.append({'product_id': product_id, 'name': pname, 'available': float(lots_total) - used_lots, 'requested': quantity})
                                else:
                                    reserved_source_lots[product_id] = used_lots + quantity
                            else:
                                overstock.append({'product_id': product_id, 'name': pname, 'available': base - used_base, 'requested': quantity})
                if overstock:
                    return jsonify({
                        'error': 'Sin existencias suficientes',
                        'overstock': overstock
                    }), 400

            cursor = db.execute('''
                INSERT INTO sales (sale_date, subtotal, total, payment_method, cashier_id, cashier_name, amount_tendered, change_given, customer_name, notes, cash_register_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (_dt.now().strftime('%Y-%m-%d %H:%M:%S'), subtotal, total, payment_method, cashier_id, cashier_name, amount_tendered, change_given,
                  data.get('customer_name') or None, data.get('notes') or None, cash_register_id))

            sale_id = cursor.lastrowid

            for item in items:
                product_id = item.get('product_id')
                lot_id = item.get('lot_id')
                quantity = item.get('quantity', 0)
                client_unit_price = item.get('unit_price', 0)
                item_discount = item.get('discount', 0)

                used_base = False
                if not lot_id:
                    base_row = db.fetch_one('SELECT stock FROM products WHERE id = ?', (product_id,))
                    base_stock = float(base_row['stock'] or 0) if base_row else 0
                    if base_stock >= quantity:
                        used_base = True
                    else:
                        best = db.fetch_one('''
                            SELECT id, current_quantity, sale_price FROM lots
                            WHERE product_id = ? AND current_quantity >= ?
                            ORDER BY expiry_date ASC
                            LIMIT 1
                        ''', (product_id, quantity))
                        if best:
                            lot_id = best['id']

                if not lot_id and not used_base:
                    any_lot = db.fetch_one('''
                        SELECT id, current_quantity, sale_price FROM lots
                        WHERE product_id = ? AND current_quantity > 0
                        ORDER BY expiry_date ASC
                        LIMIT 1
                    ''', (product_id,))
                    if any_lot:
                        lot_id = any_lot['id']

                if lot_id:
                    lot_info = db.fetch_one('SELECT sale_price, current_quantity FROM lots WHERE id = ?', (lot_id,))
                    if lot_info and lot_info['sale_price'] and lot_info['sale_price'] > 0:
                        unit_price = lot_info['sale_price']
                    else:
                        unit_price = client_unit_price
                        if unit_price <= 0:
                            price_row = db.fetch_one('SELECT price FROM products WHERE id = ?', (product_id,))
                            unit_price = price_row['price'] if price_row else 0
                else:
                    unit_price = client_unit_price
                    if unit_price <= 0:
                        price_row = db.fetch_one('SELECT price FROM products WHERE id = ?', (product_id,))
                        unit_price = price_row['price'] if price_row else 0

                item_total = quantity * unit_price - item_discount

                db.execute('''
                    INSERT INTO sale_items (sale_id, product_id, lot_id, quantity, unit_price, total, discount)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (sale_id, product_id, lot_id, quantity, unit_price, item_total, item_discount))

                log_movement(db, product_id=product_id, lot_id=lot_id, movement_type='sale',
                             quantity=-quantity, reference_id=sale_id,
                             notes='Venta sin stock' if force_no_stock and not lot_id else None)

                if lot_id:
                    db.execute('''
                        UPDATE lots SET current_quantity = MAX(0, current_quantity - ?) WHERE id = ?
                    ''', (quantity, lot_id))
                elif used_base:
                    db.execute('''
                        UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?
                    ''', (quantity, product_id))

            return jsonify({
                'message': 'Venta registrada exitosamente',
                'sale_id': sale_id,
                'subtotal': round(subtotal, 2),
                'discount': round(total_discount, 2),
                'total': round(total, 2),
                'change_given': round(change_given, 2),
                'customer_name': data.get('customer_name') or None,
                'notes': data.get('notes') or None,
                'sold_without_stock': force_no_stock
            }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@sales_bp.route('/<int:sale_id>/return', methods=['POST'])
@jwt_required()
def return_sale(sale_id):
    """Devolución parcial/completa de artículos de una venta.

    - Requiere la contraseña del dueño del turno si quien la hace no es el dueño.
    - Reembolsa el monto (resta de la caja del turno activo).
    - Devuelve el stock al lote correspondiente.
    - Marca el artículo como devuelto (sale_items.returned_quantity).
    """
    try:
        data = request.get_json() or {}
        items = data.get('items') or []
        owner_password = data.get('owner_password')
        reason = data.get('reason', '')
        refund_method = data.get('refund_method', 'cash')

        if not items:
            return jsonify({'error': 'No se especificaron artículos a devolver'}), 400

        db = Database(get_db_path())

        # Transacción atómica: la devolución (stock, movimientos, estado) es todo o nada
        with db.write():
            active_register = db.fetch_one("SELECT id, user_id FROM cash_registers WHERE status = 'open' ORDER BY id DESC LIMIT 1")
            if not active_register:
                return jsonify({
                    'error': 'No hay un turno de caja abierto. Abre un turno para devolver.',
                    'shift_required': True
                }), 409
            register_id = active_register['id']

            sale = db.fetch_one('SELECT * FROM sales WHERE id = ?', (sale_id,))
            if not sale:
                return jsonify({'error': 'Venta no encontrada'}), 404
            if sale['status'] == 'cancelled':
                return jsonify({'error': 'La venta ya fue cancelada'}), 400
            if sale['status'] == 'returned':
                return jsonify({'error': 'La venta ya fue devuelta por completo'}), 400

            owner_user_id = active_register['user_id']
            current_user_id = _current_user_id()
            is_owner = (current_user_id == owner_user_id)

            if not is_owner:
                if not owner_password:
                    return jsonify({
                        'error': 'Para devolver artículos debes confirmar con la contraseña del dueño del turno',
                        'requires_password': True,
                        'owner_user_id': owner_user_id
                    }), 403
                owner_user = db.fetch_one('SELECT password_hash FROM users WHERE id = ?', (owner_user_id,))
                if not owner_user or not Security.verify_password(owner_password, owner_user['password_hash']):
                    return jsonify({'error': 'Contraseña del dueño incorrecta'}), 403

            sale_items = db.fetch_all('SELECT * FROM sale_items WHERE sale_id = ?', (sale_id,))
            sale_items_by_id = {si['id']: dict(si) for si in sale_items}

            subtotal_returned = 0
            discount_returned = 0
            processed = []

            for it in items:
                sale_item_id = it.get('sale_item_id')
                quantity = float(it.get('quantity') or 0)
                item_refund_method = it.get('refund_method') or refund_method

                if sale_item_id not in sale_items_by_id:
                    return jsonify({'error': f'Artículo de venta #{sale_item_id} no encontrado'}), 404
                si = sale_items_by_id[sale_item_id]

                sold_qty = float(si['quantity'] or 0)
                already_returned = float(si.get('returned_quantity') or 0)
                available = sold_qty - already_returned
                if quantity <= 0:
                    return jsonify({'error': 'La cantidad a devolver debe ser mayor a 0'}), 400
                if quantity > available + 0.001:
                    return jsonify({'error': f'No se pueden devolver {quantity:g} de este artículo (disponibles {available:g})'}), 400

                # Precio unitario con descuento proporcional aplicado
                unit_price = float(si['unit_price'] or 0)
                item_discount = float(si['discount'] or 0)
                item_total = float(si['total'] or 0)

                # Monto a reembolsar por esta devolución (descuento proporcional)
                per_unit_discount = item_discount / sold_qty if sold_qty > 0 else 0
                return_amount = round((unit_price - per_unit_discount) * quantity, 2)

                # Devolver stock al lote (si el item tiene lote) o al stock del producto
                if si.get('lot_id'):
                    db.execute('UPDATE lots SET current_quantity = current_quantity + ? WHERE id = ?', (quantity, si['lot_id']))
                else:
                    db.execute('UPDATE products SET stock = stock + ? WHERE id = ?', (quantity, si['product_id']))

                # Registrar movimiento de inventario (return)
                log_movement(db, product_id=si['product_id'], lot_id=si['lot_id'], movement_type='return',
                             quantity=quantity, reference_id=sale_id, notes=f'Devolución venta #{sale_id}')

                # Marcar devuelto
                new_returned = already_returned + quantity
                db.execute('UPDATE sale_items SET returned_quantity = ? WHERE id = ?', (new_returned, sale_item_id))
                sale_items_by_id[sale_item_id]['returned_quantity'] = new_returned

                # Registrar en tabla returns y en la caja del turno
                db.execute('''
                    INSERT INTO returns (sale_id, sale_item_id, product_id, lot_id, quantity, amount, refund_method, reason, cash_register_id, returned_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (sale_id, sale_item_id, si['product_id'], si['lot_id'], quantity, return_amount,
                      item_refund_method, reason, register_id, _current_user_id(), _dt.now().strftime('%Y-%m-%d %H:%M:%S')))

                subtotal_returned += unit_price * quantity
                discount_returned += per_unit_discount * quantity
                processed.append({
                    'sale_item_id': sale_item_id,
                    'product_id': si['product_id'],
                    'quantity': quantity,
                    'amount': return_amount,
                    'refund_method': item_refund_method
                })

            # Determinar estado final de la venta
            total_sold_qty = sum(float(s['quantity'] or 0) for s in sale_items_by_id.values())
            total_returned_qty = sum(float(s.get('returned_quantity') or 0) for s in sale_items_by_id.values())

            if total_sold_qty > 0 and total_returned_qty >= total_sold_qty - 0.001:
                new_status = 'returned'
            else:
                new_status = 'partial_return' if total_returned_qty > 0 else 'active'
            db.execute('UPDATE sales SET status = ? WHERE id = ?', (new_status, sale_id))

            return jsonify({
                'message': 'Devolución registrada exitosamente',
                'sale_id': sale_id,
                'status': new_status,
                'subtotal_returned': round(subtotal_returned, 2),
                'discount_returned': round(discount_returned, 2),
                'total_returned': round(subtotal_returned - discount_returned, 2),
                'items': processed
            }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@sales_bp.route('/<int:sale_id>', methods=['DELETE'])
@jwt_required()
def cancel_sale(sale_id):
    try:
        data = request.get_json(silent=True) or {}
        owner_password = data.get('owner_password')

        db = Database(get_db_path())

        # Transacción atómica: la cancelación (stock, movimientos, estado) es todo o nada
        with db.write():
            sale = db.fetch_one('SELECT * FROM sales WHERE id = ?', (sale_id,))
            if not sale:
                return jsonify({'error': 'Venta no encontrada'}), 404
            if sale['status'] == 'cancelled':
                return jsonify({'error': 'La venta ya fue cancelada'}), 400

            active_register = db.fetch_one("SELECT id, user_id FROM cash_registers WHERE status = 'open' ORDER BY id DESC LIMIT 1")
            if not active_register:
                return jsonify({
                    'error': 'No hay un turno de caja abierto. Abre un turno para cancelar.',
                    'shift_required': True
                }), 409
            register_id = active_register['id']

            current_user_id = _current_user_id()
            owner_user_id = active_register['user_id']
            is_owner = (current_user_id == owner_user_id)

            if not is_owner:
                if not owner_password:
                    return jsonify({
                        'error': 'Para cancelar esta venta debes confirmar con la contraseña del dueño del turno',
                        'requires_password': True,
                        'owner_user_id': owner_user_id
                    }), 403
                owner_user = db.fetch_one('SELECT password_hash FROM users WHERE id = ?', (owner_user_id,))
                if not owner_user or not Security.verify_password(owner_password, owner_user['password_hash']):
                    return jsonify({'error': 'Contraseña del dueño incorrecta'}), 403

            items = db.fetch_all('SELECT * FROM sale_items WHERE sale_id = ?', (sale_id,))

            for item in items:
                returned_qty = float(item['returned_quantity'] or 0)
                remaining = float(item['quantity']) - returned_qty
                if remaining <= 0:
                    continue

                log_movement(db, product_id=item['product_id'], lot_id=item['lot_id'], movement_type='sale_cancelled',
                             quantity=remaining, reference_id=sale_id, notes=f'Venta #{sale_id} cancelada')

                if item['lot_id']:
                    db.execute('''
                        UPDATE lots SET current_quantity = current_quantity + ? WHERE id = ?
                    ''', (remaining, item['lot_id']))
                else:
                    db.execute('UPDATE products SET stock = stock + ? WHERE id = ?', (remaining, item['product_id']))

                # Reembolso del monto pendiente proporcional al descuento de la línea
                unit_price = float(item['unit_price'] or 0)
                item_discount = float(item['discount'] or 0)
                sold_qty = float(item['quantity'] or 0)
                per_unit_discount = item_discount / sold_qty if sold_qty > 0 else 0
                cancel_amount = round((unit_price - per_unit_discount) * remaining, 2)

                db.execute('''
                    INSERT INTO returns (sale_id, sale_item_id, product_id, lot_id, quantity, amount, refund_method, reason, cash_register_id, returned_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    sale_id, item['id'], item['product_id'], item['lot_id'],
                    remaining, cancel_amount,
                    sale['payment_method'] if sale['payment_method'] in ('cash', 'card', 'mixed') else 'cash',
                    f'Cancelación de venta #{sale_id}',
                    register_id, current_user_id,
                    _dt.now().strftime('%Y-%m-%d %H:%M:%S')
                ))

                db.execute('UPDATE sale_items SET returned_quantity = quantity WHERE id = ?', (item['id'],))

            log_movement(db, product_id=None, movement_type='sale_cancelled', quantity=0,
                         reference_id=sale_id, notes='Venta cancelada')

            db.execute('UPDATE sales SET status = \'cancelled\' WHERE id = ?', (sale_id,))

            return jsonify({'message': 'Venta cancelada exitosamente'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@sales_bp.route('/today', methods=['GET'])
@jwt_required()
def get_today_sales():
    try:
        db = Database(get_db_path())
        
        sales = db.fetch_all('''
            SELECT s.*, u.full_name as cashier_full_name
            FROM sales s
            LEFT JOIN users u ON s.cashier_id = u.id
            WHERE DATE(s.sale_date) = DATE('now', 'localtime') AND s.status = 'active'
            ORDER BY s.sale_date DESC
        ''')
        
        total = db.fetch_one('''
            SELECT COALESCE(SUM(total), 0) as total
            FROM sales
            WHERE DATE(sale_date) = DATE('now', 'localtime') AND status = 'active'
        ''')
        
        return jsonify({
            'sales': [dict(s) for s in sales],
            'total': total['total']
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
