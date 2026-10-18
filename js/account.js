/* =========================================================
   BOOT
   ========================================================= */
var _pxcAccountBooted = false;
var _pxcAccountRefreshTimer = null;

function bootAccountPage() {
    if (_pxcAccountBooted) return;
    _pxcAccountBooted = true;

    /* -------- 1. Chrome: header + footer -------- */
    try { PXCUI.renderHeader(); } catch (e) { console.error('[account] header:', e); }
    try { PXCUI.renderFooter(); } catch (e) { console.error('[account] footer:', e); }

    /* -------- 2. Critical panels — render NOW from localStorage -------- */
    try { renderSidebar(); } catch (e) { console.error('[account] sidebar:', e); }
    try { renderProfile(); } catch (e) { console.error('[account] profile:', e); }
    try { renderWishlist(); } catch (e) { console.error('[account] wishlist:', e); }
    try { wireTabs(); } catch (e) { console.error('[account] wireTabs:', e); }
    try { applyHashTab(); } catch (e) { console.error('[account] applyHashTab:', e); }

    /* -------- 3. Safety net: if profile still shows a spinner
       after 3s, replace it with a friendly error -------- */
    setTimeout(function () {
        var panel = document.getElementById('profilePanel');
        if (panel && panel.querySelector('.pxc-page-loader__spinner')) {
            console.error('[account] profile failed to render within 3s');
            panel.innerHTML = `
                <div class="card" style="text-align:center;padding:2rem 1.5rem">
                    <div style="font-size:2.5rem;margin-bottom:.5rem">⚠️</div>
                    <h3 style="font-weight:700;margin-bottom:.4rem">
                        Could not load profile
                    </h3>
                    <p style="color:var(--muted-foreground);font-size:.88rem">
                        Please refresh the page. If the problem continues,
                        open the browser console (F12) and check for errors
                        in <code>js/account.js</code>.
                    </p>
                    <button type="button" class="btn btn-primary"
                            style="margin-top:1rem"
                            onclick="location.reload()">
                        Refresh
                    </button>
                </div>
            `;
        }
    }, 3000);

    /* -------- 4. Background: catalogue load -------- */
    Promise.resolve()
        .then(function () { return PXC.load(); })
        .then(function () {
            try { renderWishlist(); } catch (e) { console.error(e); }
            renderOrders().catch(function (e) { console.error(e); });
        })
        .catch(function (e) {
            console.error('[account] PXC.load() failed:', e);
            renderOrders().catch(function () { });
        });

    /* -------- 5. React to app events -------- */
    document.addEventListener('pxc:auth-update', function () {
        try { renderSidebar(); } catch (e) { console.error(e); }
        try { renderProfile(); } catch (e) { console.error(e); }
        try { renderWishlist(); } catch (e) { console.error(e); }
        try { applyHashTab(); } catch (e) { console.error(e); }
        renderOrders().catch(function (e) { console.error(e); });
    });

    document.addEventListener('pxc:wishlist-update', function () {
        try { renderWishlist(); } catch (e) { console.error(e); }
        try { updateWishlistBadge(); } catch (e) { console.error(e); }
    });

    document.addEventListener('pxc:orders-update', function () {
        renderOrders().catch(function (e) { console.error(e); });
    });

    window.addEventListener('hashchange', function () {
        try { applyHashTab(); } catch (e) { console.error(e); }
    });

    /* -------- 6. Auto-refresh orders tab (30s + on focus) -------- */
    startAutoRefresh();

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (!PXC.isLoggedIn()) return;
        var panel = document.getElementById('orders');
        if (panel && panel.classList.contains('active')) {
            renderOrders().catch(function (e) { console.error(e); });
        }
    });

    window.addEventListener('beforeunload', stopAutoRefresh);
}

function startAutoRefresh() {
    stopAutoRefresh();
    _pxcAccountRefreshTimer = setInterval(function () {
        if (!PXC.isLoggedIn()) return;
        var panel = document.getElementById('orders');
        if (panel && panel.classList.contains('active')) {
            renderOrders().catch(function (e) { console.error(e); });
        }
    }, 30000);
}

function stopAutoRefresh() {
    if (_pxcAccountRefreshTimer) {
        clearInterval(_pxcAccountRefreshTimer);
        _pxcAccountRefreshTimer = null;
    }
}


/* =========================================================
   DOM READY
   ========================================================= */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAccountPage);
} else {
    bootAccountPage();
}


/* =========================================================
   SIDEBAR
   ========================================================= */
