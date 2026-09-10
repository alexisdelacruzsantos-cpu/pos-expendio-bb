# Notas de Desarrollo - POS EXPENDIO BB

## Fase 4: Control de Caducidad (Lotes)

### Fecha: 01/09/2026
### Estado: ✅ COMPLETADA

---

## Funcionalidades Implementadas

### 1. API REST de lotes (`/api/lots`)
- `GET /api/lots/` - Listar lotes con `days_left`, `is_expired`, `is_critical`, `is_warning`
- `GET /api/lots/<id>` - Detalle de un lote
- `GET /api/lots/for-product/<product_id>` - Lotes disponibles de un producto
- `GET /api/lots/best-for/<product_id>` - Mejor lote (FIFO por caducidad)
- `POST /api/lots/` - Crear nuevo lote (registra movimiento de inventario "entry")
- `PUT /api/lots/<id>` - Editar lote (lote, caducidad, ubicación)
- `DELETE /api/lots/<id>` - Eliminar (solo si no tiene existencia)
- `POST /api/lots/adjust-stock` - Ajustar stock con motivo (registra movimiento "adjustment")

### 2. Sección "Lotes" en sidebar
- **Estadísticas rápidas** arriba: caducados / críticos (≤3d) / OK
- **Tabla** con todos los lotes, búsqueda por nombre o número de lote
- Botones: **Editar**, **Ajustar Stock**, **Eliminar**
- Modal de creación con: producto, lote, fecha producción, fecha caducidad, cantidad, ubicación
- Modal de ajuste de stock: nueva cantidad + motivo (conteo, merma, etc.)
- Colores por estado: rojo (caducado/crítico), amarillo (próximo 4-7d), verde (OK)

### 3. Selección de lote en POS
- **FIFO automático**: al agregar producto, se asigna el lote más próximo a caducar
- **Override manual**: cada item del carrito muestra el lote y un enlace "cambiar"
- Modal de override lista todos los lotes disponibles con días restantes y existencia
- Al cobrar, se descuenta del `current_quantity` del lote seleccionado
- El `lot_id` se guarda en `sale_items` para trazabilidad

### 4. Migraciones de BD
- Columna `sales.amount_tendered` y `sales.change_given` (fase 3, ya agregadas)
- Columna `sale_items.discount` (fase 3, ya agregada)
- Las migraciones se ejecutan automáticamente al iniciar

---

## Archivos Modificados/Creados

### Backend
- `server/routes/lots.py` **(nuevo)** - CRUD completo + FIFO
- `server/app.py` - Registrado blueprint `lots_bp` en `/api/lots`
- `server/utils/database.py` - Schema actualizado con columnas faltantes, `run_migrations()` extendido

### Frontend
- `server/templates/dashboard.html` - Nueva sección `<section id="lotsSection">`, item en sidebar
- `server/static/js/app.js` - Funciones: `loadLots`, `renderLotsTable`, `showAddLotModal`, `saveLot`, `showEditLotModal`, `updateLot`, `showAdjustStockModal`, `adjustLotStock`, `deleteLot`, `showLotOverrideModal`, `applyLotOverride`. Carrito muestra el lote y permite override. `addToCart` ahora asigna mejor lote automáticamente.
- `server/static/css/styles.css` - Estilos para `lots-stats`, `stat-card`, `lot-option`, `cart-item-lot`

---

## Bugs corregidos durante la fase
- `sqlite3.Row` no soporta asignación → convertí a `dict()` antes de mutar
- Fechas en SQLite pueden venir como string, datetime o date según el driver → helper tolerante en todas las rutas
- Tabla `terminals` faltante en DB (de la fase 2) → agregada al schema
- Columnas `amount_tendered`, `change_given` y `discount` faltantes → migración automática

---

## Pruebas recomendadas
1. Crear un lote de "Pan Blanco Bimbo" con caducidad próxima
2. Crear otro lote del mismo producto con caducidad más lejana
3. Agregar al carrito: debe elegir el primero (FIFO)
4. Clic en "cambiar" → seleccionar el otro lote manualmente
5. Cobrar y verificar que el stock del lote correcto bajó
6. Ver la sección Lotes: las estadísticas se actualizan
7. Ajustar stock y revisar `inventory_movements`

---

## Pendiente
- [ ] Bug promo `fixed_price` (de Fase 3)
- [ ] Soporte para impresora térmica USB/Serial (escpos)
- [ ] Notas en venta
- [ ] Re-imprimir último ticket