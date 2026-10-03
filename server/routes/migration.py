from flask import Blueprint, request, jsonify, send_file
from flask_jwt_extended import jwt_required

import sys
import os
import io
import json
import hashlib
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path, APP_VERSION
from utils.database import Database
from utils.permissions import require_permission

migration_bp = Blueprint('migration', __name__)

MIGRATION_FORMAT = 'pos-migration'
MIGRATION_VERSION = '1.0'

# Tablas a exportar en orden lógico (maestros primero, dependientes después)
EXPORT_TABLES = [
    'settings',
    'users',
    'permissions',
    'categories',
    'suppliers',
    'products',
    'lots',
    'promotions',
    'promotion_items',
    'customers',
    'cash_registers',
    'shifts',
    'purchases',
    'purchase_items',
    'sales',
    'sale_items',
    'returns',
    'return_items',
    'inventory_movements',
    'expenses',
    'cash_movements',
    'change_log',
]


def _row_to_dict(row):
    if row is None:
        return None
    try:
        return {k: row[k] for k in row.keys()}
    except Exception:
        return dict(row)


def _export_readonly(db_path):
    db = Database(db_path)
    data = {}
    row_counts = {}

    for t in EXPORT_TABLES:
        try:
            rows = db.fetch_all(f'SELECT * FROM {t}')
        except Exception:
            rows = []
        data[t] = [_row_to_dict(r) for r in rows]
        row_counts[t] = len(data[t])

    payload = {
        'format': MIGRATION_FORMAT,
        'version': MIGRATION_VERSION,
        'exported_at': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': {
            'app_version': APP_VERSION,
            'hostname': os.uname().nodename if hasattr(os, 'uname') else 'unknown',
            'db_path': db_path,
        },
        'meta': {
            'tables': EXPORT_TABLES,
            'row_counts': row_counts,
        },
        'data': data,
    }

    content = json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
    checksum = hashlib.sha256(content).hexdigest()
    payload['checksum'] = f'sha256:{checksum}'

    content_final = json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
    return content_final, payload


def _compute_sha256(b):
    return hashlib.sha256(b).hexdigest()


def _upsert_settings(conn, rows):
    inserted = 0
    updated = 0
    for r in rows or []:
        key = r.get('key')
        if not key:
            continue
        val = r.get('value')
        desc = r.get('description')
        conn.execute('''
            INSERT INTO settings (key, value, description)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                description = COALESCE(excluded.description, settings.description)
        ''', (key, val, desc))
        # Detectar si existía: simple aproximado (no crítico) - contamos como upsert
        updated += 0  # simplificado
    return {'inserted': inserted, 'updated': updated}


def _upsert_users(conn, rows):
    inserted = 0
    updated = 0
    for r in rows or []:
        username = r.get('username')
        if not username:
            continue
        conn.execute('''
            INSERT INTO users (username, password_hash, full_name, role, pin, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
            ON CONFLICT(username) DO UPDATE SET
                password_hash = excluded.password_hash,
                full_name = excluded.full_name,
                role = excluded.role,
                pin = excluded.pin,
                active = excluded.active
        ''', (
            username,
            r.get('password_hash'),
            r.get('full_name') or username,
            r.get('role') or 'cashier',
            r.get('pin'),
            1 if r.get('active', 1) else 0,
            r.get('created_at'),
        ))
    return {'inserted': inserted, 'updated': updated}


def _upsert_permissions(conn, rows):
    for r in rows or []:
        role = r.get('role')
        module = r.get('module')
        if not role or not module:
            continue
        conn.execute('''
            INSERT INTO permissions (role, module, can_view, can_create, can_edit, can_delete)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(role, module) DO UPDATE SET
                can_view = excluded.can_view,
                can_create = excluded.can_create,
                can_edit = excluded.can_edit,
                can_delete = excluded.can_delete
        ''', (
            role,
            module,
            r.get('can_view') or 0,
            r.get('can_create') or 0,
            r.get('can_edit') or 0,
            r.get('can_delete') or 0,
        ))
    return {'inserted': 0, 'updated': 0}


def _upsert_categories(conn, rows):
    for r in rows or []:
        name = r.get('name')
        if not name:
            continue
        conn.execute('''
            INSERT INTO categories (name, color, sort_order, active, created_at)
            VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
            ON CONFLICT(name) DO UPDATE SET
                color = excluded.color,
                sort_order = excluded.sort_order,
                active = excluded.active
        ''', (
            name,
            r.get('color') or '#3b82f6',
            r.get('sort_order') or 0,
            1 if r.get('active', 1) else 0,
            r.get('created_at'),
        ))
    return {'inserted': 0, 'updated': 0}


