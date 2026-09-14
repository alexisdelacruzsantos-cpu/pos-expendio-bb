# POS EXPENDIO BB

Sistema de Punto de Venta para Expendio de Pan Bimbo y Productos Barcel

## Stack Tecnológico

### Backend (POS)
- **Python 3.8+**
- **Flask**
- **SQLite**
- **HTML/CSS/JS (PWA)**

### Móvil (Flutter)
- **Flutter 3.x**
- **SQLite**
- **Supabase**

## Instalación y Ejecución

### 0. Instalación automática en Windows 8.1/10/11 (tienda)

Si el equipo de la tienda tiene Windows 8.1 (Internet Explorer viejo, sin Git ni Python), copiar al equipo:

- `server/instalar_vm.bat` y `server/instalar_vm.ps1` (los dos, en una carpeta limpia vacía)

y hacer doble clic en `instalar_vm.bat` (idealmente "Ejecutar como administrador"). El script:

1. Fuerza TLS 1.2 y descarga Python 3.9.13 + Git 2.46.2 (último compatible con 8.1).
2. Los instala en silencio.
3. Pide un GitHub **Personal Access Token** (con permiso de lectura del repo privado).
4. Clona el repo, crea el venv, instala dependencias (Flask, waitress, JWT).
5. Registra el arranque automático "POS Expendio BB" al iniciar sesión.

Después solo hay que hacer doble clic en `server/start_pos.bat` y entrar a `http://127.0.0.1:5000`.

> **¿Problemas al instalar en Windows 8.1?** Consulta `NOTAS_DESPLIEGUE.md` — documenta
> los errores reales encontrados (UCRT que falla en Python, dependencias que piden
> Python 3.10, IE11 sin soporte del login → instalar Firefox 115 ESR, permisos UAC
> en el arranque automático, etc.) con sus soluciones.
>
> **¿Cómo llegan los cambios a las tiendas?** Consulta `PROCESO_RELEASE.md` — el flujo
> de publicar cambios/subir `APP_VERSION`, el sistema de actualizaciones web y la
> convención para cambios de esquema de base de datos.

### 1. Clonar este repositorio

```bash
git clone "https://github.com/tu-usuario/POS-EXPENDIO-BB.git"
cd POS-EXPENDIO-BB
```

### 2. Configurar entorno Python

#### Crear y activar entorno virtual

```bash
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate
```

#### Instalar dependencias

```bash
pip install -r server/requirements.txt
```

### 3. Iniciar el servidor POS

```bash
cd server
python app.py
```

El servidor se ejecutará en `http://localhost:5000`

### 4. Configurar la interfaz del POS

Abra un navegador web e ingrese a `http://localhost:5000`

### 5. Configurar el entorno móvil

```bash
# En el directorio raíz
flutter pub get
flutter run  # Para iOS/Android
```

### 6. (Opcional) Instalar Playwright para testing automatizado
```bash
source venv/bin/activate
pip install playwright
playwright install chromium
```
Permite detectar errores JS en consola y automatizar flujos de UI.

## Estructura del Proyecto

```
POS-EXPENDIO-BB/
├── server/
│   ├── app.py                    # Servidor principal Flask
│   ├── requirements.txt         # Dependencias del servidor
│   ├── models/
│   │   ├── products.py           # Modelo de productos
│   │   ├── sales.py              # Modelo de ventas
│   │   ├── users.py              # Modelo de usuarios y roles
│   │   └── __init__.py           # Módulo de modelos
│   ├── routes/
│   │   ├── auth.py              # Autenticación
│   │   ├── products.py          # Gestión de productos
│   │   ├── sales.py             # Registro de ventas
│   │   ├── cash.py              # Cortes de caja
│   │   ├── reports.py           # Reportes y estadísticas
│   │   ├── settings.py          # Configuración del sistema
│   │   └── __init__.py          # Rutas
│   ├── utils/
│   │   ├── database.py          # Conexión y migraciones de BD
│   │   ├── backup.py            # Utilidades de respaldo
│   │   └── security.py          # Seguridad y validación
│   ├── templates/               # Plantillas HTML para PWA
│   │   ├── index.html
│   │   └── ... (otros HTML)
│   └── static/                 # Archivos estáticos (CSS, JS, iconos)
└── docs/                       # Documentación (er_diagram.png)
    └── README.md               # Este archivo
```

## Features

### POS (Ventanilla)
- Registro de ventas en tiempo real
- Escaneo de códigos de barras
- Impresión de tickets térmicos
- Sistema de roles y permisos
- Control de caducidad
- Cortes de caja
- Reportes de ventas

### Móvil (Administración)
- Gestión de productos y precios
- Consulta de reportes
- Edición de configuraciones
- Sincronización con POS

## Características

### Sistema de Roles
- **Cajero**: Ventas, consulta de inventario, impresión de tickets
- **Supervisor**: Vendedor + cortes de caja, reportes básicos
- **Administrador**: Control total, gestión de usuarios, configuración

### Control de Caducidad
- Alertas automáticas de productos por vencer
- Visualización por lote
- Reportes de caducidad

### Impresión de Tickets
- Soporte para impresoras térmicas USB/Serial
- Formato de ticket personalizable
- Impresión remota (server + móvil)

### Sincronización
- Backup local diario automático
- Sincronización con Supabase opcional
- Respaldo manual

## Licencia
Este proyecto está bajo licencia MIT.
