from datetime import datetime as _dt

from flask_jwt_extended import get_jwt_identity


def current_user_id():
    try:
        v = get_jwt_identity()
        return int(v) if v is not None else None
    except Exception:
        return None


def log_movement(db, product_id=None, lot_id=None, movement_type='entry', quantity=0,
                 notes=None, reference_id=None, product_name=None, product_barcode=None,
                 lot_batch=None):
    if product_name is None and product_id is not None:
        p = db.fetch_one('SELECT name, barcode FROM products WHERE id = ?', (product_id,))
        if p:
            product_name = p['name']
            product_barcode = p['barcode']
    if lot_batch is None and lot_id is not None:
        l = db.fetch_one('SELECT batch_number FROM lots WHERE id = ?', (lot_id,))
        if l:
            lot_batch = l['batch_number']

    db.execute('''
        INSERT INTO inventory_movements
            (product_id, lot_id, movement_type, quantity, reference_id, notes,
             created_by, created_at, product_name, product_barcode, lot_batch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (product_id, lot_id, movement_type, quantity, reference_id, notes,
          current_user_id(), _dt.now().strftime('%Y-%m-%d %H:%M:%S'),
          product_name, product_barcode, lot_batch))