from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import sys
import os
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database
from utils.security import Security

cash_bp = Blueprint('cash', __name__)


def _current_user_id():
    identity = get_jwt_identity()
    if identity is None:
        return None
    try:
        return int(identity)
    except (TypeError, ValueError):
        return None


def _record_action(db, register_id, actor_user_id, owner_user_id, action, reason=None):
    try:
        db.execute('''
            INSERT INTO shift_actions (register_id, actor_user_id, owner_user_id, action, reason)
            VALUES (?, ?, ?, ?, ?)
        ''', (register_id, actor_user_id, owner_user_id, action, reason))
    except Exception as e:
        print(f"shift_actions log error: {e}")


def _stats_for_register(db, register):
    if not register:
        return {
            'sales_total': 0,
            'sales_count': 0,
            'cash_total': 0,
            'card_total': 0,
            'mixed_total': 0,
            'returns_total': 0
        }
    register_id = register['id']
    totals = db.fetch_one('''
        SELECT
            COALESCE(SUM(total), 0) as sales_total,
            COALESCE(SUM(CASE WHEN status != 'cancelled' AND status != 'returned' THEN 1 ELSE 0 END), 0) as sales_count,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_total,
            COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) as card_total,
            COALESCE(SUM(CASE WHEN payment_method = 'mixed' THEN total ELSE 0 END), 0) as mixed_total
        FROM sales
        WHERE cash_register_id = ? AND closed = 0
    ''', (register_id,))
    returns = db.fetch_one('''
        SELECT
            COALESCE(SUM(amount), 0) as returns_total,
            COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN amount ELSE 0 END), 0) as cash_returns,
            COALESCE(SUM(CASE WHEN refund_method = 'card' THEN amount ELSE 0 END), 0) as card_returns,
            COALESCE(SUM(CASE WHEN refund_method = 'mixed' THEN amount ELSE 0 END), 0) as mixed_returns
        FROM returns
        WHERE cash_register_id = ?
    ''', (register_id,))
    returns_total = float(returns['returns_total'] or 0)
    return {
        'sales_total': round(float(totals['sales_total'] or 0) - returns_total, 2),
        'sales_count': int(totals['sales_count'] or 0),
        'cash_total': round(float(totals['cash_total'] or 0) - float(returns['cash_returns'] or 0), 2),
        'card_total': round(float(totals['card_total'] or 0) - float(returns['card_returns'] or 0), 2),
        'mixed_total': round(float(totals['mixed_total'] or 0) - float(returns['mixed_returns'] or 0), 2),
        'returns_total': round(returns_total, 2)
    }


def _serialize_register(register):
    if not register:
        return None
    d = dict(register)
    for k, v in list(d.items()):
        if hasattr(v, 'isoformat'):
            d[k] = v.isoformat()
        elif isinstance(v, str):
            if k.endswith(('_date', '_at')) or 'timestamp' in k:
                # open_date/close_date se guardan en hora LOCAL (datetime.now()),
                # mientras que sale_date y demás timestamps se guardan en UTC
                # (SQLite CURRENT_TIMESTAMP). Cada uno se interpreta según su formato.
                iso = _parse_sqlite_local_date(v) if k in ('open_date', 'close_date') else _parse_sqlite_date(v)
                if iso:
                    d[k] = iso
    return d


def _parse_sqlite_date(value):
    """Interpreta un timestamp guardado en UTC (valores por defecto de SQLite)."""
    if not value:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            dt = datetime.strptime(value, fmt)
            return dt.replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return None


def _parse_sqlite_local_date(value):
    """Interpreta un timestamp guardado en hora local del servidor."""
    if not value:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            dt = datetime.strptime(value, fmt)
            local_tz = datetime.now().astimezone().tzinfo
            return dt.replace(tzinfo=local_tz).isoformat()
        except ValueError:
            continue
    return None


