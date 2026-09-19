# PAN BIMBO POS - Progreso del Proyecto

## Información del Proyecto
- **Nombre:** POS-EXPENDIO-BB (Expendio Bimbo y Barcel)
- **Tipo:** Sistema de Punto de Venta
- **Versión:** 1.2.1
- **Fecha inicio:** 01/09/2026

---

## ESTADO ACTUAL: FASE 9 TERMINALES COMPLETADA + REPORTES SEMANALES + APP MÓVIL (FASE 6) + DESPLIEGUE EN TIENDA ✓

> **Versión actual:** `1.2.1` (último release en repo; la tienda se actualiza vía `POST /api/updates/apply`)
> **Despliegue en tienda:** servidor en `192.168.1.6:5000` (admin/admin123), actualizaciones web funcionando. Ver `PROCESO_RELEASE.md`.
> **Fecha:** 19/09/2026

### Lo que funciona hasta ahora:

#### ✅ Backend (Flask + Python)
- Servidor REST con autenticación JWT
- Base de datos SQLite con 20+ tablas, migraciones automáticas
- 8 usuarios creados (admin, supervisor, cajero) + 8 categorías de productos
- 35+ productos de ejemplo cargados
- APIs: productos, ventas, caja, reportes, promociones, lotes, terminales MP Point, actualizaciones
- Sistema de roles y permisos
- Cálculo automático de promociones en ventas (4 tipos)
- Control de caducidad con lotes (FIFO)
- Cortes de caja con conteo físico y diferencia
- Terminales Mercado Pago Point (OAuth, vinculación, cobro, polling, recargo comisión, errores detail)
- Módulo de actualizaciones web (`/api/updates/*`)
- Descuento manual en ventas
- Auto-selección de lote FIFO, `force_no_stock` para ventas forzadas
- Verificador de precios F9
- Importación desde Excel, stock general + lote
- Escaneo fluido con registro de productos nuevos
- Promociones con alcance por producto específico
- Ajustes de stock/precios con lote GENERAL + selectores de lote
- Historial de movimientos con búsqueda y filtro por departamento
- Endpoint `/api/auth/users` para autocompletado de usuario en login

#### ✅ Frontend (PWA HTML/CSS/JS)
- Página de login con autofocus
- Dashboard con navegación por tabs
- **Sección Ventas (POS)** rediseñada: barra delgada, overlay de búsqueda con cards, ticket con scroll interno, card total clickeable, modal de pago F12, overstock confirm
- **Sección Inventario** con tabla y agregar stock por lote
- **Sección Reportes**: ventas por día, ventas/ganancia por departamento, botones de periodo (Semana Actual, Mes Actual, Mes Anterior, Año Actual)
- **Sección Caja** con tabs, historial, recibos
- **Sidebar colapsable** con persistencia
- **PWA icons** 192px/512px
- Reloj superior con colores dinámicos
- Soporte teclado completo: F12, F9, F2, F4, +, -, Del, Ctrl+Del, ↑/↓, Enter, Esc
- Login con autocompletado de usuario (dropdown navegable con flechas)
- Modo kiosko/pantalla completa bloqueada (ESC/F11 no salen), compatible Firefox `-kiosk`
- Navegación con flechas/Enter y cierre con ESC en selector de precio/lote y modal de pago

#### ✅ CSS
- Layout POS responsive con sticky headers
- Estilos para todos los modales y cards
- Colores coherentes (cards, badges, status colors)

---

## Estructura del Proyecto

```
POS-EXPENDIO-BB/
├── server/
│   ├── app.py                    # Servidor principal Flask
│   ├── config.py                 # Configuración (APP_VERSION 1.2.1)
│   ├── requirements.txt          # Dependencias
│   ├── start_server.sh           # Script de arranque
│   ├── routes/                   # API endpoints
│   │   ├── auth.py              # Autenticación JWT
│   │   ├── products.py          # Gestión productos
│   │   ├── sales.py             # Registro ventas
│   │   ├── cash.py              # Cortes de caja
│   │   ├── reports.py           # Reportes
│   │   ├── point.py             # Mercado Pago Point
│   │   ├── updates.py           # Updates web
│   │   ├── settings.py          # Configuración
│   │   └── promotions.py        # Promociones
│   ├── utils/                    # Utilidades
│   │   ├── database.py          # DB + migraciones
│   │   ├── backup.py            # Respaldo
│   │   └── security.py          # Seguridad
│   ├── templates/                # HTML (index.html, dashboard.html)
│   ├── static/                   # CSS, JS, iconos, data
│   └── ...
├── venv/                         # Entorno virtual
├── mobile/                       # App móvil Flutter (Fase 6)
│   └── lib/
│       ├── main.dart            # Entry point + AuthWrapper
│       ├── providers/           # AuthProvider (sesión)
│       ├── services/            # ApiService (HTTP + token + baseUrl)
│       ├── models/              # Modelos de respuesta del API
│       ├── screens/             # login, home, reportes, historial, productos, ajustes
│       ├── widgets/             # server_selector (cambiar servidor)
│       └── theme/               # Tema de la app
├── instalar_linux.sh             # Instalador Linux
├── instalador/                   # Instalador Windows
└── docs/er_diagram.png           # Diagrama ER
```

