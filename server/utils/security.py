import hashlib
import jwt
import os
from datetime import datetime, timedelta

class Security:
    """Utility class for security operations."""
    
    SECRET_KEY = 'POS-EXPENDIO-BB-SALT-2026'
    
    @staticmethod
    def hash_password(password):
        salt = Security.SECRET_KEY
        return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()
    
    @staticmethod
    def verify_password(password, password_hash):
        return Security.hash_password(password) == password_hash
    
    @staticmethod
    def generate_token(user_id, role):
        payload = {
            'user_id': user_id,
            'role': role,
            'exp': datetime.utcnow() + timedelta(hours=8)
        }
        return jwt.encode(payload, Security.SECRET_KEY, algorithm='HS256')
    
    @staticmethod
    def verify_token(token):
        try:
            payload = jwt.decode(token, Security.SECRET_KEY, algorithms=['HS256'])
            return payload
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None