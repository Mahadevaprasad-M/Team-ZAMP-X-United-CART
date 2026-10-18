'use strict';

(function () {

    // ---------- page state ----------
    var state = {
        customers: [],
        filtered: [],
        filters: { q: '', vip: false, active: false },
        sort: 'recent'
    };

    var tableHost, countLabel, statsHost;

    /* =========================================================
       BOOT
       ========================================================= */
    document.addEventListener('DOMContentLoaded', async function () {
        var user = await AdminAuth.require();
        if (!user) return;

        AdminUI.mount({
            activePage: 'customers',
            title: 'Customers',
            subtitle: 'Buyers, VIPs and order history',
            content: renderLayout()
        });

        tableHost = document.getElementById('custTableHost');
        countLabel = document.getElementById('custCount');
        statsHost = document.getElementById('custStats');

        wireToolbar();

        await Promise.all([loadStats(), loadCustomers()]);
    });

    /* =========================================================
       LAYOUT  (HTML stays the same)
       ========================================================= */
    function renderLayout() {
        return `
            <div class="admin-kpi-grid" id="custStats">
                ${AdminUI.kpiTile({ label: 'Total customers', value: '—', hint: 'Loading…' })}
                ${AdminUI.kpiTile({ label: 'VIP customers', value: '—', hint: 'Loading…' })}
                ${AdminUI.kpiTile({ label: 'New this month', value: '—', hint: 'Loading…' })}
                ${AdminUI.kpiTile({ label: 'Avg. spend', value: '—', hint: 'Loading…' })}
            </div>

            <section class="admin-card">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">All customers</h3>
                        <p class="admin-card__subtitle" id="custCount">Loading…</p>
                    </div>
                </div>

                <div class="admin-card__body">
                    <div class="admin-toolbar">
                        <div class="admin-search admin-toolbar__grow">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round">
                                <circle cx="11" cy="11" r="7"/>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            </svg>
                            <input type="search" id="custSearch"
                                   placeholder="Search by name or email…"
                                   autocomplete="off">
                        </div>

                        <select id="custSort" aria-label="Sort customers">
                            <option value="recent">Recent activity</option>
                            <option value="spend">Highest spend</option>
                            <option value="orders">Most orders</option>
                            <option value="name">Name (A–Z)</option>
                        </select>

                        <label class="cust-checkbox">
                            <input type="checkbox" id="custVipOnly">
                            <span>VIP only</span>
                        </label>

                        <label class="cust-checkbox">
                            <input type="checkbox" id="custActiveOnly">
                            <span>Active only</span>
                        </label>

                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="custResetFilters">
                            Reset
                        </button>
                    </div>
                </div>

                <div class="admin-card__body admin-card__body--flush" id="custTableHost">
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
       STATS
       ========================================================= */
    async function loadStats() {
        if (!statsHost) return;

        try {
            var res = await API.request('GET', '/api/customers/stats');
            var s = res.stats || {};

            statsHost.innerHTML = [
                AdminUI.kpiTile({
                    label: 'Total customers',
                    value: String(s.total || 0),
                    hint: s.active !== undefined ? s.active + ' active' : 'All registered'
                }),
                AdminUI.kpiTile({
                    label: 'VIP customers',
                    value: String(s.vip || 0),
                    hint: s.vip > 0 ? 'High-value buyers' : 'None yet',
                    tone: s.vip > 0 ? 'up' : 'default'
                }),
                AdminUI.kpiTile({
                    label: 'New this month',
                    value: String(s.newThisMonth || 0),
                    hint: 'Since the 1st'
                }),
                AdminUI.kpiTile({
                    label: 'Avg. spend',
                    value: AdminUI.money(s.averageSpend || 0),
                    hint: (s.withOrders || 0) + ' with orders'
                })
            ].join('');

        } catch (err) {
            console.warn('[customers] stats failed:', err.message);
            statsHost.innerHTML = emptyStats();
        }
    }

    function emptyStats() {
        return [
            AdminUI.kpiTile({ label: 'Total customers', value: '—', hint: 'Stats unavailable' }),
            AdminUI.kpiTile({ label: 'VIP customers', value: '—', hint: 'Stats unavailable' }),
            AdminUI.kpiTile({ label: 'New this month', value: '—', hint: 'Stats unavailable' }),
            AdminUI.kpiTile({ label: 'Avg. spend', value: '—', hint: 'Stats unavailable' })
        ].join('');
    }

    /* =========================================================
       DATA LOADING
       ========================================================= */
    async function loadCustomers() {
        if (tableHost) tableHost.innerHTML = skeleton();

        try {
            var res = await API.customers.list({ limit: 500 });
            state.customers = Array.isArray(res.customers) ? res.customers : [];
            applyAndRender();

        } catch (err) {
            console.error('[customers] load failed:', err);
            if (tableHost) {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '⚠️',
                    title: 'Could not load customers',
                    message: err.message || 'Please refresh the page.'
                });
            }
        }
    }

    /* =========================================================
       FILTER + SORT + RENDER
       ========================================================= */
    function applyAndRender() {
        var list = state.customers.slice();

        // filter: search
        if (state.filters.q) {
            var q = state.filters.q.toLowerCase();
            list = list.filter(function (c) {
                var name = String(c.name || '').toLowerCase();
                var email = String(c.email || '').toLowerCase();
                return name.indexOf(q) !== -1 || email.indexOf(q) !== -1;
            });
        }

        // filter: VIP / active
        if (state.filters.vip) {
            list = list.filter(function (c) { return c.vip; });
        }
        if (state.filters.active) {
            list = list.filter(function (c) { return c.active !== false; });
        }

        // sort
        var sorters = {
            spend: function (a, b) {
                return (b.totalSpent || 0) - (a.totalSpent || 0);
            },
            orders: function (a, b) {
                return (b.orderCount || 0) - (a.orderCount || 0);
            },
            name: function (a, b) {
                return String(a.name || '').localeCompare(String(b.name || ''));
            },
            recent: function (a, b) {
                var ta = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
                var tb = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
                return tb - ta;
            }
        };
        list.sort(sorters[state.sort] || sorters.recent);

        state.filtered = list;
        renderTable();
        updateCount();
    }

    function updateCount() {
        var total = state.customers.length;
        var visible = state.filtered.length;

        if (countLabel) {
            if (visible === total) {
                countLabel.textContent = total + ' customer' + (total === 1 ? '' : 's');
            } else {
                countLabel.textContent = visible + ' of ' + total + ' customers';
            }
        }
    }

    function renderTable() {
        if (!tableHost) return;

        var list = state.filtered;

        if (list.length === 0) {
            if (state.customers.length === 0) {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '👥',
                    title: 'No customers yet',
                    message: 'Customers who register or place an order will appear here.'
                });
            } else {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '🔍',
                    title: 'No matching customers',
                    message: 'Try a different search or reset the filters.',
                    actionHtml:
                        '<button type="button" class="admin-btn admin-btn--outline" ' +
                        'onclick="document.getElementById(\'custResetFilters\').click()">' +
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
                            <th class="admin-th">Customer</th>
                            <th class="admin-th admin-th--center">Orders</th>
                            <th class="admin-th admin-th--right">Total spent</th>
                            <th class="admin-th">Last order</th>
                            <th class="admin-th admin-th--center">Status</th>
                        </tr>
                    </thead>
                    <tbody>${list.map(renderRow).join('')}</tbody>
                </table>
            </div>
        `;

        wireTableEvents();
    }

    function renderRow(c) {
        var esc = AdminUI.escapeHtml;
        var isVip = !!c.vip;
        var isActive = c.active !== false;
        var lastOrder = c.lastOrderAt ? AdminUI.relativeTime(c.lastOrderAt) : '—';

        return `
            <tr data-id="${esc(c.id)}" class="cust-row">
                <td class="admin-td">
                    <div class="admin-cell-media">
                        <div class="admin-avatar admin-avatar--sm">
                            ${esc(AdminUI.initials(c.name))}
                        </div>
                        <div class="admin-cell-media__text">
                            <div class="admin-cell-media__name">
                                ${esc(c.name || '—')}
                                ${isVip ? '<span class="admin-badge admin-badge--warn" style="margin-left:6px">VIP</span>' : ''}
                            </div>
                            <div class="admin-cell-media__meta">${esc(c.email || '')}</div>
                        </div>
                    </div>
                </td>
                <td class="admin-td admin-td--center">${c.orderCount || 0}</td>
                <td class="admin-td admin-td--right admin-td--strong">${AdminUI.money(c.totalSpent || 0)}</td>
                <td class="admin-td admin-td--muted">${esc(lastOrder)}</td>
                <td class="admin-td admin-td--center">
                    <span class="admin-badge admin-badge--${isActive ? 'ok' : 'bad'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
            </tr>
        `;
    }

    function wireTableEvents() {
        var rows = document.querySelectorAll('.cust-row');
        for (var i = 0; i < rows.length; i++) {
            (function (row) {
                row.addEventListener('click', function () {
                    openCustomerDrawer(row.dataset.id);
                });
            })(rows[i]);
        }
    }

    /* =========================================================
       TOOLBAR
       ========================================================= */
    function wireToolbar() {
        var search = document.getElementById('custSearch');
        var sortEl = document.getElementById('custSort');
        var vipEl = document.getElementById('custVipOnly');
        var actEl = document.getElementById('custActiveOnly');
        var resetEl = document.getElementById('custResetFilters');

        // debounced search
        var timer;
        search.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                state.filters.q = search.value.trim();
                applyAndRender();
            }, 180);
        });

        sortEl.addEventListener('change', function (e) {
            state.sort = e.target.value;
            applyAndRender();
        });

        vipEl.addEventListener('change', function (e) {
            state.filters.vip = e.target.checked;
            applyAndRender();
        });

        actEl.addEventListener('change', function (e) {
            state.filters.active = e.target.checked;
            applyAndRender();
        });

        resetEl.addEventListener('click', function () {
            state.filters = { q: '', vip: false, active: false };
            state.sort = 'recent';

            search.value = '';
            sortEl.value = 'recent';
            vipEl.checked = false;
            actEl.checked = false;

            applyAndRender();
        });
    }

    /* =========================================================
       CUSTOMER DRAWER
       ========================================================= */
    async function openCustomerDrawer(id) {
        var customer = state.customers.find(function (c) { return c.id === id; });
        if (!customer) {
            AdminUI.toast('Customer not found', 'error');
            return;
        }

        var overlay = buildDrawerOverlay(customer);
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
        });

        // load detail
        try {
            var res = await API.customers.get(id);
            var body = overlay.querySelector('[data-role="body"]');
            if (!body) return;

            body.innerHTML = renderDrawerContent(res.customer, res.orders || [], res.metrics || {});
            wireDrawerActions(overlay, res.customer);

        } catch (err) {
            var bodyEl = overlay.querySelector('[data-role="body"]');
            if (bodyEl) {
                bodyEl.innerHTML = AdminUI.emptyState({
                    icon: '⚠️',
                    title: 'Could not load customer',
                    message: err.message || 'Please try again.'
                });
            }
        }
    }

    function buildDrawerOverlay(customer) {
        var overlay = document.createElement('div');
        overlay.className = 'ord-drawer-overlay';
        overlay.innerHTML = `
            <aside class="ord-drawer" role="dialog" aria-modal="true">
                <header class="ord-drawer__head">
                    <div>
                        <div class="ord-drawer__eyebrow">Customer</div>
                        <h2 class="ord-drawer__title">${AdminUI.escapeHtml(customer.name || '—')}</h2>
                    </div>
                    <button type="button" class="ord-drawer__close" data-role="close" aria-label="Close">✕</button>
                </header>
                <div class="ord-drawer__body" data-role="body">
                    <div style="padding:40px;text-align:center;color:var(--muted)">Loading…</div>
                </div>
            </aside>
        `;
        return overlay;
    }

    function renderDrawerContent(c, orders, metrics) {
        var esc = AdminUI.escapeHtml;
        var isActive = c.active !== false;

        var orderRows;
        if (orders.length) {
            orderRows = orders.map(function (o) {
                return `
                    <tr class="cust-order-row" data-order-id="${esc(o.id)}">
                        <td class="admin-td admin-td--strong">${esc(o.id)}</td>
                        <td class="admin-td admin-td--muted">${AdminUI.date(o.date)}</td>
                        <td class="admin-td admin-td--center">${o.itemCount}</td>
                        <td class="admin-td admin-td--right admin-td--strong">${AdminUI.money(o.total)}</td>
                        <td class="admin-td admin-td--center">${AdminUI.statusBadge(o.status)}</td>
                    </tr>
                `;
            }).join('');
        } else {
            orderRows = '<tr><td colspan="5" class="admin-td admin-td--muted" ' +
                'style="text-align:center;padding:24px">No orders yet</td></tr>';
        }

        var avgOrder = AdminUI.money(0);
        if (metrics.orderCount > 0) {
            avgOrder = AdminUI.money((metrics.lifetimeRevenue || 0) / metrics.orderCount);
        }

        return `
            <section class="ord-drawer__section">
                <div class="admin-cell-media" style="gap:14px">
                    <div class="admin-avatar admin-avatar--lg">
                        ${esc(AdminUI.initials(c.name))}
                    </div>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:1rem;font-weight:700;color:var(--fg)">
                            ${esc(c.name || '—')}
                        </div>
                        <div class="admin-muted" style="font-size:.85rem">
                            ${esc(c.email || '')}
                        </div>
                        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                            ${c.vip ? '<span class="admin-badge admin-badge--warn">VIP</span>' : ''}
                            <span class="admin-badge admin-badge--${isActive ? 'ok' : 'bad'}">
                                ${isActive ? 'Active' : 'Inactive'}
                            </span>
                            ${c.joined
                ? '<span class="admin-badge admin-badge--info">Joined ' + AdminUI.date(c.joined) + '</span>'
                : ''}
                        </div>
                    </div>
                </div>
            </section>

            <section class="ord-drawer__section">
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
                    ${metricBox('Orders', metrics.orderCount || 0)}
                    ${metricBox('Lifetime spend', AdminUI.money(metrics.lifetimeRevenue || 0))}
                    ${metricBox('Avg. order', avgOrder)}
                </div>
            </section>

            <section class="ord-drawer__section">
                <div class="ord-drawer__label">Admin controls</div>

                <label class="cust-checkbox" style="margin-bottom:12px">
                    <input type="checkbox" id="custVipToggle" ${c.vip ? 'checked' : ''}>
                    <span>Mark as VIP</span>
                </label>

                <label class="cust-checkbox" style="margin-bottom:12px">
                    <input type="checkbox" id="custActiveToggle" ${isActive ? 'checked' : ''}>
                    <span>Active (can log in and shop)</span>
                </label>

                <div class="admin-field" style="margin-bottom:12px">
                    <label for="custNotes">Internal notes</label>
                    <textarea id="custNotes" rows="3"
                              placeholder="Anything useful to remember about this customer…">${esc(c.notes || '')}</textarea>
                </div>

                <div class="admin-field" style="margin-bottom:0">
                    <label for="custTags">Tags (comma-separated)</label>
                    <input type="text" id="custTags"
                           value="${esc((c.tags || []).join(', '))}"
                           placeholder="loyal, bulk-buyer, discount-seeker">
                </div>

                <button type="button" class="admin-btn admin-btn--primary" id="custSaveBtn"
                        style="margin-top:12px;width:100%">
                    Save changes
                </button>
            </section>

            <section class="ord-drawer__section">
                <div class="ord-drawer__label">Order history (${orders.length})</div>
                <div class="admin-table-wrap"
                     style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
                    <table class="admin-table" style="min-width:0">
                        <thead>
                            <tr>
                                <th class="admin-th">Order</th>
                                <th class="admin-th">Date</th>
                                <th class="admin-th admin-th--center">Items</th>
                                <th class="admin-th admin-th--right">Total</th>
                                <th class="admin-th admin-th--center">Status</th>
                            </tr>
                        </thead>
                        <tbody>${orderRows}</tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function metricBox(label, value) {
        return `
            <div class="account-stat">
                <div class="admin-muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em">
                    ${label}
                </div>
                <div style="font-weight:700;font-size:1.1rem;margin-top:4px">
                    ${value}
                </div>
            </div>
        `;
    }

    function wireDrawerActions(overlay, customer) {
        var saveBtn = overlay.querySelector('#custSaveBtn');
        if (!saveBtn) return;

        saveBtn.addEventListener('click', async function () {
            var vip = overlay.querySelector('#custVipToggle').checked;
            var active = overlay.querySelector('#custActiveToggle').checked;
            var notes = overlay.querySelector('#custNotes').value.trim();
            var tagsRaw = overlay.querySelector('#custTags').value;

            var tags = tagsRaw
                .split(',')
                .map(function (t) { return t.trim(); })
                .filter(function (t) { return t !== ''; })
                .slice(0, 10);

            saveBtn.disabled = true;
            var original = saveBtn.textContent;
            saveBtn.textContent = 'Saving…';

            try {
                var res = await API.request(
                    'PATCH',
                    '/api/customers/' + encodeURIComponent(customer.id),
                    { body: { vip: vip, active: active, notes: notes, tags: tags } }
                );

                if (!res || !res.ok) {
                    throw new Error((res && res.error) || 'Save failed');
                }

                // update local list
                var idx = state.customers.findIndex(function (c) {
                    return c.id === customer.id;
                });
                if (idx !== -1 && res.customer) {
                    state.customers[idx] = res.customer;
                }

                applyAndRender();
                AdminUI.toast('Customer updated', 'success');

            } catch (err) {
                AdminUI.toast(err.message || 'Could not save changes', 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = original;
            }
        });
    }

    /* =========================================================
       INJECT PAGE STYLES  (CSS unchanged)
       ========================================================= */
    (function injectStyles() {
        if (document.getElementById('custStyles')) return;

        var s = document.createElement('style');
        s.id = 'custStyles';
        s.textContent = `
            .cust-checkbox {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: .85rem;
                color: var(--fg-soft);
                cursor: pointer;
                user-select: none;
            }
            .cust-checkbox input { accent-color: var(--fg); width: 15px; height: 15px; }

            .cust-row,
            .cust-order-row { cursor: pointer; }
        `;
        document.head.appendChild(s);
    })();

})();