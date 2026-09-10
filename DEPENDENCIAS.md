# DEPENDENCIAS.md - Mapa de Dependencias del Frontend

> **Propósito:** Documentar cómo se relacionan las funciones dentro de `server/static/js/app.js` (6,357 líneas).
> Útil como referencia para mantenimiento futuro y para planificar una división en módulos sin romper nada.

**Archivo analizado:** `server/static/js/app.js`
**Fecha de análisis:** 06/09/2026
**Total de funciones mapeadas:** ~170

---

## 1. Variables globales compartidas ("el pegamento")

Estas variables son leídas y escritas por múltiples módulos. Es lo que hace difícil separar
archivos sin un objeto central de estado (`store`). Antes de mover una función a otro archivo
hay que asegurarse de que estas variables sigan accesibles.

| Variable | Uso principal | Definida aprox. (línea) |
|---|---|---|
| `API_BASE` | Endpoint base `/api` | 3 |
| `currentUser` | Usuario autenticado | 4 |
| `permissions` | Permisos desde localStorage | 5 |
| `cart` | Carrito del POS (items del ticket) | 6 |
| `saleAttemptCount` | Conteo de intentos de venta overstock | 7 |
| `paymentMethod` | Método de pago active (cash/card/mixed) | 8 |
| `products` | Lista de productos para búsqueda POS | 9 |
| `promotions` | Promociones activas | 10 |
| `allProducts` | Lista maestra de productos | 11 |
| `allLots` | Lista maestra de lotes | 12 |
| `lastSaleResult` | Última venta completada (para ticket) | 13 |
| `manualDiscount` | Descuento manual | 14 |
| `activeShift` | Turno de caja activo (cache) | 305 |
| `posSelectedIndex` | Índice seleccionado en lista de productos POS | 1205 |
| `posActiveCategory` | Categoría activa del POS | 1206 |
| `cartSelectedIndex` | Fila seleccionada del carrito | 1207 |
| `posSearchFilters` | `{inStockOnly, sort}` del POS | 1208 |
| `modalSelectedIndex` | Índice seleccionado en búsqueda modal | 1470 |
| `productsTableData` | Datos de la tabla de productos | 1597 |
| `productsCategoryFilter` | Filtro de categoría de productos | 1598 |
| `productsSort` | Orden `{key, dir}` de productos | 1599 |
| `inventoryData` | Datos de inventario | 1789 |
| `invFilter` | Estado del filtro de inventario | 1790 |
| `invDetailProductId` | Producto abierto en detalle de inventario | 1791 |
| `lotsCutData` | Datos de corte de inventario | 4900 |
| `lotProductSelected` | Producto seleccionado en modal de lote | 5142 |
| `lotSearchSelectedIndex` | Índice de búsqueda de lote | 5143 |
| `_modalCloseCallback` | Callback al cerrar modal | 5564 |
| `ticketAutoCloseTimer` | Timer de auto-cierre de ticket | 3862 |
| `_allShiftsCache` | Cache de todos los turnos | 4381 |
| `SETTINGS_MODULES` | Definiciones de módulos de settings | 4729 |
| `EnterNav` | Singleton de navegación con Enter | 375 |

> **Nota:** No existe `POS_CART` ni `currentSection`. El carrito es `cart` y la sección
> activa se rastrea por clases `.active` en el DOM (no por una variable JS).

---

## 2. Mapa de llamadas entre funciones (por módulo)

### core (init, auth, sidebar, overlays, toasts, fullscreen, EnterNav)

