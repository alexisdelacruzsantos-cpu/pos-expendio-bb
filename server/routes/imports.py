from flask import Blueprint, request, jsonify, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
import sys
import os
import io
import csv
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import get_db_path
from utils.database import Database
from utils.movements import log_movement

from openpyxl import Workbook, load_workbook

imports_bp = Blueprint('imports', __name__)

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ROWS = 2000
EXPECTED_HEADERS = ['Código de barras', 'Nombre', 'Cantidad']
LEGACY_HEADERS = ['Código de barras', 'Cantidad']
ALLOWED_ROLES = ('admin', 'supervisor')


def _role():
    try:
        v = get_jwt_identity()
        uid = int(v) if v is not None else None
    except Exception:
        uid = None
    if uid is None:
        return None
    db = Database(get_db_path())
    u = db.fetch_one('SELECT role FROM users WHERE id = ?', (uid,))
    return u['role'] if u else None


def _require_role():
    role = _role()
    if role not in ALLOWED_ROLES:
        return False
    return True


def _normalize_barcode(value):
    if value is None:
        return ''
    s = str(value).strip()
    if s.endswith('.0') and s[:-2].isdigit():
        s = s[:-2]
    return s.strip()


def _build_workbook():
    wb = Workbook()
    ws = wb.active
    ws.title = 'Datos'
    ws['A1'] = 'Código de barras'
    ws['B1'] = 'Nombre'
    ws['C1'] = 'Cantidad'
    for cell in ('A1', 'B1', 'C1'):
        ws[cell].font = ws[cell].font.copy(bold=True)
    ws.column_dimensions['A'].width = 22
    ws.column_dimensions['B'].width = 40
    ws.column_dimensions['C'].width = 14
    ws.append(['', '', 1])

    inst = wb.create_sheet('Instrucciones')
    inst.column_dimensions['A'].width = 100
    instructions = [
        'IMPORTAR EXISTENCIAS POR EXCEL',
        '',
        '1. Completa la hoja "Datos" con un producto por fila.',
        '2. Columna A (Código de barras): el código exacto del producto tal como está registrado.',
        '   Si el código empieza con cero (0), escríbelo como texto para no perderlo.',
        '3. Columna B (Nombre): nombre del código de barras (opcional).',
        '   Si el código ya existe, el sistema usa el nombre registrado. Si no existe,',
        '   el nombre se captura junto al código para reutilizarlo en la app del teléfono.',
        '4. Columna C (Cantidad): número entero mayor a 0 de piezas a SUMAR al stock actual.',
        '5. No cambies los encabezados de la primera fila.',
        '6. Guarda el archivo y súbelo en el módulo "Importar". El sistema primero lo valida',
        '   y muestra una previsualización; solo al confirmar se aumenta el stock.',
        '',
        'Los códigos que no existan en el catálogo se ignoran y se reportan en el resumen.',
    ]
    for row in instructions:
        inst.append([row])
    return wb