---

## Fases Completadas

- [x] **Fase 1:** Setup del proyecto
- [x] **Fase 2:** Catálogo + Categorías + Promociones
- [x] **Fase 3:** Sistema de ventas ← Completada 01/09/2026
- [x] **Fase 4:** Control de caducidad (lotes) + FIFO ← Completada 01/09/2026
- [x] **Fase 5:** Cortes de caja ← Completada 01/09/2026
- [x] **Fase 9:** Terminales de pago Mercado Pago Point ← Completada 08/09/2026
- [~] **Fase 8:** Reportes — en curso (tablas por día/departamento listas, faltan gráficas)
- [~] **Fase 6:** App móvil (Flutter) — en curso: login, home, reporte de ventas (fecha única), historial, productos y ajustes de inventario funcionando contra el POS. Falta sincronización (Fase 7) y APK para el celular. Ver `NOTAS_FASE6.md`.
- [ ] Fase 7: Sincronización (Supabase) — no iniciada
- [ ] Fase 10: Pruebas finales y documentación

---

## Cambios recientes (05/09 - 19/09/2026, releases v1.0.0 → v1.2.1)

### Releases 1.1.33 → 1.2.1 (ultimo avance)
- **1.2.1 — Promociones:** solo alcance por producto específico, mostrar stock general y filtrar productos sin existencia.
- **1.2.0 — Login:** autocompletado de usuario (endpoint `/api/auth/users` + dropdown navegable con flechas).
- **1.1.55 — Ajustes:** guardar solo precio/costo sin stock, mostrar productos stock 0 en búsqueda, F4 limpia formulario, refresco de búsqueda tras ajuste.
- **1.1.54/1.1.53 — Historial de movimientos:** búsqueda automática + filtro por departamento.
- **1.1.49-1.1.52 — Ajustes lotes:** opción GENERAL para ver/modificar stock global, ocultar lotes con cantidad 0, desactivar filtro "solo con stock" en modo ajustes.
- **1.1.48 — Seguridad:** vulnerabilidades corregidas para el rol cajero.
- **1.1.42-1.1.47 — Kiosko/fullscreen:** pantalla completa automática y bloqueada (ESC no sale), modo Firefox `-kiosk`, atajos F2/F3/F4/F9/F10/F12 restaurados, navegación con flechas/Enter en selector de precio/lote y cierre con ESC sin salir del fullscreen.
- **1.1.42 — Roles:** eliminar rol supervisor, mejorar edición de usuarios/contraseñas y matriz de permisos para cajeros.
- **1.1.38-1.1.41 — Ajustes/Agregar inventario:** se elimina el módulo "Agregar inventario" (duplicado de Ajustes), atajo F4 abre Ajustes, motivo opcional, reconstrucción de estilos del overlay/quote y ticket.
- **1.1.33-1.1.37 — Modal rápido:** limpiar pantalla tras guardar, Enter entre campos, stock actual destacado (más grande/negrita) y navegación izquierda/derecha para cambiar método de pago en F12.

### Backend
- **Módulo de actualizaciones web** (`/api/updates/*`): check, apply, restart con systemd-aware, backup automático.
- **Instalador Linux systemd** + Windows: arranque automático, reinicio, compatible con Win8.1.
- **Bloqueo de turno** (`shift_required`) impide operaciones sin turno activo.
- **Promociones**: 4 tipos (BOGO, fixed_price, percent, fixed_discount), bug `fixed_price` corregido, alcance por producto específico.
- **Terminales MP Point**: OAuth, vinculación, cobro durante venta, polling estado, detecta `processed/accredited`, recargo comisión, `print_on_terminal`, detalle de errores, cierre seguro.
- **Verificador de precios F9** y **escaneo fluido** con registro de productos nuevos.

