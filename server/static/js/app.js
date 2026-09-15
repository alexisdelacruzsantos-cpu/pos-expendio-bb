// POS EXPENDIO BB - JavaScript Principal

const API_BASE = '/api';
let currentUser = null;
let permissions = {};
let cart = [];
let saleAttemptCount = 0;
let isProcessingSale = false;
let cartHydrated = false;
const CART_STORAGE_KEY = 'pos_cart_v1';
let paymentMethod = 'cash';
let activeTerminal = null;
let mpActiveOrderId = null;
let mpPollTimer = null;
let mpWaitCanceled = false;
let mpResolve = null;
let statusPollFailures = 0;
const MP_IVA_RATE = 0.16;

function getMPFeeRate() {
    const rate = activeTerminal && activeTerminal.commission_rate ? parseFloat(activeTerminal.commission_rate) : 0;
    return rate > 0 ? (rate / 100) * (1 + MP_IVA_RATE) : 0;
}

function money(v) {
    return (Math.round(v * 100) / 100).toFixed(2);
}

async function refreshActiveTerminal() {
    try {
        const list = await apiCall('/settings/terminals');
        activeTerminal = Array.isArray(list) && list.length ? list[0] : null;
    } catch (e) {
        activeTerminal = null;
    }
    const overlay = document.getElementById('paymentOverlay');
    if (overlay && overlay.style.display === 'flex' && activeTerminal) {
        calculatePaymentChange();
    }
}

function currentCartTotal() {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0) - applyPromotionsToCart().totalDiscount;
}

function getCardNet(cardGross) {
    const feeActive = (paymentMethod === 'card' || paymentMethod === 'mixed') && getMPFeeRate() > 0;
    return feeActive ? cardGross * (1 - getMPFeeRate()) : cardGross;
}
let products = [];
let promotions = [];
let allProducts = [];
let allLots = [];
let lotsByProduct = null;

function indexLotsByProduct() {
    lotsByProduct = {};
    for (const l of allLots) {
        (lotsByProduct[l.product_id] || (lotsByProduct[l.product_id] = [])).push(l);
    }
}

function getProductLots(productId) {
    return lotsByProduct && lotsByProduct[productId] ? lotsByProduct[productId] : [];
}
let lastSaleResult = null;
let fullscreenTriggered = false;
let salesHistoryData = [];
let salesHistorySearchTimer = null;
let salesHistorySelectedId = null;
let movementsHistorySearchTimer = null;
let inventoryMovementsData = [];
let ordersProducts = [];
let ordersCart = [];
let ordersSearchTimer = null;
let ordersCategorySelected = '';

let userGestureDetected = false;
let lastFsRequest = 0;
let wantsFullscreen = false;

function isFullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

function lockFullscreen() {
    if (!isFullscreenActive() && userGestureDetected) {
        wantsFullscreen = true;
        enterFullscreen();
    }
}

function enterFullscreen() {
    if (!userGestureDetected) return;
    if (isFullscreenActive()) return;
    if (Date.now() - lastFsRequest < 2000) return;
    lastFsRequest = Date.now();
    const el = document.documentElement;
    if (el.requestFullscreen) {
        try {
            const result = el.requestFullscreen();
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        } catch (_) {}
    } else if (el.webkitRequestFullscreen) {
        try { el.webkitRequestFullscreen(); } catch (_) {}
    } else if (el.msRequestFullscreen) {
        try { el.msRequestFullscreen(); } catch (_) {}
    }
}

function setupFullscreenOnFirstInteraction() {
    const markGesture = () => {
        userGestureDetected = true;
        if (wantsFullscreen && currentUser && !isFullscreenActive()) {
            wantsFullscreen = false;
            enterFullscreen();
        }
    };
    document.addEventListener('keydown', markGesture, { passive: true });
    document.addEventListener('click', markGesture, { passive: true });
    document.addEventListener('touchstart', markGesture, { passive: true });
}

function setupEscapeBlocker() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFullscreenActive()) {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
    }, { capture: true });
}

function setupFullscreenGuard() {
    document.addEventListener('fullscreenchange', () => {
        if (!isFullscreenActive() && userGestureDetected && currentUser) {
            const modalOpen = document.getElementById('paymentOverlay')?.style.display === 'flex' ||
                               document.getElementById('modalOverlay')?.style.display === 'flex' ||
                               document.getElementById('posSearchOverlay')?.style.display === 'flex';
            if (!modalOpen) wantsFullscreen = true;
        }
    });
    window.addEventListener('blur', () => {
        if (!userGestureDetected) return;
        const modalOpen = document.getElementById('paymentOverlay')?.style.display === 'flex' ||
                          document.getElementById('modalOverlay')?.style.display === 'flex' ||
                          document.getElementById('posSearchOverlay')?.style.display === 'flex';
        if (!modalOpen) wantsFullscreen = true;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupNavigation();
    setCurrentDate();
    restoreCartFromStorage();
    setupCartEventDelegation();
    setupGlobalKeys();
    setupFullscreenOnFirstInteraction();
    setupFullscreenGuard();
    setupEscapeBlocker();
    setupSectionShortcuts();
    setupSalesFocusGuard();
    setupAdjustmentsFocusGuard();
    showSection('sales');
});

function setupGlobalKeys() {
    document.addEventListener('keydown', (e) => {
        const paymentOpen = document.getElementById('paymentOverlay')?.style.display === 'flex';
        const searchOpen = document.getElementById('posSearchOverlay')?.style.display === 'flex';
        const activeEl = document.activeElement;
        const isSearchInput = activeEl?.id === 'posSearchInput';
        const isPayInput = activeEl?.id === 'payCashAmount' || activeEl?.id === 'payCardAmount';
        const isAnyInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable);
        const modalOverlay = document.getElementById('modalOverlay');
        const modalActive = modalOverlay && modalOverlay.classList.contains('active');
        const salesHistoryOpen = document.getElementById('salesHistoryOverlay')?.style.display === 'flex';
        const priceCheckerEl = document.getElementById('priceCheckerOverlay');
        const priceCheckerOpen = priceCheckerEl && priceCheckerEl.style.display === 'flex';

        if (salesHistoryOpen) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeSalesHistory();
            }
            return;
        }

        if (modalActive && e.key === 'Enter') {
            const focused = document.activeElement;
            if (focused && focused.tagName === 'BUTTON') {
                return;
            }
            if (isAnyInput) {
                return;
            }
            const buttons = modalOverlay.querySelectorAll('button');
            if (buttons.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const single = buttons.length === 1 ? buttons[0] : null;
                const primary = single || modalOverlay.querySelector('.btn-primary, .btn-success, .btn-warning, .btn-danger');
                if (primary) primary.click();
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (priceCheckerOpen) { closePriceChecker(); return; }
            if (ubuntuMenuOpen) { closeUbuntuMenu(); return; }
            if (modalActive) {
                if (isAnyInput) {
                    activeEl.blur();
                    const primaryBtn = modalOverlay.querySelector('.btn-primary, .btn-success, .btn-warning, .btn-danger');
                    if (primaryBtn) primaryBtn.focus();
                } else {
                    closeModal();
                }
                return;
            }
            if (paymentOpen) {
                closePaymentModal();
                return;
            }
            if (searchOpen) {
                closeSearchResults();
                return;
            }
            const invPanel = document.getElementById('invSidePanel');
            if (invPanel && invPanel.classList.contains('open')) {
                closeInventoryDetail();
                return;
            }
            const lotSel = document.getElementById('lotSelectorOverlay');
            if (lotSel) {
                lotSel.remove();
                return;
            }
            const lotSearch = document.getElementById('lotSearchOverlay');
            if (lotSearch && lotSearch.style.display !== 'none') {
                lotSearch.style.display = 'none';
                return;
            }
            const shift = document.getElementById('shiftGate');
            if (shift && shift.classList.contains('open')) {
                if (shiftGateBlocking) {
                    forceShiftLogin('Sesión cancelada. Inicia sesión nuevamente.');
                }
                return;
            }
            const toast = document.getElementById('toast');
            if (toast && toast.classList.contains('show')) {
                toast.classList.remove('show');
                return;
            }
            if (isSearchInput) {
                closeSearchResults();
                document.getElementById('posSearchInput').blur();
                return;
            }
        }

        if (isPayInput) {
            if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault();
                confirmPayment();
                return;
            }
            return;
        }

        if (e.key === 'F12') {
            e.preventDefault();
            const overlay = document.getElementById('paymentOverlay');
            if (overlay && overlay.style.display === 'flex') {
                confirmPayment();
            } else {
                openPaymentModal();
            }
            return;
        }

        if (e.key === 'F9') {
            const salesActive = document.getElementById('salesSection')?.classList.contains('active');
            if (!salesActive) return;
            e.preventDefault();
            if (priceCheckerOpen) {
                const inp = document.getElementById('priceCheckInput');
                if (inp) inp.focus();
            } else {
                openPriceChecker();
            }
            return;
        }

        if (searchOpen || isSearchInput || priceCheckerOpen) return;

        /* Ubuntu menu: shortcuts 1-9 y 0 */
        if (ubuntuMenuOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const numKey = e.key;
            if (/^[0-9]$/.test(numKey)) {
                const tile = document.querySelector(`.ubuntu-tile[data-shortcut="${numKey}"]`);
                if (tile && tile.style.display !== 'none') {
                    e.preventDefault();
                    selectUbuntuTile(tile);
                }
                return;
            }
        }

        if (e.key === 'Delete') {
            if (cart.length === 0) return;
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                confirmClearCart();
                return;
            }
            e.preventDefault();
            removeFromCart(cartSelectedIndex);
        } else if (e.key === '+' || e.key === '=') {
            if (cart.length > 0) {
                e.preventDefault();
                const idx = cart.length - 1;
                cartSelectedIndex = idx;
                updateCartItemQty(idx, 1);
                updateCartSelection();
            }
        } else if (e.key === '-' || e.key === '_') {
            if (cart.length > 0) {
                e.preventDefault();
                const idx = cart.length - 1;
                cartSelectedIndex = idx;
                updateCartItemQty(idx, -1);
                updateCartSelection();
            }
        } else if (e.key === 'ArrowUp') {
            if (cart.length > 0) {
                e.preventDefault();
                cartSelectedIndex = Math.max(0, cartSelectedIndex - 1);
                updateCartSelection();
            }
        } else if (e.key === 'ArrowDown') {
            if (cart.length > 0) {
                e.preventDefault();
                cartSelectedIndex = Math.min(cart.length - 1, cartSelectedIndex + 1);
                updateCartSelection();
            }
        }
    });
}

function setupCartEventDelegation() {
    const tbody = document.getElementById('posCartBody');
    if (!tbody) return;
    tbody.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.btn-cart-remove');
        if (removeBtn) {
            e.stopPropagation();
            e.preventDefault();
            const index = parseInt(removeBtn.dataset.index);
            console.log('[cart delegation] remove clicked, index:', index);
            removeFromCart(index);
            return;
        }
        const lotBtn = e.target.closest('.col-lot-btn');
        if (lotBtn) {
            e.stopPropagation();
            const tr = lotBtn.closest('tr');
            if (tr) {
                const index = parseInt(tr.dataset.index);
                if (!isNaN(index)) showLotOverrideModal(index);
            }
            return;
        }
        const tr = e.target.closest('tr');
        if (tr && tr.dataset.index !== undefined) {
            const index = parseInt(tr.dataset.index);
            if (!isNaN(index)) selectCartRow(index);
        }
    });
}

function checkAuth() {
    const token = localStorage.getItem('pos_token');
    const userStr = localStorage.getItem('pos_user');
    const permsStr = localStorage.getItem('pos_permissions');

    if (!token || !userStr) {
        window.location.href = '/';
        return;
    }

    currentUser = JSON.parse(userStr);
    permissions = JSON.parse(permsStr || '{}');

    document.getElementById('userName').textContent = currentUser.full_name;
    document.getElementById('userRole').textContent = currentUser.role.toUpperCase();

    applyRoleVisibility();

    apiCall('/auth/validate').catch(() => {});

    loadInitialData();
}

// --- Visibilidad por rol ---
function canAccessSection(section) {
    if (currentUser?.role === 'admin') return true;
    const p = permissions || {};
    const view = m => !!p[m]?.can_view;
    const edit = m => !!p[m]?.can_edit;
    switch (section) {
        case 'sales': return view('sales');
        case 'products': return view('products');
        case 'inventory': return edit('products');
        case 'adjustments': return edit('products');
        case 'lots': return edit('products');
        case 'promotions': return edit('products');
        case 'import': return edit('products');
        case 'inventory-history': return view('products');
        case 'existencias': return view('products');
        case 'orders': return view('products');
        case 'reports': return view('reports');
        case 'cash': return view('cash_register');
        case 'settings': return view('settings');
        default: return true;
    }
}

function applyRoleVisibility() {
    document.querySelectorAll('[data-section]').forEach(el => {
        const section = el.getAttribute('data-section');
        const allowed = canAccessSection(section);
        el.style.display = allowed ? '' : 'none';
        el.style.visibility = allowed ? '' : 'hidden';
    });
}

// Estado del turno activo (caché en memoria)
let activeShift = null;
let shiftGateInFlight = false;
let shiftGateBlocking = false;

async function refreshActiveShift() {
    try {
        const data = await apiCall('/cash/active');
        if (data.has_active) {
            activeShift = data;
        } else {
            activeShift = null;
        }
        updateShiftChip();
        return activeShift;
    } catch (e) {
        updateShiftChip();
        return activeShift;
    }
}

function updateShiftChip() {
    const chip = document.getElementById('shiftChip');
    const label = document.getElementById('shiftChipLabel');
    if (!chip || !label) return;
    if (activeShift) {
        chip.classList.add('active');
        const ownerName = activeShift.owner?.full_name || activeShift.register?.cashier_name || '—';
        label.textContent = `Turno #${activeShift.register.id} · ${ownerName}`;
        chip.title = `Turno activo #${activeShift.register.id} abierto por ${ownerName}`;
    } else {
        chip.classList.remove('active');
        label.textContent = 'Sin turno';
        chip.title = 'No hay turno de caja abierto';
    }
}

function forceShiftLogin(reason = 'No hay turno de caja activo. Inicia sesión de nuevo para abrir uno.') {
    closeShiftGate({silent:true});
    showToast(reason, 'error');
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_permissions');
    window.location.href = '/';
}

async function blockUntilShiftOpen(reason = 'Necesitas abrir un turno de caja para operar') {
    await refreshActiveShift();
    if (activeShift) {
        if (typeof updateCashStatus === 'function') {
            const cur = await apiCall('/cash/current').catch(() => null);
            if (cur) updateCashStatus(cur);
        }
        return;
    }
    showOpenShiftModal({ source: 'login' });
    showToast(reason, 'warning');
}

setInterval(async () => {
    if (!currentUser) return;
    if (shiftGateInFlight) return;
    const overlay = document.getElementById('shiftGate');
    if (overlay && overlay.classList.contains('open')) return;
    try {
        const data = await apiCall('/cash/active');
        const prev = activeShift?.register?.id;
        if (!data) {
            if (prev) {
                forceShiftLogin('El turno de caja fue cerrado. Inicia sesión de nuevo para abrir uno.');
            }
        } else if (data.has_active) {
            activeShift = data;
            updateShiftChip();
            if (typeof updateCashStatus === 'function') {
                updateCashStatus({ has_open: true, cash: data.register, stats: data.stats });
            }
        } else {
            activeShift = null;
            updateShiftChip();
            if (typeof updateCashStatus === 'function') {
                updateCashStatus({ has_open: false });
            }
            if (prev) {
                // El turno se cerró en otra vista/instancia: bloquear hasta reabrir.
                blockUntilShiftOpen('El turno de caja fue cerrado. Debes abrir un turno para continuar.');
            }
        }
    } catch {}
}, 30000);

// ============================================================================
// Enter Navigation System
// Permite navegar entre inputs con Enter (como Tab) y disparar el botón primario
// al final del formulario. Se activa por "scope" (modal, shift gate, etc.).
// ============================================================================

const EnterNav = (() => {
    const scopes = new Map();
    let activeScopeKey = null;

    function isNavigable(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') return false;
        if (el.disabled || el.readOnly) return false;
        if (el.type === 'hidden') return false;
        if (el.type === 'button' || el.type === 'submit' || el.type === 'reset') return false;
        if (el.type === 'checkbox' || el.type === 'radio') return false;
        if (tag === 'TEXTAREA') return false;
        if (tag === 'SELECT' && el.multiple) return false;
        if (el.offsetParent === null && tag !== 'BUTTON') return false;
        return true;
    }

    function getNavigableElements(container, skipSelectors = []) {
        if (!container) return [];
        const all = Array.from(container.querySelectorAll('input, select, textarea, button'));
        const visible = all.filter(el => {
            if (el.disabled || el.readOnly) return false;
            if (el.type === 'hidden') return false;
            if (el.type === 'checkbox' || el.type === 'radio') return false;
            if (el.offsetParent === null && el.type !== 'button' && el.type !== 'submit') return false;
            return true;
        });
        const skipSet = new Set(skipSelectors);
        return visible.filter(el => {
            for (const sel of skipSet) {
                if (el.matches(sel) || el.closest(sel)) return false;
            }
            return true;
        });
    }

    function findPrimaryButton(container, primarySelector) {
        if (!container) return null;
        const root = primarySelector
            ? (container.closest('.modal, .shift-gate, .payment-modal') || container)
            : container;
        if (primarySelector) {
            const btn = root.querySelector(primarySelector);
            if (btn && !btn.disabled) return btn;
        }
        const candidates = root.querySelectorAll('button.btn-primary, button[type="submit"]');
        for (const b of candidates) {
            if (!b.disabled) return b;
        }
        return null;
    }

    function handleEnter(e, navigables) {
        const active = document.activeElement;
        if (!active) return;
        if (active.tagName === 'TEXTAREA') return;
        if (active.isContentEditable) return;
        if (!navigables.includes(active)) return;

        const idx = navigables.indexOf(active);
        const next = navigables[idx + 1];

        if (next) {
            e.preventDefault();
            next.focus();
            try {
                if (next.select && (next.type === 'text' || next.type === 'number' || next.type === 'search' || next.type === 'tel' || next.type === 'url' || next.type === 'email' || next.type === 'password')) {
                    next.select();
                }
            } catch (_) {}
        } else {
            const scope = scopes.get(activeScopeKey);
            if (scope) {
                const primary = findPrimaryButton(scope.container, scope.primarySelector);
                if (primary && !primary.disabled) {
                    e.preventDefault();
                    primary.click();
                }
            }
        }
    }

    function attach(scope) {
        if (!scope.container) return;
        const navigables = getNavigableElements(scope.container, scope.skipSelectors || []);
        if (navigables.length === 0) return;

        const handler = (e) => {
            if (e.key !== 'Enter') return;
            const fresh = getNavigableElements(scope.container, scope.skipSelectors || []);
            const currentActive = document.activeElement;
            if (!fresh.includes(currentActive)) return;
            handleEnter(e, fresh);
        };

        scope._handler = handler;
        scope._navigables = navigables;
        scope.container.addEventListener('keydown', handler, true);
    }

    function detach(scope) {
        if (!scope || !scope._handler) return;
        scope.container.removeEventListener('keydown', scope._handler, true);
        scope._handler = null;
    }

    return {
        activate(opts) {
            const { scopeKey, container, primarySelector = null, skipSelectors = [] } = opts;
            if (!container) return;
            if (scopes.has(scopeKey)) {
                EnterNav.deactivate(scopeKey);
            }
            const scope = { scopeKey, container, primarySelector, skipSelectors };
            scopes.set(scopeKey, scope);
            attach(scope);
            activeScopeKey = scopeKey;
        },
        deactivate(scopeKey) {
            const scope = scopes.get(scopeKey);
            if (scope) {
                detach(scope);
                scopes.delete(scopeKey);
            }
            if (activeScopeKey === scopeKey) {
                activeScopeKey = null;
            }
        },
        deactivateAll() {
            for (const key of Array.from(scopes.keys())) {
                EnterNav.deactivate(key);
            }
        },
        getActive() {
            return activeScopeKey;
        }
    };
})();

function openShiftGate() {
    const gate = document.getElementById('shiftGate');
    if (gate) gate.classList.add('open');
    EnterNav.activate({
        scopeKey: 'shiftGate',
        container: document.getElementById('shiftGateBody'),
        primarySelector: '#shiftGateFoot .btn-primary',
        skipSelectors: ['textarea', 'select[multiple]']
    });
}
function closeShiftGate({ forceLogout = false, silent = false } = {}) {
    const gate = document.getElementById('shiftGate');
    if (gate) gate.classList.remove('open');
    EnterNav.deactivateAll();
    const wasBlocking = shiftGateBlocking;
    if (silent) {
        shiftGateBlocking = false;
        return;
    }
    if (forceLogout || wasBlocking) {
        shiftGateBlocking = false;
        forceShiftLogin('Sesión finalizada por seguridad. Inicia sesión nuevamente para continuar.');
    }
}

function showOpenShiftModal({ source = 'login' } = {}) {
    const title = document.getElementById('shiftGateTitle');
    const sub = document.getElementById('shiftGateSub');
    const body = document.getElementById('shiftGateBody');
    const foot = document.getElementById('shiftGateFoot');
    title.textContent = '🟢 Abrir nuevo turno';
    sub.textContent = source === 'sales' ? 'Necesitas abrir un turno para empezar a vender' : 'Inicia el turno de caja para empezar a operar';
    body.innerHTML = `
        <form id="openShiftForm" onsubmit="submitOpenShift(event)">
            <div class="form-group">
                <label>Monto de apertura *</label>
                <input type="number" name="opening_amount" min="0" step="0.01" value="0" required>
            </div>
            <div class="form-group">
                <label>Terminal (opcional)</label>
                <input type="text" name="terminal" placeholder="Ej: Caja 1, Mostrador, etc.">
            </div>
            <div class="form-group">
                <label>Notas (opcional)</label>
                <textarea name="notes" rows="2" placeholder="Observaciones del inicio de turno"></textarea>
            </div>
        </form>
    `;
    foot.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="${source === 'login' ? 'handleCloseSession()' : 'closeShiftGate({silent:true})'}">${source === 'login' ? 'Cerrar sesión' : 'Cancelar'}</button>
        <button type="button" class="btn btn-primary" onclick="document.getElementById('openShiftForm').requestSubmit()">🔓 Abrir turno</button>
    `;
    openShiftGate();
    if (source === 'login') {
        shiftGateBlocking = true;
    }
    setTimeout(() => {
        const inp = body.querySelector('input[name="opening_amount"]');
        if (inp) { inp.focus(); inp.select(); }
    }, 50);
}
 
function showOverdueShiftModal(overdue) {
    const title = document.getElementById('shiftGateTitle');
    const sub = document.getElementById('shiftGateSub');
    const body = document.getElementById('shiftGateBody');
    const foot = document.getElementById('shiftGateFoot');
    const yesterdayShift = overdue.yesterday_shift;
    const todayCount = overdue.open_today_count;
    const todayShifts = overdue.today_shifts || [];
    
    const openDate = yesterdayShift?.open_date ? new Date(yesterdayShift.open_date).toLocaleString('es-MX') : '—';
    const cashierName = yesterdayShift?.cashier_name || 'Desconocido';
    
    title.textContent = '⚠️ Turno abierto del día anterior';
    sub.textContent = `Hay un turno (#${yesterdayShift?.id || '?'}) abierto por ${cashierName} desde ${openDate} que no se cerró. Debes cerrarlo antes de continuar.`;
    
    let html = `
        <div class="form-group" style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <strong>⏰ Turno pendiente de ayer:</strong><br>
            <small>ID: ${yesterdayShift?.id} | Cajero: ${cashierName} | Apertura: ${openDate}</small>
        </div>
    `;
    
    if (todayCount > 0) {
        html += `<div class="form-group" style="background: #fce7f3; border: 1px solid #ec4899; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <strong>⚠️ Hay ${todayCount} turno(s) abierto(s) hoy:</strong><br>
            <small>${todayShifts.map(s => `#${s.id} - ${s.cashier_name} (${new Date(s.open_date).toLocaleTimeString('es-MX')})`).join('<br>')}</small>
        </div>`;
    }
    
    html += `
        <div class="form-group">
            <label>Motivo del cierre del turno anterior</label>
            <textarea name="close_notes" rows="2" placeholder="¿Por qué se cerró el turno de ayer? (ej: olvido, cambio de turno, etc.)"></textarea>
        </div>
    `;
    
    body.innerHTML = html;
    
    foot.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="handleCloseSession()">Cerrar sesión</button>
        <button type="button" class="btn btn-warning" onclick="closeOverdueShift()">🔒 Cerrar turno de ayer</button>
        <button type="button" class="btn btn-primary" onclick="continueWithOverdueOpen()">▶️ Cerrar y abrir mi turno</button>
    `;
    openShiftGate();
    shiftGateBlocking = true;
}
 
function continueWithOverdueOpen() {
    const closeNotes = document.querySelector('textarea[name="close_notes"]')?.value || '';
    shiftGateBlocking = false;
    closeShiftGate({silent:true});
    showToast(`⚠️ Se cerrará el turno anterior de ayer y se abrirá tu nuevo turno.`, 'warning');
    
    setTimeout(async () => {
        try {
            const active = await apiCall('/cash/active');
            if (!active?.has_active) {
                showToast('No hay turno activo para cerrar', 'error');
                return;
            }
            const expected = active.expected_amount || 0;
            const result = await apiCall('/cash/close-and-open', 'POST', {
                closing: { counted_cash: expected, notes: closeNotes },
                opening: { opening_amount: 0, terminal: '', notes: '' }
            });
            showToast(`✓ Turno anterior cerrado #${result.closed.id} y nuevo turno #${result.opened.id} abierto`, 'success');
            const cur = await apiCall('/cash/current').catch(() => null);
            if (cur) updateCashStatus(cur);
        } catch (error) {
            let msg = 'Error';
            try { msg = JSON.parse(error.message).error || error.message; } catch { msg = error.message; }
            showToast(msg, 'error');
        }
    }, 500);
}
 
async function closeOverdueShift() {
    const closeNotes = document.querySelector('textarea[name="close_notes"]')?.value || '';
    shiftGateBlocking = false;
    closeShiftGate({silent:true});
    showToast('Cerrando turno de ayer...', 'info');
    
    try {
        const data = await apiCall('/cash/active');
        if (!data?.has_active) {
            showToast('No hay turno activo para cerrar', 'error');
            return;
        }
        
        const result = await apiCall(`/cash/${data.register.id}/close`, 'POST', {
            notes: closeNotes,
            counted_cash: data.expected_amount || 0
        });
        showToast(`✓ Turno de ayer #${data.register.id} cerrado`, 'success');
        const active = await apiCall('/cash/active').catch(() => null);
        if (active?.has_active) {
            const cur = await apiCall('/cash/current').catch(() => null);
            if (cur) updateCashStatus(cur);
        } else {
            // No quedó ningún turno abierto: NO se puede operar sin turno.
            shiftGateBlocking = false;
            closeShiftGate({silent:true});
            activeShift = null;
            updateShiftChip();
            await blockUntilShiftOpen('Turno de ayer cerrado. Abre un turno para empezar a vender.');
        }
    } catch (error) {
        let msg = 'Error';
        try { msg = JSON.parse(error.message).error || error.message; } catch { msg = error.message; }
        showToast(msg, 'error');
    }
}
 
async function submitOpenShift(event) {
    event.preventDefault();
    const form = event.target;
    const data = {
        opening_amount: parseFloat(form.opening_amount.value) || 0,
        terminal: form.terminal.value || '',
        notes: form.notes.value || ''
    };
    try {
        const result = await apiCall('/cash/open', 'POST', data);
        showToast('✓ ' + (result.message || 'Turno abierto'), 'success');
        await refreshActiveShift();
        shiftGateBlocking = false;
        closeShiftGate();
        if (typeof updateCashStatus === 'function') {
            const cur = await apiCall('/cash/current').catch(() => null);
            if (cur) updateCashStatus(cur);
        }
    } catch (error) {
        let msg = 'Error';
        try { msg = JSON.parse(error.message).error || error.message; } catch { msg = error.message; }
        showToast(msg, 'error');
    }
}

function showResumeShiftModal(data) {
    const reg = data.register;
    const stats = data.stats || {};
    const owner = data.owner;
    const isMine = currentUser && owner && Number(owner.id) === Number(currentUser.id);
    const openedAt = reg.open_date ? new Date(reg.open_date).toLocaleString('es-MX') : '—';
    const elapsedMin = reg.open_date ? Math.max(0, Math.floor((Date.now() - new Date(reg.open_date).getTime()) / 60000)) : 0;
    const hours = Math.floor(elapsedMin / 60);
    const mins = elapsedMin % 60;
    const elapsedStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;

    const title = document.getElementById('shiftGateTitle');
    const sub = document.getElementById('shiftGateSub');
    const body = document.getElementById('shiftGateBody');
    const foot = document.getElementById('shiftGateFoot');
    title.textContent = isMine ? '⏯️ Continuar tu turno' : '⚠️ Turno activo de otro usuario';
    sub.textContent = isMine ? 'Ya tienes un turno abierto. Puedes continuarlo o cerrarlo.' : `El turno actual fue abierto por ${owner?.full_name || owner?.username || 'otro usuario'}.`;

    body.innerHTML = `
        <div style="margin-bottom:12px">
            <span class="shift-owner-badge ${isMine ? '' : 'other'}">
                👤 ${escapeHtml(owner?.full_name || owner?.username || 'Cajero')}
                ${isMine ? '(eres tú)' : '(otro usuario)'}
            </span>
            <div style="font-size:12px;color:var(--text-light);margin-top:6px">
                Abierto: <strong>${openedAt}</strong> · Transcurrido: <strong>${elapsedStr}</strong>
            </div>
        </div>
        <div class="shift-resume-grid">
            <div class="shift-resume-stat"><div class="lbl">Apertura</div><div class="val">$${parseFloat(reg.opening_amount || 0).toFixed(2)}</div></div>
            <div class="shift-resume-stat"><div class="lbl">Ventas</div><div class="val">${stats.sales_count || 0} · $${parseFloat(stats.sales_total || 0).toFixed(2)}</div></div>
            <div class="shift-resume-stat"><div class="lbl">Efectivo</div><div class="val">$${parseFloat(stats.cash_total || 0).toFixed(2)}</div></div>
            <div class="shift-resume-stat"><div class="lbl">Tarjeta / Mixto</div><div class="val">$${(parseFloat(stats.card_total || 0) + parseFloat(stats.mixed_total || 0)).toFixed(2)}</div></div>
            <div class="shift-resume-stat"><div class="lbl">Esperado en caja</div><div class="val">$${parseFloat(data.expected_amount || 0).toFixed(2)}</div></div>
            <div class="shift-resume-stat"><div class="lbl">Terminal</div><div class="val" style="font-size:13px">${escapeHtml(reg.terminal || '—')}</div></div>
        </div>
    `;
    foot.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="handleCloseSession()">Cerrar sesión</button>
        <button type="button" class="btn btn-warning" onclick="requestCloseAndOpenFromResume()">🔒 Cerrar y abrir nuevo</button>
        <button type="button" class="btn btn-primary" onclick="continueActiveShift()">▶️ Continuar turno</button>
    `;
    openShiftGate();
    shiftGateBlocking = false;
}

async function continueActiveShift() {
    shiftGateBlocking = false;
    closeShiftGate();
    if (typeof updateCashStatus === 'function') {
        const cur = await apiCall('/cash/current').catch(() => null);
        if (cur) updateCashStatus(cur);
    }
    showToast(`✓ Turno #${activeShift.register.id} en curso`, 'success');
}

function requestCloseAndOpenFromResume() {
    const reg = activeShift?.register;
    if (!reg) return;
    const ownerId = reg.user_id;
    const isOwner = currentUser && Number(currentUser.id) === Number(ownerId);
    if (isOwner) {
        startCloseAndOpenFlow();
    } else {
        showOwnerPasswordModal({
            reason: 'Para cerrar el turno de otro usuario confirma con la contraseña del dueño',
            onVerified: (password) => doCloseAndOpen(password)
        });
    }
}

function showOwnerPasswordModal({ reason, onVerified, title = '🔐 Confirmar identidad' } = {}) {
    const t = document.getElementById('shiftGateTitle');
    const s = document.getElementById('shiftGateSub');
    const b = document.getElementById('shiftGateBody');
    const f = document.getElementById('shiftGateFoot');
    t.textContent = title;
    s.textContent = reason || 'Ingresa la contraseña del dueño del turno para continuar';
    b.innerHTML = `
        <form id="ownerPwForm" onsubmit="event.preventDefault(); window.__ownerPwSubmit && window.__ownerPwSubmit();">
            <div class="form-group">
                <label>Contraseña del dueño *</label>
                <input type="password" name="owner_password" required autocomplete="current-password">
            </div>
        </form>
    `;
    f.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="closeShiftGate()">Cancelar</button>
        <button type="button" class="btn btn-primary" id="ownerPwConfirm">Confirmar</button>
    `;
    openShiftGate();
    window.__ownerPwSubmit = () => {
        const pw = b.querySelector('input[name="owner_password"]').value;
        if (!pw) return;
        shiftGateBlocking = false;
        closeShiftGate({silent:true});
        try { onVerified && onVerified(pw); } finally { window.__ownerPwSubmit = null; }
    };
    document.getElementById('ownerPwConfirm').onclick = window.__ownerPwSubmit;
}

function startCloseAndOpenFlow() {
    const reg = activeShift?.register;
    if (!reg) return;
    const expected = activeShift.expected_amount || 0;
    const ownerId = reg.user_id;
    const isOwner = currentUser && Number(currentUser.id) === Number(ownerId);
    const t = document.getElementById('shiftGateTitle');
    const s = document.getElementById('shiftGateSub');
    const b = document.getElementById('shiftGateBody');
    const f = document.getElementById('shiftGateFoot');
    t.textContent = isOwner ? '🔒 Cerrar turno y abrir nuevo' : '🔒 Cerrar turno ajeno y abrir nuevo';
    s.textContent = isOwner ? 'Confirma el conteo físico y abre un nuevo turno' : 'Como supervisor/admin, primero confirma la contraseña del dueño';
    b.innerHTML = `
        <div class="form-section-title">🔒 Cierre del turno actual</div>
        <div style="background:#f9fafb;border-radius:8px;padding:10px 12px;margin-bottom:12px">
            <div>Esperado en caja: <strong>$${expected.toFixed(2)}</strong></div>
            <div style="font-size:12px;color:var(--text-light)">Apertura + ventas en efectivo del turno</div>
        </div>
        <form id="closeAndOpenForm" onsubmit="event.preventDefault(); window.__closeOpenSubmit && window.__closeOpenSubmit();">
            <div class="form-row">
                <div class="form-group">
                    <label>Conteo físico (efectivo)</label>
                    <input type="number" name="counted_cash" min="0" step="0.01" value="${expected.toFixed(2)}" autofocus>
                </div>
                <div class="form-group">
                    <label>Notas del cierre</label>
                    <input type="text" name="close_notes" placeholder="Observaciones">
                </div>
            </div>
            <div class="form-section-title">🟢 Nuevo turno</div>
            <div class="form-row">
                <div class="form-group">
                    <label>Monto apertura *</label>
                    <input type="number" name="opening_amount" min="0" step="0.01" value="0" required>
                </div>
                <div class="form-group">
                    <label>Terminal</label>
                    <input type="text" name="terminal" placeholder="Opcional">
                </div>
            </div>
            <div class="form-group">
                <label>Notas del nuevo turno</label>
                <input type="text" name="opening_notes" placeholder="Opcional">
            </div>
        </form>
    `;
    f.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="closeShiftGate()">Cancelar</button>
        <button type="button" class="btn btn-primary" id="closeOpenConfirm">Cerrar y abrir</button>
    `;
    openShiftGate();
    window.__closeOpenSubmit = () => {
        const fd = new FormData(b.querySelector('form'));
        const data = {
            closing: {
                counted_cash: fd.get('counted_cash') || '',
                notes: fd.get('close_notes') || ''
            },
            opening: {
                opening_amount: parseFloat(fd.get('opening_amount')) || 0,
                terminal: fd.get('terminal') || '',
                notes: fd.get('opening_notes') || ''
            }
        };
        shiftGateBlocking = false;
        closeShiftGate({silent:true});
        if (isOwner) {
            doCloseAndOpen(null, data);
        } else {
            showOwnerPasswordModal({
                reason: 'Ingresa la contraseña del dueño del turno',
                onVerified: (password) => doCloseAndOpen(password, data)
            });
        }
    };
    document.getElementById('closeOpenConfirm').onclick = window.__closeOpenSubmit;
}

async function doCloseAndOpen(ownerPassword = null, preloadedData = null) {
    let data = preloadedData;
    if (!data) {
        const b = document.getElementById('shiftGateBody');
        const fd = new FormData(b.querySelector('form'));
        data = {
            closing: { counted_cash: fd.get('counted_cash') || '', notes: fd.get('close_notes') || '' },
            opening: {
                opening_amount: parseFloat(fd.get('opening_amount')) || 0,
                terminal: fd.get('terminal') || '',
                notes: fd.get('opening_notes') || ''
            }
        };
    }
    if (ownerPassword) data.owner_password = ownerPassword;
    try {
        const result = await apiCall('/cash/close-and-open', 'POST', data);
        showToast(`✓ Turno #${result.closed.id} cerrado y nuevo turno #${result.opened.id} abierto`, 'success');
        await refreshActiveShift();
        if (typeof updateCashStatus === 'function') {
            const cur = await apiCall('/cash/current').catch(() => null);
            if (cur) updateCashStatus(cur);
        }
    } catch (error) {
        let msg = 'Error';
        try { msg = JSON.parse(error.message).error || error.message; } catch { msg = error.message; }
        if (msg.includes('requires_password') || msg.toLowerCase().includes('contraseña')) {
            showOwnerPasswordModal({
                reason: msg,
                onVerified: (password) => doCloseAndOpen(password, data)
            });
            return;
        }
        showToast(msg, 'error');
    }
}

async function ensureShiftActive({ source = 'system' } = {}) {
    if (activeShift) return activeShift;
    showOpenShiftModal({ source });
    return null;
}

function setCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('es-ES', options);
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const timeStr = `${hours}:${minutes}:${seconds} ${ampm}`;

    const dateEl = document.getElementById('bottomClockDate');
    const timeEl = document.getElementById('bottomClockTime');
    if (dateEl) dateEl.textContent = dateStr;
    if (timeEl) timeEl.textContent = timeStr;
}

setInterval(setCurrentDate, 1000);

// Navigation
function setupNavigation() {
    document.querySelectorAll('.topbar-tab').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            document.querySelectorAll('.topbar-tab').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            showSection(section);
        });
    });

    /* Ubuntu menu event listeners */
    const overlay = document.getElementById('ubuntuOverlay');
    const menuBtn = document.getElementById('ubuntuMenuBtn');
    const closeBtn = document.getElementById('ubuntuCloseBtn');
    const searchInput = document.getElementById('ubuntuSearchInput');

    menuBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (ubuntuMenuOpen) closeUbuntuMenu(); else openUbuntuMenu();
    });
    closeBtn?.addEventListener('click', closeUbuntuMenu);
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) closeUbuntuMenu();
    });
    searchInput?.addEventListener('input', (e) => {
        filterUbuntuTiles(e.target.value);
    });
    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeUbuntuMenu(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); navigateUbuntuTiles(); }
    });

    document.querySelectorAll('.ubuntu-tile').forEach(tile => {
        tile.addEventListener('click', () => {
            if (ubuntuDragSuppressClick) return;
            selectUbuntuTile(tile);
        });
    });
    setupUbuntuTileDrag();

    /* Setup overlays — inventory uses internal layout now */
}

function navigateTo(section) {
    const tab = document.querySelector(`.topbar-tab[data-section="${section}"]`);
    if (tab) {
        tab.click();
    } else {
        document.querySelectorAll('.topbar-tab').forEach(i => i.classList.remove('active'));
        showSection(section);
    }
}

function setupSectionShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key !== 'F2' && e.key !== 'F4') return;
        const activeEl = document.activeElement;
        const payInput = activeEl && (activeEl.id === 'payCashAmount' || activeEl.id === 'payCardAmount');
        if (payInput) return;
        const modalActive = document.getElementById('modalOverlay')?.classList.contains('active');
        const paymentOpen = document.getElementById('paymentOverlay')?.style.display === 'flex';
        if (modalActive || paymentOpen) return;

        if (e.key === 'F2') {
            e.preventDefault();
            if (!document.getElementById('salesSection').classList.contains('active')) {
                navigateTo('sales');
            }
        } else if (e.key === 'F4') {
            e.preventDefault();
            if (!document.getElementById('inventorySection').classList.contains('active')) {
                navigateTo('inventory');
            }
        }
    });
}

/* ===== Menú Ubuntu (Super+A style) ===== */
let ubuntuMenuOpen = false;
let ubuntuTileFocusIndex = -1;

function openUbuntuMenu() {
    if (ubuntuMenuOpen) return;
    ubuntuMenuOpen = true;
    ubuntuTileFocusIndex = -1;
    applyUbuntuOrder();
    const overlay = document.getElementById('ubuntuOverlay');
    overlay.style.display = 'flex';
    overlay.classList.add('active');
    const searchInput = document.getElementById('ubuntuSearchInput');
    searchInput.value = '';
    filterUbuntuTiles('');
    searchInput.focus();
}

function closeUbuntuMenu() {
    if (!ubuntuMenuOpen) return;
    ubuntuMenuOpen = false;
    ubuntuTileFocusIndex = -1;
    const overlay = document.getElementById('ubuntuOverlay');
    overlay.classList.remove('active');
    setTimeout(() => { overlay.style.display = 'none'; }, 150);
}

function filterUbuntuTiles(query) {
    const tiles = document.querySelectorAll('.ubuntu-tile');
    const q = query.toLowerCase().trim();
    tiles.forEach(tile => {
        const label = tile.querySelector('.ubuntu-tile-label').textContent.toLowerCase();
        const match = !q || label.includes(q);
        tile.style.display = match ? 'flex' : 'none';
    });
}

function navigateUbuntuTiles() {
    const visibleTiles = Array.from(document.querySelectorAll('.ubuntu-tile')).filter(t => t.style.display !== 'none');
    if (!visibleTiles.length) return;
    ubuntuTileFocusIndex = (ubuntuTileFocusIndex + 1) % visibleTiles.length;
    visibleTiles[ubuntuTileFocusIndex].focus();
}

function selectUbuntuTile(tile) {
    const section = tile.dataset.section;
    closeUbuntuMenu();
    navigateTo(section);
}

/* ===== Reordenar tiles del menú por arrastre ===== */
const UBUNTU_ORDER_KEY = 'pos_ubuntu_order';
let ubuntuDragSuppressClick = false;
let ubuntuDrag = null;

function loadUbuntuOrder() {
    try {
        const raw = localStorage.getItem(UBUNTU_ORDER_KEY);
        const arr = raw ? JSON.parse(raw) : null;
        return Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

function saveUbuntuOrder() {
    const grid = document.getElementById('ubuntuGrid');
    if (!grid) return;
    const order = Array.from(grid.querySelectorAll('.ubuntu-tile')).map(t => t.dataset.section);
    try {
        localStorage.setItem(UBUNTU_ORDER_KEY, JSON.stringify(order));
    } catch {
        /* almacenamiento no disponible */
    }
}

function applyUbuntuOrder() {
    const grid = document.getElementById('ubuntuGrid');
    if (!grid) return;
    const order = loadUbuntuOrder();
    if (!order.length) return;
    const tiles = Array.from(grid.querySelectorAll('.ubuntu-tile'));
    order.forEach(section => {
        const tile = tiles.find(t => t.dataset.section === section);
        if (tile) grid.appendChild(tile);
    });
}

function setupUbuntuTileDrag() {
    document.getElementById('ubuntuGrid')?.querySelectorAll('.ubuntu-tile').forEach(tile => {
        tile.addEventListener('pointerdown', onUbuntuTilePointerDown);
    });
    document.addEventListener('pointermove', onUbuntuDragMove);
    document.addEventListener('pointerup', endUbuntuDrag);
    document.addEventListener('pointercancel', cancelUbuntuDrag);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && ubuntuDrag && ubuntuDrag.active) {
            e.preventDefault();
            finishUbuntuDrag(false);
        }
    });
}

function onUbuntuTilePointerDown(e) {
    if (ubuntuDrag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ubuntuDragSuppressClick = false;
    const tile = e.currentTarget;
    ubuntuDrag = {
        tile,
        grid: document.getElementById('ubuntuGrid'),
        ghost: null,
        active: false,
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        startIndex: Array.prototype.indexOf.call(tile.parentNode.children, tile)
    };
}

function onUbuntuDragMove(e) {
    const d = ubuntuDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
        startUbuntuDragging(e.clientX, e.clientY);
    }
    e.preventDefault();
    positionGhost(e.clientX, e.clientY);
    reorderOnMove(e.clientX, e.clientY);
}

function startUbuntuDragging(x, y) {
    const d = ubuntuDrag;
    d.active = true;
    d.ghost = d.tile.cloneNode(true);
    d.ghost.classList.add('ubuntu-tile-ghost');
    d.ghost.style.width = d.tile.offsetWidth + 'px';
    document.body.appendChild(d.ghost);
    d.tile.classList.add('ubuntu-tile-dragging');
    document.body.classList.add('ubuntu-dragging');
    positionGhost(x, y);
}

function positionGhost(x, y) {
    const d = ubuntuDrag;
    if (!d?.ghost) return;
    const w = d.ghost.offsetWidth;
    const h = d.ghost.offsetHeight;
    d.ghost.style.left = (x - w / 2) + 'px';
    d.ghost.style.top = (y - h / 2) + 'px';
}

function reorderOnMove(x, y) {
    const d = ubuntuDrag;
    const visible = Array.from(d.grid.querySelectorAll('.ubuntu-tile')).filter(t => t.style.display !== 'none');

    const prev = new Map();
    visible.forEach(t => {
        if (t._ubuntuFlip) t._ubuntuFlip.cancel();
        prev.set(t, t.getBoundingClientRect());
    });

    const others = visible.filter(t => t !== d.tile);
    let insertPos = others.length;
    for (let i = 0; i < others.length; i++) {
        const r = prev.get(others[i]);
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const after = (y > cy) || (Math.abs(y - cy) < r.height / 2 && x > cx);
        if (!after) { insertPos = i; break; }
    }

    const refNode = insertPos < others.length ? others[insertPos] : null;
    if (refNode) {
        if (d.tile === refNode || d.tile.nextSibling === refNode) return;
        d.grid.insertBefore(d.tile, refNode);
    } else {
        if (d.tile === d.grid.lastElementChild) return;
        d.grid.appendChild(d.tile);
    }

    flipTiles(prev);
}

function flipTiles(prev) {
    const d = ubuntuDrag;
    Array.from(d.grid.querySelectorAll('.ubuntu-tile')).filter(t => t.style.display !== 'none' && t !== d.tile).forEach(t => {
        const first = prev.get(t);
        if (!first) return;
        const last = t.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (dx || dy) {
            t._ubuntuFlip = t.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
                { duration: 220, easing: 'ease-out' }
            );
            t._ubuntuFlip.onfinish = () => { t._ubuntuFlip = null; };
        }
    });
}

function cancelTileFlips() {
    Array.from(document.querySelectorAll('.ubuntu-tile')).forEach(t => {
        if (t._ubuntuFlip) { t._ubuntuFlip.cancel(); t._ubuntuFlip = null; }
    });
}

function endUbuntuDrag(e) {
    const d = ubuntuDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    finishUbuntuDrag(true);
}

function cancelUbuntuDrag() {
    finishUbuntuDrag(false);
}

function finishUbuntuDrag(saved) {
    const d = ubuntuDrag;
    if (!d) return;
    if (d.active) {
        d.ghost?.remove();
        d.tile.classList.remove('ubuntu-tile-dragging');
        document.body.classList.remove('ubuntu-dragging');
        cancelTileFlips();
        if (saved) saveUbuntuOrder();
        else restoreUbuntuOrder();
        ubuntuDragSuppressClick = true;
        setTimeout(() => { ubuntuDragSuppressClick = false; }, 300);
    }
    ubuntuDrag = null;
}

function restoreUbuntuOrder() {
    const d = ubuntuDrag;
    const order = d.grid.querySelectorAll('.ubuntu-tile');
    if (d.startIndex >= 0 && d.startIndex < order.length) {
        d.grid.insertBefore(d.tile, order[d.startIndex]);
    }
}

/* ===== End Ubuntu Menu ===== */

async function showSection(section) {
    if (!canAccessSection(section)) {
        if (section !== 'sales' && canAccessSection('sales')) {
            showToast('No tienes permisos para esta sección', 'error');
            return showSection('sales');
        }
        return;
    }
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById(`${section}Section`).classList.add('active');

    const titles = {
        sales: 'Ventas',
        products: 'Productos',
        lots: 'Lotes',
inventory: 'Agregar inventario',
        'inventory-history': 'Historial de Movimientos',
        orders: 'Pedidos',
        reports: 'Reportes',
        existencias: 'Existencias',
        cash: 'Caja',
        promotions: 'Promociones',
        import: 'Importar existencias',
        adjustments: 'Ajustes',
        settings: 'Configuración'
    };
    document.getElementById('sectionTitle').textContent = titles[section] || section;

    try {
        switch(section) {
            case 'sales': await refreshSalesData(); focusPosSearch(); break;
            case 'products': await loadProductsTable(); break;
            case 'lots': await loadLots(); break;
            case 'existencias': await loadLotsCut(); break;
            case 'inventory': await loadInventory(); focusInventorySearch(); break;
            case 'inventory-history': await loadInventoryMovementsHistory(); break;
            case 'adjustments': focusAdjustmentsSearch(); break;
            case 'orders': await loadOrdersSection(); break;
            case 'reports': await loadReports(); break;
            case 'cash': await Promise.all([checkCashRegister(), loadCashData(), loadCashHistory(), loadDayCuts(), loadMyShift()]); break;
            case 'promotions': await loadPromotions(); break;
            case 'import': resetImport(); break;
            case 'settings': renderSettingsMenu(); showSettingsMenu(); break;
        }
    } catch (e) {
        console.error('Error loading section', section, e);
    }
}

function focusPosSearch() {
    setTimeout(() => {
        const search = document.getElementById('posSearchInput');
        if (search && document.activeElement !== search) {
            search.focus();
            try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {}
        }
    }, 50);
}

function focusAdjustmentsSearch() {
    setTimeout(() => {
        const search = document.getElementById('adjustmentsSearch');
        if (search && document.activeElement !== search) {
            search.focus();
            try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {}
        }
    }, 50);
}

function setupSalesFocusGuard() {
    document.addEventListener('click', (e) => {
        const salesSection = document.getElementById('salesSection');
        if (!salesSection || !salesSection.classList.contains('active')) return;
        const target = e.target;
        const search = document.getElementById('posSearchInput');
        if (!search) return;
        if (target.closest('input, textarea, select, button, a, [contenteditable], .pos-search-overlay, .payment-overlay, .modal-overlay, .pos-cart-table')) return;
        if (target === search) return;
        focusPosSearch();
    });
}

function setupAdjustmentsFocusGuard() {
    document.addEventListener('click', (e) => {
        const adjSection = document.getElementById('adjustmentsSection');
        if (!adjSection || !adjSection.classList.contains('active')) return;
        const target = e.target;
        const search = document.getElementById('adjustmentsSearch');
        if (!search) return;
        if (target.closest('input, textarea, select, button, a, [contenteditable], .modal-overlay, .adjustments-scan-full')) return;
        if (target === search) return;
        focusAdjustmentsSearch();
    });
}

async function refreshSalesData() {
    await Promise.all([loadProducts(), loadLots(true)]);
}

// Auth
async function logout() {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_permissions');
    shiftGateBlocking = false;
    window.location.href = '/';
}

function getAuthHeaders() {
    return {
        'Authorization': `Bearer ${localStorage.getItem('pos_token')}`,
        'Content-Type': 'application/json'
    };
}

// API Helpers
async function apiCall(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: getAuthHeaders()
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    
    if (!response.ok) {
        if (response.status === 401) {
            logout();
        }
        throw new Error(await response.text());
    }
    
    return response.json();
}

// Load Initial Data
async function loadInitialData() {
    try {
        await Promise.all([
            loadProducts(),
            loadPromotions(),
            loadLots(true)
        ]);
    } catch (error) {
        console.error('Error loading initial data:', error);
    }
    await bootShiftGate();
}

async function bootShiftGate() {
    if (shiftGateInFlight) return;
    shiftGateInFlight = true;
    try {
        // First check for overdue shifts (turnos abiertos del día anterior)
        const overdue = await apiCall('/cash/overdue-shifts').catch(() => null);
        if (overdue?.has_yesterday_open) {
            showOverdueShiftModal(overdue);
            return;
        }
        
        const data = await refreshActiveShift();
        if (!data) {
            showOpenShiftModal({ source: 'login' });
        } else {
            const register = data.register;
            const ownerId = register?.user_id;
            const isOwner = currentUser && ownerId && Number(currentUser.id) === Number(ownerId);
            if (isOwner) {
                continueActiveShift();
            } else {
                const owner = register?.owner || {};
                showShiftCloseConfirm({
                    ownerName: owner.full_name || owner.username || 'Cajero',
                    previousOpenDate: register?.open_date ? new Date(register.open_date).toLocaleString('es-MX') : '—',
                    onConfirm: 'requestCloseAndOpenFromResume',
                    onCancel: 'handleCloseSession'
                });
            }
        }
    } finally {
        shiftGateInFlight = false;
    }
}

async function doCloseShiftAndOpen() {
    const reg = activeShift?.register;
    if (!reg) {
        showToast('No hay turno activo para cerrar', 'error');
        return;
    }
    const closeNotes = document.querySelector('textarea[name="close_notes"]')?.value || '';
    const data = {
        closing: { counted_cash: reg.expected_amount || 0, notes: closeNotes },
        opening: { opening_amount: 0, terminal: '', notes: '' }
    };
    try {
        const result = await apiCall('/cash/close-and-open', 'POST', data);
        showToast(`✓ Turno #${result.closed.id} cerrado y nuevo turno #${result.opened.id} abierto`, 'success');
        await refreshActiveShift();
        shiftGateBlocking = false;
        closeShiftGate({silent:true});
        if (typeof updateCashStatus === 'function') {
            const cur = await apiCall('/cash/current').catch(() => null);
            if (cur) updateCashStatus(cur);
        }
    } catch (error) {
        let msg = 'Error';
        try { msg = JSON.parse(error.message).error || error.message; } catch { msg = error.message; }
        showToast(msg, 'error');
    }
}

function showShiftCloseConfirm({ ownerName, previousOpenDate, onConfirm, onCancel }) {
    const title = document.getElementById('shiftGateTitle');
    const sub = document.getElementById('shiftGateSub');
    const body = document.getElementById('shiftGateBody');
    const foot = document.getElementById('shiftGateFoot');
    const register = activeShift?.register;
    title.textContent = '⚠️ Turno abierto de otro usuario';
    sub.textContent = `El turno #${register?.id || '?'} fue abierto por ${ownerName} ${previousOpenDate ? 'el ' + previousOpenDate : ''}. Debes cerrar este turno para poder operar.`;
    body.innerHTML = `
        <div class="form-group">
            <label>Motivo del cierre</label>
            <textarea name="close_notes" rows="2" placeholder="¿Por qué se cierra el turno anterior?"></textarea>
        </div>
    `;
    const onCancelName = (typeof onCancel === 'string') ? onCancel : 'handleCloseSession';
    const onConfirmName = (typeof onConfirm === 'string') ? onConfirm : 'doCloseShiftAndOpen';
    foot.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="${onCancelName}()">Cerrar sesión</button>
        <button type="button" class="btn btn-primary" onclick="requestCloseAndOpenFromResume()">Cerrar y abrir nuevo</button>
    `;
    openShiftGate();
    shiftGateBlocking = true;
}

function handleCloseSession() {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_permissions');
    shiftGateBlocking = false;
    showToast('Sesión cerrada. Redirigiendo al login...', 'info');
    window.location.href = '/';
}

// Products - nueva tabla
async function loadProducts() {
    try {
        allProducts = await apiCall('/products/');
        products = [...allProducts];
        renderPosCategoryBar();
        renderPosProductsTable();
    } catch (error) {
        showToast('Error al cargar productos', 'error');
    }
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatNumber(n) {
    const num = Number(n || 0);
    return Number.isInteger(num) ? num.toLocaleString('es-MX') : num.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Estado de selección POS
let posSelectedIndex = 0;
let posActiveCategory = null;
let cartSelectedIndex = 0;
let posSearchFilters = { inStockOnly: true, sort: 'name_asc' };

// Render virtualizado del overlay de búsqueda: solo se pintan unas pocas
// cards alrededor de la selección (el array filtrado completo sigue operativo).
const POS_RESULT_WINDOW = 60;
let posRenderStart = 0;
let posRenderTimer = null;

function schedulePosSearchRender() {
    if (posRenderTimer) clearTimeout(posRenderTimer);
    posRenderTimer = setTimeout(() => {
        posRenderTimer = null;
        doPosSearchRender();
    }, 50);
}

function cancelPosSearchRender() {
    if (posRenderTimer) {
        clearTimeout(posRenderTimer);
        posRenderTimer = null;
    }
}

function doPosSearchRender() {
    renderPosProductsTable();
    showSearchResults();
    updateSearchCounter();
}

function getProductSearchKey(p) {
    if (p._searchKey === undefined) {
        p._searchKey = ((p.name || '') + '\u0000' + (p.barcode || '')).toLowerCase();
    }
    return p._searchKey;
}

function getFilteredProducts() {
    const query = (document.getElementById('posSearchInput')?.value || '').toLowerCase();
    if (!query && !posActiveCategory && !posSearchFilters.inStockOnly && posSearchFilters.sort === 'name_asc') return [...products];
    const filtered = products.filter(p => {
        const matchSearch = !query || getProductSearchKey(p).includes(query);
        const matchCat = !posActiveCategory || p.category_id === posActiveCategory;
        const matchStock = !posSearchFilters.inStockOnly || getAvailableStock(p.id) > 0;
        return matchSearch && matchCat && matchStock;
    });
    const sort = posSearchFilters.sort;
    return filtered.slice().sort((a, b) => {
        switch (sort) {
            case 'stock_desc': {
                const da = Number(a.effective_stock) || 0;
                const db = Number(b.effective_stock) || 0;
                if (db !== da) return db - da;
                return a.name.localeCompare(b.name, 'es');
            }
            case 'stock_asc': {
                const da = Number(a.effective_stock) || 0;
                const db = Number(b.effective_stock) || 0;
                if (da !== db) return da - db;
                return a.name.localeCompare(b.name, 'es');
            }
            case 'price_asc': {
                const pa = Number(a.price) || 0;
                const pb = Number(b.price) || 0;
                if (pa !== pb) return pa - pb;
                return a.name.localeCompare(b.name, 'es');
            }
            case 'price_desc': {
                const pa = Number(a.price) || 0;
                const pb = Number(b.price) || 0;
                if (pa !== pb) return pb - pa;
                return a.name.localeCompare(b.name, 'es');
            }
            case 'name_asc':
            default:
                return a.name.localeCompare(b.name, 'es');
        }
    });
}

function onPosFilterChange() {
    const inStock = document.getElementById('posFilterInStock');
    const sort = document.getElementById('posFilterSort');
    if (inStock) {
        inStock.checked = true;
        posSearchFilters.inStockOnly = true;
    }
    if (sort) posSearchFilters.sort = sort.value;
    cancelPosSearchRender();
    posSelectedIndex = 0;
    posRenderStart = 0;
    renderPosProductsTable();
    updateSearchCounter();
}

function renderPosCategoryBar() {
    const bar = document.getElementById('posCategoryBar');
    if (!bar) return;
    const cats = {};
    allProducts.forEach(p => {
        if (p.category_name && p.category_id) cats[p.category_id] = p.category_name;
    });
    let html = `<button class="pos-category-btn ${!posActiveCategory ? 'active' : ''}" onclick="setPosCategory(null)">Todos</button>`;
    Object.entries(cats).forEach(([id, name]) => {
        html += `<button class="pos-category-btn ${posActiveCategory == id ? 'active' : ''}" onclick="setPosCategory(${id})">${escapeHtml(name)}</button>`;
    });
    bar.innerHTML = html;
}

function setPosCategory(catId) {
    posActiveCategory = catId;
    cancelPosSearchRender();
    posSelectedIndex = 0;
    posRenderStart = 0;
    renderPosCategoryBar();
    renderPosProductsTable();
}

function onPosSearchChange() {
    posSelectedIndex = 0;
    posRenderStart = 0;
    schedulePosSearchRender();
}

function updateSearchCounter() {
    const search = document.getElementById('posSearchInput');
    if (!search) return;
    const query = search.value.trim();
    if (!query) return;
    const filtered = getFilteredProducts();
    const overlay = document.getElementById('posSearchOverlay');
    if (overlay) {
        const header = overlay.querySelector('.pos-search-overlay-header strong');
        if (header) {
            header.textContent = `Resultados de búsqueda (${filtered.length})`;
        }
    }
}

function showSearchResults() {
    const overlay = document.getElementById('posSearchOverlay');
    const search = document.getElementById('posSearchInput');
    if (!overlay || !search) {
        console.warn('posSearchOverlay or posSearchInput not found');
        return;
    }
    const query = search.value.trim();
    if (query) {
        overlay.classList.add('visible');
        overlay.style.display = 'flex';
    } else {
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
    }
}

function closeSearchResults() {
    const overlay = document.getElementById('posSearchOverlay');
    const search = document.getElementById('posSearchInput');
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
    }
    if (search) {
        search.value = '';
        search.focus();
    }
    posSelectedIndex = 0;
}

let priceCheckProduct = null;

function openPriceChecker() {
    const wrapper = document.getElementById('priceCheckerOverlay');
    if (!wrapper) return;
    priceCheckProduct = null;
    wrapper.classList.add('visible');
    wrapper.style.display = 'flex';
    const input = document.getElementById('priceCheckInput');
    if (input) input.value = '';
    renderPriceCheckEmpty();
    setTimeout(() => {
        const inp = document.getElementById('priceCheckInput');
        if (inp) inp.focus();
    }, 50);
}

function closePriceChecker() {
    const wrapper = document.getElementById('priceCheckerOverlay');
    if (wrapper) {
        wrapper.classList.remove('visible');
        wrapper.style.display = 'none';
    }
    priceCheckProduct = null;
    const search = document.getElementById('posSearchInput');
    if (search) {
        search.focus();
        try { search.select(); } catch {}
    }
}

function renderPriceCheckEmpty() {
    const result = document.getElementById('priceCheckResult');
    if (result) {
        result.innerHTML = '<div class="price-checker-empty">Escanea un código para ver el precio</div>';
    }
}

function renderPriceCheck(product) {
    const result = document.getElementById('priceCheckResult');
    if (!result) return;

    const basePrice = parseFloat(product.price) || 0;
    const productLots = allLots
        .filter(l => l.product_id === product.id && l.current_quantity > 0)
        .sort((a, b) => a.days_left - b.days_left);

    const allPricesSet = new Set();
    allPricesSet.add(basePrice);
    productLots.forEach(l => {
        const lp = l.sale_price && l.sale_price > 0 ? l.sale_price : basePrice;
        allPricesSet.add(lp);
    });
    const availablePrices = Array.from(allPricesSet).sort((a, b) => a - b);

    let lotsHtml = '';
    if (productLots.length > 0 && availablePrices.length > 1) {
        lotsHtml = `<div class="price-checker-result-lots">Precios disponibles: ${availablePrices.map(p => `<span class="pil">$${p.toFixed(2)}</span>`).join('')}</div>`;
    } else if (productLots.length > 0) {
        const hasLotPrice = productLots.some(l => l.sale_price && l.sale_price > 0);
        if (hasLotPrice) {
            lotsHtml = `<div class="price-checker-result-lots">Precio por lote: <span class="pil">$${availablePrices[availablePrices.length - 1].toFixed(2)}</span></div>`;
        }
    }

    result.innerHTML = `
        <div class="price-checker-result-name">${escapeHtml(product.name)}</div>
        <div class="price-checker-result-code">${escapeHtml(product.barcode || '')}</div>
        <div class="price-checker-result-price">$${basePrice.toFixed(2)}</div>
        ${lotsHtml}
    `;
}

function renderPriceCheckNotFound() {
    const result = document.getElementById('priceCheckResult');
    if (result) {
        result.innerHTML = '<div class="price-checker-result-notfound">Código no encontrado</div>';
    }
}

function handlePriceCheckKey(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        closePriceChecker();
        return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const input = document.getElementById('priceCheckInput');
    const code = (input?.value || '').trim();
    if (!code) return;
    if (priceCheckProduct && String(priceCheckProduct.barcode) === String(code)) {
        addToCart(priceCheckProduct.id);
        closePriceChecker();
        showToast('✓ Producto agregado', 'success');
        return;
    }
    const product = allProducts.find(p => String(p.barcode) === String(code));
    if (product) {
        priceCheckProduct = product;
        renderPriceCheck(product);
    } else {
        priceCheckProduct = null;
        renderPriceCheckNotFound();
    }
}

function confirmPriceAdd() {
    if (!priceCheckProduct) {
        showToast('Escanea un código primero', 'warning');
        return;
    }
    addToCart(priceCheckProduct.id);
    closePriceChecker();
    showToast('✓ Producto agregado', 'success');
}

function handlePosKey(e) {
    const search = document.getElementById('posSearchInput');
    const query = search?.value?.trim() || '';

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        cancelPosSearchRender();
        const filtered = getFilteredProducts();
        posSelectedIndex = Math.min(posSelectedIndex + 1, filtered.length - 1);
        renderPosProductsTable();
        scrollToSelected();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cancelPosSearchRender();
        const filtered = getFilteredProducts();
        posSelectedIndex = Math.max(posSelectedIndex - 1, 0);
        renderPosProductsTable();
        scrollToSelected();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!query) {
            return;
        }

        if (looksLikeBarcode(query)) {
            apiCall(`/products/barcode/${encodeURIComponent(query)}`).then(product => {
                addToCart(product.id);
                search.value = '';
                onPosSearchChange();
                search.focus();
            }).catch(() => {
                search.value = '';
                showToast('Código no encontrado', 'error');
                onPosSearchChange();
                search.focus();
            });
        } else {
            const filtered = getFilteredProducts();
            if (filtered.length > 0 && filtered[posSelectedIndex]) {
                addToCart(filtered[posSelectedIndex].id);
                search.value = '';
                posSelectedIndex = 0;
                onPosSearchChange();
                search.focus();
                const modalOpen = document.getElementById('modalOverlay')?.classList.contains('active');
                if (modalOpen) closeModal();
                showToast('✓ Producto agregado', 'success');
            } else {
                openProductSearchModal(query);
            }
        }
    } else if (e.key === 'F10') {
        e.preventDefault();
        openProductSearchModal(query);
    } else if (e.key === 'Delete') {
        if (cart.length === 0) return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            confirmClearCart();
            return;
        }
        if (e.target.id === 'posSearchInput' && query) return;
        e.preventDefault();
        removeFromCart(cartSelectedIndex);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (cart.length > 0 && !query) {
            e.preventDefault();
            if (e.key === 'ArrowLeft') {
                cartSelectedIndex = Math.max(cartSelectedIndex - 1, 0);
            } else {
                cartSelectedIndex = Math.min(cartSelectedIndex + 1, cart.length - 1);
            }
            updateCartSelection();
        }
    } else if (e.key === '+' || e.key === '=') {
        if (cart.length > 0) {
            e.preventDefault();
            const idx = cart.length - 1;
            cartSelectedIndex = idx;
            updateCartItemQty(idx, 1);
            updateCartSelection();
        }
    } else if (e.key === '-' || e.key === '_') {
        if (cart.length > 0) {
            e.preventDefault();
            const idx = cart.length - 1;
            cartSelectedIndex = idx;
            updateCartItemQty(idx, -1);
            updateCartSelection();
        }
    }
}

function updateCartSelection() {
    const rows = document.querySelectorAll('#posCartBody tr');
    rows.forEach((row, i) => row.classList.toggle('selected', i === cartSelectedIndex));
    if (rows[cartSelectedIndex]) {
        rows[cartSelectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function selectCartRow(index) {
    cartSelectedIndex = index;
    updateCartSelection();
}

function looksLikeBarcode(text) {
    if (!text || text.length < 4) return false;
    if (!/^\d+$/.test(text)) return false;
    return true;
}

function openProductSearchModal(prefillQuery) {
    const query = prefillQuery !== undefined ? prefillQuery : (document.getElementById('posSearchInput')?.value || '');

    showModal('Buscar Producto', `
        <div class="form-group">
            <input type="text" id="modalProductSearch" class="form-input" placeholder="Escribe el nombre o código..." value="${escapeHtml(query)}" oninput="filterModalResults()" autofocus>
        </div>
        <div id="modalProductResults" class="modal-product-results">
            ${renderModalProductResults(query)}
        </div>
        <div style="text-align:center;color:#6b7280;font-size:12px;margin-top:8px">↑↓ navegar · Enter seleccionar · Esc cerrar</div>
    `);

    setTimeout(() => {
        const inp = document.getElementById('modalProductSearch');
        if (inp) {
            inp.focus();
            inp.setSelectionRange(inp.value.length, inp.value.length);
            inp.addEventListener('keydown', handleModalSearchKey);
        }
    }, 50);
}

let modalSelectedIndex = 0;

function renderModalProductResults(query) {
    const q = (query || '').toLowerCase();
    let results;
    if (!q) {
        results = [...allProducts].slice(0, 30);
    } else {
        results = allProducts.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.barcode && p.barcode.toLowerCase().includes(q))
        ).slice(0, 30);
    }

    if (results.length === 0) {
        return '<p style="text-align:center;padding:30px;color:#6b7280">Sin resultados</p>';
    }

    return results.map((p, i) => `
        <div class="modal-product-row ${i === 0 ? 'selected' : ''}" onclick="selectModalProduct(${p.id})" data-index="${i}">
            <div class="modal-product-code">${escapeHtml(p.barcode || '-')}</div>
            <div class="modal-product-name">${escapeHtml(p.name)}</div>
            <div class="modal-product-price">$${parseFloat(p.price).toFixed(2)}</div>
        </div>
    `).join('');
}

function filterModalResults() {
    const inp = document.getElementById('modalProductSearch');
    if (!inp) return;
    modalSelectedIndex = 0;
    const container = document.getElementById('modalProductResults');
    if (container) container.innerHTML = renderModalProductResults(inp.value);
}

function handleModalSearchKey(e) {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const rows = document.querySelectorAll('.modal-product-row');
        if (rows.length === 0) return;
        rows[modalSelectedIndex]?.classList.remove('selected');
        modalSelectedIndex = Math.min(modalSelectedIndex + 1, rows.length - 1);
        rows[modalSelectedIndex]?.classList.add('selected');
        rows[modalSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = document.querySelectorAll('.modal-product-row');
        if (rows.length === 0) return;
        rows[modalSelectedIndex]?.classList.remove('selected');
        modalSelectedIndex = Math.max(modalSelectedIndex - 1, 0);
        rows[modalSelectedIndex]?.classList.add('selected');
        rows[modalSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const rows = document.querySelectorAll('.modal-product-row');
        const selected = rows[modalSelectedIndex];
        if (selected) {
            const productId = parseInt(selected.getAttribute('onclick').match(/\d+/)[0]);
            selectModalProduct(productId);
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        document.getElementById('posSearchInput')?.focus();
    }
}

function selectModalProduct(productId) {
    addToCart(productId);
    closeModal();
    const search = document.getElementById('posSearchInput');
    if (search) {
        search.value = '';
        onPosSearchChange();
        search.focus();
    }
    showToast('✓ Producto agregado', 'success');
}

function scrollToSelected() {
    const cards = document.querySelectorAll('#posSearchResultsList .pos-search-card');
    const local = posSelectedIndex - posRenderStart;
    if (cards[local]) {
        cards[local].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function renderPosProductsTable() {
    const list = document.getElementById('posSearchResultsList');
    if (!list) return;
    const filtered = getFilteredProducts();

    if (filtered.length === 0) {
        list.innerHTML = '<div class="pos-search-empty">Sin resultados</div>';
        posRenderStart = 0;
        return;
    }

    const total = filtered.length;
    let start = 0;
    if (total > POS_RESULT_WINDOW) {
        const half = Math.floor(POS_RESULT_WINDOW / 2);
        start = Math.max(0, Math.min(posSelectedIndex - half, total - POS_RESULT_WINDOW));
    }
    posRenderStart = start;
    const end = Math.min(total, start + POS_RESULT_WINDOW);
    const visible = filtered.slice(start, end);

    list.innerHTML = visible.map((p, i) => {
        const idx = start + i;
        const stock = getAvailableStock(p.id);
        const stockClass = stock <= 0 ? 'badge-danger' : 'badge-success';
        const stockLabel = stock <= 0 ? '🔴 0' : `🟢 ${stock}`;
        return `
        <div class="pos-search-card ${idx === posSelectedIndex ? 'selected' : ''}" onclick="selectAndAdd(${p.id})" data-index="${idx}">
            <div class="pos-search-card-code">${escapeHtml(p.barcode || '-')}</div>
            <div class="pos-search-card-info">
                <div class="pos-search-card-name">${escapeHtml(p.name)}</div>
                <div class="pos-search-card-cat">${escapeHtml(p.category_name || 'Sin categoría')}</div>
            </div>
            <div class="pos-search-card-stock"><span class="badge ${stockClass}">${stockLabel}</span></div>
            <div class="pos-search-card-price">$${parseFloat(p.price).toFixed(2)}</div>
        </div>
    `;}).join('');
}

function selectAndAdd(productId) {
    const filtered = getFilteredProducts();
    const idx = filtered.findIndex(p => p.id === productId);
    if (idx >= 0) posSelectedIndex = idx;
    addToCart(productId);
    const search = document.getElementById('posSearchInput');
    if (search) {
        search.value = '';
        search.focus();
    }
    onPosSearchChange();
}

const PRODUCT_LOW_STOCK_THRESHOLD = 5;
let productsTableData = [];
let productsCategoryFilter = '';
let productsSort = { key: 'name', dir: 'asc' };
let productsStockFilter = 'all';
let productsViewMode = localStorage.getItem('pos_products_view') || 'cards';

const PRODUCTS_SEARCH_DEBOUNCE_MS = 60;
let productsSearchTimer = null;

function buildProductSearchKey(p) {
    if (p._searchKey === undefined) {
        p._searchKey = ((p.name || '') + '\u0000' + (p.barcode || '') + '\u0000' + (p.category_name || '')).toLowerCase();
    }
    return p._searchKey;
}

function getProductSearchRows() {
    const q = (document.getElementById('productSearch')?.value || '').toLowerCase().trim();
    const { key, dir } = productsSort;
    const getVal = p => {
        switch (key) {
            case 'name': return p.name || '';
            case 'category': return p.category_name || '';
            case 'barcode': return p.barcode || '';
            default: {
                const v = p[key];
                return typeof v === 'number' ? v : parseFloat(v) || 0;
            }
        }
    };
    const rows = productsTableData.filter(p => {
        const matchCat = !productsCategoryFilter || String(p.category_id) === String(productsCategoryFilter);
        const matchQ = !q || buildProductSearchKey(p).includes(q);
        const stock = Number(p.effective_stock) || 0;
        const matchStock = productsStockFilter === 'all' ||
            (productsStockFilter === 'in_stock' && stock > 0) ||
            (productsStockFilter === 'out_stock' && stock <= 0);
        return matchCat && matchQ && matchStock;
    });
    rows.sort((a, b) => {
        const va = getVal(a);
        const vb = getVal(b);
        const cmp = (typeof va === 'string' || typeof vb === 'string')
            ? String(va).localeCompare(String(vb), 'es')
            : (va - vb);
        return dir === 'asc' ? cmp : -cmp;
    });
    return rows;
}

function scheduleProductsSearchRender() {
    if (productsSearchTimer) clearTimeout(productsSearchTimer);
    productsSearchTimer = setTimeout(() => {
        productsSearchTimer = null;
        renderVisibleProducts();
    }, PRODUCTS_SEARCH_DEBOUNCE_MS);
}

function cancelProductsSearchRender() {
    if (productsSearchTimer) {
        clearTimeout(productsSearchTimer);
        productsSearchTimer = null;
    }
}

function renderVisibleProducts() {
    cancelProductsSearchRender();
    if (productsViewMode === 'table') {
        renderProductsTable();
    } else {
        renderProductsCards();
    }
    updateSortIndicators();
}

function switchProductsView(mode) {
    productsViewMode = mode;
    localStorage.setItem('pos_products_view', mode);
    document.getElementById('viewToggleCards')?.classList.toggle('active', mode === 'cards');
    document.getElementById('viewToggleTable')?.classList.toggle('active', mode === 'table');
    const cardsEl = document.getElementById('productsSubviewCards');
    const tableEl = document.getElementById('productsSubviewTable');
    if (cardsEl) cardsEl.style.display = mode === 'cards' ? 'block' : 'none';
    if (tableEl) tableEl.style.display = mode === 'table' ? 'block' : 'none';
    renderVisibleProducts();
}

function setProductsStockFilter(filter) {
    productsStockFilter = filter;
    document.querySelectorAll('#productsStockChips .inv-chip').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    renderVisibleProducts();
}

const PRODUCTS_CHUNK = 60;
let productsRenderId = 0;

function renderProductsCards() {
    const grid = document.getElementById('productsCardGrid');
    if (!grid) return;
    const rows = getProductSearchRows();

    const count = document.getElementById('productsCount');
    if (count) count.textContent = `${rows.length} ${rows.length === 1 ? 'producto' : 'productos'}`;

    if (!rows.length) {
        grid.innerHTML = `<div class="inv-help"><div class="inv-help-icon"><svg class="icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg></div><p class="inv-help-text">No se encontraron productos</p></div>`;
        return;
    }
    const id = ++productsRenderId;
    const small = rows.length <= PRODUCTS_CHUNK;
    let i = 0;
    const paint = () => {
        if (id !== productsRenderId) return;
        const next = rows.slice(i, i + PRODUCTS_CHUNK);
        if (i === 0) {
            grid.innerHTML = next.map(p => renderProductCard(p, small)).join('');
        } else {
            grid.insertAdjacentHTML('beforeend', next.map(p => renderProductCard(p, false)).join(''));
        }
        i += PRODUCTS_CHUNK;
        if (i < rows.length) {
            setTimeout(paint, 0);
        }
    };
    paint();
}

function renderProductCard(p, reveal) {
    const stock = Number(p.effective_stock) || 0;
    const cost = Number(p.cost) || 0;
    const price = Number(p.price) || 0;
    const marginClass = p.ganancia >= 0 ? 'pos' : 'neg';
    const safeName = escapeJs(p.name);
    const catColor = p.category_color || '#6b7280';
    const extraClass = reveal ? ' reveal' : '';

    return `
        <div class="product-card${extraClass}">
            <div class="product-card-head">
                <div>
                    <div class="product-card-name">${escapeHtml(p.name || '')}</div>
                    ${p.barcode ? `<div class="product-card-barcode">${escapeHtml(p.barcode)}</div>` : ''}
                </div>
            </div>
            <span class="product-card-cat" style="background:${catColor}20;color:${catColor}">${escapeHtml(p.category_name || 'Sin categoría')}</span>
            <div class="product-card-prices">
                <span class="product-card-price">$${price.toFixed(2)}</span>
                ${cost > 0 ? `<span class="product-card-cost">$${cost.toFixed(2)}</span>` : ''}
                <span class="product-card-margin ${marginClass}">${p.ganancia >= 0 ? '+' : '-'}$${Math.abs(p.ganancia).toFixed(2)}</span>
            </div>
            <div class="product-card-stats">
                <div class="product-card-stat">
                    <div class="product-card-stat-label">Stock</div>
                    <div class="product-card-stat-value">${stock.toFixed(0)}</div>
                </div>
                <div class="product-card-stat">
                    <div class="product-card-stat-label">Lotes</div>
                    <div class="product-card-stat-value">${Number(p.lots_count) || 0}</div>
                </div>
            </div>
            <div class="product-card-actions">
                <button class="action-btn-icon" title="Ver lotes" onclick="showProductLots(${p.id}, '${safeName}')">
                        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                    </button>
                    <button class="action-btn-icon" title="Historial" onclick="showProductHistory(${p.id}, '${safeName}')">
                        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M16 13H8M16 17H8M10 9H8"></path></svg>
                    </button>
                <button class="action-btn" onclick="editProduct(${p.id})">Editar</button>
                <button class="action-btn delete" onclick="deleteProduct(${p.id})">Eliminar</button>
            </div>
        </div>`;
}

async function loadProductsTable() {
    try {
        await ensureInventoryLots();
        productsTableData = inventoryData.map(p => {
            const price = parseFloat(p.price) || 0;
            const cost = parseFloat(p.cost) || 0;
            const ganancia = price - cost;
            const margen = price > 0 ? (ganancia / price) * 100 : 0;
            return { ...p, ganancia, margen, _searchKey: ((p.name || '') + '\u0000' + (p.barcode || '') + '\u0000' + (p.category_name || '')).toLowerCase() };
        });
        populateCategoryFilter();
        switchProductsView(productsViewMode);
    } catch (error) {
        showToast('Error al cargar productos', 'error');
    }
}

function escapeJs(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function ensureInventoryLots() {
    try {
        const [inventory, lotsData] = await Promise.all([
            apiCall('/products/inventory'),
            apiCall('/lots/')
        ]);
        const byProduct = {};
        lotsData.forEach(l => {
            if (!byProduct[l.product_id]) byProduct[l.product_id] = [];
            byProduct[l.product_id].push(l);
        });
        inventoryData = inventory.map(p => ({
            ...p,
            stock: p.effective_stock,
            lots: byProduct[p.id] || []
        }));
    } catch (e) {
        console.error('Error cargando lotes para productos', e);
    }
}

function populateCategoryFilter() {
    const sel = document.getElementById('productCategoryFilter');
    if (!sel) return;
    const cats = {};
    productsTableData.forEach(p => {
        if (p.category_id && p.category_name) cats[p.category_id] = p.category_name;
    });
    const current = productsCategoryFilter;
    sel.innerHTML = `<option value="">Todas las categorías</option>` +
        Object.entries(cats).map(([id, name]) =>
            `<option value="${id}">${escapeHtml(name)}</option>`).join('');
    if (current && cats[current]) {
        sel.value = current;
    } else {
        productsCategoryFilter = '';
        sel.value = '';
    }
}

function renderProductsTable() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    const rows = getProductSearchRows();

    const count = document.getElementById('productsCount');
    if (count) count.textContent = `${rows.length} ${rows.length === 1 ? 'producto' : 'productos'}`;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:20px;">No se encontraron productos</td></tr>`;
        return;
    }
    const id = ++productsRenderId;
    let i = 0;
    const paint = () => {
        if (id !== productsRenderId) return;
        const next = rows.slice(i, i + PRODUCTS_CHUNK);
        if (i === 0) {
            tbody.innerHTML = next.map(p => renderProductRow(p)).join('');
        } else {
            tbody.insertAdjacentHTML('beforeend', next.map(p => renderProductRow(p)).join(''));
        }
        i += PRODUCTS_CHUNK;
        if (i < rows.length) {
            setTimeout(paint, 0);
        }
    };
    paint();
}

function renderProductRow(p) {
    const stock = Number(p.effective_stock) || 0;
    let stockClass, stockLabel;
    if (stock <= 0) {
        stockClass = 'badge-danger';
        stockLabel = '🔴 Agotado';
    } else if (stock < PRODUCT_LOW_STOCK_THRESHOLD) {
        stockClass = 'badge-warning';
        stockLabel = `🟡 Stock bajo (${stock})`;
    } else {
        stockClass = 'badge-success';
        stockLabel = `🟢 En stock (${stock})`;
    }

    const hasLots = Number(p.lots_count) > 0;
    const lotsLabel = hasLots
        ? `<span class="badge badge-info">${p.lots_count} lote${p.lots_count > 1 ? 's' : ''}</span>`
        : '<span style="color:#9ca3af">—</span>';

    const gainClass = p.ganancia >= 0 ? 'gain-pos' : 'gain-neg';
    const gainLabel = (p.ganancia >= 0 ? '+' : '-') + '$' + Math.abs(p.ganancia).toFixed(2);

    const safeName = escapeJs(p.name);

    return `
        <tr>
            <td class="code-cell">${p.barcode || '<span style="color:#9ca3af">—</span>'}</td>
            <td class="name-cell"><strong>${escapeHtml(p.name)}</strong></td>
            <td><span class="badge" style="background: ${p.category_color || '#6b7280'}20; color: ${p.category_color || '#6b7280'}">${escapeHtml(p.category_name || 'Sin categoría')}</span></td>
            <td class="num">$${p.cost.toFixed(2)}</td>
            <td class="num"><strong>$${parseFloat(p.price).toFixed(2)}</strong></td>
            <td class="num"><span class="gain ${gainClass}" title="Margen: ${p.margen.toFixed(1)}%">${gainLabel}</span></td>
            <td class="num">${lotsLabel}</td>
            <td class="num"><span class="badge ${stockClass}">${stockLabel}</span></td>
            <td>
                <div class="products-actions">
                    <button class="action-btn-icon" title="Ver lotes" onclick="showProductLots(${p.id}, '${safeName}')">
                        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                    </button>
                    <button class="action-btn-icon" title="Historial" onclick="showProductHistory(${p.id}, '${safeName}')">
                        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M16 13H8M16 17H8M10 9H8"></path></svg>
                    </button>
                    <button class="action-btn" onclick="editProduct(${p.id})">Editar</button>
                    <button class="action-btn delete" onclick="deleteProduct(${p.id})">Eliminar</button>
                </div>
            </td>
        </tr>`;
}

function searchProducts() {
    scheduleProductsSearchRender();
}

function filterProductsByCategory() {
    const sel = document.getElementById('productCategoryFilter');
    productsCategoryFilter = sel ? sel.value : '';
    renderVisibleProducts();
}

function sortProducts(key) {
    if (productsSort.key === key) {
        productsSort.dir = productsSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        productsSort = { key, dir: 'asc' };
    }
    renderVisibleProducts();
}

function updateSortIndicators() {
    document.querySelectorAll('#productsTable thead th[data-sort]').forEach(th => {
        const ind = th.querySelector('.sort-ind');
        if (!ind) return;
        ind.textContent = (th.dataset.sort === productsSort.key)
            ? (productsSort.dir === 'asc' ? ' ▲' : ' ▼')
            : '';
    });
}

function getVisibleProductsForExport() {
    const q = (document.getElementById('productSearch')?.value || '').toLowerCase().trim();
    const rows = productsTableData.filter(p => {
        const matchCat = !productsCategoryFilter || String(p.category_id) === String(productsCategoryFilter);
        const matchQ = !q ||
            (p.name || '').toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q) ||
            (p.category_name || '').toLowerCase().includes(q);
        return matchCat && matchQ;
    });
    const { key, dir } = productsSort;
    const getVal = p => {
        if (key === 'name') return p.name || '';
        if (key === 'category') return p.category_name || '';
        if (key === 'barcode') return p.barcode || '';
        const value = p[key];
        return typeof value === 'number' ? value : parseFloat(value) || 0;
    };
    return rows.sort((a, b) => {
        const va = getVal(a);
        const vb = getVal(b);
        const comparison = (typeof va === 'string' || typeof vb === 'string')
            ? String(va).localeCompare(String(vb), 'es')
            : va - vb;
        return dir === 'asc' ? comparison : -comparison;
    });
}

function csvValue(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportProductsCsv() {
    const rows = getVisibleProductsForExport();
    if (!rows.length) {
        showToast('No hay productos para exportar', 'warning');
        return;
    }
    const headers = ['Código', 'Producto', 'Categoría', 'Costo', 'Precio', 'Ganancia', 'Margen %', 'Lotes', 'Existencias', 'Estado'];
    const data = rows.map(p => [
        p.barcode || '',
        p.name || '',
        p.category_name || 'Sin categoría',
        Number(p.cost || 0).toFixed(2),
        Number(p.price || 0).toFixed(2),
        Number(p.ganancia || 0).toFixed(2),
        Number(p.margen || 0).toFixed(1),
        Number(p.lots_count || 0),
        Number(p.effective_stock || 0),
        p.active ? 'Activo' : 'Inactivo'
    ]);
    const csv = '\ufeff' + [headers, ...data].map(row => row.map(csvValue).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `catalogo-productos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${rows.length} productos exportados a Excel/CSV`, 'success');
}

function exportProductsPdf() {
    const rows = getVisibleProductsForExport();
    if (!rows.length) {
        showToast('No hay productos para exportar', 'warning');
        return;
    }
    const category = document.getElementById('productCategoryFilter')?.selectedOptions[0]?.textContent || 'Todas las categorías';
    const date = new Date().toLocaleDateString('es-MX');
    const tableRows = rows.map(p => `
        <tr>
            <td>${escapeHtml(p.barcode || '—')}</td>
            <td>${escapeHtml(p.name || '')}</td>
            <td>${escapeHtml(p.category_name || 'Sin categoría')}</td>
            <td class="number">$${Number(p.cost || 0).toFixed(2)}</td>
            <td class="number">$${Number(p.price || 0).toFixed(2)}</td>
            <td class="number">${Number(p.effective_stock || 0)}</td>
        </tr>`).join('');
    const printWindow = window.open('', '_blank', 'width=1100,height=750');
    if (!printWindow) {
        showToast('Permite las ventanas emergentes para generar el PDF', 'warning');
        return;
    }
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Catálogo de productos</title>
        <style>
            @page { size: landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
            h1 { font-size: 22px; margin: 0 0 5px; }
            .meta { color: #4b5563; font-size: 12px; margin-bottom: 16px; }
            table { border-collapse: collapse; width: 100%; font-size: 11px; }
            th { background: #f3f4f6; font-weight: 700; }
            th, td { border: 1px solid #d1d5db; padding: 6px 7px; text-align: left; }
            .number { text-align: right; }
            tr { page-break-inside: avoid; }
        </style></head><body>
        <h1>Catálogo de productos</h1>
        <div class="meta">Fecha: ${date} · Categoría: ${escapeHtml(category)} · Productos: ${rows.length}</div>
        <table><thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Costo</th><th>Precio</th><th>Existencias</th></tr></thead><tbody>${tableRows}</tbody></table>
        <script>window.onload = function () { window.print(); };</script></body></html>`);
    printWindow.document.close();
}

function goToCategories() {
    showSection('settings').then(() => showSettingsTab('categories'));
}

/* ===== Sub-vistas Inventario ===== */
let currentInvSubview = 'cards';

let inventoryData = [];
let invFilter = 'all';
let invDetailProductId = null;
let invSearchRenderTimer = null;

function inventoryRenderDebounce() {
    const v = document.getElementById('inventorySearch')?.value || '';
    return looksLikeBarcode(v.trim()) ? 250 : 60;
}

async function loadReports() {
    defaultSalesRange();
    await loadSalesReport();
}

let salesReportRaw = null;
let salesPeriodLabel = '';

function todayLocalStr() {
    return localDateStr(new Date());
}

function defaultSalesRange() {
    const from = document.getElementById('salesDateFrom');
    const to = document.getElementById('salesDateTo');
    if (from) from.value = todayLocalStr();
    if (to) to.value = todayLocalStr();
}

function setSalesRange(kind) {
    const end = new Date();
    let start = new Date(end);
    if (kind === 'yesterday') start.setDate(start.getDate() - 1);
    else if (kind === 'week') start.setDate(start.getDate() - 6);
    else if (kind === 'month') start.setDate(1);
    document.getElementById('salesDateFrom').value = localDateStr(start);
    document.getElementById('salesDateTo').value = localDateStr(end);
    applySalesReport();
}

function setSalesWeek() {
    const end = new Date();
    const dow = end.getDay(); // 0=domingo
    const start = new Date(end);
    start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1)); // lunes
    document.getElementById('salesDateFrom').value = localDateStr(start);
    document.getElementById('salesDateTo').value = localDateStr(end);
    applySalesReport();
}

function setSalesMonth() {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    document.getElementById('salesDateFrom').value = localDateStr(start);
    document.getElementById('salesDateTo').value = localDateStr(end);
    applySalesReport();
}

function setSalesLastMonth() {
    const end = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
    const start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
    document.getElementById('salesDateFrom').value = localDateStr(start);
    document.getElementById('salesDateTo').value = localDateStr(end);
    applySalesReport();
}

function setSalesYear() {
    const end = new Date();
    const start = new Date(end.getFullYear(), 0, 1);
    document.getElementById('salesDateFrom').value = localDateStr(start);
    document.getElementById('salesDateTo').value = localDateStr(end);
    applySalesReport();
}

function applySalesReport() {
    loadSalesReport();
}

async function loadSalesReport() {
    const from = document.getElementById('salesDateFrom').value || todayLocalStr();
    const to = document.getElementById('salesDateTo').value || todayLocalStr();
    salesPeriodLabel = `${from} al ${to}`;
    try {
        const data = await apiCall(`/reports/sales?date_from=${from}&date_to=${to}`);
        salesReportRaw = data;
        renderSalesReport(data);
    } catch (e) {
        console.error('Error cargando reporte de ventas', e);
    }
}

function renderSalesReport(data) {
    const s = data.summary || {};
    document.getElementById('rpSalesAmount').textContent = '$' + Number(s.total || 0).toFixed(2);
    document.getElementById('rpSalesCount').textContent = `${s.sales || 0} ventas`;
    document.getElementById('rpAvgTicket').textContent = '$' + Number(s.avg_ticket || 0).toFixed(2);
    document.getElementById('rpMaxTicket').textContent = 'máx $' + Number(s.max_ticket || 0).toFixed(2);
    document.getElementById('rpUnits').textContent = s.units || 0;
    document.getElementById('rpProfit').textContent = '$' + Number(s.profit || 0).toFixed(2);
    document.getElementById('rpMargin').textContent = 'margen ' + Number(s.margin_pct || 0).toFixed(2) + '%';

    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const byDayBody = document.getElementById('rpByDayBody');
    if (!data.by_day || !data.by_day.length) {
        byDayBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px">Sin ventas en el periodo</td></tr>';
    } else {
        byDayBody.innerHTML = data.by_day.map(d => {
            const dt = new Date(d.day + 'T00:00:00');
            const name = dayNames[dt.getDay() === 0 ? 6 : dt.getDay() - 1];
            return `<tr>
                <td><strong>${name}</strong></td>
                <td>${d.day}</td>
                <td>${d.sales}</td>
                <td>$${Number(d.total || 0).toFixed(2)}</td>
            </tr>`;
        }).join('');
    }

    const deptSalesBody = document.getElementById('rpByDeptSalesBody');
    if (!data.by_department || !data.by_department.length) {
        deptSalesBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px">Sin ventas en el periodo</td></tr>';
    } else {
        deptSalesBody.innerHTML = data.by_department.map(d => `
            <tr>
                <td>${escapeHtml(d.department || '—')}</td>
                <td>${d.sales || 0}</td>
                <td>${d.units || 0}</td>
                <td>$${Number(d.revenue || 0).toFixed(2)}</td>
                <td style="font-weight:600;color:${(d.profit || 0) >= 0 ? '#1d4ed8' : '#dc2626'}">$${Number(d.profit || 0).toFixed(2)}</td>
            </tr>`).join('');
    }

    const deptProfitBody = document.getElementById('rpByDeptProfitBody');
    if (!data.by_department || !data.by_department.length) {
        deptProfitBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px">Sin datos en el periodo</td></tr>';
    } else {
        deptProfitBody.innerHTML = data.by_department.map(d => `
            <tr>
                <td>${escapeHtml(d.department || '—')}</td>
                <td>$${Number(d.revenue || 0).toFixed(2)}</td>
                <td>$${Number(d.cost || 0).toFixed(2)}</td>
                <td style="font-weight:700;color:${(d.profit || 0) >= 0 ? '#1d4ed8' : '#dc2626'}">$${Number(d.profit || 0).toFixed(2)}</td>
            </tr>`).join('');
    }

    const payNames = { cash: '💵 Efectivo', card: '💳 Tarjeta', mixed: '🔀 Mixto' };
    const payBody = document.getElementById('rpPaymentsBody');
    if (!data.payments || !data.payments.length) {
        payBody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px">Sin ventas en el periodo</td></tr>';
    } else {
        payBody.innerHTML = data.payments.map(p => `
            <tr>
                <td>${payNames[p.payment_method] || escapeHtml(p.payment_method)}</td>
                <td>${p.count}</td>
                <td>$${Number(p.amount || 0).toFixed(2)}</td>
            </tr>`).join('');
    }

    const cashBody = document.getElementById('rpCashiersBody');
    if (!data.cashiers || !data.cashiers.length) {
        cashBody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px">Sin ventas en el periodo</td></tr>';
    } else {
        cashBody.innerHTML = data.cashiers.map(c => `
            <tr>
                <td>${escapeHtml(c.cashier_name)}</td>
                <td>${c.sales}</td>
                <td>$${Number(c.amount || 0).toFixed(2)}</td>
            </tr>`).join('');
    }

    const topBody = document.getElementById('rpTopProductsBody');
    if (!data.top_products || !data.top_products.length) {
        topBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px">Sin ventas en el periodo</td></tr>';
    } else {
        topBody.innerHTML = data.top_products.map((p, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.category_name || '—')}</td>
                <td>${Number(p.quantity || 0).toFixed(0)}</td>
                <td>$${Number(p.revenue || 0).toFixed(2)}</td>
                <td>$${Number(p.cost || 0).toFixed(2)}</td>
                <td style="font-weight:600">$${Number(p.profit || 0).toFixed(2)}</td>
            </tr>`).join('');
    }
}

function exportSalesCsv() {
    if (!salesReportRaw) {
        showToast('Carga el reporte antes de exportar', 'warning');
        return;
    }
    const s = salesReportRaw.summary || {};
    const lines = [];
    lines.push('REPORTE DE VENTAS');
    lines.push(`Periodo: ${salesPeriodLabel}`);
    lines.push('');
    lines.push('RESUMEN');
    lines.push(`Ventas,${s.sales || 0}`);
    lines.push(`Monto,${Number(s.total || 0).toFixed(2)}`);
    lines.push(`Ticket promedio,${Number(s.avg_ticket || 0).toFixed(2)}`);
    lines.push(`Ticket maximo,${Number(s.max_ticket || 0).toFixed(2)}`);
    lines.push(`Unidades,${s.units || 0}`);
    lines.push(`Utilidad bruta,${Number(s.profit || 0).toFixed(2)}`);
    lines.push('');
    lines.push('POR METODO DE PAGO');
    lines.push([csvValue('Metodo'), csvValue('Ventas'), csvValue('Monto')].join(','));
    (salesReportRaw.payments || []).forEach(p =>
        lines.push([csvValue(p.payment_method), csvValue(p.count), csvValue(Number(p.amount || 0).toFixed(2))].join(',')));
    lines.push('');
    lines.push('POR CAJERO');
    lines.push([csvValue('Cajero'), csvValue('Ventas'), csvValue('Monto')].join(','));
    (salesReportRaw.cashiers || []).forEach(c =>
        lines.push([csvValue(c.cashier_name), csvValue(c.sales), csvValue(Number(c.amount || 0).toFixed(2))].join(',')));
    lines.push('');
    lines.push('TOP PRODUCTOS');
    lines.push([csvValue('Producto'), csvValue('Unidades'), csvValue('Ingresos'), csvValue('Costo'), csvValue('Utilidad')].join(','));
    (salesReportRaw.top_products || []).forEach(p =>
        lines.push([csvValue(p.name), csvValue(Number(p.quantity || 0).toFixed(0)), csvValue(Number(p.revenue || 0).toFixed(2)), csvValue(Number(p.cost || 0).toFixed(2)), csvValue(Number(p.profit || 0).toFixed(2))].join(',')));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte_ventas_${salesPeriodLabel.replace(/\s/g, '_').replace(/ al /g, '_a_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Reporte de ventas CSV descargado', 'success');
}

function exportSalesPdf() {
    if (!salesReportRaw) {
        showToast('Carga el reporte antes de exportar', 'warning');
        return;
    }
    const s = salesReportRaw.summary || {};
    const payNames = { cash: 'Efectivo', card: 'Tarjeta', mixed: 'Mixto' };
    const paymentsRows = (salesReportRaw.payments || []).map(p =>
        `<tr><td>${payNames[p.payment_method] || p.payment_method}</td><td>${p.count}</td><td>$${Number(p.amount || 0).toFixed(2)}</td></tr>`).join('');
    const cashiersRows = (salesReportRaw.cashiers || []).map(c =>
        `<tr><td>${escapeHtml(c.cashier_name)}</td><td>${c.sales}</td><td>$${Number(c.amount || 0).toFixed(2)}</td></tr>`).join('');
    const topRows = (salesReportRaw.top_products || []).map((p, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${Number(p.quantity || 0).toFixed(0)}</td><td>$${Number(p.revenue || 0).toFixed(2)}</td><td>$${Number(p.profit || 0).toFixed(2)}</td></tr>`).join('');
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
        showToast('Permite las ventanas emergentes para generar el PDF', 'warning');
        return;
    }
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de ventas</title>
        <style>
            @page { size: portrait; margin: 14mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
            h1 { font-size: 24px; text-align: center; margin: 0 0 6px; letter-spacing: 2px; }
            .meta { text-align: center; color: #4b5563; font-size: 12px; margin-bottom: 20px; }
            .cards { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
            .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 130px; }
            .card .lab { font-size: 11px; color: #6b7280; }
            .card .val { font-size: 18px; font-weight: 700; }
            table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 18px; }
            th { background: #f3f4f6; font-weight: 700; }
            th, td { border: 1px solid #d1d5db; padding: 6px 9px; text-align: left; }
            .num { text-align: right; }
            tr { page-break-inside: avoid; }
            h2 { font-size: 14px; margin: 18px 0 6px; }
        </style></head><body>
        <h1>REPORTE DE VENTAS</h1>
        <div class="meta">Periodo: ${escapeHtml(salesPeriodLabel)} · Generado por POS EXPENDIO BB</div>
        <div class="cards">
            <div class="card"><div class="lab">Ventas</div><div class="val">${s.sales || 0}</div></div>
            <div class="card"><div class="lab">Monto</div><div class="val">$${Number(s.total || 0).toFixed(2)}</div></div>
            <div class="card"><div class="lab">Ticket promedio</div><div class="val">$${Number(s.avg_ticket || 0).toFixed(2)}</div></div>
            <div class="card"><div class="lab">Unidades</div><div class="val">${s.units || 0}</div></div>
            <div class="card"><div class="lab">Utilidad bruta</div><div class="val">$${Number(s.profit || 0).toFixed(2)}</div></div>
        </div>
        <h2>Por método de pago</h2>
        <table><thead><tr><th>Método</th><th>Ventas</th><th>Monto</th></tr></thead><tbody>${paymentsRows}</tbody></table>
        <h2>Por cajero</h2>
        <table><thead><tr><th>Cajero</th><th>Ventas</th><th>Monto</th></tr></thead><tbody>${cashiersRows}</tbody></table>
        <h2>Top productos</h2>
        <table><thead><tr><th>#</th><th>Producto</th><th>Unidades</th><th>Ingresos</th><th>Utilidad</th></tr></thead><tbody>${topRows}</tbody></table>
        <script>window.onload = function () { window.print(); };</script></body></html>`);
    printWindow.document.close();
}

function daysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr + 'T00:00:00');
    return Math.round((d - today) / 86400000);
}

async function loadInventoryReport() {
    try {
        const [byCat, lowStock] = await Promise.all([
            apiCall('/reports/value-by-category').catch(() => null),
            apiCall('/reports/low-stock-detail?threshold=10').catch(() => null)
        ]);
        let value = 0, skus = 0;
        const catBody = document.getElementById('rpValueByCatBody');
        if (!byCat || !byCat.length) {
            catBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px">Sin datos</td></tr>';
        } else {
            catBody.innerHTML = byCat.map(c => {
                value += Number(c.value || 0);
                skus += Number(c.product_count || 0);
                return `
                <tr>
                    <td>${escapeHtml(c.category_name)}</td>
                    <td>${c.product_count}</td>
                    <td>${Number(c.total_units || 0).toFixed(0)}</td>
                    <td>$${Number(c.value || 0).toFixed(2)}</td>
                </tr>`;
            }).join('');
        }
        let low = 0, out = 0;
        const lowBody = document.getElementById('rpLowStockBody');
        if (!lowStock || !lowStock.length) {
            lowBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px">Sin productos con stock bajo</td></tr>';
        } else {
            lowBody.innerHTML = lowStock.map(p => {
                const st = Number(p.effective_stock || 0);
                if (st <= 0) out++; else low++;
                return `
                <tr>
                    <td>${escapeHtml(p.name)}</td>
                    <td>${escapeHtml(p.barcode || '—')}</td>
                    <td>${escapeHtml(p.category_name || '—')}</td>
                    <td><span style="color:${st <= 0 ? '#dc2626' : '#ea580c'};font-weight:600">${st.toFixed(0)}</span></td>
                </tr>`;
            }).join('');
        }
        document.getElementById('rpInvValue').textContent = '$' + value.toFixed(2);
        document.getElementById('rpInvSkus').textContent = skus;
        document.getElementById('rpInvLow').textContent = low;
        document.getElementById('rpInvOut').textContent = out;
    } catch (e) {
        console.error('Error cargando reporte de inventario', e);
    }
}

async function loadExpiryReport() {
    try {
        const data = await apiCall('/reports/expiry-alert?days=30');
        const expired = data.expired || [];
        const soon = data.expiring_soon || [];
        let exp7 = 0, exp30 = 0;
        const body = document.getElementById('rpExpiryBody');
        const rows = [...expired, ...soon].map(l => {
            const days = daysUntil(l.expiry_date);
            const qty = Number(l.current_quantity || 0).toFixed(0);
            if (days >= 0) {
                exp30++;
                if (days <= 7) exp7++;
            }
            let badge = '';
            if (days < 0) badge = '<span class="badge badge-danger">CADUCADO</span>';
            else if (days <= 3) badge = '<span class="badge badge-danger">CRÍTICO</span>';
            else if (days <= 7) badge = '<span class="badge badge-warning">PRÓXIMO</span>';
            else badge = '<span class="badge badge-success">OK</span>';
            return `
                <tr>
                    <td>${escapeHtml(l.product_name || '')}</td>
                    <td>${escapeHtml(l.batch_number || '—')}</td>
                    <td>${escapeHtml(l.expiry_date || '—')}</td>
                    <td>${qty}</td>
                    <td>${days < 0 ? Math.abs(days) + ' días atrás' : days + ' días'} ${badge}</td>
                </tr>`;
        }).join('');
        if (!rows) {
            body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px">Sin lotes próximos a caducar</td></tr>';
        } else {
            body.innerHTML = rows;
        }
        document.getElementById('rpExpiredCount').textContent = expired.length;
        document.getElementById('rpExp7Count').textContent = exp7;
        document.getElementById('rpExp30Count').textContent = exp30;
    } catch (e) {
        console.error('Error cargando reporte de caducidad', e);
    }
}

async function loadLossesReport() {
    try {
        const data = await apiCall('/reports/losses-by-product?limit=50').catch(() => null) || [];
        let total = 0;
        const body = document.getElementById('rpLossesBody');
        if (!data.length) {
            body.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px">Sin mermas registradas</td></tr>';
        } else {
            body.innerHTML = data.map(d => {
                total += Number(d.total_loss || 0);
                return `
                <tr>
                    <td>${escapeHtml(d.name || '')}</td>
                    <td>${Number(d.total_units_loss || 0).toFixed(0)}</td>
                    <td style="font-weight:600;color:#dc2626">-$${Number(d.total_loss || 0).toFixed(2)}</td>
                </tr>`;
            }).join('');
        }
        document.getElementById('rpLossTotal').textContent = '$' + total.toFixed(2);
    } catch (e) {
        console.error('Error cargando mermas', e);
    }
}

function showReportTab(tab) {
    const ids = { sales: 'reportSalesTab', inventory: 'reportInventoryTab', expiry: 'reportExpiryTab', losses: 'reportLossesTab' };
    const activators = { sales: 'Ventas', inventory: 'Inventario', expiry: 'Caducidad', losses: 'Mermas' };
    document.querySelectorAll('#reportsSection .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(activators[tab]));
    });
    Object.entries(ids).forEach(([key, id]) => {
        document.getElementById(id).style.display = key === tab ? 'block' : 'none';
    });
    if (tab === 'sales') applySalesReport();
    if (tab === 'inventory') loadInventoryReport();
    if (tab === 'expiry') loadExpiryReport();
    if (tab === 'losses') loadLossesReport();
}

async function loadInventory() {
    try {
        const products = await apiCall('/products/inventory');
        inventoryData = products.map(p => ({
            ...p,
            stock: p.effective_stock,
            lots: []
        }));
        try {
            const lotsData = await apiCall('/lots/');
            const lotsByProduct = {};
            lotsData.forEach(l => {
                if (!lotsByProduct[l.product_id]) lotsByProduct[l.product_id] = [];
                lotsByProduct[l.product_id].push(l);
            });
            inventoryData = inventoryData.map(p => ({
                ...p,
                lots: lotsByProduct[p.id] || []
            }));
        } catch (e) {
            console.warn('No se pudieron cargar lotes', e);
        }
        renderInventoryView();
        focusInventorySearch();
    } catch (error) {
        showToast('Error al cargar inventario', 'error');
    }
}

function setInventoryFilter(filter) {
    invFilter = filter;
    document.querySelectorAll('#invFilterChips .inv-chip').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    renderInventoryView();
}

function onInventorySearchChange() {
    const v = document.getElementById('inventorySearch')?.value || '';
    const clearBtn = document.getElementById('invSearchClear');
    if (clearBtn) clearBtn.style.display = v ? 'block' : 'none';
    clearTimeout(invSearchRenderTimer);
    invSearchRenderTimer = setTimeout(() => renderInventoryView(), inventoryRenderDebounce());
}

function focusInventorySearch() {
    const section = document.getElementById('inventorySection');
    if (section && !section.classList.contains('active')) return;
    const modalActive = document.getElementById('modalOverlay')?.classList?.contains('active');
    const sideOpen = document.querySelector('.inv-side-overlay.open');
    if (modalActive || sideOpen) return;
    const searchEl = document.getElementById('inventorySearch');
    if (searchEl && document.activeElement !== searchEl) {
        setTimeout(() => {
            if (document.activeElement === searchEl) return;
            searchEl.focus();
            try { searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length); } catch {}
        }, 50);
    }
}

function clearInventorySearch() {
    const inp = document.getElementById('inventorySearch');
    if (inp) {
        inp.value = '';
        inp.focus();
    }
    const clearBtn = document.getElementById('invSearchClear');
    if (clearBtn) clearBtn.style.display = 'none';
    renderInventoryView();
}

document.addEventListener('DOMContentLoaded', () => {
    const inp = document.getElementById('inventorySearch');
    if (!inp) return;
    inp.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const v = inp.value.trim();
        if (!v) return;
        e.preventDefault();
        if (!/^\d{4,}$/.test(v)) return;
        clearTimeout(invSearchRenderTimer);
        try {
            const product = await apiCall(`/products/barcode/${encodeURIComponent(v)}`);
            inp.value = '';
            const clearBtn = document.getElementById('invSearchClear');
            if (clearBtn) clearBtn.style.display = 'none';
            showQuickAddStockModal(product);
        } catch (err) {
            let msg = 'Código no encontrado';
            try { msg = JSON.parse(err.message).error || msg; } catch {}
            showToast(msg, 'warning');
            inp.value = '';
            showConfirmDialog({
                title: 'Producto no encontrado',
                message: `El código <strong>${escapeHtml(v)}</strong> no existe en el sistema. ¿Quieres registrarlo como producto nuevo?`,
                icon: `<svg class="icon confirm-dialog-icon-svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path><line x1="8" y1="11" x2="14" y2="11"></line></svg>`,
                confirmIcon: `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>`,
                confirmText: 'Registrarlo',
                cancelText: 'Cancelar',
                onConfirm: () => showAddProductModal(v)
            });
        }
    });
});

function showQuickAddStockModal(product) {
    const today = new Date();
    const defaultExpiry = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const hasLots = product.has_lots;
    const currentCost = Number(product.cost) || 0;
    const currentPrice = Number(product.price) || 0;
    const currentStock = Math.round(Number(product.stock) || 0);

    const genStock = Math.round(Number(product.product_stock != null ? product.product_stock : product.stock) || 0);

    let lotsHtml = '';
    if (hasLots) {
        const sortedLots = (product.lots || []).slice().sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));
        lotsHtml = `
            <div class="form-section-title">📦 ¿Dónde agregar?</div>
            <div class="form-group">
                <select id="quickLotSelect">
                    <option value="">📦 Stock general (${genStock} u.)</option>
                    ${sortedLots.map(l => {
                        const exp = l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('es-MX') : '—';
                        const qty = Math.round(Number(l.current_quantity) || 0);
                        return `<option value="${l.id}">${escapeHtml(l.batch_number || 's/lote')} · ${qty} u. · caduca ${exp}</option>`;
                    }).join('')}
                    <option value="__new__">➕ Crear lote nuevo</option>
                </select>
            </div>
            <div id="quickNewLotFields" style="display:none">
                <div class="form-row">
                    <div class="form-group">
                        <label>Fecha de Caducidad</label>
                        <input type="date" id="quickExpiry" value="${defaultExpiry}">
                    </div>
                    <div class="form-group">
                        <label>Número de Lote (opcional)</label>
                        <input type="text" id="quickBatch" placeholder="LOTE-${Date.now().toString().slice(-6)}">
                    </div>
                </div>
            </div>
        `;
    } else {
        lotsHtml = `<input type="hidden" id="quickLotSelect" value="">`;
    }

    showModal('⚡ Agregado Rápido - ' + escapeHtml(product.name), `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:14px">
            <div style="font-size:14px;color:#92400e"><strong>Producto:</strong> ${escapeHtml(product.name)}</div>
            <div style="font-size:14px;color:#92400e"><strong>Código:</strong> ${escapeHtml(product.barcode || '—')}</div>
            <div style="font-size:14px;color:#92400e"><strong>Stock actual:</strong> <span id="quickCurrentStock">${currentStock}</span> u.</div>
        </div>
        <form id="quickAddForm" onsubmit="submitQuickAddStock(event, ${product.id}, ${hasLots})">
            <div class="form-group">
                <label style="font-size:14px">Cantidad a agregar *</label>
                <input type="number" id="quickQty" name="quantity" min="1" step="1" inputmode="numeric" pattern="[0-9]*" required value="1" style="font-size:20px;text-align:center;font-weight:700">
            </div>
            ${lotsHtml}
            <div class="form-section-title">💲 Actualizar precios (opcional)</div>
            <div class="form-row">
                <div class="form-group">
                    <label>Costo</label>
                    <input type="number" name="cost" min="0" step="0.01" value="${currentCost.toFixed(2)}">
                </div>
                <div class="form-group">
                    <label>Precio venta</label>
                    <input type="number" name="price" min="0" step="0.01" value="${currentPrice.toFixed(2)}">
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:16px">
                <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                <button type="submit" id="quickAddSubmit" class="btn btn-primary" style="flex:1">⚡ Agregar</button>
            </div>
        </form>
    `, {
        enterNav: { primarySelector: '#quickAddSubmit' }
    });

    setTimeout(() => {
        const qtyInp = document.getElementById('quickQty');
        if (qtyInp) {
            qtyInp.focus();
            qtyInp.select();
        }
        const lotSelect = document.getElementById('quickLotSelect');
        if (lotSelect) {
            const toggleNew = () => {
                const nf = document.getElementById('quickNewLotFields');
                if (nf) nf.style.display = lotSelect.value === '__new__' ? 'block' : 'none';
            };
            lotSelect.addEventListener('change', toggleNew);
            toggleNew();
        }
    }, 50);
}

async function submitQuickAddStock(event, productId, hasLots) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = document.getElementById('quickAddSubmit');
    if (submitBtn && submitBtn.disabled) return;

    const qtyRaw = parseFloat(form.quantity.value);
    if (!qtyRaw || qtyRaw <= 0) {
        showToast('Cantidad inválida', 'error');
        return;
    }
    const qty = Math.round(qtyRaw);

    const newCost = form.cost?.value;
    const newPrice = form.price?.value;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.origText = submitBtn.textContent;
        submitBtn.innerHTML = '<span class="spin-inline"></span> Guardando...';
        submitBtn.style.opacity = '0.6';
    }

    try {
        let stockMsg = '';
        const lotSelect = document.getElementById('quickLotSelect');
        const rawVal = lotSelect ? lotSelect.value : '';
        if (hasLots && rawVal) {
            if (rawVal === '__new__') {
                const expiry = document.getElementById('quickExpiry')?.value;
                const batch = document.getElementById('quickBatch')?.value || '';
                await apiCall('/lots/add-stock', 'POST', {
                    product_id: productId,
                    quantity: qty,
                    expiry_date: expiry,
                    batch_number: batch
                });
                stockMsg = `+${qty} u. (nuevo lote ${batch || ''})`;
            } else {
                const selectedLotId = parseInt(rawVal);
                const product = await apiCall(`/products/${productId}`);
                const lot = (product.lots || []).find(l => l.id === selectedLotId);
                if (lot) {
                    const previous = Math.round(Number(lot.current_quantity) || 0);
                    await apiCall('/lots/add-stock', 'POST', {
                        product_id: productId,
                        quantity: qty,
                        lot_id: selectedLotId
                    });
                    stockMsg = `lote ${lot.batch_number || '#'+selectedLotId}: ${previous} → ${previous + qty}`;
                } else {
                    throw new Error('El lote seleccionado ya no existe');
                }
            }
        } else {
            const res = await apiCall(`/products/${productId}/add-stock`, 'POST', {
                quantity: qty,
                notes: rawVal === '__new__' || hasLots ? 'Agregado rápido (stock general)' : 'Agregado rápido (escaneo)'
            });
            stockMsg = `stock general: ${Math.round(Number(res.previous))} → ${Math.round(Number(res.new))}`;
        }

        let priceMsg = '';
        if (newCost !== '' && newCost !== null && newCost !== undefined && newCost !== '') {
            await apiCall(`/products/${productId}`, 'PUT', { cost: parseFloat(newCost) });
            priceMsg += ' costo ✓';
        }
        if (newPrice !== '' && newPrice !== null && newPrice !== undefined && newPrice !== '') {
            await apiCall(`/products/${productId}`, 'PUT', { price: parseFloat(newPrice) });
            priceMsg += ' precio ✓';
        }

        showToast('✓ Guardado: ' + stockMsg + priceMsg, 'success');
        closeModal();
        await Promise.all([loadInventory(), loadLots(true), loadProducts()]);
        await loadInventoryMovementsHistory();

        const inp = document.getElementById('inventorySearch');
        if (inp) {
            inp.value = '';
            inp.focus();
            renderInventoryView();
        }
    } catch (err) {
        let msg = 'Error al agregar stock';
        try { msg = JSON.parse(err.message).error || msg; } catch {}
        showToast(msg, 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtn.dataset.origText || '⚡ Agregar';
            submitBtn.style.opacity = '1';
        }
    }
}

function getInventoryFiltered() {
    const searchEl = document.getElementById('inventorySearch');
    const q = (searchEl?.value || '').trim().toLowerCase();
    const now = new Date();
    const expLimit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return inventoryData.filter(p => {
        const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.toLowerCase().includes(q));
        const stock = Number(p.stock || 0);
        let matchFilter = true;
        if (invFilter === 'in_stock') matchFilter = stock > 0;
        else if (invFilter === 'out_stock') matchFilter = stock <= 0;
        else if (invFilter === 'expiring') {
            matchFilter = (p.lots || []).some(l => {
                if (!l.expiry_date || Number(l.current_quantity) <= 0) return false;
                const exp = new Date(l.expiry_date);
                return exp <= expLimit;
            });
        }
        return matchSearch && matchFilter;
    });
}

function renderInventoryView() {
    const grid = document.getElementById('invCardGrid');
    const help = document.getElementById('invHelp');
    const statBar = document.getElementById('invStatBar');
    if (!grid) return;
    const searchEl = document.getElementById('inventorySearch');
    const hasQuery = (searchEl?.value || '').trim().length > 0 || invFilter !== 'all';
    const filtered = getInventoryFiltered();

    if (!hasQuery) {
        if (help) help.style.display = 'flex';
        if (statBar) statBar.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    if (help) help.style.display = 'none';
    if (statBar) statBar.style.display = 'flex';

    let countOk = 0, countOut = 0, countExp = 0, totalValue = 0;
    const expLimit = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    inventoryData.forEach(p => {
        const s = Number(p.stock || 0);
        if (s > 0) countOk++; else countOut++;
        if ((p.lots || []).some(l => l.expiry_date && new Date(l.expiry_date) <= expLimit && Number(l.current_quantity) > 0)) countExp++;
        totalValue += s * (Number(p.cost) || 0);
    });

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('invStatOk', countOk);
    setEl('invStatOut', countOut);
    setEl('invStatExp', countExp);
    setEl('invStatValue', '$' + totalValue.toFixed(2));

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="inv-empty">No se encontraron productos con esos criterios</div>`;
        return;
    }

    const sorted = filtered.slice().sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
    grid.innerHTML = sorted.map(p => renderInventoryCard(p)).join('');
}

function renderInventoryCard(p) {
    const stock = Number(p.stock || 0);
    const stockClass = stock > 0 ? 'inv-stock-ok' : 'inv-stock-out';
    const stockLabel = stock > 0 ? `🟢 ${stock} en stock` : `🔴 Agotado`;
    const cost = Number(p.cost) || 0;
    const price = Number(p.price) || 0;
    const categoryColor = p.category_color || '#6b7280';
    const safeName = escapeHtml(p.name).replace(/'/g, "\\'");
    const expSoon = (p.lots || []).some(l => l.expiry_date && new Date(l.expiry_date) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && Number(l.current_quantity) > 0);
    const expBadge = expSoon ? `<span class="inv-card-tag inv-tag-warn">⏰ Caduca pronto</span>` : '';
    return `
    <div class="inv-card" onclick="openInventoryDetail(${p.id})">
        <div class="inv-card-top">
            <div class="inv-card-name">${escapeHtml(p.name)}</div>
            <span class="inv-card-cat" style="background:${categoryColor}20;color:${categoryColor}">${escapeHtml(p.category_name || 'Sin categoría')}</span>
        </div>
        <div class="inv-card-barcode">${escapeHtml(p.barcode || '—')}</div>
        <div class="inv-card-prices">
            <div class="inv-price">
                <span class="inv-price-lbl">💲 Costo</span>
                <span class="inv-price-val inv-price-cost">$${cost.toFixed(2)}</span>
            </div>
            <div class="inv-price">
                <span class="inv-price-lbl">💰 Venta</span>
                <span class="inv-price-val inv-price-sale">$${price.toFixed(2)}</span>
            </div>
        </div>
        <div class="inv-card-stock ${stockClass}">${stockLabel}</div>
        <div class="inv-card-tags">${expBadge}</div>
        <div class="inv-card-actions">
            <button class="inv-btn-add" onclick="event.stopPropagation();showAddStockModal(${p.id},'${safeName}')">+ Agregar Stock</button>
            <button class="inv-btn-adjust" onclick="event.stopPropagation();showAdjustProductStockModal(${p.id})">🔧 Ajustar</button>
            <button class="inv-btn-move" onclick="event.stopPropagation();showMoveBetweenLotsModal(${p.id},'${safeName}')">↔️ Mover</button>
        </div>
    </div>`;
}

function openInventoryDetail(productId) {
    const p = inventoryData.find(x => x.id === productId);
    if (!p) return;
    invDetailProductId = productId;
    const panel = document.getElementById('invSidePanel');
    const overlay = document.getElementById('invSideOverlay');
    const title = document.getElementById('invSideTitle');
    const body = document.getElementById('invSideBody');
    if (!panel || !body) return;
    title.textContent = p.name;

    const stock = Number(p.stock || 0);
    const cost = Number(p.cost) || 0;
    const price = Number(p.price) || 0;
    const margin = price - cost;
    const marginPct = price > 0 ? (margin / price * 100) : 0;
    const categoryColor = p.category_color || '#6b7280';
    const safeName = escapeHtml(p.name).replace(/'/g, "\\'");

    const lotsHtml = (p.lots && p.lots.length) ? p.lots.map(l => {
        const qty = Number(l.current_quantity) || 0;
        const exp = l.expiry_date ? new Date(l.expiry_date) : null;
        const days = exp ? Math.round((exp - new Date()) / (24 * 60 * 60 * 1000)) : null;
        let expClass = 'inv-lot-ok';
        let expLabel = exp ? exp.toLocaleDateString('es-MX') : '—';
        if (days !== null) {
            if (days < 0) { expClass = 'inv-lot-expired'; expLabel = `Vencido ${Math.abs(days)}d`; }
            else if (days <= 30) { expClass = 'inv-lot-warn'; expLabel = `${expLabel} (${days}d)`; }
        }
        return `
        <div class="inv-lot-row">
            <div class="inv-lot-l"><strong>${qty}</strong> u.<br><small>${escapeHtml(l.batch_number || 's/lote')}</small></div>
            <div class="inv-lot-r"><span class="${expClass}">${expLabel}</span></div>
        </div>`;
    }).join('') : `<div class="inv-empty" style="padding:12px">Este producto no maneja lotes</div>`;

    body.innerHTML = `
        <div class="inv-side-prices">
            <div class="inv-side-price">
                <span class="inv-side-price-lbl">💲 Costo</span>
                <span class="inv-side-price-val">$${cost.toFixed(2)}</span>
            </div>
            <div class="inv-side-price">
                <span class="inv-side-price-lbl">💰 Venta</span>
                <span class="inv-side-price-val inv-price-sale">$${price.toFixed(2)}</span>
            </div>
            <div class="inv-side-price">
                <span class="inv-side-price-lbl">📈 Margen</span>
                <span class="inv-side-price-val">$${margin.toFixed(2)} (${marginPct.toFixed(1)}%)</span>
            </div>
        </div>
        <div class="inv-side-meta">
            <div><span class="inv-meta-lbl">Stock:</span> <strong>${stock}</strong></div>
            <div><span class="inv-meta-lbl">Categoría:</span> <span class="inv-card-cat" style="background:${categoryColor}20;color:${categoryColor}">${escapeHtml(p.category_name || '—')}</span></div>
            <div><span class="inv-meta-lbl">Código:</span> ${escapeHtml(p.barcode || '—')}</div>
        </div>
        <div class="inv-side-section">
            <h4>📅 Lotes</h4>
            <div class="inv-lot-list">${lotsHtml}</div>
        </div>
        <div class="inv-side-actions">
            <button class="btn btn-primary" onclick="closeInventoryDetail();showAddStockModal(${p.id},'${safeName}')">+ Agregar Stock (y precios)</button>
            <button class="btn btn-secondary" onclick="closeInventoryDetail();showAdjustProductStockModal(${p.id})">🔧 Ajustar stock (poner en 0 o aumentar)</button>
            ${p.has_lots && (p.lots || []).length >= 2 ? `<button class="btn btn-secondary" onclick="closeInventoryDetail();showMoveBetweenLotsModal(${p.id},'${safeName}')">↔️ Mover entre lotes</button>` : ''}
            <button class="btn btn-secondary" onclick="closeInventoryDetail();openProductEdit(${p.id})">✏️ Editar producto</button>
            <button class="btn btn-secondary" onclick="closeInventoryDetail();showProductHistory(${p.id},'${safeName}')">📜 Ver historial</button>
            ${p.has_lots ? `<button class="btn btn-secondary" onclick="closeInventoryDetail();showProductLots(${p.id},'${safeName}')">📋 Ver todos los lotes</button>` : ''}
        </div>
    `;
    panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('inv-panel-open');
}

function closeInventoryDetail() {
    const panel = document.getElementById('invSidePanel');
    const overlay = document.getElementById('invSideOverlay');
    if (panel) {
        if (document.activeElement && panel.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
    }
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('inv-panel-open');
    invDetailProductId = null;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const panel = document.getElementById('invSidePanel');
        if (panel && panel.classList.contains('open')) {
            closeInventoryDetail();
        }
    }
});

function openProductEdit(productId) {
    const p = inventoryData.find(x => x.id === productId);
    if (!p) return;
    products = products.length ? products : [...allProducts];
    if (!products.find(x => x.id === productId)) products.push(p);
    showSection('products');
    if (typeof editProduct === 'function') {
        editProduct(productId);
    } else {
        showToast('Función de edición no disponible', 'error');
    }
}

function showAddStockModal(productId, productName) {
    const product = inventoryData.find(p => p.id === productId);
    const hasLots = product && product.has_lots;
    const currentCost = product ? (Number(product.cost) || 0) : 0;
    const currentPrice = product ? (Number(product.price) || 0) : 0;
    const generalStock = product ? Math.round(Number(product.product_stock != null ? product.product_stock : product.stock) || 0) : 0;

    if (hasLots) {
        const productLots = allLots
            .filter(l => l.product_id === productId)
            .sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));

        const today = new Date();
        const defaultExpiry = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        const expiryStr = defaultExpiry.toISOString().slice(0, 10);

        const lotsHtml = productLots.length === 0
            ? '<p style="font-size:12px;color:#9ca3af;padding:8px;text-align:center">Este producto aún no tiene lotes. Se creará uno nuevo.</p>'
            : `
                <label class="lot-pick-option">
                    <input type="radio" name="lot_choice" value="general" checked>
                    <div class="lot-pick-card">
                        <div>
                            <strong>📦 Stock general (${generalStock} pzas)</strong>
                            <span class="lot-pick-meta">Agrega a la cantidad general del producto, sin lote</span>
                        </div>
                    </div>
                </label>
                <label class="lot-pick-option">
                    <input type="radio" name="lot_choice" value="new">
                    <div class="lot-pick-card">
                        <strong>➕ Crear lote nuevo</strong>
                        <span class="lot-pick-meta">Se creará un lote con la fecha/cantidad indicada</span>
                    </div>
                </label>
                ${productLots.map(l => {
                    const days = l.days_left != null ? l.days_left : null;
                    let badge = '';
                    if (days != null) {
                        if (days < 0) badge = `<span class="badge badge-danger">Vencido ${Math.abs(days)}d</span>`;
                        else if (days <= 7) badge = `<span class="badge badge-warning">${days}d</span>`;
                        else badge = `<span class="badge badge-success">${days}d</span>`;
                    }
                    return `
                    <label class="lot-pick-option">
                        <input type="radio" name="lot_choice" value="${l.id}">
                        <div class="lot-pick-card">
                            <div>
                                <strong>${escapeHtml(l.batch_number || 'Lote #' + l.id)}</strong>
                                <span class="lot-pick-meta">Caduca: ${l.expiry_date || '—'} ${badge}</span>
                                <span class="lot-pick-meta">Stock actual: <strong>${parseFloat(l.current_quantity || 0).toFixed(0)}</strong> pzas</span>
                            </div>
                        </div>
                    </label>`;
                }).join('')}
            `;

        showModal('➕ Agregar Stock - ' + productName, `
            <form id="addStockForm" onsubmit="submitAddStock(event, ${productId})">
                <div class="form-section-title">📦 Elige dónde agregar</div>
                <div class="lot-pick-list">${lotsHtml}</div>

                <div id="addStockQtyFields">
                    <div class="form-group">
                        <label>Cantidad *</label>
                        <input type="number" name="quantity" min="1" step="1" inputmode="numeric" pattern="[0-9]*" required>
                    </div>
                </div>

                <div id="addStockNewFields">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Fecha de Caducidad *</label>
                            <input type="date" name="expiry_date" value="${expiryStr}" required>
                        </div>
                        <div class="form-group">
                            <label>Número de Lote (opcional)</label>
                            <input type="text" name="batch_number" placeholder="LOTE-${Date.now().toString().slice(-6)}">
                        </div>
                    </div>
                </div>

                <div class="form-section-title">💲 Actualizar precios (opcional)</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Costo de compra</label>
                        <input type="number" name="cost" min="0" step="0.01" value="${currentCost.toFixed(2)}">
                    </div>
                    <div class="form-group">
                        <label>Precio de venta</label>
                        <input type="number" name="price" min="0" step="0.01" value="${currentPrice.toFixed(2)}">
                    </div>
                </div>
                <p style="font-size:11px;color:#9ca3af;margin-top:-4px">Si los modificas, se actualizarán en el producto al guardar.</p>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                    <button type="submit" class="btn btn-primary" style="flex:1">💾 Guardar</button>
                </div>
            </form>
        `, {
            enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
        });

        setTimeout(() => {
            const form = document.getElementById('addStockForm');
            if (!form) return;
            const toggle = () => {
                const choice = form.querySelector('input[name="lot_choice"]:checked')?.value;
                const newFields = document.getElementById('addStockNewFields');
                const isNew = choice === 'new' || !choice;
                if (newFields) {
                    newFields.style.display = isNew ? 'block' : 'none';
                    const exp = form.querySelector('input[name="expiry_date"]');
                    if (exp) exp.required = isNew;
                }
            };
            form.querySelectorAll('input[name="lot_choice"]').forEach(r => r.addEventListener('change', toggle));
            toggle();
        }, 30);
    } else {
        showModal('➕ Agregar Stock - ' + productName, `
            <p style="font-size:12px;color:#6b7280;margin-bottom:12px">Este producto no usa lotes. Se agregará al stock general.</p>
            <form id="addStockForm" onsubmit="submitAddDirectStock(event, ${productId})">
                <div class="form-group">
                    <label>Cantidad *</label>
                    <div style="font-size:13px;color:#1d4ed8;font-weight:600;margin-bottom:6px">📦 Stock actual: ${generalStock} pzas</div>
                    <input type="number" name="quantity" min="1" step="1" inputmode="numeric" pattern="[0-9]*" required>
                </div>
                <div class="form-group">
                    <label>Notas (opcional)</label>
                    <input type="text" name="notes" placeholder="Ej: Compra, ajuste, etc.">
                </div>
                <div class="form-section-title">💲 Actualizar precios (opcional)</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Costo de compra</label>
                        <input type="number" name="cost" min="0" step="0.01" value="${currentCost.toFixed(2)}">
                    </div>
                    <div class="form-group">
                        <label>Precio de venta</label>
                        <input type="number" name="price" min="0" step="0.01" value="${currentPrice.toFixed(2)}">
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                    <button type="submit" class="btn btn-primary" style="flex:1">💾 Guardar</button>
                </div>
            </form>
        `, {
            enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
        });
    }
}

async function submitAddStock(event, productId) {
    event.preventDefault();
    const form = event.target;
    const choice = form.querySelector('input[name="lot_choice"]:checked')?.value;
    const qty = Math.round(parseFloat(form.quantity.value));
    const newCost = form.cost?.value;
    const newPrice = form.price?.value;
    let priceUpdated = false, costUpdated = false;
    const updates = [];
    try {
        let msg = '';
        if (choice === 'general') {
            const res = await apiCall(`/products/${productId}/add-stock`, 'POST', {
                quantity: qty,
                notes: 'Agregado a stock general'
            });
            msg = `✓ Stock general: ${res.previous} → ${res.new}`;
            if (newCost !== '' && newCost !== null && newCost !== undefined) {
                await apiCall(`/products/${productId}`, 'PUT', { cost: parseFloat(newCost) });
                costUpdated = true;
            }
            if (newPrice !== '' && newPrice !== null && newPrice !== undefined) {
                await apiCall(`/products/${productId}`, 'PUT', { price: parseFloat(newPrice) });
                priceUpdated = true;
            }
        } else {
            const data = {
                product_id: productId,
                quantity: qty,
                expiry_date: form.expiry_date?.value || null,
                batch_number: form.batch_number?.value || null,
                cost: newCost || null,
                price: newPrice || null
            };
            if (choice && choice !== 'new') data.lot_id = parseInt(choice);
            const result = await apiCall('/lots/add-stock', 'POST', data);
            msg = '✓ ' + result.message;
        }
        closeModal();
        if (costUpdated) updates.push('costo');
        if (priceUpdated) updates.push('precio');
        if (updates.length) msg += ` (precios actualizados: ${updates.join(', ')})`;
        showToast(msg, 'success');
        await Promise.all([loadInventory(), loadLots(true), loadProductsTable(), loadProducts()]);
        if (invDetailProductId === productId) openInventoryDetail(productId);
    } catch (error) {
        let msg = 'Error al agregar stock';
        try { msg = JSON.parse(error.message).error || msg; } catch {}
        showToast(msg, 'error');
    }
}

async function submitAddDirectStock(event, productId) {
    event.preventDefault();
    const form = event.target;
    try {
        const stockRes = await apiCall(`/products/${productId}/add-stock`, 'POST', {
            quantity: Math.round(parseFloat(form.quantity.value)),
            notes: form.notes?.value || ''
        });
        const newCost = form.cost?.value;
        const newPrice = form.price?.value;
        let priceUpdated = false, costUpdated = false;
        if (newCost !== '' && newCost !== null && newCost !== undefined) {
            await apiCall(`/products/${productId}`, 'PUT', { cost: parseFloat(newCost) });
            costUpdated = true;
        }
        if (newPrice !== '' && newPrice !== null && newPrice !== undefined) {
            await apiCall(`/products/${productId}`, 'PUT', { price: parseFloat(newPrice) });
            priceUpdated = true;
        }
        closeModal();
        let msg = `✓ Stock: ${stockRes.previous} → ${stockRes.new}`;
        const updates = [];
        if (costUpdated) updates.push('costo');
        if (priceUpdated) updates.push('precio');
        if (updates.length) msg += ` (precios actualizados: ${updates.join(', ')})`;
        showToast(msg, 'success');
        await Promise.all([loadInventory(), loadProducts()]);
        if (invDetailProductId === productId) openInventoryDetail(productId);
    } catch (error) {
        let msg = 'Error al agregar stock';
        try { msg = JSON.parse(error.message).error || msg; } catch {}
        showToast(msg, 'error');
    }
}

function showAdjustProductStockModal(productId) {
    const p = inventoryData.find(x => x.id === productId);
    if (!p) return;
    const currentStock = Number(p.stock) || 0;
    const hasLots = p.has_lots;
    const safeName = escapeHtml(p.name).replace(/'/g, "\\'");

    if (hasLots) {
        showModal('🔧 Ajustar Stock - ' + p.name, `
            <p style="font-size:12px;color:#6b7280;margin-bottom:12px">Este producto tiene varios lotes. Ajusta la cantidad del lote que necesites.</p>
            <div class="form-group">
                <label>Selecciona el lote a ajustar *</label>
                <select id="adjustLotSelect">
                    ${(p.lots || []).map(l => {
                        const exp = l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('es-MX') : '—';
                        return `<option value="${l.id}">${escapeHtml(l.batch_number || 's/lote')} · ${Number(l.current_quantity)} u. · caduca ${exp}</option>`;
                    }).join('')}
                </select>
            </div>
            <form id="adjustForm" onsubmit="submitAdjustProductStock(event, ${productId}, true)">
                <div class="form-group">
                    <label>Nueva cantidad *</label>
                    <input type="number" name="current_quantity" min="0" step="1" inputmode="numeric" pattern="[0-9]*" required>
                </div>
                <div class="form-group">
                    <label>Razón *</label>
                    <input type="text" name="reason" placeholder="Ej: Conteo físico, merma, corrección..." required>
                </div>
                <div class="form-group">
                    <label>Notas (opcional)</label>
                    <input type="text" name="notes" placeholder="Detalle adicional">
                </div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                    <button type="submit" class="btn btn-primary" style="flex:1">💾 Ajustar</button>
                </div>
            </form>
        `, {
            enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
        });
    } else {
        showModal('🔧 Ajustar Stock - ' + p.name, `
            <p style="font-size:12px;color:#6b7280;margin-bottom:12px">Define la cantidad absoluta de stock para este producto. Se registrará como ajuste con razón.</p>
            <div style="background:#f9fafb;border-radius:8px;padding:10px 12px;margin-bottom:12px">
                <strong>Stock actual:</strong> ${currentStock} unidades
            </div>
            <form id="adjustForm" onsubmit="submitAdjustProductStock(event, ${productId}, false)">
                <div class="form-group">
                    <label>Nueva cantidad *</label>
                    <input type="number" name="current_quantity" min="0" step="1" inputmode="numeric" pattern="[0-9]*" value="${currentStock}" required>
                </div>
                <div class="form-group">
                    <label>Razón *</label>
                    <input type="text" name="reason" placeholder="Ej: Conteo físico, merma, corrección..." required>
                </div>
                <div class="form-group">
                    <label>Notas (opcional)</label>
                    <input type="text" name="notes" placeholder="Detalle adicional">
                </div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                    <button type="submit" class="btn btn-primary" style="flex:1">💾 Ajustar</button>
                </div>
            </form>
        `, {
            enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
        });
    }
}

async function submitAdjustProductStock(event, productId, hasLots) {
    event.preventDefault();
    const form = event.target;
    const reason = form.reason.value.trim();
    const notes = form.notes?.value || '';
    try {
        if (hasLots) {
            const lotId = parseInt(document.getElementById('adjustLotSelect').value);
            if (!lotId) {
                showToast('Selecciona un lote', 'error');
                return;
            }
            const result = await apiCall('/lots/adjust-stock', 'POST', {
                lot_id: lotId,
                current_quantity: Math.round(parseFloat(form.current_quantity.value)),
                reason, notes
            });
            closeModal();
            showToast(`✓ Lote ajustado: ${Math.round(result.previous)} → ${Math.round(result.new)}`, 'success');
        } else {
            const result = await apiCall(`/products/${productId}/adjust-stock`, 'POST', {
                current_quantity: Math.round(parseFloat(form.current_quantity.value)),
                reason, notes
            });
            closeModal();
            const sign = result.diff >= 0 ? '+' : '';
            showToast(`✓ Stock: ${Math.round(result.previous)} → ${Math.round(result.new)} (${sign}${Math.round(result.diff)})`, 'success');
        }
        await Promise.all([loadInventory(), loadLots(true), loadProducts()]);
        if (invDetailProductId === productId) openInventoryDetail(productId);
    } catch (error) {
        let msg = 'Error al ajustar stock';
        try { msg = JSON.parse(error.message).error || msg; } catch {}
        showToast(msg, 'error');
    }
}

/* ===== Vista: Ajustes de Inventario ===== */
let adjustmentsProduct = null;
let adjustmentsLotId = null;
let adjustmentsSearchTimer = null;

function getAdjustmentTarget() {
    if (adjustmentsLotId && adjustmentsProduct) {
        const lot = (adjustmentsProduct.lots || []).find(l => l.id === adjustmentsLotId);
        return lot ? { type: 'lot', lot, current: Number(lot.current_quantity || 0), label: lot.batch_number || `Lote #${lot.id}` } : null;
    }
    return { type: 'product', current: Number(adjustmentsProduct?.stock || 0), label: 'stock general' };
}

function refreshAdjustmentsForm() {
    if (!adjustmentsProduct) return;
    const target = getAdjustmentTarget();
    const currentEl = document.getElementById('adjustmentCurrentQuantity');
    const adjustmentEl = document.getElementById('adjustmentAmount');
    const lotSection = document.getElementById('adjustmentsLotSection');

    if (!currentEl || !adjustmentEl) return;

    if (target) {
        currentEl.textContent = Number.isInteger(target.current) ? target.current : target.current.toFixed(2);
        adjustmentEl.value = '-1';
        if (lotSection) lotSection.style.display = adjustmentsProduct.has_lots ? 'block' : 'none';
    }

    updateAdjustmentPreview();
}

function updateAdjustmentPreview() {
    if (!adjustmentsProduct) return;
    const target = getAdjustmentTarget();
    const currentEl = document.getElementById('adjustmentCurrentQuantity');
    const adjustmentEl = document.getElementById('adjustmentAmount');
    const newQtyEl = document.getElementById('adjustmentNewQuantity');
    const warningEl = document.getElementById('adjustmentWarning');
    const submitBtn = document.getElementById('submitAdjustmentBtn');
    const reasonEl = document.getElementById('adjustmentsReason');

    if (!target || !currentEl || !adjustmentEl || !newQtyEl || !warningEl || !submitBtn) return;

    const current = Number(target.current || 0);
    const raw = adjustmentEl.value.trim();
    const signMatch = raw.match(/^([+-])(\d+(?:\.\d+)?)$/);

    if (!signMatch) {
        newQtyEl.value = '';
        warningEl.style.display = 'block';
        warningEl.innerHTML = '<span style="color:#e74c3c">Ingresa una cantidad con signo (+ o -) para el ajuste.</span>';
        submitBtn.disabled = true;
        return;
    }

    const sign = signMatch[1] === '-' ? -1 : 1;
    const amount = parseFloat(signMatch[2]);
    const adjustment = sign * amount;
    let next = current + adjustment;
    if (next < 0) next = 0;

    newQtyEl.value = Number.isInteger(next) ? next : parseFloat(next.toFixed(2));
    warningEl.style.display = next === 0 && adjustment < 0 ? 'block' : 'none';
    if (next === 0 && adjustment < 0) {
        warningEl.innerHTML = '<span style="color:#e67e22">El stock no puede ser negativo. Se ajustara a 0.</span>';
    } else {
        warningEl.textContent = '';
    }
    const hasReason = reasonEl && reasonEl.value.trim();
    submitBtn.disabled = !hasReason || !Number.isFinite(newQtyEl.valueAsNumber);
}

function adjustAmount(delta) {
    const el = document.getElementById('adjustmentAmount');
    if (!el) return;
    const raw = el.value.trim();
    const match = raw.match(/^([+-])(\d+(?:\.\d+)?)$/);
    let current = 0;
    let sign = '-';
    if (match) {
        sign = match[1];
        current = parseFloat(match[2]);
    }
    let value = sign === '-' ? -current : current;
    value += delta;
    if (value > 0) {
        el.value = '+' + value;
    } else if (value < 0) {
        el.value = '-' + Math.abs(value);
    } else {
        el.value = '+0';
    }
    updateAdjustmentPreview();
    el.focus();
}

function setAdjustmentSign(sign) {
    const el = document.getElementById('adjustmentAmount');
    if (!el) return;
    el.value = sign > 0 ? '+1' : '-1';
    updateAdjustmentPreview();
    el.focus();
}

function onAdjustmentAmountInput() {
    updateAdjustmentPreview();
}

function onAdjustmentNewQuantityInput() {
    const current = Number(document.getElementById('adjustmentCurrentQuantity')?.textContent || 0);
    const newQty = parseFloat(document.getElementById('adjustmentNewQuantity')?.value);
    const adjustmentEl = document.getElementById('adjustmentAmount');
    if (!adjustmentEl || !Number.isFinite(newQty)) return;
    const diff = newQty - current;
    if (diff >= 0) {
        adjustmentEl.value = '+' + diff;
    } else {
        adjustmentEl.value = '' + diff;
    }
    updateAdjustmentPreview();
}

function selectAdjustmentLot(lotId) {
    adjustmentsLotId = lotId;
    document.querySelectorAll('.adjustments-lot-row').forEach(row => row.classList.toggle('selected', Number(row.dataset.lotId) === lotId));
    refreshAdjustmentsForm();
}

function clearAdjustmentsSelection() {
    adjustmentsProduct = null;
    adjustmentsLotId = null;
    const search = document.getElementById('adjustmentsSearch');
    const card = document.getElementById('adjustmentsProductCard');
    const list = document.getElementById('adjustmentsRecentList');
    const clearBtn = document.getElementById('adjustmentsSearchClear');
    if (search) search.value = '';
    if (card) card.style.display = 'none';
    if (list) list.innerHTML = '';
    if (clearBtn) clearBtn.style.display = 'none';
    const amountEl = document.getElementById('adjustmentAmount');
    const newQtyEl = document.getElementById('adjustmentNewQuantity');
    const curEl = document.getElementById('adjustmentCurrentQuantity');
    const warnEl = document.getElementById('adjustmentWarning');
    const submitBtn = document.getElementById('submitAdjustmentBtn');
    if (amountEl) amountEl.value = '-1';
    if (newQtyEl) newQtyEl.value = '';
    if (curEl) curEl.textContent = '--';
    if (warnEl) warnEl.style.display = 'none';
    if (submitBtn) submitBtn.disabled = true;
    EnterNav.deactivate('adjustments');
}

function showAdjustmentProduct(product) {
    adjustmentsProduct = product;
    adjustmentsLotId = null;
    const card = document.getElementById('adjustmentsProductCard');
    if (!card) return;

    const hasLots = product.has_lots && Array.isArray(product.lots) && product.lots.length > 0;
    const curStock = Number(product.effective_stock ?? product.stock ?? 0);

    document.getElementById('adjustmentsProductCode').textContent = product.barcode || `ID ${product.id}`;
    document.getElementById('adjustmentsProductName').textContent = product.name;
    document.getElementById('adjustmentsProductCat').textContent = product.category_name || 'Sin categoria';
    document.getElementById('adjustmentsFieldCode').textContent = product.barcode || '--';
    document.getElementById('adjustmentsFieldDesc').textContent = product.name;
    document.getElementById('adjustmentCurrentQuantity').textContent = Number.isInteger(curStock) ? curStock : curStock.toFixed(2);

    const costEl = document.getElementById('adjustmentsCost');
    const priceEl = document.getElementById('adjustmentsPrice');
    if (costEl) costEl.value = Number(product.cost ?? 0);
    if (priceEl) priceEl.value = Number(product.price ?? 0);

    document.getElementById('adjustmentAmount').value = '-1';
    document.getElementById('adjustmentNewQuantity').value = '';
    document.getElementById('adjustmentWarning').style.display = 'none';
    document.getElementById('submitAdjustmentBtn').disabled = true;

    const lotList = document.getElementById('adjustmentsLotList');
    const lotSection = document.getElementById('adjustmentsLotSection');
    if (lotList && lotSection) {
        if (hasLots) {
            lotSection.style.display = 'block';
            lotList.innerHTML = product.lots.map(l => {
                const qty = Number(l.current_quantity || 0);
                const qtyStr = Number.isInteger(qty) ? qty : qty.toFixed(2);
                let badge = '';
                if (l.is_expired) badge = '<span class="badge badge-danger">Vencido</span>';
                else if (l.days_left != null && l.days_left <= 7) badge = `<span class="badge badge-warning">${l.days_left}d</span>`;
                return `<div class="adjustments-lot-row" data-lot-id="${l.id}" onclick="selectAdjustmentLot(${l.id})">
                    <div>
                        <strong>${escapeHtml(l.batch_number || 's/lote')}</strong>
                        <div class="lot-expiry">${l.expiry_date ? 'Caduca: ' + new Date(l.expiry_date).toLocaleDateString('es-MX') + (l.days_left != null ? ' (' + l.days_left + 'd)' : '') : 'Sin fecha'}</div>
                    </div>
                    <div class="text-right">
                        <strong>${qtyStr}</strong> ${badge}
                    </div>
                </div>`;
            }).join('');
        } else {
            lotSection.style.display = 'none';
        }
    }

    card.style.display = 'block';
    refreshAdjustmentsForm();
    EnterNav.activate({
        scopeKey: 'adjustments',
        container: card,
        primarySelector: '#submitAdjustmentBtn',
        skipSelectors: ['.adjustments-sign-btn', '#submitAdjustmentBtn']
    });

    const recentList = document.getElementById('adjustmentsRecentList');
    if (recentList) {
        const existing = recentList.querySelector(`[data-product-id="${product.id}"]`);
        if (existing) existing.remove();
        const stockStr = Number.isInteger(curStock) ? curStock : curStock.toFixed(2);
        recentList.insertAdjacentHTML('afterbegin', `<div class="adjustments-recent-item" data-product-id="${product.id}" onclick="openAdjustmentProduct(${product.id})">
            <div>
                <div class="rec-name">${escapeHtml(product.name)}</div>
                <div class="rec-code">${escapeHtml(product.barcode || 'ID ' + product.id)}</div>
            </div>
            <div class="rec-stock">${stockStr} u.</div>
        </div>`);
        while (recentList.children.length > 5) recentList.lastElementChild.remove();
    }
}

async function handleAdjustmentSearch() {
    const input = document.getElementById('adjustmentsSearch');
    const query = input ? input.value.trim() : '';
    const clearBtn = document.getElementById('adjustmentsSearchClear');
    if (!query) {
        clearAdjustmentsSelection();
        return;
    }
    if (clearBtn) clearBtn.style.display = 'block';
    try {
        if (looksLikeBarcode(query)) {
            try {
                const product = await apiCall('/products/barcode/' + encodeURIComponent(query));
                showAdjustmentProduct(product);
                showToast('Producto encontrado: ' + product.name, 'success');
                return;
            } catch (e) {
                // sin coincidencia exacta: cae a la búsqueda por texto/prefijo
            }
        }
        const params = new URLSearchParams({ search: query });
        const results = await apiCall('/products?' + params.toString());
        if (!results.length) {
            showToast('No se encontro ningun producto con ese codigo o nombre', 'warning');
            return;
        }
        if (results.length === 1) {
            const product = await apiCall('/adjustments/product/' + results[0].id);
            showAdjustmentProduct(product);
            showToast('Producto encontrado: ' + product.name, 'success');
        } else {
            const list = document.getElementById('adjustmentsRecentList');
            const stockStr = (p) => { const s = Number(p.stock ?? 0); return Number.isInteger(s) ? s : s.toFixed(2); };
            list.innerHTML = results.slice(0, 8).map(p => `<div class="adjustments-recent-item" data-product-id="${p.id}" onclick="openAdjustmentProduct(${p.id})">
                <div>
                    <div class="rec-name">${escapeHtml(p.name)}</div>
                    <div class="rec-code">${escapeHtml(p.barcode || 'ID ' + p.id)}</div>
                </div>
                <div class="rec-stock">${stockStr(p)} u.</div>
            </div>`).join('');
            showToast('Se encontraron ' + results.length + ' productos', 'success');
        }
    } catch (error) {
        let msg = 'Error al buscar producto';
        try { msg = JSON.parse(error.message).error || msg; } catch {}
        showToast(msg, 'error');
    }
}

async function openAdjustmentProduct(productId) {
    try {
        const product = await apiCall('/adjustments/product/' + productId);
        showAdjustmentProduct(product);
    } catch (error) {
        let msg = 'Error al cargar el producto';
        try { msg = JSON.parse(error.message).error || msg; } catch {}
        showToast(msg, 'error');
    }
}

async function submitAdjustment(event) {
    if (event) event.preventDefault();
    if (!adjustmentsProduct) {
        showToast('Selecciona un producto para ajustar', 'warning');
        return;
    }
    const reason = document.getElementById('adjustmentsReason')?.value.trim() || '';
    const newQuantity = parseFloat(document.getElementById('adjustmentNewQuantity').value);
    const adjustment = parseFloat(document.getElementById('adjustmentAmount').value);
    const cost = parseFloat(document.getElementById('adjustmentsCost').value) || 0;
    const price = parseFloat(document.getElementById('adjustmentsPrice').value) || 0;
    const lotId = adjustmentsLotId ? parseInt(adjustmentsLotId) : null;

    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
        showToast('La nueva cantidad debe ser mayor o igual a 0', 'error');
        return;
    }
    if (!Number.isFinite(adjustment)) {
        showToast('Ingresa un ajuste valido (+/- cantidad)', 'error');
        return;
    }
    if (!reason) {
        showToast('Indica el motivo del ajuste', 'warning');
        document.getElementById('adjustmentsReason')?.focus();
        return;
    }
    if (price < 0 || cost < 0) {
        showToast('El precio y el costo no pueden ser negativos', 'error');
        return;
    }

    try {
        const result = await apiCall('/adjustments', 'POST', {
            product_id: adjustmentsProduct.id,
            lot_id: lotId,
            adjustment,
            new_quantity: newQuantity,
            new_cost: cost,
            new_price: price,
            reason
        });
        showToast(result.message, 'success');
        clearAdjustmentsSelection();
        focusAdjustmentsSearch();
    } catch (error) {
        let msg = 'Error al realizar el ajuste';
        try { msg = JSON.parse(error.message).error || msg; } catch {}
        showToast(msg, 'error');
    }
}

function onAdjustmentsSearchInput() {
    const input = document.getElementById('adjustmentsSearch');
    const clearBtn = document.getElementById('adjustmentsSearchClear');
    if (!input) return;
    if (input.value.trim()) {
        if (clearBtn) clearBtn.style.display = 'block';
    } else {
        if (clearBtn) clearBtn.style.display = 'none';
    }
    clearTimeout(adjustmentsSearchTimer);
    const trimmed = input.value.trim();
    if (trimmed.length >= 2) {
        const delay = looksLikeBarcode(trimmed) ? 40 : 300;
        adjustmentsSearchTimer = setTimeout(() => handleAdjustmentSearch(), delay);
    }
}

function clearAdjustmentsSearch() {
    const input = document.getElementById('adjustmentsSearch');
    const clearBtn = document.getElementById('adjustmentsSearchClear');
    clearTimeout(adjustmentsSearchTimer);
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    clearAdjustmentsSelection();
}

function handleAdjustmentsKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(adjustmentsSearchTimer);
        handleAdjustmentSearch();
    } else if (e.key === 'Escape') {
        clearAdjustmentsSelection();
    }
}

function showMoveBetweenLotsModal(productId, productName) {
    const p = inventoryData.find(x => x.id === productId);
    if (!p || !p.has_lots || !p.lots || p.lots.length < 2) {
        showToast('Se necesitan al menos 2 lotes para mover stock', 'warning');
        return;
    }

    const lots = p.lots.map(l => {
        const exp = l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('es-MX') : '—';
        const days = l.days_left != null ? l.days_left : null;
        let badge = '';
        if (days !== null) {
            if (days < 0) badge = `<span class="badge badge-danger">Vencido ${Math.abs(days)}d</span>`;
            else if (days <= 7) badge = `<span class="badge badge-warning">${days}d</span>`;
            else badge = `<span class="badge badge-success">${days}d</span>`;
        }
        return {
            id: l.id,
            label: `${l.batch_number || 's/lote'} · ${Number(l.current_quantity)} u. · caduca ${exp} ${badge}`,
            qty: Number(l.current_quantity) || 0
        };
    });

    showModal('↔️ Mover entre lotes - ' + productName, `
        <p style="font-size:12px;color:#6b7280;margin-bottom:12px">Transfiere piezas de un lote a otro. El lote origen se ajustará (puede quedar en 0) y el destino aumentará.</p>
        <form id="moveLotsForm" onsubmit="submitMoveBetweenLots(event, ${productId})">
            <div class="form-row">
                <div class="form-group">
                    <label>Lote origen (de donde sale) *</label>
                    <select id="moveFromLot" required>
                        ${lots.map(l => `<option value="${l.id}" data-qty="${l.qty}">${l.label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Lote destino (a donde llega) *</label>
                    <select id="moveToLot" required>
                        ${lots.map(l => `<option value="${l.id}" data-qty="${l.qty}">${l.label}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Cantidad a mover *</label>
                <input type="number" id="moveQty" name="quantity" min="1" step="1" inputmode="numeric" pattern="[0-9]*" required>
                <small id="moveHint" style="color:#6b7280;font-size:11px"></small>
            </div>
            <div class="form-group">
                <label>Notas (opcional)</label>
                <input type="text" name="notes" placeholder="Ej: Reorganización, consolidación...">
            </div>
            <div style="display:flex;gap:8px;margin-top:16px">
                <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                <button type="submit" class="btn btn-primary" style="flex:1">↔️ Mover</button>
            </div>
        </form>
    `, {
        enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
    });

    setTimeout(() => {
        const fromSel = document.getElementById('moveFromLot');
        const toSel = document.getElementById('moveToLot');
        const qtyInp = document.getElementById('moveQty');
        const hint = document.getElementById('moveHint');
        if (!fromSel || !toSel || !qtyInp) return;

        const updateHint = () => {
            const fromOpt = fromSel.options[fromSel.selectedIndex];
            const fromQty = parseFloat(fromOpt?.dataset?.qty || 0);
            const qty = parseFloat(qtyInp.value || 0);
            if (!qty) { hint.textContent = `Disponible en origen: ${fromQty} u.`; return; }
            const newFrom = fromQty - qty;
            if (newFrom < 0) {
                hint.innerHTML = `<span style="color:#d71920">⚠️ Excede stock origen (${fromQty} disponibles)</span>`;
            } else if (newFrom === 0) {
                hint.innerHTML = `Origen quedará en <strong>0</strong>, destino sumará <strong>${qty}</strong>`;
            } else {
                hint.innerHTML = `Origen quedará en <strong>${newFrom}</strong>, destino sumará <strong>${qty}</strong>`;
            }
            if (fromSel.value === toSel.value) {
                hint.innerHTML = `<span style="color:#d71920">⚠️ Origen y destino deben ser distintos</span>`;
            }
        };

        fromSel.addEventListener('change', updateHint);
        toSel.addEventListener('change', updateHint);
        qtyInp.addEventListener('input', updateHint);
        updateHint();
    }, 30);
}

async function submitMoveBetweenLots(event, productId) {
    event.preventDefault();
    const form = event.target;
    const fromId = parseInt(document.getElementById('moveFromLot').value);
    const toId = parseInt(document.getElementById('moveToLot').value);
    const qty = Math.round(parseFloat(form.quantity.value));
    const notes = form.notes?.value || '';

    if (fromId === toId) {
        showToast('Origen y destino deben ser distintos', 'error');
        return;
    }
    if (!qty || qty <= 0) {
        showToast('Cantidad inválida', 'error');
        return;
    }

    const product = inventoryData.find(x => x.id === productId);
    const fromLot = product?.lots?.find(l => l.id === fromId);
    const toLot = product?.lots?.find(l => l.id === toId);
    if (!fromLot || !toLot) {
        showToast('Lotes no encontrados', 'error');
        return;
    }

    const fromQty = Number(fromLot.current_quantity) || 0;
    const toQty = Number(toLot.current_quantity) || 0;

    if (qty > fromQty) {
        showToast(`Solo hay ${fromQty} u. en el lote origen`, 'error');
        return;
    }

    try {
        const newFrom = fromQty - qty;
        const newTo = toQty + qty;
        const reason = notes || `Movimiento entre lotes (${fromLot.batch_number || '#'+fromId} → ${toLot.batch_number || '#'+toId})`;

        await apiCall('/lots/adjust-stock', 'POST', {
            lot_id: fromId,
            current_quantity: newFrom,
            reason: 'Movimiento entre lotes (salida)',
            notes
        });
        await apiCall('/lots/adjust-stock', 'POST', {
            lot_id: toId,
            current_quantity: newTo,
            reason: 'Movimiento entre lotes (entrada)',
            notes
        });

        closeModal();
        showToast(`✓ Movido: ${fromLot.batch_number || '#'+fromId} (${fromQty}→${newFrom}) → ${toLot.batch_number || '#'+toId} (${toQty}→${newTo})`, 'success');
        await Promise.all([loadInventory(), loadLots(true), loadProducts()]);
        if (invDetailProductId === productId) openInventoryDetail(productId);
    } catch (error) {
        let msg = 'Error al mover entre lotes';
        try { msg = JSON.parse(error.message).error || msg; } catch {}
        showToast(msg, 'error');
    }
}

function showProductLots(productId, productName) {
    const product = inventoryData.find(p => p.id === productId);
    if (!product || !product.lots || !product.lots.length) {
        showModal('📅 Lotes - ' + productName, `
            <p style="text-align:center;color:#6b7280;padding:8px 0;">Este producto no tiene lotes registrados.</p>
            <div style="text-align:right;margin-top:16px">
                <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
            </div>
        `);
        return;
    }
    const lotsHtml = product.lots.map(l => {
        const expiry = l.expiry_date ? l.expiry_date.slice(0, 10) : 'N/A';
        const days = l.days_left != null ? l.days_left : 'N/A';
        return `<tr>
            <td>${l.batch_number || 'Sin lote'}</td>
            <td>${expiry}</td>
            <td>${days}</td>
            <td>${l.current_quantity}</td>
        </tr>`;
    }).join('');
    showModal('📅 Lotes - ' + productName, `
        <table class="data-table">
            <thead><tr><th>Lote</th><th>Caducidad</th><th>Días</th><th>Cantidad</th></tr></thead>
            <tbody>${lotsHtml}</tbody>
        </table>
        <div style="text-align:right;margin-top:16px">
            <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
        </div>
    `);
}

function getMovementMeta(t) {
    const map = {
        'entry':          { label: 'Ingreso',        color: '#10b981', sign: '+', stock: true, add: true },
        'sale':           { label: 'Venta',          color: '#d71920', sign: '−', stock: true, add: false },
        'return':         { label: 'Devolución',     color: '#4338ca', sign: '+', stock: true, add: true },
        'sale_cancelled': { label: 'Cancelación',    color: '#dc2626', sign: '+', stock: true, add: true },
        'adjustment':     { label: 'Ajuste',         color: '#f59e0b', sign: '=', stock: true, add: 'diff' },
        'adjust':         { label: 'Ajuste',         color: '#f59e0b', sign: '=', stock: true, add: 'diff' },
        'transfer_out':   { label: 'Mov. salida',    color: '#8b5cf6', sign: '−', stock: true, add: false },
        'transfer_in':    { label: 'Mov. entrada',   color: '#3b82f6', sign: '+', stock: true, add: true },
        'product_created':{ label: 'Creación',       color: '#10b981', sign: '+', stock: false },
        'product_updated':{ label: 'Modificación',   color: '#f59e0b', sign: '~', stock: false },
        'price_changed':  { label: 'Precio',         color: '#3b82f6', sign: '$', stock: false },
        'product_deleted':{ label: 'Eliminado',      color: '#d71920', sign: '✕', stock: false },
        'lot_updated':    { label: 'Lote mod.',      color: '#f59e0b', sign: '~', stock: false },
        'lot_deleted':    { label: 'Lote elim.',     color: '#d71920', sign: '✕', stock: false }
    };
    return map[t] || { label: t, color: '#6b7280', sign: '', stock: true, add: true };
}

function computeMovementTotals(movements) {
    // Camina del más reciente al más antiguo anclando el "después" del último
    // movimiento al stock ACTUAL real del producto (products.stock vía allProducts),
    // para que las columnas "Antes/Después" reflejen la realidad, no una suma desde 0.
    const info = {};
    const running = {}; // stock "después" del movimiento actual (real al anclar)
    const ordered = movements.slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    for (const m of ordered) {
        const pid = m.product_id;
        const meta = getMovementMeta(m.movement_type);
        const qty = Number(m.quantity || 0);
        if (running[pid] === undefined) {
            const cur = getProductBaseStock(pid);
            running[pid] = isFinite(cur) ? cur : 0;
        }
        if (!meta.stock) {
            info[m.id] = { before: null, after: null, stock: false };
            continue;
        }
        const after = running[pid];
        const before = after - qty;
        running[pid] = before; // stock antes de este movimiento = stock "después" del anterior(nocturno)
        info[m.id] = { before: before, after: after, stock: true };
    }
    return info;
}

async function loadInventoryMovementsHistory() {
    const daySel = document.getElementById('mhDayFilter');
    if (daySel && !daySel.options.length) populateMHDayFilter();
    const tbody = document.getElementById('inventoryMovementsBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:16px;">Cargando historial...</td></tr>`;
    try {
        const day = getMHDay();
        const type = document.getElementById('mhTypeFilter')?.value || '';
        const q = (document.getElementById('mhSearchInput')?.value || '').trim();
        let url = `/products/movements/recent?limit=500&date_from=${encodeURIComponent(day)}&date_to=${encodeURIComponent(day)}`;
        if (type) url += `&type=${encodeURIComponent(type)}`;
        if (q) url += `&q=${encodeURIComponent(q)}`;
        const res = await apiCall(url);
        const movements = (res && res.movements) || [];
        inventoryMovementsData = movements;
        const countEl = document.getElementById('mhResultsCount');
        if (countEl) countEl.textContent = `${movements.length} movimiento${movements.length === 1 ? '' : 's'}`;
        renderInventoryMovements(movements);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#d71920;padding:16px;">Error al cargar historial</td></tr>`;
    }
}

function populateMHDayFilter() {
    const sel = document.getElementById('mhDayFilter');
    if (!sel) return;
    const now = new Date();
    const parts = [];
    for (let i = 0; i < 14; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const iso = toISODate(d);
        let label;
        if (i === 0) label = `Hoy · ${SH_DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
        else if (i === 1) label = `Ayer · ${SH_DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
        else label = `${SH_DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        parts.push(`<option value="${iso}" ${i === 0 ? 'selected' : ''}>${label}</option>`);
    }
    sel.innerHTML = parts.join('');
}

function getMHDay() {
    const sel = document.getElementById('mhDayFilter');
    return sel && sel.value ? sel.value : todayStr();
}

function filterMovementsHistory() {
    clearTimeout(movementsHistorySearchTimer);
    movementsHistorySearchTimer = setTimeout(loadInventoryMovementsHistory, 250);
}

function getMovementsForExport() {
    return inventoryMovementsData;
}

function movementsExportRow(m) {
    const qty = Number(m.quantity || 0);
    const t = m.movement_type;
    const meta = getMovementMeta(t);
    const date = m.created_at ? new Date(String(m.created_at).replace(' ','T')) : null;
    const dateStr = date && !isNaN(date) ? date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : (m.created_at || '—');
    return {
        dateStr,
        product: m.product_name || '—',
        barcode: m.barcode || '—',
        lot: m.batch_number || (m.lot_id ? '#'+m.lot_id : '—'),
        typeLabel: meta.label,
        typeRaw: t,
        signedQty: meta.stock ? `${meta.sign}${Math.abs(qty).toFixed(2)}` : meta.sign,
        qtyAbs: Math.abs(qty),
        stock: meta.stock,
        actor: m.actor_name || m.actor_username || '—',
        notes: m.notes || ''
    };
}

function exportMovementsCsv() {
    const rows = getMovementsForExport();
    if (!rows.length) {
        showToast('No hay movimientos para exportar', 'warning');
        return;
    }
    const totalsInfo = computeMovementTotals(rows);
    const headers = ['Fecha / Hora', 'Producto', 'Código', 'Lote', 'Tipo', 'Cantidad', 'Antes', 'Después', 'Nota / Usuario'];
    const data = rows.map(m => {
        const r = movementsExportRow(m);
        const ti = totalsInfo[m.id] || { before: null, after: null, stock: false };
        const before = r.stock && ti.before != null ? Number(ti.before).toFixed(2) : '—';
        const after = r.stock && ti.after != null ? Number(ti.after).toFixed(2) : '—';
        return [
            r.dateStr,
            r.product,
            r.barcode,
            r.lot,
            r.typeLabel,
            r.signedQty,
            before,
            after,
            [r.actor, r.notes].filter(Boolean).join(' · ')
        ];
    });
    const csv = '\ufeff' + [headers, ...data].map(row => row.map(csvValue).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `historial-movimientos-${getMHDay()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${rows.length} movimientos exportados a Excel/CSV`, 'success');
}

function exportMovementsPdf() {
    const rows = getMovementsForExport();
    if (!rows.length) {
        showToast('No hay movimientos para exportar', 'warning');
        return;
    }
    const totalsInfo = computeMovementTotals(rows);
    const dayLabel = (document.getElementById('mhDayFilter')?.selectedOptions[0]?.textContent || '') || getMHDay();
    const date = new Date().toLocaleDateString('es-MX');
    const tableRows = rows.map(m => {
        const r = movementsExportRow(m);
        const ti = totalsInfo[m.id] || { before: null, after: null, stock: false };
        const before = r.stock && ti.before != null ? Number(ti.before).toFixed(2) : '—';
        const after = r.stock && ti.after != null ? Number(ti.after).toFixed(2) : '—';
        return `
            <tr>
                <td class="nowrap">${escapeHtml(r.dateStr)}</td>
                <td>${escapeHtml(r.product)}</td>
                <td>${escapeHtml(r.barcode)}</td>
                <td>${escapeHtml(r.lot)}</td>
                <td>${escapeHtml(r.typeLabel)}</td>
                <td class="number">${escapeHtml(r.signedQty)}</td>
                <td class="number">${escapeHtml(before)}</td>
                <td class="number">${escapeHtml(after)}</td>
                <td>${escapeHtml([r.actor, r.notes].filter(Boolean).join(' · '))}</td>
            </tr>`;
    }).join('');
    const printWindow = window.open('', '_blank', 'width=1100,height=750');
    if (!printWindow) {
        showToast('Permite las ventanas emergentes para generar el PDF', 'warning');
        return;
    }
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Historial de movimientos</title>
        <style>
            @page { size: landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
            h1 { font-size: 22px; margin: 0 0 5px; }
            .meta { color: #4b5563; font-size: 12px; margin-bottom: 16px; }
            table { border-collapse: collapse; width: 100%; font-size: 10px; }
            th { background: #f3f4f6; font-weight: 700; }
            th, td { border: 1px solid #d1d5db; padding: 5px 6px; text-align: left; }
            .number { text-align: right; }
            .nowrap { white-space: nowrap; }
            tr { page-break-inside: avoid; }
        </style></head><body>
        <h1>Historial de movimientos de inventario</h1>
        <div class="meta">Fecha de exportación: ${date} · Día: ${escapeHtml(dayLabel)} · Movimientos: ${rows.length}</div>
        <table><thead><tr><th>Fecha / Hora</th><th>Producto</th><th>Código</th><th>Lote</th><th>Tipo</th><th>Cantidad</th><th>Antes</th><th>Después</th><th>Nota / Usuario</th></tr></thead><tbody>${tableRows}</tbody></table>
        <script>window.onload = function () { window.print(); };</script></body></html>`);
    printWindow.document.close();
}

/* ===== Importar existencias por Excel ===== */
let pendingImportItems = [];

async function downloadImportTemplate() {
    try {
        const res = await fetch(`${API_BASE}/imports/template`, {
            method: 'GET',
            headers: getAuthHeaders()
        });
        if (!res.ok) {
            let msg = 'Error al descargar la plantilla';
            try { msg = (await res.json()).error || msg; } catch (_) {}
            throw new Error(msg);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'plantilla_existencias.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function resetImport() {
    pendingImportItems = [];
    const input = document.getElementById('importFileInput');
    if (input) input.value = '';
    const nameEl = document.getElementById('importFileName');
    if (nameEl) nameEl.textContent = 'Ningún archivo seleccionado';
    const wrap = document.getElementById('importPreviewWrap');
    if (wrap) wrap.style.display = 'none';
    const result = document.getElementById('importResult');
    if (result) { result.style.display = 'none'; result.innerHTML = ''; }
}

async function readImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const nameEl = document.getElementById('importFileName');
    if (nameEl) nameEl.textContent = file.name;
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
        showToast('Formato no soportado. Sube un archivo .xlsx o .csv', 'error');
        resetImport();
        return;
    }
    const applyBtn = document.getElementById('importApplyBtn');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Leyendo archivo...'; }
    try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API_BASE}/imports/read`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('pos_token')}` },
            body: fd
        });
        if (!res.ok) {
            let msg = 'Error al leer el archivo';
            try { msg = (await res.json()).error || msg; } catch (_) {}
            throw new Error(msg);
        }
        const data = await res.json();
        renderImportPreview(data);
    } catch (err) {
        showToast(err.message, 'error');
        resetImport();
    } finally {
        if (applyBtn) applyBtn.disabled = false;
    }
}

function renderImportPreview(data) {
    pendingImportItems = data.matches || [];
    const totalUnits = data.total_to_apply || pendingImportItems.reduce((s, m) => s + m.quantity, 0);
    const summary = document.getElementById('importSummary');
    if (summary) {
        summary.innerHTML = `
            <span class="inv-chip active">✓ ${pendingImportItems.length} producto${pendingImportItems.length === 1 ? '' : 's'} encontrado${pendingImportItems.length === 1 ? '' : 's'}</span>
            <span class="inv-chip active" style="font-weight:600">Σ ${totalUnits} piezas a sumar</span>
            ${(data.missing || []).length ? `<span class="inv-chip" style="border-color:#d71920;color:#d71920">⚠ ${data.missing.length} código(s) no encontrado(s)</span>` : ''}
            ${(data.errors || []).length ? `<span class="inv-chip" style="border-color:#f59e0b;color:#b45309">⚠ ${data.errors.length} fila(s) con error</span>` : ''}
        `;
    }
    const tbody = document.getElementById('importTableBody');
    if (tbody) {
        tbody.innerHTML = pendingImportItems.map(m => `
            <tr>
                <td><code style="font-size:11px">${escapeHtml(m.barcode)}</code></td>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td class="num" style="font-weight:700;color:#16a34a">+${m.quantity}</td>
                <td class="num" style="color:#9ca3af">${Number(m.current_stock).toFixed(2)}</td>
                <td class="num" style="font-weight:600">${Number(m.new_stock).toFixed(2)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:16px;">No hay filas válidas para importar</td></tr>';
    }
    const warnings = document.getElementById('importWarnings');
    if (warnings) {
        let html = '';
        if ((data.missing || []).length) {
            html += `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;color:#b91c1c;font-size:12px"><strong>No encontrados (se ignoran, quedan registrados para la app del teléfono):</strong> ${data.missing.map(m => `${escapeHtml(m.name || '(sin nombre)')} · ${escapeHtml(m.barcode)} (${m.quantity})`).join(', ')}</div>`;
        }
        if ((data.errors || []).length) {
            html += `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;color:#92400e;font-size:12px;margin-top:8px"><strong>Filas con error (se ignoran):</strong> ${data.errors.map(e => `fila ${e.row}: ${escapeHtml(e.reason)}`).join(' · ')}</div>`;
        }
        warnings.innerHTML = html;
    }
    document.getElementById('importPreviewWrap').style.display = 'block';
    const result = document.getElementById('importResult');
    if (result) { result.style.display = 'none'; result.innerHTML = ''; }
}

async function applyImport() {
    const items = pendingImportItems;
    if (!items || !items.length) {
        showToast('No hay filas válidas para aplicar', 'error');
        return;
    }
    const applyBtn = document.getElementById('importApplyBtn');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Aplicando...'; }
    try {
        const res = await apiCall('/imports/apply', 'POST', { items });
        const tag = document.getElementById('importResult');
        if (tag) {
            const rows = (res.results || []).map(r =>
                `<tr><td><code style="font-size:11px">${escapeHtml(r.barcode)}</code></td><td>${escapeHtml(r.name)}</td>
                <td class="num" style="font-weight:700;color:#16a34a">+${r.quantity}</td>
                <td class="num" style="color:#9ca3af">${Number(r.previous).toFixed(2)}</td>
                <td class="num" style="font-weight:600">${Number(r.new).toFixed(2)}</td></tr>`
            ).join('');
            const fails = (res.failures || []).map(f => `<div style="color:#b91c1c">• ${escapeHtml(f.barcode || '')}: ${escapeHtml(f.reason)}</div>`).join('');
            tag.style.display = 'block';
            tag.innerHTML = `
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">
                    <strong style="color:#15803d;font-size:15px">✓ ${res.applied} producto${res.applied === 1 ? '' : 's'} con stock actualizado (${res.results.reduce((s, r) => s + r.quantity, 0)} piezas)</strong>
                </div>
                ${fails ? `<div style="margin-top:8px">${fails}</div>` : ''}
                <div class="products-table-container" style="margin-top:12px">
                    <table class="data-table products-table">
                        <thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Antes</th><th class="num">Después</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#6b7280">Sin cambios aplicados</td></tr>'}</tbody>
                    </table>
                </div>
            `;
        }
        showToast('Existencias actualizadas', 'success');
        pendingImportItems = [];
        document.getElementById('importPreviewWrap').style.display = 'none';
        const nameEl = document.getElementById('importFileName');
        if (nameEl) nameEl.textContent = 'Ningún archivo seleccionado';
        const input = document.getElementById('importFileInput');
        if (input) input.value = '';
        await Promise.all([loadInventory(), loadLots(true), loadProducts()]);
        await loadInventoryMovementsHistory();
    } catch (err) {
        let msg = 'Error al aplicar la importación';
        try { msg = JSON.parse(err.message).error || msg; } catch (_) {}
        showToast(msg, 'error');
    } finally {
        if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '✓ Aplicar existencias'; }
    }
}

/* ===== Importar catálogo (POS anterior / CATALOGO.xlsx) ===== */
let pendingCatalogItems = [];

function switchImportTab(tab) {
    const tabBtns = document.querySelectorAll('#importSection .tab-btn');
    tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab || b.textContent.includes(tab === 'exist' ? 'Existencias' : 'Catálogo')));
    document.getElementById('importExistPanel').style.display = tab === 'exist' ? 'block' : 'none';
    document.getElementById('importCatalogPanel').style.display = tab === 'catalog' ? 'block' : 'none';
}

function resetCatalogImport() {
    pendingCatalogItems = [];
    const input = document.getElementById('catalogFileInput');
    if (input) input.value = '';
    const nameEl = document.getElementById('catalogFileName');
    if (nameEl) nameEl.textContent = 'Ningún archivo seleccionado';
    const opts = document.getElementById('catalogOptionsWrap');
    if (opts) opts.style.display = 'none';
    const wrap = document.getElementById('catalogPreviewWrap');
    if (wrap) wrap.style.display = 'none';
    const result = document.getElementById('catalogResult');
    if (result) { result.style.display = 'none'; result.innerHTML = ''; }
}

async function readCatalogFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const nameEl = document.getElementById('catalogFileName');
    if (nameEl) nameEl.textContent = file.name;
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
        showToast('Formato no soportado. Sube un archivo .xlsx o .csv', 'error');
        resetCatalogImport();
        return;
    }
    const applyBtn = document.getElementById('catalogApplyBtn');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Leyendo catálogo...'; }
    try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API_BASE}/imports/catalog/read`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('pos_token')}` },
            body: fd
        });
        if (!res.ok) {
            let msg = 'Error al leer el catálogo';
            try { msg = (await res.json()).error || msg; } catch (_) {}
            throw new Error(msg);
        }
        const data = await res.json();
        renderCatalogPreview(data);
    } catch (err) {
        showToast(err.message, 'error');
        resetCatalogImport();
    } finally {
        if (applyBtn) { applyBtn.disabled = false; }
    }
}

function renderCatalogPreview(data) {
    pendingCatalogItems = data.items || [];
    document.getElementById('catalogOptionsWrap').style.display = 'block';

    const summary = document.getElementById('catalogSummary');
    const deptoNuevos = (data.departments || []).filter(d => !d.exists).length;
    const conflicts = data.conflicts || [];
    const totalStock = data.stock_total || 0;
    if (summary) {
        summary.innerHTML = `
            <span class="inv-chip active">✓ ${data.total} producto${data.total === 1 ? '' : 's'} leído${data.total === 1 ? '' : 's'}</span>
            <span class="inv-chip active">🗂 ${data.departments.length} departamento${data.departments.length === 1 ? '' : 's'} (${deptoNuevos} nuevo${deptoNuevos === 1 ? '' : 's'})</span>
            <span class="inv-chip active" style="font-weight:600">${totalStock} piezas de existencia</span>
            ${conflicts.length ? `<span class="inv-chip" style="border-color:#d71920;color:#d71920">⚠ ${conflicts.length} código(s) ya registrado(s)</span>` : ''}
            ${(data.errors || []).length ? `<span class="inv-chip" style="border-color:#f59e0b;color:#b45309">⚠ ${data.errors.length} fila(s) con error</span>` : ''}
        `;
    }

    const banner = document.getElementById('catalogConflictBanner');
    if (banner) {
        if (conflicts.length) {
            banner.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;color:#b91c1c;font-size:13px">
                <strong>⚠ ${conflicts.length} código(s) ya están registrados en el catálogo actual.</strong><br>
                Para reimportar desde cero sin conflictos ejecuta primero <strong>Configuración → "Vaciar catálogo"</strong>.
            </div>`;
        } else {
            banner.innerHTML = `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 14px;color:#065f46;font-size:13px">
                ✅ Catálogo en estado limpio: no hay códigos existentes que conflicten. Puedes importar.
            </div>`;
        }
    }

    const tbody = document.getElementById('catalogTableBody');
    if (tbody) {
        tbody.innerHTML = pendingCatalogItems.map(it => `
            <tr>
                <td><code style="font-size:11px">${escapeHtml(it.code)}</code></td>
                <td><strong>${escapeHtml(it.name)}</strong></td>
                <td class="num">$${Number(it.cost).toFixed(2)}</td>
                <td class="num">$${Number(it.price).toFixed(2)}</td>
                <td>${escapeHtml(it.department)}</td>
                <td class="num">${Number(it.existence) || 0}</td>
                <td>${it.exists ? '<span style="color:#d71920;font-weight:700">Ya existe</span>' : '<span style="color:#16a34a">Nuevo</span>'}</td>
            </tr>
        `).join('');
    }

    const warn = document.getElementById('catalogWarnings');
    if (warn) {
        let html = '';
        if ((data.errors || []).length) {
            html += `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;color:#92400e;font-size:12px;margin-top:8px"><strong>Filas que se ignorarán:</strong> ${data.errors.map(e => `fila ${e.row}: ${escapeHtml(e.reason)}`).join(' · ')}</div>`;
        }
        warn.innerHTML = html;
    }

    document.getElementById('catalogPreviewWrap').style.display = 'block';
    const result = document.getElementById('catalogResult');
    if (result) { result.style.display = 'none'; result.innerHTML = ''; }
}

async function applyCatalogImport() {
    const items = pendingCatalogItems;
    if (!items || !items.length) {
        showToast('No hay catálogo para importar', 'error');
        return;
    }
    const importStock = document.getElementById('catalogImportStock')?.checked ?? true;
    if ((items || []).some(it => it.exists)) {
        showConfirmDialog({
            title: '⚠️ Códigos ya registrados',
            message: `El catálogo a importar contiene código(s) que ya existen en tu base. Si reimportas ahora se duplicarán. Se recomienda: Configuración → "Vaciar catálogo" y volver a importar. ¿Aun así deseas continuar?`,
            confirmText: 'Continuar igual',
            cancelText: 'Cancelar',
            danger: true,
            onConfirm: () => doApplyCatalog(items, importStock)
        });
        return;
    }
    doApplyCatalog(items, importStock);
}

async function doApplyCatalog(items, importStock) {
    const applyBtn = document.getElementById('catalogApplyBtn');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Importando catálogo...'; }
    try {
        const res = await apiCall('/imports/catalog/apply', 'POST', { items, options: { import_stock: importStock } });
        const tag = document.getElementById('catalogResult');
        if (tag) {
            tag.style.display = 'block';
            tag.innerHTML = `
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px">
                    <strong style="color:#15803d;font-size:15px">✓ ${res.products_inserted} producto(s) importado(s) · ${res.departments_created} departamento(s) · ${res.stock_loaded} piezas de existencia</strong>
                </div>
            `;
        }
        showToast(res.message, 'success');
        pendingCatalogItems = [];
        document.getElementById('catalogPreviewWrap').style.display = 'none';
        document.getElementById('catalogOptionsWrap').style.display = 'none';
        const nameEl = document.getElementById('catalogFileName');
        if (nameEl) nameEl.textContent = 'Ningún archivo seleccionado';
        const input = document.getElementById('catalogFileInput');
        if (input) input.value = '';
        await Promise.all([loadLots(true), loadProducts()]);
    } catch (err) {
        let msg = 'Error al importar el catálogo';
        try { msg = JSON.parse(err.message).error || msg; } catch (_) {}
        showToast(msg, 'error');
    } finally {
        if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '✓ Importar catálogo'; }
    }
}

/* ===== Apartado Pedidos ===== */
async function loadOrdersSection() {
    const body = document.getElementById('ordersTableBody');
    try {
        if (body) body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:16px;">Cargando catálogo...</td></tr>`;
        ordersProducts = await apiCall('/products/inventory');
        populateOrdersCategoryFilter();
        refreshOrdersCount();
        renderOrdersSection();
    } catch (err) {
        console.error('Error cargando pedidos', err);
        if (body) body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#d71920;padding:16px;">Error al cargar el catálogo</td></tr>`;
        showToast('Error al cargar el catálogo', 'error');
    }
}

function renderOrdersSection() {
    renderOrdersTable(filterOrdersData());
    renderOrdersCart();
}

function populateOrdersCategoryFilter() {
    const sel = document.getElementById('ordersCategoryFilter');
    if (!sel) return;
    const cats = [];
    for (const p of ordersProducts) {
        if (p.category_id == null) continue;
        const key = String(p.category_id);
        const label = p.category_name || `Categoría ${key}`;
        if (!cats.some(c => c.key === key)) cats.push({ key, label });
    }
    cats.sort((a, b) => a.label.localeCompare(b.label));
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
        cats.map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join('');
    if (ordersCategorySelected && cats.some(c => c.key === ordersCategorySelected)) {
        sel.value = ordersCategorySelected;
    } else {
        ordersCategorySelected = '';
    }
}

function filterOrdersData() {
    const q = (document.getElementById('ordersSearchInput')?.value || '').trim().toLowerCase();
    const cat = ordersCategorySelected;
    return ordersProducts.filter(p => {
        if (cat && p.category_id != null && String(p.category_id) !== cat) return false;
        if (q) {
            const name = String(p.name || '').toLowerCase();
            const bc = String(p.barcode || '').toLowerCase();
            return name.includes(q) || bc.includes(q);
        }
        return true;
    });
}

function filterOrdersTable() {
    clearTimeout(ordersSearchTimer);
    ordersSearchTimer = setTimeout(() => {
        ordersCategorySelected = document.getElementById('ordersCategoryFilter')?.value || '';
        renderOrdersTable(filterOrdersData());
    }, 250);
}

function refreshOrdersCount() {
    const el = document.getElementById('ordersProductsCount');
    if (el) el.textContent = `${ordersProducts.length} producto${ordersProducts.length === 1 ? '' : 's'}`;
}

function getOrderQtyInCart(productId) {
    let total = 0;
    for (const item of ordersCart) {
        if (Number(item.id) === Number(productId)) total += Number(item.quantity || 0);
    }
    return total;
}

function renderOrdersTable(list) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:16px;">Sin productos para el filtro seleccionado</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(p => {
        const inCart = getOrderQtyInCart(p.id);
        const stock = Number(p.effective_stock != null ? p.effective_stock : p.stock);
        const stockClass = stock === 0 ? 'ord-stock-zero' : (stock < 10 ? 'ord-stock-low' : 'ord-stock-ok');
        const badge = inCart > 0 ? `<span class="ord-cart-badge">✓ ${inCart}</span>` : '';
        const rowClass = inCart > 0 ? 'ord-in-cart' : '';
        return `
            <tr class="${rowClass}">
                <td style="font-family:monospace;font-size:12px;">${escapeHtml(p.barcode || '—')}</td>
                <td style="max-width:260px;">${escapeHtml(p.name || '—')}${badge}</td>
                <td>$${Number(p.cost || 0).toFixed(2)}</td>
                <td>$${Number(p.price || 0).toFixed(2)}</td>
                <td><span class="${stockClass}">${stock}</span></td>
                <td><input type="number" class="ord-qty-input" id="ordQty-${p.id}" min="1" step="1" value="1"></td>
                <td><button class="btn btn-primary ord-add-btn" onclick="addToOrder(${p.id})">➕ Agregar</button></td>
            </tr>`;
    }).join('');
}

function addToOrder(id) {
    const input = document.getElementById(`ordQty-${id}`);
    const qty = parseInt(input?.value || '0', 10);
    if (!qty || qty <= 0) {
        showToast('Indica una cantidad mayor a 0', 'warning');
        input?.focus();
        return;
    }
    const p = ordersProducts.find(x => Number(x.id) === Number(id));
    if (!p) return;
    const stock = Number(p.effective_stock != null ? p.effective_stock : p.stock);
    const existing = ordersCart.find(x => Number(x.id) === Number(id));
    const totalWanted = (existing ? Number(existing.quantity) : 0) + qty;
    if (existing) {
        existing.quantity = totalWanted;
    } else {
        ordersCart.push({
            id: p.id,
            barcode: p.barcode || '',
            name: p.name || 'Producto',
            cost: Number(p.cost || 0),
            quantity: qty
        });
    }
    if (totalWanted > stock) {
        showToast(`⚠ ${p.name}: solicitas ${totalWanted}, hay ${stock} en existencias`, 'warning');
    } else {
        showToast(`${qty} × ${p.name} agregado al pedido`, 'success');
    }
    renderOrdersSection();
}

function updateOrderQty(idx, val) {
    const qty = parseInt(val, 10);
    if (isNaN(qty) || qty <= 0 || !ordersCart[idx]) {
        renderOrdersCart();
        return;
    }
    const p = ordersProducts.find(x => Number(x.id) === Number(ordersCart[idx].id));
    const stock = p ? Number(p.effective_stock != null ? p.effective_stock : p.stock) : 0;
    ordersCart[idx].quantity = qty;
    if (qty > stock) showToast(`⚠ ${ordersCart[idx].name}: solicitas ${qty}, hay ${stock} en existencias`, 'warning');
    renderOrdersSection();
}

function removeFromOrder(idx) {
    if (ordersCart[idx]) ordersCart.splice(idx, 1);
    renderOrdersSection();
}

function clearOrder() {
    if (!ordersCart.length) {
        showToast('El pedido ya está vacío', 'info');
        return;
    }
    ordersCart = [];
    renderOrdersSection();
    showToast('Pedido limpio', 'success');
}

function renderOrdersCart() {
    const wrap = document.getElementById('ordersCartBody');
    if (!wrap) return;
    if (!ordersCart.length) {
        wrap.innerHTML = `<p class="orders-cart-empty">El pedido está vacío. Agrega productos desde la tabla.</p>`;
        return;
    }
    const totalItems = ordersCart.reduce((a, x) => a + Number(x.quantity || 0), 0);
    const totalCost = ordersCart.reduce((a, x) => a + Number(x.cost || 0) * Number(x.quantity || 0), 0);
    wrap.innerHTML = ordersCart.map((x, i) => `
        <div class="orders-cart-item">
            <div class="orders-cart-item-info">
                <div class="orders-cart-item-bc">${escapeHtml(x.barcode || '—')}</div>
                <div class="orders-cart-item-name">${escapeHtml(x.name)}</div>
            </div>
            <input type="number" class="orders-cart-item-qty" min="1" step="1" value="${x.quantity}" onchange="updateOrderQty(${i}, this.value)">
            <div class="orders-cart-item-sub">$${Number(x.cost * x.quantity).toFixed(2)}</div>
            <button class="orders-cart-item-remove" onclick="removeFromOrder(${i})" title="Quitar del pedido">✕</button>
        </div>`).join('') + `
        <div class="orders-cart-total">
            <span>${totalItems} artículo${totalItems === 1 ? '' : 's'}</span>
            <span>${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(totalCost)} costo est.</span>
        </div>`;
}

function getOrderReportItems() {
    return ordersCart
        .map(x => ({ barcode: x.barcode || '—', name: x.name || '—', quantity: Number(x.quantity || 0), cost: Number(x.cost || 0) }))
        .filter(x => x.quantity > 0);
}

function getOrderReportCost() {
    return getOrderReportItems().reduce((a, x) => a + x.cost * x.quantity, 0);
}

function orderReportFilename(ext) {
    const d = new Date();
    return `pedido-deseado-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.${ext}`;
}

function orderReportDateString() {
    return new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });
}

function exportOrderCsv() {
    const items = getOrderReportItems();
    if (!items.length) {
        showToast('Agrega productos al pedido antes de exportar', 'warning');
        return;
    }
    const lines = [];
    lines.push('PEDIDO DESEADO');
    lines.push(`Fecha: ${orderReportDateString()}`);
    lines.push(`Productos: ${items.length}`);
    lines.push('');
    lines.push([csvValue('Código de barras'), csvValue('Nombre'), csvValue('Cantidad a solicitar')].join(','));
    for (const it of items) {
        lines.push([csvValue(it.barcode), csvValue(it.name), csvValue(it.quantity)].join(','));
    }
    lines.push('');
    lines.push([csvValue(''), csvValue('Costo estimado total'), csvValue(getOrderReportCost().toFixed(2))].join(','));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = orderReportFilename('csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Reporte Excel (CSV) descargado', 'success');
}

function exportOrderPdf() {
    const items = getOrderReportItems();
    if (!items.length) {
        showToast('Agrega productos al pedido antes de exportar', 'warning');
        return;
    }
    const rows = items.map(it => `
        <tr><td>${escapeHtml(it.barcode)}</td><td>${escapeHtml(it.name)}</td><td class="number">${it.quantity}</td></tr>`).join('');
    const totalRow = `
        <tfoot>
            <tr>
                <td colspan="2" style="text-align:right;font-weight:700;background:#fbf7e5;">Costo estimado total:</td>
                <td class="number" style="font-weight:700;background:#fbf7e5;">${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(getOrderReportCost())}</td>
            </tr>
        </tfoot>`;
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
        showToast('Permite las ventanas emergentes para generar el PDF', 'warning');
        return;
    }
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pedido deseado</title>
        <style>
            @page { size: portrait; margin: 14mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
            h1 { font-size: 24px; text-align: center; margin: 0 0 6px; letter-spacing: 2px; }
            .meta { text-align: center; color: #4b5563; font-size: 12px; margin-bottom: 20px; }
            table { border-collapse: collapse; width: 100%; font-size: 12px; }
            th { background: #f3f4f6; font-weight: 700; }
            th, td { border: 1px solid #d1d5db; padding: 7px 9px; text-align: left; }
            th:nth-child(1), td:nth-child(1) { width: 22%; font-family: monospace; }
            th:nth-child(3), td:nth-child(3) { width: 14%; text-align: center; }
            .number { text-align: center; font-weight: 700; }
            tr { page-break-inside: avoid; }
        </style></head><body>
        <h1>PEDIDO DESEADO</h1>
        <div class="meta">Fecha: ${escapeHtml(orderReportDateString())} · Productos: ${items.length}</div>
        <table><thead><tr><th>Código de barras</th><th>Nombre</th><th>Cantidad a solicitar</th></tr></thead><tbody>${rows}</tbody>${totalRow}</table>
        <script>window.onload = function () { window.print(); };</script></body></html>`);
    printWindow.document.close();
}

function exportOrderPng() {
    const items = getOrderReportItems();
    if (!items.length) {
        showToast('Agrega productos al pedido antes de exportar', 'warning');
        return;
    }
    const W = 1000;
    const padX = 50;
    const titleH = 96;
    const headerH = 42;
    const footerH = 40;
    const colBc = 260;
    const colQty = 160;
    const colName = W - padX * 2 - colBc - colQty;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const wrapLines = (text, maxWidth) => {
        const words = String(text).split(/\s+/);
        const lines = [];
        let line = '';
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (ctx.measureText(test).width <= maxWidth) line = test;
            else {
                if (line) lines.push(line);
                line = w;
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : [''];
    };

    ctx.font = '500 15px Arial, sans-serif';
    const rowH = items.map(it => {
        const nLines = Math.min(wrapLines(it.name, colName - 10).length, 2);
        return nLines * 20 + 18;
    });
    const bodyH = headerH + rowH.reduce((a, b) => a + b, 0);
    const totalH = 46;
    const H = titleH + bodyH + totalH + footerH;

    canvas.width = W;
    canvas.height = H;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('PEDIDO DESEADO', W / 2, 48);
    ctx.font = '14px Arial, sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(`${orderReportDateString()}  ·  Productos: ${items.length}`, W / 2, 74);

    let y = titleH;
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, y, W, headerH);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CÓDIGO DE BARRAS', padX, y + 27);
    ctx.fillText('NOMBRE', padX + colBc, y + 27);
    ctx.textAlign = 'right';
    ctx.fillText('CANTIDAD', W - padX, y + 27);
    y += headerH;

    ctx.textBaseline = 'middle';
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const rh = rowH[i];
        if (i % 2 === 1) {
            ctx.fillStyle = '#f9fafb';
            ctx.fillRect(0, y, W, rh);
        }
        ctx.fillStyle = '#111827';
        ctx.font = '15px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(it.barcode), padX, y + rh / 2);
        ctx.font = '500 15px Arial, sans-serif';
        wrapLines(it.name, colName - 10).slice(0, 2).forEach((ln, li) => {
            ctx.fillText(ln, padX + colBc, y + 11 + li * 20);
        });
        ctx.textAlign = 'right';
        ctx.font = 'bold 15px Arial, sans-serif';
        ctx.fillText(String(it.quantity), W - padX, y + rh / 2);
        y += rh;
    }

    y += 8;
    ctx.fillStyle = '#eef4ff';
    ctx.fillRect(0, y, W, 38);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('COSTO ESTIMADO TOTAL', padX, y + 19);
    ctx.textAlign = 'right';
    ctx.fillText(new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(getOrderReportCost()), W - padX, y + 19);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Reporte generado por POS EXPENDIO BB', W / 2, H - 16);

    canvas.toBlob((blob) => {
        if (!blob) {
            showToast('No se pudo generar el PNG', 'error');
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = orderReportFilename('png');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Reporte PNG descargado', 'success');
    }, 'image/png');
}

function renderInventoryMovements(movements) {
    const tbody = document.getElementById('inventoryMovementsBody');
    if (!tbody) return;
    if (!movements.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:16px;">Sin movimientos para el día seleccionado</td></tr>`;
        return;
    }

    const totalsInfo = computeMovementTotals(movements);

    tbody.innerHTML = movements.map(m => {
        const date = m.created_at ? new Date(String(m.created_at).replace(' ','T')) : null;
        const dateStr = date && !isNaN(date) ? date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : (m.created_at || '—');
        const qty = Number(m.quantity || 0);
        const t = m.movement_type;
        const meta = getMovementMeta(t);
        const ti = totalsInfo[m.id] || { before: 0, after: 0, stock: false };

        let qtyCell;
        let beforeQty;
        let afterCell;
        if (meta.stock) {
            const before = ti.before == null ? 0 : Number(ti.before);
            qtyCell = `<span style="color:${meta.color};font-weight:600">${meta.sign}${Math.abs(qty).toFixed(2)}</span>`;
            beforeQty = before.toFixed(2);
            afterCell = Number(ti.after).toFixed(2);
        } else {
            qtyCell = `<span style="color:${meta.color};font-weight:600">${meta.sign}</span>`;
            beforeQty = '—';
            afterCell = '—';
        }

        const safeProduct = escapeHtml(m.product_name || '—');
        const safeBarcode = escapeHtml(m.barcode || '—');
        const safeLot = escapeHtml(m.batch_number || (m.lot_id ? '#'+m.lot_id : '—'));
        const safeNotes = escapeHtml(m.notes || '');
        const safeActor = escapeHtml(m.actor_name || m.actor_username || '—');
        const actorRole = m.actor_role ? `<small style="color:#9ca3af">(${escapeHtml(m.actor_role)})</small>` : '';
        const notesHtml = safeNotes ? `<div style="font-size:11px;color:#6b7280">${safeNotes}</div>` : '';
        const actorHtml = `<div style="font-size:11px">${safeActor} ${actorRole}</div>${notesHtml}`;

        const categoryHtml = m.category_name ? `<br><small style="color:#9ca3af">${escapeHtml(m.category_name)}</small>` : '';

        return `
            <tr>
                <td style="white-space:nowrap">${dateStr}</td>
                <td><strong>${safeProduct}</strong>${categoryHtml}</td>
                <td><code style="font-size:11px">${safeBarcode}</code></td>
                <td><small>${safeLot}</small></td>
                <td><span style="color:${meta.color};font-weight:600">${meta.label}</span></td>
                <td style="text-align:right;white-space:nowrap">${qtyCell}</td>
                <td style="text-align:right;color:#9ca3af">${beforeQty}</td>
                <td style="text-align:right;font-weight:600">${afterCell}</td>
                <td>${actorHtml}</td>
            </tr>
        `;
    }).join('');
}

function showProductHistory(productId, productName) {
    showModal('📜 Historial - ' + productName, `
        <div style="max-height:60vh;overflow-y:auto;">
            <table class="data-table" style="font-size:12px;">
                <thead>
                    <tr>
                        <th>Fecha / Hora</th>
                        <th>Lote</th>
                        <th>Tipo</th>
                        <th>Cantidad</th>
                        <th>Antes</th>
                        <th>Después</th>
                        <th>Nota / Usuario</th>
                    </tr>
                </thead>
                <tbody id="productHistoryBody">
                    <tr><td colspan="7" style="text-align:center;padding:16px;">Cargando...</td></tr>
                </tbody>
            </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
            <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
        </div>
    `);

    apiCall(`/products/${productId}/movements?limit=200`).then(res => {
        const tbody = document.getElementById('productHistoryBody');
        if (!tbody) return;
        const movements = (res && res.movements) || [];
        if (!movements.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#6b7280">Sin movimientos registrados</td></tr>`;
            return;
        }
        const totalsInfo = computeMovementTotals(movements);

        tbody.innerHTML = movements.map(m => {
            const date = m.created_at ? new Date(String(m.created_at).replace(' ','T')) : null;
            const dateStr = date && !isNaN(date) ? date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : (m.created_at || '—');
            const qty = Number(m.quantity || 0);
            const t = m.movement_type;
            const meta = getMovementMeta(t);
            const ti = totalsInfo[m.id] || { before: 0, after: 0, stock: false };

            let qtyCell;
            let beforeQty;
            let afterCell;
            if (meta.stock) {
                const before = ti.before == null ? 0 : Number(ti.before);
                qtyCell = `<span style="color:${meta.color};font-weight:600">${meta.sign}${Math.abs(qty).toFixed(2)}</span>`;
                beforeQty = before.toFixed(2);
                afterCell = Number(ti.after).toFixed(2);
            } else {
                qtyCell = `<span style="color:${meta.color};font-weight:600">${meta.sign}</span>`;
                beforeQty = '—';
                afterCell = '—';
            }

            const safeLot = escapeHtml(m.batch_number || (m.lot_id ? '#'+m.lot_id : '—'));
            const safeNotes = escapeHtml(m.notes || '');
            const safeActor = escapeHtml(m.actor_name || m.actor_username || '—');
            const actorRole = m.actor_role ? `<small style="color:#9ca3af">(${escapeHtml(m.actor_role)})</small>` : '';
            const notesHtml = safeNotes ? `<div style="font-size:11px;color:#6b7280">${safeNotes}</div>` : '';

            return `
                <tr>
                    <td style="white-space:nowrap">${dateStr}</td>
                    <td><small>${safeLot}</small></td>
                    <td><span style="color:${meta.color};font-weight:600">${meta.label}</span></td>
                    <td style="text-align:right;white-space:nowrap">${qtyCell}</td>
                    <td style="text-align:right;color:#9ca3af">${beforeQty}</td>
                    <td style="text-align:right;font-weight:600">${afterCell}</td>
                    <td><div style="font-size:11px">${safeActor} ${actorRole}</div>${notesHtml}</td>
                </tr>
            `;
        }).join('');
    }).catch(err => {
        const tbody = document.getElementById('productHistoryBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#d71920">Error al cargar</td></tr>`;
    });
}

// Cart
function getProductBaseStock(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return 0;
    if (typeof product.stock === 'number') return product.stock;
    if (product.stock != null) return parseFloat(product.stock) || 0;
    return 0;
}

function getProductLotStock(productId) {
    return allLots
        .filter(l => l.product_id === productId && l.current_quantity > 0)
        .reduce((sum, l) => sum + l.current_quantity, 0);
}

function getLotCartUsage(productId, lotId) {
    return cart
        .filter(i => i.id === productId && i.lot_id === lotId)
        .reduce((sum, i) => sum + i.quantity, 0);
}

function getBaseCartUsage(productId) {
    return cart
        .filter(i => i.id === productId && (i.lot_id == null || i.lot_id === null))
        .reduce((sum, i) => sum + i.quantity, 0);
}

function getEffectiveLotStock(productId, lotId, baseLotStock) {
    return Math.max(0, baseLotStock - getLotCartUsage(productId, lotId));
}

function getEffectiveBaseStock(productId) {
    return Math.max(0, getProductBaseStock(productId) - getBaseCartUsage(productId));
}

function getAvailableStock(productId) {
    const baseEff = getEffectiveBaseStock(productId);
    const lotStock = getProductLots(productId)
        .reduce((sum, l) => sum + getEffectiveLotStock(productId, l.id, l.current_quantity || 0), 0);
    return baseEff + lotStock;
}

function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const productLots = getProductLots(productId)
        .filter(l => l.current_quantity > 0)
        .sort((a, b) => a.days_left - b.days_left);

    const productPrice = parseFloat(product.price);
    const baseStock = getProductBaseStock(productId);

    const allPricesSet = new Set();
    allPricesSet.add(productPrice);
    productLots.forEach(l => {
        const lp = l.sale_price && l.sale_price > 0 ? l.sale_price : productPrice;
        allPricesSet.add(lp);
    });
    const availableLotPrices = Array.from(allPricesSet).sort((a, b) => a - b);

    if (productLots.length > 1) {
        openLotSelector(productId, productLots, productPrice);
        return;
    }

    if (productLots.length === 1 && baseStock > 0) {
        openLotSelector(productId, productLots, productPrice);
        return;
    }

    if (productLots.length === 1) {
        const lot = productLots[0];
        const effStock = getEffectiveLotStock(productId, lot.id, lot.current_quantity || 0);
        if (effStock <= 0) {
            addToCartOutOfStock(product, lot, productPrice, `lote ${lot.batch_number || lot.id} sin stock`);
            return;
        }
        addToCartWithLot(productId, lot, productPrice);
        return;
    }

    if (baseStock <= 0) {
        addToCartOutOfStock(product, null, productPrice, 'stock general = 0');
        return;
    }

    const effBaseStock = getEffectiveBaseStock(productId);
    if (effBaseStock <= 0) {
        addToCartOutOfStock(product, null, productPrice, 'ya tienes todo el stock base en el carrito');
        return;
    }

    const availableStock = effBaseStock;
    const priceToUse = productPrice;

    const existingItem = cart.find(item => item.id === productId && (item.lot_id === null));

    if (existingItem) {
        existingItem.quantity += 1;
        existingItem.available_stock = availableStock;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            barcode: product.barcode || '',
            price: priceToUse,
            original_price: productPrice,
            available_lot_prices: availableLotPrices,
            category_id: product.category_id,
            quantity: 1,
            lot_id: null,
            lot_batch: null,
            lot_expiry: null,
            lot_days: null,
            lot_quantity: 0,
            available_stock: availableStock
        });
    }

    cartSelectedIndex = cart.length - 1;
    renderCart();
}

function addToCartOutOfStock(product, lot, price, reason, existingItem = null) {
    const lotId = lot ? lot.id : null;
    const lotPrice = lot && lot.sale_price > 0 ? lot.sale_price : price;
    const item = existingItem || cart.find(i => i.id === product.id && i.lot_id === lotId);

    if (item) {
        item.quantity += 1;
        item.out_of_stock = true;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            barcode: product.barcode || '',
            price: lotPrice,
            original_price: parseFloat(product.price),
            available_lot_prices: [lotPrice],
            category_id: product.category_id,
            quantity: 1,
            lot_id: lotId,
            lot_batch: lot ? (lot.batch_number || null) : null,
            lot_expiry: lot ? (lot.expiry_date || null) : null,
            lot_days: lot ? (lot.days_left != null ? lot.days_left : null) : null,
            lot_quantity: lot ? (lot.current_quantity || 0) : 0,
            available_stock: lot ? (lot.current_quantity || 0) : getProductBaseStock(product.id),
            out_of_stock: true
        });
    }

    showModal('⚠️ Venta sin stock', `
        <p style="margin-bottom:8px">Vas a vender <strong>${escapeHtml(product.name)}</strong> sin existencias disponibles.</p>
        <p style="font-size:13px;color:var(--text-light);margin-bottom:14px">Motivo: ${escapeHtml(reason)}</p>
        <p>Se agregó al ticket y se registrará como venta sin inventario.</p>
        <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-success" style="flex:1" onclick="closeModal()">OK, continuar</button>
        </div>
    `, { onClose: () => focusPosSearchBar() });

    cartSelectedIndex = cart.length - 1;
    renderCart();
}

function addToCartWithLot(productId, lot, productPrice) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const lotStock = lot.current_quantity || 0;
    const lotPrice = (lot.sale_price && lot.sale_price > 0) ? lot.sale_price : productPrice;
    const availableStock = lotStock;

    const existingItem = cart.find(item => item.id === productId && item.lot_id === lot.id);

    if (existingItem) {
        const remaining = lotStock - getLotCartUsage(productId, lot.id) + existingItem.quantity;
        if (remaining <= 0) {
            existingItem.quantity += 1;
            existingItem.out_of_stock = true;
        } else {
            existingItem.quantity += 1;
        }
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            barcode: product.barcode || '',
            price: lotPrice,
            original_price: productPrice,
            available_lot_prices: [lotPrice],
            category_id: product.category_id,
            quantity: 1,
            lot_id: lot.id,
            lot_batch: lot.batch_number || null,
            lot_expiry: lot.expiry_date || null,
            lot_days: lot.days_left != null ? lot.days_left : null,
            lot_quantity: lotStock,
            available_stock: availableStock
        });
    }

    cartSelectedIndex = cart.length - 1;
    renderCart();
}

function openLotSelector(productId, lots, productPrice) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    const basePrice = productPrice || parseFloat(product.price) || 0;

    const existing = document.getElementById('lotSelectorOverlay');
    if (existing) existing.remove();

    const totalStock = lots.reduce((s, l) => s + l.current_quantity, 0);
    const baseStock = getProductBaseStock(productId);
    const hasLots = lots.length > 0;
    const showOriginalOption = baseStock > 0;

    let optionsHtml = '';

    if (showOriginalOption) {
        const stockInfo = `Stock general: ${baseStock}`;
        optionsHtml += `
            <div class="lot-option" onclick="selectLot(null, ${basePrice}, ${productId})">
                <div class="lot-option-info">
                    <div class="lot-option-price">$${basePrice.toFixed(2)}</div>
                    <div class="lot-option-original" style="font-size:12px">Precio original</div>
                </div>
                <div class="lot-option-details">
                    <div class="lot-option-qty">Sin lote</div>
                    <div>${stockInfo}</div>
                </div>
                <button type="button" class="btn btn-primary" style="padding:8px 14px;font-size:13px">Seleccionar</button>
            </div>
        `;
    }

    if (lots.length > 0) {
        optionsHtml += lots.map(l => {
            const price = l.sale_price && l.sale_price > 0 ? l.sale_price : basePrice;
            const diff = price - basePrice;
            const diffLabel = Math.abs(diff) < 0.01 ? '' : (diff > 0 ? ` <span style="color:#f59e0b">+$${diff.toFixed(2)}</span>` : ` <span style="color:#10b981">-$${Math.abs(diff).toFixed(2)}</span>`);
            const daysLabel = l.days_left != null ? (l.days_left < 0 ? 'CADUCADO' : `${l.days_left}d`) : '';
            const daysClass = l.days_left != null ? (l.days_left < 0 ? 'badge-danger' : l.days_left <= 3 ? 'badge-danger' : l.days_left <= 7 ? 'badge-warning' : 'badge-success') : 'badge-info';
            const effStock = getEffectiveLotStock(productId, l.id, l.current_quantity || 0);
            const stockLabel = effStock <= 0 ? '🔴 0 (en carrito)' : `🟢 ${effStock}`;
            return `
                <div class="lot-option" onclick="selectLot(${l.id}, ${price}, ${productId})">
                    <div class="lot-option-info">
                        <div class="lot-option-price">$${price.toFixed(2)}</div>
                        ${diffLabel ? `<div class="lot-option-original" style="font-size:12px">vs original $${basePrice.toFixed(2)}${diffLabel}</div>` : ''}
                    </div>
                    <div class="lot-option-details">
                        <div class="lot-option-qty">${l.batch_number || 'Lote ' + l.id}</div>
                        ${l.expiry_date ? `<div>Cad: ${l.expiry_date}${daysLabel ? ` (${daysLabel})` : ''}</div>` : ''}
                        <div>Stock: ${stockLabel} <span class="badge ${daysClass}">${daysLabel || 'N/A'}</span></div>
                    </div>
                    <button type="button" class="btn btn-primary" style="padding:8px 14px;font-size:13px">Seleccionar</button>
                </div>
            `;
        }).join('');
    }

    const overlay = document.createElement('div');
    overlay.id = 'lotSelectorOverlay';
    overlay.className = 'lot-selector-overlay';
    overlay.innerHTML = `
        <div class="lot-selector-modal">
            <div class="lot-selector-header">
                <div>
                    <h3 style="margin:0;font-size:16px">💰 Selecciona precio/lote</h3>
                    <div style="font-size:12px;color:var(--text-light);margin-top:2px">${escapeHtml(product.name)}${lots.length > 0 ? ` · Total en lotes: ${totalStock} pzas` : ''}</div>
                </div>
                <button onclick="closeLotSelector()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-light)" title="Cerrar (Esc)">&times;</button>
            </div>
            <div class="lot-selector-body">${optionsHtml}</div>
        </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => {
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeLotSelector();
                document.removeEventListener('keydown', escHandler);
            }
        };
        overlay._escHandler = escHandler;
        document.addEventListener('keydown', escHandler);
    }, 50);
}

function closeLotSelector() {
    const el = document.getElementById('lotSelectorOverlay');
    if (el) {
        if (el._escHandler) document.removeEventListener('keydown', el._escHandler);
        el.remove();
    }
}

function selectLot(lotId, price, productId) {
    const pid = productId || (lotId ? (allLots.find(l => l.id === lotId) || {}).product_id : null);
    const product = allProducts.find(p => p.id === pid);
    if (!product) return;
    const lot = lotId ? allLots.find(l => l.id === lotId) : null;

    const productPrice = parseFloat(product.price);
    const allPricesSet = new Set();
    allPricesSet.add(productPrice);
    allLots
        .filter(l => l.product_id === product.id && l.current_quantity > 0)
        .forEach(l => {
            const lp = l.sale_price && l.sale_price > 0 ? l.sale_price : productPrice;
            allPricesSet.add(lp);
        });
    const availableLotPrices = Array.from(allPricesSet).sort((a, b) => a - b);

    const existingItem = cart.find(item => item.id === product.id && item.lot_id === (lot ? lot.id : null));
    const lotStock = lot ? (lot.current_quantity || 0) : getProductBaseStock(product.id);
    const effStock = lot ? getEffectiveLotStock(product.id, lot.id, lotStock) : getEffectiveBaseStock(product.id);

    if (existingItem) {
        if (existingItem.quantity + 1 > effStock) {
            addToCartOutOfStock(product, lot, price, 'ya tienes todo el stock de este lote en el carrito', existingItem);
            closeLotSelector();
            return;
        }
        existingItem.quantity += 1;
        existingItem.available_stock = effStock;
        existingItem.price = price;
    } else {
        if (effStock <= 0) {
            addToCartOutOfStock(product, lot, price, 'sin stock disponible');
            closeLotSelector();
            return;
        }
        cart.push({
            id: product.id,
            name: product.name,
            barcode: product.barcode || '',
            price: price,
            original_price: productPrice,
            available_lot_prices: availableLotPrices,
            category_id: product.category_id,
            quantity: 1,
            lot_id: lot ? lot.id : null,
            lot_batch: lot ? (lot.batch_number || null) : null,
            lot_expiry: lot ? lot.expiry_date : null,
            lot_days: lot ? lot.days_left : null,
            lot_quantity: lot ? lot.current_quantity : 0,
            available_stock: effStock
        });
    }
    closeLotSelector();

    cartSelectedIndex = cart.length - 1;
    renderCart();
    const modalOpen = document.getElementById('modalOverlay')?.classList.contains('active');
    if (modalOpen) closeModal();
    showToast('✓ ' + product.name + ' agregado', 'success');
}

function updateCartItemQty(index, delta) {
    if (index < 0 || index >= cart.length) return;
    const item = cart[index];
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
        cart.splice(index, 1);
    } else {
        item.quantity = newQty;
        item.out_of_stock = newQty > (item.available_stock || 0);
    }

    if (cartSelectedIndex >= cart.length) {
        cartSelectedIndex = Math.max(0, cart.length - 1);
    }
    renderCart();
}

function setCartItemQty(index, qty) {
    if (index < 0 || index >= cart.length) return;
    qty = parseInt(qty);
    if (isNaN(qty) || qty <= 0) {
        cart.splice(index, 1);
    } else {
        const item = cart[index];
        item.quantity = qty;
        item.out_of_stock = qty > (item.available_stock || 0);
    }

    if (cartSelectedIndex >= cart.length) {
        cartSelectedIndex = Math.max(0, cart.length - 1);
    }
    renderCart();
}

function setCartItemQtyFromInput(input) {
    const idx = parseInt(input.dataset.cartIndex);
    if (isNaN(idx) || idx < 0 || idx >= cart.length) return;
    setCartItemQty(idx, input.value);
}

function removeFromCart(index) {
    if (index < 0 || index >= cart.length) return;
    const removedName = cart[index].name;
    cart.splice(index, 1);
    if (cartSelectedIndex >= cart.length) {
        cartSelectedIndex = Math.max(0, cart.length - 1);
    }
    if (cart.length === 0) saleAttemptCount = 0;
    renderCart();
    showToast(`✗ ${removedName} eliminado`, 'info');
}

function clearCart() {
    if (cart.length === 0) return;
    cart = [];
    cartSelectedIndex = 0;
    saleAttemptCount = 0;
    renderCart();
}

function confirmClearCart() {
    if (cart.length === 0) return;
    showModal('¿Vaciar carrito?', `
        <p>Hay <strong>${cart.length}</strong> producto(s) en el carrito. ¿Estás seguro de vaciarlo?</p>
        <div style="display:flex;gap:8px;margin-top:16px">
            <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
            <button class="btn btn-danger" style="flex:1" onclick="clearCart();closeModal();showToast('Carrito vaciado','success')">Sí, vaciar</button>
        </div>
    `, { onClose: () => focusPosSearchBar() });
}

function applyPromotionsToCart() {
    let totalDiscount = 0;
    const appliedPromos = [];

    cart.forEach(item => {
        item.discount = 0;
        item.appliedPromo = null;
        const lineSubtotal = item.price * item.quantity;

        let bestDiscount = 0;
        let bestPromo = null;

        promotions.forEach(promo => {
            if (!promo.active) return;
            const today = localDateStr(new Date());
            if (promo.start_date && promo.start_date > today) return;
            if (promo.end_date && promo.end_date < today) return;

            let applies = false;
            if (promo.product_ids && promo.product_ids.length > 0) {
                if (promo.product_ids.includes(item.id)) applies = true;
            } else if (promo.category_ids && promo.category_ids.length > 0) {
                if (promo.category_ids.includes(item.category_id)) applies = true;
            } else {
                applies = true;
            }

            if (!applies) return;

            let discount = 0;
            if (promo.type === 'bogo') {
                if (item.quantity >= promo.buy_quantity) {
                    const promoQty = Math.floor(item.quantity / promo.buy_quantity) * promo.pay_quantity;
                    const freeQty = item.quantity - promoQty;
                    discount = freeQty * item.price;
                }
            } else if (promo.type === 'fixed_price') {
                if (item.quantity >= promo.buy_quantity && promo.buy_quantity > 0 && promo.fixed_price > 0 && promo.fixed_price < promo.buy_quantity * item.price) {
                    const groups = Math.floor(item.quantity / promo.buy_quantity);
                    const completeItems = groups * promo.buy_quantity;
                    const regularComplete = completeItems * item.price;
                    const promoTotal = groups * promo.fixed_price;
                    discount = regularComplete - promoTotal;
                }
            } else if (promo.type === 'percent') {
                discount = lineSubtotal * (promo.discount_percent / 100);
            } else if (promo.type === 'fixed_discount') {
                discount = promo.discount_amount * item.quantity;
            }

            if (discount > bestDiscount) {
                bestDiscount = discount;
                bestPromo = promo;
            }
        });

        if (bestDiscount > 0) {
            item.discount = Math.min(bestDiscount, lineSubtotal);
            item.appliedPromo = bestPromo;
            totalDiscount += item.discount;
            if (!appliedPromos.find(p => p.id === bestPromo.id)) {
                appliedPromos.push(bestPromo);
            }
        }
    });

    return { totalDiscount, appliedPromos };
}

function saveCart() {
    if (!cartHydrated) return;
    try {
        if (cart.length === 0) {
            localStorage.removeItem(CART_STORAGE_KEY);
        } else {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
        }
    } catch (e) {
        console.warn('No se pudo guardar el carrito:', e);
    }
}

function restoreCartFromStorage() {
    cartHydrated = true;
    let saved = null;
    try {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
    } catch (e) {
        saved = null;
    }
    if (!Array.isArray(saved) || saved.length === 0) return;

    // Si el catálogo aún no se ha cargado, se acepta el carrito tal cual;
    // en caso contrario solo se conservan artículos que existan.
    let valid = saved;
    if (Array.isArray(allProducts) && allProducts.length > 0) {
        valid = saved.filter(item => item && item.id && allProducts.find(p => p.id === item.id));
        if (valid.length === 0) {
            localStorage.removeItem(CART_STORAGE_KEY);
            return;
        }
    }
    valid.forEach(item => {
        delete item.discount;
        delete item.promo_name;
    });
    cart = valid;
    saleAttemptCount = 0;
    cartSelectedIndex = Math.min(cartSelectedIndex, cart.length - 1);
    renderCart();
    showToast(`🛒 Carrito recuperado: ${cart.length} producto(s) pendientes`, 'info');
}

function renderCart() {
    const tbody = document.getElementById('posCartBody');
    if (!tbody) return;
    const { totalDiscount, appliedPromos } = applyPromotionsToCart();
    saveCart();

    const countEl = document.getElementById('posCartCount');

    if (cart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-light)">Carrito vacío. Escanea o busca un producto.</td></tr>';
        if (countEl) countEl.textContent = '0 productos';
        document.getElementById('posSubtotal').textContent = '$0.00';
        document.getElementById('posTotal').textContent = '$0.00';
        document.getElementById('posDiscount').textContent = '-$0.00';
        document.getElementById('posDiscountRow').style.display = 'none';
        document.getElementById('posPromoInfo').className = 'pos-promo-info';
        document.getElementById('posPromoInfo').innerHTML = '';
        updateChargeButton();
        calculateChange();
        return;
    }

    tbody.innerHTML = cart.map((item, index) => {
        let lotBadge = '';
        if (item.lot_id && item.lot_days !== null && item.lot_days !== undefined) {
            if (item.lot_days < 0) lotBadge = '<span class="badge badge-danger">CADUC</span>';
            else if (item.lot_days <= 3) lotBadge = '<span class="badge badge-danger">⚠' + item.lot_days + 'd</span>';
            else if (item.lot_days <= 7) lotBadge = '<span class="badge badge-warning">' + item.lot_days + 'd</span>';
            else lotBadge = '<span class="badge badge-success">' + item.lot_days + 'd</span>';
        } else {
            lotBadge = '<span class="badge badge-info">Sin lote</span>';
        }

        const totalStock = item.lot_id
            ? (item.lot_quantity || 0)
            : getProductBaseStock(item.id);
        const remaining = item.lot_id
            ? getEffectiveLotStock(item.id, item.lot_id, item.lot_quantity || 0)
            : getEffectiveBaseStock(item.id);
        const overStock = item.quantity > remaining;
        const oosTag = item.out_of_stock ? ' <span class="badge badge-danger" style="font-size:10px;margin-left:4px">SIN STOCK</span>' : '';
        const stockLabel = remaining > 0
            ? `<span class="cart-stock ${overStock ? 'over' : ''}" title="En stock quedan ${remaining} de ${totalStock}">📦 ${remaining} / ${totalStock}</span>${oosTag}`
            : `<span class="cart-stock out" title="Sin existencias">📦 0 / ${totalStock}</span>${oosTag}`;

        return `
        <tr class="${index === cartSelectedIndex ? 'selected' : ''} ${overStock ? 'over-stock' : ''}" data-index="${index}">
            <td class="col-num">${index + 1}</td>
            <td class="col-product">
                <div class="cart-product-name">${escapeHtml(item.name)}</div>
                ${item.lot_batch ? `<div class="cart-product-lot">Lote: ${escapeHtml(item.lot_batch)}</div>` : '<div class="cart-product-lot" style="color:#9ca3af">Sin lote</div>'}
                <div class="cart-product-stock">${stockLabel}</div>
            </td>
            <td class="col-barcode">${escapeHtml(item.barcode || '—')}</td>
            <td style="text-align:right;font-weight:600">$${item.price.toFixed(2)}</td>
            <td class="col-qty">
                <input type="number" value="${item.quantity}" min="1" step="1" inputmode="numeric" pattern="[0-9]*" data-cart-index="${index}" onchange="setCartItemQtyFromInput(this)" onclick="event.stopPropagation()" onfocus="selectCartRow(${index})">
            </td>
            <td class="col-discount">${item.discount > 0 ? '-$' + item.discount.toFixed(2) : '-'}</td>
            <td class="col-subtotal">$${(item.price * item.quantity - (item.discount || 0)).toFixed(2)}</td>
            <td class="col-lot">
                <span class="col-lot-btn">${item.lot_batch || (item.lot_expiry ? item.lot_expiry.slice(0, 10) : 'N/A')} ${lotBadge}</span>
            </td>
            <td class="col-remove"><button type="button" class="btn-cart-remove" data-index="${index}" title="Eliminar">✕</button></td>
        </tr>
        `;
    }).join('');

    const totalUnits = cart.reduce((sum, item) => sum + (Math.max(0, Number(item.quantity) || 0)), 0);
    if (countEl) countEl.textContent = totalUnits + ' producto' + (totalUnits !== 1 ? 's' : '');
    const btnClear = document.getElementById('posClearCartBtn');
    if (btnClear) btnClear.style.display = cart.length > 0 ? 'inline-block' : 'none';

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const total = subtotal - totalDiscount;

    document.getElementById('posSubtotal').textContent = `$${subtotal.toFixed(2)}`;

    if (totalDiscount > 0) {
        document.getElementById('posDiscountRow').style.display = 'flex';
        document.getElementById('posDiscount').textContent = `-$${totalDiscount.toFixed(2)}`;
    } else {
        document.getElementById('posDiscountRow').style.display = 'none';
    }

document.getElementById('posTotal').textContent = `$${total.toFixed(2)}`;

    const promoEl = document.getElementById('posPromoInfo');
    if (appliedPromos.length > 0) {
        promoEl.className = 'pos-promo-info visible';
        promoEl.innerHTML = '<strong>🏷️</strong> ' + appliedPromos.map(p => escapeHtml(p.name)).join(' · ');
    } else {
        promoEl.className = 'pos-promo-info';
        promoEl.innerHTML = '';
    }

    const wrap = tbody.closest('.pos-cart-table-wrap');
    if (wrap) {
        wrap.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' });
    }

    updateChargeButton();
    calculateChange();
    if (typeof renderPosProductsTable === 'function') renderPosProductsTable();
}

function updateChargeButton() {
    const card = document.getElementById('posTotalCard');
    if (!card) return;
    if (cart.length === 0) {
        card.classList.add('is-empty');
        card.setAttribute('aria-disabled', 'true');
    } else {
        card.classList.remove('is-empty');
        card.removeAttribute('aria-disabled');
    }
}

function updateLastSaleInfo() {
    const box = document.getElementById('posLastSaleInfo');
    if (!box) return;
    if (!lastSaleResult) {
        box.classList.remove('visible');
        return;
    }
    const totalEl = document.getElementById('lastSaleTotal');
    const payEl = document.getElementById('lastSalePay');
    const changeEl = document.getElementById('lastSaleChange');
    const methodIcon = lastSaleResult.payment_method === 'cash' ? '💵'
        : lastSaleResult.payment_method === 'card' ? '💳' : '🔀';
    const tendered = Number(lastSaleResult.amount_tendered || 0);
    if (totalEl) totalEl.textContent = '$' + Number(lastSaleResult.total || 0).toFixed(2);
    if (payEl) payEl.textContent = `${methodIcon} $${tendered.toFixed(2)}`;
    if (changeEl) changeEl.textContent = '$' + Number(lastSaleResult.change_given || 0).toFixed(2);
    box.classList.add('visible');
}

function setPaymentMethod(method) {
    paymentMethod = method;
    document.querySelectorAll('.pos-payment-methods .payment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === method);
    });
}

// ------ Ventas y devoluciones ------

function pad2(n) { return String(n).padStart(2, '0'); }

function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayStr() {
    return toISODate(new Date());
}

const SH_DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function populateDayFilter() {
    const sel = document.getElementById('shDayFilter');
    if (!sel) return;
    const now = new Date();
    const parts = [];
    for (let i = 0; i < 14; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const iso = toISODate(d);
        let label;
        if (i === 0) label = `Hoy · ${SH_DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
        else if (i === 1) label = `Ayer · ${SH_DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
        else label = `${SH_DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        parts.push(`<option value="${iso}" ${i === 0 ? 'selected' : ''}>${label}</option>`);
    }
    sel.innerHTML = parts.join('');
}

function getSelectedDay() {
    const sel = document.getElementById('shDayFilter');
    return sel && sel.value ? sel.value : todayStr();
}

function populateCashierFilter() {
    const sel = document.getElementById('shCashierFilter');
    if (!sel) return;
    const previous = sel.value;
    const seen = new Map();
    for (const s of salesHistoryData) {
        if (s.cashier_id && !seen.has(String(s.cashier_id))) {
            seen.set(String(s.cashier_id), s.cashier_name || `Cajero ${s.cashier_id}`);
        }
    }
    sel.innerHTML = '<option value="">Todos los cajeros</option>' +
        [...seen.entries()].map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');
    if (previous && seen.has(previous)) sel.value = previous;
}

function openSalesHistory() {
    document.getElementById('salesHistoryOverlay').style.display = 'flex';
    salesHistorySelectedId = null;
    populateDayFilter();
    const cash = document.getElementById('shCashierFilter');
    if (cash) cash.value = '';
    refreshSalesHistory();
}

function closeSalesHistory() {
    document.getElementById('salesHistoryOverlay').style.display = 'none';
    focusPosSearchBar();
}

async function refreshSalesHistory() {
    try {
        const q = (document.getElementById('shSearchInput')?.value || '').trim();
        const status = document.getElementById('shStatusFilter')?.value || '';
        const day = getSelectedDay();
        let url = `/sales/?date_from=${day}&date_to=${day}&limit=500`;
        if (q) url += `&q=${encodeURIComponent(q)}`;
        if (status) url += `&status=${status}`;
        const sales = await apiCall(url);
        salesHistoryData = Array.isArray(sales) ? sales : [];
        populateCashierFilter();
        const cashier = document.getElementById('shCashierFilter')?.value || '';
        const rows = cashier ? salesHistoryData.filter(s => String(s.cashier_id) === cashier) : salesHistoryData;
        renderSalesHistoryTable(rows);
        if (salesHistorySelectedId && !rows.some(s => Number(s.id) === Number(salesHistorySelectedId))) {
            salesHistorySelectedId = null;
        }
        if (salesHistorySelectedId) loadSaleDetail(salesHistorySelectedId);
        else {
            document.getElementById('shTicketEmpty').style.display = '';
            document.getElementById('shTicket').style.display = 'none';
        }
    } catch (error) {
        showToast('Error al cargar las ventas', 'error');
        console.error(error);
    }
}

function filterSalesHistory() {
    clearTimeout(salesHistorySearchTimer);
    salesHistorySearchTimer = setTimeout(refreshSalesHistory, 250);
}

function renderSalesHistoryTable(rows = salesHistoryData) {
    const tbody = document.getElementById('shSalesBody');
    const countEl = document.getElementById('shResultsCount');
    if (!tbody) return;
    if (countEl) countEl.textContent = `${rows.length} venta${rows.length === 1 ? '' : 's'}`;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:26px;color:var(--text-light)">Sin ventas para el día seleccionado</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(s => {
        const method = s.payment_method === 'cash' ? '💵 Efectivo'
            : s.payment_method === 'card' ? '💳 Tarjeta' : '🔀 Mixto';
        const timeStr = formatShortTime(s.sale_date);
        const rowClass = [
            Number(s.id) === Number(salesHistorySelectedId) ? 'selected' : '',
            s.status === 'cancelled' ? 'sh-row-cancelled' : ''
        ].filter(Boolean).join(' ');
        return `
            <tr class="${rowClass}" onclick="selectSaleFromHistory(${s.id})">
                <td class="sh-folio">#${s.id}</td>
                <td>${escapeHtml(timeStr)}</td>
                <td>${escapeHtml(s.cashier_name || '-')}</td>
                <td class="sh-method">${method}</td>
                <td class="sh-total">$${parseFloat(s.total || 0).toFixed(2)}</td>
            </tr>
        `;
    }).join('');
}

function formatShortTime(dt) {
    if (!dt) return '—';
    const m = String(dt).match(/(\d{1,2}):(\d{2})/);
    if (!m) return '—';
    let h = parseInt(m[1], 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${pad2(h)}:${m[2]} ${ampm}`;
}

function formatTicketDate(dt) {
    if (!dt) return '—';
    const s = String(dt);
    const dm = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T])(\d{1,2}):(\d{2})/);
    if (dm) return `${dm[3]}/${dm[2]}/${dm[1]} ${formatShortTime(s)}`;
    return formatShortTime(dt);
}

function selectSaleFromHistory(id) {
    salesHistorySelectedId = id;
    document.querySelectorAll('#shSalesBody tr').forEach(tr => {
        tr.classList.toggle('selected', tr.querySelector('.sh-folio')?.textContent === `#${id}`);
    });
    loadSaleDetail(id);
}

async function loadSaleDetail(id) {
    const empty = document.getElementById('shTicketEmpty');
    const ticket = document.getElementById('shTicket');
    try {
        const sale = await apiCall(`/sales/${id}`);
        empty.style.display = 'none';
        ticket.style.display = 'flex';
        renderSaleTicket(sale);
        const selectedRow = document.querySelector('#shSalesBody tr.selected');
        if (selectedRow) selectedRow.scrollIntoView({ block: 'nearest' });
    } catch (error) {
        empty.style.display = '';
        ticket.style.display = 'none';
        showToast('Error al cargar el ticket', 'error');
    }
}

function renderSaleTicket(sale) {
    const container = document.getElementById('shTicket');
    const methodText = sale.payment_method === 'cash' ? '💵 Efectivo'
        : sale.payment_method === 'card' ? '💳 Tarjeta' : '🔀 Mixto';
    const dateStr = formatTicketDate(sale.sale_date);
    const isEditable = sale.status !== 'cancelled' && sale.status !== 'returned';
    const stamp = sale.status === 'cancelled'
        ? '<div class="sh-ticket-stamp cancelled">CANCELADO</div>'
        : sale.status === 'returned'
            ? '<div class="sh-ticket-stamp returned">DEVUELTO</div>'
            : '';

    const itemsHtml = (sale.items || []).map(i => {
        const sold = parseFloat(i.quantity || 0);
        const returned = parseFloat(i.returned_quantity || 0);
        const available = sold - returned;
        const lineTotal = parseFloat(i.total || 0);
        const refundMethod = sale.payment_method === 'cash' ? 'cash' : sale.payment_method === 'card' ? 'card' : 'cash';
        return `
            <div class="sh-ticket-item ${available <= 0 ? 'returned' : ''}">
                <span class="sh-ti-name">${escapeHtml(i.product_name || `Prod #${i.product_id}`)}</span>
                <span class="sh-ti-qty">${sold > 0 ? 'x' + (+sold) : ''}${returned > 0 ? ` <span style="color:#4338ca">(dev. ${+returned})</span>` : ''}</span>
                <span class="sh-ti-price">$${lineTotal.toFixed(2)}</span>
            </div>
            ${available > 0 && isEditable ? `
            <div style="display:flex;align-items:center;gap:8px;padding:2px 0 6px;border-bottom:1px dotted #ddd;background:#f8fafc">
                <span style="font-size:11px;color:#4338ca">↩</span>
                <input type="number" class="sh-return-qty-input" id="shRetQty_${i.id}" min="0" max="${available}" step="1" value="1">
                <span style="font-size:10px;color:var(--text-light)">disp: ${+available}</span>
                <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;margin-left:auto" onclick="returnSaleItem(${sale.id}, ${i.id})">Devolver</button>
            </div>` : ''}
        `;
    }).join('');

    const returnedTotal = parseFloat(sale.returned_amount || 0);
    const discountTotal = parseFloat(sale.discount || 0);

    container.innerHTML = `
        <div class="sh-ticket-sheet">
            ${stamp}
            <h3>🥖 POS EXPENDIO BB</h3>
            <div class="sh-ticket-sub">Ticket #${sale.id} (folio)</div>
            <div class="sh-ticket-sub">${dateStr}</div>
            ${sale.customer_name ? `<div class="sh-ticket-sub">Cliente: ${escapeHtml(sale.customer_name)}</div>` : ''}
            <div class="sh-ticket-meta">
                <span class="muted">Cajero</span><span>${escapeHtml(sale.cashier_name || '-')}</span>
                <span class="muted">Método</span><span>${methodText}</span>
                <span class="muted">Pago con</span><span>$${parseFloat(sale.amount_tendered || 0).toFixed(2)}</span>
                <span class="muted">Cambio</span><span>$${parseFloat(sale.change_given || 0).toFixed(2)}</span>
            </div>
            <div id="shTicketItems">${itemsHtml}</div>
            <div class="sh-ticket-totals">
                <div class="sh-tt-row"><span>Subtotal:</span><span>$${parseFloat(sale.subtotal || 0).toFixed(2)}</span></div>
                ${discountTotal > 0 ? `<div class="sh-tt-row" style="color:var(--success)"><span>Desc. promos:</span><span>-$${discountTotal.toFixed(2)}</span></div>` : ''}
                ${returnedTotal > 0 ? `<div class="sh-tt-row" style="color:#4338ca"><span>Devuelto:</span><span>-$${returnedTotal.toFixed(2)}</span></div>` : ''}
                <div class="sh-tt-row total"><span>TOTAL:</span><span>$${parseFloat(sale.total || 0).toFixed(2)}</span></div>
            </div>
            <div class="sh-ticket-actions">
                <button class="btn btn-secondary" onclick="printSaleCopy(${sale.id})">🖨️ Copia</button>
                ${isEditable ? `<button class="btn btn-danger btn-danger-sm" onclick="cancelSaleTicket(${sale.id})">🗑️ Cancelar ticket</button>` : ''}
            </div>
            ${isEditable ? `<div class="sh-return-note">Devoluciones y cancelaciones requieren la contraseña del dueño del turno</div>` : ''}
        </div>
    `;
}

async function returnSaleItem(saleId, saleItemId) {
    const qtyInput = document.getElementById(`shRetQty_${saleItemId}`);
    const quantity = parseFloat(qtyInput?.value || 0);
    if (!quantity || quantity <= 0) {
        showToast('Indica una cantidad válida a devolver', 'error');
        return;
    }
    showOwnerPasswordModal({
        reason: `Devolver ${quantity} de este artículo de la venta #${saleId}. Se reembolsará y se devolverá el stock.`,
        onVerified: async (ownerPassword) => {
            try {
                await apiCall(`/sales/${saleId}/return`, 'POST', {
                    items: [{ sale_item_id: saleItemId, quantity, refund_method: 'cash' }],
                    owner_password: ownerPassword,
                    reason: 'Devolución desde historial POS'
                });
                showToast('✓ Devolución registrada', 'success');
                await Promise.all([loadProducts(), loadLots(true), loadInventoryMovementsHistory?.()]);
                if (typeof loadCashData === 'function') loadCashData();
                refreshSalesHistory();
            } catch (error) {
                showToast(extractErrMsg(error), 'error');
            }
        }
    });
}

async function cancelSaleTicket(saleId) {
    showConfirmDialog({
        title: 'Cancelar ticket',
        message: `¿Cancelar la venta #${saleId} por completo? Se reembolsará el total y se devolverá todo el stock. Esta acción requiere la contraseña del dueño del turno.`,
        confirmText: 'Continuar',
        danger: true,
        onConfirm: () => {
            showOwnerPasswordModal({
                reason: `Cancelar por completo la venta #${saleId}. Se reembolsará el total.`,
                onVerified: async (ownerPassword) => {
                    try {
                        await apiCall(`/sales/${saleId}`, 'DELETE', { owner_password: ownerPassword });
                        showToast('✓ Venta cancelada', 'success');
                        await Promise.all([loadProducts(), loadLots(true), loadInventoryMovementsHistory?.()]);
                        if (typeof loadCashData === 'function') loadCashData();
                        refreshSalesHistory();
                    } catch (error) {
                        showToast(extractErrMsg(error), 'error');
                    }
                }
            });
        }
    });
}

function extractErrMsg(error) {
    try {
        const parsed = JSON.parse(error.message);
        return parsed.error || 'Error';
    } catch {}
    return error.message || 'Error';
}

async function printSaleCopy(saleId) {
    try {
        const sale = await apiCall(`/sales/${saleId}`);
        const normalized = {
            sale_id: sale.id,
            items: (sale.items || []).filter(i => (parseFloat(i.quantity || 0) - parseFloat(i.returned_quantity || 0)) > 0).map(i => ({
                name: i.product_name,
                quantity: parseFloat(i.quantity || 0) - parseFloat(i.returned_quantity || 0),
                price: parseFloat(i.unit_price || 0),
                discount: parseFloat(i.discount || 0),
                lot_batch: i.batch_number,
                lot_expiry: i.expiry_date
            })),
            subtotal: parseFloat(sale.subtotal || 0),
            discount: parseFloat(sale.discount || 0),
            total: parseFloat(sale.total || 0),
            payment_method: sale.payment_method,
            amount_tendered: parseFloat(sale.amount_tendered || 0),
            change_given: parseFloat(sale.change_given || 0),
            cashier_name: sale.cashier_name,
            customer_name: sale.customer_name,
            notes: sale.notes
        };
        showTicketModal(normalized);
    } catch (error) {
        showToast('Error al imprimir copia', 'error');
    }
}

// ------ Ventas del día y devoluciones (fin) ------

function calculateChange() {
    // No-op: ahora el cálculo se hace en el modal de pago (calculatePaymentChange)
}

function getOverstockItems() {
    return cart.filter(item => {
        const stock = item.available_stock != null ? item.available_stock : 0;
        return item.quantity > stock;
    });
}

function processSale() {
    openPaymentModal();
}

// Payment Modal (F12) - Replace old processSale for charging
async function openPaymentModal() {
    if (cart.length === 0) {
        showToast('Agrega productos al carrito', 'error');
        return;
    }
    const overstock = getOverstockItems();
    if (overstock.length > 0 && saleAttemptCount < 1) {
        saleAttemptCount++;
        const list = overstock.map(i => `<li><strong>${escapeHtml(i.name)}</strong>: tienes ${i.available_stock || 0} pero vendes ${i.quantity}</li>`).join('');
        showModal('⚠️ Sin existencias suficientes', `
            <p>Los siguientes productos no tienen existencias suficientes:</p>
            <ul style="text-align:left;padding-left:20px;margin:12px 0">${list}</ul>
            <p style="color:#d71920"><strong>Si vuelves a presionar COBRAR se procesará la venta sin inventario.</strong></p>
            <div style="display:flex;gap:8px;margin-top:16px">
                <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                <button class="btn btn-primary primary" id="overstockConfirmBtn" style="flex:1" onclick="closeModal();openPaymentModal()">Cobrar sin stock</button>
            </div>
        `, { onClose: () => focusPosSearchBar(), primaryFocusId: 'overstockConfirmBtn' });
        return;
    }
    refreshActiveTerminal();
    const total = currentCartTotal();
    const totalEl = document.getElementById('paymentTotal');
    const requiredEl = document.getElementById('payRequired');
    if (totalEl) totalEl.textContent = '$' + total.toFixed(2);
    if (requiredEl) requiredEl.textContent = '$' + total.toFixed(2);

    selectPayMethod('cash');
    document.getElementById('payCashAmount').value = total.toFixed(2);
    document.getElementById('payCardAmount').value = '';
    calculatePaymentChange();

    const overlay = document.getElementById('paymentOverlay');
    if (overlay) overlay.style.display = 'flex';
    EnterNav.deactivate('modal');
    EnterNav.deactivate('shiftGate');

    setTimeout(() => {
        const cashInput = document.getElementById('payCashAmount');
        if (cashInput) {
            cashInput.focus();
            cashInput.select();
        }
    }, 100);
}

function closePaymentModal() {
    const overlay = document.getElementById('paymentOverlay');
    if (overlay) overlay.style.display = 'none';
    const gate = document.getElementById('shiftGate');
    if (gate && gate.classList.contains('open')) {
        EnterNav.activate({
            scopeKey: 'shiftGate',
            container: document.getElementById('shiftGateBody'),
            primarySelector: '#shiftGateFoot .btn-primary',
            skipSelectors: ['textarea', 'select[multiple]']
        });
    }
    setTimeout(() => {
        const search = document.getElementById('posSearchInput');
        if (search) search.focus();
    }, 50);
}

function selectPayMethod(method) {
    paymentMethod = method;
    document.querySelectorAll('.pay-method').forEach(btn => btn.classList.toggle('active', btn.dataset.method === method));
    document.getElementById('payCashGroup').style.display = method === 'mixed' || method === 'cash' ? 'block' : 'none';
    document.getElementById('payCardGroup').style.display = method === 'mixed' || method === 'card' ? 'block' : 'none';
    document.getElementById('paySummary').style.display = method === 'mixed' ? 'block' : 'none';
    const cashInput = document.getElementById('payCashAmount');
    const cardInput = document.getElementById('payCardAmount');
    const total = currentCartTotal();
    const feeRate = getMPFeeRate();
    if (method === 'card') {
        const gross = feeRate > 0 ? total / (1 - feeRate) : total;
        if (cardInput) cardInput.value = money(gross);
        if (cashInput) cashInput.value = '';
    } else if (method === 'mixed') {
        if (cardInput) cardInput.value = '';
        if (cashInput && parseFloat(cashInput.value || 0) === 0) cashInput.value = '';
        const cash = Math.max(0, parseFloat(cashInput?.value || 0) || 0);
        if (cashInput && cash >= total - 0.01) {
            if (cardInput) cardInput.value = '';
        }
    }
    if (cashInput) cashInput.placeholder = '0.00';
    if (cardInput) cardInput.placeholder = '0.00';
    calculatePaymentChange();
}

function calculatePaymentChange() {
    const total = currentCartTotal();

    const cashInput = document.getElementById('payCashAmount');
    const cardInput = document.getElementById('payCardAmount');
    const cashAmount = Math.max(0, parseFloat(cashInput?.value || 0) || 0);
    const cardGross = Math.max(0, parseFloat(cardInput?.value || 0) || 0);

    const feeRate = getMPFeeRate();
    const feeActive = (paymentMethod === 'card' || paymentMethod === 'mixed') && feeRate > 0;

    // En mixto, si el efectivo no cubre el total y no hay monto tarjeta, autocompleta el resto por tarjeta (con recargo)
    if (paymentMethod === 'mixed' && cardInput) {
        if (cashAmount >= total - 0.01) {
            cardInput.value = '';
        } else if (cardGross === 0 && cashAmount > 0) {
            const rest = Math.max(0, total - cashAmount);
            cardInput.value = feeRate > 0 ? money(rest / (1 - feeRate)) : money(rest);
        }
    }
    const cardGrossFinal = Math.max(0, parseFloat(cardInput?.value || 0) || 0);
    const cardNet = feeActive ? cardGrossFinal * (1 - feeRate) : cardGrossFinal;
    const cardFee = cardGrossFinal - cardNet;

    let received = 0;
    if (paymentMethod === 'cash') received = cashAmount;
    else if (paymentMethod === 'card') received = cardNet;
    else if (paymentMethod === 'mixed') received = cashAmount + cardNet;

    const receivedEl = document.getElementById('payReceived');
    const requiredEl = document.getElementById('payRequired');
    if (receivedEl) receivedEl.textContent = '$' + money(received);
    if (requiredEl) requiredEl.textContent = '$' + money(total);
    const cashRead = document.getElementById('payCashReadout');
    const cardRead = document.getElementById('payCardReadout');
    if (cashRead) cashRead.textContent = '$' + money(cashAmount);
    if (cardRead) cardRead.textContent = '$' + money(cardNet);

    if (paymentMethod === 'mixed') {
        const faltaCash = Math.max(0, total - cardNet);
        const faltaCard = Math.max(0, total - cashAmount);
        if (cashInput) cashInput.placeholder = faltaCash > 0.01 ? 'Falta $' + money(faltaCash) : 'Completo';
        if (cardInput) cardInput.placeholder = faltaCard > 0.01 ? 'Falta $' + money(faltaCard) : 'Completo';
    }

    renderCardFee(feeActive ? cardGrossFinal : 0, cardNet, cardFee, feeRate);
    if (cardInput && cardInput.parentElement) cardInput.parentElement.classList.toggle('has-fee', feeActive && cardGrossFinal > 0);

    const missingEl = document.getElementById('paymentMissing');
    const missingAmountEl = document.getElementById('paymentMissingAmount');
    const changeBox = document.getElementById('paymentChangeBox');
    const changeEl = document.getElementById('paymentChange');
    const confirmBtn = document.getElementById('confirmPayBtn');

    const missing = total - received;
    if (missing > 0.01) {
        if (missingEl) missingEl.style.display = 'block';
        if (missingAmountEl) missingAmountEl.textContent = '$' + money(missing);
        if (changeBox) changeBox.style.display = 'none';
    } else {
        if (missingEl) missingEl.style.display = 'none';
        const change = received - total;
        if (changeBox) changeBox.style.display = change > 0.01 ? 'flex' : 'none';
        if (changeEl) changeEl.textContent = '$' + money(Math.max(0, change));
    }

    if (confirmBtn) confirmBtn.disabled = received < total - 0.01;
}

function renderCardFee(gross, net, fee, feeRate) {
    const box = document.getElementById('payCardFeeBox');
    if (!box) return;
    const show = paymentMethod === 'card' || paymentMethod === 'mixed';
    box.style.display = show ? 'block' : 'none';
    const warn = document.getElementById('payFeeWarn');
    const note = document.getElementById('payFeeNote');
    const label = document.getElementById('payFeeLabel');
    const base = document.getElementById('payFeeBase');
    const amount = document.getElementById('payFeeAmount');
    const grossEl = document.getElementById('payFeeGross');
    if (!warn || !note || !label || !base || !amount || !grossEl) return;

    const rate = activeTerminal && activeTerminal.commission_rate ? parseFloat(activeTerminal.commission_rate) : 0;
    if (feeRate > 0) {
        warn.style.display = 'none';
        note.style.display = 'block';
        label.textContent = `Comisión MP (${rate.toLocaleString('es-MX')}% + IVA)`;
        base.textContent = '$' + money(net);
        amount.textContent = '-' + '$' + money(fee);
        grossEl.textContent = '$' + money(gross);
    } else {
        warn.style.display = 'block';
        note.style.display = 'none';
        label.textContent = 'Comisión MP';
        base.textContent = '$0.00';
        amount.textContent = '$0.00';
        grossEl.textContent = '$0.00';
    }
}

function mpShowWaitModal(amount) {
    mpWaitCanceled = false;
    statusPollFailures = 0;
    let ov = document.getElementById('mpWaitOverlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'mpWaitOverlay';
        ov.className = 'mp-wait-overlay';
        document.body.appendChild(ov);
    }
    ov.innerHTML = `
        <div class="mp-wait-box">
            <div class="mp-wait-icon">💳</div>
            <div class="mp-wait-title">Cobrando con terminal Point</div>
            <div class="mp-wait-amount">$${money(amount)}</div>
            <div class="mp-wait-hint" id="mpWaitHint">Acerque la tarjeta al terminal…</div>
            <div class="mp-wait-actions">
                <button type="button" class="btn btn-primary mp-wait-recovered" onclick="mpMarkAlreadyCharged()">✓ Ya cobró</button>
                <button type="button" class="btn btn-danger mp-wait-cancel" id="mpCancelBtn" onclick="mpCancelCurrentOrder()">✕ Cancelar cobro</button>
            </div>
        </div>`;
    ov.style.display = 'flex';
    const cardBtn = document.querySelector('[data-method="card"]');
    if (cardBtn) cardBtn.disabled = true;
    const mixedBtn = document.querySelector('[data-method="mixed"]');
    if (mixedBtn) mixedBtn.disabled = true;
}

function mpHideWaitModal() {
    if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
    const ov = document.getElementById('mpWaitOverlay');
    if (ov) ov.style.display = 'none';
    const cardBtn = document.querySelector('[data-method="card"]');
    if (cardBtn) cardBtn.disabled = false;
    const mixedBtn = document.querySelector('[data-method="mixed"]');
    if (mixedBtn) mixedBtn.disabled = false;
}

async function mpCancelCurrentOrder() {
    if (!document.getElementById('mpWaitOverlay') || document.getElementById('mpWaitOverlay').style.display !== 'flex') {
        return;
    }
    const resolve = mpResolve;
    if (!resolve) { mpHideWaitModal(); return; }
    const orderId = mpActiveOrderId;

    const settleCharged = () => {
        mpWaitCanceled = true;
        if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
        mpActiveOrderId = null;
        mpResolve = null;
        mpHideWaitModal();
        resolve({ approved: true, order_id: orderId });
    };
    const settleCancelled = async () => {
        mpWaitCanceled = true;
        if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
        mpActiveOrderId = null;
        if (orderId) {
            try { await apiCall('/mp/orders/' + orderId + '/cancel', 'POST'); } catch (e) {}
        }
        mpResolve = null;
        mpHideWaitModal();
        resolve({ approved: false, reason: 'cancelado' });
    };

    // Seguridad: si la terminal ya imprimió el ticket, el pago se cobró.
    // NO cancelar en MP (riesgo de reembolso) y NO descartar la venta: se registra.
    let order = null;
    if (orderId) {
        try { order = await apiCall('/mp/orders/' + orderId, 'GET'); } catch (e) {}
    }
    if (order && mpOrderIsApproved(order)) {
        settleCharged();
        return;
    }
    if (!order) {
        const ov = document.getElementById('mpWaitOverlay');
        if (ov) ov.style.display = 'none';
        showConfirmDialog({
            title: '¿El cliente ya pagó?',
            icon: '💳',
            message: 'No se pudo consultar el estado del pago en la terminal.<br>Si la terminal <strong>ya imprimió el ticket</strong>, presiona "Ya cobró" para registrar la venta.<br>Si NO cobró, usa "Cancelar" para cancelar el cobro.',
            confirmText: 'Ya cobró',
            confirmIcon: '✓',
            cancelText: 'No cobró, cancelar',
            onConfirm: settleCharged,
            onCancel: () => { settleCancelled(); }
        });
        return;
    }
    await settleCancelled();
}

async function mpMarkAlreadyCharged() {
    if (!document.getElementById('mpWaitOverlay') || document.getElementById('mpWaitOverlay').style.display !== 'flex') {
        return;
    }
    const resolve = mpResolve;
    if (!resolve) { mpHideWaitModal(); return; }
    const orderId = mpActiveOrderId;

    // En última instancia el cajero confirma que la terminal YA imprimió el ticket.
    // NO se cancela la orden en MP (riesgo de reembolso del pago aprobado).
    mpWaitCanceled = true;
    if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
    mpActiveOrderId = null;
    mpResolve = null;
    mpHideWaitModal();
    resolve({ approved: true, order_id: orderId });
}

function mpOrderIsApproved(order) {
    if (!order) return false;
    const status = (order.status || '').toLowerCase();
    const paymentsRaw = (order.transactions && order.transactions.payments) || order.payments || [];
    const pay = paymentsRaw[0] || {};
    const payStatus = (pay.status || '').toLowerCase();
    const payDetail = (pay.status_detail || '').toLowerCase();
    const successStates = ['processed', 'approved', 'accredited', 'paid'];
    const failStates = ['failed', 'rejected', 'refused', 'canceled', 'cancelled', 'expired', 'refunded'];
    const successDetail = ['accredited', 'processed', 'approved'];
    return successStates.indexOf(payStatus) !== -1 ||
           successDetail.indexOf(payDetail) !== -1 ||
           successStates.indexOf(status) !== -1 ||
           (status === 'closed' && failStates.indexOf(payStatus) === -1);
}

async function mpEnsureConnected() {
    try {
        const st = await apiCall('/mp/charge-status');
        return !!(st && st.connected && st.terminal_id);
    } catch (e) {
        return false;
    }
}

function mpStatusText(status, detail) {
    const d = (detail || '').toLowerCase();
    if (d.indexOf('insufficient') !== -1 || d.indexOf('empty_account') !== -1) return 'Saldo insuficiente en la tarjeta';
    if (d.indexOf('rejected_by_issuer') !== -1) return 'Rechazada por el banco emisor';
    if (d.indexOf('high_risk') !== -1) return 'Rechazada por control de riesgo';
    if (d.indexOf('amount_limit') !== -1) return 'Supera el límite de la tarjeta';
    if (d.indexOf('card_disabled') !== -1 || d.indexOf('blocked') !== -1 || d.indexOf('inhabilitad') !== -1 || d.indexOf('disabled') !== -1) return 'Tarjeta inhabilitada';
    if (d.indexOf('max_attempt') !== -1) return 'Demasiados intentos fallidos';
    if (d.indexOf('bad_filled') !== -1 || d.indexOf('invalid') !== -1) return 'Datos de tarjeta no válidos';
    if (d.indexOf('processing_error') !== -1) return 'Error de procesamiento en el terminal';
    if (d.indexOf('call_for_authorize') !== -1) return 'Se requiere autorización del banco';
    if (d.indexOf('check_on_terminal') !== -1) return 'Confirma el pago en el terminal';
    if (d.indexOf('waiting_payment') !== -1) return 'Esperando el pago en el terminal';
    if (d.indexOf('in_review') !== -1) return 'El pago está en revisión';
    if (status === 'action_required') return 'Acción requerida en el terminal';
    if (d.indexOf('expired') !== -1 || d.indexOf('expiration') !== -1 || status === 'expired') return 'Tiempo de espera agotado';
    if (d.indexOf('other_reason') !== -1) return 'Rechazada por el banco';
    if (d.indexOf('cancel') !== -1) return 'Cobro cancelado';
    if (status === 'failed' || d.indexOf('failed') !== -1) return 'Falló el pago en el terminal';
    return 'Pago rechazado';
}

async function mpChargeFlow(cardAmount) {
    try {
        const created = await apiCall('/mp/orders', 'POST', {
            amount: cardAmount,
            external_reference: 'POS-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)
        });
        const orderId = created.order_id;
        if (!orderId) throw new Error('No se obtuvo id de la orden de Mercado Pago');
        mpActiveOrderId = orderId;

        return new Promise((resolve) => {
            mpResolve = resolve;
            mpShowWaitModal(cardAmount);
            const start = Date.now();
            const POLL_MS = 2500;
            const MAX_WAIT_MS = 10 * 60 * 1000;

            const tick = async () => {
                try {
                    if (mpWaitCanceled || !mpActiveOrderId) return;
                    if (Date.now() - start > MAX_WAIT_MS) {
                        const r = mpResolve; mpResolve = null;
                        if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
                        mpActiveOrderId = null;
                        if (r) setTimeout(() => { mpHideWaitModal(); r({ approved: false, reason: 'timeout' }); }, 100);
                        return;
                    }
                    let order = null;
                    let lastPollErr = null;
                    try { order = await apiCall('/mp/orders/' + orderId, 'GET'); }
                    catch (e) { lastPollErr = e; }
                    if (!order) {
                        statusPollFailures += 1;
                        const hint = document.getElementById('mpWaitHint');
                        if (statusPollFailures >= 3 && statusPollFailures < 20) {
                            if (hint) hint.textContent = '⚠ No se pudo consultar el estado del cobro, reintentando…';
                        } else if (statusPollFailures >= 20) {
                            if (hint) hint.textContent = '⚠ El cobro parece aplicado. Use "Ya cobrado" si la terminal imprimió el ticket.';
                        }
                        if (statusPollFailures >= 25) {
                            const r = mpResolve; mpResolve = null;
                            if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
                            mpActiveOrderId = null;
                            if (r) setTimeout(() => { mpHideWaitModal(); r({ approved: false, reason: 'error', message: (lastPollErr && lastPollErr.message) || 'No se pudo consultar el estado del cobro' }); }, 100);
                            return;
                        }
                        mpPollTimer = setTimeout(tick, POLL_MS);
                        return;
                    }
                    statusPollFailures = 0;
                    if (!mpActiveOrderId) return;

                    const isApproved = mpOrderIsApproved(order);
                    const status = (order.status || '').toLowerCase();
                    const paymentsRaw = (order.transactions && order.transactions.payments) || order.payments || [];
                    const pay = paymentsRaw[0] || {};
                    const payStatus = (pay.status || '').toLowerCase();
                    const payDetail = pay.status_detail || '';
                    const hint = document.getElementById('mpWaitHint');

                    const failStates = ['failed', 'rejected', 'refused', 'canceled', 'cancelled', 'expired', 'refunded'];

                    if (isApproved) {
                        if (hint) hint.textContent = '✓ Pago aprobado, registrando venta…';
                        const r = mpResolve; mpResolve = null;
                        if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
                        mpActiveOrderId = null;
                        if (r) setTimeout(() => { mpHideWaitModal(); r({ approved: true, order_id: orderId }); }, 600);
                        return;
                    }
                    if (payStatus && failStates.indexOf(payStatus) !== -1) {
                        const msg = mpStatusText(payStatus, payDetail);
                        if (hint) hint.textContent = '✗ ' + msg;
                        const r = mpResolve; mpResolve = null;
                        if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
                        mpActiveOrderId = null;
                        if (r) setTimeout(() => { mpHideWaitModal(); r({ approved: false, reason: 'rejected', message: msg }); }, 900);
                        return;
                    }
                    if (status && failStates.indexOf(status) !== -1) {
                        const msg = mpStatusText(status, order.status_detail || payDetail);
                        if (hint) hint.textContent = '✗ ' + msg;
                        const r = mpResolve; mpResolve = null;
                        if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
                        mpActiveOrderId = null;
                        if (r) setTimeout(() => { mpHideWaitModal(); r({ approved: false, reason: 'rejected', message: msg }); }, 900);
                        return;
                    }
                    if (payStatus === 'in_process' || payStatus === 'pending' || payStatus === 'authorized' || status === 'at_terminal') {
                        if (hint) hint.textContent = '⏳ Procesando pago, espere…';
                    }
                    if (hint && (status === 'open')) hint.textContent = 'Acerque la tarjeta al terminal…';
                    mpPollTimer = setTimeout(tick, POLL_MS);
                } catch (e) {
                    if (mpPollTimer) { clearInterval(mpPollTimer); mpPollTimer = null; }
                    const r = mpResolve; mpResolve = null;
                    mpActiveOrderId = null;
                    if (r) setTimeout(() => { mpHideWaitModal(); r({ approved: false, reason: 'error', message: (e && e.message) || 'Ocurrió un error consultando el cobro' }); }, 100);
                }
            };

            try {
                tick();
            } catch (e) {
                const r = mpResolve; mpResolve = null;
                if (r) r({ approved: false, reason: 'error' });
            }
        });
    } catch (e) {
        let msg = '';
        try {
            const parsed = JSON.parse(e.message);
            msg = parsed.error || '';
            if (parsed.detail) {
                try {
                    const d = JSON.parse(parsed.detail);
                    const er = d.errors && d.errors[0];
                    if (er) msg = er.message || msg;
                } catch (_) {}
            }
        } catch (_) {}
        return { approved: false, reason: 'error', message: msg || null };
    }
}

async function confirmPayment() {
    if (isProcessingSale) {
        showToast('El cobro ya está en proceso…', 'info');
        return;
    }
    if (!activeShift) {
        closePaymentModal();
        forceShiftLogin('No puedes vender sin un turno de caja abierto. Inicia sesión de nuevo para abrir uno.');
        return;
    }
    const total = currentCartTotal();
    let received = 0;
    const cashAmount = parseFloat(document.getElementById('payCashAmount')?.value || 0);
    const cardAmount = parseFloat(document.getElementById('payCardAmount')?.value || 0);
    const cardNet = getCardNet(cardAmount);
    if (paymentMethod === 'cash') received = cashAmount;
    else if (paymentMethod === 'card') received = cardNet;
    else if (paymentMethod === 'mixed') received = cashAmount + cardNet;

    if (received < total - 0.01) {
        showToast('El monto recibido debe ser igual o mayor al total', 'error');
        document.getElementById('payCashAmount')?.focus();
        return;
    }

    const usesMp = (paymentMethod === 'card' || paymentMethod === 'mixed') && cardAmount > 0.005;

    if (usesMp) {
        const connected = await mpEnsureConnected();
        if (!connected) {
            showToast('La terminal de Mercado Pago no está conectada. Vincúlala en Ajustes → Mercado Pago', 'error');
            return;
        }
        isProcessingSale = true;
        const procBtnMp = document.getElementById('confirmPayBtn');
        if (procBtnMp) { procBtnMp.disabled = true; procBtnMp.textContent = 'COBRANDO…'; }
        const payRes = await mpChargeFlow(cardAmount);
        isProcessingSale = false;
        if (procBtnMp) { procBtnMp.disabled = false; procBtnMp.textContent = '✓ CONFIRMAR (Enter)'; }
        if (!payRes.approved) {
            if (payRes.message) {
                showToast(payRes.message, 'error');
            } else if (payRes.reason === 'timeout') showToast('El cobro en el terminal no se completó a tiempo', 'error');
            else if (payRes.reason === 'error') showToast(payRes.message || 'Ocurrió un error con el terminal de Mercado Pago', 'error');
            else showToast('Cobro cancelado', 'info');
            return;
        }
    }

    const hasOutOfStock = cart.some(i => i.out_of_stock);
    const overstock = getOverstockItems();
    const forceNoStock = hasOutOfStock || (overstock.length > 0 && saleAttemptCount >= 1);

    closePaymentModal();
    const card = document.getElementById('posTotalCard');
    if (card) { card.classList.add('is-empty'); card.setAttribute('aria-disabled', 'true'); }

    // Bloqueo de doble envío: desactiva el botón mientras el cobro está en vuelo
    isProcessingSale = true;
    const procBtn = document.getElementById('confirmPayBtn');
    if (procBtn) { procBtn.disabled = true; procBtn.textContent = 'PROCESANDO…'; }

    try {
        const saleData = {
            items: cart.map(item => ({
                product_id: item.id,
                lot_id: item.lot_id || null,
                quantity: item.quantity,
                unit_price: item.price,
                total: item.price * item.quantity,
                discount: item.discount || 0
            })),
            payment_method: paymentMethod,
            amount_tendered: received,
            discount: 0,
            force_no_stock: forceNoStock
        };

        const result = await apiCall('/sales/', 'POST', saleData);
        lastSaleResult = {
            ...result,
            items: [...cart],
            subtotal: cart.reduce((s, i) => s + i.price * i.quantity, 0),
            discount: applyPromotionsToCart().totalDiscount,
            total,
            payment_method: paymentMethod,
            amount_tendered: received,
            change_given: result.change_given,
            cashier_name: currentUser?.full_name || '',
            customer_name: saleData.customer_name,
            notes: saleData.notes
        };

        updateLastSaleInfo();
        showToast('✓ Venta registrada', 'success');
        cart = [];
        saleAttemptCount = 0;
        renderCart();
        document.getElementById('posSearchInput')?.focus();
        await Promise.all([loadProducts(), loadLots(true)]);
        if (document.getElementById('salesHistoryOverlay')?.style.display === 'flex') refreshSalesHistory();

        showTicketModal(lastSaleResult);
        setupAutoCloseTicket();
    } catch (error) {
        let msg = 'Error al procesar venta';
        let shiftRequired = false;
        try {
            const parsed = JSON.parse(error.message);
            msg = parsed.error || msg;
            if (parsed.shift_required) shiftRequired = true;
        } catch {}
        if (shiftRequired || (typeof msg === 'string' && msg.toLowerCase().includes('turno'))) {
            await refreshActiveShift();
            if (!activeShift) {
                forceShiftLogin('El turno de caja se cerró. Inicia sesión de nuevo para abrir uno.');
                return;
            }
        }
        showToast(msg, 'error');
    } finally {
        isProcessingSale = false;
        const cobrarBtn = document.getElementById('confirmPayBtn');
        if (cobrarBtn) { cobrarBtn.disabled = false; cobrarBtn.textContent = '✓ CONFIRMAR (Enter)'; }
    }
}

function showTicketModal(sale) {
    const itemsHtml = sale.items.map(i => {
        const itemPrice = parseFloat(i.price) || 0;
        const originalPrice = parseFloat(i.original_price) || 0;
        const showBothPrices = originalPrice > 0 && itemPrice !== originalPrice;
        const showOtherLots = i.available_lot_prices && i.available_lot_prices.length > 1;

        let priceLabel = `$${itemPrice.toFixed(2)} c/u`;
        if (showBothPrices) {
            priceLabel = `<span style="text-decoration:line-through;color:#999">$${originalPrice.toFixed(2)}</span> <strong>$${itemPrice.toFixed(2)}</strong> c/u`;
        }

        const otherPricesHtml = showOtherLots
            ? `<div style="font-size:10px;color:#666;margin-top:3px">Precios disponibles: $${i.available_lot_prices.join(' / $')}</div>`
            : '';

        const lotLabel = i.lot_batch
            ? `<div style="font-size:10px;color:#666;margin-top:2px">Lote: ${escapeHtml(i.lot_batch)}${i.lot_expiry ? ' · Cad: ' + (i.lot_expiry || '').slice(0, 10) : ''}</div>`
            : (i.lot_id ? `<div style="font-size:10px;color:#666;margin-top:2px">Lote #${i.lot_id}</div>` : '');

        return `
        <div class="ticket-item" style="display:block;margin-bottom:8px;padding-bottom:4px;border-bottom:1px dotted #ddd">
            <div style="display:flex;justify-content:space-between;font-weight:600">
                <span class="ticket-item-name">${escapeHtml(i.name)}</span>
                <span class="ticket-item-qty">x${i.quantity}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#444;margin-top:2px">
                <span>${priceLabel}</span>
                <span class="ticket-item-price"><strong>$${(i.price * i.quantity - (i.discount || 0)).toFixed(2)}</strong></span>
            </div>
            ${lotLabel}
            ${otherPricesHtml}
        </div>
    `;}).join('');

    const methodText = sale.payment_method === 'cash' ? 'Efectivo' : 'Tarjeta';
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES');
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    const html = `
        <div class="ticket" id="ticketPrint">
            <div class="ticket-header">
                <h2>🥖 POS EXPENDIO BB</h2>
                <p>Pan Bimbo & Productos Barcel</p>
                <p>Ticket #${sale.sale_id}</p>
                <p>${dateStr} ${timeStr}</p>
                ${sale.customer_name ? `<p>Cliente: ${escapeHtml(sale.customer_name)}</p>` : ''}
            </div>
            <div class="ticket-items">
                ${itemsHtml}
            </div>
            <div class="ticket-totals">
                <div class="ticket-item"><span>Subtotal:</span><span>$${sale.subtotal.toFixed(2)}</span></div>
                ${sale.discount > 0 ? `<div class="ticket-item" style="color:#10b981"><span>Desc. promos:</span><span>-$${sale.discount.toFixed(2)}</span></div>` : ''}
                <div class="ticket-item total"><span>TOTAL:</span><span>$${sale.total.toFixed(2)}</span></div>
                <div class="ticket-item"><span>Pago (${methodText}):</span><span>$${sale.amount_tendered.toFixed(2)}</span></div>
                <div class="ticket-item"><span>Cambio:</span><span>$${sale.change_given.toFixed(2)}</span></div>
            </div>
            ${sale.notes ? `<div style="text-align:left;padding:6px 0;border-top:1px dashed #000;margin-top:6px;font-size:11px"><strong>Notas:</strong> ${escapeHtml(sale.notes)}</div>` : ''}
            <div class="ticket-footer">
                <p>Cajero: ${escapeHtml(sale.cashier_name)}</p>
                <p>¡Gracias por su compra!</p>
            </div>
        </div>
        <div class="ticket-actions">
            <button class="btn btn-primary" onclick="printTicket()">🖨️ Imprimir</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
            <span class="ticket-auto-close-hint">Se cierra solo en 2s o al escanear</span>
        </div>
    `;

    showModal(`Venta #${sale.sale_id} - Ticket`, html);
}

let ticketAutoCloseTimer = null;
let ticketScanHandler = null;

function setupAutoCloseTicket() {
    if (ticketAutoCloseTimer) clearTimeout(ticketAutoCloseTimer);
    if (ticketScanHandler) {
        document.getElementById('posSearchInput')?.removeEventListener('input', ticketScanHandler);
        ticketScanHandler = null;
    }

    ticketAutoCloseTimer = setTimeout(() => {
        const overlay = document.getElementById('modalOverlay');
        if (overlay && overlay.classList.contains('active')) {
            const title = document.getElementById('modalTitle')?.textContent || '';
            if (title.includes('Ticket')) {
                closeModal();
                document.getElementById('posSearchInput')?.focus();
            }
        }
        ticketAutoCloseTimer = null;
    }, 2000);

    const search = document.getElementById('posSearchInput');
    if (search) {
        ticketScanHandler = () => {
            if (ticketAutoCloseTimer) {
                clearTimeout(ticketAutoCloseTimer);
                ticketAutoCloseTimer = null;
            }
            const overlay = document.getElementById('modalOverlay');
            if (overlay && overlay.classList.contains('active')) {
                const title = document.getElementById('modalTitle')?.textContent || '';
                if (title.includes('Ticket')) closeModal();
            }
            search.removeEventListener('input', ticketScanHandler);
            ticketScanHandler = null;
        };
        search.addEventListener('input', ticketScanHandler);
    }
}

function printTicket() {
    const ticketEl = document.getElementById('ticketPrint');
    if (!ticketEl) return;
    const win = window.open('', '', 'width=320,height=600');
    win.document.write(`
        <html><head><title>Ticket</title>
        <style>
            body { font-family: 'Courier New', monospace; margin: 0; padding: 8px; }
            .ticket { font-size: 12px; line-height: 1.4; }
            .ticket-header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
            .ticket-items { border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
            .ticket-item { display: flex; justify-content: space-between; margin-bottom: 4px; }
            .ticket-totals .ticket-item.total { font-weight: bold; font-size: 14px; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
            .ticket-footer { text-align: center; border-top: 1px dashed #000; padding-top: 8px; }
        </style>
        </head><body>${ticketEl.outerHTML}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 250);
}

// Cash
async function checkCashRegister() {
    await refreshActiveShift();
    if (typeof updateCashStatus === 'function') {
        const data = activeShift
            ? { has_open: true, cash: activeShift.register, stats: activeShift.stats }
            : { has_open: false };
        updateCashStatus(data);
    }
}

function updateCashStatus(data) {
    const statusEl = document.getElementById('cashStatus');
    const openBtn = document.getElementById('openCashBtn');
    const closeBtn = document.getElementById('closeCashBtn');

    if (data.has_open) {
        const c = data.cash;
        const s = data.stats || {};
        const salesTotal = parseFloat(s.sales_total) || parseFloat(c.total_sales) || 0;
        const cashTotal = parseFloat(s.cash_total) || parseFloat(c.total_cash) || 0;
        const cardTotal = (parseFloat(s.card_total) || 0) + (parseFloat(s.mixed_total) || 0);
        const salesCount = parseInt(s.sales_count) || 0;
        statusEl.innerHTML = `
            <p class="success">✓ Caja Abierta</p>
            <div class="cash-summary">
                <div class="stat">
                    <div class="stat-label">Apertura</div>
                    <div class="stat-value">$${parseFloat(c.opening_amount).toFixed(2)}</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Ventas</div>
                    <div class="stat-value">$${salesTotal.toFixed(2)}</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Efectivo</div>
                    <div class="stat-value">$${cashTotal.toFixed(2)}</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Tarjeta/Mixto</div>
                    <div class="stat-value">$${cardTotal.toFixed(2)}</div>
                </div>
            </div>
            <p style="margin-top:12px;font-size:13px">Cajero: ${escapeHtml(c.cashier_name)} · Apertura: ${new Date(c.open_date).toLocaleString('es-MX')} · ${salesCount} ventas en el turno</p>
        `;
        statusEl.className = 'cash-status open';
        openBtn.style.display = 'none';
        closeBtn.style.display = 'inline-block';
    } else {
        statusEl.innerHTML = '<p>🔒 Caja cerrada</p>';
        statusEl.className = 'cash-status';
        openBtn.style.display = 'inline-block';
        closeBtn.style.display = 'none';
    }
}

function showOpenCashModal() {
    showOpenShiftModal({ source: 'cash_section' });
}

async function openCashRegister(e) {
    if (e) e.preventDefault();
    showOpenShiftModal({ source: 'cash_section' });
}

async function showCloseCashModal() {
    try {
        const data = await refreshActiveShift();
        if (!data) {
            showToast('No hay caja abierta', 'error');
            return;
        }
        const reg = data.register;
        const stats = data.stats || {};
        const expected = data.expected_amount || 0;

        showModal('Cerrar Caja', `
            <form id="closeCashForm" onsubmit="closeCash(event)">
                <div class="close-cash-preview">
                    <div class="row"><span>Apertura:</span><span>$${parseFloat(reg.opening_amount).toFixed(2)}</span></div>
                    <div class="row"><span>Ventas efectivo:</span><span>$${parseFloat(stats.cash_total || 0).toFixed(2)}</span></div>
                    <div class="row"><span>Ventas tarjeta / mixto:</span><span>$${(parseFloat(stats.card_total || 0) + parseFloat(stats.mixed_total || 0)).toFixed(2)}</span></div>
                    <div class="row total"><span>Esperado en caja:</span><span>$${expected.toFixed(2)}</span></div>
                </div>
                <div class="form-group">
                    <label>Conteo físico de efectivo *</label>
                    <input type="number" name="counted_cash" id="countedCash" step="0.01" min="0" value="${expected.toFixed(2)}" required oninput="updateCloseDiff(${expected})">
                    <small style="color:#6b7280">Cuenta cuánto efectivo hay realmente en la caja</small>
                </div>
                <div class="form-group">
                    <label>Diferencia</label>
                    <div id="closeDiff" class="cash-diff-zero" style="font-size:24px;font-weight:700;text-align:center;padding:8px">$0.00</div>
                </div>
                <div class="form-group">
                    <label>Notas (opcional)</label>
                    <textarea name="notes" rows="3" placeholder="Observaciones del cierre..."></textarea>
                </div>
                <button type="submit" class="btn btn-danger" style="width:100%">Confirmar Cierre</button>
            </form>
        `, {
            enterNav: {
                primarySelector: '#modalBody button.btn-danger[type="submit"]',
                skipSelectors: ['textarea']
            }
        });

        setTimeout(() => updateCloseDiff(expected), 50);
    } catch (error) {
        showToast('Error al preparar cierre', 'error');
    }
}

function updateCloseDiff(expected) {
    const counted = parseFloat(document.getElementById('countedCash')?.value) || 0;
    const diff = counted - expected;
    const el = document.getElementById('closeDiff');
    if (!el) return;

    if (Math.abs(diff) < 0.01) {
        el.textContent = '$0.00 (cuadre exacto)';
        el.className = 'cash-diff-zero';
    } else if (diff > 0) {
        el.textContent = `+$${diff.toFixed(2)} (sobrante)`;
        el.className = 'cash-diff-positive';
    } else {
        el.textContent = `-$${Math.abs(diff).toFixed(2)} (faltante)`;
        el.className = 'cash-diff-negative';
    }
}

async function closeCash(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    if (!activeShift?.register) {
        showToast('No hay caja abierta', 'error');
        return;
    }
    const register = activeShift.register;
    const ownerId = register.user_id;
    const isOwner = currentUser && Number(currentUser.id) === Number(ownerId);

    const body = {
        notes: formData.get('notes') || '',
        counted_cash: parseFloat(formData.get('counted_cash')) || 0
    };

    if (!isOwner) {
        const pw = await promptOwnerPassword();
        if (!pw) return;
        body.owner_password = pw;
    }

    try {
        const result = await apiCall(`/cash/${register.id}/close`, 'POST', body);
        showCloseReceipt(register, result);
        closeModal();
        await refreshActiveShift();
        loadCashHistory();
        if (!activeShift) {
            forceShiftLogin('✓ Turno cerrado. Inicia sesión de nuevo para abrir otro turno.');
        }
    } catch (error) {
        let msg = 'Error';
        try { msg = JSON.parse(error.message).error || error.message; } catch { msg = error.message; }
        if (msg.toLowerCase().includes('contraseña') || msg.toLowerCase().includes('requires_password')) {
            showToast('Contraseña del dueño incorrecta', 'error');
        } else {
            showToast(msg, 'error');
        }
    }
}

function promptOwnerPassword() {
    return new Promise((resolve) => {
        showModal('🔐 Contraseña del dueño', `
            <p style="font-size:13px;color:var(--text-light)">Vas a cerrar el turno de otro usuario. Ingresa la contraseña del dueño para continuar.</p>
            <form id="__cashPwForm" onsubmit="event.preventDefault();">
                <div class="form-group">
                    <label>Contraseña del dueño del turno *</label>
                    <input type="password" name="pw" required autocomplete="current-password">
                </div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                    <button type="button" class="btn btn-primary" id="__cashPwConfirm" style="flex:1">Confirmar</button>
                </div>
            </form>
        `, {
            enterNav: {
                primarySelector: '#__cashPwConfirm',
                skipSelectors: []
            }
        });
        setTimeout(() => {
            const confirmBtn = document.getElementById('__cashPwConfirm');
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const inp = document.querySelector('#__cashPwForm input[name="pw"]');
                    const pw = inp ? inp.value : '';
                    closeModal();
                    resolve(pw || null);
                };
            }
            const inp = document.querySelector('#__cashPwForm input[name="pw"]');
            if (inp) inp.focus();
        }, 50);
    });
}

function showCloseReceipt(cash, result) {
    const diff = result.difference;
    let diffText = '';
    if (Math.abs(diff) < 0.01) diffText = '✓ Cuadre exacto';
    else if (diff > 0) diffText = `+$${diff.toFixed(2)} sobrante`;
    else diffText = `-$${Math.abs(diff).toFixed(2)} faltante`;

    const html = `
        <div class="ticket" id="cashClosePrint">
            <div class="ticket-header">
                <h2>🥖 CORTE DE CAJA</h2>
                <p>POS EXPENDIO BB</p>
                <p>Corte #${cash.id}</p>
                <p>Apertura: ${new Date(cash.open_date).toLocaleString('es-MX')}</p>
                <p>Cierre: ${new Date().toLocaleString('es-MX')}</p>
            </div>
            <div class="ticket-items">
                <div class="ticket-item"><span>Monto apertura:</span><span>$${parseFloat(cash.opening_amount).toFixed(2)}</span></div>
                <div class="ticket-item"><span>Ventas efectivo:</span><span>$${result.total_cash.toFixed(2)}</span></div>
                <div class="ticket-item"><span>Ventas tarjeta:</span><span>$${result.total_card.toFixed(2)}</span></div>
                <div class="ticket-item total"><span>TOTAL ventas:</span><span>$${result.total_sales.toFixed(2)}</span></div>
                <div class="ticket-item"><span>Esperado en caja:</span><span>$${result.expected_amount.toFixed(2)}</span></div>
                <div class="ticket-item"><span>Contado físico:</span><span>$${result.counted_amount.toFixed(2)}</span></div>
                <div class="ticket-item total"><span>DIFERENCIA:</span><span>${diffText}</span></div>
            </div>
            <div class="ticket-footer">
                <p>Cajero: ${escapeHtml(cash.cashier_name)}</p>
                <p>Impreso: ${new Date().toLocaleString('es-MX')}</p>
            </div>
        </div>
        <div class="ticket-actions">
            <button class="btn btn-primary" onclick="printCashClose()">🖨️ Imprimir</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
        </div>
    `;
    showModal('Corte de Caja Cerrado', html);
}

function printCashClose() {
    const el = document.getElementById('cashClosePrint');
    if (!el) return;
    const win = window.open('', '', 'width=320,height=600');
    win.document.write(`
        <html><head><title>Corte de Caja</title>
        <style>
            body { font-family: 'Courier New', monospace; margin: 0; padding: 8px; }
            .ticket { font-size: 12px; line-height: 1.4; }
            .ticket-header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
            .ticket-items { border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
            .ticket-item { display: flex; justify-content: space-between; margin-bottom: 4px; }
            .ticket-item.total { font-weight: bold; font-size: 14px; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
            .ticket-footer { text-align: center; border-top: 1px dashed #000; padding-top: 8px; }
        </style>
        </head><body>${el.outerHTML}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 250);
}

function showCashTab(tab) {
    document.querySelectorAll('#cashSection .tab-btn').forEach(btn => {
        const isActive = (tab === 'today' && btn.textContent.includes('Día')) ||
                        (tab === 'myticket' && btn.textContent.includes('Mi Turno')) ||
                        (tab === 'all' && btn.textContent.includes('Todos')) ||
                        (tab === 'history' && btn.textContent.includes('Historial'));
        btn.classList.toggle('active', isActive);
    });
    document.getElementById('cashTodayTab').style.display = tab === 'today' ? 'block' : 'none';
    document.getElementById('cashMyticketTab').style.display = tab === 'myticket' ? 'block' : 'none';
    document.getElementById('cashAllTab').style.display = tab === 'all' ? 'block' : 'none';
    document.getElementById('cashHistoryTab').style.display = tab === 'history' ? 'block' : 'none';

    if (tab === 'today') loadDayCuts();
    if (tab === 'myticket') loadMyShift();
    if (tab === 'all') loadAllShifts();
    if (tab === 'history') loadCashHistory();
}

async function loadDayCuts() {
    try {
        const today = localDateStr(new Date());
        const data = await apiCall(`/cash/history?date_from=${today}&date_to=${today}&limit=100`);
        const tbody = document.getElementById('dayCutsTable');
        if (!tbody) return;

        // Calculate daily totals
        let dayTotal = 0, dayCash = 0, dayCard = 0, closedCount = 0;
        
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px">Sin cortes hoy</td></tr>';
        } else {
            data.forEach(c => {
                const total = parseFloat(c.total_sales) || 0;
                const cash = parseFloat(c.total_cash) || 0;
                const card = parseFloat(c.total_card) || 0;
                if (c.status === 'closed') {
                    dayTotal += total;
                    dayCash += cash;
                    dayCard += card;
                    closedCount++;
                }
            });
            
            tbody.innerHTML = data.map(c => {
                const diff = parseFloat(c.difference) || 0;
                let diffClass = 'cash-diff-zero';
                if (diff > 0) diffClass = 'cash-diff-positive';
                else if (diff < 0) diffClass = 'cash-diff-negative';
                
                const openDate = c.open_date ? new Date(c.open_date).toLocaleString('es-MX') : '—';
                const closeDate = c.close_date ? new Date(c.close_date).toLocaleString('es-MX') : '—';
                
                return `
                    <tr>
                        <td>${c.id}</td>
                        <td>${escapeHtml(c.cashier_name || '—')}</td>
                        <td>${openDate}</td>
                        <td>${closeDate}</td>
                        <td>$${parseFloat(c.total_sales || 0).toFixed(2)}</td>
                        <td>$${parseFloat(c.total_cash || 0).toFixed(2)}</td>
                        <td>$${parseFloat(c.total_card || 0).toFixed(2)}</td>
                        <td>$${parseFloat(c.expected_amount || 0).toFixed(2)}</td>
                        <td>$${parseFloat(c.counted_amount || 0).toFixed(2)}</td>
                        <td class="${diffClass}">$${diff.toFixed(2)}</td>
                        <td>
                            <button class="btn btn-sm" onclick="viewCashDetail(${c.id})">👁️</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
        
        // Update summary cards
        // Incluir las ventas en vivo del turno abierto de hoy (aun no estan en ningun corte)
        const cur = await apiCall('/cash/current').catch(() => null);
        if (cur?.has_open && cur.cash && localDateStr(cur.cash.open_date) === today) {
            const s = cur.stats || {};
            dayTotal += parseFloat(s.sales_total) || 0;
            dayCash += parseFloat(s.cash_total) || 0;
            dayCard += (parseFloat(s.card_total) || 0) + (parseFloat(s.mixed_total) || 0);
        }

        document.getElementById('dayTotalSales').textContent = '$' + dayTotal.toFixed(2);
        document.getElementById('dayTotalCash').textContent = '$' + dayCash.toFixed(2);
        document.getElementById('dayTotalCard').textContent = '$' + dayCard.toFixed(2);
        document.getElementById('dayClosedShifts').textContent = closedCount;
        
    } catch (error) {
        console.error('Error loading day cuts:', error);
    }
}

async function loadMyShift() {
    try {
        const data = await apiCall('/cash/active');
        const container = document.getElementById('myShiftCard');
        if (!container) return;
        
        if (!data?.has_active) {
            container.innerHTML = '<p style="text-align:center; color:#888;">Sin turno activo</p>';
            return;
        }
        
        const reg = data.register;
        const stats = data.stats;
        const expected = data.expected_amount || 0;
        const isOwner = currentUser && reg.user_id && Number(currentUser.id) === Number(reg.user_id);
        
        container.innerHTML = `
            <div class="my-shift-header">
                <h3>🎫 Mi Turno Actual</h3>
                <span class="shift-status ${isOwner ? 'owner' : 'other'}">${isOwner ? 'Tu turno' : 'Turno de ' + (data.owner?.full_name || data.owner?.username || reg.cashier_name)}</span>
            </div>
            <div class="my-shift-stats">
                <div class="shift-stat"><span class="stat-label">Apertura</span><span class="stat-value">${reg.open_date ? new Date(reg.open_date).toLocaleString('es-MX') : '—'}</span></div>
                <div class="shift-stat"><span class="stat-label">Monto apertura</span><span class="stat-value">$${parseFloat(reg.opening_amount || 0).toFixed(2)}</span></div>
                <div class="shift-stat"><span class="stat-label">Ventas</span><span class="stat-value">${stats.sales_count || 0} · $${parseFloat(stats.sales_total || 0).toFixed(2)}</span></div>
                <div class="shift-stat"><span class="stat-label">Efectivo</span><span class="stat-value">$${parseFloat(stats.cash_total || 0).toFixed(2)}</span></div>
                <div class="shift-stat"><span class="stat-label">Tarjeta</span><span class="stat-value">$${parseFloat(stats.card_total || 0).toFixed(2)}</span></div>
                <div class="shift-stat highlight"><span class="stat-label">Esperado en caja</span><span class="stat-value">$${expected.toFixed(2)}</span></div>
            </div>
            <div class="my-shift-actions">
                ${isOwner ? `
                    <button class="btn btn-primary" onclick="startCloseAndOpenFlow()">🔄 Cerrar y abrir nuevo</button>
                ` : `
                    <button class="btn btn-warning" onclick="showOwnerPasswordModal({reason:'Para cerrar el turno de otro usuario confirma con la contraseña del dueño',onVerified:doCloseAndOpen})">🔒 Cerrar turno</button>
                `}
            </div>
        `;
    } catch (error) {
        console.error('Error loading my shift:', error);
    }
}

let _allShiftsCache = [];

async function loadAllShifts() {
    try {
        const data = await apiCall('/cash/?limit=500');
        _allShiftsCache = data || [];
        applyAllShiftsFilter();
    } catch (error) {
        console.error('Error loading all shifts:', error);
        const tbody = document.getElementById('allShiftsTable');
        if (tbody) tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:30px;color:#d71920">Error al cargar turnos</td></tr>';
    }
}

function applyAllShiftsFilter() {
    if (!_allShiftsCache) return;
    const showOpen = document.getElementById('allFilterOpen')?.checked;
    const showClosed = document.getElementById('allFilterClosed')?.checked;
    const showOverdue = document.getElementById('allFilterOverdue')?.checked;
    const dateFilter = document.getElementById('allDateFilter')?.value;
    const today = localDateStr(new Date());

    let filtered = _allShiftsCache.filter(s => {
        const openDate = s.open_date ? new Date(s.open_date) : null;
        const openDateStr = openDate ? localDateStr(openDate) : '';
        const isOverdue = s.status === 'open' && openDateStr && openDateStr < today;

        if (dateFilter && openDateStr !== dateFilter) return false;

        if (showOpen && !showClosed) {
            if (s.status !== 'open') return false;
        } else if (showClosed && !showOpen) {
            if (s.status !== 'closed') return false;
        }
        if (showOverdue && !isOverdue) return false;

        return true;
    });

    renderAllShiftsTable(filtered);
    renderAllShiftsStats(_allShiftsCache);
}

function clearAllShiftsFilter() {
    document.getElementById('allFilterOpen').checked = false;
    document.getElementById('allFilterClosed').checked = false;
    document.getElementById('allFilterOverdue').checked = false;
    document.getElementById('allDateFilter').value = '';
    applyAllShiftsFilter();
}

function renderAllShiftsStats(all) {
    const today = localDateStr(new Date());
    let openCount = 0, closedCount = 0, overdueCount = 0;
    all.forEach(s => {
        if (s.status === 'open') {
            openCount++;
            const openDateStr = s.open_date ? localDateStr(s.open_date) : '';
            if (openDateStr < today) overdueCount++;
        } else if (s.status === 'closed') {
            closedCount++;
        }
    });
    const el = (id) => document.getElementById(id);
    if (el('allOpenCount')) el('allOpenCount').textContent = openCount;
    if (el('allClosedCount')) el('allClosedCount').textContent = closedCount;
    if (el('allOverdueCount')) el('allOverdueCount').textContent = overdueCount;
    if (el('allTotalCount')) el('allTotalCount').textContent = all.length;
}

function formatDateTime(dt) {
    if (!dt) return '—';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Fecha YYYY-MM-DD en hora LOCAL (las fechas de caja se guardan en hora local del servidor).
function localDateStr(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDuration(start, end) {
    if (!start) return '—';
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    let diff = Math.max(0, Math.floor((e - s) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const sec = diff % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) return `${h}h ${pad(m)}m`;
    if (m > 0) return `${m}m ${pad(sec)}s`;
    return `${sec}s`;
}

function renderAllShiftsTable(shifts) {
    const tbody = document.getElementById('allShiftsTable');
    if (!tbody) return;
    if (shifts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:30px;color:#888">Sin turnos registrados</td></tr>';
        return;
    }
    const today = localDateStr(new Date());
    const canEdit = permissions?.cash_register?.can_edit || permissions?.cash_register?.can_delete || currentUser?.role === 'admin' || currentUser?.role === 'supervisor';

    tbody.innerHTML = shifts.map(s => {
        const openDateStr = s.open_date ? localDateStr(s.open_date) : '';
        const isOverdue = s.status === 'open' && openDateStr && openDateStr < today;
        const isOpen = s.status === 'open';
        const diff = parseFloat(s.difference) || 0;
        let diffClass = 'cash-diff-zero';
        if (diff > 0) diffClass = 'cash-diff-positive';
        else if (diff < 0) diffClass = 'cash-diff-negative';

        let statusPill = '';
        if (isOpen) {
            statusPill = `<span class="shift-status-pill open ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠️ Vencido' : '🟢 Abierto'}</span>`;
        } else {
            statusPill = `<span class="shift-status-pill closed">🔴 Cerrado</span>`;
        }

        const rowClass = isOverdue ? 'shift-row-overdue' : (isOpen ? 'shift-row-open' : '');

        return `
            <tr class="${rowClass}">
                <td><strong>#${s.id}</strong></td>
                <td>${statusPill}</td>
                <td>${escapeHtml(s.cashier_name || '—')}</td>
                <td title="${s.open_date || ''}">${formatDateTime(s.open_date)}</td>
                <td title="${s.close_date || ''}">${formatDateTime(s.close_date)}</td>
                <td>${formatDuration(s.open_date, s.close_date)}</td>
                <td>$${parseFloat(s.opening_amount || 0).toFixed(2)}</td>
                <td>$${parseFloat(s.total_sales || 0).toFixed(2)}</td>
                <td>$${parseFloat(s.total_cash || 0).toFixed(2)}</td>
                <td>$${parseFloat(s.total_card || 0).toFixed(2)}</td>
                <td>$${parseFloat(s.expected_amount || 0).toFixed(2)}</td>
                <td>$${parseFloat(s.counted_amount || 0).toFixed(2)}</td>
                <td class="${diffClass}">${s.close_date ? '$' + diff.toFixed(2) : '—'}</td>
                <td>
                    <button class="action-btn-icon" onclick="viewCashDetail(${s.id})" title="Ver detalle">👁️</button>
                    ${isOpen && canEdit ? `<button class="action-btn-icon warning" onclick="adminForceCloseShift(${s.id}, '${(s.cashier_name || '').replace(/'/g, "\\'")}')" title="Cerrar turno">🔒</button>` : ''}
                    ${isOverdue ? `<button class="action-btn-icon danger" onclick="adminCancelShift(${s.id})" title="Cancelar turno vencido">🚫</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

async function viewCashDetail(shiftId) {
    try {
        const data = await apiCall(`/cash/${shiftId}`);
        const sales = data.sales || [];
        const c = data;
        const html = `
            <div class="cash-detail-card">
                <div class="cash-detail-header">
                    <h3>📋 Detalle del Turno #${c.id}</h3>
                    <span class="shift-status-pill ${c.status === 'open' ? 'open' : 'closed'}">${c.status === 'open' ? '🟢 Abierto' : '🔴 Cerrado'}</span>
                </div>
                <div class="cash-detail-grid">
                    <div><strong>Cajero:</strong> ${escapeHtml(c.cashier_name || '—')}</div>
                    <div><strong>Terminal:</strong> ${escapeHtml(c.terminal || '—')}</div>
                    <div><strong>Apertura:</strong> ${formatDateTime(c.open_date)}</div>
                    <div><strong>Cierre:</strong> ${formatDateTime(c.close_date)}</div>
                    <div><strong>Duración:</strong> ${formatDuration(c.open_date, c.close_date)}</div>
                    <div><strong>Ventas:</strong> ${sales.length} tickets</div>
                </div>
                <div class="cash-detail-summary">
                    <div class="detail-stat"><span>💰 Apertura</span><strong>$${parseFloat(c.opening_amount || 0).toFixed(2)}</strong></div>
                    <div class="detail-stat"><span>🛒 Ventas totales</span><strong>$${parseFloat(c.total_sales || 0).toFixed(2)}</strong></div>
                    <div class="detail-stat"><span>💵 Efectivo</span><strong>$${parseFloat(c.total_cash || 0).toFixed(2)}</strong></div>
                    <div class="detail-stat"><span>💳 Tarjeta</span><strong>$${parseFloat(c.total_card || 0).toFixed(2)}</strong></div>
                    <div class="detail-stat"><span>🎯 Esperado</span><strong>$${parseFloat(c.expected_amount || 0).toFixed(2)}</strong></div>
                    <div class="detail-stat"><span>💲 Contado</span><strong>$${parseFloat(c.counted_amount || 0).toFixed(2)}</strong></div>
                    <div class="detail-stat"><span>📊 Diferencia</span><strong class="${parseFloat(c.difference) > 0 ? 'cash-diff-positive' : (parseFloat(c.difference) < 0 ? 'cash-diff-negative' : 'cash-diff-zero')}">$${parseFloat(c.difference || 0).toFixed(2)}</strong></div>
                </div>
                ${c.notes ? `<div class="cash-detail-notes"><strong>📝 Notas:</strong> ${escapeHtml(c.notes)}</div>` : ''}
                <h4 style="margin-top:16px">Ventas del turno (${sales.length})</h4>
                <div class="cash-detail-sales" style="max-height: 280px; overflow-y:auto;">
                    ${sales.length === 0 ? '<p style="text-align:center;color:#888">Sin ventas</p>' : `
                    <table class="data-table">
                        <thead><tr><th>#</th><th>Hora</th><th>Total</th><th>Pago</th></tr></thead>
                        <tbody>
                            ${sales.map(s => `<tr>
                                <td>${s.id}</td>
                                <td>${new Date(s.sale_date).toLocaleTimeString('es-MX')}</td>
                                <td>$${parseFloat(s.total).toFixed(2)}</td>
                                <td>${s.payment_method === 'cash' ? '💵' : s.payment_method === 'card' ? '💳' : '🔀'}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>`}
                </div>
                <div class="cash-detail-actions">
                    <button class="btn btn-primary" onclick="printShiftDetail(${c.id})">🖨️ Imprimir</button>
                    <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
                </div>
            </div>
        `;
        showModal(`Turno #${c.id}`, html);
    } catch (error) {
        showToast('Error al cargar detalle del turno', 'error');
    }
}

function printShiftDetail(shiftId) {
    window.open(`/api/cash/${shiftId}/receipt?print=1`, '_blank');
}

async function adminForceCloseShift(shiftId, cashierName) {
    if (!confirm(`¿Estás seguro de cerrar el turno #${shiftId} de ${cashierName}?\nSe usará el monto esperado como contado.`)) return;
    try {
        const result = await apiCall(`/cash/${shiftId}/close`, 'POST', {
            counted_cash: null,
            notes: 'Cierre forzado por administrador'
        });
        showToast(`✓ Turno #${shiftId} cerrado por administrador`, 'success');
        if (activeShift && Number(activeShift.register?.id) === Number(shiftId)) {
            blockUntilShiftOpen('El turno activo fue cerrado por el administrador. Abre un turno para continuar.');
        } else {
            loadAllShifts();
        }
    } catch (error) {
        let msg = 'Error al cerrar turno';
        try { msg = JSON.parse(error.message).error || error.message; } catch {}
        showToast(msg, 'error');
    }
}

async function adminCancelShift(shiftId) {
    const reason = prompt(`¿Por qué cancelar el turno vencido #${shiftId}? Esta acción no se puede deshacer.`);
    if (!reason) return;
    if (!confirm(`¿Confirmas la cancelación del turno #${shiftId}?`)) return;
    try {
        await apiCall(`/cash/${shiftId}/close`, 'POST', {
            counted_cash: 0,
            notes: `CANCELADO: ${reason}`
        });
        showToast(`✓ Turno #${shiftId} cancelado`, 'success');
        if (activeShift && Number(activeShift.register?.id) === Number(shiftId)) {
            blockUntilShiftOpen('El turno activo fue cancelado. Abre un turno para continuar.');
        } else {
            loadAllShifts();
        }
    } catch (error) {
        let msg = 'Error al cancelar turno';
        try { msg = JSON.parse(error.message).error || error.message; } catch {}
        showToast(msg, 'error');
    }
}

async function loadCashData() {
    try {
        const sales = await apiCall('/sales/today');
        const tbody = document.getElementById('todaySalesTable');
        if (!tbody) return;

        tbody.innerHTML = (sales.sales || []).map(s => `
            <tr>
                <td>${new Date(s.sale_date).toLocaleTimeString('es-MX')}</td>
                <td>$${parseFloat(s.total).toFixed(2)}</td>
                <td>${s.payment_method === 'cash' ? '💵 Efectivo' : '💳 Tarjeta'}</td>
                <td>${escapeHtml(s.cashier_name || '-')}</td>
            </tr>
        `).join('') || '<tr><td colspan="4" style="text-align:center">Sin ventas hoy</td></tr>';

    } catch (error) {
        console.error('Error loading cash data:', error);
    }
}

async function loadCashHistory() {
    try {
        const data = await apiCall('/cash/history?limit=50');
        const tbody = document.getElementById('cashHistoryTable');
        if (!tbody) return;

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px">Sin cortes registrados</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(c => {
            const diff = parseFloat(c.difference) || 0;
            let diffClass = 'cash-diff-zero';
            let diffText = '$0.00';
            if (diff > 0.01) {
                diffClass = 'cash-diff-positive';
                diffText = `+$${diff.toFixed(2)}`;
            } else if (diff < -0.01) {
                diffClass = 'cash-diff-negative';
                diffText = `-$${Math.abs(diff).toFixed(2)}`;
            }

            return `
                <tr>
                    <td>${new Date(c.open_date).toLocaleString('es-MX')}</td>
                    <td>${c.close_date ? new Date(c.close_date).toLocaleString('es-MX') : '-'}</td>
                    <td>${escapeHtml(c.cashier_name || '-')}</td>
                    <td>$${parseFloat(c.expected_amount || 0).toFixed(2)}</td>
                    <td>$${parseFloat(c.counted_amount || 0).toFixed(2)}</td>
                    <td class="${diffClass}">${diffText}</td>
                    <td>
                        <button class="action-btn" onclick="reprintCashClose(${c.id})">🖨️ Recibo</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading cash history:', error);
    }
}

async function reprintCashClose(cashId) {
    try {
        const data = await apiCall(`/cash/${cashId}/receipt`);
        const c = data.cash;

        const diff = parseFloat(c.difference) || 0;
        let diffText = '';
        if (Math.abs(diff) < 0.01) diffText = '✓ Cuadre exacto';
        else if (diff > 0) diffText = `+$${diff.toFixed(2)} sobrante`;
        else diffText = `-$${Math.abs(diff).toFixed(2)} faltante`;

        const html = `
            <div class="ticket" id="cashClosePrint">
                <div class="ticket-header">
                    <h2>🥖 CORTE DE CAJA</h2>
                    <p>POS EXPENDIO BB</p>
                    <p>Corte #${c.id}</p>
                    <p>Apertura: ${new Date(c.open_date).toLocaleString('es-MX')}</p>
                    <p>${c.close_date ? 'Cierre: ' + new Date(c.close_date).toLocaleString('es-MX') : 'En curso'}</p>
                </div>
                <div class="ticket-items">
                    <div class="ticket-item"><span>Monto apertura:</span><span>$${parseFloat(c.opening_amount).toFixed(2)}</span></div>
                    <div class="ticket-item"><span>Ventas efectivo:</span><span>$${parseFloat(c.total_cash || 0).toFixed(2)}</span></div>
                    <div class="ticket-item"><span>Ventas tarjeta:</span><span>$${parseFloat(c.total_card || 0).toFixed(2)}</span></div>
                    <div class="ticket-item total"><span>TOTAL ventas:</span><span>$${parseFloat(c.total_sales || 0).toFixed(2)}</span></div>
                    <div class="ticket-item"><span>Esperado en caja:</span><span>$${parseFloat(c.expected_amount || 0).toFixed(2)}</span></div>
                    <div class="ticket-item"><span>Contado físico:</span><span>$${parseFloat(c.counted_amount || 0).toFixed(2)}</span></div>
                    <div class="ticket-item total"><span>DIFERENCIA:</span><span>${diffText}</span></div>
                </div>
                <div class="ticket-footer">
                    <p>Cajero: ${escapeHtml(c.cashier_name || '-')}</p>
                    <p>Reimpreso: ${new Date().toLocaleString('es-MX')}</p>
                </div>
            </div>
            <div class="ticket-actions">
                <button class="btn btn-primary" onclick="printCashClose()">🖨️ Imprimir</button>
                <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
            </div>
        `;
        showModal(`Corte #${c.id}`, html);
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

// Settings
const SETTINGS_MODULES = [
    { key: 'categories', icon: '🗂', title: 'Categorías', desc: 'Clasifica tus productos y asignales un color' },
    { key: 'users', icon: '👥', title: 'Usuarios', desc: 'Roles, accesos y contraseñas del personal' },
    { key: 'terminals', icon: '💳', title: 'Terminales', desc: 'Terminales de pago y comisiones' },
    { key: 'mp', icon: '🟦', title: 'Mercado Pago', desc: 'Vincula tu terminal Point y recibe pagos' },
    { key: 'purge', icon: '🧹', title: 'Depurar ventas', desc: 'Borra tickets, devoluciones e historial' },
    { key: 'resetstock', icon: '📦', title: 'Poner stock en 0', desc: 'Limpia el stock general de todos los productos' },
    { key: 'purgecatalog', icon: '🗑', title: 'Vaciar catálogo', desc: 'Elimina productos y categorías para reimportar' },
    { key: 'updates', icon: '🔄', title: 'Actualizaciones', desc: 'Busca e instala la última versión desde GitHub' },
    // Módulos futuros: agrega un bloque como los anteriores
    // { key: 'backup',   icon: '💾', title: 'Respaldo',   desc: 'Backup y restauración de la base de datos' },
    // { key: 'printer',  icon: '🖨', title: 'Impresora',  desc: 'Configuración de tickets e impresión' },
    // { key: 'company',  icon: '🏪', title: 'Negocio',    desc: 'Datos del establecimiento y ticket' },
];

function renderSettingsMenu() {
    const menu = document.getElementById('settingsMenu');
    if (!menu) return;
    menu.innerHTML = `
        <h3 class="settings-menu-title">⚙️ Configuración</h3>
        <div class="settings-grid">
            ${SETTINGS_MODULES.map(m => `
                <button class="settings-tile" onclick="showSettingsTab('${m.key}')">
                    <span class="settings-tile-icon">${m.icon}</span>
                    <span class="settings-tile-title">${m.title}</span>
                    <span class="settings-tile-desc">${m.desc}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function showSettingsMenu() {
    const menu = document.getElementById('settingsMenu');
    const content = document.getElementById('settingsContent');
    if (menu) menu.style.display = 'block';
    if (content) content.style.display = 'none';
}

function settingsBackBar() {
    return `
        <div class="settings-back-bar">
            <button class="btn btn-secondary" onclick="showSettingsMenu()">← Configuración</button>
        </div>
    `;
}

function showSettingsTab(tab) {
    const menu = document.getElementById('settingsMenu');
    const content = document.getElementById('settingsContent');
    if (menu) menu.style.display = 'none';
    if (content) content.style.display = 'block';
    
    switch(tab) {
        case 'categories':
            loadCategoriesSettings();
            break;
        case 'users':
            loadUsersSettings();
            break;
        case 'terminals':
            loadTerminalsSettings();
            break;
        case 'mp':
            loadMPSettings();
            break;
        case 'purge':
            loadPurgeSalesSettings();
            break;
        case 'resetstock':
            loadResetStockSettings();
            break;
        case 'purgecatalog':
            loadPurgeCatalogSettings();
            break;
        case 'updates':
            loadUpdatesSettings();
            break;
    }
}

async function loadCategoriesSettings() {
    try {
        const data = await apiCall('/settings/');
        const content = document.getElementById('settingsContent');
        
        content.innerHTML = `
            ${settingsBackBar()}
            <div class="section-header">
                <h3>Categorías</h3>
                <button class="btn btn-primary" onclick="showAddCategoryModal()">+ Agregar</button>
            </div>
            <table class="data-table">
                <thead>
                    <tr><th>Nombre</th><th>Color</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                    ${data.categories.map(c => `
                        <tr>
                            <td><span class="badge" style="background: ${c.color}20; color: ${c.color}">${c.name}</span></td>
                            <td><input type="color" value="${c.color}" disabled></td>
                            <td>
                                <button class="action-btn" onclick="editCategory(${c.id}, '${c.name}', '${c.color}')">Editar</button>
                                <button class="action-btn delete" onclick="deleteCategory(${c.id})">Eliminar</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        showToast('Error al cargar categorías', 'error');
    }
}

async function loadUsersSettings() {
    try {
        const data = await apiCall('/settings/');
        const content = document.getElementById('settingsContent');
        
        content.innerHTML = `
            ${settingsBackBar()}
            <div class="section-header">
                <h3>Usuarios</h3>
                <button class="btn btn-primary" onclick="showAddUserModal()">+ Agregar</button>
            </div>
            <table class="data-table">
                <thead>
                    <tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                    ${data.users.map(u => `
                        <tr>
                            <td>${u.username}</td>
                            <td>${u.full_name}</td>
                            <td><span class="badge badge-info">${u.role}</span></td>
                            <td>
                                <button class="action-btn" onclick="editUser(${u.id})">Editar</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        showToast('Error al cargar usuarios', 'error');
    }
}

async function loadTerminalsSettings() {
    try {
        const data = await apiCall('/settings/');
        const content = document.getElementById('settingsContent');
        
        content.innerHTML = `
            ${settingsBackBar()}
            <div class="section-header">
                <h3>Terminales de Pago</h3>
                <button class="btn btn-primary" onclick="showAddTerminalModal()">+ Agregar</button>
            </div>
            <table class="data-table">
                <thead>
                    <tr><th>ID</th><th>Nombre</th><th>Comisión %</th><th>Estado</th></tr>
                </thead>
                <tbody>
                    ${data.terminals.map(t => `
                        <tr>
                            <td>${t.id}</td>
                            <td>${t.name}</td>
                            <td>${t.commission_rate}%</td>
                            <td>${t.active ? '✓ Activa' : '✗ Inactiva'}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="4" style="text-align:center">Sin terminales configuradas</td></tr>'}
                </tbody>
            </table>
        `;
    } catch (error) {
        showToast('Error al cargar terminales', 'error');
    }
}

async function loadMPSettings() {
    const content = document.getElementById('settingsContent');
    content.innerHTML = `
        ${settingsBackBar()}
        <div class="section-header">
            <h3>🟦 Mercado Pago Point</h3>
        </div>
        <div class="maintenance-card" id="mpStatusCard">
            <p class="maintenance-desc">Revisando conexión…</p>
        </div>
    `;
    try {
        const status = await apiCall('/mp/status');
        if (status.connected) {
            const term = status.terminals && status.terminals.length
                ? status.terminals.map(t => `<span class="mp-term-chip ${t.operating_mode === 'PDV' ? 'mp-term-active' : ''}">${t.id.split('__').pop()} · ${t.operating_mode}${t.id === status.terminal_id ? ' · VINCULADA' : ''}</span>`).join('')
                : '<em>Sin terminales encontradas</em>';
            content.innerHTML = `
                ${settingsBackBar()}
                <div class="section-header">
                    <h3>🟦 Mercado Pago Point</h3>
                </div>
                <div class="maintenance-card">
                    <div class="mp-status-row">
                        <span class="mp-status-dot mp-status-ok"></span>
                        <strong>Conexión activa</strong>
                    </div>
                    <p class="maintenance-desc">Cuenta Mercado Pago vinculada. Tu terminal está lista para recibir pagos.</p>
                    <div class="mp-terminal-list">${term || ''}</div>
                    <div style="display:flex;gap:10px;margin-top:16px">
                        <button class="btn btn-primary" onclick="mpConnect()">Reconectar / Cambiar cuenta</button>
                        <button class="btn btn-danger" onclick="mpDisconnect()">Desconectar</button>
                    </div>
                </div>
            `;
        } else if (status.configured) {
            content.innerHTML = `
                ${settingsBackBar()}
                <div class="section-header">
                    <h3>🟦 Mercado Pago Point</h3>
                </div>
                <div class="maintenance-card">
                    <div class="mp-status-row">
                        <span class="mp-status-dot"></span>
                        <strong>Credenciales configuradas</strong>
                    </div>
                    <p class="maintenance-desc">Conecta tu cuenta para vincular la terminal y cobrar con Mercado Pago.</p>
                    <div style="display:flex;gap:10px;margin-top:16px">
                        <button class="btn btn-primary" onclick="mpConnect()">Conectar con Mercado Pago</button>
                    </div>
                </div>
            `;
        } else {
            content.innerHTML = `
                ${settingsBackBar()}
                <div class="section-header">
                    <h3>🟦 Mercado Pago Point</h3>
                </div>
                <div class="maintenance-card" id="mpConfigCard">
                    <p class="maintenance-desc">Configura las credenciales de tu aplicación de Mercado Pago (panel developers.mercadopago.com.mx → Your integrations).</p>
                    <form id="mpConfigForm" onsubmit="mpSaveConfig(event)">
                        <div class="form-group">
                            <label>Client ID (App ID)</label>
                            <input type="text" id="mpClientId" placeholder="Ej: 1234567890" required>
                        </div>
                        <div class="form-group">
                            <label>Client Secret</label>
                            <input type="password" id="mpClientSecret" placeholder="Secreto de la aplicación" required>
                        </div>
                        <div class="form-group">
                            <label>URL de redirección permitida (Redirect URI)</label>
                            <input type="text" id="mpRedirectUri" value="${status.host ? 'http://' + status.host + '/api/mp/callback' : ''}" readonly>
                            <p class="mp-hint">Registra esta URL en tu app de Mercado Pago → Redirect URIs. Después presiona "Conectar".</p>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width:100%">Guardar credenciales</button>
                    </form>
                </div>
            `;
        }
    } catch (error) {
        content.innerHTML = `
            ${settingsBackBar()}
            <div class="section-header">
                <h3>🟦 Mercado Pago Point</h3>
            </div>
            <div class="maintenance-card">
                <p class="maintenance-desc" style="color:#d71920">Error al consultar el estado: ${escapeHtml(error.message)}</p>
            </div>
        `;
    }
}

async function mpSaveConfig(e) {
    e.preventDefault();
    try {
        await apiCall('/mp/config', 'POST', {
            client_id: document.getElementById('mpClientId').value.trim(),
            client_secret: document.getElementById('mpClientSecret').value.trim()
        });
        showToast('Credenciales guardadas', 'success');
        loadMPSettings();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

async function mpConnect() {
    try {
        const data = await apiCall('/mp/auth-url');
        if (data.redirect_uri) {
            const host = location.host;
            const expected = 'http://' + host + '/api/mp/callback';
            if (data.redirect_uri !== expected) {
                showModal('URL de redirección', `
                    <p class="maintenance-desc">Esta instalación se consulta por <strong>${host}</strong>, pero la URL de redirección autorizada en Mercado Pago es <strong>${data.redirect_uri}</strong>.</p>
                    <p class="maintenance-desc">Registra la URL <code style="word-break:break-all">${data.redirect_uri}</code> en tu app de Mercado Pago (Redirect URIs) y vuelve a intentar.</p>
                `);
                return;
            }
        }
        window.location.href = data.url;
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

async function mpDisconnect() {
    if (!confirm('¿Desconectar Mercado Pago de este equipo?')) return;
    try {
        await apiCall('/mp/disconnect', 'POST', {});
        showToast('Mercado Pago desconectado', 'success');
        loadMPSettings();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

async function loadPurgeSalesSettings() {
    const content = document.getElementById('settingsContent');
    content.innerHTML = `
        ${settingsBackBar()}
        <div class="section-header">
            <h3>🧹 Depurar ventas y devoluciones</h3>
        </div>
        <div class="maintenance-card">
            <p class="maintenance-desc">Esta acción borra de forma permanente:</p>
            <ul class="maintenance-list">
                <li>Tickets y folios de ventas vendidos</li>
                <li>Devoluciones registradas</li>
                <li>Historial de movimientos de inventario</li>
                <li>Registros de auditoría (change_log)</li>
            </ul>
            <p class="maintenance-note">Se crea un respaldo automático antes de depurar. Los folios de venta reinician en 1. No recuperables desde la app.</p>
            <button class="btn btn-danger maintenance-btn" onclick="confirmPurgeSales()">🧹 Depurar ahora</button>
        </div>
    `;
}

async function loadResetStockSettings() {
    const content = document.getElementById('settingsContent');
    content.innerHTML = `
        ${settingsBackBar()}
        <div class="section-header">
            <h3>📦 Poner stock general en 0</h3>
        </div>
        <div class="maintenance-card">
            <p class="maintenance-desc">Esta acción deja en 0 las existencias de todos los productos activos, así como las cantidades pendientes de lotes.</p>
            <p class="maintenance-note">Se crea un respaldo automático antes de aplicar. El ajuste queda registrado en el historial de movimientos.</p>
            <button class="btn btn-danger maintenance-btn" onclick="confirmResetStock()">📦 Poner stock en 0</button>
        </div>
    `;
}

function confirmPurgeSales() {
    showConfirmDialog({
        title: '⚠️ Depurar ventas y devoluciones',
        message: 'Se borrarán TODOS los tickets, devoluciones e historial de movimientos. Se creará un respaldo automático antes de continuar. ¿Deseas continuar?',
        confirmText: 'Sí, depurar',
        cancelText: 'Cancelar',
        danger: true,
        onConfirm: async () => {
            try {
                showToast('Depurando…', 'info');
                const res = await apiCall('/maintenance/purge-sales', 'POST');
                await loadLots(true);
                await loadProducts();
                showToast(`Depurado: ${res.deleted.sales} ventas, ${res.deleted.sale_items} ítems, ${res.deleted.inventory_movements} movimientos (respaldo: ${res.backup})`, 'success');
            } catch (error) {
                showToast('Error al depurar: ' + error.message, 'error');
            }
        }
    });
}

function confirmResetStock() {
    showConfirmDialog({
        title: '⚠️ Poner stock general en 0',
        message: 'Todas las existencias de productos (y lotes pendientes) quedarán en 0. Se creará un respaldo automático antes de continuar. ¿Deseas continuar?',
        confirmText: 'Sí, poner en 0',
        cancelText: 'Cancelar',
        danger: true,
        onConfirm: async () => {
            try {
                showToast('Aplicando…', 'info');
                const res = await apiCall('/maintenance/reset-stock', 'POST');
                await loadLots(true);
                await loadProducts();
                showToast(`Stock en 0: ${res.products_adjusted} productos ajustados (respaldo: ${res.backup})`, 'success');
            } catch (error) {
                showToast('Error al poner stock en 0: ' + error.message, 'error');
            }
        }
    });
}

async function loadPurgeCatalogSettings() {
    const content = document.getElementById('settingsContent');
    content.innerHTML = `
        ${settingsBackBar()}
        <div class="section-header">
            <h3>🗑 Vaciar catálogo</h3>
        </div>
        <div class="maintenance-card">
            <p class="maintenance-desc">Esta acción elimina de forma permanente para reimportar tu CATALOGO.xlsx desde cero:</p>
            <ul class="maintenance-list">
                <li>Todos los productos registrados</li>
                <li>Categorías</li>
                <li>Lotes, ventas, devoluciones, promociones y precios</li>
                <li>Historial de movimientos y registros de auditoría</li>
            </ul>
            <p class="maintenance-note">Se crea un respaldo automático antes de vaciar. Después de esta acción importa tu Excel desde Importar → "Catálogo (POS anterior)".</p>
            <button class="btn btn-danger maintenance-btn" onclick="confirmPurgeCatalog()">🗑 Vaciar catálogo ahora</button>
        </div>
    `;
}

function confirmPurgeCatalog() {
    showConfirmDialog({
        title: '⚠️ Vaciar catálogo',
        message: 'Se eliminarán TODOS los productos, categorías, lotes, promociones e historial. Se creará un respaldo automático antes de continuar. ¿Deseas continuar?',
        confirmText: 'Sí, vaciar catálogo',
        cancelText: 'Cancelar',
        danger: true,
        onConfirm: async () => {
            try {
                showToast('Vaciando catálogo…', 'info');
                const res = await apiCall('/maintenance/purge-catalog', 'POST');
                await loadLots(true);
                await loadProducts();
                showToast(`Catálogo vaciado: ${res.deleted.products} productos, ${res.deleted.categories} categorías (respaldo: ${res.backup})`, 'success');
            } catch (error) {
                showToast('Error al vaciar catálogo: ' + error.message, 'error');
            }
        }
    });
}

async function loadUpdatesSettings() {
    const content = document.getElementById('settingsContent');
    let statusHtml = '';
    try {
        const status = await apiCall('/updates/status');
        statusHtml = `
            <div class="updates-info">
                <p><strong>Versión instalada:</strong> ${escapeHtml(status.version || '-')}</p>
                <p><strong>Commit local:</strong> <code>${escapeHtml(status.sha ? status.sha.slice(0, 7) : 'sin registro')}</code></p>
            </div>
        `;
    } catch (_) {}

    content.innerHTML = `
        ${settingsBackBar()}
        <div class="section-header">
            <h3>🔄 Actualizaciones</h3>
            <button class="btn btn-primary" onclick="checkUpdates()">🔍 Buscar actualizaciones</button>
        </div>
        <div class="maintenance-card">
            <p class="maintenance-desc">Busca e instala la última versión del sistema publicada en GitHub. La actualización <strong>no borra tus ventas ni tu catálogo</strong>: se toma un respaldo automático antes de aplicar.</p>
            <p class="maintenance-note">Este módulo requiere conexión a internet. El resto del sistema funciona 100% sin conexión.</p>
            <p class="maintenance-note">Al aplicar se reinicia el sistema automáticamente; tus datos permanecen intactos.</p>
            ${statusHtml}
            <div id="updatesResult"></div>
        </div>
    `;
}

async function checkUpdates() {
    const result = document.getElementById('updatesResult');
    if (!result) return;
    result.innerHTML = '<p class="maintenance-note" style="margin-top:8px">Consultando GitHub…</p>';
    try {
        const res = await apiCall('/updates/check', 'POST');
        if (!res.online) {
            result.innerHTML = `
                <div class="updates-result">
                    <p class="update-error">⚠️ ${escapeHtml(res.error || 'Sin conexión a internet')}</p>
                    <p class="maintenance-note">Verifica que el equipo tenga internet y vuelve a intentarlo.</p>
                </div>
            `;
            return;
        }
        if (res.error) {
            result.innerHTML = `<p class="update-error">⚠️ ${escapeHtml(res.error)}</p>`;
            return;
        }
        if (!res.update_disponible) {
            const head = res.head_sha ? res.head_sha.slice(0, 7) : '';
            result.innerHTML = `
                <div class="updates-result">
                    <p class="update-note">✅ Ya tienes la última versión (${escapeHtml(res.version_actual)}).</p>
                    <p class="maintenance-note">Última publicación en GitHub: <code>${escapeHtml(head)}</code>. No hay cambios por aplicar.</p>
                </div>
            `;
            return;
        }
        const changelog = (res.changelog || []).map(c =>
            `<tr><td><code>${escapeHtml(c.sha)}</code></td><td>${escapeHtml(c.message)}</td></tr>`
        ).join('');
        result.innerHTML = `
            <div class="updates-result">
                <p class="update-note">⬆️ Hay una versión nueva: <strong>${escapeHtml(res.version_actual)}</strong> → <strong>${escapeHtml(res.version_remota)}</strong></p>
                <table class="data-table">
                    <thead><tr><th>Commit</th><th>Cambios</th></tr></thead>
                    <tbody>${changelog}</tbody>
                </table>
                <button class="btn btn-danger maintenance-btn" onclick="applyUpdates()">⬇️ Aplicar actualización</button>
            </div>
        `;
    } catch (error) {
        result.innerHTML = `<p class="update-error">⚠️ Error: ${escapeHtml(error.message)}</p>`;
    }
}

function applyUpdates() {
    showConfirmDialog({
        title: '⬇️ Aplicar actualización',
        message: 'Se descargará la última versión, se hará un respaldo de tus ventas y el sistema se reiniciará automáticamente. ¿Deseas continuar?',
        confirmText: 'Sí, actualizar',
        cancelText: 'Cancelar',
        danger: true,
        onConfirm: async () => {
            try {
                showToast('Descargando e instalando…', 'info');
                const res = await apiCall('/updates/apply', 'POST');
                showToast(res.message || 'Actualización aplicada, reiniciando…', 'success');
                setTimeout(() => {
                    localStorage.setItem('pos_was_updated', '1');
                    location.reload();
                }, 4000);
            } catch (error) {
                showToast('Error al actualizar: ' + error.message, 'error');
            }
        }
    });
}

// Lots
async function loadLots(silent = false) {
    try {
        allLots = await apiCall('/lots/');
        indexLotsByProduct();
        if (!silent) renderLotsTable();
    } catch (error) {
        if (!silent) showToast('Error al cargar lotes', 'error');
    }
}

let lotsCutData = [];
async function loadLotsCut() {
    try {
        lotsCutData = await apiCall('/reports/inventory-cut');
        renderLotsCut();
    } catch (error) {
        console.warn('Error al cargar corte', error);
    }
}

function switchLotsTab(tab) {
    document.querySelectorAll('#lotsSection .lots-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.getElementById('lotsListPanel').style.display = tab === 'lotsList' ? 'block' : 'none';
}

let existenciasSelectedIndex = 0;
let existenciasFiltered = [];

function getExistenciasRows() {
    const q = (document.getElementById('lotsCutSearch')?.value || '').toLowerCase().trim();
    const inStock = lotsCutData.filter(p => (Number(p.effective_stock) || 0) > 0);
    if (!q) return inStock;
    return inStock.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.category_name && p.category_name.toLowerCase().includes(q)));
}

function renderLotsCut() {
    const list = document.getElementById('lotsCutList');
    if (!list) return;
    const filtered = getExistenciasRows();
    existenciasFiltered = filtered;

    const totalProducts = filtered.length;
    const totalLots = filtered.reduce((s, p) => s + (p.lots_count || 0), 0);
    const totalUnits = filtered.reduce((s, p) => s + (Number(p.effective_stock) || 0), 0);
    const totalValue = filtered.reduce((s, p) => s + (Number(p.value) || 0), 0);
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('cutStatProducts', totalProducts);
    setEl('cutStatLots', totalLots);
    setEl('cutStatUnits', totalUnits);
    setEl('cutStatValue', '$' + totalValue.toFixed(2));

    if (filtered.length === 0) {
        list.innerHTML = '<tr><td colspan="7" class="ex-empty">No hay productos con existencias.</td></tr>';
        existenciasSelectedIndex = 0;
        return;
    }

    list.innerHTML = filtered.map((p, i) => {
        const stock = Number(p.effective_stock) || 0;
        const stockClass = stock > 0 ? 'lot-cut-stock-ok' : 'lot-cut-stock-out';
        const cat = p.category_name || 'Sin categoría';
        const catColor = p.category_color || '#6b7280';
        const selected = i === existenciasSelectedIndex ? 'ex-row-selected' : '';
        return `
        <tr class="ex-row ${selected}" data-index="${i}" data-id="${p.id}"
            onclick="selectExistenciasRow(${i})" ondblclick="showExistenciasDetail(${i})">
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td><code class="ex-barcode">${escapeHtml(p.barcode || '—')}</code></td>
            <td><span class="lot-cut-cat" style="background:${catColor}20;color:${catColor}">${escapeHtml(cat)}</span></td>
            <td class="num">${p.lots_count || 0}</td>
            <td class="num"><span class="ex-stock ${stockClass}">${stock} u.</span></td>
            <td class="num">$${parseFloat(p.price || 0).toFixed(2)}</td>
            <td class="num">$${parseFloat(p.value || 0).toFixed(2)}</td>
        </tr>`;
    }).join('');
}

function selectExistenciasRow(index) {
    const filtered = existenciasFiltered;
    if (!filtered.length) return;
    const rows = document.querySelectorAll('#lotsCutList .ex-row');
    if (!rows.length) return;
    const next = Math.max(0, Math.min(index, filtered.length - 1));
    existenciasSelectedIndex = next;
    rows.forEach((r, i) => {
        r.classList.toggle('ex-row-selected', i === next);
        if (i === next) try { r.scrollIntoView({ block: 'nearest' }); } catch {}
    });
}

function showExistenciasDetail(index) {
    const p = existenciasFiltered[index];
    if (!p) return;
    const stock = Number(p.effective_stock) || 0;
    const cat = p.category_name || 'Sin categoría';
    const catColor = p.category_color || '#6b7280';
    const now = new Date();

    const lotsHtml = (p.lots && p.lots.length) ? p.lots.map(l => {
        const qty = Number(l.current_quantity) || 0;
        const exp = l.expiry_date ? new Date(l.expiry_date) : null;
        const days = exp ? Math.round((exp - now) / (24 * 60 * 60 * 1000)) : null;
        let badge = '';
        if (days !== null) {
            if (days < 0) badge = `<span class="lot-cut-tag lot-cut-tag-exp">Vencido ${Math.abs(days)}d</span>`;
            else if (days <= 7) badge = `<span class="lot-cut-tag lot-cut-tag-exp">Vence ${days}d</span>`;
            else if (days <= 30) badge = `<span class="lot-cut-tag lot-cut-tag-warn">${days}d</span>`;
        }
        const expStr = l.expiry_date || '—';
        return `<tr>
            <td><span class="lot-cut-batch">${escapeHtml(l.batch_number || 's/lote')}</span></td>
            <td class="num">${qty}</td>
            <td class="num">$${parseFloat(l.sale_price || 0).toFixed(2)}</td>
            <td>${expStr} ${badge}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="4" class="lot-cut-no-lots">Sin sublotes (stock general)</td></tr>`;

    showModal('📦 Existencias — ' + escapeHtml(p.name), `
        <table class="lot-cut-table">
            <tbody>
                <tr><td style="width:140px;color:var(--text-light)">Código</td><td><code>${escapeHtml(p.barcode || '—')}</code></td></tr>
                <tr><td style="color:var(--text-light)">Categoría</td><td><span class="lot-cut-cat" style="background:${catColor}20;color:${catColor}">${escapeHtml(cat)}</span></td></tr>
                <tr><td style="color:var(--text-light)">Existencias</td><td><span class="ex-stock ${stock > 0 ? 'lot-cut-stock-ok' : 'lot-cut-stock-out'}">${stock} u.</span></td></tr>
                <tr><td style="color:var(--text-light)">Precio venta</td><td>$${parseFloat(p.price || 0).toFixed(2)}</td></tr>
                <tr><td style="color:var(--text-light)">Valor inventario</td><td>$${parseFloat(p.value || 0).toFixed(2)}</td></tr>
            </tbody>
        </table>
        <div class="form-section-title" style="margin-top:14px">🧾 Sublotes</div>
        <table class="lot-cut-table">
            <thead><tr><th>Lote</th><th style="text-align:right">Cant.</th><th style="text-align:right">P.Venta</th><th>Caducidad</th></tr></thead>
            <tbody>${lotsHtml}</tbody>
        </table>
        <div class="ex-detail-hint">Verifica contra el conteo físico en anaquel.</div>
    `);
}

function handleExistenciasKey(e) {
    const section = document.getElementById('existenciasSection');
    if (!section || !section.classList.contains('active')) return;
    const overlay = document.getElementById('modalOverlay');
    if (overlay && overlay.classList.contains('active')) return;
    if (e.target && e.target.closest('input, textarea, select, button')) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (e.target.id === 'lotsCutSearch') {
                e.preventDefault();
                selectExistenciasRow(e.key === 'ArrowDown' ? existenciasSelectedIndex + 1 : existenciasSelectedIndex - 1);
            }
            return;
        }
        if (e.key === 'Enter' && e.target.id === 'lotsCutSearch') {
            e.preventDefault();
            showExistenciasDetail(existenciasSelectedIndex);
            return;
        }
        return;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectExistenciasRow(existenciasSelectedIndex + 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectExistenciasRow(existenciasSelectedIndex - 1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        showExistenciasDetail(existenciasSelectedIndex);
    }
}

document.addEventListener('keydown', (e) => {
    const section = document.getElementById('existenciasSection');
    if (!section || !section.classList.contains('active')) return;
    const overlay = document.getElementById('modalOverlay');
    if (overlay && overlay.classList.contains('active')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        handleExistenciasKey(e);
    }
});

function filterLots() {
    renderLotsTable();
}

function getLotStatus(lot) {
    const days = lot.days_left;
    if (days === null || days === undefined) return { key: 'ok', label: 'OK', badge: 'badge-success' };
    if (days < 0) return { key: 'expired', label: 'Caducado', badge: 'badge-danger', daysText: `Caducó hace ${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'}` };
    if (days <= 3) return { key: 'critical', label: 'Crítico', badge: 'badge-danger', daysText: `Vence en ${days} día${days === 1 ? '' : 's'}` };
    if (days <= 30) return { key: 'warning', label: 'Próximo', badge: 'badge-warning', daysText: `Vence en ${days} día${days === 1 ? '' : 's'}` };
    return { key: 'ok', label: 'OK', badge: 'badge-success', daysText: `Vence en ${days} días` };
}

function renderLotsTable() {
    const grid = document.getElementById('lotsGrid');
    if (!grid) return;

    const search = (document.getElementById('lotSearch')?.value || '').toLowerCase().trim();
    const filtered = allLots.filter(l =>
        l.product_name.toLowerCase().includes(search) ||
        (l.barcode && l.barcode.toLowerCase().includes(search)) ||
        (l.batch_number && l.batch_number.toLowerCase().includes(search))
    );

    const counts = { expired: 0, critical: 0, warning: 0, ok: 0 };
    allLots.forEach(l => counts[getLotStatus(l).key]++);
    document.getElementById('statExpired').textContent = `${counts.expired} Caducados`;
    document.getElementById('statCritical').textContent = `${counts.critical} Críticos (≤3 días)`;
    document.getElementById('statWarning').textContent = `${counts.warning} Próximos (4-30 días)`;
    document.getElementById('statOk').textContent = `${counts.ok} OK`;

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="lots-empty">${search ? 'No hay lotes que coincidan con la búsqueda.' : 'Sin lotes. Crea uno con el botón "+ Nuevo Lote".'}</div>`;
        return;
    }

    grid.innerHTML = filtered.map(lot => {
        const status = getLotStatus(lot);
        const qty = Number(lot.current_quantity) || 0;
        const initial = Number(lot.initial_quantity) || 0;
        const price = parseFloat(lot.sale_price != null ? lot.sale_price : lot.price) || 0;
        const catColor = lot.category_color || '#6b7280';
        const catName = lot.category_name || 'Sin categoría';
        const progress = initial > 0 ? Math.round((qty / initial) * 100) : 0;
        const progressColor = status.key === 'expired' || status.key === 'critical' ? 'var(--danger,#d71920)' : 'var(--primary)';

        const daysEl = status.daysText
            ? `<div class="lot-card-days ${status.key}">${status.daysText}</div>`
            : `<div class="lot-card-days ok">Caducidad ${escapeHtml(lot.expiry_date || '—')}</div>`;

        return `
            <div class="lot-card lot-card-${status.key}">
                <div class="lot-card-top">
                    <span class="badge ${status.badge}">${status.label.toUpperCase()}</span>
                    <span class="lot-card-barcode">${escapeHtml(lot.barcode || '')}</span>
                </div>
                <div class="lot-card-title">
                    <strong>${escapeHtml(lot.product_name)}</strong>
                    <span class="lot-card-cat" style="background:${catColor}20;color:${catColor}">${escapeHtml(catName)}</span>
                </div>
                <div class="lot-card-batch">
                    <span class="lot-batch-code">#${escapeHtml(lot.batch_number || 's/lote')}</span>
                    <span class="lot-card-price">$${price.toFixed(2)}</span>
                </div>
                <div class="lot-progress">
                    <div class="lot-progress-bar"><div class="lot-progress-fill" style="width:${progress}%;background:${progressColor}"></div></div>
                    <span>${qty} / ${initial} unidades</span>
                </div>
                ${daysEl}
                <div class="lot-card-actions">
                    <button class="action-btn" onclick="showEditLotModal(${lot.id})">Editar</button>
                    <button class="action-btn" onclick="showAdjustStockModal(${lot.id})">Ajustar</button>
                    <button class="action-btn delete" onclick="deleteLot(${lot.id})">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}

function showAddLotModal() {
    if (!allProducts || allProducts.length === 0) {
        showToast('Cargando productos...', 'info');
        loadProducts().then(showAddLotModal);
        return;
    }

    showModal('Nuevo Lote', `
        <form id="addLotForm" onsubmit="saveLot(event)">
            <div class="form-group">
                <label>Producto *</label>
                <div class="lot-product-search-wrap">
                    <input type="text" id="lotProductSearch" class="lot-product-search"
                        placeholder="Escanea código o escribe para buscar..."
                        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                        oninput="onLotProductSearchChange()" onkeydown="handleLotProductKey(event)">
                    <button type="button" class="lot-product-clear" id="lotProductClear" onclick="clearLotProductSearch()" style="display:none">✕</button>
                </div>
                <input type="hidden" name="product_id" id="lotProductId" required>
                <div class="lot-search-overlay" id="lotSearchOverlay" style="display:none"></div>
                <div id="lotProductSelected" class="lot-product-selected" style="display:none">
                    <div class="lot-selected-head">
                        <div>
                            <strong id="lotSelectedName">—</strong>
                            <span class="lot-selected-cat" id="lotSelectedCat"></span>
                        </div>
                        <button type="button" class="lot-selected-clear" onclick="clearLotProductSelection()">Cambiar producto</button>
                    </div>
                    <div class="lot-selected-stock" id="lotSelectedStock"></div>
                    <div class="lot-selected-lots" id="lotSelectedLots"></div>
                </div>
            </div>

            <div class="form-group">
                <label>Número de Lote</label>
                <input type="text" name="batch_number" placeholder="Ej: L2026-001">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Fecha de Producción</label>
                    <input type="date" name="production_date">
                </div>
                <div class="form-group">
                    <label>Fecha de Caducidad *</label>
                    <input type="date" name="expiry_date" id="lotExpiryDate" required oninput="validateLotForm()">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Cantidad *</label>
                    <input type="number" name="initial_quantity" id="lotQuantity" step="1" min="1" required oninput="updateLotStockPreview()">
                </div>
                <div class="form-group">
                    <label>Ubicación</label>
                    <input type="text" name="location" value="principal">
                </div>
            </div>

            <div class="form-group">
                <label>Precio de venta del lote *</label>
                <input type="number" name="sale_price" id="lotSalePrice" step="0.01" min="0" required oninput="validateLotForm()">
                <small class="lot-price-hint" id="lotPriceHint">Se guarda como precio de venta al público para este lote específico. Si se deja en blanco, se usará el precio original del producto.</small>
            </div>

            <div class="lot-stock-preview" id="lotStockPreview" style="display:none">
                <div class="lot-preview-row">
                    <span>Stock general (disponible):</span>
                    <strong id="lotPreviewCurrent">0</strong>
                </div>
                <div class="lot-preview-row">
                    <span>Este lote moverá:</span>
                    <strong id="lotPreviewAdd">0</strong>
                </div>
                <div class="lot-preview-row">
                    <span>Stock total después:</span>
                    <strong id="lotPreviewTotal">0</strong>
                </div>
                <div class="lot-preview-row" id="lotPreviewMaxRow" style="display:none">
                    <span id="lotPreviewMax"></span>
                </div>
            </div>

            <button type="submit" id="lotSaveBtn" class="btn btn-primary" style="width:100%" disabled>Guardar Lote</button>
        </form>
    `, {
        enterNav: {
            primarySelector: '#lotSaveBtn',
            skipSelectors: ['#lotProductSearch', 'textarea', 'select[multiple]']
        }
    });

    setTimeout(() => {
        const inp = document.getElementById('lotProductSearch');
        if (inp) inp.focus();
    }, 50);
}

let lotProductSelected = null;
let lotSearchSelectedIndex = 0;

function onLotProductSearchChange() {
    const inp = document.getElementById('lotProductSearch');
    if (!inp) return;
    const v = inp.value || '';
    const clearBtn = document.getElementById('lotProductClear');
    if (clearBtn) clearBtn.style.display = v ? 'block' : 'none';
    lotSearchSelectedIndex = 0;
    renderLotProductSearch();
}

function clearLotProductSearch() {
    const inp = document.getElementById('lotProductSearch');
    if (inp) {
        inp.value = '';
        inp.focus();
    }
    const clearBtn = document.getElementById('lotProductClear');
    if (clearBtn) clearBtn.style.display = 'none';
    renderLotProductSearch();
}

function handleLotProductKey(e) {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        lotSearchSelectedIndex = Math.min(lotSearchSelectedIndex + 1, getLotFilteredProducts().length - 1);
        renderLotProductSearch();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        lotSearchSelectedIndex = Math.max(lotSearchSelectedIndex - 1, 0);
        renderLotProductSearch();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const q = (document.getElementById('lotProductSearch')?.value || '').trim();
        if (!q) return;
        if (looksLikeBarcode(q)) {
            tryLotBarcodeLookup(q);
        } else {
            const filtered = getLotFilteredProducts();
            if (filtered[lotSearchSelectedIndex]) selectLotProduct(filtered[lotSearchSelectedIndex].id);
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        clearLotProductSearch();
    }
}

function getLotFilteredProducts() {
    const q = (document.getElementById('lotProductSearch')?.value || '').toLowerCase().trim();
    if (!q) return [];
    return allProducts.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    ).slice(0, 30);
}

function renderLotProductSearch() {
    const overlay = document.getElementById('lotSearchOverlay');
    if (!overlay) return;
    const filtered = getLotFilteredProducts();
    const q = (document.getElementById('lotProductSearch')?.value || '').trim();
    if (!q || filtered.length === 0) {
        overlay.style.display = 'none';
        if (!q) overlay.innerHTML = '';
        else overlay.innerHTML = '<div class="lot-search-empty">Sin resultados</div>';
        return;
    }
    overlay.style.display = 'block';
    overlay.innerHTML = filtered.map((p, i) => `
        <div class="lot-search-item ${i === lotSearchSelectedIndex ? 'selected' : ''}" onclick="selectLotProduct(${p.id})">
            <div class="lot-search-code">${escapeHtml(p.barcode || '—')}</div>
            <div class="lot-search-info">
                <div class="lot-search-name">${escapeHtml(p.name)}</div>
                <div class="lot-search-cat">${escapeHtml(p.category_name || 'Sin categoría')}</div>
            </div>
            <div class="lot-search-price">$${parseFloat(p.price).toFixed(2)}</div>
        </div>
    `).join('');
}

async function tryLotBarcodeLookup(barcode) {
    try {
        const product = await apiCall(`/products/barcode/${encodeURIComponent(barcode)}`);
        selectLotProduct(product.id);
    } catch (e) {
        const filtered = getLotFilteredProducts();
        if (filtered[lotSearchSelectedIndex]) selectLotProduct(filtered[lotSearchSelectedIndex].id);
        else showToast('Código no encontrado', 'error');
    }
}

async function selectLotProduct(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    document.getElementById('lotProductId').value = productId;
    document.getElementById('lotSelectedName').textContent = product.name;
    const cat = document.getElementById('lotSelectedCat');
    if (product.category_name) {
        cat.textContent = product.category_name;
        cat.style.display = 'inline-block';
        cat.style.background = (product.category_color || '#6b7280') + '20';
        cat.style.color = product.category_color || '#6b7280';
    } else {
        cat.style.display = 'none';
    }
    document.getElementById('lotProductSelected').style.display = 'block';
    document.getElementById('lotSearchOverlay').style.display = 'none';
    const search = document.getElementById('lotProductSearch');
    if (search) search.value = '';
    const clearBtn = document.getElementById('lotProductClear');
    if (clearBtn) clearBtn.style.display = 'none';
    lotProductSelected = product;

    const priceInput = document.getElementById('lotSalePrice');
    if (priceInput && !priceInput.value) {
        priceInput.value = parseFloat(product.price || 0).toFixed(2);
    }
    const priceHint = document.getElementById('lotPriceHint');
    if (priceHint) {
        priceHint.textContent = `Precio original del producto: $${parseFloat(product.price || 0).toFixed(2)} · Costo: $${parseFloat(product.cost || 0).toFixed(2)}`;
    }

    const stockBox = document.getElementById('lotSelectedStock');
    const lotsBox = document.getElementById('lotSelectedLots');
    stockBox.innerHTML = '<div class="lot-loading">Cargando stock actual…</div>';
    lotsBox.innerHTML = '';
    try {
        const summary = await apiCall(`/lots/by-product/${productId}/summary`);
        const cur = Number(summary.effective_stock) || 0;
        const lotsTotal = Number(summary.lots_total) || 0;
        const productStock = Number(summary.product_stock) || 0;
        stockBox.innerHTML = `
            <div class="lot-stock-row">
                <span>Stock general:</span>
                <strong class="${productStock > 0 ? 'lot-stock-ok' : 'lot-stock-out'}">${productStock}</strong>
            </div>
            <div class="lot-stock-row">
                <span>En lotes existentes:</span>
                <strong>${lotsTotal}</strong>
            </div>
            <div class="lot-stock-row">
                <span>Total:</span>
                <strong>${cur}</strong>
            </div>
        `;
        if (summary.lots && summary.lots.length) {
            lotsBox.innerHTML = `
                <div class="lot-existing-title">Lotes existentes (${summary.lots.length}):</div>
                ${summary.lots.map(l => {
                    const exp = l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('es-MX') : '—';
                    return `<div class="lot-existing-row">
                        <span><strong>${Number(l.current_quantity)}</strong> u.</span>
                        <span>${escapeHtml(l.batch_number || 's/lote')}</span>
                        <span>$${parseFloat(l.sale_price).toFixed(2)}</span>
                        <span>${exp}</span>
                    </div>`;
                }).join('')}
            `;
        } else {
            lotsBox.innerHTML = '';
        }
        lotProductSelected._effectiveStock = cur;
        lotProductSelected._baseStock = productStock;
        const qtyInput = document.getElementById('lotQuantity');
        if (qtyInput) {
            qtyInput.max = productStock;
            qtyInput.placeholder = productStock > 0 ? `Máximo: ${productStock}` : 'Sin stock general';
        }
    } catch (e) {
        stockBox.innerHTML = '<div class="lot-loading" style="color:#d71920">Error al cargar stock</div>';
        lotProductSelected._effectiveStock = 0;
        lotProductSelected._baseStock = 0;
    }
    updateLotStockPreview();
    validateLotForm();
}

function clearLotProductSelection() {
    lotProductSelected = null;
    document.getElementById('lotProductId').value = '';
    document.getElementById('lotProductSelected').style.display = 'none';
    document.getElementById('lotProductSearch').focus();
    updateLotStockPreview();
    validateLotForm();
}

function updateLotStockPreview() {
    const preview = document.getElementById('lotStockPreview');
    const qtyInput = document.getElementById('lotQuantity');
    if (!preview || !qtyInput) return;
    if (!lotProductSelected) {
        preview.style.display = 'none';
        return;
    }
    const cur = Number(lotProductSelected._effectiveStock || 0);
    const baseMax = Number(lotProductSelected._baseStock ?? (lotProductSelected.stock ?? 0));
    const add = parseFloat(qtyInput.value) || 0;
    document.getElementById('lotPreviewCurrent').textContent = baseMax;
    document.getElementById('lotPreviewAdd').textContent = add;
    document.getElementById('lotPreviewTotal').textContent = cur + add;
    const maxRow = document.getElementById('lotPreviewMaxRow');
    const maxEl = document.getElementById('lotPreviewMax');
    if (maxEl && maxRow) {
        maxRow.style.display = 'block';
        if (baseMax <= 0) {
            maxEl.textContent = '⚠ Sin existencias en el stock general para crear un lote';
            maxEl.style.color = '#d71920';
        } else if (add > baseMax) {
            maxEl.textContent = `⚠ Máximo: ${baseMax} pieza(s) del stock general`;
            maxEl.style.color = '#d71920';
        } else {
            maxEl.textContent = `Máximo desde stock general: ${baseMax}`;
            maxEl.style.color = '#6b7280';
        }
    }
    preview.style.display = 'block';
    validateLotForm();
}

function validateLotForm() {
    const btn = document.getElementById('lotSaveBtn');
    if (!btn) return;
    const productId = document.getElementById('lotProductId')?.value;
    const qty = parseFloat(document.getElementById('lotQuantity')?.value);
    const exp = document.getElementById('lotExpiryDate')?.value;
    const price = parseFloat(document.getElementById('lotSalePrice')?.value);
    const baseMax = Number(lotProductSelected?._baseStock ?? (lotProductSelected?.stock ?? 0));
    const valid = productId && qty > 0 && qty <= baseMax && exp && price >= 0;
    btn.disabled = !valid;
}

async function saveLot(e) {
    e.preventDefault();
    if (!lotProductSelected) {
        showToast('Selecciona un producto', 'error');
        return;
    }
    const form = e.target;
    const formData = new FormData(form);

    const qty = parseFloat(formData.get('initial_quantity'));
    if (!qty || qty <= 0) {
        showToast('La cantidad debe ser mayor a 0', 'error');
        return;
    }

    const productId = parseInt(formData.get('product_id'));
    const product = lotProductSelected;
    const originalPrice = parseFloat(product.price) || 0;
    const baseMax = Number(product._baseStock ?? (product.stock ?? 0));
    if (qty > baseMax) {
        showToast(`Máximo disponible del stock general: ${baseMax} pieza(s)`, 'error');
        return;
    }

    const data = {
        product_id: productId,
        batch_number: formData.get('batch_number') || '',
        production_date: formData.get('production_date') || null,
        expiry_date: formData.get('expiry_date'),
        initial_quantity: qty,
        location: formData.get('location') || 'principal',
        sale_price: parseFloat(formData.get('sale_price')) || originalPrice
    };

    try {
        const result = await apiCall('/lots/', 'POST', data);
        const diff = data.sale_price - originalPrice;
        const diffMsg = Math.abs(diff) < 0.01 ? '' : (diff > 0 ? ` (+$${diff.toFixed(2)} vs original)` : ` (-$${Math.abs(diff).toFixed(2)} vs original)`);
        showToast(`Lote guardado. ${qty} pieza(s) movidas del stock general (${baseMax} → ${baseMax - qty}). Precio: $${data.sale_price.toFixed(2)}${diffMsg}`, 'success');
        lotProductSelected = null;
        closeModal();
        await Promise.all([loadLots(), loadProducts(), loadInventory()]);
    } catch (error) {
        let msg = 'Error';
        try { msg = JSON.parse(error.message).error || error.message; } catch {}
        showToast(msg, 'error');
    }
}

function showEditLotModal(lotId) {
    const lot = allLots.find(l => l.id === lotId);
    if (!lot) return;

    showModal('Editar Lote', `
        <form id="editLotForm" onsubmit="updateLot(event, ${lotId})">
            <div class="form-group">
                <label>Producto</label>
                <input type="text" value="${escapeHtml(lot.product_name)}" disabled>
            </div>
            <div class="form-group">
                <label>Número de Lote</label>
                <input type="text" name="batch_number" value="${escapeHtml(lot.batch_number || '')}">
            </div>
            <div class="form-group">
                <label>Fecha de Caducidad *</label>
                <input type="date" name="expiry_date" value="${lot.expiry_date}" required>
            </div>
            <div class="form-group">
                <label>Ubicación</label>
                <input type="text" name="location" value="${escapeHtml(lot.location || 'principal')}">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Actualizar</button>
        </form>
    `, {
        enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
    });
}

async function updateLot(e, lotId) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    const data = {
        batch_number: formData.get('batch_number') || '',
        expiry_date: formData.get('expiry_date'),
        location: formData.get('location') || 'principal'
    };

    try {
        await apiCall(`/lots/${lotId}`, 'PUT', data);
        showToast('Lote actualizado', 'success');
        closeModal();
        await loadLots();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

async function showAdjustStockModal(lotId) {
    const lot = allLots.find(l => l.id === lotId);
    if (!lot) return;
    let baseStock = getProductBaseStock(lot.product_id);
    try {
        const summary = await apiCall(`/lots/by-product/${lot.product_id}/summary`);
        baseStock = Number(summary.product_stock) || 0;
    } catch (_) {}
    const curQty = parseFloat(lot.current_quantity) || 0;
    const newMax = curQty + baseStock;

    showModal('Ajustar Stock - ' + lot.product_name, `
        <form id="adjustForm" onsubmit="adjustLotStock(event, ${lotId})">
            <div class="form-group">
                <label>Stock Actual</label>
                <input type="text" value="${curQty}" disabled>
            </div>
            <div class="form-group">
                <label>Nueva Cantidad *</label>
                <input type="number" name="current_quantity" step="1" min="0" max="${newMax}" value="${curQty}" required>
                <small style="color:#6b7280;font-size:11px">Máximo: ${newMax} (incluye ${baseStock} disponible(s) del stock general). Si bajas la cantidad, las piezas regresan al stock general.</small>
            </div>
            <div class="form-group">
                <label>Motivo del Ajuste</label>
                <input type="text" name="reason" placeholder="Ej: Conteo físico, merma, etc.">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Ajustar</button>
        </form>
    `);
}

async function adjustLotStock(e, lotId) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    const newQty = parseFloat(formData.get('current_quantity'));
    const maxInput = document.querySelector('#adjustForm input[name="current_quantity"]');
    if (maxInput && maxInput.max !== '' && newQty > parseFloat(maxInput.max)) {
        showToast(`No hay suficiente stock general: máximo permitido ${parseFloat(maxInput.max)}`, 'error');
        return;
    }

    try {
        const result = await apiCall('/lots/adjust-stock', 'POST', {
            lot_id: lotId,
            current_quantity: newQty,
            reason: formData.get('reason') || ''
        });
        showToast(`Stock ajustado: ${result.previous} → ${result.new} · Stock general: ${result.base_previous} → ${result.base_new}`, 'success');
        closeModal();
        await Promise.all([loadLots(), loadLotsCut(), loadProducts()]);
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

function deleteLot(lotId) {
    const lot = allLots.find(l => l.id === lotId);
    const qty = lot ? (parseFloat(lot.current_quantity) || 0) : 0;
    showConfirmDialog({
        title: 'Eliminar Lote',
        message: `¿Deseas eliminar este lote?<br><small>${qty > 0 ? `Sus ${qty} pieza(s) regresarán al stock general.` : 'El lote no tiene existencias.'}</small>`,
        confirmText: 'Eliminar',
        danger: true,
        onConfirm: async () => {
            try {
                await apiCall(`/lots/${lotId}`, 'DELETE');
                showToast(`Lote eliminado. ${qty > 0 ? ` ${qty} pieza(s) regresadas al stock general.` : ''}`, 'success');
                await Promise.all([loadLots(), loadLotsCut(), loadProducts()]);
            } catch (error) {
                let msg = 'No se pudo eliminar el lote';
                try {
                    const data = JSON.parse(error.message);
                    if (data.error) msg = data.error;
                } catch {}
                showErrorDialog(msg);
                loadLots();
            }
        }
    });
}

async function showLotOverrideModal(cartIndex) {
    const item = cart[cartIndex];
    if (!item) return;

    const productLots = allLots
        .filter(l => l.product_id === item.id && l.current_quantity > 0)
        .sort((a, b) => a.days_left - b.days_left);

    if (productLots.length === 0) {
        showToast('No hay lotes disponibles', 'error');
        return;
    }

    const lotsHtml = productLots.map(lot => `
        <label class="lot-option">
            <input type="radio" name="lot_id" value="${lot.id}"
                ${lot.id === item.lot_id ? 'checked' : ''}
                data-expiry="${lot.expiry_date}"
                data-days="${lot.days_left}"
                data-qty="${lot.current_quantity}">
            <span>
                Lote: ${escapeHtml(lot.batch_number || 's/n')} ·
                Caduca: ${lot.expiry_date}
                (${lot.is_expired ? 'CADUCADO' : lot.days_left + ' días'})
                · Existencia: ${parseFloat(lot.current_quantity).toFixed(0)}
            </span>
        </label>
    `).join('');

    showModal(`Cambiar lote - ${escapeHtml(item.name)}`, `
        <p style="margin-bottom:12px;color:#6b7280">Lote actual: <strong>${item.lot_expiry || 'N/A'}</strong> (${item.lot_days} días)</p>
        <form id="lotForm" onsubmit="applyLotOverride(event, ${cartIndex})">
            <div class="form-group">${lotsHtml}</div>
            <button type="submit" class="btn btn-primary" style="width:100%">Aplicar</button>
        </form>
    `);
}

function applyLotOverride(e, cartIndex) {
    e.preventDefault();
    const selected = document.querySelector('input[name="lot_id"]:checked');
    if (!selected) return;

    const lotId = parseInt(selected.value);
    const lot = allLots.find(l => l.id === lotId);
    if (!lot) return;

    cart[cartIndex].lot_id = lot.id;
    cart[cartIndex].lot_expiry = lot.expiry_date;
    cart[cartIndex].lot_days = lot.days_left;
    cart[cartIndex].lot_quantity = lot.current_quantity;

    closeModal();
    renderCart();
    showToast('Lote actualizado', 'success');
}

// Modals
let _modalCloseCallback = null;

function focusPrimaryButton(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const btn = container.querySelector('button.primary, .btn-primary, button.btn-primary, button.btn-success, button.btn-warning, button.btn-danger, button:not([disabled]), input:not([disabled])');
    if (btn) {
        try { btn.focus(); } catch {}
    }
}

function _focusElementById(id) {
    const el = document.getElementById(id);
    if (el) { try { el.focus(); } catch {} }
}

function showModal(title, content, { onClose = null, enterNav = null, primaryFocusId = null } = {}) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('modalOverlay').classList.add('active');
    _modalCloseCallback = onClose;
    setTimeout(() => {
        if (primaryFocusId) {
            const el = document.getElementById(primaryFocusId);
            if (el) { try { el.focus(); } catch {} }
        } else {
            focusPrimaryButton('modalBody');
        }
    }, 50);
    if (enterNav) {
        EnterNav.deactivate('modal');
        EnterNav.activate({
            scopeKey: 'modal',
            container: document.getElementById('modalBody'),
            primarySelector: enterNav.primarySelector || null,
            skipSelectors: enterNav.skipSelectors || []
        });
    } else {
        EnterNav.deactivate('modal');
    }
}

function focusPosSearchBar() {
    const salesSection = document.getElementById('salesSection');
    if (salesSection && !salesSection.classList.contains('active')) return;
    const search = document.getElementById('posSearchInput');
    if (search) {
        search.focus();
        try { search.select(); } catch {}
    }
}

function closeAllOverlays() {
    document.querySelectorAll('.modal-overlay.active, .payment-overlay, .inv-side-overlay.open, .lot-selector-overlay').forEach(el => {
        if (el.classList.contains('payment-overlay')) {
            el.style.display = 'none';
        } else if (el.classList.contains('inv-side-overlay')) {
            el.classList.remove('open');
        } else {
            el.classList.remove('active');
        }
    });
    const sh = document.getElementById('salesHistoryOverlay');
    if (sh) sh.style.display = 'none';
    const pc = document.getElementById('priceCheckerOverlay');
    if (pc) {
        pc.classList.remove('visible');
        pc.style.display = 'none';
    }
    priceCheckProduct = null;
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    EnterNav.deactivate('modal');
    if (!isFullscreenActive()) {
        setTimeout(lockFullscreen, 30);
    }
    const cb = _modalCloseCallback;
    _modalCloseCallback = null;
    if (typeof cb === 'function') {
        try { cb(); } catch {}
    }
    focusInventorySearch();
}

function showConfirmDialog({ title = 'Confirmar', message = '', icon = '', confirmText = 'Aceptar', confirmIcon = '', cancelText = 'Cancelar', danger = false, onConfirm = null, onCancel = null } = {}) {
    const btnClass = danger ? 'btn-danger' : 'btn-primary';
    const okHtml = confirmIcon ? `${confirmIcon} ${confirmText}` : confirmText;
    showModal(title, `
        <div class="confirm-dialog">
            ${icon ? `<div class="confirm-dialog-icon">${icon}</div>` : ''}
            <p class="confirm-dialog-message">${message}</p>
            <div class="confirm-dialog-actions">
                <button type="button" class="btn btn-secondary" data-confirm-action="cancel">${cancelText}</button>
                <button type="button" class="btn ${btnClass}" data-confirm-action="ok" id="confirmOkBtn">${okHtml}</button>
            </div>
        </div>
    `, { primaryFocusId: 'confirmOkBtn' });
    const cancelBtn = document.querySelector('#modalBody [data-confirm-action="cancel"]');
    const okBtn = document.querySelector('#modalBody [data-confirm-action="ok"]');
    if (okBtn) okBtn.focus();
    cancelBtn?.addEventListener('click', () => {
        closeModal();
        if (typeof onCancel === 'function') { try { onCancel(); } catch {} }
    });
    okBtn?.addEventListener('click', () => {
        closeModal();
        if (typeof onConfirm === 'function') { try { onConfirm(); } catch {} }
    });
}

function showErrorDialog(message) {
    showModal('⛔ Error', `
        <div class="confirm-dialog error-dialog">
            <div class="error-dialog-icon">⚠️</div>
            <p class="confirm-dialog-message">${message}</p>
            <div class="confirm-dialog-actions">
                <button type="button" class="btn btn-primary" data-confirm-action="ok">Entendido</button>
            </div>
        </div>
    `);
    const okBtn = document.querySelector('#modalBody [data-confirm-action="ok"]');
    if (okBtn) okBtn.focus();
    okBtn?.addEventListener('click', () => closeModal());
}

async function showAddProductModal(prefillBarcode) {
    let catOptions = '<option value="">Sin categoría</option>';
    try {
        const data = await apiCall('/settings/');
        catOptions += data.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    } catch (_) {}
    const barcodeAttr = prefillBarcode ? `value="${escapeHtml(prefillBarcode)}"` : 'placeholder="Escanea o escribe el código"';

    showModal('Registrar Nuevo Producto', `
        <form id="addProductForm" onsubmit="saveProduct(event)">
            <div class="form-group">
                <label>Nombre *</label>
                <input type="text" name="name" placeholder="Ej. Pan Blanco Grande" required autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            </div>
            <div class="form-row cols-3">
                <div class="form-group">
                    <label>Categoría</label>
                    <select name="category_id">${catOptions}</select>
                </div>
                <div class="form-group">
                    <label>Código de Barras</label>
                    <input type="text" name="barcode" ${barcodeAttr} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                </div>
                <div class="form-group">
                    <label>Cantidad inicial</label>
                    <input type="number" name="stock" step="0.01" min="0" placeholder="0" value="0">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Precio de Venta *</label>
                    <input type="number" name="price" step="0.01" min="0" placeholder="0.00" required>
                </div>
                <div class="form-group">
                    <label>Costo</label>
                    <input type="number" name="cost" step="0.01" min="0" placeholder="0.00">
                </div>
            </div>
            <div class="form-row">
                <div class="gain-preview-box">
                    <span>Ganancia estimada</span>
                    <div id="gainPreview">$0.00 (0%)</div>
                </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">💾 Guardar Producto</button>
        </form>
    `, {
        enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
    });

    const form = document.getElementById('addProductForm');
    const updateGainPreview = () => {
        const price = parseFloat(form.price.value) || 0;
        const cost = parseFloat(form.cost.value) || 0;
        const gain = price - cost;
        const pct = price > 0 ? (gain / price) * 100 : 0;
        const el = document.getElementById('gainPreview');
        if (!el) return;
        el.textContent = `$${gain.toFixed(2)} (${pct.toFixed(1)}%)`;
        el.style.color = gain >= 0 ? '#16a34a' : '#d71920';
    };
    form.price.addEventListener('input', updateGainPreview);
    form.cost.addEventListener('input', updateGainPreview);

    setTimeout(() => {
        const nameInp = document.getElementById('addProductForm')?.querySelector('input[name="name"]');
        if (nameInp) nameInp.focus();
    }, 50);
}

async function saveProduct(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const data = {
        name: formData.get('name'),
        barcode: formData.get('barcode'),
        category_id: formData.get('category_id') ? parseInt(formData.get('category_id')) : null,
        price: parseFloat(formData.get('price')),
        cost: parseFloat(formData.get('cost')) || 0,
        stock: parseFloat(formData.get('stock')) || 0
    };
    
    try {
        await apiCall('/products/', 'POST', data);
        showToast('Producto guardado exitosamente', 'success');
        closeModal();
        loadProductsTable();
        loadProducts();
        loadLots(true);
        loadInventory();
    } catch (error) {
        let msg = 'Error al guardar producto';
        try {
            const parsed = JSON.parse(error.message);
            msg = parsed.error || msg;
        } catch {}
        showToast(msg, 'error');
    }
}

async function editProduct(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    let catOptions = '<option value="">Sin categoría</option>';
    try {
        const data = await apiCall('/settings/');
        catOptions += data.categories.map(c =>
            `<option value="${c.id}" ${String(c.id) === String(product.category_id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
        ).join('');
    } catch (_) {}
    
    showModal('Editar Producto', `
        <form id="editProductForm" onsubmit="updateProduct(event, ${id})">
            <div class="form-group">
                <label>Nombre *</label>
                <input type="text" name="name" value="${escapeHtml(product.name)}" required autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Categoría</label>
                    <select name="category_id">${catOptions}</select>
                </div>
                <div class="form-group">
                    <label>Código de Barras</label>
                    <input type="text" name="barcode" value="${escapeHtml(product.barcode || '')}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Precio de Venta *</label>
                    <input type="number" name="price" step="0.01" min="0" value="${product.price}" required>
                </div>
                <div class="form-group">
                    <label>Costo</label>
                    <input type="number" name="cost" step="0.01" min="0" value="${product.cost}">
                </div>
            </div>
            <div class="form-row">
                <div class="gain-preview-box">
                    <span>Ganancia estimada</span>
                    <div id="gainPreviewEdit">$0.00 (0%)</div>
                </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">💾 Actualizar Producto</button>
        </form>
    `, {
        enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
    });

    const form = document.getElementById('editProductForm');
    const updateGainPreview = () => {
        const price = parseFloat(form.price.value) || 0;
        const cost = parseFloat(form.cost.value) || 0;
        const gain = price - cost;
        const pct = price > 0 ? (gain / price) * 100 : 0;
        const el = document.getElementById('gainPreviewEdit');
        if (!el) return;
        el.textContent = `$${gain.toFixed(2)} (${pct.toFixed(1)}%)`;
        el.style.color = gain >= 0 ? '#16a34a' : '#d71920';
        el.setAttribute('data-gain', gain);
    };
    form.price.addEventListener('input', updateGainPreview);
    form.cost.addEventListener('input', updateGainPreview);
    updateGainPreview();
}

async function updateProduct(e, id) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const data = {
        name: formData.get('name'),
        barcode: formData.get('barcode'),
        category_id: formData.get('category_id') ? parseInt(formData.get('category_id')) : null,
        price: parseFloat(formData.get('price')),
        cost: parseFloat(formData.get('cost')) || 0
    };
    
    try {
        await apiCall(`/products/${id}`, 'PUT', data);
        showToast('Producto actualizado', 'success');
        closeModal();
        loadProductsTable();
        loadProducts();
    } catch (error) {
        let msg = 'Error al actualizar producto';
        try {
            const parsed = JSON.parse(error.message);
            msg = parsed.error || msg;
        } catch {}
        showToast(msg, 'error');
    }
}

function handleProductQuickScan(e) {
    if (e.key !== 'Enter') return;
    const inp = document.getElementById('productSearch');
    if (!inp) return;
    const v = inp.value.trim();
    if (!v) return;
    if (!/^\d{4,}$/.test(v)) return;
    e.preventDefault();
    const clearSearch = () => {
        inp.value = '';
        searchProducts();
    };
    apiCall(`/products/barcode/${encodeURIComponent(v)}`)
        .then(product => {
            clearSearch();
            showProductQuickEditModal(product);
        })
        .catch(() => {
            clearSearch();
            showProductQuickCreateModal(v);
        });
}

async function getQuickCategoryOptions(selectedId) {
    let options = '<option value="">Sin categoría</option>';
    try {
        const data = await apiCall('/settings/');
        options += data.categories.map(c =>
            `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
        ).join('');
    } catch (_) {}
    return options;
}

function quickFormFieldsHtml(product) {
    return `
        <div class="form-group">
            <label>Nombre *</label>
            <input type="text" id="qpName" name="name" value="${escapeHtml(product.name)}" required autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Código</label>
                <input type="text" id="qpBarcode" name="barcode" value="${escapeHtml(product.barcode || '')}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            </div>
            <div class="form-group">
                <label>Departamento</label>
                <select name="category_id">${product.catOptions}</select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Costo de venta *</label>
                <input type="number" id="qpPrice" name="price" step="0.01" min="0" value="${product.price}" required>
            </div>
            <div class="form-group">
                <label>Costo de compra</label>
                <input type="number" id="qpCost" name="cost" step="0.01" min="0" value="${product.cost}">
            </div>
        </div>
    `;
}

async function showProductQuickEditModal(product) {
    const catOptions = await getQuickCategoryOptions(product.category_id);
    const id = product.id;
    showModal('⚡ Edición rápida · ' + escapeHtml(product.name), `
        <form id="quickProductForm" onsubmit="quickUpdateProduct(event, ${id})">
            ${quickFormFieldsHtml({ ...product, catOptions })}
            <div style="display:flex;gap:8px;margin-top:16px">
                <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                <button type="submit" class="btn btn-primary" style="flex:1">💾 Guardar</button>
            </div>
        </form>
    `, {
        primaryFocusId: 'qpName',
        onClose: () => {
            const s = document.getElementById('productSearch');
            if (s) { s.focus(); }
        }
    });
    const nameInput = document.getElementById('qpName');
    if (nameInput) {
        try { nameInput.select(); } catch {}
    }
}

async function showProductQuickCreateModal(barcode) {
    const catOptions = await getQuickCategoryOptions(null);
    showModal('⚡ Producto nuevo · ' + escapeHtml(barcode), `
        <form id="quickProductForm" onsubmit="quickCreateProduct(event)">
            ${quickFormFieldsHtml({ name: '', barcode: barcode, cost: '', catOptions, price: '' })}
            <div style="display:flex;gap:8px;margin-top:16px">
                <button type="button" class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
                <button type="submit" class="btn btn-primary" style="flex:1">💾 Guardar</button>
            </div>
        </form>
    `, {
        primaryFocusId: 'qpName',
        onClose: () => {
            const s = document.getElementById('productSearch');
            if (s) { s.focus(); }
        }
    });
    const nameInput = document.getElementById('qpName');
    if (nameInput) { nameInput.focus(); }
}

function quickCollectProductForm(form) {
    const formData = new FormData(form);
    return {
        name: formData.get('name'),
        barcode: formData.get('barcode'),
        category_id: formData.get('category_id') ? parseInt(formData.get('category_id')) : null,
        price: parseFloat(formData.get('price')),
        cost: parseFloat(formData.get('cost')) || 0
    };
}

async function quickUpdateProduct(e, id) {
    e.preventDefault();
    try {
        await apiCall(`/products/${id}`, 'PUT', quickCollectProductForm(e.target));
        showToast('Producto actualizado', 'success');
        closeModal();
        loadProductsTable();
        loadProducts();
    } catch (error) {
        let msg = 'Error al actualizar producto';
        try {
            const parsed = JSON.parse(error.message);
            msg = parsed.error || msg;
        } catch {}
        showToast(msg, 'error');
    }
}

async function quickCreateProduct(e) {
    e.preventDefault();
    try {
        await apiCall('/products/', 'POST', quickCollectProductForm(e.target));
        showToast('Producto guardado exitosamente', 'success');
        closeModal();
        loadProductsTable();
        loadProducts();
    } catch (error) {
        let msg = 'Error al guardar producto';
        try {
            const parsed = JSON.parse(error.message);
            msg = parsed.error || msg;
        } catch {}
        showToast(msg, 'error');
    }
}

function deleteProduct(id) {
    showConfirmDialog({
        title: 'Eliminar Producto',
        message: '¿Estás seguro de eliminar este producto?',
        confirmText: 'Eliminar',
        danger: true,
        onConfirm: async () => {
            try {
                await apiCall(`/products/${id}`, 'DELETE');
                showToast('Producto eliminado', 'success');
                loadProductsTable();
                loadProducts();
            } catch (error) {
                let msg = 'No se pudo eliminar el producto';
                try {
                    const data = JSON.parse(error.message);
                    if (data.error) msg = data.error;
                } catch {}
                showErrorDialog(msg);
            }
        }
    });
}

function showAddCategoryModal() {
    showModal('Agregar Categoría', `
        <form id="addCategoryForm" onsubmit="saveCategory(event)">
            <div class="form-group">
                <label>Nombre *</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>Color</label>
                <input type="color" name="color" value="#3b82f6">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Guardar</button>
        </form>
    `, {
        enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
    });
}

async function saveCategory(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    try {
        await apiCall('/settings/categories', 'POST', {
            name: formData.get('name'),
            color: formData.get('color')
        });
        showToast('Categoría guardada', 'success');
        closeModal();
        loadCategoriesSettings();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

function deleteCategory(id) {
    showConfirmDialog({
        title: 'Eliminar Categoría',
        message: '¿Estás seguro de eliminar esta categoría?',
        confirmText: 'Eliminar',
        danger: true,
        onConfirm: async () => {
            try {
                await apiCall(`/settings/categories/${id}`, 'DELETE');
                showToast('Categoría eliminada', 'success');
                loadCategoriesSettings();
            } catch (error) {
                let msg = 'No se pudo eliminar la categoría';
                try {
                    const data = JSON.parse(error.message);
                    if (data.error) msg = data.error;
                } catch {}
                showErrorDialog(msg);
            }
        }
    });
}

function editCategory(id, name, color) {
    showModal('Editar Categoría', `
        <form id="editCategoryForm" onsubmit="updateCategory(event, ${id})">
            <div class="form-group">
                <label>Nombre *</label>
                <input type="text" name="name" value="${name}" required>
            </div>
            <div class="form-group">
                <label>Color</label>
                <input type="color" name="color" value="${color}">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Actualizar</button>
        </form>
    `, {
        enterNav: { primarySelector: '#modalBody button[type="submit"].btn-primary' }
    });
}

async function updateCategory(e, id) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    try {
        await apiCall(`/settings/categories/${id}`, 'PUT', {
            name: formData.get('name'),
            color: formData.get('color')
        });
        showToast('Categoría actualizada', 'success');
        closeModal();
        loadCategoriesSettings();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

// Promotions
async function loadPromotions() {
    try {
        promotions = await apiCall('/promotions/');
        renderPromotions();
    } catch (error) {
        showToast('Error al cargar promociones', 'error');
    }
}

function renderPromotions() {
    const grid = document.getElementById('promotionsGrid');
    
    if (promotions.length === 0) {
        grid.innerHTML = '<p style="text-align:center; padding:40px; color:#6b7280">No hay promociones activas. Crea una nueva promoción.</p>';
        return;
    }
    
    grid.innerHTML = promotions.map(promo => {
        let details = '';
        
        if (promo.type === 'bogo') {
            details = `Lleva ${promo.buy_quantity} y paga ${promo.pay_quantity}`;
        } else if (promo.type === 'fixed_price') {
            details = `Lleva ${promo.buy_quantity} por $${parseFloat(promo.fixed_price).toFixed(2)}`;
        } else if (promo.type === 'percent') {
            details = `${promo.discount_percent}% de descuento`;
        } else if (promo.type === 'fixed_discount') {
            details = `$${parseFloat(promo.discount_amount).toFixed(2)} de descuento por unidad`;
        }
        
        let scope = '';
        if (promo.product_ids && promo.product_ids.length > 0) {
            scope = `Aplica a ${promo.product_ids.length} producto(s) específico(s)`;
        } else if (promo.category_ids && promo.category_ids.length > 0) {
            scope = `Aplica a ${promo.category_ids.length} categoría(s)`;
        } else {
            scope = 'Aplica a todo';
        }
        
        return `
            <div class="promotion-card">
                <div class="promotion-header">
                    <h3>${promo.name}</h3>
                    <span class="badge badge-success">Activa</span>
                </div>
                <div class="promotion-details">
                    <p><strong>${details}</strong></p>
                    <p style="color:#6b7280; font-size:13px">${scope}</p>
                    ${promo.end_date ? `<p style="font-size:12px; color:#d71920">Vence: ${promo.end_date}</p>` : ''}
                </div>
                <div class="promotion-actions">
                    <button class="action-btn" onclick="editPromotion(${promo.id})">Editar</button>
                    <button class="action-btn delete" onclick="deletePromotion(${promo.id})">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}

function showAddPromotionModal() {
    showPromotionModal(null);
}

function showPromotionModal(promo) {
    const settings = JSON.parse(JSON.stringify(promo || { product_ids: [], category_ids: [] }));
    
    apiCall('/settings/').then(data => {
        const productOptions = data.categories.map(cat => 
            `<option value="${cat.id}">${cat.name}</option>`
        ).join('');
        
        const productList = (data.products || []).map(p => 
            `<option value="${p.id}" data-barcode="${escapeHtml(p.barcode || '')}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}${p.barcode ? ` (${escapeHtml(p.barcode)})` : ''}</option>`
        ).join('');
        
        const isEdit = !!promo;
        const title = isEdit ? 'Editar Promoción' : 'Nueva Promoción';
        
        showModal(title, `
            <form id="promotionForm" onsubmit="savePromotion(event, ${isEdit ? promo.id : 'null'})">
                <div class="form-group">
                    <label>Nombre de la Promoción *</label>
                    <input type="text" name="name" value="${promo ? promo.name : ''}" required placeholder="Ej: 2x1 en Pan Bimbo">
                </div>
                
                <div class="form-group">
                    <label>Tipo de Promoción *</label>
                    <select name="type" id="promoType" required onchange="updatePromoFields()">
                        <option value="bogo" ${promo?.type === 'bogo' ? 'selected' : ''}>2x1, 3x2, etc. (BOGO)</option>
                        <option value="fixed_price" ${promo?.type === 'fixed_price' ? 'selected' : ''}>Lleva N por precio fijo</option>
                        <option value="percent" ${promo?.type === 'percent' ? 'selected' : ''}>Descuento Porcentual</option>
                        <option value="fixed_discount" ${promo?.type === 'fixed_discount' ? 'selected' : ''}>Descuento Fijo</option>
                    </select>
                </div>
                
                <div id="bogoFields" class="form-row" style="${promo?.type === 'bogo' || !promo ? '' : 'display:none'}">
                    <div class="form-group">
                        <label>Lleva *</label>
                        <input type="number" name="buy_quantity" value="${promo?.buy_quantity || 2}" min="2" required>
                    </div>
                    <div class="form-group">
                        <label>Paga *</label>
                        <input type="number" name="pay_quantity" value="${promo?.pay_quantity || 1}" min="1" required>
                    </div>
                </div>
                
                <div id="fixedPriceFields" class="form-group" style="${promo?.type === 'fixed_price' ? '' : 'display:none'}">
                    <label>Cantidad de productos *</label>
                    <input type="number" name="buy_quantity_fp" value="${promo?.buy_quantity || 2}" min="2">
                </div>
                
                <div id="fixedPriceRow" class="form-row" style="${promo?.type === 'fixed_price' ? '' : 'display:none'}">
                    <div class="form-group">
                        <label>Precio Total *</label>
                        <input type="number" name="fixed_price" step="0.01" value="${promo?.fixed_price || ''}">
                    </div>
                </div>
                
                <div id="percentFields" class="form-group" style="${promo?.type === 'percent' ? '' : 'display:none'}">
                    <label>Porcentaje de descuento *</label>
                    <input type="number" name="discount_percent" step="0.01" value="${promo?.discount_percent || ''}" min="0" max="100">
                </div>
                
                <div id="fixedDiscountFields" class="form-group" style="${promo?.type === 'fixed_discount' ? '' : 'display:none'}">
                    <label>Monto de descuento por unidad *</label>
                    <input type="number" name="discount_amount" step="0.01" value="${promo?.discount_amount || ''}" min="0">
                </div>
                
                <div class="form-group">
                    <label>Aplicar a:</label>
                    <select name="scope_type" id="scopeType" onchange="updateScopeFields()">
                        <option value="category">Por Categoría</option>
                        <option value="product">Por Producto Específico</option>
                    </select>
                </div>
                
                <div id="categoryScope" class="form-group">
                    <label>Categorías (mantén Ctrl para múltiples)</label>
                    <select name="category_ids" multiple size="5">
                        ${productOptions}
                    </select>
                </div>
                
                <div id="productScope" class="form-group" style="display:none">
                    <label>Productos (mantén Ctrl para múltiples)</label>
                    <input type="text" id="promoProductSearch" placeholder="🔎 Buscar por nombre o código de barras (Enter = código exacto)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="filterPromoProducts(this.value)" onkeydown="handlePromoProductSearch(event)">
                    <select name="product_ids" multiple size="6" id="promoProductSelect">
                        ${productList}
                    </select>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>Fecha Inicio</label>
                        <input type="date" name="start_date" value="${promo?.start_date || ''}">
                    </div>
                    <div class="form-group">
                        <label>Fecha Fin</label>
                        <input type="date" name="end_date" value="${promo?.end_date || ''}">
                    </div>
                </div>
                
                <button type="submit" class="btn btn-primary" style="width:100%">${isEdit ? 'Actualizar' : 'Crear'} Promoción</button>
            </form>
        `);
        
        if (promo) {
            if (promo.product_ids && promo.product_ids.length > 0) {
                document.getElementById('scopeType').value = 'product';
                updateScopeFields();
                setTimeout(() => {
                    const select = document.querySelector('select[name="product_ids"]');
                    if (select) {
                        Array.from(select.options).forEach(opt => {
                            if (promo.product_ids.includes(parseInt(opt.value))) {
                                opt.selected = true;
                            }
                        });
                    }
                }, 100);
            } else if (promo.category_ids && promo.category_ids.length > 0) {
                setTimeout(() => {
                    const select = document.querySelector('select[name="category_ids"]');
                    if (select) {
                        Array.from(select.options).forEach(opt => {
                            if (promo.category_ids.includes(parseInt(opt.value))) {
                                opt.selected = true;
                            }
                        });
                    }
                }, 100);
            }
        }
    });
}

function updatePromoFields() {
    const type = document.getElementById('promoType').value;
    document.getElementById('bogoFields').style.display = type === 'bogo' ? '' : 'none';
    document.getElementById('fixedPriceFields').style.display = type === 'fixed_price' ? '' : 'none';
    document.getElementById('fixedPriceRow').style.display = type === 'fixed_price' ? '' : 'none';
    document.getElementById('percentFields').style.display = type === 'percent' ? '' : 'none';
    document.getElementById('fixedDiscountFields').style.display = type === 'fixed_discount' ? '' : 'none';
}

function updateScopeFields() {
    const scope = document.getElementById('scopeType').value;
    document.getElementById('categoryScope').style.display = scope === 'category' ? '' : 'none';
    document.getElementById('productScope').style.display = scope === 'product' ? '' : 'none';
}

function filterPromoProducts(term) {
    const select = document.getElementById('promoProductSelect');
    if (!select) return;
    const t = term.trim().toLowerCase();
    Array.from(select.options).forEach(o => {
        const name = (o.dataset.name || '').toLowerCase();
        const barcode = (o.dataset.barcode || '').toLowerCase();
        o.hidden = t.length > 0 && !(name.includes(t) || barcode.includes(t));
    });
}

function handlePromoProductSearch(e) {
    if (e.key !== 'Enter') return;
    const inp = document.getElementById('promoProductSearch');
    if (!inp) return;
    const v = inp.value.trim();
    if (!v) return;
    if (!/^\d{4,}$/.test(v)) return;
    e.preventDefault();
    const select = document.getElementById('promoProductSelect');
    if (!select) return;
    const norm = v.endsWith('.0') ? v.slice(0, -2) : v;
    let opt = null;
    for (const o of select.options) {
        const bc = o.dataset.barcode || '';
        if (bc !== v && bc !== norm) continue;
        opt = o;
        break;
    }
    if (opt) {
        opt.selected = true;
        inp.value = '';
        filterPromoProducts('');
        select.focus();
        showToast('Producto agregado a la promoción', 'success');
    } else {
        showToast('Código de barras no encontrado', 'error');
        filterPromoProducts(norm);
    }
}

async function savePromotion(e, id) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const scopeType = formData.get('scope_type');
    let product_ids = [];
    let category_ids = [];
    
    if (scopeType === 'category') {
        const select = form.querySelector('select[name="category_ids"]');
        category_ids = Array.from(select.selectedOptions).map(opt => parseInt(opt.value));
    } else if (scopeType === 'product') {
        const select = form.querySelector('select[name="product_ids"]');
        product_ids = Array.from(select.selectedOptions).map(opt => parseInt(opt.value));
    }
    
    if (scopeType === 'product' && product_ids.length === 0) {
        showToast('Selecciona al menos un producto', 'error');
        return;
    }
    if (scopeType === 'category' && category_ids.length === 0) {
        showToast('Selecciona al menos una categoría', 'error');
        return;
    }
    
    const type = formData.get('type');
    const data = {
        name: formData.get('name'),
        type: type,
        product_ids: product_ids,
        category_ids: category_ids,
        start_date: formData.get('start_date') || null,
        end_date: formData.get('end_date') || null
    };
    
    if (type === 'bogo') {
        data.buy_quantity = parseInt(formData.get('buy_quantity'));
        data.pay_quantity = parseInt(formData.get('pay_quantity'));
    } else if (type === 'fixed_price') {
        data.buy_quantity = parseInt(formData.get('buy_quantity_fp'));
        data.fixed_price = parseFloat(formData.get('fixed_price'));
    } else if (type === 'percent') {
        data.discount_percent = parseFloat(formData.get('discount_percent'));
    } else if (type === 'fixed_discount') {
        data.discount_amount = parseFloat(formData.get('discount_amount'));
    }
    
    try {
        if (id) {
            await apiCall(`/promotions/${id}`, 'PUT', data);
            showToast('Promoción actualizada', 'success');
        } else {
            await apiCall('/promotions/', 'POST', data);
            showToast('Promoción creada exitosamente', 'success');
        }
        closeModal();
        loadPromotions();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

function editPromotion(id) {
    const promo = promotions.find(p => p.id === id);
    if (promo) {
        showPromotionModal(promo);
    }
}

function deletePromotion(id) {
    showConfirmDialog({
        title: 'Eliminar Promoción',
        message: '¿Estás seguro de eliminar esta promoción?',
        confirmText: 'Eliminar',
        danger: true,
        onConfirm: async () => {
            try {
                await apiCall(`/promotions/${id}`, 'DELETE');
                showToast('Promoción eliminada', 'success');
                loadPromotions();
            } catch (error) {
                let msg = 'No se pudo eliminar la promoción';
                try {
                    const data = JSON.parse(error.message);
                    if (data.error) msg = data.error;
                } catch {}
                showErrorDialog(msg);
            }
        }
    });
}

function showAddUserModal() {
    showModal('Agregar Usuario', `
        <form id="addUserForm" onsubmit="saveUser(event)">
            <div class="form-group">
                <label>Usuario *</label>
                <input type="text" name="username" required>
            </div>
            <div class="form-group">
                <label>Contraseña *</label>
                <input type="password" name="password" required>
            </div>
            <div class="form-group">
                <label>Nombre Completo *</label>
                <input type="text" name="full_name" required>
            </div>
            <div class="form-group">
                <label>Rol *</label>
                <select name="role" required>
                    <option value="cashier">Cajero</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Administrador</option>
                </select>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Guardar</button>
        </form>
    `);
}

async function saveUser(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    try {
        await apiCall('/settings/users', 'POST', {
            username: formData.get('username'),
            password: formData.get('password'),
            full_name: formData.get('full_name'),
            role: formData.get('role')
        });
        showToast('Usuario guardado', 'success');
        closeModal();
        loadUsersSettings();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

function showAddTerminalModal() {
    showModal('Agregar Terminal', `
        <form id="addTerminalForm" onsubmit="saveTerminal(event)">
            <div class="form-group">
                <label>ID de Terminal *</label>
                <input type="text" name="id" placeholder="Ej: terminal_1" required>
            </div>
            <div class="form-group">
                <label>Nombre *</label>
                <input type="text" name="name" placeholder="Ej: Terminal Principal" required>
            </div>
            <div class="form-group">
                <label>Comisión (%)</label>
                <input type="number" name="commission_rate" step="0.01" value="0">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Guardar</button>
        </form>
    `);
}

async function saveTerminal(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    try {
        await apiCall('/settings/terminals', 'POST', {
            id: formData.get('id'),
            name: formData.get('name'),
            commission_rate: parseFloat(formData.get('commission_rate')) || 0
        });
        showToast('Terminal guardada', 'success');
        closeModal();
        loadTerminalsSettings();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

// Toast
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    toastMessage.textContent = message;
    toast.className = `toast show ${type}`;

    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
        toast.classList.remove('show');
    }, type === 'error' ? 4500 : 3000);
}