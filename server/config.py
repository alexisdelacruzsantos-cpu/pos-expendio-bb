import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('POS_DB_PATH', os.path.join(BASE_DIR, 'static', 'data', 'pos.db'))


def get_db_path():
    return DB_PATH