function renderSidebar() {
    var host = document.querySelector('.account-menu');
    if (!host) return;

    var loggedIn = false;
    var wishCount = 0;

    try { loggedIn = PXC.isLoggedIn(); } catch (e) { }
    try { wishCount = PXC.wishlistCount(); } catch (e) { }

    var iconUser = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
        </svg>`;

    var iconHeart = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>`;

    var iconBag = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6Z"/>
            <path d="M3 6h18"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>`;

    var iconLogout = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>`;

    var loggedInHtml;
    if (loggedIn) {
        loggedInHtml = `
            <button type="button" data-tab="orders">
                ${iconBag}
                Orders
            </button>

            <button type="button" id="logoutBtn" style="color:#dc2626">
                ${iconLogout}
                Logout
            </button>
        `;
    } else {
        loggedInHtml = `
            <a href="login.html?next=account.html"
               class="btn btn-primary btn-sm btn-block"
               style="margin-top:.5rem">
                Login / Register
            </a>
        `;
    }

    host.innerHTML = `
        <button type="button" data-tab="profile" class="active">
            ${iconUser}
            Profile
        </button>

        <button type="button" data-tab="wishlist">
            ${iconHeart}
            Wishlist
            <span id="wishlistBadge" class="account-tab-badge"
                  style="margin-left:auto">${wishCount}</span>
        </button>

        ${loggedInHtml}
    `;
}

function updateWishlistBadge() {
    var badge = document.getElementById('wishlistBadge');
    if (!badge) return;
    try { badge.textContent = PXC.wishlistCount(); } catch (e) { }
}


/* =========================================================
   TABS
   ========================================================= */
function wireTabs() {
    var menu = document.querySelector('.account-menu');
    if (!menu || menu._pxcTabsBound) return;
    menu._pxcTabsBound = true;

    menu.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tab]');
        if (btn) return activateTab(btn.dataset.tab);

        if (e.target.closest('#logoutBtn')) handleLogout();
    });
}

function activateTab(name) {
    var tabButtons = document.querySelectorAll('.account-menu [data-tab]');
    for (var i = 0; i < tabButtons.length; i++) {
        tabButtons[i].classList.toggle('active', tabButtons[i].dataset.tab === name);
    }

    var panels = document.querySelectorAll('.account-panel');
    for (var j = 0; j < panels.length; j++) {
        panels[j].classList.toggle('active', panels[j].id === name);
    }

    if (location.hash !== '#' + name) {
        try { history.replaceState(null, '', '#' + name); } catch (e) { }
    }

    if (window.innerWidth < 768) {
        window.scrollTo({ top: 200, behavior: 'smooth' });
    }

    if (name === 'orders' && PXC.isLoggedIn()) {
        renderOrders().catch(function (e) { console.error(e); });
    }
}

function applyHashTab() {
    var hash = (location.hash || '').replace('#', '') || 'profile';

    if (hash === 'orders' && !PXC.isLoggedIn()) {
        return activateTab('profile');
    }

    var btn = document.querySelector('.account-menu [data-tab="' + hash + '"]');
    activateTab(btn ? hash : 'profile');
}


/* =========================================================
   LOGOUT
   ========================================================= */
function handleLogout() {
    try { PXC.logout(); } catch (e) { }
    try { PXCUI.toast('Logged out successfully', 'success'); } catch (e) { }
    try { PXCUI.navigate('login.html', 'Signing out', 400); }
    catch (e) { location.href = 'login.html'; }
}


/* =========================================================
   PROFILE PANEL
   ========================================================= */
