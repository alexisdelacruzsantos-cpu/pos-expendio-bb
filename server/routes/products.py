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
from utils.permissions import require_permission
from datetime import datetime as _dt

products_bp = Blueprint('products', __name__)

@products_bp.route('/', methods=['GET'])
@jwt_required()
def get_products():
    try:
        db = Database(get_db_path())
        category_id = request.args.get('category_id')
        search = request.args.get('search', '')
        active_only = request.args.get('active_only', '1')

        query = '''
            SELECT p.*, c.name as category_name, c.color as category_color,
                   COALESCE(lagg.stock_ok, 0) as lots_stock
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN (
                SELECT l.product_id,
                       SUM(CASE WHEN l.current_quantity > 0 THEN l.current_quantity ELSE 0 END) as stock_ok
                FROM lots l
                GROUP BY l.product_id
            ) lagg ON lagg.product_id = p.id
            WHERE 1=1
        '''
        params = []

        if category_id:
            query += ' AND p.category_id = ?'
            params.append(category_id)

        if search:
            query += ' AND (p.name LIKE ? OR p.barcode LIKE ?)'
            params.extend([f'%{search}%', f'%{search}%'])

        if active_only == '1':
            query += ' AND p.active = 1'

        query += ' ORDER BY p.name'

        products = db.fetch_all(query, params)
        result = []
        for p in products:
            d = dict(p)
            lots_stock = float(d.get('lots_stock') or 0)
            product_stock = float(d.get('stock') or 0)
            d['effective_stock'] = product_stock + lots_stock
            d['has_lots'] = lots_stock > 0
            result.append(d)
        return jsonify(result), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@products_bp.route('/<int:product_id>/lots-pricing', methods=['GET'])
