import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('POS_DB_PATH', os.path.join(BASE_DIR, 'static', 'data', 'pos.db'))

# Versión del sistema (único punto de referencia para el módulo de actualizaciones).
# Cada release que deba llegar a las tiendas sube este número y se commitea en main.
APP_VERSION = "1.1.4"

# Repositorio público de actualizaciones (GitHub API, sin token).
GITHUB_OWNER = "alexisdelacruzsantos-cpu"
GITHUB_REPO = "pos-expendio-bb"
GITHUB_BRANCH = "main"


def get_db_path():
    return DB_PATH