@imports_bp.route('/template', methods=['GET'])
@jwt_required()
def get_template():
    if not _require_role():
        return jsonify({'error': 'No tienes permisos para importar existencias'}), 403
    try:
        wb = _build_workbook()
        bio = io.BytesIO()
        wb.save(bio)
        bio.seek(0)
        return send_file(
            bio,
            as_attachment=True,
            download_name='plantilla_existencias.xlsx',
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _read_rows_from_file(file):
    filename = (file.filename or '').lower()
    if not filename:
        return None, None, 'Archivo sin nombre de archivo'
    raw = file.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        return None, None, 'El archivo supera el tamaño máximo de 2 MB'

    if filename.endswith('.csv'):
        text = raw.decode('utf-8-sig', errors='replace')
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        return rows, None, None

    if not filename.endswith(('.xlsx', '.xlsm')):
        return None, None, 'Formato no soportado. Sube un archivo .xlsx o .csv'

    try:
        bio = io.BytesIO(raw)
        wb = load_workbook(bio, read_only=True, data_only=True)
        ws = wb.active
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
        return rows, None, None
    except Exception as e:
        return None, None, f'No se pudo leer el archivo Excel: {str(e)}'


@imports_bp.route('/read', methods=['POST'])
@jwt_required()
def read_import():
    if not _require_role():
        return jsonify({'error': 'No tienes permisos para importar existencias'}), 403
    try:
        file = request.files.get('file')
        if file is None:
            return jsonify({'error': 'No se recibió ningún archivo'}), 400

        rows, _, err = _read_rows_from_file(file)
        if err:
            return jsonify({'error': err}), 400
        if not rows:
            return jsonify({'error': 'El archivo está vacío'}), 400

        header = [str(c).strip() if c is not None else '' for c in rows[0]]
        if header == EXPECTED_HEADERS:
            name_idx, qty_idx = 1, 2
        elif header == LEGACY_HEADERS:
            name_idx, qty_idx = None, 1
        else:
            return jsonify({
                'error': f'La plantilla no es válida. Los encabezados deben ser: {EXPECTED_HEADERS[0]} | {EXPECTED_HEADERS[1]} | {EXPECTED_HEADERS[2]}'
            }), 400

        data_rows = rows[1:]
        if len(data_rows) > MAX_ROWS:
            return jsonify({'error': f'El archivo supera el máximo de {MAX_ROWS} filas'}), 400

        merged = {}
        order = []
        errors = []
        row_index = 1
        for r in data_rows:
            row_index += 1
            if all(c is None or str(c).strip() == '' for c in r):
                continue
            barcode = _normalize_barcode(r[0] if len(r) > 0 else None)
            name = str(r[name_idx]).strip() if name_idx is not None and len(r) > name_idx and r[name_idx] is not None else ''
            qty_raw = r[qty_idx] if len(r) > qty_idx else None
            try:
                qty = int(float(qty_raw))
            except (TypeError, ValueError):
                qty = 0
            if not barcode:
                errors.append({'row': row_index, 'reason': 'Código de barras vacío'})
                continue
            if qty <= 0:
                errors.append({'row': row_index, 'reason': f'Cantidad inválida ({qty_raw})'})
                continue
            if barcode in merged:
                merged[barcode] += qty
            else:
                merged[barcode] = qty
                order.append((barcode, name))

        db = Database(get_db_path())
        placeholders = ','.join('?' * len(order))
        products = {}
        if order:
            rows_db = db.fetch_all(f'''
                SELECT id, name, barcode, stock FROM products
                WHERE active = 1 AND barcode IN ({placeholders})
            ''', [b for b, _ in order])
            products = {p['barcode']: p for p in rows_db}

        matches = []
        missing = []
        for barcode, captured_name in order:
            qty = merged[barcode]
            p = products.get(barcode)
            if not p:
                missing.append({'barcode': barcode, 'name': captured_name, 'quantity': qty})
                continue
            current = float(p['stock'] or 0)
            matches.append({
                'product_id': p['id'],
                'barcode': barcode,
                'name': p['name'],
                'quantity': qty,
                'current_stock': current,
                'new_stock': current + qty
            })

        matches.sort(key=lambda m: m['name'].lower())
        return jsonify({
            'rows_read': len(data_rows),
            'unique_codes': len(order),
            'matches': matches,
            'missing': missing,
            'errors': errors,
            'total_to_apply': sum(m['quantity'] for m in matches)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@imports_bp.route('/apply', methods=['POST'])
@jwt_required()
def apply_import():
    if not _require_role():
        return jsonify({'error': 'No tienes permisos para importar existencias'}), 403
    try:
        data = request.get_json(force=True)
        items = data.get('items') or []
        if not items:
            return jsonify({'error': 'No hay productos para aplicar'}), 400
        if len(items) > MAX_ROWS:
            return jsonify({'error': f'El lote supera el máximo de {MAX_ROWS} filas'}), 400

        db = Database(get_db_path())
        results = []
        failures = []
        for it in items:
            product_id = it.get('product_id')
            qty = it.get('quantity')
            try:
                qty = int(float(qty))
            except (TypeError, ValueError):
                qty = 0
            if not product_id or qty <= 0:
                failures.append({'barcode': it.get('barcode'), 'reason': 'Fila inválida'})
                continue
            product = db.fetch_one('SELECT id, name, stock, barcode FROM products WHERE id = ? AND active = 1', (product_id,))
            if not product:
                failures.append({'barcode': it.get('barcode') or str(product_id), 'reason': 'Producto no encontrado'})
                continue
            previous = float(product['stock'] or 0)
            previewed = it.get('current_stock')
            if previewed is not None and abs(float(previewed) - previous) > 1e-9:
                failures.append({'barcode': it.get('barcode'), 'reason':
                    f'El stock cambió desde la previsualización ({previous:g} → {float(previewed):g}). Relee el archivo.'})
                continue
            new_stock = previous + qty
            db.execute('UPDATE products SET stock = ? WHERE id = ?', (new_stock, product_id))
            log_movement(db, product_id=product_id, movement_type='entry', quantity=qty,
                         notes=f'Importación por Excel (plantilla)')
            results.append({
                'product_id': product_id,
                'barcode': product['barcode'],
                'name': product['name'],
                'quantity': qty,
                'previous': previous,
                'new': new_stock
            })

        return jsonify({
            'applied': len(results),
            'failures': failures,
            'results': results
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# Importación de catálogo completo (POS anterior / CATALOGO.xlsx)
# ============================================================
CATALOG_COLUMN_SYNONYMS = {
    'code':       ['código', 'codigo', 'cod', 'codigo de barras', 'barcode'],
    'name':       ['producto', 'nombre', 'product', 'descripcion'],
    'cost':       ['p. costo', 'p costo', 'pcosto', 'costo', 'cost'],
    'price':      ['p. venta', 'p venta', 'pventa', 'precio', 'precio venta', 'price', 'venta'],
    'department': ['departamento', 'categoria', 'depto', 'linea'],
    'existence':  ['existencia', 'existencias', 'stock', 'stock inicial', 'inv. actual', 'inv actual'],
}
CATEGORY_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
                   '#84cc16', '#f97316', '#a855f7', '#14b8a6', '#eab308', '#dc2626', '#0ea5e9',
                   '#6366f1', '#22c55e', '#f43f5e', '#0891b2', '#7c3aed']


def _parse_money(val):
    if val is None:
        return 0.0
    s = str(val).replace('$', '').replace(',', '').strip()
    if s in ('', '-', '—'):
        return 0.0
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def _parse_stock(val):
    if val is None:
        return 0
    s = str(val).replace('$', '').replace(',', '').strip()
    if s in ('', '-', '—'):
        return 0
    try:
        return max(0, int(float(s)))
    except (TypeError, ValueError):
        return 0


def _find_catalog_indexes(header):
    idx = {}
    for key, synonyms in CATALOG_COLUMN_SYNONYMS.items():
        for i, cell in enumerate(header):
            norm = str(cell).strip().lower().replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u')
            if norm in synonyms:
                idx[key] = i
                break
    return idx


@imports_bp.route('/catalog/read', methods=['POST'])
@jwt_required()
def read_catalog():
    if not _require_role():
        return jsonify({'error': 'No tienes permisos para importar catálogo'}), 403
    try:
        file = request.files.get('file')
        if file is None:
            return jsonify({'error': 'No se recibió ningún archivo'}), 400

        rows, _, err = _read_rows_from_file(file)
        if err:
            return jsonify({'error': err}), 400
        if not rows:
            return jsonify({'error': 'El archivo está vacío'}), 400

        header = [c if c is not None else '' for c in rows[0]]
        idx = _find_catalog_indexes(header)
        required = [k for k in ('code', 'name', 'cost', 'price', 'department', 'existence') if k not in idx]
        if required:
            labels = {'code': 'Código', 'name': 'Producto', 'cost': 'P. Costo', 'price': 'P. Venta',
                      'department': 'Departamento', 'existence': 'Existencia'}
            return jsonify({
                'error': f'No se encontraron las columnas esperadas: {", ".join(labels[k] for k in required)}. '
                         f'Encabezados detectados: {[str(c).strip() for c in header][:6]}'
            }), 400

        data_rows = rows[1:]
        if len(data_rows) > MAX_ROWS:
            return jsonify({'error': f'El archivo supera el máximo de {MAX_ROWS} filas'}), 400

        items = []
        errors = []
        row_index = 1
        seen = set()
        for r in data_rows:
            row_index += 1
            if all(c is None or str(c).strip() == '' for c in r):
                continue
            code = _normalize_barcode(r[idx['code']] if len(r) > idx['code'] else None)
            name = str(r[idx['name']]).strip() if len(r) > idx['name'] and r[idx['name']] is not None else ''
            if not code:
                errors.append({'row': row_index, 'reason': 'Código vacío'})
                continue
            if not name:
                errors.append({'row': row_index, 'reason': 'Producto sin nombre'})
                continue
            cost = _parse_money(r[idx['cost']] if len(r) > idx['cost'] else None)
            price = _parse_money(r[idx['price']] if len(r) > idx['price'] else None)
            department = str(r[idx['department']]).strip() if len(r) > idx['department'] and r[idx['department']] is not None else '- Sin Departamento -'
            existence = _parse_stock(r[idx['existence']] if len(r) > idx['existence'] else None)
            key = code
            if key in seen:
                errors.append({'row': row_index, 'reason': f'Código duplicado ({code})'})
                continue
            seen.add(key)
            items.append({
                'row': row_index,
                'code': code,
                'name': name,
                'cost': cost,
                'price': price,
                'department': department,
                'existence': existence
            })

        # Departamentos: cuáles ya existen como categoría
        db = Database(get_db_path())
        existing_cats = {c['name'] for c in db.fetch_all("SELECT name FROM categories WHERE active = 1")}
        departments = []
        seen_dept = set()
        for it in items:
            d = it['department']
            if d not in seen_dept:
                seen_dept.add(d)
                departments.append({'name': d, 'exists': d in existing_cats})

        # Códigos ya registrados en el catálogo activo
        conflicts = []
        known = set()
        codes = [it['code'] for it in items]
        if codes:
            placeholders = ','.join('?' * len(codes))
            known = {p['barcode'] for p in db.fetch_all(
                f'SELECT barcode FROM products WHERE active = 1 AND barcode IN ({placeholders})', codes)}
            for it in items:
                if it['code'] in known:
                    conflicts.append({'code': it['code'], 'name': it['name']})

        for it in items:
            it['exists'] = it['code'] in known

        return jsonify({
            'rows_read': len(data_rows),
            'total': len(items),
            'items': items,
            'departments': departments,
            'conflicts': conflicts,
            'errors': errors,
            'stock_total': sum(it['existence'] for it in items)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@imports_bp.route('/catalog/apply', methods=['POST'])
@jwt_required()
def apply_catalog():
    if not _require_role():
        return jsonify({'error': 'No tienes permisos para importar catálogo'}), 403
    try:
        data = request.get_json(force=True)
        items = data.get('items') or []
        options = data.get('options') or {}
        import_stock = bool(options.get('import_stock', True))
        overwrite = bool(options.get('overwrite', False))
        if not items:
            return jsonify({'error': 'No hay productos para importar'}), 400
        if len(items) > MAX_ROWS:
            return jsonify({'error': f'El catálogo supera el máximo de {MAX_ROWS} filas'}), 400

        # Normalizar ítems
        parsed = []
        for it in items:
            code = _normalize_barcode(it.get('code'))
            name = str(it.get('name') or '').strip()
            if not code or not name:
                continue
            parsed.append({
                'code': code,
                'name': name,
                'cost': _parse_money(it.get('cost')),
                'price': _parse_money(it.get('price')),
                'department': str(it.get('department') or '- Sin Departamento -').strip(),
                'existence': _parse_stock(it.get('existence'))
            })

        if not parsed:
            return jsonify({'error': 'Ninguna fila válida para importar'}), 400

        db = Database(get_db_path())

        # Estado limpio: no se aceptan códigos ya registrados salvo overwrite explícito
        codes = [p['code'] for p in parsed]
        placeholders = ','.join('?' * len(codes))
        existing = {r['barcode'] for r in db.fetch_all(
            f'SELECT barcode FROM products WHERE active = 1 AND barcode IN ({placeholders})', codes)}
        if existing:
            sample = ', '.join(list(existing)[:10])
            if overwrite:
                # Actualizar datos de productos existentes
                for p in parsed:
                    product = db.fetch_one('SELECT id, stock FROM products WHERE barcode = ? AND active = 1', (p['code'],))
                    if product:
                        cat_id = _category_id(db, p['department'], create=True)
                        db.execute('''UPDATE products
                                       SET name = ?, category_id = ?, price = ?, cost = ?,
                                           stock = ? WHERE id = ?''',
                                   (p['name'], cat_id, p['price'], p['cost'],
                                    _parse_stock(p['existence']) if import_stock else product['stock'],
                                    product['id']))
                return jsonify({'message': 'Catálogo actualizado (overwrite)', 'updated': len(parsed)}), 200
            return jsonify({
                'error': f'El catálogo ya contiene {len(existing)} código(s) registrado(s) '
                         f'(ej: {sample}). Para reimportar desde cero ejecuta primero '
                         f'Configuración → "Vaciar catálogo".',
                'existing': len(existing)
            }), 409

        # Categorías
        seen_dept = {}
        inserted = 0
        for p in parsed:
            if p['department'] not in seen_dept:
                seen_dept[p['department']] = _category_id(db, p['department'], create=True)
        with db.transaction() as conn:
            for p in parsed:
                stock = _parse_stock(p['existence']) if import_stock else 0
                conn.execute('''
                    INSERT INTO products (barcode, name, category_id, price, cost, stock, active)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                ''', (p['code'], p['name'], seen_dept[p['department']], p['price'], p['cost'], stock))
                inserted += 1

        return jsonify({
            'message': 'Catálogo importado correctamente',
            'products_inserted': inserted,
            'departments_created': len(seen_dept),
            'stock_loaded': sum(p['existence'] for p in parsed) if import_stock else 0
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _category_id(db, name, create=True):
    name = name.strip() or '- Sin Departamento -'
    row = db.fetch_one('SELECT id FROM categories WHERE name = ?', (name,))
    if row:
        return row['id']
    if not create:
        return None
    count = db.fetch_one('SELECT COUNT(*) AS n FROM categories')['n']
    color = CATEGORY_COLORS[count % len(CATEGORY_COLORS)]
    db.execute('INSERT INTO categories (name, color, active) VALUES (?, ?, 1)', (name, color))
    return db.fetch_one('SELECT id FROM categories WHERE name = ?', (name,))['id']