### Frontend
- **POS rediseño completo**: card total clickeable, modal F12, scroll ticket interno.
- **Búsqueda virtualizada** con debounce 50ms y render progresivo (60 cards).
- **Sección Inventario** con tabla y agregar stock por lote.
- **Reportes**: tabs, ventas por día, ventas/ganancia por departamento, botones periodo.
- **Sidebar** colapsable, fullscreen automático, PWA icons.

### Bugs críticos corregidos
- `closeAllOverlays` rompía todo el script JS → función cerrada correctamente.
- `return` suelto al final del archivo eliminado.
- Modal turno "Cerrar y abrir nuevo" valida contraseña propietario.
- Botón "Cerrar sesión" ahora usa `handleCloseSession`.
- `print_on_terminal` usaba `yes_ticket` → ahora `seller_ticket`.
- Contador de ticket usaba `cart.length` → ahora suma cantidades.
- Filtro stock usaba `effective_stock` → ahora usa `getAvailableStock` (mismo cálculo que card).

---

## Próximos Pasos Sugeridos
- [ ] Refactorizar CSS: eliminar reglas `.pos-payment-methods` y `.pos-cash-row` obsoletas.
- [ ] Proteger la ruta `/dashboard` para que redirija a login si no hay token.
- [ ] Implementar **gráficas de reportes** (charts tipo las imágenes de referencia).
- [ ] **Re-imprimir último ticket** de venta (solo existe recibo de cierre de caja).
- [ ] **Impresora térmica USB/Serial (escpos)** — no implementada.
- [ ] **App móvil Flutter** (Fase 6): probar contra la tienda `192.168.1.8` y generar APK Android para el celular. Siguiente fase: sincronización (Fase 7).
- [ ] **Sincronización Supabase** (Fase 7) — no iniciada.
- [ ] **Mejorar ticket modal**: método de pago, lote por producto, descuentos.

---

## Para Continuar Mañana

### Paso 1: Abrir terminal y navegar al proyecto
```bash
cd /home/alexis/POS-EXPENDIO-BB/server
```

### Paso 2: Activar entorno virtual
```bash
source ../venv/bin/activate
```

### Paso 3: Iniciar el servidor
```bash
python app.py
```

### Paso 4: Abrir navegador
- URL: http://localhost:5000
- Login: `admin` / `admin123`

---

## Archivos Importantes para Continuar

| Archivo | Descripción |
|---------|-------------|
| `/home/alexis/POS-EXPENDIO-BB/README.md` | Documentación general |
| `/home/alexis/POS-EXPENDIO-BB/server/app.py` | Servidor principal |
| `/home/alexis/POS-EXPENDIO-BB/server/static/data/pos.db` | Base de datos |
| `/home/alexis/POS-EXPENDIO-BB/PLAN_FINAL.md` | Plan de desarrollo actualizado |
| `/home/alexis/POS-EXPENDIO-BB/PROCESO_RELEASE.md` | Flujo de publicación/actualizaciones |
| `/home/alexis/POS-EXPENDIO-BB/AGENTS.md` | Convenciones del repositorio |

---

## Notas Técnicas

### Credenciales de prueba
| Usuario | Contraseña | Rol |
|---------|------------|-----|
| admin | admin123 | Administrador |
| supervisor | super123 | Supervisor |
| cajero | cajero123 | Cajero |

### Base de datos
- Ubicación: `server/static/data/pos.db`
- Contiene: 35+ productos de ejemplo, 8 categorías, usuarios, tablas de reportes

### Tecnologías usadas
- Backend: Flask + SQLite
- Frontend: HTML5 + CSS3 + JavaScript (vanilla)
- Autenticación: JWT
- **Testing:** Playwright + Chromium headless

### Herramientas de testing
- **Playwright** (`venv/lib/python3.12/site-packages/playwright`)
- **Comando instalación:** `playwright install chromium` (~115 MB en `~/.cache/ms-playwright/`)
- Ubicación test: `/tmp/test_*.py`
- Sirve para detectar errores: `ReferenceError`, `SyntaxError`, modales rotos, botones sin handler.

### Versión actual
- `APP_VERSION = "1.2.1"` (server/config.py)
- Tienda: `192.168.1.6:5000` (admin/admin123)
- SSH: `expendiobimbo@192.168.1.6`

---

*Última actualización: 19/09/2026 - Fase 6 (app móvil Flutter) en curso: login, home, reportes, historial, productos y ajustes funcionando; fixes de CORS/trailing slash, parseo `category_color` y reporte por fecha única. Último release del POS: v1.2.1 (promociones por producto + autocompletado login). Ver `NOTAS_FASE6.md`*
