#!/usr/bin/env python3
"""
POS EXPENDIO BB - Utilidad de Respaldo
Genera respaldos de la base de datos
"""

import sqlite3
import os
import shutil
from datetime import datetime

def create_backup(db_path, backup_dir):
    if not os.path.exists(db_path):
        print(f"Error: Base de datos no encontrada en {db_path}")
        return False
    
    os.makedirs(backup_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_filename = f'pos_backup_{timestamp}.db'
    backup_path = os.path.join(backup_dir, backup_filename)
    
    try:
        shutil.copy2(db_path, backup_path)
        print(f"✓ Respaldo creado exitosamente: {backup_path}")
        
        # Mantener solo los últimos 30 respaldos
        backups = sorted([f for f in os.listdir(backup_dir) if f.startswith('pos_backup_')])
        while len(backups) > 30:
            oldest = backups.pop(0)
            os.remove(os.path.join(backup_dir, oldest))
            print(f"  Eliminando respaldo antiguo: {oldest}")
        
        return True
    
    except Exception as e:
        print(f"Error al crear respaldo: {e}")
        return False

def restore_backup(backup_path, db_path):
    if not os.path.exists(backup_path):
        print(f"Error: Archivo de respaldo no encontrado: {backup_path}")
        return False
    
    try:
        # Crear respaldo del estado actual antes de restaurar
        current_backup = db_path + '.before_restore'
        if os.path.exists(db_path):
            shutil.copy2(db_path, current_backup)
            print(f"  Respaldo del estado actual: {current_backup}")
        
        shutil.copy2(backup_path, db_path)
        print(f"✓ Base de datos restaurada desde: {backup_path}")
        return True
    
    except Exception as e:
        print(f"Error al restaurar respaldo: {e}")
        return False

def list_backups(backup_dir):
    if not os.path.exists(backup_dir):
        print("No hay respaldos disponibles")
        return []
    
    backups = sorted([f for f in os.listdir(backup_dir) if f.startswith('pos_backup_')], reverse=True)
    
    print("\nRespaldos disponibles:")
    print("-" * 50)
    for i, backup in enumerate(backups, 1):
        path = os.path.join(backup_dir, backup)
        size = os.path.getsize(path)
        mtime = datetime.fromtimestamp(os.path.getmtime(path))
        print(f"{i}. {backup} ({size / 1024:.1f} KB) - {mtime}")
    
    return backups

if __name__ == '__main__':
    import sys
    
    # Configuración
    base_dir = os.path.dirname(os.path.dirname(__file__))
    db_path = os.path.join(base_dir, 'server', 'static', 'data', 'pos.db')
    backup_dir = os.path.join(base_dir, 'pos', 'backup')
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == 'backup':
            create_backup(db_path, backup_dir)
        
        elif command == 'restore' and len(sys.argv) > 2:
            backup_file = sys.argv[2]
            backup_path = os.path.join(backup_dir, backup_file)
            restore_backup(backup_path, db_path)
        
        elif command == 'list':
            list_backups(backup_dir)
        
        elif command == 'auto':
            # Respaldo automático (para programar con cron)
            create_backup(db_path, backup_dir)
        
        else:
            print("Uso:")
            print("  python backup.py backup    - Crear respaldo")
            print("  python backup.py list      - Listar respaldos")
            print("  python backup.py restore <archivo> - Restaurar respaldo")
            print("  python backup.py auto      - Respaldo automático")
    else:
        print("Uso:")
        print("  python backup.py backup    - Crear respaldo")
        print("  python backup.py list      - Listar respaldos")
        print("  python backup.py restore <archivo> - Restaurar respaldo")
        print("  python backup.py auto      - Respaldo automático")