@jwt_required()
def get_product_lots_pricing(product_id):
    try:
        db = Database(get_db_path())
        product = db.fetch_one('SELECT id, name, price FROM products WHERE id = ?', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404

        lots = db.fetch_all('''
            SELECT id, batch_number, expiry_date, current_quantity, sale_price
            FROM lots
            WHERE product_id = ? AND current_quantity > 0
            ORDER BY expiry_date ASC
        ''', (product_id,))

        from datetime import datetime, date
        today = date.today()
        lots_data = []
        for l in lots:
            ld = dict(l)
            expiry = ld.get('expiry_date')
            try:
                if isinstance(expiry, str):
                    expiry = datetime.strptime(expiry[:10], '%Y-%m-%d').date()
                if hasattr(expiry, 'year'):
                    ld['days_left'] = (expiry - today).days
                else:
                    ld['days_left'] = None
            except Exception:
                ld['days_left'] = None
            lots_data.append(ld)

        return jsonify({
            'product_id': product_id,
            'product_name': product['name'],
            'product_price': float(product['price'] or 0),
            'has_lots': len(lots_data) > 0,
            'lots': lots_data
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@products_bp.route('/inventory', methods=['GET'])
@jwt_required()
def get_inventory():
    try:
        db = Database(get_db_path())
        rows = db.fetch_all('''
            SELECT p.id, p.name, p.barcode, p.category_id, p.price, p.cost, p.stock, p.active,
                   c.name as category_name, c.color as category_color,
                   COALESCE(lagg.stock_ok, 0) as lots_stock,
                   COALESCE(lagg.cnt, 0) as lots_count
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN (
                SELECT l.product_id,
                       SUM(CASE WHEN l.current_quantity > 0 THEN l.current_quantity ELSE 0 END) as stock_ok,
                       COUNT(*) as cnt
                FROM lots l
                GROUP BY l.product_id
            ) lagg ON lagg.product_id = p.id
            WHERE p.active = 1
            ORDER BY p.name
        ''')
        result = []
        for r in rows:
            d = dict(r)
            lots_stock = max(0, float(d.get('lots_stock') or 0))
            lots_count = int(d.get('lots_count') or 0)
            product_stock = max(0, float(d.get('stock') or 0))
            d['effective_stock'] = lots_stock + product_stock
            d['has_lots'] = lots_count > 0
            d['lots_stock'] = lots_stock
            d['product_stock'] = product_stock
            result.append(d)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@products_bp.route('/<int:product_id>/add-stock', methods=['POST'])
@jwt_required()
@require_permission('products', 'edit')
def add_product_stock(product_id):
    try:
        data = request.get_json()
        quantity = float(data.get('quantity', 0))
        if not quantity or quantity <= 0:
            return jsonify({'error': 'Cantidad debe ser mayor a 0'}), 400

        db = Database(get_db_path())
        product = db.fetch_one('SELECT id, name, stock FROM products WHERE id = ?', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404

        new_stock = (float(product['stock'] or 0)) + quantity
        db.execute('UPDATE products SET stock = ? WHERE id = ?', (new_stock, product_id))

        log_movement(db, product_id=product_id, movement_type='entry', quantity=quantity,
                     notes=f'Entrada directa a producto #{product_id}')

        return jsonify({
            'message': 'Stock agregado',
            'product_id': product_id,
            'previous': float(product['stock'] or 0),
            'new': new_stock
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@products_bp.route('/<int:product_id>/adjust-stock', methods=['POST'])
@jwt_required()
@require_permission('products', 'edit')
def adjust_product_stock(product_id):
    try:
        data = request.get_json()
        new_quantity = data.get('current_quantity')
        if new_quantity is None:
            return jsonify({'error': 'Falta current_quantity'}), 400
        new_quantity = float(new_quantity)
        if new_quantity < 0:
            return jsonify({'error': 'La cantidad no puede ser negativa'}), 400
        reason = (data.get('reason') or '').strip()
        if not reason:
            return jsonify({'error': 'La razón del ajuste es obligatoria'}), 400
        notes = data.get('notes', '')

        db = Database(get_db_path())
        product = db.fetch_one('SELECT id, name, stock FROM products WHERE id = ?', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404

        previous = float(product['stock'] or 0)
        diff = new_quantity - previous
        db.execute('UPDATE products SET stock = ? WHERE id = ?', (new_quantity, product_id))
        log_movement(db, product_id=product_id, movement_type='adjustment', quantity=diff,
                     notes=f'Ajuste: {reason}. {notes}'.strip())

        return jsonify({
            'message': 'Stock ajustado',
            'product_id': product_id,
            'previous': previous,
            'new': new_quantity,
            'diff': diff
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@products_bp.route('/<int:product_id>', methods=['GET'])
@jwt_required()
def get_product(product_id):
    try:
        db = Database(get_db_path())
        product = db.fetch_one('''
            SELECT p.*, c.name as category_name, c.color as category_color
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = ?
        ''', (product_id,))
        
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404
        
        return jsonify(dict(product)), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@products_bp.route('/', methods=['POST'])
@jwt_required()
@require_permission('products', 'create')
def create_product():
    try:
        data = request.get_json()
        name = data.get('name')
        barcode = data.get('barcode')
        category_id = data.get('category_id')
        price = data.get('price', 0)
        cost = data.get('cost', 0)
        stock = data.get('stock', 0)
        try:
            stock = float(stock) if stock is not None else 0
        except (TypeError, ValueError):
            stock = 0
        if stock < 0:
            return jsonify({'error': 'La cantidad inicial no puede ser negativa'}), 400

        if not name:
            return jsonify({'error': 'El nombre del producto es requerido'}), 400

        db = Database(get_db_path())

        if barcode:
            existing = db.fetch_one('SELECT id FROM products WHERE barcode = ?', (barcode,))
            if existing:
                return jsonify({'error': 'Ya existe un producto con este código de barras'}), 400

        cursor = db.execute('''
            INSERT INTO products (name, barcode, category_id, price, cost, stock)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (name, barcode, category_id, price, cost, stock))
        
        product_id = cursor.lastrowid
        
        cat_name = None
        if category_id:
            cat = db.fetch_one('SELECT name FROM categories WHERE id = ?', (category_id,))
            cat_name = cat['name'] if cat else None

        crafted_notes = f'Precio: ${price or 0}'
        if cost is not None and cost not in (None, ''):
            crafted_notes += f' | Costo: ${cost or 0}'
        if barcode:
            crafted_notes += f' | Código: {barcode}'
        if cat_name:
            crafted_notes += f' | Categoría: {cat_name}'

        log_movement(db, product_id=product_id, movement_type='product_created',
                     product_name=name, product_barcode=barcode,
                     notes=f'Producto registrado. {crafted_notes}')

        if stock > 0:
            log_movement(db, product_id=product_id, movement_type='entry',
                         quantity=stock, product_name=name, product_barcode=barcode,
                         notes=f'Cantidad inicial en stock general al registrar el producto')

        db.execute('''
            INSERT INTO change_log (table_name, record_id, action, data, source, device_id, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            'products', 
            product_id, 
            'insert',
            f'{{"name":"{name}","barcode":"{barcode}","price":{price}}}',
            'pos',
            'server',
            _current_user_id()
        ))
        
        return jsonify({'message': 'Producto creado exitosamente', 'id': product_id}), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@products_bp.route('/<int:product_id>', methods=['PUT'])
@jwt_required()
@require_permission('products', 'edit')
def update_product(product_id):
    try:
        data = request.get_json()
        name = data.get('name')
        barcode = data.get('barcode')
        category_id = data.get('category_id')
        price = data.get('price')
        cost = data.get('cost')
        active = data.get('active')
        
        db = Database(get_db_path())
        
        product = db.fetch_one('SELECT id, name, barcode, category_id, price, cost, active FROM products WHERE id = ?', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404
        
        if barcode:
            existing = db.fetch_one('SELECT id FROM products WHERE barcode = ? AND id != ?', (barcode, product_id))
            if existing:
                return jsonify({'error': 'Ya existe otro producto con este código de barras'}), 400
        
        updates = []
        params = []
        
        if name is not None:
            updates.append('name = ?')
            params.append(name)
        
        if barcode is not None:
            updates.append('barcode = ?')
            params.append(barcode)
        
        if category_id is not None:
            updates.append('category_id = ?')
            params.append(category_id)
        
        if price is not None:
            updates.append('price = ?')
            params.append(price)
        
        if cost is not None:
            updates.append('cost = ?')
            params.append(cost)

        if active is not None:
            updates.append('active = ?')
            params.append(active)
        
        updates.append('updated_at = CURRENT_TIMESTAMP')
        params.append(product_id)
        
        query = f'UPDATE products SET {", ".join(updates)} WHERE id = ?'
        db.execute(query, params)

        old_price = float(product['price'] or 0)
        new_price = float(price) if price is not None else old_price
        old_cost = float(product['cost'] or 0)
        new_cost = float(cost) if cost is not None else old_cost

        changed = []
        if name is not None and name != product['name']:
            changed.append(f'Nombre: {product["name"] or "—"} → {name}')
        if barcode is not None and barcode != (product['barcode'] or ''):
            changed.append(f'Código: {product["barcode"] or "—"} → {barcode or "—"}')
        if category_id is not None and int(category_id) != (product['category_id'] or 0):
            old_cat = db.fetch_one('SELECT name FROM categories WHERE id = ?', (product['category_id'],))
            new_cat = db.fetch_one('SELECT name FROM categories WHERE id = ?', (category_id,))
            changed.append(f'Categoría: {(old_cat["name"] if old_cat else "—")} → {(new_cat["name"] if new_cat else "—")}')
        if cost is not None and new_cost != old_cost:
            changed.append(f'Costo: ${old_cost} → ${new_cost}')
        if active is not None and bool(int(active)) != bool(int(product['active'] or 1)):
            changed.append('Desactivado' if not int(active) else 'Activado')

        if price is not None and new_price != old_price:
            changed.append(f'Precio: ${old_price} → ${new_price}')
            log_movement(db, product_id=product_id, movement_type='price_changed',
                         notes=f'Precio: ${old_price} → ${new_price}')
        if changed:
            log_movement(db, product_id=product_id, movement_type='product_updated',
                         notes='; '.join(changed))

        db.execute('''
            INSERT INTO change_log (table_name, record_id, action, data, source, device_id, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            'products', 
            product_id, 
            'update',
            f'{{"name":"{name}","barcode":"{barcode}","price":{price}}}',
            'pos',
            'server',
            _current_user_id()
        ))
        
        return jsonify({'message': 'Producto actualizado exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@products_bp.route('/<int:product_id>', methods=['DELETE'])
@jwt_required()
@require_permission('products', 'delete')
def delete_product(product_id):
    try:
        db = Database(get_db_path())
        
        product = db.fetch_one('SELECT id, name, barcode FROM products WHERE id = ?', (product_id,))
        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404
        
        stock_result = db.fetch_one('SELECT COALESCE(SUM(current_quantity), 0) as total FROM lots WHERE product_id = ?', (product_id,))
        if stock_result['total'] > 0:
            return jsonify({'error': f'No se puede eliminar. Existencias actuales: {stock_result["total"]} (primero vacía el inventario)'}), 400
        
        active_promos = db.fetch_all('''
            SELECT p.id, p.name FROM promotions p
            JOIN promotion_products pp ON pp.promotion_id = p.id
            WHERE pp.product_id = ? AND p.active = 1
        ''', (product_id,))
        if active_promos:
            names = ', '.join([ap['name'] for ap in active_promos])
            return jsonify({'error': f'No se puede eliminar. Tiene promociones activas: {names}'}), 400
        
        product_cat_promos = db.fetch_all('''
            SELECT DISTINCT p.id, p.name FROM promotions p
            JOIN promotion_categories pc ON pc.promotion_id = p.id
            JOIN products pr ON pr.category_id = pc.category_id
            WHERE pr.id = ? AND p.active = 1
        ''', (product_id,))
        if product_cat_promos:
            names = ', '.join([ap['name'] for ap in product_cat_promos])
            return jsonify({'error': f'No se puede eliminar. Tiene promos activas por categoría: {names}'}), 400
        
        sales_count = db.fetch_one('SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?', (product_id,))
        if sales_count['count'] > 0:
            return jsonify({'error': 'No se puede eliminar el producto porque tiene ventas asociadas'}), 400
        
        db.execute('DELETE FROM promotion_products WHERE product_id = ?', (product_id,))

        # Liberar referencias de historial: se conserva el snapshot (product_name/barcode/lote)
        db.execute('UPDATE inventory_movements SET product_id = NULL WHERE product_id = ?', (product_id,))
        db.execute('''
            UPDATE inventory_movements SET lot_id = NULL
            WHERE lot_id IN (SELECT id FROM lots WHERE product_id = ?)
        ''', (product_id,))

        db.execute('DELETE FROM lots WHERE product_id = ?', (product_id,))
        db.execute('DELETE FROM products WHERE id = ?', (product_id,))

        # Registro final, sin FK al producto ya eliminado (el snapshot conserva nombre/código)
        log_movement(db, movement_type='product_deleted',
                     product_name=product['name'], product_barcode=product['barcode'],
                     notes=f'Producto eliminado: {product["name"] or "—"}')
        
        db.execute('''
            INSERT INTO change_log (table_name, record_id, action, data, source, device_id, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            'products', 
            product_id, 
            'delete',
            f'{{"id":{product_id}}}',
            'pos',
            'server',
            _current_user_id()
        ))
        
        return jsonify({'message': 'Producto eliminado exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@products_bp.route('/barcode/<barcode>', methods=['GET'])
@jwt_required()
def get_product_by_barcode(barcode):
    try:
        db = Database(get_db_path())
        product = db.fetch_one('''
            SELECT p.*, c.name as category_name, c.color as category_color,
                   (SELECT COALESCE(SUM(current_quantity), 0) FROM lots l WHERE l.product_id = p.id) as lots_stock
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.barcode = ? AND p.active = 1
        ''', (barcode,))

        if not product:
            return jsonify({'error': 'Producto no encontrado'}), 404

        d = dict(product)
        lots_stock = float(d.get('lots_stock') or 0)
        product_stock = float(d.get('stock') or 0)
        d['effective_stock'] = product_stock + lots_stock
        d['has_lots'] = lots_stock > 0
        d['product_stock'] = product_stock
        d['lots_total'] = lots_stock

        lots = db.fetch_all('''
            SELECT l.*, p.price as product_price, p.cost as product_cost,
                   c.name as category_name
            FROM lots l
            JOIN products p ON l.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE l.product_id = ?
            ORDER BY l.expiry_date ASC
        ''', (product['id'],))
        lots = [dict(l) for l in lots]
        from datetime import date as _date
        today = _date.today()
        for lot in lots:
            expiry = lot.get('expiry_date')
            try:
                if isinstance(expiry, str):
                    expiry = _dt.strptime(expiry[:10], '%Y-%m-%d').date()
                if hasattr(expiry, 'year'):
                    lot['days_left'] = (expiry - today).days
                    lot['is_expired'] = lot['days_left'] < 0
                else:
                    lot['days_left'] = None
                    lot['is_expired'] = False
            except Exception:
                lot['days_left'] = None
                lot['is_expired'] = False
        d['lots'] = lots
        return jsonify(d), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@products_bp.route('/<int:product_id>/movements', methods=['GET'])
@jwt_required()
def get_product_movements(product_id):
    try:
        db = Database(get_db_path())
        limit = min(int(request.args.get('limit', 200)), 500)
        movement_type = request.args.get('type')

        sql = '''
            SELECT im.id, im.product_id, im.lot_id, im.movement_type, im.quantity,
                   im.reference_id, im.notes, im.created_at,
                   COALESCE(im.product_name, p.name) as product_name,
                   COALESCE(im.product_barcode, p.barcode) as barcode,
                   COALESCE(im.lot_batch, l.batch_number) as batch_number, l.expiry_date,
                   u.username as actor_username, u.full_name as actor_name, u.role as actor_role,
                   c.name as category_name
            FROM inventory_movements im
            LEFT JOIN products p ON p.id = im.product_id
            LEFT JOIN lots l ON l.id = im.lot_id
            LEFT JOIN users u ON u.id = im.created_by
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE im.product_id = ?
        '''
        params = [product_id]
        if movement_type:
            sql += ' AND im.movement_type = ?'
            params.append(movement_type)
        sql += ' ORDER BY im.created_at DESC LIMIT ?'
        params.append(limit)

        rows = db.fetch_all(sql, tuple(params))

        product_stock = db.fetch_one(
            'SELECT COALESCE(SUM(current_quantity),0) as s FROM lots WHERE product_id=?',
            (product_id,)
        )
        product_stock = dict(product_stock) if product_stock else {}
        current_stock = float(product_stock.get('s') or 0)
        if not current_stock:
            ps = db.fetch_one('SELECT stock FROM products WHERE id=?', (product_id,))
            ps = dict(ps) if ps else {}
            current_stock = float(ps.get('stock') or 0)

        movements = []
        for r in rows:
            d = dict(r)
            qty = float(d.get('quantity') or 0)
            mtype = d.get('movement_type')
            movements.append({
                'id': d['id'],
                'created_at': d['created_at'],
                'movement_type': mtype,
                'quantity': qty,
                'sign': '+' if mtype == 'entry' or mtype == 'adjustment_in' else ('-' if mtype == 'sale' or mtype == 'adjustment_out' else ''),
                'lot_id': d.get('lot_id'),
                'batch_number': d.get('batch_number'),
                'expiry_date': d.get('expiry_date'),
                'product_name': d.get('product_name'),
                'barcode': d.get('barcode'),
                'category_name': d.get('category_name'),
                'actor_username': d.get('actor_username'),
                'actor_name': d.get('actor_name'),
                'actor_role': d.get('actor_role'),
                'reference_id': d.get('reference_id'),
                'notes': d.get('notes'),
            })

        product = db.fetch_one(
            'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?',
            (product_id,)
        )

        return jsonify({
            'product': dict(product) if product else None,
            'movements': movements,
            'current_stock': current_stock,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@products_bp.route('/movements/recent', methods=['GET'])
@jwt_required()
def get_recent_movements():
    try:
        db = Database(get_db_path())
        limit = min(int(request.args.get('limit', 500)), 500)
        movement_type = request.args.get('type')
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        q = request.args.get('q', '').strip()

        sql = '''
            SELECT im.id, im.product_id, im.lot_id, im.movement_type, im.quantity,
                   im.reference_id, im.notes, im.created_at,
                   COALESCE(im.product_name, p.name) as product_name,
                   COALESCE(im.product_barcode, p.barcode) as barcode,
                   COALESCE(im.lot_batch, l.batch_number) as batch_number, l.expiry_date,
                   u.username as actor_username, u.full_name as actor_name, u.role as actor_role,
                   c.name as category_name
            FROM inventory_movements im
            LEFT JOIN products p ON p.id = im.product_id
            LEFT JOIN lots l ON l.id = im.lot_id
            LEFT JOIN users u ON u.id = im.created_by
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE 1=1
        '''
        params = []
        if date_from:
            sql += ' AND DATE(im.created_at) >= ?'
            params.append(date_from)
        if date_to:
            sql += ' AND DATE(im.created_at) <= ?'
            params.append(date_to)
        if movement_type:
            sql += ' AND im.movement_type = ?'
            params.append(movement_type)
        if q:
            like_q = f'%{q}%'
            sql += r'''
                AND (LOWER(COALESCE(im.product_name, p.name)) LIKE LOWER(?) ESCAPE '\'
                     OR COALESCE(im.product_barcode, p.barcode) LIKE ? ESCAPE '\')
            '''
            params += [like_q, like_q]
        sql += ' ORDER BY im.created_at DESC LIMIT ?'
        params.append(limit)

        rows = db.fetch_all(sql, tuple(params))
        movements = []
        for r in rows:
            d = dict(r)
            movements.append({
                'id': d['id'],
                'created_at': d['created_at'],
                'movement_type': d['movement_type'],
                'quantity': float(d.get('quantity') or 0),
                'lot_id': d.get('lot_id'),
                'batch_number': d.get('batch_number'),
                'expiry_date': d.get('expiry_date'),
                'product_id': d.get('product_id'),
                'product_name': d.get('product_name'),
                'barcode': d.get('barcode'),
                'category_name': d.get('category_name'),
                'actor_username': d.get('actor_username'),
                'actor_name': d.get('actor_name'),
                'actor_role': d.get('actor_role'),
                'reference_id': d.get('reference_id'),
                'notes': d.get('notes'),
            })
        return jsonify({'movements': movements, 'count': len(movements)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