```
isFullscreenActive → []
lockFullscreen → [isFullscreenActive, enterFullscreen]
enterFullscreen → [isFullscreenActive]
setupFullscreenOnFirstInteraction → [isFullscreenActive, enterFullscreen]
setupEscapeBlocker → [isFullscreenActive]
setupFullscreenGuard → [isFullscreenActive]
setupGlobalKeys → [closeModal, closePaymentModal, closeSearchResults,
                    closeInventoryDetail, forceShiftLogin, confirmPayment,
                    openPaymentModal, confirmClearCart, removeFromCart,
                    updateCartItemQty, updateCartSelection]
setupCartEventDelegation → [removeFromCart, showLotOverrideModal, selectCartRow]
checkAuth → [loadInitialData]
refreshActiveShift → [updateShiftChip]
updateShiftChip → []
forceShiftLogin → [closeShiftGate, showToast]
openShiftGate → [EnterNav.activate]
closeShiftGate → [EnterNav.deactivateAll, forceShiftLogin]
setCurrentDate → []
setupNavigation → [showSection]
navigateTo → []
setupSectionShortcuts → [navigateTo]
showSection → [refreshSalesData, focusPosSearch, loadProductsTable, loadLots,
                loadLotsCut, loadInventory, loadInventoryMovementsHistory,
                loadReports, loadCashData, loadCashHistory, loadPromotions,
                renderSettingsMenu, showSettingsMenu]
focusPosSearch → []
setupSalesFocusGuard → [focusPosSearch]
logout → []
getAuthHeaders → []
apiCall → [getAuthHeaders, logout]
loadInitialData → [loadProducts, loadPromotions, loadLots, bootShiftGate]
handleCloseSession → [showToast]
focusPrimaryButton → []
showModal → [focusPrimaryButton, EnterNav.deactivate, EnterNav.activate]
focusPosSearchBar → []
closeAllOverlays → []
closeModal → [EnterNav.deactivate, isFullscreenActive, lockFullscreen]
             (+ invoca callback onClose registrado)
showConfirmDialog → [showModal, closeModal]
showErrorDialog → [showModal, closeModal]
showToast → []
```

**EnterNav (namespace core):**
```
EnterNav.activate → [EnterNav.deactivate, attach]
EnterNav.deactivate → [detach]
EnterNav.deactivateAll → [EnterNav.deactivate]
EnterNav.getActive → []
```

---

### pos (carrito, búsqueda, escáner, pago, ticket)

```
handlePosKey → [getFilteredProducts, renderPosProductsTable, scrollToSelected,
                looksLikeBarcode, addToCart, onPosSearchChange, showToast,
                closeModal, openProductSearchModal, confirmClearCart,
                removeFromCart, updateCartSelection, updateCartItemQty]
updateCartSelection → []
selectCartRow → [updateCartSelection]
looksLikeBarcode → []
openProductSearchModal → [showModal, renderModalProductResults,
                          filterModalResults, handleModalSearchKey]
renderModalProductResults → [escapeHtml]
filterModalResults → [renderModalProductResults]
handleModalSearchKey → [selectModalProduct, closeModal]
selectModalProduct → [addToCart, closeModal, onPosSearchChange, showToast]
scrollToSelected → []
renderPosProductsTable → [getFilteredProducts, getAvailableStock,
                          escapeHtml, selectAndAdd]
selectAndAdd → [getFilteredProducts, addToCart, onPosSearchChange]
getProductBaseStock → []
getProductLotStock → []
getLotCartUsage → []
getBaseCartUsage → []
getEffectiveLotStock → [getLotCartUsage]
getEffectiveBaseStock → [getProductBaseStock, getBaseCartUsage]
getAvailableStock → [getEffectiveBaseStock, getEffectiveLotStock]
addToCart → [getProductBaseStock, openLotSelector, getEffectiveLotStock,
              addToCartOutOfStock, addToCartWithLot, getEffectiveBaseStock,
              renderCart]
addToCartOutOfStock → [getProductBaseStock, showModal, closeModal,
                        focusPosSearchBar, escapeHtml, renderCart]
addToCartWithLot → [getLotCartUsage, renderCart]
openLotSelector → [getProductBaseStock, getEffectiveLotStock, escapeHtml,
                    selectLot, closeLotSelector]
closeLotSelector → []
selectLot → [getProductBaseStock, getEffectiveLotStock, getEffectiveBaseStock,
              addToCartOutOfStock, closeLotSelector, renderCart, closeModal,
              showToast, escapeHtml]
updateCartItemQty → [renderCart]
setCartItemQty → [renderCart]
setCartItemQtyFromInput → [setCartItemQty]
removeFromCart → [renderCart, showToast]
clearCart → [renderCart]
confirmClearCart → [showModal, focusPosSearchBar, clearCart, closeModal, showToast]
applyPromotionsToCart → []
renderCart → [applyPromotionsToCart, updateChargeButton, calculateChange,
              renderPosProductsTable, getProductBaseStock, getEffectiveLotStock,
              getEffectiveBaseStock, escapeHtml, setCartItemQtyFromInput,
              selectCartRow]
updateChargeButton → []
setPaymentMethod → []
calculateChange → []
applyManualDiscount → [applyPromotionsToCart, renderCart]
getOverstockItems → []
processSale → [openPaymentModal]
openPaymentModal → [showToast, getOverstockItems, showModal, closeModal,
                     openPaymentModal, focusPosSearchBar, applyPromotionsToCart,
                     selectPayMethod, calculatePaymentChange,
                     EnterNav.deactivate, escapeHtml]
closePaymentModal → [EnterNav.activate]
selectPayMethod → [calculatePaymentChange]
calculatePaymentChange → [applyPromotionsToCart]
confirmPayment → [closePaymentModal, forceShiftLogin, getOverstockItems,
                  applyPromotionsToCart, showToast, renderCart, loadProducts,
                  loadLots, showTicketModal, setupAutoCloseTicket,
                  refreshActiveShift]
showTicketModal → [escapeHtml, showModal, printTicket, closeModal]
setupAutoCloseTicket → [closeModal]
printTicket → []
showLotOverrideModal → [showModal, showToast, escapeHtml, applyLotOverride]
applyLotOverride → [closeModal, renderCart, showToast]
```