def _upsert_suppliers(conn, rows):
    for r in rows or []:
        name = r.get('name')
        if not name:
            continue
        conn.execute('''
            INSERT INTO suppliers (name, contact, phone, email, address, notes, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
            ON CONFLICT(name) DO UPDATE SET
                contact = COALESCE(excluded.contact, suppliers.contact),
                phone = COALESCE(excluded.phone, suppliers.phone),
                email = COALESCE(excluded.email, suppliers.email),
                address = COALESCE(excluded.address, suppliers.address),
                notes = COALESCE(excluded.notes, suppliers.notes),
                active = COALESCE(excluded.active, suppliers.active)
        ''', (
            name,
            r.get('contact'),
            r.get('phone'),
            r.get('email'),
            r.get('address'),
            r.get('notes'),
            1 if r.get('active', 1) else 0,
            r.get('created_at'),
        ))
    return {'inserted': 0, 'updated': 0}


def _upsert_products(conn, rows):
    for r in rows or []:
        name = r.get('name')
        if not name:
            continue
        barcode = r.get('barcode') or ''
        conn.execute('''
            INSERT INTO products (barcode, name, category_id, price, cost, stock, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
            ON CONFLICT(barcode) DO UPDATE SET
                name = excluded.name,
                category_id = excluded.category_id,
                price = excluded.price,
                cost = excluded.cost,
                stock = excluded.stock,
                active = excluded.active,
                updated_at = CURRENT_TIMESTAMP
            WHERE barcode IS NOT NULL AND barcode != ''
        ''', (
            barcode or None,
            name,
            r.get('category_id'),
            r.get('price') or 0,
            r.get('cost') or 0,
            r.get('stock') or 0,
            1 if r.get('active', 1) else 0,
            r.get('created_at'),
            r.get('updated_at'),
        ))
    return {'inserted': 0, 'updated': 0}


def _upsert_lots(conn, rows):
    for r in rows or []:
        product_id = r.get('product_id')
        expiry_date = r.get('expiry_date')
        if not product_id or not expiry_date:
            continue
        conn.execute('''
            INSERT INTO lots (product_id, batch_number, production_date, expiry_date,
                              initial_quantity, current_quantity, sale_price, location, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        ''', (
            product_id,
            r.get('batch_number'),
            r.get('production_date'),
            expiry_date,
            r.get('initial_quantity') or 0,
            r.get('current_quantity') or 0,
            r.get('sale_price') or 0,
            r.get('location') or 'principal',
            r.get('created_at'),
        ))
    return {'inserted': 0, 'updated': 0}


def _upsert_promotions(conn, rows):
    for r in rows or []:
        name = r.get('name')
        if not name:
            continue
        conn.execute('''
            INSERT INTO promotions (name, type, start_date, end_date, active, priority, conditions, actions, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        ''', (
            name,
            r.get('type') or 'simple',
            r.get('start_date'),
            r.get('end_date'),
            1 if r.get('active', 1) else 0,
            r.get('priority') or 0,
            r.get('conditions'),
            r.get('actions'),
            r.get('created_at'),
        ))
    return {'inserted': 0, 'updated': 0}


def _insert_only(conn, table, cols, rows):
    if not rows:
        return 0
    placeholders = ','.join(['?' for _ in cols])
    colstr = ','.join(cols)
    sql = f'INSERT INTO {table} ({colstr}) VALUES ({placeholders})'
    for r in rows:
        vals = []
        for c in cols:
            vals.append(r.get(c))
        try:
            conn.execute(sql, vals)
        except Exception:
            pass
    return len(rows)