@cash_bp.route('/active', methods=['GET'])
@jwt_required()
def get_active_shift():
    try:
        db = Database(get_db_path())
        register = db.fetch_one('''
            SELECT cr.*, u.username, u.full_name as owner_full_name
            FROM cash_registers cr
            LEFT JOIN users u ON cr.user_id = u.id
            WHERE cr.status = 'open'
            ORDER BY cr.open_date DESC
            LIMIT 1
        ''')
        if not register:
            return jsonify({'has_active': False}), 200
        owner_id = register['user_id']
        owner = db.fetch_one('SELECT id, username, full_name FROM users WHERE id = ?', (owner_id,)) if owner_id else None
        stats = _stats_for_register(db, register)
        expected = float(register['opening_amount'] or 0) + stats['cash_total']
        return jsonify({
            'has_active': True,
            'register': _serialize_register(register),
            'owner': dict(owner) if owner else None,
            'stats': stats,
            'expected_amount': round(expected, 2)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/open', methods=['POST'])
@jwt_required()
def open_cash():
    try:
        current_user_id = _current_user_id()
        if current_user_id is None:
            return jsonify({'error': 'No autenticado'}), 401

        data = request.get_json() or {}
        opening_amount = float(data.get('opening_amount', 0) or 0)
        notes = data.get('notes', '')
        terminal = data.get('terminal', '')
        cashier_name = data.get('cashier_name', '')

        db = Database(get_db_path())

        existing = db.fetch_one('SELECT id FROM cash_registers WHERE status = \'open\'')
        if existing:
            return jsonify({
                'error': 'Ya hay un turno de caja abierto en el sistema',
                'has_active': True
            }), 409

        user = db.fetch_one('SELECT id, full_name, username FROM users WHERE id = ?', (current_user_id,))
        if not user:
            return jsonify({'error': 'Usuario no encontrado'}), 404

        if not cashier_name:
            cashier_name = user['full_name'] or user['username'] or 'Cajero'

        cursor = db.execute('''
            INSERT INTO cash_registers (opening_amount, cashier_name, status, user_id, terminal, notes, open_date)
            VALUES (?, ?, 'open', ?, ?, ?, ?)
        ''', (opening_amount, cashier_name, current_user_id, terminal, notes, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))

        register_id = cursor.lastrowid
        _record_action(db, register_id, current_user_id, current_user_id, 'open', notes)

        return jsonify({
            'message': 'Turno abierto exitosamente',
            'id': register_id,
            'register_id': register_id
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/<int:cash_id>/close', methods=['POST'])
@jwt_required()
def close_cash(cash_id):
    try:
        current_user_id = _current_user_id()
        if current_user_id is None:
            return jsonify({'error': 'No autenticado'}), 401

        data = request.get_json() or {}
        notes = data.get('notes', '')
        counted_cash = data.get('counted_cash')
        owner_password = data.get('owner_password')

        db = Database(get_db_path())

        register = db.fetch_one('SELECT * FROM cash_registers WHERE id = ? AND status = \'open\'', (cash_id,))
        if not register:
            return jsonify({'error': 'Turno no encontrado o ya está cerrado'}), 404

        owner_user_id = register['user_id']
        is_owner = (current_user_id == owner_user_id)

        if not is_owner:
            if not owner_password:
                return jsonify({
                    'error': 'Para cerrar el turno de otro usuario debes confirmar con la contraseña del dueño',
                    'requires_password': True,
                    'owner_user_id': owner_user_id
                }), 403
            owner_user = db.fetch_one('SELECT password_hash FROM users WHERE id = ?', (owner_user_id,))
            if not owner_user or not Security.verify_password(owner_password, owner_user['password_hash']):
                return jsonify({'error': 'Contraseña del dueño incorrecta'}), 403

        stats = _stats_for_register(db, register)
        expected = float(register['opening_amount'] or 0) + stats['cash_total']

        if counted_cash is not None and counted_cash != '':
            counted = float(counted_cash)
            difference = counted - expected
        else:
            counted = expected
            difference = 0

        db.execute('''
            UPDATE cash_registers
            SET close_date = ?,
                total_sales = ?,
                total_cash = ?,
                total_card = ?,
                expected_amount = ?,
                counted_amount = ?,
                difference = ?,
                notes = ?,
                status = 'closed'
            WHERE id = ?
        ''', (
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            stats['sales_total'],
            stats['cash_total'],
            stats['card_total'],
            round(expected, 2),
            round(counted, 2),
            round(difference, 2),
            notes,
            cash_id
        ))

        db.execute('''
            UPDATE sales
            SET closed = 1
            WHERE cash_register_id = ? AND closed = 0
        ''', (cash_id,))

        _record_action(
            db, cash_id, current_user_id, owner_user_id,
            'close' if is_owner else 'close_cross',
            notes if not is_owner else None
        )

        return jsonify({
            'message': 'Caja cerrada exitosamente',
            'expected_amount': round(expected, 2),
            'counted_amount': round(counted, 2),
            'difference': round(difference, 2),
            'total_sales': stats['sales_total'],
            'total_cash': stats['cash_total'],
            'total_card': stats['card_total'],
            'closed_by': 'owner' if is_owner else 'cross'
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/close-and-open', methods=['POST'])
@jwt_required()
def close_and_open():
    try:
        current_user_id = _current_user_id()
        if current_user_id is None:
            return jsonify({'error': 'No autenticado'}), 401

        data = request.get_json() or {}
        closing = data.get('closing', {}) or {}
        opening = data.get('opening', {}) or {}
        owner_password = data.get('owner_password')

        db = Database(get_db_path())

        register = db.fetch_one('SELECT * FROM cash_registers WHERE status = \'open\' ORDER BY id DESC LIMIT 1')
        if not register:
            return jsonify({'error': 'No hay un turno activo para cerrar'}), 404

        owner_user_id = register['user_id']
        is_owner = (current_user_id == owner_user_id)

        if not is_owner:
            if not owner_password:
                return jsonify({
                    'error': 'Para cerrar el turno de otro usuario debes confirmar con la contraseña del dueño',
                    'requires_password': True,
                    'owner_user_id': owner_user_id
                }), 403
            owner_user = db.fetch_one('SELECT password_hash FROM users WHERE id = ?', (owner_user_id,))
            if not owner_user or not Security.verify_password(owner_password, owner_user['password_hash']):
                return jsonify({'error': 'Contraseña del dueño incorrecta'}), 403

        stats = _stats_for_register(db, register)
        expected = float(register['opening_amount'] or 0) + stats['cash_total']
        counted_cash = closing.get('counted_cash')
        if counted_cash is not None and counted_cash != '':
            counted = float(counted_cash)
            difference = counted - expected
        else:
            counted = expected
            difference = 0
        close_notes = closing.get('notes', '')

        db.execute('''
            UPDATE cash_registers
            SET close_date = ?,
                total_sales = ?,
                total_cash = ?,
                total_card = ?,
                expected_amount = ?,
                counted_amount = ?,
                difference = ?,
                notes = ?,
                status = 'closed'
            WHERE id = ?
        ''', (
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            stats['sales_total'],
            stats['cash_total'],
            stats['card_total'],
            round(expected, 2),
            round(counted, 2),
            round(difference, 2),
            close_notes,
            register['id']
        ))

        db.execute('''
            UPDATE sales
            SET closed = 1
            WHERE cash_register_id = ? AND closed = 0
        ''', (register['id'],))

        _record_action(
            db, register['id'], current_user_id, owner_user_id,
            'close_and_open_close' if is_owner else 'close_and_open_close_cross',
            close_notes
        )

        new_opening = float(opening.get('opening_amount', 0) or 0)
        new_notes = opening.get('notes', '')
        new_terminal = opening.get('terminal', '')
        user = db.fetch_one('SELECT id, full_name, username FROM users WHERE id = ?', (current_user_id,))
        cashier_name = opening.get('cashier_name') or (user['full_name'] or user['username'] or 'Cajero' if user else 'Cajero')

        cursor = db.execute('''
            INSERT INTO cash_registers (opening_amount, cashier_name, status, user_id, terminal, notes, open_date)
            VALUES (?, ?, 'open', ?, ?, ?, ?)
        ''', (new_opening, cashier_name, current_user_id, new_terminal, new_notes, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
        new_id = cursor.lastrowid
        _record_action(db, new_id, current_user_id, current_user_id, 'open_after_close', new_notes)

        return jsonify({
            'message': 'Turno cerrado y nuevo turno abierto',
            'closed': {
                'id': register['id'],
                'expected_amount': round(expected, 2),
                'counted_amount': round(counted, 2),
                'difference': round(difference, 2),
                'total_sales': stats['sales_total'],
                'total_cash': stats['cash_total'],
                'total_card': stats['card_total']
            },
            'opened': {
                'id': new_id
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/current', methods=['GET'])
@jwt_required()
def get_current_cash():
    try:
        db = Database(get_db_path())
        register = db.fetch_one('''
            SELECT * FROM cash_registers
            WHERE status = 'open'
            ORDER BY open_date DESC
            LIMIT 1
        ''')
        if not register:
            return jsonify({'has_open': False}), 200
        stats = _stats_for_register(db, register)
        return jsonify({
            'has_open': True,
            'cash': _serialize_register(register),
            'stats': stats
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/', methods=['GET'])
@jwt_required()
def get_cash_registers():
    try:
        db = Database(get_db_path())
        status = request.args.get('status')
        limit = request.args.get('limit')
        query = 'SELECT * FROM cash_registers WHERE 1=1'
        params = []
        if status:
            query += ' AND status = ?'
            params.append(status)
        query += ' ORDER BY open_date DESC'
        if limit:
            try:
                limit_val = max(1, min(int(limit), 1000))
                query += ' LIMIT ?'
                params.append(limit_val)
            except (TypeError, ValueError):
                pass
        registers = db.fetch_all(query, params)
        return jsonify([_serialize_register(r) for r in registers]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/<int:cash_id>', methods=['GET'])
@jwt_required()
def get_cash_details(cash_id):
    try:
        db = Database(get_db_path())
        cash = db.fetch_one('SELECT * FROM cash_registers WHERE id = ?', (cash_id,))
        if not cash:
            return jsonify({'error': 'Caja no encontrada'}), 404
        sales = db.fetch_all('''
            SELECT * FROM sales
            WHERE cash_register_id = ?
            ORDER BY sale_date DESC
        ''', (cash_id,))
        result = _serialize_register(cash)
        result['sales'] = [_serialize_register(s) for s in sales]
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/overdue-shifts', methods=['GET'])
@jwt_required()
def get_overdue_shifts():
    try:
        db = Database(get_db_path())
        today = datetime.now().strftime('%Y-%m-%d')
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        
        # Check if there's an open shift from yesterday
        yesterday_shift = db.fetch_one('''
            SELECT cr.*, u.username, u.full_name as owner_full_name
            FROM cash_registers cr
            LEFT JOIN users u ON cr.user_id = u.id
            WHERE cr.status = 'open' AND DATE(cr.open_date) = ?
        ''', (yesterday,))
        
        # Also get all open shifts from today (in case someone forgot to close yesterday's and opened another today)
        today_shifts = db.fetch_all('''
            SELECT cr.*, u.username, u.full_name as owner_full_name
            FROM cash_registers cr
            LEFT JOIN users u ON cr.user_id = u.id
            WHERE cr.status = 'open' AND DATE(cr.open_date) = ?
        ''', (today,))
        
        # Check if there are multiple open shifts (potential issue)
        open_today_count = len(today_shifts)
        
        result = {
            'has_yesterday_open': yesterday_shift is not None,
            'yesterday_shift': {
                'id': yesterday_shift['id'],
                'open_date': _parse_sqlite_local_date(yesterday_shift['open_date']),
                'cashier_name': yesterday_shift['cashier_name'],
                'user_id': yesterday_shift['user_id']
            } if yesterday_shift else None,
            'open_today_count': open_today_count,
            'today_shifts': [
                {
                    'id': s['id'],
                    'open_date': _parse_sqlite_local_date(s['open_date']),
                    'cashier_name': s['cashier_name'],
                    'user_id': s['user_id']
                } for s in today_shifts
            ]
        }
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/history', methods=['GET'])
@jwt_required()
def get_cash_history():
    try:
        db = Database(get_db_path())
        limit = request.args.get('limit', 50)
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        query = 'SELECT * FROM cash_registers WHERE 1=1'
        params = []
        if date_from:
            query += ' AND DATE(open_date) >= ?'
            params.append(date_from)
        if date_to:
            query += ' AND DATE(open_date) <= ?'
            params.append(date_to)
        query += ' ORDER BY open_date DESC LIMIT ?'
        params.append(int(limit))
        registers = db.fetch_all(query, params)
        return jsonify([_serialize_register(r) for r in registers]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cash_bp.route('/<int:cash_id>/receipt', methods=['GET'])
@jwt_required()
def get_cash_receipt(cash_id):
    try:
        db = Database(get_db_path())
        cash = db.fetch_one('SELECT * FROM cash_registers WHERE id = ?', (cash_id,))
        if not cash:
            return jsonify({'error': 'Caja no encontrada'}), 404
        sales = db.fetch_all('''
            SELECT s.*, si.quantity, si.unit_price, si.total as item_total, si.discount,
                   p.name as product_name
            FROM sales s
            LEFT JOIN sale_items si ON s.id = si.sale_id
            LEFT JOIN products p ON si.product_id = p.id
            WHERE s.cash_register_id = ?
            ORDER BY s.sale_date DESC
        ''', (cash_id,))
        return jsonify({
            'cash': _serialize_register(cash),
            'sales': [_serialize_register(s) for s in sales]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
