'use strict';

(function () {

    // ---------- page state ----------
    var state = {
        orders: [],
        filtered: [],
        selected: new Set(),
        filters: { q: '', status: 'all', since: '', until: '' },
        sort: 'newest'
    };

    var STATUSES = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];

    var tableHost, countLabel, bulkBar, statusTabs;

    /* =========================================================
       BOOT
       ========================================================= */
    document.addEventListener('DOMContentLoaded', async function () {
        var user = await AdminAuth.require();
        if (!user) return;

        AdminUI.mount({
            activePage: 'orders',
            title: 'Orders',
            subtitle: 'Process and track customer orders',
            content: renderLayout()
        });

        tableHost = document.getElementById('ordTableHost');
        countLabel = document.getElementById('ordCount');
        bulkBar = document.getElementById('ordBulkBar');
        statusTabs = document.getElementById('ordStatusTabs');

        wireToolbar();
        wireBulkBar();

        await loadOrders();
        openLiveSocket();
    });

    /* =========================================================
       LAYOUT  (HTML stays the same)
       ========================================================= */
    function renderLayout() {
        var tabs = ['all'].concat(STATUSES).map(function (s) {
            var label = (s === 'all') ? 'All orders' : s;
            return `
                <button type="button"
                        class="ord-tab ${s === 'all' ? 'ord-tab--active' : ''}"
                        data-status="${s}">
                    ${AdminUI.escapeHtml(label)}
                    <span class="ord-tab__count" data-count="${s}" hidden>0</span>
                </button>
            `;
        }).join('');

        return `
            <section class="admin-card admin-mb-3">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">All orders</h3>
                        <p class="admin-card__subtitle" id="ordCount">Loading…</p>
                    </div>
                    <div class="admin-flex admin-flex-wrap" style="gap:8px">
                        <button type="button" class="admin-btn admin-btn--outline admin-btn--sm" id="ordExportBtn">
                            Export CSV
                        </button>
                        <button type="button" class="admin-btn admin-btn--primary admin-btn--sm" id="ordRefreshBtn">
                            Refresh
                        </button>
                    </div>
                </div>

                <div class="admin-card__body" style="padding-bottom:0">
                    <div class="ord-tabs" id="ordStatusTabs" role="tablist">${tabs}</div>
                </div>

                <div class="admin-card__body" id="ordToolbar">
                    <div class="admin-toolbar">
                        <div class="admin-search admin-toolbar__grow">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round">
                                <circle cx="11" cy="11" r="7"/>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            </svg>
                            <input type="search" id="ordSearch"
                                   placeholder="Search order ID, customer name or email…"
                                   autocomplete="off">
                        </div>

                        <input type="date" id="ordSince" aria-label="From date" class="ord-date-input">
                        <input type="date" id="ordUntil" aria-label="To date"   class="ord-date-input">

                        <select id="ordSort" aria-label="Sort orders">
                            <option value="newest">Newest first</option>
                            <option value="oldest">Oldest first</option>
                            <option value="total-desc">Total (high → low)</option>
                            <option value="total-asc">Total (low → high)</option>
                        </select>

                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="ordResetFilters">
                            Reset
                        </button>
                    </div>
                </div>
            </section>

            <div class="admin-card" style="display:none" id="ordBulkBar">
                <div class="admin-card__body" style="padding:14px 20px">
                    <div class="admin-flex admin-flex-wrap" style="gap:12px">
                        <strong id="ordBulkCount" style="font-size:.9rem">0 selected</strong>
                        <div style="flex:1"></div>
                        <button type="button" class="admin-btn admin-btn--danger admin-btn--sm" id="ordBulkDelete">
                            Delete selected
                        </button>
                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="ordBulkClear">
                            Clear
                        </button>
                    </div>
                </div>
            </div>

            <section class="admin-card">
                <div class="admin-card__body admin-card__body--flush" id="ordTableHost">
                    ${skeleton()}
                </div>
            </section>
        `;
    }

    function skeleton(rows) {
        if (rows === undefined) rows = 6;

        var out = '<div style="padding:16px 20px">';
        for (var i = 0; i < rows; i++) {
            out += `<div style="height:56px;border-radius:8px;margin-bottom:12px;
                        background:linear-gradient(90deg,#f1f3f5 0%,#e9ecef 50%,#f1f3f5 100%);
                        background-size:200% 100%;
                        animation:adminShimmer 1.4s ease-in-out infinite"></div>`;
        }
        return out + '</div>';
    }

    /* =========================================================
       DATA LOADING
       ========================================================= */
    async function loadOrders(silent) {
        if (silent === undefined) silent = false;

        if (!silent && tableHost) {
            tableHost.innerHTML = skeleton();
        }

        try {
            var res = await API.orders.list({ limit: 500 });
            state.orders = Array.isArray(res.orders) ? res.orders : [];
            applyAndRender();
            updateStatusCounts();

        } catch (err) {
            console.error('[orders] load failed:', err);
            if (tableHost) {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '⚠️',
                    title: 'Could not load orders',
                    message: err.message || 'Please refresh the page.'
                });
            }
        }
    }

    function updateStatusCounts() {
        var counts = { all: state.orders.length };
        for (var i = 0; i < STATUSES.length; i++) {
            counts[STATUSES[i]] = 0;
        }

        for (var j = 0; j < state.orders.length; j++) {
            var o = state.orders[j];
            var s = o.status || 'Processing';
            if (counts[s] !== undefined) counts[s]++;
        }

        var badges = document.querySelectorAll('[data-count]');
        for (var k = 0; k < badges.length; k++) {
            var el = badges[k];
            var key = el.dataset.count;
            var val = counts[key] || 0;
            el.textContent = val;
            el.hidden = (val === 0 && key !== 'all');
        }
    }

    /* =========================================================
       FILTER + SORT + RENDER
       ========================================================= */
    function applyAndRender() {
        var list = state.orders.slice();

        // status
        if (state.filters.status !== 'all') {
            list = list.filter(function (o) {
                return o.status === state.filters.status;
            });
        }

        // search
        if (state.filters.q) {
            var q = state.filters.q.toLowerCase();
            list = list.filter(function (o) {
                var id = String(o.id || '').toLowerCase();
                var name = String(o.customerName || '').toLowerCase();
                var email = String(o.customerEmail || '').toLowerCase();
                return id.indexOf(q) !== -1 ||
                    name.indexOf(q) !== -1 ||
                    email.indexOf(q) !== -1;
            });
        }

        // date range
        if (state.filters.since) {
            var sinceT = new Date(state.filters.since + 'T00:00:00').getTime();
            list = list.filter(function (o) {
                return new Date(o.date).getTime() >= sinceT;
            });
        }
        if (state.filters.until) {
            var untilT = new Date(state.filters.until + 'T23:59:59').getTime();
            list = list.filter(function (o) {
                return new Date(o.date).getTime() <= untilT;
            });
        }

        // sort — lookup object
        var sorters = {
            'oldest': function (a, b) {
                return new Date(a.date) - new Date(b.date);
            },
            'total-desc': function (a, b) {
                return (b.total || 0) - (a.total || 0);
            },
            'total-asc': function (a, b) {
                return (a.total || 0) - (b.total || 0);
            },
            'newest': function (a, b) {
                return new Date(b.date) - new Date(a.date);
            }
        };
        list.sort(sorters[state.sort] || sorters.newest);

        state.filtered = list;
        renderTable();
        updateCount();
    }

    function updateCount() {
        var total = state.orders.length;
        var visible = state.filtered.length;

        if (countLabel) {
            if (visible === total) {
                countLabel.textContent = total + ' order' + (total === 1 ? '' : 's');
            } else {
                countLabel.textContent = visible + ' of ' + total + ' orders';
            }
        }
    }

    function renderTable() {
        if (!tableHost) return;

        var list = state.filtered;

        // empty states
        if (list.length === 0) {
            if (state.orders.length === 0) {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '🧾',
                    title: 'No orders yet',
                    message: 'When a customer places an order, it will appear here instantly.'
                });
            } else {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '🔍',
                    title: 'No matching orders',
                    message: 'Try a different filter or reset the search.',
                    actionHtml:
                        '<button type="button" class="admin-btn admin-btn--outline" ' +
                        'onclick="document.getElementById(\'ordResetFilters\').click()">' +
                        'Reset filters</button>'
                });
            }
            return;
        }

        tableHost.innerHTML = `
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th class="admin-th">Order</th>
                            <th class="admin-th">Customer</th>
                            <th class="admin-th admin-th--center">Items</th>
                            <th class="admin-th admin-th--right">Total</th>
                            <th class="admin-th admin-th--center">Status</th>
                            <th class="admin-th">Placed</th>
                            <th class="admin-th admin-th--right" style="width:120px">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${list.map(renderRow).join('')}</tbody>
                </table>
            </div>
        `;

        wireTableEvents();
    }

    function renderRow(o) {
        var esc = AdminUI.escapeHtml;

        var itemCount = (o.items || []).reduce(function (sum, item) {
            return sum + (Number(item.qty) || 0);
        }, 0);

        var toneClass;
        if (o.status === 'Delivered') {
            toneClass = 'ok';
        } else if (o.status === 'Cancelled') {
            toneClass = 'bad';
        } else if (o.status === 'Shipped') {
            toneClass = 'warn';
        } else {
            toneClass = 'info';
        }

        return `
            <tr data-id="${esc(o.id)}" class="ord-row">
                <td class="admin-td admin-td--strong">${esc(o.id)}</td>
                <td class="admin-td">
                    <div class="ord-customer">
                        <div class="admin-cell-media__name">${esc(o.customerName || '—')}</div>
                        <div class="admin-cell-media__meta">${esc(o.customerEmail || '')}</div>
                    </div>
                </td>
                <td class="admin-td admin-td--center admin-td--muted">
                    ${itemCount} item${itemCount === 1 ? '' : 's'}
                </td>
                <td class="admin-td admin-td--right admin-td--strong">${AdminUI.money(o.total || 0)}</td>
                <td class="admin-td admin-td--center">
                    <span class="admin-badge admin-badge--${toneClass}">
                        ${esc(o.status || 'Processing')}
                    </span>
                </td>
                <td class="admin-td admin-td--muted">
                    <div>${AdminUI.date(o.date)}</div>
                    <div style="font-size:.72rem">${AdminUI.relativeTime(o.date)}</div>
                </td>
                <td class="admin-td admin-td--right">
                    <div class="admin-row-actions">
                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm"
                                data-action="view" data-id="${esc(o.id)}">
                            View
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function wireTableEvents() {
        var rows = document.querySelectorAll('.ord-row');
        for (var i = 0; i < rows.length; i++) {
            (function (row) {
                row.addEventListener('click', function (e) {
                    if (e.target.closest('button')) return;
                    openOrderDrawer(row.dataset.id);
                });
            })(rows[i]);
        }

        var viewBtns = document.querySelectorAll('[data-action="view"]');
        for (var j = 0; j < viewBtns.length; j++) {
            (function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openOrderDrawer(btn.dataset.id);
                });
            })(viewBtns[j]);
        }
    }

    /* =========================================================
       TOOLBAR
       ========================================================= */
    function wireToolbar() {
        var search = document.getElementById('ordSearch');
        var since = document.getElementById('ordSince');
        var until = document.getElementById('ordUntil');
        var sortEl = document.getElementById('ordSort');
        var reset = document.getElementById('ordResetFilters');

        // debounced search
        var timer;
        search.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                state.filters.q = search.value.trim();
                applyAndRender();
            }, 180);
        });

        since.addEventListener('change', function (e) {
            state.filters.since = e.target.value;
            applyAndRender();
        });

        until.addEventListener('change', function (e) {
            state.filters.until = e.target.value;
            applyAndRender();
        });

        sortEl.addEventListener('change', function (e) {
            state.sort = e.target.value;
            applyAndRender();
        });

        reset.addEventListener('click', function () {
            state.filters = { q: '', status: 'all', since: '', until: '' };
            state.sort = 'newest';

            search.value = '';
            since.value = '';
            until.value = '';
            sortEl.value = 'newest';

            var tabs = document.querySelectorAll('.ord-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.toggle('ord-tab--active', tabs[i].dataset.status === 'all');
            }

            applyAndRender();
        });

        // status tabs
        statusTabs.addEventListener('click', function (e) {
            var btn = e.target.closest('.ord-tab');
            if (!btn) return;

            var allTabs = document.querySelectorAll('.ord-tab');
            for (var i = 0; i < allTabs.length; i++) {
                allTabs[i].classList.toggle('ord-tab--active', allTabs[i] === btn);
            }

            state.filters.status = btn.dataset.status;
            applyAndRender();
        });

        document.getElementById('ordRefreshBtn').addEventListener('click', function () {
            loadOrders(false);
            AdminUI.toast('Refreshed', 'success');
        });

        document.getElementById('ordExportBtn').addEventListener('click', exportCSV);
    }

    /* =========================================================
       BULK BAR
       ========================================================= */
    function wireBulkBar() {
        document.getElementById('ordBulkClear').addEventListener('click', function () {
            state.selected.clear();
            updateBulkBar();
        });

        document.getElementById('ordBulkDelete').addEventListener('click', bulkDelete);
    }

    function updateBulkBar() {
        if (!bulkBar) return;

        var count = state.selected.size;
        bulkBar.style.display = (count === 0) ? 'none' : 'block';

        if (count > 0) {
            document.getElementById('ordBulkCount').textContent = count + ' selected';
        }
    }

    /* =========================================================
       ORDER DRAWER
       ========================================================= */
    function openOrderDrawer(id) {
        var order = state.orders.find(function (o) { return o.id === id; });
        if (!order) {
            AdminUI.toast('Order not found', 'error');
            return;
        }

        var overlay = document.createElement('div');
        overlay.className = 'ord-drawer-overlay';
        overlay.innerHTML = `
            <aside class="ord-drawer" role="dialog" aria-modal="true">
                <header class="ord-drawer__head">
                    <div>
                        <div class="ord-drawer__eyebrow">Order</div>
                        <h2 class="ord-drawer__title">${AdminUI.escapeHtml(order.id)}</h2>
                    </div>
                    <button type="button" class="ord-drawer__close" data-role="close" aria-label="Close">✕</button>
                </header>

                <div class="ord-drawer__body">${renderDrawerContent(order)}</div>

                <footer class="ord-drawer__foot">
                    <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-role="close">Close</button>
                    <div style="flex:1"></div>
                    <button type="button" class="admin-btn admin-btn--outline admin-btn--sm" data-role="print">
                        Print invoice
                    </button>
                    <button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-role="delete">
                        Delete order
                    </button>
                </footer>
            </aside>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(function () {
            overlay.classList.add('ord-drawer-overlay--open');
        });

        // close handlers
        var close = function () {
            overlay.classList.remove('ord-drawer-overlay--open');
            setTimeout(function () { overlay.remove(); }, 220);
            document.removeEventListener('keydown', onKey);
        };
        var onKey = function (e) {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', onKey);

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) return close();
            if (e.target.closest('[data-role="close"]')) return close();
            if (e.target.closest('[data-role="print"]')) return printInvoice(order);
            if (e.target.closest('[data-role="delete"]')) return deleteOrder(order, close);
        });

        // wire status select
        wireStatusSelect(overlay, order);
    }

    // Wire the status <select> in the drawer.
    // Re-used after each re-render inside the drawer.
    function wireStatusSelect(overlay, order) {
        var select = overlay.querySelector('#ordStatusSelect');
        if (!select) return;

        select.addEventListener('change', async function () {
            var next = select.value;
            var current = order.status;

            if (next === current) return;

            // confirm before cancelling
            if (next === 'Cancelled') {
                var ok = await AdminUI.confirm({
                    title: 'Cancel this order?',
                    message: 'The stock will be restored to the products in this order.',
                    okLabel: 'Yes, cancel order',
                    danger: true
                });
                if (!ok) {
                    select.value = current;
                    return;
                }
            }

            await changeOrderStatus(order, next, overlay);
        });
    }

    function renderDrawerContent(order) {
        var esc = AdminUI.escapeHtml;

        var itemsRows = (order.items || []).map(function (item) {
            return `
                <tr>
                    <td class="admin-td">
                        <div class="admin-cell-media">
                            <img class="admin-thumb"
                                 src="${esc(item.image || '')}"
                                 alt=""
                                 onerror="this.style.visibility='hidden'">
                            <div class="admin-cell-media__text">
                                <div class="admin-cell-media__name">${esc(item.name || '—')}</div>
                                <div class="admin-cell-media__meta">${esc(item.brand || '')}</div>
                            </div>
                        </div>
                    </td>
                    <td class="admin-td admin-td--center">${item.qty}</td>
                    <td class="admin-td admin-td--right">${AdminUI.money(item.price)}</td>
                    <td class="admin-td admin-td--right admin-td--strong">
                        ${AdminUI.money((item.price || 0) * (item.qty || 0))}
                    </td>
                </tr>
            `;
        }).join('');

        var statusOptions = STATUSES.map(function (s) {
            return '<option value="' + s + '" ' +
                (s === order.status ? 'selected' : '') + '>' + s + '</option>';
        }).join('');

        var addr = order.address || {};
        var timeline = Array.isArray(order.statusHistory)
            ? order.statusHistory.slice().reverse()
            : [];

        var timelineRows = timeline.map(function (t) {
            return `
                <li>
                    <span class="ord-timeline__dot"></span>
                    <div>
                        <div class="ord-timeline__status">${esc(t.status)}</div>
                        <div class="ord-timeline__meta">
                            ${AdminUI.datetime(t.date)}${t.by ? ' · ' + esc(t.by) : ''}
                        </div>
                    </div>
                </li>
            `;
        }).join('');

        return `
            <section class="ord-drawer__section">
                <label class="ord-drawer__label" for="ordStatusSelect">Status</label>
                <select id="ordStatusSelect" class="ord-drawer__status-select">${statusOptions}</select>
            </section>

            <section class="ord-drawer__section">
                <div class="ord-drawer__grid">
                    <div>
                        <div class="ord-drawer__label">Customer</div>
                        <div class="ord-drawer__value">${esc(order.customerName || '—')}</div>
                        <div class="ord-drawer__sub">${esc(order.customerEmail || '')}</div>
                    </div>
                    <div>
                        <div class="ord-drawer__label">Placed</div>
                        <div class="ord-drawer__value">${AdminUI.date(order.date)}</div>
                        <div class="ord-drawer__sub">${AdminUI.relativeTime(order.date)}</div>
                    </div>
                </div>
            </section>

            <section class="ord-drawer__section">
                <div class="ord-drawer__label">Items (${(order.items || []).length})</div>
                <div class="admin-table-wrap"
                     style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
                    <table class="admin-table" style="min-width:0">
                        <thead>
                            <tr>
                                <th class="admin-th">Product</th>
                                <th class="admin-th admin-th--center" style="width:60px">Qty</th>
                                <th class="admin-th admin-th--right"  style="width:90px">Price</th>
                                <th class="admin-th admin-th--right"  style="width:100px">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>${itemsRows}</tbody>
                    </table>
                </div>
            </section>

            <section class="ord-drawer__section">
                ${totalRow('Subtotal', AdminUI.money(order.subtotal || 0))}
                ${totalRow('Shipping',
            order.shipping > 0
                ? AdminUI.money(order.shipping)
                : '<span style="color:var(--success)">FREE</span>')}
                ${order.tax > 0 ? totalRow('Tax', AdminUI.money(order.tax)) : ''}
                <div class="ord-total-row ord-total-row--grand">
                    <span>Total</span>
                    <strong>${AdminUI.money(order.total || 0)}</strong>
                </div>
            </section>

            <section class="ord-drawer__section">
                <div class="ord-drawer__label">Delivery address</div>
                <div class="ord-drawer__address">
                    <div><strong>${esc(addr.name || '—')}</strong></div>
                    ${addr.phone ? `<div>${esc(addr.phone)}</div>` : ''}
                    <div>${esc(addr.line1 || '')}${addr.line2 ? ', ' + esc(addr.line2) : ''}</div>
                    <div>
                        ${esc(addr.city || '')}${addr.state ? ', ' + esc(addr.state) : ''}
                        ${addr.pincode ? ' - ' + esc(addr.pincode) : ''}
                    </div>
                </div>
            </section>

            <section class="ord-drawer__section">
                <div class="ord-drawer__grid">
                    <div>
                        <div class="ord-drawer__label">Payment method</div>
                        <div class="ord-drawer__value">${esc((order.payment && order.payment.method) || 'COD')}</div>
                    </div>
                    <div>
                        <div class="ord-drawer__label">Payment status</div>
                        <div class="ord-drawer__value">${esc((order.payment && order.payment.status) || 'Pending')}</div>
                    </div>
                </div>
            </section>

            ${order.notes ? `
                <section class="ord-drawer__section">
                    <div class="ord-drawer__label">Order notes</div>
                    <div class="ord-drawer__value" style="font-weight:400;font-size:.85rem">
                        ${esc(order.notes)}
                    </div>
                </section>
            ` : ''}

            ${timeline.length ? `
                <section class="ord-drawer__section">
                    <div class="ord-drawer__label">Status history</div>
                    <ul class="ord-timeline">${timelineRows}</ul>
                </section>
            ` : ''}
        `;
    }

    function totalRow(label, valueHtml) {
        return `
            <div class="ord-total-row">
                <span>${label}</span>
                <strong>${valueHtml}</strong>
            </div>
        `;
    }

    /* =========================================================
       STATUS CHANGE
       ========================================================= */
    async function changeOrderStatus(order, nextStatus, drawerEl) {
        try {
            var res = await API.orders.updateStatus(order.id, nextStatus);

            if (!res || !res.ok) {
                throw new Error((res && res.error) || 'Update failed');
            }

            var idx = state.orders.findIndex(function (o) {
                return o.id === order.id;
            });
            if (idx !== -1 && res.order) {
                state.orders[idx] = res.order;
            }

            // re-render the drawer body and re-wire the select
            if (drawerEl && res.order) {
                var body = drawerEl.querySelector('.ord-drawer__body');
                if (body) {
                    body.innerHTML = renderDrawerContent(res.order);
                    wireStatusSelect(drawerEl, res.order);
                }
            }

            applyAndRender();
            updateStatusCounts();

            var toastText;
            if (res.restocked) {
                toastText = 'Order cancelled — stock restored';
            } else {
                toastText = 'Status updated to ' + nextStatus;
            }
            AdminUI.toast(toastText, 'success');

        } catch (err) {
            AdminUI.toast(err.message || 'Could not update status', 'error');
        }
    }

    /* =========================================================
       DELETE
       ========================================================= */
    async function deleteOrder(order, closeDrawer) {
        var ok = await AdminUI.confirm({
            title: 'Delete order ' + order.id + '?',
            message: 'This action cannot be undone. Stock will be restored if the order was not already cancelled.',
            okLabel: 'Delete order',
            danger: true
        });
        if (!ok) return;

        try {
            await API.orders.remove(order.id);

            state.orders = state.orders.filter(function (o) {
                return o.id !== order.id;
            });
            applyAndRender();
            updateStatusCounts();

            if (typeof closeDrawer === 'function') closeDrawer();
            AdminUI.toast('Order deleted', 'success');

        } catch (err) {
            AdminUI.toast(err.message || 'Could not delete order', 'error');
        }
    }

    /* =========================================================
       BULK DELETE
       ========================================================= */
    async function bulkDelete() {
        var ids = Array.from(state.selected);
        if (ids.length === 0) return;

        var ok = await AdminUI.confirm({
            title: 'Delete ' + ids.length + ' order' + (ids.length === 1 ? '' : 's') + '?',
            message: 'Stock will be restored for any non-cancelled orders.',
            okLabel: 'Delete all',
            danger: true
        });
        if (!ok) return;

        AdminUI.showLoader('Deleting…');

        var deleted = 0;
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            try {
                await API.orders.remove(id);
                state.orders = state.orders.filter(function (o) {
                    return o.id !== id;
                });
                state.selected.delete(id);
                deleted++;
            } catch (e) {
                // keep going
            }
        }

        AdminUI.hideLoader();
        applyAndRender();
        updateStatusCounts();
        updateBulkBar();

        if (deleted > 0) {
            AdminUI.toast(deleted + ' order' + (deleted === 1 ? '' : 's') + ' deleted', 'success');
        }
    }

    /* =========================================================
       PRINT INVOICE
       ========================================================= */
    function printInvoice(order) {
        var html = buildInvoiceHtml(order);

        var w = window.open('', '_blank', 'width=800,height=900');
        if (!w) {
            AdminUI.toast('Please allow pop-ups to print invoices', 'warn');
            return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    function buildInvoiceHtml(order) {
        var esc = AdminUI.escapeHtml;
        var addr = order.address || {};

        var itemRows = (order.items || []).map(function (item) {
            return `
                <tr>
                    <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb">
                        <div style="font-weight:600">${esc(item.name || '—')}</div>
                        <div style="font-size:11px;color:#6b7280">${esc(item.brand || '')}</div>
                    </td>
                    <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${item.qty}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${AdminUI.money(item.price)}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">
                        ${AdminUI.money((item.price || 0) * (item.qty || 0))}
                    </td>
                </tr>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Invoice ${esc(order.id)} — TeamZampXUnited</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Inter', sans-serif; color: #0a0a0a; margin: 0; padding: 40px; background: #fff; }
  .wrap { max-width: 720px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0a0a0a; padding-bottom: 20px; margin-bottom: 28px; }
  .brand { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 24px; letter-spacing: -.03em; }
  .brand span { color: #dc2626; }
  .brand small { display: block; font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 500; color: #6b7280; letter-spacing: .1em; text-transform: uppercase; margin-top: 4px; }
  .invoice-id { text-align: right; font-size: 12px; color: #6b7280; }
  .invoice-id strong { display: block; font-family: 'Poppins', sans-serif; font-size: 20px; color: #0a0a0a; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .meta h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #6b7280; margin: 0 0 6px; }
  .meta p { margin: 2px 0; font-size: 13px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; padding: 10px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; border-bottom: 2px solid #0a0a0a; }
  .totals { text-align: right; margin-top: 12px; }
  .totals tr td { padding: 4px 0; font-size: 13px; }
  .totals tr.grand td { font-size: 16px; font-weight: 700; border-top: 2px solid #0a0a0a; padding-top: 10px; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #6b7280; line-height: 1.6; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
  .print-bar { max-width: 720px; margin: 0 auto 20px; display: flex; justify-content: flex-end; gap: 8px; }
  .print-bar button { padding: 8px 16px; font-size: 13px; font-weight: 500; border: 1px solid #d4d4d4; background: #fff; border-radius: 8px; cursor: pointer; }
  .print-bar button.primary { background: #0a0a0a; color: #fff; border-color: #0a0a0a; }
</style>
</head>
<body>
  <div class="print-bar no-print">
    <button onclick="window.close()">Close</button>
    <button class="primary" onclick="window.print()">Print / Save PDF</button>
  </div>
  <div class="wrap">
    <header>
      <div class="brand">Team ZAMP<span> X </span> United<small>Order Invoice</small></div>
      <div class="invoice-id">Invoice<strong>${esc(order.id)}</strong>${AdminUI.date(order.date)}</div>
    </header>

    <div class="meta">
      <div>
        <h3>Billed to</h3>
        <p><strong>${esc(addr.name || order.customerName || '—')}</strong></p>
        ${addr.phone ? `<p>${esc(addr.phone)}</p>` : ''}
        <p>${esc(addr.line1 || '')}${addr.line2 ? ', ' + esc(addr.line2) : ''}</p>
        <p>${esc(addr.city || '')}${addr.state ? ', ' + esc(addr.state) : ''}${addr.pincode ? ' - ' + esc(addr.pincode) : ''}</p>
        ${order.customerEmail ? `<p>${esc(order.customerEmail)}</p>` : ''}
      </div>
      <div>
        <h3>Order details</h3>
        <p>Status: <strong>${esc(order.status || 'Processing')}</strong></p>
        <p>Payment: ${esc((order.payment && order.payment.method) || 'COD')}</p>
        <p>Payment status: ${esc((order.payment && order.payment.status) || 'Pending')}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:center;width:60px">Qty</th>
          <th style="text-align:right;width:100px">Price</th>
          <th style="text-align:right;width:110px">Subtotal</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <table class="totals">
      <tr><td>Subtotal</td><td style="padding-left:20px">${AdminUI.money(order.subtotal || 0)}</td></tr>
      <tr><td>Shipping</td><td style="padding-left:20px">${order.shipping > 0 ? AdminUI.money(order.shipping) : 'FREE'}</td></tr>
      ${order.tax > 0 ? `<tr><td>Tax</td><td style="padding-left:20px">${AdminUI.money(order.tax)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td style="padding-left:20px">${AdminUI.money(order.total || 0)}</td></tr>
    </table>

    <div class="footer">
      <strong>Thank you for shopping with Team ZAMP X United</strong><br>
      support@TeamZAMPXUnited · +91 90000 00000 · Bengaluru, India<br>
      This is a computer-generated invoice. No signature required.
    </div>
  </div>
</body>
</html>`;
    }

    /* =========================================================
       EXPORT CSV
       ========================================================= */
    function exportCSV() {
        var list = state.filtered;
        if (list.length === 0) {
            AdminUI.toast('Nothing to export', 'warn');
            return;
        }

        var headers = [
            'Order ID', 'Date', 'Customer', 'Email', 'Items',
            'Subtotal', 'Shipping', 'Tax', 'Total', 'Status',
            'Payment Method', 'Payment Status'
        ];

        var rows = list.map(function (o) {
            var itemCount = (o.items || []).reduce(function (sum, item) {
                return sum + (item.qty || 0);
            }, 0);

            return [
                o.id, o.date, o.customerName || '', o.customerEmail || '',
                itemCount, o.subtotal || 0, o.shipping || 0, o.tax || 0,
                o.total || 0, o.status || '',
                (o.payment && o.payment.method) || '',
                (o.payment && o.payment.status) || ''
            ];
        });

        var allRows = [headers].concat(rows);

        var csvLines = allRows.map(function (row) {
            var cells = row.map(function (cell) {
                var s;
                if (cell === null || cell === undefined) {
                    s = '';
                } else {
                    s = String(cell);
                }
                if (/[",\n]/.test(s)) {
                    return '"' + s.replace(/"/g, '""') + '"';
                }
                return s;
            });
            return cells.join(',');
        });

        var csv = csvLines.join('\n');

        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');

        a.href = url;
        a.download = 'TeamZampXUnited-orders-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        AdminUI.toast('Exported ' + list.length + ' orders', 'success');
    }

    /* =========================================================
       LIVE SOCKET
       ========================================================= */
    function openLiveSocket() {
        if (typeof io !== 'function') return;

        var socket;
        try {
            socket = io({
                auth: { token: API.token.get() },
                transports: ['websocket', 'polling']
            });
        } catch (e) {
            return;
        }

        socket.on('activity:new', function (entry) {
            if (!entry || !entry.type) return;
            if (entry.type.indexOf('order:') === 0 ||
                entry.type.indexOf('stock:') === 0) {
                loadOrders(true);
            }
        });
    }

    /* =========================================================
       INJECT PAGE STYLES  (CSS unchanged)
       ========================================================= */
    (function injectStyles() {
        if (document.getElementById('ordStyles')) return;

        var s = document.createElement('style');
        s.id = 'ordStyles';
        s.textContent = `
            /* Tabs */
            .ord-tabs {
                display: flex;
                gap: 4px;
                border-bottom: 1px solid var(--border);
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
            }
            .ord-tab {
                padding: 12px 16px;
                font-size: .85rem;
                font-weight: 500;
                color: var(--muted);
                white-space: nowrap;
                border-bottom: 2px solid transparent;
                transition: color .18s var(--ease), border-color .18s var(--ease);
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .ord-tab:hover       { color: var(--fg); }
            .ord-tab--active     { color: var(--fg); border-bottom-color: var(--fg); }
            .ord-tab__count {
                background: var(--bg);
                color: var(--muted);
                font-size: .7rem;
                font-weight: 600;
                padding: 1px 6px;
                border-radius: 999px;
                min-width: 20px;
                text-align: center;
                line-height: 1.5;
            }
            .ord-tab--active .ord-tab__count {
                background: var(--fg);
                color: #fff;
            }

            /* Toolbar inputs */
            .ord-date-input {
                padding: 9px 12px;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-sm);
                background: #fff;
                font-size: .85rem;
                outline: none;
                min-width: 130px;
            }
            .ord-date-input:focus {
                border-color: var(--fg);
                box-shadow: 0 0 0 3px rgba(15,17,21,.06);
            }
            .ord-customer { min-width: 0; }
            .ord-row      { cursor: pointer; }

            /* Drawer */
            .ord-drawer-overlay {
                position: fixed;
                inset: 0;
                z-index: 8500;
                background: rgba(15,17,21,.55);
                opacity: 0;
                visibility: hidden;
                transition: opacity .22s var(--ease), visibility .22s var(--ease);
            }
            .ord-drawer-overlay--open {
                opacity: 1;
                visibility: visible;
            }
            .ord-drawer {
                position: absolute;
                top: 0;
                right: 0;
                bottom: 0;
                width: min(560px, 100vw);
                background: #fff;
                display: flex;
                flex-direction: column;
                transform: translateX(100%);
                transition: transform .28s var(--ease-out);
                box-shadow: -12px 0 40px rgba(15,17,21,.18);
            }
            .ord-drawer-overlay--open .ord-drawer { transform: translateX(0); }

            .ord-drawer__head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 18px 22px;
                border-bottom: 1px solid var(--border);
                flex-shrink: 0;
            }
            .ord-drawer__eyebrow {
                font-size: .7rem;
                font-weight: 700;
                letter-spacing: .14em;
                text-transform: uppercase;
                color: var(--muted);
            }
            .ord-drawer__title {
                font-family: 'Poppins', sans-serif;
                font-size: 1.15rem;
                font-weight: 700;
                letter-spacing: -.01em;
                margin-top: 2px;
            }
            .ord-drawer__close {
                padding: 8px;
                border-radius: 8px;
                color: var(--muted);
                transition: background .18s var(--ease);
                font-size: 1rem;
            }
            .ord-drawer__close:hover { background: var(--bg); color: var(--fg); }

            .ord-drawer__body {
                flex: 1;
                overflow-y: auto;
                padding: 20px 22px;
            }
            .ord-drawer__foot {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 14px 18px;
                border-top: 1px solid var(--border);
                background: #fafbfc;
                flex-shrink: 0;
            }

            .ord-drawer__section {
                padding: 14px 0;
                border-bottom: 1px solid var(--border);
            }
            .ord-drawer__section:first-child { padding-top: 0; }
            .ord-drawer__section:last-child  { border-bottom: none; padding-bottom: 0; }

            .ord-drawer__label {
                font-size: .7rem;
                font-weight: 700;
                letter-spacing: .12em;
                text-transform: uppercase;
                color: var(--muted);
                margin-bottom: 8px;
            }
            .ord-drawer__value {
                font-size: .92rem;
                font-weight: 600;
                color: var(--fg);
                line-height: 1.45;
            }
            .ord-drawer__sub {
                font-size: .78rem;
                color: var(--muted);
                margin-top: 2px;
            }
            .ord-drawer__grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
            }
            .ord-drawer__address {
                font-size: .88rem;
                line-height: 1.6;
                color: var(--fg-soft);
            }
            .ord-drawer__status-select {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-sm);
                background: #fff;
                font-size: .9rem;
                font-weight: 600;
                outline: none;
                cursor: pointer;
            }
            .ord-drawer__status-select:focus {
                border-color: var(--fg);
                box-shadow: 0 0 0 3px rgba(15,17,21,.06);
            }

            .ord-total-row {
                display: flex;
                justify-content: space-between;
                font-size: .9rem;
                padding: 5px 0;
                color: var(--fg-soft);
            }
            .ord-total-row strong { color: var(--fg); font-weight: 600; }
            .ord-total-row--grand {
                border-top: 1px solid var(--border);
                margin-top: 8px;
                padding-top: 12px;
                font-size: 1.05rem;
                color: var(--fg);
            }
            .ord-total-row--grand strong { font-size: 1.1rem; }

            .ord-timeline {
                list-style: none;
                padding: 0;
                margin: 0;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .ord-timeline li {
                display: flex;
                gap: 12px;
                align-items: flex-start;
            }
            .ord-timeline__dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: var(--fg);
                margin-top: 5px;
                flex-shrink: 0;
            }
            .ord-timeline__status { font-size: .88rem; font-weight: 600; }
            .ord-timeline__meta   { font-size: .74rem; color: var(--muted); margin-top: 2px; }

            @media (max-width: 640px) {
                .ord-drawer       { width: 100vw; }
                .ord-drawer__grid { grid-template-columns: 1fr; gap: 12px; }
                .ord-tabs         { padding: 0 4px; }
                .ord-tab          { padding: 10px 12px; font-size: .8rem; }
            }
        `;
        document.head.appendChild(s);
    })();

})();