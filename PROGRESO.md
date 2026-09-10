# PAN BIMBO POS - Progreso del Proyecto

## Información del Proyecto
- **Nombre:** POS-EXPENDIO-BB (Expendio Bimbo y Barcel)
- **Tipo:** Sistema de Punto de Venta
- **Versión:** 1.0
- **Fecha inicio:** 01/09/2026

---

## ESTADO ACTUAL: FASE 5 COMPLETADA + POS UI REDISEÑADA + INVENTARIO ✓

### Lo que funciona hasta ahora:

#### ✅ Backend (Flask + Python)
- Servidor REST con autenticación JWT
- Base de datos SQLite con 17+ tablas
- 3 usuarios creados (admin, supervisor, cajero)
- 8 categorías preconfiguradas
- 25 productos de ejemplo cargados
- API de productos, ventas, caja, reportes, promociones, lotes
- Sistema de roles y permisos
- Cálculo automático de promociones en ventas
- Migraciones automáticas de BD
- Control de caducidad con lotes (FIFO)
- Cortes de caja con conteo físico y diferencia
- **Descuento manual** en ventas
- **Auto-selección de lote FIFO** si `lot_id` es null al crear venta
- **Validación al eliminar producto** (no se puede si tiene stock, promos o ventas)
- **Validación de contraseña del dueño** al cerrar turno de otro usuario (`/api/cash/close-and-open` requiere `owner_password`)

#### ✅ Frontend (PWA HTML/CSS/JS)
- Página de login
- Dashboard con navegación
- **Sección Ventas (POS)** rediseñada:
  - Barra de búsqueda delgada con overlay de resultados por cards
  - Ticket de venta con tabla que crece con scroll interno (thead sticky)
  - Botón COBRAR eliminado, reemplazado por **card clickeable con el monto total**
  - Modal de pago F12 con métodos efectivo / tarjeta / mixto
  - Validación de monto recibido ≥ total
  - Cambio en vivo
  - Enter en input de monto confirma venta
  - Soporte de teclado completo: F12 (cobrar), Esc (cerrar modal), + / - (cantidad), Del (eliminar), ↑/↓ (navegar carrito)
  - Confirmación de overstock con segundo click para forzar
  - Badges de stock por item del carrito (🟢/🟡/🔴)
  - Atajos: F2 (búsqueda), Del, Ctrl+Del (vaciar), Enter, Esc
- **Sección Inventario** con tabla de existencias y modal para agregar stock
- Sección Productos (CRUD)
- Sección Lotes (CRUD + estadísticas + ajustes)
- Sección Reportes (dashboard)
- Sección Caja (apertura/cierre/historial con diferencia)
- Sección Promociones (CRUD)
- Sección Configuración (categorías, usuarios, terminales)
- **Sidebar colapsable** con persistencia en localStorage
- **Pantalla completa automática** al entrar al sistema (en primera interacción) y se mantiene
- **Autocompletado del navegador desactivado** en todos los inputs del dashboard
- **PWA icons** configurados (192px, 512px)

---

## Estructura del Proyecto

```
POS-EXPENDIO-BB/
├── server/
│   ├── app.py                    # Servidor principal
│   ├── config.py                 # Configuración
│   ├── requirements.txt          # Dependencias Python
│   ├── start_server.sh           # Script para iniciar
│   ├── routes/                   # API endpoints
│   │   ├── auth.py
│   │   ├── products.py
│   │   ├── sales.py
│   │   ├── cash.py
│   │   ├── reports.py
│   │   ├── settings.py
│   │   └── promotions.py
│   ├── utils/                    # Utilidades
│   │   ├── database.py
│   │   ├── security.py
│   │   └── backup.py
│   ├── templates/                # HTML
│   │   ├── index.html
│   │   └── dashboard.html
│   └── static/
│       ├── css/styles.css
│       ├── js/app.js
│       └── data/pos.db          # Base de datos
└── venv/                         # Entorno virtual Python
```

---

## Fases Completadas

- [x] **Fase 1:** Setup del proyecto (✓ Completada)
- [x] **Fase 2:** Catálogo + Categorías + Promociones (✓ Completada)
- [x] **Fase 3:** Sistema de ventas con escáner + tickets (✓ Completada)
- [x] **Fase 4:** Control de caducidad (lotes) + FIFO (✓ Completada)
- [x] **Fase 5:** Cortes de caja con conteo físico (✓ Completada)
- [x] **Polish Ventas:** cliente + notas + descuento manual (✓ Completada 02/09/2026)
- [x] **Bug promo fixed_price:** validado contra descuentos negativos (✓ Corregido 02/09/2026)
- [x] **Sección Inventario** + agregar stock por lote (✓ Completada 02/09/2026)
- [x] **Modal de pago F12** con efectivo/tarjeta/mixto + validación de monto (✓ Completada 02/09/2026)
- [x] **Rediseño POS** barra delgada, ticket con scroll interno, card total clickeable (✓ Completada 02/09/2026)
- [x] **Fullscreen automático** persistente en dashboard (✓ Completada 02/09/2026)
- [x] **Bug crítico JS** `closeAllOverlays` sin cerrar rompía todo el script (✓ Corregido 04/09/2026)
- [x] **Bug crítico JS** código huérfano con `return` suelto al final del archivo (✓ Corregido 04/09/2026)
- [x] **Bug modal turno** botón "Cerrar y abrir nuevo" generaba JS inválido (✓ Corregido 04/09/2026)
- [x] **Bug logout** botón "Cerrar sesión" ejecutaba `continueActiveShift` en vez de logout (✓ Corregido 04/09/2026)
- [x] **Flujo turno de otro usuario** ahora pide contraseña del dueño antes de cerrar (✓ Completado 04/09/2026)
- [x] **Playwright** instalado en venv para testing automatizado (✓ 04/09/2026)
- [ ] **Fase 6:** App móvil (Flutter)
- [ ] **Fase 7:** Sincronización
- [ ] **Fase 8:** Reportes avanzados
- [ ] **Fase 9:** Terminales de pago
- [ ] **Fase 10:** Pruebas y documentación

