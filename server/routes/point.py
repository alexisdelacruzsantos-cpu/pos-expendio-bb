from flask import Blueprint, request, jsonify, redirect
from flask_jwt_extended import jwt_required
import sys
import os
import uuid
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database
from utils.permissions import require_permission

point_bp = Blueprint('point', __name__)

MP_API = 'https://api.mercadopago.com'
MP_AUTH_URL = 'https://auth.mercadopago.com.mx/authorization'


def _get_setting(key):
    db = Database(get_db_path())
    row = db.fetch_one('SELECT value FROM settings WHERE key = ?', (key,))
    return row['value'] if row else None


def _set_setting(key, value):
    db = Database(get_db_path())
    db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value))


def _get_client_config():
    return {
        'client_id': _get_setting('mp_client_id'),
        'client_secret': _get_setting('mp_client_secret'),
    }


def _redirect_uri():
    host = request.host or request.host_url.rstrip('/').split('//')[-1]
    scheme = 'https' if request.is_secure else 'http'
    return f'{scheme}://{host}/api/mp/callback'


def _valid_token():
    token = _get_setting('mp_access_token')
    refresh = _get_setting('mp_refresh_token')
    client = _get_client_config()
    if not token:
        return None
    url = f'{MP_API}/users/me'
    r = requests.get(url, headers={'Authorization': f'Bearer {token}'}, timeout=15)
    if r.status_code == 200:
        return token
    # Token vencido: intenta renovar con refresh_token
    if not refresh or not client.get('client_id') or not client.get('client_secret'):
        return None
    r = requests.post(f'{MP_API}/oauth/token', data={
        'grant_type': 'refresh_token',
        'client_id': client['client_id'],
        'client_secret': client['client_secret'],
        'refresh_token': refresh,
    }, timeout=15)
    if r.status_code == 200:
        data = r.json()
        _set_setting('mp_access_token', data.get('access_token'))
        if data.get('refresh_token'):
            _set_setting('mp_refresh_token', data['refresh_token'])
        return data.get('access_token')
    return None


def _mp_headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def _list_terminals(token):
    url = f'{MP_API}/terminals/v1/list?limit=50&offset=0'
    r = requests.get(url, headers=_mp_headers(token), timeout=20)
    if r.status_code != 200:
        return None
    data = r.json()
    terminals = (data.get('data') or {}).get('terminals') or []
    return [t for t in terminals if t.get('operating_mode') == 'PDV'] or terminals


def _set_pdv_mode(token, terminal_id):
    url = f'{MP_API}/terminals/v1/setup'
    r = requests.patch(url, headers=_mp_headers(token), json={
        'terminals': [{'id': terminal_id, 'operating_mode': 'PDV'}]
    }, timeout=15)
    return r.status_code in (200, 201)


def _link_local_terminal(mp_terminal):
    """Guarda/vincula la terminal MP en la tabla local terminals y actualiza Settings."""
    db = Database(get_db_path())
    tid = mp_terminal.get('id') or ''
    row = db.fetch_one('SELECT id FROM terminals WHERE mp_terminal_id = ?', (tid,))
    _set_setting('mp_terminal_id', tid)
    _set_setting('mp_store_id', mp_terminal.get('store_id') or '')
    _set_setting('mp_pos_id', mp_terminal.get('pos_id') or '')
    if row:
        db.execute('UPDATE terminals SET name = ?, active = 1 WHERE mp_terminal_id = ?',
                   (f'MP Point ({tid.split("__")[-1]})', tid))
        return row['id']
    db.execute('INSERT OR REPLACE INTO terminals (id, name, commission_rate, active, mp_terminal_id, mp_store_id, mp_pos_id) '
               'VALUES (?, ?, ?, 1, ?, ?, ?)',
               ('term_mp_1', f'MP Point ({tid.split("__")[-1]})', 3.5, tid,
                mp_terminal.get('store_id') or '', mp_terminal.get('pos_id') or ''))
    return 'term_mp_1'


