#!/bin/bash
# POS EXPENDIO BB - Instalador para Linux (Deja en produccion)
# Uso: sudo bash server/instalar_linux.sh
set -e

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="pos-expendio-bb"
# El usuario real que lanzo el instalador (sudo pone SUDO_USER; si no, el de sesion).
RUN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"

echo "=============================================="
echo " POS EXPENDIO BB - Instalador Linux"
echo " Proyecto: $PROJECT"
echo "=============================================="

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: ejecutar con sudo:  sudo bash server/instalar_linux.sh"
    exit 1
fi

# 1) Dependencias del sistema
echo "[1/4] Instalando dependencias del sistema..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip

# 2) Entorno virtual + dependencias Python
echo "[2/4] Creando entorno virtual..."
if [ ! -d "$PROJECT/venv" ]; then
    python3 -m venv "$PROJECT/venv"
fi
"$PROJECT/venv/bin/pip" install --quiet -r "$PROJECT/server/requirements.txt"

# 3) Carpeta de datos y permisos
echo "[3/4] Preparando carpetas..."
mkdir -p "$PROJECT/server/static/data"
mkdir -p "$PROJECT/pos/logs"
chmod +x "$PROJECT/server/start_server.sh" || true
# El servicio corre como el usuario real, NO root: hay que pasarle estas carpetas
# (so pena de "unable to open database file" al arrancar).
chown -R "$RUN_USER":"$RUN_USER" "$PROJECT/server/static" || true
chown -R "$RUN_USER":"$RUN_USER" "$PROJECT/pos" || true

# 4) Servicio systemd (autoinicio al encender la PC)
echo "[4/4] Configurando autoinicio (systemd)..."
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
cat > "$UNIT" <<EOF
[Unit]
Description=POS EXPENDIO BB - Servidor principal
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$PROJECT/server
ExecStart=$PROJECT/venv/bin/python app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true

# Arrancar si no esta corriendo
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    systemctl start "$SERVICE_NAME"
fi

echo "------------------------------------------------"
echo " INSTALACION COMPLETA"
echo " El servidor arranca solo con la PC."
echo " URL:      http://127.0.0.1:5000"
echo " Usuario:  admin    Clave: admin123"
echo " Comandos utiles:"
echo "   systemctl status $SERVICE_NAME"
echo "   systemctl restart $SERVICE_NAME"
echo "   journalctl -u $SERVICE_NAME -f"
echo "------------------------------------------------"