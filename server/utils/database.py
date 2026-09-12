import sqlite3
import os
import threading
from datetime import datetime
from contextlib import contextmanager

class Database:
    # Candado global de escritura: serializa las transacciones de escritura
    # dentro de este proceso para evitar carreras (doble cobro, doble descuento).
    write_lock = threading.Lock()

    def __init__(self, db_path):
        self.db_path = db_path
        self.conn = None
        self._in_transaction = False
    
    def get_connection(self):
        if self.conn is None:
            self.conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA foreign_keys = ON")
            self.conn.execute("PRAGMA journal_mode = WAL")
            # NORMAL: con WAL, un corte de energía no corrompe; solo puede perder
            # el último commit (ya confirmado por Flask). Mucho más rápido en escritura.
            self.conn.execute("PRAGMA synchronous = NORMAL")
            # Evita errores "database is locked" en escrituras simultáneas
            self.conn.execute("PRAGMA busy_timeout = 10000")
        return self.conn
    
    @contextmanager
    def transaction(self):
        """Transacción atómica real: todo o nada. Los writes de `execute` dentro
        de este bloque no se confirman hasta salir, y se revierten si algo falla."""
        conn = self.get_connection()
        if self._in_transaction:
            raise RuntimeError("Ya hay una transacción activa en esta conexión")
        conn.execute("BEGIN IMMEDIATE")
        self._in_transaction = True
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._in_transaction = False
    
    @contextmanager
    def write(self):
        """Serie de escritura segura: candado + transacción atómica."""
        with Database.write_lock:
            with self.transaction():
                yield

    def checkpoint(self):
        """Compacta el WAL en la base principal (recomendado en apagados limpios)."""
        try:
            conn = self.get_connection()
            result = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            return result[0] if result else None
        except Exception as e:
            print(f"wal_checkpoint error: {e}")
            return None
    
    def execute(self, query, params=None):
        conn = self.get_connection()
        cursor = conn.cursor()
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)
        if not self._in_transaction:
            conn.commit()
        return cursor
    
    def fetch_all(self, query, params=None):
        conn = self.get_connection()
        cursor = conn.cursor()
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)
        return cursor.fetchall()
    
    def fetch_one(self, query, params=None):
        conn = self.get_connection()
        cursor = conn.cursor()
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)
        return cursor.fetchone()
    
    def init_db(self):
        tables = {
            "users": """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'cashier',
                    pin TEXT,
                    active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """,
            "permissions": """
                CREATE TABLE IF NOT EXISTS permissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role TEXT NOT NULL,
                    module TEXT NOT NULL,
                    can_view INTEGER DEFAULT 0,
                    can_create INTEGER DEFAULT 0,
                    can_edit INTEGER DEFAULT 0,
                    can_delete INTEGER DEFAULT 0
                )
            """,
            "categories": """
                CREATE TABLE IF NOT EXISTS categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    color TEXT DEFAULT '#3b82f6',
                    sort_order INTEGER DEFAULT 0,
                    active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """,
            "products": """
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    barcode TEXT,
                    name TEXT NOT NULL,
                    category_id INTEGER,
                    price REAL DEFAULT 0,
                    cost REAL DEFAULT 0,
                    stock REAL DEFAULT 0,
                    active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (category_id) REFERENCES categories(id)
                )
            """,
            "lots": """
                CREATE TABLE IF NOT EXISTS lots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER NOT NULL,
                    batch_number TEXT,
                    production_date DATE,
                    expiry_date DATE NOT NULL,
                    initial_quantity REAL,
                    current_quantity REAL,
                    sale_price REAL DEFAULT 0,
                    location TEXT DEFAULT 'principal',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (product_id) REFERENCES products(id)
                )
            """,
            "sales": """
                CREATE TABLE IF NOT EXISTS sales (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    subtotal REAL DEFAULT 0,
                    tax REAL DEFAULT 0,
                    total REAL DEFAULT 0,
                    payment_method TEXT,
                    cashier_id INTEGER,
                    cashier_name TEXT,
                    closed INTEGER DEFAULT 0,
                    amount_tendered REAL DEFAULT 0,
                    change_given REAL DEFAULT 0,
                    customer_name TEXT,
                    notes TEXT,
                    cash_register_id INTEGER,
                    FOREIGN KEY (cashier_id) REFERENCES users(id),
                    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id)
                )
            """,
            "sale_items": """
                CREATE TABLE IF NOT EXISTS sale_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sale_id INTEGER,
                    product_id INTEGER,
                    lot_id INTEGER,
                    quantity REAL,
                    unit_price REAL,
                    total REAL,
                    discount REAL DEFAULT 0,
                    FOREIGN KEY (sale_id) REFERENCES sales(id),
                    FOREIGN KEY (product_id) REFERENCES products(id),
                    FOREIGN KEY (lot_id) REFERENCES lots(id)
                )
            """,
            "cash_registers": """
                CREATE TABLE IF NOT EXISTS cash_registers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    open_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    close_date TIMESTAMP,
                    opening_amount REAL DEFAULT 0,
                    total_sales REAL DEFAULT 0,
                    total_cash REAL DEFAULT 0,
                    total_card REAL DEFAULT 0,
                    total_expenses REAL DEFAULT 0,
                    expected_amount REAL,
                    counted_amount REAL,
                    difference REAL,
                    cashier_name TEXT,
                    notes TEXT,
                    status TEXT DEFAULT 'open',
                    user_id INTEGER,
                    terminal TEXT
                )
            """,
            "inventory_movements": """
                CREATE TABLE IF NOT EXISTS inventory_movements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER,
                    lot_id INTEGER,
                    movement_type TEXT,
                    quantity REAL,
                    reference_id INTEGER,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (product_id) REFERENCES products(id),
                    FOREIGN KEY (lot_id) REFERENCES lots(id)
                )
            """,
            "price_history": """
                CREATE TABLE IF NOT EXISTS price_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER,
                    old_price REAL,
                    new_price REAL,
                    changed_by TEXT,
                    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (product_id) REFERENCES products(id)
                )
            """,
            "change_log": """
                CREATE TABLE IF NOT EXISTS change_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT,
                    record_id INTEGER,
                    action TEXT,
                    data TEXT,
                    source TEXT,
                    device_id TEXT,
                    user_id INTEGER,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    synced INTEGER DEFAULT 0
                )
            """,
            "settings": """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """,
            "terminal_transactions": """
                CREATE TABLE IF NOT EXISTS terminal_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    terminal_id TEXT,
                    amount REAL,
                    reference TEXT,
                    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    reconciled INTEGER DEFAULT 0
                )
            """,
            "terminals": """
                CREATE TABLE IF NOT EXISTS terminals (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    commission_rate REAL DEFAULT 0,
                    active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """,
            "promotions": """
                CREATE TABLE IF NOT EXISTS promotions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    buy_quantity INTEGER DEFAULT 1,
                    pay_quantity INTEGER DEFAULT 1,
                    fixed_price REAL,
                    discount_percent REAL,
                    discount_amount REAL,
                    start_date DATE,
                    end_date DATE,
                    active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """,
            "promotion_products": """
                CREATE TABLE IF NOT EXISTS promotion_products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    promotion_id INTEGER,
                    product_id INTEGER,
                    FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE,
                    FOREIGN KEY (product_id) REFERENCES products(id)
                )
            """,
            "promotion_categories": """
                CREATE TABLE IF NOT EXISTS promotion_categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    promotion_id INTEGER,
                    category_id INTEGER,
                    FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE,
                    FOREIGN KEY (category_id) REFERENCES categories(id)
                )
            """,
            "shift_actions": """
                CREATE TABLE IF NOT EXISTS shift_actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    register_id INTEGER NOT NULL,
                    actor_user_id INTEGER NOT NULL,
                    owner_user_id INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (register_id) REFERENCES cash_registers(id),
                    FOREIGN KEY (actor_user_id) REFERENCES users(id),
                    FOREIGN KEY (owner_user_id) REFERENCES users(id)
                )
            """,
            "returns": """
                CREATE TABLE IF NOT EXISTS returns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sale_id INTEGER,
                    sale_item_id INTEGER,
                    product_id INTEGER,
                    lot_id INTEGER,
                    quantity REAL DEFAULT 0,
                    amount REAL DEFAULT 0,
                    refund_method TEXT DEFAULT 'cash',
                    reason TEXT,
                    cash_register_id INTEGER,
                    returned_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (sale_id) REFERENCES sales(id),
                    FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
                    FOREIGN KEY (product_id) REFERENCES products(id),
                    FOREIGN KEY (lot_id) REFERENCES lots(id),
                    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
                    FOREIGN KEY (returned_by) REFERENCES users(id)
                )
            """
        }
        
        for table_name, create_sql in tables.items():
            self.execute(create_sql)
        
        self.create_default_categories()
        self.create_default_users()
        self.create_default_permissions()
        self.run_migrations()
        self.create_indexes()
    
    def create_indexes(self):
        """Índices para las búsquedas y joins más usados (idempotente)."""
        indexes = [
            "CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)",
            "CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)",
            "CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)",
            "CREATE INDEX IF NOT EXISTS idx_lots_product ON lots(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)",
            "CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)",
            "CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_id)",
            "CREATE INDEX IF NOT EXISTS idx_inv_moves_product ON inventory_movements(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id)",
        ]
        for idx in indexes:
            try:
                self.execute(idx)
            except Exception:
                pass
    
    def create_default_categories(self):
        categories = [
            ("Pan Bimbo", "#0072ce"),
            ("Pan de Caja", "#fbbf24"),
            ("Papas Barcel", "#d71920"),
            ("Botanas Barcel", "#d71920"),
            ("Refrescos", "#3b82f6"),
            ("Otros Productos Fríos", "#8b5cf6"),
            ("Caducidad Crítica", "#d71920"),
            ("Otros", "#6b7280")
        ]
        for name, color in categories:
            result = self.fetch_one("SELECT id FROM categories WHERE name = ?", (name,))
            if not result:
                self.execute(
                    "INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)",
                    (name, color, 0)
                )
    
    def create_default_users(self):
        from utils.security import Security
        security = Security()
        
        default_users = [
            ("admin", "admin123", "Administrador Principal", "admin", "0000"),
            ("supervisor", "super123", "Supervisor", "supervisor", "0001"),
            ("cajero", "cajero123", "Cajero Principal", "cashier", "0002")
        ]
        
        for username, password, full_name, role, pin in default_users:
            result = self.fetch_one("SELECT id FROM users WHERE username = ?", (username,))
            if not result:
                password_hash = security.hash_password(password)
                self.execute(
                    "INSERT INTO users (username, password_hash, full_name, role, pin) VALUES (?, ?, ?, ?, ?)",
                    (username, password_hash, full_name, role, pin)
                )
    
    def create_default_permissions(self):
        permissions = [
            # Cajero
            ("cashier", "sales", 1, 0, 0, 0),
            ("cashier", "products", 1, 0, 0, 0),
            ("cashier", "cash_register", 1, 0, 0, 0),
            ("cashier", "reports", 1, 0, 0, 0),
            ("cashier", "settings", 0, 0, 0, 0),
            ("cashier", "users", 0, 0, 0, 0),
            
            # Supervisor
            ("supervisor", "sales", 1, 1, 0, 0),
            ("supervisor", "products", 1, 0, 1, 0),
            ("supervisor", "cash_register", 1, 1, 0, 1),
            ("supervisor", "reports", 1, 1, 0, 0),
            ("supervisor", "settings", 1, 0, 0, 0),
            ("supervisor", "users", 1, 0, 0, 0),
            
            # Administrador
            ("admin", "sales", 1, 1, 1, 1),
            ("admin", "products", 1, 1, 1, 1),
            ("admin", "cash_register", 1, 1, 1, 1),
            ("admin", "reports", 1, 1, 1, 1),
            ("admin", "settings", 1, 1, 1, 1),
            ("admin", "users", 1, 1, 1, 1)
        ]
        
        for role, module, can_view, can_create, can_edit, can_delete in permissions:
            result = self.fetch_one(
                "SELECT id FROM permissions WHERE role = ? AND module = ?", 
                (role, module)
            )
            if not result:
                self.execute(
                    "INSERT INTO permissions (role, module, can_view, can_create, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)",
                    (role, module, can_view, can_create, can_edit, can_delete)
                )
    
    def get_permissions_by_role(self, role):
        rows = self.fetch_all(
            "SELECT module, can_view, can_create, can_edit, can_delete FROM permissions WHERE role = ?",
            (role,)
        )
        permissions = {}
        for row in rows:
            permissions[row['module']] = {
                'can_view': row['can_view'],
                'can_create': row['can_create'],
                'can_edit': row['can_edit'],
                'can_delete': row['can_delete']
            }
        return permissions

    def run_migrations(self):
        migrations = [
            ("ALTER TABLE sale_items ADD COLUMN discount REAL DEFAULT 0", "sale_items", "discount"),
            ("ALTER TABLE sales ADD COLUMN amount_tendered REAL DEFAULT 0", "sales", "amount_tendered"),
            ("ALTER TABLE sales ADD COLUMN change_given REAL DEFAULT 0", "sales", "change_given"),
            ("ALTER TABLE cash_registers ADD COLUMN counted_amount REAL", "cash_registers", "counted_amount"),
            ("ALTER TABLE cash_registers ADD COLUMN notes TEXT", "cash_registers", "notes"),
            ("ALTER TABLE sales ADD COLUMN customer_name TEXT", "sales", "customer_name"),
            ("ALTER TABLE sales ADD COLUMN notes TEXT", "sales", "sale_notes"),
            ("ALTER TABLE products ADD COLUMN stock REAL DEFAULT 0", "products", "stock"),
            ("ALTER TABLE cash_registers ADD COLUMN user_id INTEGER", "cash_registers", "user_id"),
            ("ALTER TABLE cash_registers ADD COLUMN terminal TEXT", "cash_registers", "terminal"),
            ("ALTER TABLE sales ADD COLUMN cash_register_id INTEGER", "sales", "cash_register_id"),
            ("ALTER TABLE inventory_movements ADD COLUMN created_by INTEGER", "inventory_movements", "created_by"),
            ("ALTER TABLE sale_items ADD COLUMN returned_quantity REAL DEFAULT 0", "sale_items", "returned_quantity"),
            ("ALTER TABLE sales ADD COLUMN status TEXT DEFAULT 'active'", "sales", "status"),
            ("ALTER TABLE inventory_movements ADD COLUMN product_name TEXT", "inventory_movements", "product_name"),
            ("ALTER TABLE inventory_movements ADD COLUMN product_barcode TEXT", "inventory_movements", "product_barcode"),
            ("ALTER TABLE inventory_movements ADD COLUMN lot_batch TEXT", "inventory_movements", "lot_batch"),
        ]
        for sql, table, column in migrations:
            try:
                result = self.fetch_one(f"PRAGMA table_info({table})")
                if result:
                    cols = self.fetch_all(f"PRAGMA table_info({table})")
                    col_names = [c['name'] for c in cols]
                    if column not in col_names:
                        self.execute(sql)
            except Exception:
                pass
        self.backfill_movement_snapshots()
        self.migrate_existing_stock()


    def backfill_movement_snapshots(self):
        try:
            self.execute('''
                UPDATE inventory_movements
                SET product_name = (SELECT p.name FROM products p WHERE p.id = inventory_movements.product_id),
                    product_barcode = (SELECT p.barcode FROM products p WHERE p.id = inventory_movements.product_id),
                    lot_batch = (SELECT l.batch_number FROM lots l WHERE l.id = inventory_movements.lot_id)
                WHERE product_name IS NULL
            ''')
        except Exception:
            pass

    def migrate_existing_stock(self):
        try:
            migrated = self.fetch_one("SELECT value FROM settings WHERE key = 'stock_migrated'")
            if migrated:
                return
            rows = self.fetch_all('''
                SELECT p.id, COALESCE(SUM(l.current_quantity), 0) as lot_stock
                FROM products p
                LEFT JOIN lots l ON l.product_id = p.id
                GROUP BY p.id
                HAVING lot_stock > 0
            ''')
            for row in rows:
                if row['lot_stock'] > 0:
                    self.execute('UPDATE products SET stock = ? WHERE id = ?', (row['lot_stock'], row['id']))
            self.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('stock_migrated', '1')")
        except Exception:
            pass


class Security:
    def __init__(self):
        import hashlib
        self.hasher = hashlib
    
    def hash_password(self, password):
        import hashlib
        salt = "POS-EXPENDIO-BB-SALT-2026"
        return self.hasher.sha256((password + salt).encode('utf-8')).hexdigest()
    
    def verify_password(self, password, password_hash):
        return self.hash_password(password) == password_hash