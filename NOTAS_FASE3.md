# Notas de Desarrollo - POS EXPENDIO BB

## Fase 3: Sistema de Ventas

### Fecha inicio: 01/09/2026
### Estado: ✅ COMPLETADA (sesión 01/09/2026)

---

## Funcionalidades Implementadas

### 1. Escaneo de códigos de barras ✅
- Campo `#barcodeInput` en la parte superior del POS con estilo destacado
- Al presionar Enter busca por código en `/api/products/barcode/<code>`
- Si encuentra, agrega al carrito automáticamente y muestra toast de confirmación
- Soporta lectores USB (los que funcionan como teclado + Enter)

### 2. Aplicación automática de promociones en carrito ✅
- Función `applyPromotionsToCart()` evalúa todas las promos activas contra los items del carrito
- Soporta los 4 tipos: BOGO, fixed_price, percent, fixed_discount
- Calcula el mejor descuento por producto (la promo más favorable)
- Muestra en el carrito:
  - Descuento por línea en verde (`-$X.XX`)
  - Panel amarillo `#cartPromos` con nombres de las promos aplicadas
  - Línea de "Descuento" en el resumen
- Backend también aplica el descuento y lo guarda en `sale_items.discount`
- Migración automática: `run_migrations()` agrega columna `discount` a DBs existentes

### 3. Impresión de tickets ✅
- Después de cobrar, se abre modal con el ticket generado
- Formato de 80mm con: header, items, totales, método de pago, cambio, cajero
- Botón 🖨️ Imprimir abre ventana emergente con formato `@media print`
- Estilos de impresión ocultan todo excepto el ticket

### 4. Mejoras adicionales al POS
- Input de cantidad editable en cada línea del carrito
- Búsqueda por nombre + código en vivo (sin Enter)
- Botón ✕ para limpiar búsqueda
- Auto-focus en campo de código de barras tras cada venta
- Validación de cantidad (elimina el item si llega a 0)
- Función `escapeHtml()` para prevenir XSS en nombres de productos

---

## Archivos Modificados

### Backend
- `server/routes/sales.py` - Calcula descuentos por promo al crear venta, guarda `discount` por item
- `server/utils/database.py` - Agregada función `run_migrations()` con migración de columna `discount`

### Frontend
- `server/templates/dashboard.html` - Toolbar de escáner + búsqueda, panel de promos, input cantidad
- `server/static/js/app.js` - `handleBarcode`, `applyPromotionsToCart`, `showTicketModal`, `printTicket`, `setCartItemQty`
- `server/static/css/styles.css` - Estilos para escáner, promos, ticket, impresión

---

## Pruebas recomendadas
1. Escanear un código de barras real del expendio
2. Crear una promo 2x1 en categoría "Pan Bimbo", agregar 3 unidades y verificar descuento
3. Cobrar una venta en efectivo y abrir el modal de ticket
4. Probar botón Imprimir (se abre ventana con formato de ticket)

---

## Bug corregido durante polishing
- **Bug promo `fixed_price`**: La fórmula vieja usaba `pay_quantity` que solo aplica a BOGO, generando descuentos incorrectos. Fórmula corregida: `groups = qty // buy_quantity`, `discount = (qty × price) - (groups × fixed_price)`. Corregido en `server/routes/sales.py`, `server/routes/promotions.py` y `server/static/js/app.js`.

## Rediseño del POS (sesión polishing 02/09/2026)
- **Layout nuevo**: buscador grande + tabla de productos + carrito en tabla (en vez de tarjetas).
- **Tabla de productos** con navegación por teclado (↑↓ para mover, Enter para agregar).
- **Barra de categorías** clickeables para filtrar.
- **Carrito en tabla**: columnas editables, badges de promos, muestra de lote.
- **Botón COBRAR** muestra el total directamente.
- Estilos CSS completamente nuevos para el layout del POS.

## Escáner: limpieza automática del campo (02/09/2026)
- Al presionar Enter en el buscador, intenta buscar el texto como código de barras en `/api/products/barcode/<code>`
- **Si existe**: agrega al carrito y limpia el campo automáticamente
- **Si NO existe**: muestra toast "Código no encontrado" y limpia el campo automáticamente
- Esto resuelve el caso de cuando un escáner falla o se escanea un código inválido: el siguiente escaneo siempre entra en un campo vacío

## Layout tipo Eleventa (02/09/2026)
Inspirado en eleventa con el total grande horizontal:
- **Total grande** a la derecha: `$XX.XX` en 44px, color azul, monospace, junto al botón COBRAR
- **Subtotal y descuento** a la izquierda en mini-tabla
- **Conteo de productos** al inicio de la fila
- **Botón COBRAR** solo muestra el icono y la palabra (sin el total)

## Modal de búsqueda manual (02/09/2026)
- Botón **🔍 Buscar** al lado del input
- Atajo de teclado **F2** abre el modal
- Detección inteligente: si el texto es **solo dígitos** (≥4) → trata como barcode
- Si el texto tiene letras o es mixto → **abre modal** con la lista de productos filtrados
- En el modal:
  - **↑↓** para navegar entre resultados
  - **Enter** para seleccionar
  - **Esc** para cerrar
  - **Click** también selecciona
- Máximo 30 resultados mostrados

## POS: solo ticket a pantalla completa (02/09/2026)
- Eliminada la tabla de productos del POS
- Header: solo el buscador con el botón 🔍
- **El "Ticket de Venta" (carrito) ocupa toda la pantalla**
- Atajos visibles en el header: `F2` Buscar · `Del` Eliminar · `Ctrl+Del` Vaciar

## Selección y eliminación de items del carrito (02/09/2026)
- Click en una fila del carrito la selecciona (highlight amarillo)
- `← →` con buscador vacío navegan entre filas del carrito
- **`Delete`** elimina el item seleccionado del carrito (funciona aunque el foco esté en el buscador)
- **`Ctrl+Delete`** abre modal de confirmación para vaciar todo
- Click en el botón **`✕`** al final de cada fila elimina ese item
- Botón **`🗑️ Vaciar`** arriba del carrito con confirmación
- Al agregar producto nuevo se selecciona automáticamente la última fila
- Toast confirma cada eliminación: "✗ [producto] eliminado"

## Pendiente
- [x] Bug promo `fixed_price` — CORREGIDO 02/09/2026
- [x] Rediseño del POS — COMPLETADO 02/09/2026
- [x] Escáner auto-limpia campo si código no existe — COMPLETADO 02/09/2026
- [x] Layout tipo Eleventa con total grande — COMPLETADO 02/09/2026
- [x] Modal de búsqueda manual con F2 — COMPLETADO 02/09/2026
- [x] POS: solo ticket a pantalla completa — COMPLETADO 02/09/2026
- [x] Eliminación individual por Delete (fix bug) — COMPLETADO 02/09/2026
- [x] Notas en venta — COMPLETADO 02/09/2026
- [x] Cliente opcional — COMPLETADO 02/09/2026
- [x] Descuento manual en venta — COMPLETADO 02/09/2026
- [ ] Soporte para impresora térmica USB/Serial (escpos)
- [ ] Re-imprimir último ticket