def _exchange_code(code, redirect_uri):
    client = _get_client_config()
    r = requests.post(f'{MP_API}/oauth/token', data={
        'grant_type': 'authorization_code',
        'client_id': client['client_id'],
        'client_secret': client['client_secret'],
        'code': code,
        'redirect_uri': redirect_uri,
    }, timeout=15)
    return r


@point_bp.route('/status', methods=['GET'])
@jwt_required()
@require_permission('settings', 'view')
def get_status():
    try:
        client = _get_client_config()
        configured = bool(client.get('client_id') and client.get('client_secret'))
        token = _valid_token() if configured else None
        connected = bool(token)
        result = {
            'configured': configured,
            'connected': connected,
            'terminal_id': _get_setting('mp_terminal_id') or '',
            'user_id': _get_setting('mp_user_id') or '',
            'host': request.host or '',
        }
        if connected:
            if _get_setting('mp_user_id'):
                result['user_id'] = _get_setting('mp_user_id')
            terminals = _list_terminals(token)
            result['terminals'] = terminals or []
            result['auto_linked'] = bool(_get_setting('mp_terminal_id'))
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@point_bp.route('/config', methods=['POST'])
@jwt_required()
@require_permission('settings', 'create')
def save_config():
    try:
        data = request.get_json() or {}
        client_id = (data.get('client_id') or '').strip()
        client_secret = (data.get('client_secret') or '').strip()
        if client_id:
            _set_setting('mp_client_id', client_id)
        if client_secret:
            _set_setting('mp_client_secret', client_secret)
        return jsonify({'message': 'Credenciales guardadas'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@point_bp.route('/auth-url', methods=['GET'])
@jwt_required()
@require_permission('settings', 'view')
def get_auth_url():
    try:
        client = _get_client_config()
        if not client.get('client_id'):
            return jsonify({'error': 'Falta configurar el client_id del panel de Mercado Pago'}), 400
        redirect_uri = _redirect_uri()
        url = (f'{MP_AUTH_URL}?response_type=code'
               f'&client_id={client["client_id"]}'
               f'&redirect_uri={redirect_uri}')
        return jsonify({'url': url, 'redirect_uri': redirect_uri}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@point_bp.route('/callback', methods=['GET'])
def oauth_callback():
    try:
        code = request.args.get('code')
        error = request.args.get('error')
        if error:
            return redirect(f'/login?mp_error={error}')
        if not code:
            return redirect('/login?mp_error=sin_code')
        redirect_uri = _redirect_uri()
        r = _exchange_code(code, redirect_uri)
        if r.status_code != 200:
            return redirect('/login?mp_error=token_exchange')
        data = r.json()
        _set_setting('mp_access_token', data.get('access_token'))
        if data.get('refresh_token'):
            _set_setting('mp_refresh_token', data['refresh_token'])
        if data.get('user_id'):
            _set_setting('mp_user_id', str(data['user_id']))
        token = data.get('access_token')
        # Vincula automáticamente la primera terminal activa encontrada
        terminals = _list_terminals(token) if token else None
        if terminals:
            _link_local_terminal(terminals[0])
        return redirect('/dashboard?mp_connected=1')
    except Exception as e:
        return redirect(f'/login?mp_error=excepcion')


@point_bp.route('/terminals', methods=['GET'])
@jwt_required()
@require_permission('settings', 'view')
def get_mp_terminals():
    try:
        token = _valid_token()
        if not token:
            return jsonify({'error': 'No hay sesión de Mercado Pago activa'}), 401
        terminals = _list_terminals(token)
        return jsonify(terminals or []), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@point_bp.route('/link', methods=['POST'])
@jwt_required()
@require_permission('settings', 'create')
def link_terminal():
    try:
        data = request.get_json() or {}
        terminal_id = data.get('terminal_id')
        if not terminal_id:
            return jsonify({'error': 'terminal_id requerido'}), 400
        token = _valid_token()
        if not token:
            return jsonify({'error': 'No hay sesión de Mercado Pago activa'}), 401
        terminals = _list_terminals(token) or []
        match = next((t for t in terminals if t.get('id') == terminal_id), None)
        if not match:
            return jsonify({'error': 'Terminal no encontrada en tu cuenta'}), 404
        if match.get('operating_mode') != 'PDV':
            _set_pdv_mode(token, terminal_id)
        _link_local_terminal(match)
        return jsonify({'message': 'Terminal vinculada'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@point_bp.route('/disconnect', methods=['POST'])
@jwt_required()
@require_permission('settings', 'create')
def disconnect():
    try:
        for k in ('mp_access_token', 'mp_refresh_token', 'mp_user_id', 'mp_terminal_id', 'mp_store_id', 'mp_pos_id'):
            _set_setting(k, '')
        db = Database(get_db_path())
        db.execute("UPDATE terminals SET active = 0 WHERE id = 'term_mp_1'")
        return jsonify({'message': 'Desconectado'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------- Órdenes de pago (cobro físico) ----------

@point_bp.route('/charge-status', methods=['GET'])
@jwt_required()
@require_permission('sales', 'view')
def charge_status():
    """Estado mínimo de conexión para que el cajero pueda cobrar con el Point."""
    try:
        token = _valid_token()
        terminal_id = _get_setting('mp_terminal_id')
        return jsonify({
            'connected': bool(token and terminal_id),
            'terminal_id': terminal_id or '',
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@point_bp.route('/orders', methods=['POST'])
@jwt_required()
@require_permission('sales', 'create')
def create_order():
    try:
        token = _valid_token()
        if not token:
            return jsonify({'error': 'No hay sesión de Mercado Pago activa'}), 401
        terminal_id = _get_setting('mp_terminal_id')
        if not terminal_id:
            return jsonify({'error': 'No hay terminal vinculada'}), 400
        data = request.get_json() or {}
        amount = float(data.get('amount', 0))
        if amount <= 0:
            return jsonify({'error': 'Monto inválido'}), 400
        external_reference = data.get('external_reference') or str(uuid.uuid4())[:32]
        payload = {
            'type': 'point',
            'external_reference': external_reference,
            'expiration_time': 'PT10M',
            'transactions': {'payments': [{'amount': f'{amount:.2f}'}]},
            'config': {
                'point': {'terminal_id': terminal_id, 'print_on_terminal': 'no_ticket'},
                'payment_method': {'default_type': data.get('default_type', 'debit_card')},
            },
            'description': 'Venta POS Expendio BB',
            'integration_data': {'platform_id': 'pos_expendio_bb'},
        }
        r = requests.post(f'{MP_API}/v1/orders',
                          headers={**_mp_headers(token), 'X-Idempotency-Key': str(uuid.uuid4())},
                          json=payload, timeout=20)
        if r.status_code not in (200, 201):
            return jsonify({'error': 'MP no aceptó la orden', 'detail': r.text[:400]}), 502
        order = r.json()
        return jsonify({'order_id': order.get('id'), 'order': order}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@point_bp.route('/orders/<order_id>', methods=['GET'])
@jwt_required()
@require_permission('sales', 'view')
def get_order(order_id):
    try:
        token = _valid_token()
        if not token:
            return jsonify({'error': 'No hay sesión de Mercado Pago activa'}), 401
        r = requests.get(f'{MP_API}/v1/orders/{order_id}', headers=_mp_headers(token), timeout=15)
        if r.status_code != 200:
            return jsonify({'error': 'Error consultando orden', 'detail': r.text[:400]}), 502
        return jsonify(r.json()), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@point_bp.route('/orders/<order_id>/cancel', methods=['POST'])
@jwt_required()
@require_permission('sales', 'create')
def cancel_order(order_id):
    try:
        token = _valid_token()
        if not token:
            return jsonify({'error': 'No hay sesión de Mercado Pago activa'}), 401
        r = requests.post(f'{MP_API}/v1/orders/{order_id}/cancel',
                          headers={**_mp_headers(token), 'X-Idempotency-Key': str(uuid.uuid4())},
                          timeout=15)
        return jsonify(r.json()) if r.status_code in (200, 201) else jsonify({'error': 'Error cancelando', 'detail': r.text[:400]}), (200 if r.status_code in (200, 201) else 502)
    except Exception as e:
        return jsonify({'error': str(e)}), 500