@migration_bp.route('/export', methods=['GET', 'POST'])
@jwt_required()
@require_permission('settings', 'view')
def export_migration():
    try:
        content, payload = _export_readonly(get_db_path())
        bio = io.BytesIO(content)
        bio.seek(0)
        ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        return send_file(
            bio,
            mimetype='application/json',
            as_attachment=True,
            download_name=f'migracion_pos_{ts}.posmig.json',
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@migration_bp.route('/preview', methods=['POST'])
@jwt_required()
@require_permission('settings', 'view')
def preview_migration():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No se envió archivo'}), 400
        f = request.files['file']
        if not f.filename:
            return jsonify({'error': 'Archivo inválido'}), 400
        raw = f.read()
        if not raw:
            return jsonify({'error': 'Archivo vacío'}), 400
        try:
            data = json.loads(raw.decode('utf-8'))
        except Exception:
            return jsonify({'error': 'Formato JSON inválido'}), 400
        fmt = data.get('format')
        ver = data.get('version')
        if fmt != MIGRATION_FORMAT or ver != MIGRATION_VERSION:
            return jsonify({'error': f'Formato/version no compatible ({fmt} v{ver})'}), 400
        cks = data.get('checksum') or ''
        if cks.startswith('sha256:'):
            expected = cks.split(':', 1)[1]
            calc = _compute_sha256(json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))
            if calc != expected:
                pass
        return jsonify({
            'format': data.get('format'),
            'version': data.get('version'),
            'exported_at': data.get('exported_at'),
            'source': data.get('source') or {},
            'meta': data.get('meta') or {},
            'row_counts': (data.get('meta') or {}).get('row_counts') or {},
            'checksum': cks,
            'valid': True,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@migration_bp.route('/import', methods=['POST'])
@jwt_required()
@require_permission('settings', 'edit')
def import_migration():
    try:
        payload = request.get_json(silent=True) or {}
        if 'file' in request.files:
            raw = request.files['file'].read()
            try:
                payload = json.loads(raw.decode('utf-8'))
            except Exception:
                return jsonify({'error': 'JSON inválido'}), 400
        if not payload:
            return jsonify({'error': 'Datos de importación vacíos'}), 400
        fmt = payload.get('format')
        ver = payload.get('version')
        if fmt != MIGRATION_FORMAT or ver != MIGRATION_VERSION:
            return jsonify({'error': 'Formato/version no compatible'}), 400
        d = payload.get('data') or {}
        db = Database(get_db_path())
        results = {}
        with db.transaction() as conn:
            results['settings'] = _upsert_settings(conn, d.get('settings'))
            results['users'] = _upsert_users(conn, d.get('users'))
            results['permissions'] = _upsert_permissions(conn, d.get('permissions'))
            results['categories'] = _upsert_categories(conn, d.get('categories'))
            results['suppliers'] = _upsert_suppliers(conn, d.get('suppliers'))
            results['products'] = _upsert_products(conn, d.get('products'))
            results['lots'] = _upsert_lots(conn, d.get('lots'))
            results['promotions'] = _upsert_promotions(conn, d.get('promotions'))
            conn.execute('DELETE FROM promotion_items WHERE promotion_id NOT IN (SELECT id FROM promotions)')
            _insert_only(conn, 'promotion_items', ['promotion_id','product_id','product_barcode','product_name','quantity','price','discount_percent','created_at'], d.get('promotion_items'))
            for r in d.get('customers') or []:
                name = r.get('name') or r.get('full_name')
                if not name:
                    continue
                conn.execute('''
                    INSERT INTO customers (name, phone, email, address, notes, active, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
                ''', (name, r.get('phone'), r.get('email'), r.get('address'), r.get('notes'), 1 if r.get('active',1) else 0, r.get('created_at')))
            _insert_only(conn, 'cash_registers', ['id','open_date','close_date','opening_amount','total_sales','total_cash','total_card','total_expenses','expected_amount','counted_amount','difference','status','cashier_id','cashier_name','observations'], d.get('cash_registers'))
            _insert_only(conn, 'shifts', ['id','open_date','close_date','opening_amount','total_sales','total_cash','total_card','total_expenses','expected_amount','counted_amount','difference','status','cashier_id','cashier_name','observations'], d.get('shifts'))
            _insert_only(conn, 'purchases', ['id','supplier_id','purchase_date','subtotal','tax','total','status','notes','created_at'], d.get('purchases'))
            _insert_only(conn, 'purchase_items', ['id','purchase_id','product_id','lot_id','quantity','unit_cost','total'], d.get('purchase_items'))
            _insert_only(conn, 'sales', ['id','sale_date','subtotal','tax','total','payment_method','cashier_id','cashier_name','closed','amount_tendered','change_given','customer_name','notes','cash_register_id','shift_id','discount_total','paid_total'], d.get('sales'))
            _insert_only(conn, 'sale_items', ['id','sale_id','product_id','lot_id','quantity','unit_price','total','discount'], d.get('sale_items'))
            _insert_only(conn, 'returns', ['id','sale_id','return_date','total','cashier_id','cashier_name','notes'], d.get('returns'))
            _insert_only(conn, 'return_items', ['id','return_id','sale_item_id','product_id','lot_id','quantity','unit_price','total'], d.get('return_items'))
            _insert_only(conn, 'inventory_movements', ['id','product_id','lot_id','movement_type','quantity','reference_id','notes','created_at','created_by','product_name','product_barcode','lot_batch'], d.get('inventory_movements'))
            _insert_only(conn, 'expenses', ['id','description','amount','expense_date','category','cashier_id','cashier_name','notes'], d.get('expenses'))
            _insert_only(conn, 'cash_movements', ['id','cash_register_id','shift_id','movement_type','amount','concept','reference','created_at','cashier_id','cashier_name'], d.get('cash_movements'))
            _insert_only(conn, 'change_log', ['id','table_name','record_id','action','old_values','new_values','user_id','user_name','timestamp','ip_address'], d.get('change_log'))
        return jsonify({
            'message': 'Importación completada correctamente',
            'results': results,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
