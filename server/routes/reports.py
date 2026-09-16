from flask import Blueprint, request, jsonify
# pyrefly: ignore [missing-import]
from flask_jwt_extended import jwt_required
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database
from utils.permissions import is_admin

reports_bp = Blueprint('reports', __name__)

@reports_bp.route('/expiry-alert', methods=['GET'])
@jwt_required()
def expiry_alert():
    try:
        db = Database(get_db_path())
        days = request.args.get('days', 30)
        
        lots = db.fetch_all('''
            SELECT l.*, p.name as product_name, p.barcode, c.name as category_name
            FROM lots l
            JOIN products p ON l.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE l.current_quantity > 0
            AND DATE(l.expiry_date) BETWEEN DATE('now') AND DATE('now', '+' || ? || ' days')
            ORDER BY l.expiry_date ASC
        ''', (days,))
        
        expired = db.fetch_all('''
            SELECT l.*, p.name as product_name, p.barcode
            FROM lots l
            JOIN products p ON l.product_id = p.id
            WHERE l.current_quantity > 0
            AND DATE(l.expiry_date) < DATE('now')
            ORDER BY l.expiry_date ASC
        ''')
        
        return jsonify({
            'expiring_soon': [dict(l) for l in lots],
            'expired': [dict(e) for e in expired]
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@reports_bp.route('/low-stock', methods=['GET'])
@jwt_required()
def low_stock_legacy():
    try:
        db = Database(get_db_path())

        products = db.fetch_all('''
            SELECT p.*, c.name as category_name,
                   COALESCE(SUM(l.current_quantity), 0) as total_stock
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN lots l ON p.id = l.product_id
            WHERE p.active = 1
            GROUP BY p.id
            HAVING total_stock = 0
            ORDER BY p.name ASC
        ''')

        return jsonify([dict(p) for p in products]), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@reports_bp.route('/sales-summary', methods=['GET'])
@jwt_required()
def sales_summary():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        
        query = '''
            SELECT 
                DATE(sale_date) as date,
                COUNT(*) as total_sales,
                SUM(total) as total_amount,
                SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END) as cash_amount,
                SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END) as card_amount
            FROM sales
            WHERE status = 'active'
        '''
        params = []
        
        if date_from:
            query += ' AND sale_date >= ?'
            params.append(date_from)
        
        if date_to:
            query += ' AND sale_date <= ?'
            params.append(date_to)
        
        query += ' GROUP BY DATE(sale_date) ORDER BY date DESC'
        
        summary = db.fetch_all(query, params)
        
        total_query = '''
            SELECT COUNT(*) as total_sales, COALESCE(SUM(total), 0) as total_amount
            FROM sales
            WHERE status = 'active'
        '''
        total_params = []
        
        if date_from:
            total_query += ' AND sale_date >= ?'
            total_params.append(date_from)
        
        if date_to:
            total_query += ' AND sale_date <= ?'
            total_params.append(date_to)
        
        total = db.fetch_one(total_query, total_params)
        
        return jsonify({
            'summary': [dict(s) for s in summary],
            'total_sales': total['total_sales'],
            'total_amount': total['total_amount']
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@reports_bp.route('/top-products', methods=['GET'])
@jwt_required()
def top_products():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        limit = request.args.get('limit', 10)
        
        query = '''
            SELECT p.name, p.barcode, SUM(si.quantity) as total_sold,
                   SUM(si.total) as total_revenue
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.status = 'active'
        '''
        params = []
        
        if date_from:
            query += ' AND s.sale_date >= ?'
            params.append(date_from)
        
        if date_to:
            query += ' AND s.sale_date <= ?'
            params.append(date_to)
        
        query += ' GROUP BY p.id ORDER BY total_sold DESC LIMIT ?'
        params.append(int(limit))
        
        products = db.fetch_all(query, params)
        
        return jsonify([dict(p) for p in products]), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@reports_bp.route('/inventory-value', methods=['GET'])
@jwt_required()
def inventory_value():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())
        value = db.fetch_all('''
            SELECT p.name, p.barcode, 
                   (COALESCE(SUM(l.current_quantity), 0) + COALESCE(p.stock, 0)) as quantity,
                   p.cost,
                   ((COALESCE(SUM(l.current_quantity), 0) + COALESCE(p.stock, 0)) * p.cost) as total_value
            FROM products p
            LEFT JOIN lots l ON p.id = l.product_id AND l.current_quantity > 0
            WHERE p.active = 1
            GROUP BY p.id
            ORDER BY total_value DESC
        ''')
        
        total = db.fetch_one('''
            SELECT COALESCE(SUM((COALESCE(p.stock, 0) + COALESCE(l.current_quantity, 0)) * COALESCE(p.cost, 0)), 0) as total_value
            FROM products p
            LEFT JOIN lots l ON p.id = l.product_id AND l.current_quantity > 0
            WHERE p.active = 1
        ''')

        return jsonify({
            'items': [dict(v) for v in value],
            'total_value': total['total_value']
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/top-selling', methods=['GET'])
@jwt_required()
def top_selling():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())
        limit = int(request.args.get('limit', 10))

        products = db.fetch_all('''
            SELECT p.name, p.barcode, SUM(si.quantity) as total_qty,
                   SUM(si.total) as total_revenue
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.status = 'active'
            GROUP BY p.id
            ORDER BY total_qty DESC
            LIMIT ?
        ''', (limit,))

        return jsonify([dict(p) for p in products]), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/expiring-soon', methods=['GET'])
@jwt_required()
def expiring_soon():
    try:
        db = Database(get_db_path())
        days = int(request.args.get('days', 30))

        lots = db.fetch_all('''
            SELECT l.id, l.batch_number, l.expiry_date, l.current_quantity,
                   p.name, p.barcode, p.price, p.cost,
                   c.name as category_name
            FROM lots l
            JOIN products p ON l.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE l.current_quantity > 0
            AND DATE(l.expiry_date) <= DATE('now', '+' || ? || ' days')
            ORDER BY l.expiry_date ASC
        ''', (days,))

        from datetime import date, datetime, timedelta
        today = date.today()
        result = []
        for l in lots:
            d = dict(l)
            expiry = d.get('expiry_date')
            try:
                if isinstance(expiry, str):
                    expiry = datetime.strptime(expiry[:10], '%Y-%m-%d').date()
                d['days_left'] = (expiry - today).days
            except Exception:
                d['days_left'] = None
            result.append(d)

        return jsonify(result), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/value-by-category', methods=['GET'])
@jwt_required()
def value_by_category():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())

        cats = db.fetch_all('''
            SELECT COALESCE(c.name, 'Sin categoría') as category_name,
                   COALESCE(sub.category_id, 0) as category_id,
                   COALESCE(SUM(sub.effective_stock * sub.cost), 0) as value,
                   COUNT(sub.id) as product_count,
                   COALESCE(SUM(sub.effective_stock), 0) as total_units
            FROM (
                SELECT p.id, p.category_id, COALESCE(p.cost, 0) as cost,
                       (COALESCE(SUM(l.current_quantity), 0) + COALESCE(p.stock, 0)) as effective_stock
                FROM products p
                LEFT JOIN lots l ON p.id = l.product_id AND l.current_quantity > 0
                WHERE p.active = 1
                GROUP BY p.id
            ) sub
            LEFT JOIN categories c ON sub.category_id = c.id
            GROUP BY sub.category_id
            ORDER BY value DESC
        ''')

        return jsonify([dict(c) for c in cats]), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/low-stock-detail', methods=['GET'])
@jwt_required()
def low_stock_detail():
    try:
        db = Database(get_db_path())
        threshold = int(request.args.get('threshold', 10))

        products = db.fetch_all('''
            SELECT p.id, p.name, p.barcode, p.price, p.cost,
                   c.name as category_name,
                   (COALESCE(SUM(l.current_quantity), 0) + p.stock) as effective_stock
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN lots l ON p.id = l.product_id
            WHERE p.active = 1
            GROUP BY p.id
            HAVING effective_stock <= ?
            ORDER BY effective_stock ASC
        ''', (threshold,))

        return jsonify([dict(p) for p in products]), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/losses-by-product', methods=['GET'])
@jwt_required()
def losses_by_product():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())
        limit = int(request.args.get('limit', 10))

        movements = db.fetch_all('''
            SELECT p.id, p.name, p.barcode,
                   SUM(CASE WHEN im.movement_type IN ('adjustment', 'shrinkage', 'loss')
                             AND im.quantity < 0 THEN ABS(im.quantity) * p.cost ELSE 0 END) as total_loss,
                   SUM(CASE WHEN im.movement_type IN ('adjustment', 'shrinkage', 'loss')
                             AND im.quantity < 0 THEN ABS(im.quantity) ELSE 0 END) as total_units_loss
            FROM inventory_movements im
            JOIN products p ON im.product_id = p.id
            WHERE p.active = 1
            GROUP BY p.id
            HAVING total_loss > 0
            ORDER BY total_loss DESC
            LIMIT ?
        ''', (limit,))

        return jsonify([dict(m) for m in movements]), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/sales', methods=['GET'])
@jwt_required()
def sales_report():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        limit = int(request.args.get('limit', 10))

        where = ' WHERE s.status = \'active\''
        params = []
        if date_from:
            where += ' AND DATE(sale_date) >= ?'
            params.append(date_from)
        if date_to:
            where += ' AND DATE(sale_date) <= ?'
            params.append(date_to)

        summary = db.fetch_one(f'''
            SELECT COUNT(*) as sales,
                   COALESCE(SUM(total), 0) as total,
                   COALESCE(AVG(total), 0) as avg_ticket,
                   COALESCE(MAX(total), 0) as max_ticket
            FROM sales s
            {where}
        ''', params)

        units_row = db.fetch_one(f'''
            SELECT COALESCE(SUM(si.quantity - COALESCE(si.returned_quantity, 0)), 0) as units,
                   COALESCE(SUM((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(p.cost, 0)), 0) as cost
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            {where}
            AND si.quantity > COALESCE(si.returned_quantity, 0)
        ''', params)

        payments = db.fetch_all(f'''
            SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as amount
            FROM sales s
            {where}
            GROUP BY payment_method
            ORDER BY amount DESC
        ''', params)

        cashiers = db.fetch_all(f'''
            SELECT COALESCE(cashier_id, 0) as cashier_id,
                   COALESCE(NULLIF(TRIM(cashier_name), ''), 'Sin asignar') as cashier_name,
                   COUNT(*) as sales,
                   COALESCE(SUM(total), 0) as amount
            FROM sales s
            {where}
            GROUP BY cashier_id, cashier_name
            ORDER BY amount DESC
        ''', params)

        top_products = [dict(t) for t in db.fetch_all(f'''
            SELECT p.name, p.barcode, c.name as category_name,
                   SUM(si.quantity - COALESCE(si.returned_quantity, 0)) as quantity,
                   SUM(CASE WHEN si.quantity > 0
                       THEN si.total * ((si.quantity - COALESCE(si.returned_quantity, 0)) / si.quantity)
                       ELSE 0 END) as revenue,
                   SUM((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(p.cost, 0)) as cost
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            {where}
            AND si.quantity > COALESCE(si.returned_quantity, 0)
            GROUP BY p.id
            ORDER BY quantity DESC
            LIMIT ?
        ''', params + [limit])]

        for t in top_products:
            t['revenue'] = round(float(t['revenue'] or 0), 2)
            t['cost'] = round(float(t['cost'] or 0), 2)
            t['profit'] = round(t['revenue'] - t['cost'], 2)

        total_amount = float(summary['total'] or 0)
        total_cost = float(units_row['cost'] or 0)

        by_department = [dict(d) for d in db.fetch_all(f'''
            SELECT COALESCE(c.name, 'Sin categoría') as department,
                   COUNT(DISTINCT s.id) as sales,
                   COALESCE(SUM(si.quantity - COALESCE(si.returned_quantity, 0)), 0) as units,
                   COALESCE(SUM(CASE WHEN si.quantity > 0
                       THEN si.total * ((si.quantity - COALESCE(si.returned_quantity, 0)) / si.quantity)
                       ELSE 0 END), 0) as revenue,
                   COALESCE(SUM((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(p.cost, 0)), 0) as cost
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            {where}
            AND si.quantity > COALESCE(si.returned_quantity, 0)
            GROUP BY COALESCE(c.id, 0), COALESCE(c.name, 'Sin categoría')
            ORDER BY revenue DESC
        ''', params)]

        for d in by_department:
            d['revenue'] = round(float(d['revenue'] or 0), 2)
            d['cost'] = round(float(d['cost'] or 0), 2)
            d['profit'] = round(d['revenue'] - d['cost'], 2)

        by_day = [dict(d) for d in db.fetch_all(f'''
            SELECT DATE(s.sale_date) as day,
                   COUNT(DISTINCT s.id) as sales,
                   COALESCE(SUM(si.quantity - COALESCE(si.returned_quantity, 0)), 0) as units,
                   COALESCE(SUM(si.total), 0) as total
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            {where}
            GROUP BY DATE(s.sale_date)
            ORDER BY day
        ''', params)]

        for d in by_day:
            d['total'] = round(float(d['total'] or 0), 2)
            d['units'] = int(d['units'] or 0)
            d['sales'] = int(d['sales'] or 0)

        return jsonify({
            'summary': {
                'sales': summary['sales'],
                'total': round(total_amount, 2),
                'avg_ticket': round(float(summary['avg_ticket'] or 0), 2),
                'max_ticket': round(float(summary['max_ticket'] or 0), 2),
                'units': int(units_row['units'] or 0),
                'profit': round(total_amount - total_cost, 2),
                'margin_pct': round((total_amount - total_cost) / total_amount * 100, 2) if total_amount else 0
            },
            'payments': [dict(p) for p in payments],
            'cashiers': [dict(c) for c in cashiers],
            'top_products': top_products,
            'by_department': by_department,
            'by_day': by_day
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@reports_bp.route('/inventory-cut', methods=['GET'])
@jwt_required()
def inventory_cut():
    if not is_admin():
        return jsonify({'error': 'No autorizado'}), 403
    try:
        db = Database(get_db_path())
        products = db.fetch_all('''
            SELECT p.id, p.name, p.barcode, p.price, p.cost, p.stock,
                   c.name as category_name, c.color as category_color
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.active = 1
            ORDER BY c.name, p.name
        ''')
        result = []
        for p in products:
            d = dict(p)
            lots = db.fetch_all('''
                SELECT id, batch_number, expiry_date, current_quantity, sale_price,
                       production_date, location
                FROM lots
                WHERE product_id = ? AND current_quantity > 0
                ORDER BY expiry_date ASC
            ''', (d['id'],))
            lots_list = [dict(l) for l in lots]
            lots_total = sum(float(l.get('current_quantity') or 0) for l in lots_list)
            product_stock = float(d.get('stock') or 0)
            d['effective_stock'] = lots_total + product_stock
            d['has_lots'] = lots_total > 0
            d['lots'] = lots_list
            d['lots_count'] = len(lots_list)
            d['value'] = d['effective_stock'] * float(d.get('cost') or 0)
            result.append(d)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
