from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database

auth_bp = Blueprint('auth', __name__)

def generate_device_id():
    import uuid
    return str(uuid.uuid4())

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    device_id = data.get('device_id', generate_device_id())
    
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400
    
    try:
        db = Database(get_db_path())
        user = db.fetch_one(
            '''SELECT id, username, full_name, role, password_hash FROM users 
               WHERE username = ? AND active = 1''',
            (username,)
        )
        
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        from utils.security import Security
        security = Security()
        
        if not security.verify_password(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        access_token = create_access_token(
            identity=str(user['id']),
            additional_claims={
                'role': user['role'],
                'full_name': user['full_name'],
                'username': user['username']
            }
        )
        
        permissions = db.get_permissions_by_role(user['role'])
        
        return jsonify({
            'token': access_token,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'full_name': user['full_name'],
                'role': user['role']
            },
            'permissions': permissions,
            'device_id': device_id
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/validate', methods=['POST'])
def validate_token():
    try:
        auth_header = request.headers.get('Authorization', '')
        token = auth_header.replace('Bearer ', '')
        
        from utils.security import Security
        payload = Security.verify_token(token)
        
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        return jsonify({'valid': True, 'user_id': payload['user_id']})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/logout', methods=['POST'])
def logout():
    try:
        from utils.security import Security
        Security.clear_token_cache()
        return jsonify({'message': 'Logged out successfully'})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