---

### products (CRUD productos, categorías)

```
loadProducts → [renderPosCategoryBar, renderPosProductsTable, showToast]
renderPosCategoryBar → [escapeHtml, setPosCategory]
setPosCategory → [renderPosCategoryBar, renderPosProductsTable]
onPosSearchChange → [renderPosProductsTable, showSearchResults, updateSearchCounter]
updateSearchCounter → [getFilteredProducts]
showSearchResults → []
closeSearchResults → []
onPosFilterChange → [renderPosProductsTable, updateSearchCounter]
escapeJs → []
ensureInventoryLots → []
loadProductsTable → [ensureInventoryLots, populateCategoryFilter,
                      renderProductsTable, updateSortIndicators, showToast]
populateCategoryFilter → [escapeHtml]
renderProductsTable → [renderProductRow]
renderProductRow → [escapeJs, escapeHtml, showProductLots, showProductHistory,
                     editProduct, deleteProduct]
searchProducts → [renderProductsTable, updateSortIndicators]
filterProductsByCategory → [renderProductsTable]
sortProducts → [renderProductsTable, updateSortIndicators]
updateSortIndicators → []
goToCategories → [showSection, showSettingsTab]
openProductEdit → [showSection, editProduct, showToast]
showAddProductModal → [showModal, escapeHtml, saveProduct]
saveProduct → [showToast, closeModal, loadProductsTable, loadProducts]
editProduct → [showModal, escapeHtml]
updateProduct → [showToast, closeModal, loadProductsTable, loadProducts]
deleteProduct → [showConfirmDialog, showToast, loadProductsTable, loadProducts,
                  showErrorDialog]
```

---

### lots (CRUD lotes, ajustes de stock)

```
loadLots → [renderLotsTable, showToast]
loadLotsCut → [renderLotsCut]
switchLotsTab → [loadLotsCut]
renderLotsCut → [escapeHtml]
filterLots → [renderLotsTable]
renderLotsTable → [getLotStatus, escapeHtml, showEditLotModal, showAdjustStockModal, deleteLot]
getLotStatus → []    (calcula key/label/badge/daysText desde days_left)
showAddLotModal → [showToast, loadProducts, showModal, escapeHtml, saveLot,
                    onLotProductSearchChange, handleLotProductKey,
                    clearLotProductSearch, clearLotProductSelection,
                    updateLotStockPreview, validateLotForm]
onLotProductSearchChange → [renderLotProductSearch]
clearLotProductSearch → [renderLotProductSearch]
handleLotProductKey → [getLotFilteredProducts, renderLotProductSearch,
                        looksLikeBarcode, tryLotBarcodeLookup, selectLotProduct,
                        clearLotProductSearch]
getLotFilteredProducts → []
renderLotProductSearch → [getLotFilteredProducts, escapeHtml, selectLotProduct]
tryLotBarcodeLookup → [selectLotProduct, getLotFilteredProducts, showToast]
selectLotProduct → [escapeHtml, updateLotStockPreview, validateLotForm]
clearLotProductSelection → [updateLotStockPreview, validateLotForm]
updateLotStockPreview → [validateLotForm]
validateLotForm → []
saveLot → [showToast, closeModal, loadLots, loadProducts, loadInventory]
showEditLotModal → [showModal, escapeHtml, updateLot]
updateLot → [showToast, closeModal, loadLots]
showAdjustStockModal → [showModal, escapeHtml, adjustLotStock, apiCall, getProductBaseStock]
adjustLotStock → [showToast, closeModal, loadLots, loadLotsCut]
deleteLot → [showConfirmDialog, showToast, loadLots, loadLotsCut, showErrorDialog]
```