---

## Cambios de la sesión 02/09/2026 (segundo día)

### Backend
- `server/routes/sales.py:179-217` — `create_sale` auto-selecciona lote FIFO cuando `lot_id` es null. Valida stock con `force_no_stock: true` para permitir venta forzada.
- `server/routes/products.py` — DELETE `/products/:id` ahora valida: stock=0, sin promos directas activas, sin promos de categoría activas, sin ventas asociadas. Borra `promotion_products` antes del producto.
- `server/routes/lots.py` — `POST /api/lots/add-stock` crea un nuevo lote con cantidad, fecha de caducidad y número de lote. También hay `adjust_stock` para correcciones.

### Frontend — POS
- **Overlay de búsqueda** (`pos-search-overlay`): ahora muestra cards con badge de stock por producto; el placeholder/buscador en el header de la sección "Ticket de venta" fue reemplazado.
- **Atajos de teclado** (`setupGlobalKeys` y `handlePosKey`):
  - `F12` → abre modal de pago o confirma si ya está abierto
  - `Esc` → cierra modal de pago
  - `+` / `=` → incrementa cantidad del último producto
  - `-` / `_` → decrementa (elimina si llega a 0)
  - `Del` → elimina el producto seleccionado
  - `Ctrl+Del` → vacía carrito
  - `↑` / `↓` → navega productos del carrito
  - `Enter` (en input de monto) → confirma venta
- **Bug fix**: ya no se queda pegado el texto "Procesando..." en el botón COBRAR (`updateChargeButton`).
- **Bug fix**: cerrar el modal de pago devuelve el foco al input de búsqueda.
- **Modal de pago** (`#paymentOverlay`):
  - Métodos: 💵 Efectivo, 💳 Tarjeta, 🔀 Mixto
  - Total grande, input de monto grande, caja de CAMBIO en vivo
  - Bloquea confirmación si `received < total`
  - Atajo Enter y F12 confirman
- **Confirmación de overstock**: primer F12 con items sin stock suficiente → toast de aviso; segundo F12 con `force_no_stock: true` permite la venta.
- **Card total clickeable** (`.pos-total-card`): reemplaza al botón COBRAR. Verde con gradiente, click o F12 para cobrar. Se pone gris cuando el carrito está vacío.

### Frontend — Inventario
- Nueva sección en el sidebar con link "📦 Inventario"
- Tabla con Producto, Categoría, Stock Mín, Existencias (badge), Acciones
- Modal para agregar stock (lote, cantidad, fecha caducidad)
- Recarga automática de sección al cambiar

