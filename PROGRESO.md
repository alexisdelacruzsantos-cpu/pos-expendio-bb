# PAN BIMBO POS - Progreso del Proyecto

## Información del Proyecto
- **Nombre:** POS-EXPENDIO-BB (Expendio Bimbo y Barcel)
- **Tipo:** Sistema de Punto de Venta
- **Versión POS:** 1.4.2 · **Versión app móvil:** 1.2.2+142
- **Fecha inicio:** 01/09/2026

---

## ESTADO ACTUAL: FASE 7 COMPLETADA Y EN PRODUCCIÓN (nube + sync) ✓

> **Versión POS actual:** `1.4.2` (release con ping de despertar al host en la nube)
> **Tienda:** `192.168.1.8:5000` (admin/admin123) — ya sincronizando a la nube cada 5 min
> **Host nube (solo lectura):** `https://alexis10265.pythonanywhere.com` — recibe la BD, sirve `/movil/`
> **App móvil:** web en la nube (`/movil/`, v1.2.2+142) + selector Tienda/Nube
> **Fecha:** 22/09/2026

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
│   ├── config.py                 # Configuración (APP_VERSION 1.4.2)
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
- [x] **Fase 7:** Sync a la nube (PythonAnywhere) — **completada y en producción**. Ver `NOTAS_FASE7.md`
- [~] **Fase 8:** Reportes — en curso (tablas por día/departamento listas, faltan gráficas)
- [x] **Fase 6:** App móvil (Flutter) — completada: login, home, reportes, historial, productos y ajustes contra el POS; desplegada como web en la nube. Falta solo el APK Android y el fix del filtro por departamento está en v1.2.2. Ver `NOTAS_FASE6.md`.
- [ ] Fase 10: Pruebas finales y documentación

---

## Cambios recientes (releases v1.2.1 → v1.4.2 / app v1.2.2)

### Releases POS
- **1.4.2 — Sync + ping a la nube:** cada subida hace `GET /api/sync/ping` al
  host antes de subir (despierta PythonAnywhere free dormido). `9a82b22`.
- **1.4.1 — Reportes:** columna utilidad en valor por categoría (inventario) +
  filtro por departamento en reportes (web y app) + ajuste de stock por
  parámetro +/- en app. `66dd1e5`.
- **1.4.0 — Fase 7:** sincronización de solo lectura al host gratuito + app web
  en la nube. `5d5ae34`.
- **Host hardening (`a94420e`):** con `POS_HOST=1` el host solo expone `/movil/`
  y la API readonly; `/dashboard` y `/login` redirigen a `/movil/`.

### App móvil
- **v1.2.1+141** — default Tienda (`192.168.1.8`) en el APK + preset
  "Nube (PythonAnywhere)". `7b27d1e`.
- **v1.2.2+142** — fix reporte por departamento: la vista detalle usaba el total
  de tickets completos ($552) en vez del monto del departamento ($329); ahora usa
  el resumen línea-proporcional. `bd7c965`.

### Anteriores (1.1.33 → 1.2.1)
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
- [ ] **App móvil Flutter** (Fase 6): generar **APK Android** para el celular
      (default Tienda en LAN / preset Nube en la calle). La versión web ya está
      funcionando en la nube.
- [ ] **Backend departamento**: decidir si `/api/reports/sales?department=` debe
      sumar solo las líneas del depto (la app ya lo compensa en v1.2.2; el
      dashboard web del POS aún muestra ticket-mix).
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
- `APP_VERSION = "1.4.2"` (server/config.py)
- Tienda: `192.168.1.8:5000` (admin/admin123) — SSH `expendiobimbo@192.168.1.8`
- Nube: `https://alexis10265.pythonanywhere.com` (/movil/ web app v1.2.2+142 y API readonly)
- App móvil: `1.2.2+142` (mobile/pubspec.yaml)

---

*Última actualización: 22/09/2026 — Fase 7 en producción (tienda sincroniza cada 5 min a
PythonAnywhere, host verificado, app web v1.2.2+142 desplegada en /movil/ con fix de
reporte por departamento). POS en 1.4.2. Ver `NOTAS_FASE7.md` y `NOTAS_FASE6.md`.*