---

### inventory (stock, movimientos, transferencias)

```
loadInventory → [renderInventoryView, showToast]
setInventoryFilter → [renderInventoryView]
onInventorySearchChange → [renderInventoryView]
clearInventorySearch → [renderInventoryView]
showQuickAddStockModal → [showModal, escapeHtml, submitQuickAddStock]
submitQuickAddStock → [showToast, closeModal, loadInventory, loadLots,
                        loadProducts, loadInventoryMovementsHistory,
                        renderInventoryView]
getInventoryFiltered → []
renderInventoryView → [getInventoryFiltered, renderInventoryCard]
renderInventoryCard → [escapeHtml, openInventoryDetail, showAddStockModal,
                        showAdjustProductStockModal, showMoveBetweenLotsModal]
openInventoryDetail → [escapeHtml, closeInventoryDetail, showAddStockModal,
                        showAdjustProductStockModal, showMoveBetweenLotsModal,
                        openProductEdit, showProductHistory, showProductLots]
closeInventoryDetail → []
showAddStockModal → [showModal, escapeHtml, submitAddStock,
                      submitAddDirectStock, closeModal]
submitAddStock → [closeModal, showToast, loadInventory, loadLots,
                  loadProductsTable, loadProducts, openInventoryDetail]
submitAddDirectStock → [closeModal, showToast, loadInventory, loadProducts,
                        openInventoryDetail]
showAdjustProductStockModal → [showModal, escapeHtml, submitAdjustProductStock]
submitAdjustProductStock → [showToast, closeModal, loadInventory, loadLots,
                             loadProducts, openInventoryDetail]
showMoveBetweenLotsModal → [showModal, showToast, submitMoveBetweenLots, closeModal]
submitMoveBetweenLots → [showToast, closeModal, loadInventory, loadLots,
                          loadProducts, openInventoryDetail]
showProductLots → [showModal, closeModal]
loadInventoryMovementsHistory → [renderInventoryMovements]
renderInventoryMovements → [escapeHtml]
showProductHistory → [showModal, closeModal, escapeHtml]
```

---

### imports (importar existencias por Excel)

```
downloadImportTemplate → [getAuthHeaders, showToast]
resetImport → []
readImportFile → [resetImport, renderImportPreview, showToast]
renderImportPreview → [escapeHtml]
applyImport → [apiCall, showToast, loadInventory, loadLots, loadProducts,
               loadInventoryMovementsHistory, escapeHtml]
```

---

### cash (caja, turnos, shift gate, historial)

