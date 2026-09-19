from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database
from utils.permissions import require_permission

promotions_bp = Blueprint('promotions', __name__)

@promotions_bp.route('/', methods=['GET'])
@jwt_required()
def get_promotions():
    try:
        db = Database(get_db_path())
        
        promotions = db.fetch_all('''
            SELECT p.*,
                   GROUP_CONCAT(DISTINCT pr.product_id) as product_ids,
                   GROUP_CONCAT(DISTINCT pc.category_id) as category_ids
            FROM promotions p
            LEFT JOIN promotion_products pr ON p.id = pr.promotion_id
            LEFT JOIN promotion_categories pc ON p.id = pc.promotion_id
            WHERE p.active = 1
            AND (p.end_date IS NULL OR p.end_date >= DATE('now'))
            GROUP BY p.id
            ORDER BY p.created_at DESC
        ''')
        
        result = []
        for promo in promotions:
            promo_dict = dict(promo)
            promo_dict['product_ids'] = [int(x) for x in promo['product_ids'].split(',')] if promo['product_ids'] else []
            promo_dict['category_ids'] = [int(x) for x in promo['category_ids'].split(',')] if promo['category_ids'] else []
            result.append(promo_dict)
        
        return jsonify(result), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@promotions_bp.route('/', methods=['POST'])
