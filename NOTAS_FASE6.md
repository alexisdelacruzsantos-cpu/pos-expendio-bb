# Notas de Desarrollo - POS EXPENDIO BB

## Fase 6: App Móvil (Flutter)

### Fecha: 19/09/2026
### Estado: EN CURSO (avance funcional: consulta y ajustes; falta sincronización y APK)

---

## Objetivo de la fase

App Flutter para consultar el POS de la tienda desde el celular: historial de ventas,
productos, reportes y ajustes de inventario. **No edita ventas**; solo consulta y ajusta
stock/precios. La fase 7 (sincronización) no está empezada.

## Cómo se comunica con el servidor

- **Arquitectura:** la app NO tiene base local; consulta por HTTP el mismo backend Flask
  del POS (`http://<servidor>:5000/api/*` con JWT `Authorization: Bearer`).
- **CORS:** el backend (Flask) permite `*` en `/api/*`. El navegador en la versión web de
  la app (servida en `http://localhost:8080`) valida el preflight OPTIONS del servidor.
- **Servidores de prueba** (selector dentro de la app, ver `widgets/server_selector.dart`):
  - Local: `http://localhost:5000/api`
  - Tienda: `http://192.168.1.8:5000/api` (login admin/admin123)
  - Personalizado: cualquier URL
  - Se guarda en `SharedPreferences` (clave web `flutter.api_url`).
- **Login:** `POST /api/auth/login` (username/password) → token JWT. La app lo persiste.

## Estructura del código (`mobile/`)

```
mobile/lib/
├── main.dart                     # Entry point. AuthWrapper → LoginScreen o HomeScreen
├── theme/app_theme.dart          # Tema Material
├── providers/auth_provider.dart  # Estado de sesión (init/login/logout, ChangeNotifier)
├── services/api_service.dart     # TODO HTTP contra el POS (token estático + baseUrl configurable)
├── models/models.dart            # Modelos de respuesta: Product, Sale, SaleItem, SalesReport,
│                                 #   AdjustmentProduct, AdjustmentLot, etc.
├── screens/
│   ├── login_screen.dart         # Login + icono para cambiar servidor
│   ├── home_screen.dart          # 4 tarjetas: Reportes / Historial / Productos / Ajustes
│   ├── reports_screen.dart       # Reporte de ventas con selector de FECHA ÚNICA
│   ├── sales_history_screen.dart # Historial de ventas + detalle (+devoluciones marcadas)
│   ├── products_screen.dart      # Catálogo con búsqueda
│   └── adjustments_screen.dart   # Lista de productos + formulario "Ajustar producto"
└── widgets/server_selector.dart  # Diálogo para elegir servidor (Local/Tienda/Personalizado)
```

### Endpoints que usa (`api_service.dart`)
- `GET /api/products/?search=` → lista Product (lista catálogo y lista de ajustes).
- `GET /api/sales/?limit=100[&date_from=&date_to=&q=&status=]` → historial.
  **OJO: la ruta del backend es `/api/sales/` con barra final SIEMPRE.**
- `GET /api/sales/<id>` → detalle de venta con `items`.
- `GET /api/reports/sales?date_from=&date_to=&limit=` → reporte del día.
- `GET /api/adjustments/product/<id>` → datos del producto + sus lotes a ajustar.
- `POST /api/adjustments/` (JSON) → body: `product_id`, `lot_id` (opcional; null = stock
  general), `new_quantity`, `new_price`, `new_cost`, `new_lot_price`, `reason`.

### Modelo de datos relevante
- `products/` devuelve `stock` (general) y `effective_stock` (general + lotes).
- `adjustments/product/<id>` devuelve `product_stock`, `lots[]`. El lote "GENERAL" viene
  con `id=0` (representa stock sin lote) y **no trae `sale_price`**; solo los lotes reales
  traen `sale_price`, `expiry_date`, `is_expired`, `days_left`.
- `category_color` viene como **string hex** (ej. `"#f59e0b"`), nunca como int.

## Bugs importantes corregidos (historial de la fase)

1. **Token null (401).** `_token` ahora es `static String?` en `ApiService`; antes cada
   pantalla creaba su propia instancia y el token era por-instancia → `Bearer null`.
   `baseUrl` también es `static` para que el selector de servidor lo comparta.
2. **CORS: redirección 308 en preflight.** El historial pedía `/api/sales` (sin `/`) y el
   backend expone `/api/sales/`. Flask responde 308 y el navegador bloquea el preflight
   con header `Authorization` → historial vacío. **Fix: usar siempre barra final
   (`$baseUrl/sales/?`).** Reportes y Productos ya usaban URL exacta, por eso sí jalaban.