```
showOpenShiftModal → [openShiftGate, submitOpenShift, handleCloseSession,
                       closeShiftGate]
showOverdueShiftModal → [openShiftGate, handleCloseSession, closeOverdueShift,
                          continueWithOverdueOpen]
continueWithOverdueOpen → [closeShiftGate, showToast, updateCashStatus]
closeOverdueShift → [closeShiftGate, showToast, updateCashStatus]
submitOpenShift → [showToast, refreshActiveShift, closeShiftGate, updateCashStatus]
showResumeShiftModal → [escapeHtml, openShiftGate, handleCloseSession,
                         requestCloseAndOpenFromResume, continueActiveShift]
continueActiveShift → [closeShiftGate, updateCashStatus, showToast]
requestCloseAndOpenFromResume → [startCloseAndOpenFlow, showOwnerPasswordModal,
                                  doCloseAndOpen]
showOwnerPasswordModal → [openShiftGate, closeShiftGate]
                          (+ invoca callback onVerified dinámico)
startCloseAndOpenFlow → [openShiftGate, closeShiftGate, doCloseAndOpen,
                          showOwnerPasswordModal]
doCloseAndOpen → [showToast, refreshActiveShift, updateCashStatus,
                   showOwnerPasswordModal]
ensureShiftActive → [showOpenShiftModal]
bootShiftGate → [showOverdueShiftModal, refreshActiveShift, showOpenShiftModal,
                  continueActiveShift, showShiftCloseConfirm]
doCloseShiftAndOpen → [showToast, refreshActiveShift, closeShiftGate,
                        updateCashStatus]
showShiftCloseConfirm → [openShiftGate, requestCloseAndOpenFromResume,
                          handleCloseSession]
checkCashRegister → [refreshActiveShift, updateCashStatus]
updateCashStatus → [escapeHtml]
showOpenCashModal → [showOpenShiftModal]
openCashRegister → [showOpenShiftModal]
showCloseCashModal → [refreshActiveShift, showToast, showModal, updateCloseDiff,
                       closeCash]
updateCloseDiff → []
closeCash → [promptOwnerPassword, showCloseReceipt, closeModal,
              refreshActiveShift, loadCashHistory, showToast, forceShiftLogin]
promptOwnerPassword → [showModal, closeModal]
showCloseReceipt → [showModal, escapeHtml, printCashClose, closeModal]
printCashClose → []
showCashTab → [loadDayCuts, loadMyShift, loadAllShifts, loadCashHistory]
loadDayCuts → [escapeHtml, viewCashDetail]
loadMyShift → [startCloseAndOpenFlow, showOwnerPasswordModal, doCloseAndOpen]
loadAllShifts → [applyAllShiftsFilter]
applyAllShiftsFilter → [renderAllShiftsTable, renderAllShiftsStats]
clearAllShiftsFilter → [applyAllShiftsFilter]
renderAllShiftsStats → []
renderAllShiftsTable → [escapeHtml, formatDateTime, formatDuration,
                         viewCashDetail, adminForceCloseShift, adminCancelShift]
viewCashDetail → [escapeHtml, formatDateTime, formatDuration, showModal,
                   showToast, printShiftDetail, closeModal]
printShiftDetail → []
adminForceCloseShift → [showToast, loadAllShifts]
adminCancelShift → [showToast, loadAllShifts]
loadCashData → [escapeHtml]
loadCashHistory → [escapeHtml, reprintCashClose]
reprintCashClose → [showModal, showToast, escapeHtml, printCashClose, closeModal]
```

---

### promotions (CRUD promociones)

```
loadPromotions → [renderPromotions, showToast]
renderPromotions → [editPromotion, deletePromotion]
showAddPromotionModal → [showPromotionModal]
showPromotionModal → [showModal, updatePromoFields, updateScopeFields,
                       savePromotion, escapeHtml]
updatePromoFields → []
updateScopeFields → []
filterPromoProducts → []
handlePromoProductSearch → [filterPromoProducts, showToast]
savePromotion → [showToast, closeModal, loadPromotions]
editPromotion → [showPromotionModal]
deletePromotion → [showConfirmDialog, showToast, loadPromotions, showErrorDialog]
```

---

### settings (categorías, usuarios, terminales, config)

```
renderSettingsMenu → [showSettingsTab]
showSettingsMenu → []
settingsBackBar → [showSettingsMenu]
showSettingsTab → [loadCategoriesSettings, loadUsersSettings, loadTerminalsSettings]
loadCategoriesSettings → [settingsBackBar, showAddCategoryModal, editCategory,
                           deleteCategory]
loadUsersSettings → [settingsBackBar, showAddUserModal]
                     ⚠️ referencia a editUser que NO existe (ver §4)
loadTerminalsSettings → [settingsBackBar, showAddTerminalModal]
showAddCategoryModal → [showModal, saveCategory]
saveCategory → [showToast, closeModal, loadCategoriesSettings]
deleteCategory → [showConfirmDialog, showToast, loadCategoriesSettings,
                   showErrorDialog]
editCategory → [showModal, updateCategory]
updateCategory → [showToast, closeModal, loadCategoriesSettings]
showAddUserModal → [showModal, saveUser]
saveUser → [showToast, closeModal, loadUsersSettings]
showAddTerminalModal → [showModal, saveTerminal]
saveTerminal → [showToast, closeModal, loadTerminalsSettings]
```

---

### reports (dashboard stats)

```
loadReports → [renderExpiryReport, showToast]
renderExpiryReport → []
showReportTab → []   (placeholder, solo cambia estilo de tab)
```

