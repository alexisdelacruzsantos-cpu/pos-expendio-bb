#!/bin/bash
# POS EXPENDIO BB - Servidor (Linux)
# Portable: funciona sin importar donde este clonado el proyecto.
# Uso: bash server/start_server.sh   (o ./server/start_server.sh)
cd "$(dirname "$0")/.."
if [ ! -d "venv" ]; then
    echo "No existe venv. Probando crear..."
    python3 -m venv venv
    ./venv/bin/pip install -r server/requirements.txt
fi
cd server
exec ../venv/bin/python app.py