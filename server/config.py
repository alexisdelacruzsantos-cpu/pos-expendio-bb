import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('POS_DB_PATH', os.path.join(BASE_DIR, 'static', 'data', 'pos.db'))

# Versión del sistema (único punto de referencia para el módulo de actualizaciones).
# Cada release que deba llegar a las tiendas sube este número y se commitea en main.
APP_VERSION = "1.4.6"

# Repositorio público de actualizaciones (GitHub API, sin token).
GITHUB_OWNER = "alexisdelacruzsantos-cpu"
GITHUB_REPO = "pos-expendio-bb"
GITHUB_BRANCH = "main"

# Sincronización Fase 7 (espejo de solo lectura en host gratuito).
# En el HOST se fija SYNC_TOKEN como variable de entorno; en la TIENDA el token
# vive en la tabla `settings` (fuera de git). Nunca debe commitearse.
SYNC_TOKEN = os.environ.get('SYNC_TOKEN', '')

# POS_READONLY=1 (host): el backend rechaza toda escritura salvo login, validate
# y el push /api/sync/db. La tienda NO usa este flag.
POS_READONLY = os.environ.get('POS_READONLY', '').lower() in ('1', 'true', 'yes', 'on')

# POS_HOST=1 (host): la raíz '/' redirige a la app móvil (/movil/).
POS_HOST = os.environ.get('POS_HOST', '').lower() in ('1', 'true', 'yes', 'on')


def get_db_path():
    return DB_PATH