# PAN BIMBO POS - Plan de Desarrollo

## Información del Proyecto
- **Nombre:** Pan Bimbo POS
- **Tipo:** Sistema de Punto de Venta
- **Negocio:** Expendio de pan bimbo y productos barcel/botanas
- **Versión:** 1.1.32
- **Fecha:** 13/09/2026

## Resumen
Sistema POS completo con POS ligero para Windows 8.1 y app móvil Flutter.
Base de datos SQLite local con sincronización opcional vía Supabase.

## Stack Tecnológico
| Componente | Tecnología | Costo |
|---|---|---|
| POS Backend | Python Flask | Gratis |
| POS Frontend | PWA (HTML/CSS/JS) | Gratis |
| BD Local POS | SQLite | Gratis |
| App Móvil | Flutter | Gratis |
| BD Local Móvil | SQLite (sqflite) | Gratis |
| Sincronización | Supabase (free tier) | Gratis |

## Módulos
1. Productos y categorías
2. Sistema de ventas
3. Control de caducidad (lotes)
4. Cortes de caja
5. Terminales de pago
6. Reportes y dashboard
7. App móvil (edición + consulta)
8. Sincronización bidireccional

## Roles
- Cajero (ventas básicas)
- Supervisor (ventas + cortes + reportes básicos)
- Administrador (todo)

## Fases de Implementación
| Fase | Módulo | Duración |
|------|--------|----------|
| 1 | Setup + Login con roles | 4-5 días |
| 2 | Catálogo + Categorías + Escáner | 5-6 días |
| 3 | Sistema de ventas | 4-5 días |
| 4 | Lotes + Caducidad | 4-5 días |
| 5 | Cortes de caja | 3-4 días |
| 6 | App móvil | 6-7 días |
| 7 | Sincronización | 4-5 días |
| 8 | Reportes | 4-5 días |
| 9 | Terminales de pago | 3-4 días |
| 10 | Pruebas y documentación | 5-7 días |

## Progreso
- [x] Fase 1: Setup del proyecto
- [x] Fase 2: Catálogo de productos
- [x] Fase 3: Sistema de ventas ← Completada 01/09/2026
- [x] Fase 4: Control de caducidad ← Completada 01/09/2026
- [x] Fase 5: Cortes de caja ← Completada 01/09/2026
- [ ] Fase 6: App móvil (Flutter) — no iniciada
- [ ] Fase 7: Sincronización (Supabase) — no iniciada
- [~] Fase 8: Reportes — en curso (tablas por día/departamento listas, faltan gráficas)
- [x] Fase 9: Terminales de pago (Mercado Pago Point) ← Completada 08/09/2026
- [ ] Fase 10: Pruebas finales y documentación