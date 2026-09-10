from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database

settings_bp = Blueprint('settings', __name__)

@settings_bp.route('/', methods=['GET'])
@jwt_required()
def get_settings():
    try:
        db = Database(get_db_path())
        
        categories = db.fetch_all('SELECT * FROM categories ORDER BY sort_order, name')
        
        users = db.fetch_all('''
            SELECT id, username, full_name, role, active 
            FROM users 
            WHERE active = 1
        ''')
        
        terminals = db.fetch_all('SELECT * FROM terminals')
        
        products = db.fetch_all('''
            SELECT id, name, barcode, price
            FROM products
            WHERE active = 1
            ORDER BY name
        ''')
        
        return jsonify({
            'categories': [dict(c) for c in categories],
            'users': [dict(u) for u in users],
            'terminals': [dict(t) for t in terminals],
            'products': [dict(p) for p in products]
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@settings_bp.route('/categories', methods=['POST'])
@jwt_required()
def create_category():
    try:
        data = request.get_json()
        name = data.get('name')
        color = data.get('color', '#3b82f6')
        sort_order = data.get('sort_order', 0)
        
        if not name:
            return jsonify({'error': 'El nombre de la categoría es requerido'}), 400
        
        db = Database(get_db_path())
        
        existing = db.fetch_one('SELECT id FROM categories WHERE name = ?', (name,))
        if existing:
            return jsonify({'error': 'Ya existe una categoría con este nombre'}), 400
        
        cursor = db.execute('''
            INSERT INTO categories (name, color, sort_order)
            VALUES (?, ?, ?)
        ''', (name, color, sort_order))
        
        return jsonify({
            'message': 'Categoría creada exitosamente',
            'id': cursor.lastrowid
        }), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@settings_bp.route('/categories/<int:cat_id>', methods=['PUT'])
@jwt_required()
def update_category(cat_id):
    try:
        data = request.get_json()
        name = data.get('name')
        color = data.get('color')
        sort_order = data.get('sort_order')
        active = data.get('active')
        
        db = Database(get_db_path())
        
        updates = []
        params = []
        
        if name is not None:
            existing = db.fetch_one(
                'SELECT id FROM categories WHERE name = ? AND id != ?',
                (name, cat_id)
            )
            if existing:
                return jsonify({'error': 'Ya existe una categoría con este nombre'}), 400
            updates.append('name = ?')
            params.append(name)
        
        if color is not None:
            updates.append('color = ?')
            params.append(color)
        
        if sort_order is not None:
            updates.append('sort_order = ?')
            params.append(sort_order)
        
        if active is not None:
            updates.append('active = ?')
            params.append(active)
        
        if not updates:
            return jsonify({'error': 'No hay datos para actualizar'}), 400
        
        params.append(cat_id)
        query = f'UPDATE categories SET {", ".join(updates)} WHERE id = ?'
        db.execute(query, params)
        
        return jsonify({'message': 'Categoría actualizada exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@settings_bp.route('/categories/<int:cat_id>', methods=['DELETE'])
@jwt_required()
def delete_category(cat_id):
    try:
        db = Database(get_db_path())
        
        products = db.fetch_one(
            'SELECT COUNT(*) as count FROM products WHERE category_id = ?',
            (cat_id,)
        )
        
        if products['count'] > 0:
            return jsonify({'error': 'No se puede eliminar: hay productos con esta categoría'}), 400
        
        db.execute('DELETE FROM categories WHERE id = ?', (cat_id,))
        
        return jsonify({'message': 'Categoría eliminada exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@settings_bp.route('/users', methods=['POST'])
@jwt_required()
def create_user():
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        full_name = data.get('full_name')
        role = data.get('role', 'cashier')
        pin = data.get('pin', '')
        
        if not all([username, password, full_name]):
            return jsonify({'error': 'Todos los campos son requeridos'}), 400
        
        if role not in ['admin', 'supervisor', 'cashier']:
            return jsonify({'error': 'Rol no válido'}), 400
        
        db = Database(get_db_path())
        
        existing = db.fetch_one('SELECT id FROM users WHERE username = ?', (username,))
        if existing:
            return jsonify({'error': 'El nombre de usuario ya existe'}), 400
        
        from utils.security import Security
        security = Security()
        password_hash = security.hash_password(password)
        
        cursor = db.execute('''
            INSERT INTO users (username, password_hash, full_name, role, pin)
            VALUES (?, ?, ?, ?, ?)
        ''', (username, password_hash, full_name, role, pin))
        
        return jsonify({
            'message': 'Usuario creado exitosamente',
            'id': cursor.lastrowid
        }), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@settings_bp.route('/users/<int:user_id>', methods=['PUT'])
@jwt_required()
def update_user(user_id):
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        role = data.get('role')
        pin = data.get('pin')
        active = data.get('active')
        password = data.get('password')
        
        db = Database(get_db_path())
        
        updates = []
        params = []
        
        if full_name is not None:
            updates.append('full_name = ?')
            params.append(full_name)
        
        if role is not None:
            updates.append('role = ?')
            params.append(role)
        
        if pin is not None:
            updates.append('pin = ?')
            params.append(pin)
        
        if active is not None:
            updates.append('active = ?')
            params.append(active)
        
        if password:
            from utils.security import Security
            security = Security()
            password_hash = security.hash_password(password)
            updates.append('password_hash = ?')
            params.append(password_hash)
        
        if not updates:
            return jsonify({'error': 'No hay datos para actualizar'}), 400
        
        params.append(user_id)
        query = f'UPDATE users SET {", ".join(updates)} WHERE id = ?'
        db.execute(query, params)
        
        return jsonify({'message': 'Usuario actualizado exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@settings_bp.route('/users/<int:user_id>', methods=['DELETE'])
@jwt_required()
def delete_user(user_id):
    try:
        db = Database(get_db_path())
        
        user = db.fetch_one('SELECT id, role FROM users WHERE id = ?', (user_id,))
        if not user:
            return jsonify({'error': 'Usuario no encontrado'}), 404
        
        admin_count = db.fetch_one('SELECT COUNT(*) as count FROM users WHERE role = "admin" AND active = 1')
        if user['role'] == 'admin' and admin_count['count'] <= 1:
            return jsonify({'error': 'No se puede eliminar al único administrador'}), 400
        
        db.execute('UPDATE users SET active = 0 WHERE id = ?', (user_id,))
        
        return jsonify({'message': 'Usuario desactivado exitosamente'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@settings_bp.route('/terminals', methods=['POST'])
@jwt_required()
def create_terminal():
    try:
        data = request.get_json()
        id = data.get('id')
        name = data.get('name')
        commission_rate = data.get('commission_rate', 0)
        
        if not all([id, name]):
            return jsonify({'error': 'ID y nombre son requeridos'}), 400
        
        db = Database(get_db_path())
        
        db.execute('''
            INSERT OR REPLACE INTO terminals (id, name, commission_rate, active)
            VALUES (?, ?, ?, 1)
        ''', (id, name, commission_rate))
        
        return jsonify({'message': 'Terminal agregada exitosamente'}), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