function renderProfile() {
    var host = document.getElementById('profilePanel');
    if (!host) return;

    /* ---- Not logged in ---- */
    var loggedIn = false;
    try { loggedIn = PXC.isLoggedIn(); } catch (e) { }

    if (!loggedIn) {
        host.innerHTML = `
            <div class="card" style="text-align:center;padding:2.5rem 1.5rem">
                <div style="font-size:3rem;margin-bottom:.75rem">👤</div>
                <h2 style="font-family:'Poppins',sans-serif;font-size:1.3rem;
                           font-weight:700;margin-bottom:.35rem;
                           letter-spacing:-.02em">
                    You're not logged in
                </h2>
                <p style="color:var(--muted-foreground);margin:.5rem 0 1.5rem">
                    Log in to see your profile, orders, and wishlist.
                </p>
                <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
                    <a href="login.html?next=account.html" class="btn btn-primary">Login</a>
                    <a href="login.html?next=account.html#register" class="btn btn-outline">Register</a>
                </div>
            </div>
        `;
        return;
    }

    /* ---- Logged in ---- */
    var esc = PXCUI.escapeHtml;
    var u = PXC.user || {};
    var initials = getInitials(u.name);

    var orderCt = 0;
    try { orderCt = PXC.getUserOrders().length; } catch (e) { }

    var wishCt = 0;
    try { wishCt = PXC.wishlistCount(); } catch (e) { }

    host.innerHTML = `
        <div class="card">
            <div style="display:flex;gap:1.25rem;align-items:center;
                        flex-wrap:wrap;padding-bottom:1.25rem;
                        border-bottom:1px solid var(--border)">
                <div class="account-avatar" aria-hidden="true">${esc(initials)}</div>
                <div style="flex:1;min-width:180px">
                    <h2 style="font-family:'Poppins',sans-serif;font-size:1.25rem;
                               font-weight:700;margin-bottom:.2rem;
                               letter-spacing:-.02em">
                        Hello, ${esc(u.name || 'there')} 👋
                    </h2>
                    <p style="color:var(--muted-foreground);font-size:.88rem">
                        ${esc(u.email || '')}
                    </p>
                </div>
            </div>

            <div style="padding-top:1.25rem;display:grid;
                        grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                        gap:1rem">
                ${statBox('Member since', formatDate(u.joined))}
                ${statBox('Wishlist items', wishCt)}
                ${statBox('Orders', orderCt)}
            </div>

            <div style="margin-top:1.5rem;padding-top:1.25rem;
                        border-top:1px solid var(--border);
                        display:flex;gap:.5rem;flex-wrap:wrap">
                <a href="products.html" class="btn btn-primary btn-sm">Continue shopping</a>
                <button type="button" class="btn btn-outline btn-sm"
                        data-tab="wishlist" data-jump>
                    My Wishlist
                </button>
            </div>
        </div>
    `;

    var jumpButtons = host.querySelectorAll('[data-jump][data-tab]');
    for (var k = 0; k < jumpButtons.length; k++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                activateTab(btn.dataset.tab);
            });
        })(jumpButtons[k]);
    }
}

function statBox(label, value) {
    return `
        <div class="account-stat">
            <div style="font-size:.72rem;text-transform:uppercase;
                        letter-spacing:.08em;color:var(--muted-foreground)">
                ${label}
            </div>
            <div style="font-weight:700;margin-top:.25rem">${value}</div>
        </div>
    `;
}


/* =========================================================
   WISHLIST PANEL
   ========================================================= */
function renderWishlist() {
    var host = document.getElementById('wishlistPanel');
    if (!host) return;

    var productsLoaded = Array.isArray(PXC.products) && PXC.products.length > 0;
    var wishIds = Array.isArray(PXC.wishlist) ? PXC.wishlist : [];

    /* Products not yet loaded — show a wait state if we know
       there are items to display, otherwise fall through. */
    if (!productsLoaded && wishIds.length > 0) {
        host.innerHTML = `
            <div class="empty-state" style="padding:2.5rem 1rem">
                <div class="pxc-page-loader__spinner"
                     style="margin:0 auto 1rem;
                            border-color:rgba(0,0,0,.08);
                            border-top-color:#0a0a0a"></div>
                <h3>Loading your wishlist…</h3>
                <p>Please wait a moment.</p>
            </div>
        `;
        return;
    }

    var items = [];
    if (productsLoaded) {
        items = PXC.products.filter(function (p) {
            return PXC.isWishlisted(p.id);
        });
    }

    if (items.length === 0) {
        host.innerHTML = `
            <div class="empty-state" style="padding:2.5rem 1rem">
                <div style="font-size:2.5rem;margin-bottom:.5rem">💛</div>
                <h3>Your wishlist is empty</h3>
                <p>Tap the ♥ on any product to save it here.</p>
                <a href="products.html" class="btn btn-primary" style="margin-top:1rem">
                    Browse products
                </a>
            </div>
        `;
        return;
    }

    var itemWord = (items.length === 1) ? '' : 's';

    host.innerHTML = `
        <div class="wishlist-header">
            <span>${items.length} item${itemWord} saved</span>
            <a href="products.html?wishlist=1" class="link-more">View all →</a>
        </div>
        <div class="product-grid" id="wishlistGrid">
            ${items.map(function (p) { return PXCUI.productCard(p); }).join('')}
        </div>
    `;

    try { PXCUI.wireProductCards(host); } catch (e) { console.error(e); }
}


/* =========================================================
   ORDERS PANEL
   ========================================================= */