---

### utility (helpers puros, sin dependencias)

```
escapeHtml → []
escapeJs → []
formatDateTime → []
formatDuration → []
```

### Helpers internos

```
refreshSalesData → [loadProducts, loadLots]        (llamado desde showSection)
getFilteredProducts → []                           (llamado desde pos/products)
```

---

## 3. Dependencias cruzadas entre módulos (resumen visual)

```
core ──────────→ pos, inventory, products, lots, reports, cash, promotions, settings
pos ───────────→ products, lots, core
cash ──────────→ core, pos
inventory ─────→ products, lots, core
lots ──────────→ products, inventory, core
products ──────→ settings, core
settings ──────→ core
promotions ────→ core (indirecto vía renderCart → applyPromotionsToCart)
```

### Qué módulo depende de qué (para planificar split)

| Módulo | Depende de | Dependen de él |
|---|---|---|
| core | pos, cash, inventory (circular) | Todos |
| pos | products, lots, core | core, cash |
| cash | core, pos | core |
| inventory | products, lots, core | lots |
| lots | products, inventory, core | pos, inventory |
| products | settings, core | pos, lots, inventory |
| settings | core | products |
| promotions | (solo lee global) | pos (indirecto) |
| reports | core | — |
| utility | — | Todos |

### Dificultad de separación estimada

| Dificultad | Módulo | Motivo |
|---|---|---|
| Trivial | utility, reports, promotions | Sin dependencias cruzadas |
| Fácil | settings | Solo usa core |
| Moderada | products, lots, inventory | Dependen unos de otros + core |
| Difícil | pos, cash | Acoplados a core y entre sí |
| Muy difícil | core | Depende de pos y cash en círculo |

> El nudo crítico: **core ↔ pos** están acoplados en círculo.
> `setupGlobalKeys` (core) llama funciones de `pos`, y `confirmPayment` (pos)
> llama `forceShiftLogin` (core). Separarlos requiere que core no llame directo
> a pos (usar callbacks/eventos) o que un objeto `Store` regule el estado.

---

## 4. Hallazgos / issues detectados

### ⚠️ `editUser` NO existe (bug)
- **Síntoma:** El botón "Editar" en Settings → Usuarios no hace nada.
- **Causa:** `loadUsersSettings` genera `onclick="editUser(${u.id})"` en la fila de cada
  usuario, pero la función `editUser` no está definida en ningún archivo.
- **Ubicación:** `app.js` ~línea 4846 (`loadUsersSettings`).
- **Fix sugerido:** Crear la función `editUser(id)` (modal de edición + `PUT /settings/users/<id>`
  - el endpoint backend hay que verificar).

### ⚠️ Referencia a `btn` en `confirmPayment`
- **Síntoma:** Posible `ReferenceError` silencioso al cobrar.
- **Ubicación:** ~línea 3782 dentro de `confirmPayment`.
- **Nota:** Requiere verificación manual antes de confiar en el flujo de cobro.

---

## 5. Notas de mantenimiento (reglas prácticas)

1. **Si funciona, no lo toques.** Los errores graves del historial (04/09/2026) ocurrieron
   al editar código dentro de funciones grandes existentes.
2. **Cambios nuevos → sección nueva.** Si agregas una feature nueva, hazla una función
   autocontenida que solo dependa de `store`/`core`/`utils`.
3. **Cuidado con los `onclick` en template literals.** Las funciones referenciadas en
   `onclick="funcName(...)"` deben existir en el scope global. Al dividir en módulos,
   cada módulo deberá exponer sus funciones a `window` (`window.editProduct = editProduct`)
   o migrar a event delegation.
4. **Modificar una variable global compartida** (`cart`, `allProducts`, `allLots`,
   `activeShift`, etc.) puede afectar a otros módulos que la leen. Busca todas las
   referencias antes de cambiar su estructura.
5. **El `dashboard.html` carga un solo `<script src="/static/js/app.js">`.** Si algún día
   se divide, hay que listar los módulos en orden de dependencia (utils → store → core →
   módulos → main).
6. **Backend ya está bien modularizado** (blueprints por recurso). Este documento aplica
   solo al frontend `app.js`.

---

*Generado el 06/09/2026 para referencia futura de mantenimiento del POS EXPENDIO BB.*
