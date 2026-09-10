# Notas de Desarrollo - POS EXPENDIO BB

## Fase 2: Catálogo + Categorías + Promociones

### Fecha: 01/09/2026

### Funcionalidades Implementadas:

#### 1. Gestión de Categorías
- Crear nuevas categorías
- Editar categorías existentes (nombre y color)
- Eliminar categorías (si no tienen productos asociados)
- Colores personalizables para cada categoría

#### 2. Sistema de Promociones
Tablas creadas:
- `promotions` - Define las promociones
- `promotion_products` - Productos específicos por promoción
- `promotion_categories` - Categorías por promoción

Tipos de promoción soportados:
- **BOGO (2x1, 3x2, etc.)**: Lleva N productos, paga M
- **Precio Fijo**: Lleva N productos por un precio específico
- **Descuento Porcentual**: X% de descuento
- **Descuento Fijo**: Monto fijo de descuento por unidad

Alcance de promociones:
- Por producto específico
- Por categoría
- Para todos los productos

Parámetros adicionales:
- Fecha de inicio (opcional)
- Fecha de fin (opcional)
- Activar/desactivar promoción

### Archivos Modificados/Creados:

#### Backend:
- `server/routes/promotions.py` - Nueva ruta API para promociones
- `server/utils/database.py` - Agregadas tablas de promociones
- `server/routes/settings.py` - Actualizado para editar categorías y listar productos
- `server/app.py` - Registrada ruta de promociones

#### Frontend:
- `server/templates/dashboard.html` - Agregada sección de promociones
- `server/static/js/app.js` - Funciones para gestionar promociones
- `server/static/css/styles.css` - Estilos para tarjetas de promoción

### Próximos Pasos:
1. Integrar cálculo de promociones en el proceso de venta
2. Agregar productos desde el POS con código de barras
3. Implementar sistema de lotes para control de caducidad