@jwt_required()
@require_permission('products', 'create')
def create_promotion():
    try:
        data = request.get_json()
        name = data.get('name')
        promo_type = data.get('type')
        product_ids = data.get('product_ids', [])
        category_ids = data.get('category_ids', [])
        
        if not name or not promo_type:
            return jsonify({'error': 'Nombre y tipo son requeridos'}), 400
        
        db = Database(get_db_path())
        
        cursor = db.execute('''
            INSERT INTO promotions (
                name, type, buy_quantity, pay_quantity,
                fixed_price, discount_percent, discount_amount,
                start_date, end_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            name,
            promo_type,
            data.get('buy_quantity', 1),
            data.get('pay_quantity', 1),
            data.get('fixed_price'),
            data.get('discount_percent'),
            data.get('discount_amount'),
            data.get('start_date'),
            data.get('end_date')
        ))
        
        promotion_id = cursor.lastrowid
        
        for product_id in product_ids:
            db.execute('''
                INSERT INTO promotion_products (promotion_id, product_id) VALUES (?, ?)
            ''', (promotion_id, product_id))
        
        for category_id in category_ids:
            db.execute('''
                INSERT INTO promotion_categories (promotion_id, category_id) VALUES (?, ?)
            ''', (promotion_id, category_id))
        
        return jsonify({
            'message': 'Promoción creada exitosamente',
            'id': promotion_id
        }), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@promotions_bp.route('/<int:promo_id>', methods=['PUT'])
@jwt_required()
@require_permission('products', 'edit')
def update_promotion(promo_id):
    try:
        data = request.get_json()
        
        db = Database(get_db_path())
        
        db.execute('''
            UPDATE promotions SET
                name = ?,
                type = ?,
                buy_quantity = ?,
                pay_quantity = ?,
                fixed_price = ?,
                discount_percent = ?,
                discount_amount = ?,
                start_date = ?,
                end_date = ?,
                active = ?
            WHERE id = ?
        ''', (
            data.get('name'),
            data.get('type'),
            data.get('buy_quantity', 1),
            data.get('pay_quantity', 1),
            data.get('fixed_price'),
            data.get('discount_percent'),
            data.get('discount_amount'),
            data.get('start_date'),
            data.get('end_date'),
            data.get('active', 1),
            promo_id
        ))
        
        db.execute('DELETE FROM promotion_products WHERE promotion_id = ?', (promo_id,))
        db.execute('DELETE FROM promotion_categories WHERE promotion_id = ?', (promo_id,))
        
        for product_id in data.get('product_ids', []):
            db.execute('''
                INSERT INTO promotion_products (promotion_id, product_id) VALUES (?, ?)
            ''', (promo_id, product_id))
        
        for category_id in data.get('category_ids', []):
            db.execute('''
                INSERT INTO promotion_categories (promotion_id, category_id) VALUES (?, ?)
            ''', (promotion_id, category_id))
        
        return jsonify({'message': 'Promoción actualizada exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@promotions_bp.route('/<int:promo_id>', methods=['DELETE'])
@jwt_required()
@require_permission('products', 'delete')
def delete_promotion(promo_id):
    try:
        db = Database(get_db_path())
        db.execute('UPDATE promotions SET active = 0 WHERE id = ?', (promo_id,))
        return jsonify({'message': 'Promoción eliminada exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@promotions_bp.route('/calculate', methods=['POST'])
@jwt_required()
def calculate_promotion():
    try:
        data = request.get_json()
        product_id = data.get('product_id')
        category_id = data.get('category_id')
        quantity = data.get('quantity', 1)
        unit_price = data.get('unit_price', 0)
        
        db = Database(get_db_path())
        
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
        best_promotion = None
        
        for promo in promotions:
            applies = False
            
            if promo['product_ids']:
                product_ids = [int(x) for x in promo['product_ids'].split(',') if x]
                if product_id in product_ids:
                    applies = True
            
            if promo['category_ids']:
                category_ids = [int(x) for x in promo['category_ids'].split(',') if x]
                if category_id in category_ids:
                    applies = True
            
            if applies:
                discount = 0
                promo_type = promo['type']
                
                if promo_type == 'bogo':
                    if quantity >= promo['buy_quantity']:
                        promo_qty = (quantity // promo['buy_quantity']) * promo['pay_quantity']
                        free_qty = quantity - promo_qty
                        discount = free_qty * unit_price
                
                elif promo_type == 'fixed_price':
                    buy_q = promo['buy_quantity'] or 0
                    fix_p = promo['fixed_price'] or 0
                    if buy_q > 0 and fix_p > 0 and quantity >= buy_q and fix_p < buy_q * unit_price:
                        groups = quantity // buy_q
                        complete_items = groups * buy_q
                        regular_price = complete_items * unit_price
                        promo_total = groups * fix_p
                        discount = regular_price - promo_total
                
                elif promo_type == 'percent':
                    discount = (unit_price * quantity) * (promo['discount_percent'] / 100)
                
                elif promo_type == 'fixed_discount':
                    discount = promo['discount_amount'] * quantity
                
                if discount > best_discount:
                    best_discount = discount
                    best_promotion = dict(promo)
        
        return jsonify({
            'discount': round(best_discount, 2),
            'promotion': best_promotion
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@promotions_bp.route('/active', methods=['GET'])
@jwt_required()
def get_active_promotions():
    try:
        db = Database(get_db_path())
        
        promotions = db.fetch_all('''
            SELECT p.id, p.name, p.type, p.buy_quantity, p.pay_quantity,
                   p.fixed_price, p.discount_percent, p.discount_amount,
                   GROUP_CONCAT(DISTINCT pr.product_id) as product_ids,
                   GROUP_CONCAT(DISTINCT pc.category_id) as category_ids
            FROM promotions p
            LEFT JOIN promotion_products pr ON p.id = pr.promotion_id
            LEFT JOIN promotion_categories pc ON p.id = pc.promotion_id
            WHERE p.active = 1
            AND (p.end_date IS NULL OR p.end_date >= DATE('now'))
            AND (p.start_date IS NULL OR p.start_date <= DATE('now'))
            GROUP BY p.id
        ''')
        
        result = []
        for promo in promotions:
            promo_dict = {
                'id': promo['id'],
                'name': promo['name'],
                'type': promo['type'],
                'buy_quantity': promo['buy_quantity'],
                'pay_quantity': promo['pay_quantity'],
                'fixed_price': promo['fixed_price'],
                'discount_percent': promo['discount_percent'],
                'discount_amount': promo['discount_amount'],
                'product_ids': [int(x) for x in promo['product_ids'].split(',') if x] if promo['product_ids'] else [],
                'category_ids': [int(x) for x in promo['category_ids'].split(',') if x] if promo['category_ids'] else []
            }
            result.append(promo_dict)
        
        return jsonify(result), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
