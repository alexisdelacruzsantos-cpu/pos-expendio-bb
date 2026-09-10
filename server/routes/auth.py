from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt, get_jwt_identity
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
@jwt_required()
def validate_token():
    try:
        claims = get_jwt()
        return jsonify({
            'valid': True,
            'user_id': get_jwt_identity(),
            'role': claims.get('role'),
            'username': claims.get('username'),
            'full_name': claims.get('full_name')
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    # JWT es stateless: el cliente descarta el token. La validez real la decide la expiración.
    return jsonify({'message': 'Logged out successfully'}), 200