async function renderOrders() {
    var host = document.getElementById('orders');
    if (!host) return;

    /* ---- Not logged in ---- */
    if (!PXC.isLoggedIn()) {
        host.innerHTML = `
            <h2>My Orders</h2>
            <div class="empty-state" style="padding:2.5rem 1rem">
                <div style="font-size:2.5rem;margin-bottom:.5rem">📦</div>
                <h3>Log in to see your orders</h3>
                <p>Your order history will appear here once you're logged in.</p>
                <a href="login.html?next=account.html#orders"
                   class="btn btn-primary" style="margin-top:1rem">Login</a>
            </div>
        `;
        return;
    }

    /* ---- Loading state ---- */
    host.innerHTML = `
        <h2>My Orders</h2>
        <div class="empty-state" style="padding:3rem 1rem">
            <div class="pxc-page-loader__spinner"
                 style="margin:0 auto 1rem;border-color:rgba(0,0,0,.08);
                        border-top-color:#0a0a0a"></div>
            <h3>Loading your orders…</h3>
        </div>
    `;

    /* ---- Fetch (falls back to localStorage) ---- */
    var orders = [];
    try {
        orders = await PXC.fetchMyOrders();
    } catch (e) {
        console.warn('[account] fetchMyOrders failed:', e);
        try { orders = PXC.getUserOrders(); } catch (e2) { orders = []; }
    }

    if (!orders || orders.length === 0) {
        host.innerHTML = `
            <h2>My Orders</h2>
            <div class="empty-state" style="padding:3rem 1rem">
                <div style="font-size:3rem;margin-bottom:.5rem">📦</div>
                <h3>No orders yet</h3>
                <p>When you place an order, it will appear here.</p>
                <a href="products.html" class="btn btn-primary" style="margin-top:1rem">
                    Start shopping
                </a>
            </div>
        `;
        return;
    }

    var sorted = orders.slice().sort(function (a, b) {
        return new Date(b.date) - new Date(a.date);
    });

    host.innerHTML = `
        <h2>My Orders</h2>
        ${sorted.map(orderCard).join('')}
        <div style="text-align:center;padding-top:1rem">
            <a href="products.html" class="btn btn-primary">Continue shopping</a>
        </div>
    `;

    var reorderBtns = host.querySelectorAll('[data-reorder]');
    for (var i = 0; i < reorderBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                reorder(btn.dataset.reorder, orders);
            });
        })(reorderBtns[i]);
    }
}

function reorder(orderId, orders) {
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order) return;

    var added = 0;
    var missed = 0;

    var items = order.items || [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var pid = item.id || item.productId;
        var p = PXC.getProduct(pid);

        if (!p) {
            missed++;
            continue;
        }

        try {
            PXC.addToCart(pid, item.qty);
            added++;
        } catch (e) { }
    }

    if (added === 0) {
        PXCUI.toast('These items are no longer available', 'error');
        return;
    }

    var itemWord = (added === 1) ? '' : 's';
    var msg;
    if (missed > 0) {
        msg = 'Added ' + added + ' item' + itemWord + ' (' + missed + ' unavailable)';
    } else {
        msg = 'Added ' + added + ' item' + itemWord + ' to your cart 🛒';
    }

    PXCUI.toast(msg, 'success');
    setTimeout(function () {
        PXCUI.navigate('cart.html', 'Going to cart');
    }, 500);
}

function orderCard(order) {
    var esc = PXCUI.escapeHtml;
    var itemCount = (order.items || []).reduce(function (sum, i) {
        return sum + (Number(i.qty) || 0);
    }, 0);

    var badgeClass = '';
    if (order.status === 'Delivered') {
        badgeClass = 'bestseller';
    } else if (order.status === 'Processing') {
        badgeClass = 'new';
    }

    var itemWord = (itemCount === 1) ? '' : 's';

    return `
        <div class="cart-summary-box" style="position:static;margin-bottom:1rem">
            <div style="display:flex;justify-content:space-between;
                        align-items:flex-start;gap:1rem;flex-wrap:wrap">
                <div>
                    <div style="font-weight:700">Order #${esc(order.id)}</div>
                    <div style="font-size:.82rem;color:var(--muted-foreground);
                                margin-top:.2rem">
                        Placed on ${formatDate(order.date)} · ${itemCount} item${itemWord}
                    </div>
                </div>
                <span class="product-badge ${badgeClass}" style="position:static">
                    ${esc(order.status || 'Processing')}
                </span>
            </div>

            <div style="border-top:1px solid var(--border);margin-top:.75rem;
                        padding-top:.75rem;display:flex;justify-content:space-between;
                        align-items:center;font-size:.9rem;flex-wrap:wrap;gap:.5rem">
                <span>Total: <strong>${PXC.fmt(order.total)}</strong></span>
                <button type="button" class="btn btn-outline btn-sm"
                        data-reorder="${esc(order.id)}">
                    Order again
                </button>
            </div>
        </div>
    `;
}


/* =========================================================
   UTILITIES
   ========================================================= */
function getInitials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(function (p) {
        return p !== '';
    });

    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();

    return (parts[0].charAt(0) +
        parts[parts.length - 1].charAt(0)).toUpperCase();
}

var _pxcDateFmt = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
    ? new Intl.DateTimeFormat('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

function formatDate(iso) {
    if (!iso) return '—';
    try {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return _pxcDateFmt ? _pxcDateFmt.format(d) : d.toDateString();
    } catch (e) {
        return '—';
    }
}