3. **Pantallas Productos/Ajustes "no funcionaban".** `Product.fromJson` y
   `AdjustmentProduct.fromJson` casteaban `json['category_color']` con `as int?`, pero el
   backend envía hex string (`"#f59e0b"`) → TypeError al parsear la lista → FutureBuilder
   en estado de error. **Fix: `categoryColor` ahora `String?`.**
4. **Reporte de ventas "acumulaba".** Antes no enviaba filtros → el backend respondía
   TODO el histórico. Ahora `reports_screen.dart` usa **una sola fecha** (por defecto hoy)
   y envía `date_from=date_to=<día>` para mostrar solo ese día. El backend filtra por
   `DATE(sale_date) >= date_from AND DATE(sale_date) <= date_to` (ambos inclusive).

## Flujo de validación de datos del backend (contratos verificados)

- `GET /api/sales/?limit=100` → lista de `{id, sale_date, subtotal, tax, total,
  payment_method, cashier_id, cashier_name, status, item_count, returned_amount, ...}`.
  `status=cancelled` se renderiza como "Cancelada (con devoluciones)".
- `GET /api/reports/sales` → `summary`, `payments`, `cashiers`, `top_products`,
  `by_department`, `by_day`.
- `GET /api/adjustments/product/<id>` → `p.*`, `lots[]`, `lots_total`, `has_lots`,
  `product_stock`, `effective_stock`. El lote GENERAL (`id=0`) solo trae `current_quantity`.
- `POST /api/adjustments/` responde `{message: "Ajuste realizado exitosamente", new_quantity,
  previous, diff, product_id, target, ...}`. Devuelve 403 si no es admin.

## Cómo correrla y probarla (desde cero)

1. Backend local:
   ```bash
   cd /home/alexis/POS-EXPENDIO-BB/server && source ../venv/bin/activate
   (python app.py > /tmp/pos_server.log 2>&1 &)
   curl -s http://localhost:5000/api/health
   ```
   - No usar `pkill -f "python app.py"` en la misma invocación de bash: mata el shell.

2. Compilar la app web (Flutter SDK está fuera del PATH, exportar)):
   ```bash
   export PATH="/home/alexis/.flutter-sdk/bin:$PATH"
   cd /home/alexis/POS-EXPENDIO-BB/mobile
   flutter pub get
   flutter analyze
   flutter build web --release
   ```
   - `flutter analyze`: 0 errores (2 infos menores preexistentes en
     `adjustments_screen.dart:296` y `sales_history_screen.dart:304`).

3. Servir la app web (no reiniciar al recompilar: sirve directamente `build/web`):
   ```bash
   python3 -m http.server 8080 --directory /home/alexis/POS-EXPENDIO-BB/mobile/build/web
   ```
4. Probar en http://localhost:8080 → login `admin` / `admin123` → icono de red (dns) arriba
   para cambiar de servidor si hace falta.

### Verificación automatizada (Playwright, útiles que dejamos)
- Los scripts de prueba viven en `/tmp` (no se versionan): `mob_probe.py`,
  `mob_flow.py`, `mob_flow2.py`, `report_date_probe.py`, `prod_adj_probe.py`.
- Login automático: clic en (210,y) con y en 340..620 hasta que aparezca `<input>`,
  teclear `admin`, Tab, `admin123`, Enter.
- Tarjetas del Home (viewport 420x900): Reportes y≈156, Historial y≈244, Productos y≈332,
  Ajustes y≈420 (buscar por nodo semántico es más robusto).
- Para leer texto renderizado en Flutter web: activar accesibilidad clic en
  `[aria-label="Enable accessibility"]`, después tomar el texto de los elementos
  `flt-semantics` (`label` o `textContent`). No usar `flt-semantics-container` (no siempre existe).
- Otra señal fiable: observar las peticiones `/api/*` que dispara cada pantalla y que
  respondan 200 sin errores de consola.

## Pendiente / siguiente etapa
- [ ] Probar la app contra la tienda real (`192.168.1.8`) con el selector de servidor.
- [ ] Generar APK: `flutter build apk` (la AndroidManifest ya existe en `mobile/android/`).
- [ ] Verify: la versión web está pensada para pruebas; el APK es para el celular del expendio.
- [ ] Fase 7: sincronización (no iniciada).

---

*NOTA PARA EL FUTURO:* si algo de la app móvil "deja de funcionar", el orden de revisión es:
1) que el endpoint del backend responda (curl con token), 2) que la URL no tenga redirect
(siempre barra final en `/sales/`), 3) que el parseo del modelo aguante el JSON real
(cuidado con tipos: `category_color` es string), 4) revisar CORS/preflight desde el origen web.