### Frontend — UI general
- **Sidebar colapsable** con botón ☰ y persistencia en `localStorage` (`pos_sidebar_collapsed`).
- **Autocompletado del navegador desactivado** en todos los inputs del dashboard (`autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`, `spellcheck="false"`).
- **Pantalla completa automática** (`enterFullscreen()`): se activa silenciosamente en la primera interacción (tecla, click, touch). El listener `fullscreenchange` reentra a fullscreen automáticamente si sales con Esc.
- **PWA icons** generados: `static/icons/icon-192.png` y `icon-512.png` (naranja #f59e0b con círculo blanco).

### CSS
- Layout POS: `flex: 1; min-height: 0` para distribución correcta.
- Tabla del ticket envuelta en `.pos-cart-table-wrap` con `overflow-y: auto` y `thead { position: sticky }`.
- Sección POS (`#salesSection`): `padding: 0; overflow: hidden` para no activar scroll del body.
- Fuentes de la tabla del ticket: celdas 15px, encabezados 13px, subtotal 16px, input cantidad 15px, badge stock 12px, nombre producto 16px bold.
- Card total: padding 8px×16px, `margin-left: auto`, ancho máx 360px, monto `clamp(22px, 2.6vw, 32px)`.

---

## Archivos Modificados Recientemente

| Archivo | Cambio |
|---------|--------|
| `server/static/js/app.js` | Fullscreen, modal pago F12, atajos teclado, card total, search overlay, inventario, **fix `closeAllOverlays`**, **fix returns huérfanos**, **fix logout**, **fix turno de otro usuario** |
| `server/static/css/styles.css` | Layout POS, tabla ticket, card total, fullscreen guard, autocompletado |
| `server/templates/dashboard.html` | `#paymentOverlay`, `#posTotalCard`, sección Inventario, inputs sin autocompletar |
| `server/routes/sales.py` | Auto-lote FIFO, `force_no_stock` |
| `server/routes/products.py` | Validación al eliminar producto |
| `server/routes/lots.py` | Endpoint `add-stock` |
| `server/static/icons/` | icon-192.png, icon-512.png nuevos |

---

## Próximos Pasos Sugeridos
- [ ] Refactorizar CSS: ya hay reglas `.pos-payment-methods` y `.pos-cash-row` que ya no se usan desde el modal F12 (limpieza)
- [ ] Proteger la ruta `/dashboard` para que redirija a login si no hay token
- [ ] Implementar reportes avanzados (Fase 8) con gráficas
- [ ] Mejorar el ticket modal: incluir método de pago, lote por producto, descuentos
- [ ] App móvil Flutter (Fase 6)

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
| `/home/alexis/Documentos/pan-bimbo-pos/PLAN_FINAL.md` | Plan original |

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
- Contiene: 25 productos de ejemplo, 8 categorías, usuarios

### Tecnologías usadas
- Backend: Flask + SQLite
- Frontend: HTML5 + CSS3 + JavaScript (vanilla)
- Autenticación: JWT
- **Testing automatizado**: Playwright + Chromium headless (instalado en venv)

### Herramientas de testing
- **Playwright** (`venv/lib/python3.12/site-packages/playwright`) - navegador headless para detectar errores JS en consola y probar flujos
- **Comando para descargar browser**: `playwright install chromium` (ya ejecutado, ~115 MB en `~/.cache/ms-playwright/`)
- **Ubicación del test usado**: `/tmp/test_*.py` (logs de playwright, console errors, screenshots)
- **Uso típico**:
  ```python
  page.on('pageerror', lambda err: print(err))
  page.on('console', lambda msg: print(msg.text) if msg.type == 'error' else None)
  ```
- Sirve para detectar: `ReferenceError`, `SyntaxError`, modales que no cierran, botones sin handler, etc.

---

## Próximo paso: Fase 6

App móvil Flutter con sincronización.

---

## Cambios del 04/09/2026 (sesión de debugging)

### Bug crítico #1: `closeAllOverlays` rompía todo el script JS
- **Síntoma**: ningún botón del sistema respondía, no se podía tabular, parecía "congelado"
- **Causa**: `function closeAllOverlays() {` (línea 5153) sin `}` de cierre. El parser de Chrome dejaba la función abierta y las definiciones posteriores (`closeModal`, `loadPromotions`, `focusPrimaryButton`) quedaban en limbo → `undefined`
- **Detección**: Playwright reveló `ReferenceError: loadPromotions is not defined` en `loadInitialData` (línea 912)
- **Fix**: cerrar correctamente la función (se le agregó cuerpo para `closeAllOverlays` que cierra todos los overlays)

### Bug crítico #2: `return` sueltos al final del archivo
- **Síntoma**: `Illegal return statement` en navegador
- **Causa**: código huérfano (líneas 5751-5757) con `return true/false` fuera de cualquier función. Quedó de un edit previo mal pegado
- **Fix**: eliminar las 7 líneas huérfanas

### Bug #3: `onclick` con JS inválido en `showShiftCloseConfirm`
- **Síntoma**: el botón "Cerrar y abrir nuevo" del modal "Turno abierto de otro usuario" no respondía
- **Causa**: `onclick="if(${onConfirm}) ${onConfirm}()"` generaba código inválido cuando `onConfirm` era una función
- **Fix**: cambiar a `requestCloseAndOpenFromResume` que ya maneja correctamente el caso pidiendo la contraseña del dueño

### Bug #4: "Cerrar sesión" no cerraba sesión
- **Síntoma**: el botón "Cerrar sesión" ejecutaba `continueActiveShift()` en lugar de `handleCloseSession()`
- **Causa**: en `bootShiftGate` (línea 947-948) se pasaba `onCancel: 'continueActiveShift'` y `showShiftCloseConfirm` usaba ese string para el botón "Cerrar sesión"
- **Fix**: cambiar a `onCancel: 'handleCloseSession'` y `onConfirm: 'requestCloseAndOpenFromResume'`

### Flujo: cierre de turno de otro usuario
- Cuando un usuario (ej. admin) entra y hay un turno abierto de otro usuario (ej. cajero), el sistema muestra el modal "Turno abierto de otro usuario" con dos opciones:
  1. **Cerrar sesión** → limpia localStorage y va a `/`
  2. **Cerrar y abrir nuevo** → abre `showOwnerPasswordModal` que pide la contraseña del dueño antes de hacer `POST /api/cash/close-and-open`
- El backend ya validaba esto (`requires_password: true`), ahora el frontend lo solicita correctamente

### Archivos modificados hoy
- `server/static/js/app.js` (líneas 947-948, 999-1003, 5153-5163, 5750)

---

*Última actualización: 04/09/2026 - Bugs críticos corregidos, Playwright instalado*
