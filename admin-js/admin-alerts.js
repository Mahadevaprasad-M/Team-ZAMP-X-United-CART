'use strict';

(function () {

    // ---------- page state ----------
    var state = {
        alerts: null,
        tab: 'critical',          // critical | low | watch
        selected: new Set(),      // product ids chosen for bulk actions
        bulkAmount: 20
    };

    var statsHost, tabsHost, listHost, bulkBar;

    /* =========================================================
       BOOT
       ========================================================= */
    document.addEventListener('DOMContentLoaded', async function () {
        var user = await AdminAuth.require();
        if (!user) return;

        AdminUI.mount({
            activePage: 'alerts',
            title: 'Alerts',
            subtitle: 'Restock low items and clear out-of-stock',
            content: renderLayout()
        });

        statsHost = document.getElementById('alStats');
        tabsHost = document.getElementById('alTabs');
        listHost = document.getElementById('alList');
        bulkBar = document.getElementById('alBulkBar');

        wireTabs();
        wireBulkBar();
        wireRefresh();

        await loadAlerts();
        openLiveSocket();
    });

    /* =========================================================
       LAYOUT  (HTML stays the same)
       ========================================================= */
    function renderLayout() {
        return `
            <div class="admin-kpi-grid" id="alStats">
                ${AdminUI.kpiTile({ label: 'Out of stock', value: '—', hint: 'Loading…' })}
                ${AdminUI.kpiTile({ label: 'Low stock', value: '—', hint: 'Loading…' })}
                ${AdminUI.kpiTile({ label: 'Watch list', value: '—', hint: 'Loading…' })}
                ${AdminUI.kpiTile({ label: 'Value at risk', value: '—', hint: 'Loading…' })}
            </div>

            <section class="admin-card admin-mb-3">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">Inventory alerts</h3>
                        <p class="admin-card__subtitle" id="alSummaryLine">Loading…</p>
                    </div>
                    <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="alRefresh">
                        Refresh
                    </button>
                </div>

                <div class="al-tabs" id="alTabs" role="tablist">
                    <button type="button" class="al-tab al-tab--active" data-tab="critical">
                        <span class="al-tab__icon al-tab__icon--bad">●</span>
                        Out of stock
                        <span class="al-tab__count" data-count="out">0</span>
                    </button>
                    <button type="button" class="al-tab" data-tab="low">
                        <span class="al-tab__icon al-tab__icon--warn">●</span>
                        Low stock
                        <span class="al-tab__count" data-count="low">0</span>
                    </button>
                    <button type="button" class="al-tab" data-tab="watch">
                        <span class="al-tab__icon al-tab__icon--info">●</span>
                        Watch list
                        <span class="al-tab__count" data-count="watch">0</span>
                    </button>
                </div>
            </section>

            <div class="admin-card" style="display:none" id="alBulkBar">
                <div class="admin-card__body" style="padding:14px 20px">
                    <div class="admin-flex admin-flex-wrap" style="gap:12px">
                        <strong id="alBulkCount" style="font-size:.9rem">0 selected</strong>

                        <div class="al-bulk-input">
                            <label for="alBulkAmount">Add</label>
                            <input type="number" id="alBulkAmount" value="20" min="1" step="1">
                            <span>units to each</span>
                        </div>

                        <div style="flex:1"></div>

                        <button type="button" class="admin-btn admin-btn--primary admin-btn--sm" id="alBulkRestock">
                            Restock selected
                        </button>
                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="alBulkClear">
                            Clear
                        </button>
                    </div>
                </div>
            </div>

            <section class="admin-card">
                <div class="admin-card__body admin-card__body--flush" id="alList">
                    ${skeleton()}
                </div>
            </section>
        `;
    }

    function skeleton(rows) {
        if (rows === undefined) rows = 5;
        var out = '<div style="padding:16px 20px">';
        for (var i = 0; i < rows; i++) {
            out += `<div style="height:64px;border-radius:8px;margin-bottom:12px;
                        background:linear-gradient(90deg,#f1f3f5 0%,#e9ecef 50%,#f1f3f5 100%);
                        background-size:200% 100%;
                        animation:adminShimmer 1.4s ease-in-out infinite"></div>`;
        }
        return out + '</div>';
    }

    /* =========================================================
       LOAD DATA
       ========================================================= */
    async function loadAlerts(silent) {
        if (!silent && listHost) listHost.innerHTML = skeleton();

        try {
            state.alerts = await API.alerts.all();
            renderStats();
            renderTabs();
            renderList();
        } catch (err) {
            console.error('[alerts] load failed:', err);
            if (listHost) {
                listHost.innerHTML = AdminUI.emptyState({
                    icon: '⚠️',
                    title: 'Could not load alerts',
                    message: err.message || 'Please refresh the page.'
                });
            }
        }
    }

    /* =========================================================
       STATS
       ========================================================= */
    function renderStats() {
        var a = state.alerts;
        if (!a || !statsHost) return;

        var counts = a.counts || {};

        statsHost.innerHTML = [
            AdminUI.kpiTile({
                label: 'Out of stock',
                value: String(counts.out || 0),
                hint: counts.out > 0 ? 'Urgent — restock now' : 'None',
                tone: counts.out > 0 ? 'down' : 'default'
            }),
            AdminUI.kpiTile({
                label: 'Low stock',
                value: String(counts.low || 0),
                hint: counts.low > 0 ? 'Below threshold' : 'None',
                tone: counts.low > 0 ? 'warn' : 'default'
            }),
            AdminUI.kpiTile({
                label: 'Watch list',
                value: String(counts.watch || 0),
                hint: counts.watch > 0 ? 'Approaching threshold' : 'None'
            }),
            AdminUI.kpiTile({
                label: 'Value at risk',
                value: AdminUI.money(a.valueAtRisk || 0),
                hint: 'Rough restock cost'
            })
        ].join('');

        var line = document.getElementById('alSummaryLine');
        if (line) {
            var total = counts.total || 0;
            if (total === 0) {
                line.textContent = 'All clear — nothing needs attention';
            } else {
                line.textContent = total + ' item' + (total === 1 ? '' : 's') + ' need attention';
            }
        }
    }

    /* =========================================================
       TABS
       ========================================================= */
    function renderTabs() {
        if (!state.alerts) return;

        var counts = state.alerts.counts || {};

        var badges = document.querySelectorAll('[data-count]');
        for (var i = 0; i < badges.length; i++) {
            var el = badges[i];
            var n = counts[el.dataset.count] || 0;
            el.textContent = String(n);
            el.hidden = (n === 0);
        }
    }

    function wireTabs() {
        if (!tabsHost) return;

        tabsHost.addEventListener('click', function (e) {
            var btn = e.target.closest('.al-tab');
            if (!btn) return;

            var tabs = document.querySelectorAll('.al-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.toggle('al-tab--active', tabs[i] === btn);
            }

            state.tab = btn.dataset.tab;
            state.selected.clear();
            renderList();
            updateBulkBar();
        });
    }

    /* =========================================================
       LIST
       ========================================================= */
    function currentList() {
        var a = state.alerts;
        if (!a) return [];

        var lists = a.lists || {};
        if (state.tab === 'critical') return lists.out || [];
        if (state.tab === 'low') return lists.low || [];
        if (state.tab === 'watch') return lists.watch || [];
        return a.products || [];
    }

    function renderList() {
        if (!listHost) return;

        var list = currentList();

        if (list.length === 0) {
            var empty = {
                critical: { icon: '✅', title: 'Nothing out of stock', message: 'Every product has stock available.' },
                low: { icon: '👍', title: 'No low-stock items', message: 'Every product is above its threshold.' },
                watch: { icon: '👀', title: 'Nothing on the watch list', message: 'No products are approaching their threshold.' }
            };
            var chosen = empty[state.tab] || empty.critical;
            listHost.innerHTML = AdminUI.emptyState(chosen);
            return;
        }

        var allChecked = list.every(function (p) {
            return state.selected.has(p.productId);
        });

        listHost.innerHTML = `
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th class="admin-th admin-th--center" style="width:38px">
                                <input type="checkbox" id="alSelectAll"
                                       ${allChecked ? 'checked' : ''}
                                       aria-label="Select all">
                            </th>
                            <th class="admin-th">Product</th>
                            <th class="admin-th">Category</th>
                            <th class="admin-th admin-th--center">Stock / Threshold</th>
                            <th class="admin-th admin-th--center">Suggested</th>
                            <th class="admin-th admin-th--right" style="width:200px">Restock</th>
                        </tr>
                    </thead>
                    <tbody>${list.map(renderRow).join('')}</tbody>
                </table>
            </div>
        `;

        wireListEvents();
    }

    function renderRow(p) {
        var esc = AdminUI.escapeHtml;
        var stock = Number(p.stock) || 0;
        var threshold = Number(p.threshold) || 10;
        var suggested = Number(p.suggestedRestock) || Math.max(1, threshold - stock);
        var checked = state.selected.has(p.productId);

        var toneClass, statusLabel;
        if (p.status === 'out') {
            toneClass = 'bad';
            statusLabel = 'Out of stock';
        } else if (p.status === 'low') {
            toneClass = 'warn';
            statusLabel = 'Low';
        } else {
            toneClass = 'info';
            statusLabel = 'Watch';
        }

        return `
            <tr data-id="${esc(p.productId)}">
                <td class="admin-td admin-td--center">
                    <input type="checkbox" class="al-row-check"
                           data-id="${esc(p.productId)}"
                           ${checked ? 'checked' : ''}
                           aria-label="Select ${esc(p.name)}">
                </td>

                <td class="admin-td">
                    <div class="admin-cell-media">
                        <img class="admin-thumb"
                             src="${esc(p.image || '')}"
                             alt=""
                             onerror="this.style.visibility='hidden'">
                        <div class="admin-cell-media__text">
                            <div class="admin-cell-media__name">${esc(p.name)}</div>
                            <div class="admin-cell-media__meta">
                                ${esc(p.brand || '—')} · ${esc(p.productId)}
                            </div>
                        </div>
                    </div>
                </td>

                <td class="admin-td">
                    <span class="admin-muted" style="text-transform:capitalize">
                        ${esc(p.category || '—')}
                    </span>
                </td>

                <td class="admin-td admin-td--center">
                    <div style="font-weight:700;color:var(--fg)">
                        ${stock} <span class="admin-muted" style="font-weight:400">/ ${threshold}</span>
                    </div>
                    <div style="margin-top:4px">
                        <span class="admin-badge admin-badge--${toneClass}">${statusLabel}</span>
                    </div>
                </td>

                <td class="admin-td admin-td--center admin-td--muted">+${suggested}</td>

                <td class="admin-td admin-td--right">
                    <div class="al-restock">
                        <input type="number"
                               class="al-restock__input"
                               data-id="${esc(p.productId)}"
                               value="${suggested}"
                               min="1" step="1"
                               aria-label="Restock amount for ${esc(p.name)}">
                        <button type="button"
                                class="admin-btn admin-btn--primary admin-btn--sm al-restock__btn"
                                data-restock="${esc(p.productId)}">
                            Add
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function wireListEvents() {
        // ---- select-all checkbox ----
        var selectAll = document.getElementById('alSelectAll');
        if (selectAll) {
            selectAll.addEventListener('change', function () {
                var list = currentList();
                for (var i = 0; i < list.length; i++) {
                    var p = list[i];
                    if (selectAll.checked) {
                        state.selected.add(p.productId);
                    } else {
                        state.selected.delete(p.productId);
                    }
                }
                renderList();
                updateBulkBar();
            });
        }

        // ---- individual checkboxes ----
        var checkboxes = document.querySelectorAll('.al-row-check');
        for (var c = 0; c < checkboxes.length; c++) {
            (function (cb) {
                cb.addEventListener('change', function () {
                    var id = cb.dataset.id;
                    if (cb.checked) {
                        state.selected.add(id);
                    } else {
                        state.selected.delete(id);
                    }
                    updateBulkBar();
                });
            })(checkboxes[c]);
        }

        // ---- per-row restock buttons ----
        var restockBtns = document.querySelectorAll('[data-restock]');
        for (var r = 0; r < restockBtns.length; r++) {
            (function (btn) {
                btn.addEventListener('click', async function () {
                    var id = btn.dataset.restock;
                    var input = document.querySelector('.al-restock__input[data-id="' + cssEscape(id) + '"]');
                    if (!input) return;

                    var amount = parseInt(input.value, 10);
                    if (!Number.isFinite(amount) || amount < 1) {
                        AdminUI.toast('Enter a positive amount', 'error');
                        input.focus();
                        return;
                    }

                    btn.disabled = true;
                    var original = btn.textContent;
                    btn.textContent = '…';

                    try {
                        await API.alerts.restock([{ productId: id, delta: amount }]);
                        AdminUI.toast('Restocked +' + amount, 'success');
                        await loadAlerts(true);
                    } catch (err) {
                        AdminUI.toast(err.message || 'Restock failed', 'error');
                    } finally {
                        btn.disabled = false;
                        btn.textContent = original;
                    }
                });
            })(restockBtns[r]);
        }
    }

    // escape quotes for use inside attribute selectors
    function cssEscape(s) {
        return String(s).replace(/["\\]/g, '\\$&');
    }

    /* =========================================================
       BULK BAR
       ========================================================= */
    function wireBulkBar() {
        if (!bulkBar) return;

        var amountInput = document.getElementById('alBulkAmount');
        if (amountInput) {
            amountInput.addEventListener('input', function () {
                var v = parseInt(amountInput.value, 10);
                if (Number.isFinite(v) && v > 0) {
                    state.bulkAmount = v;
                }
            });
        }

        document.getElementById('alBulkClear').addEventListener('click', function () {
            state.selected.clear();
            renderList();
            updateBulkBar();
        });

        document.getElementById('alBulkRestock').addEventListener('click', bulkRestock);
    }

    function updateBulkBar() {
        if (!bulkBar) return;

        var count = state.selected.size;
        bulkBar.style.display = (count === 0) ? 'none' : 'block';

        if (count > 0) {
            document.getElementById('alBulkCount').textContent = count + ' selected';
        }
    }

    async function bulkRestock() {
        var ids = Array.from(state.selected);
        if (ids.length === 0) return;

        var amount = state.bulkAmount || 20;

        var ok = await AdminUI.confirm({
            title: 'Restock ' + ids.length + ' product' + (ids.length === 1 ? '' : 's') + '?',
            message: 'Add ' + amount + ' units to each selected product.',
            okLabel: 'Restock all'
        });
        if (!ok) return;

        AdminUI.showLoader('Restocking…');

        try {
            var updates = ids.map(function (productId) {
                return { productId: productId, delta: amount };
            });
            var res = await API.alerts.restock(updates);

            var applied = (res && res.applied) || [];
            AdminUI.toast(applied.length + ' product' + (applied.length === 1 ? '' : 's') + ' restocked', 'success');

            state.selected.clear();
            await loadAlerts(true);
            updateBulkBar();
        } catch (err) {
            AdminUI.toast(err.message || 'Bulk restock failed', 'error');
        } finally {
            AdminUI.hideLoader();
        }
    }

    /* =========================================================
       REFRESH
       ========================================================= */
    function wireRefresh() {
        var btn = document.getElementById('alRefresh');
        if (!btn) return;

        btn.addEventListener('click', async function () {
            btn.disabled = true;
            var original = btn.textContent;
            btn.textContent = 'Refreshing…';

            await loadAlerts(false);

            btn.disabled = false;
            btn.textContent = original;
            AdminUI.toast('Refreshed', 'success');
        });
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

        // reload alerts when stock events arrive (debounced)
        var timer = null;
        socket.on('activity:new', function (entry) {
            if (!entry || !entry.type) return;
            if (entry.type.indexOf('stock:') !== 0) return;

            clearTimeout(timer);
            timer = setTimeout(function () { loadAlerts(true); }, 500);
        });
    }

    /* =========================================================
       INJECT PAGE STYLES  (CSS unchanged)
       ========================================================= */
    (function injectStyles() {
        if (document.getElementById('alStyles')) return;

        var s = document.createElement('style');
        s.id = 'alStyles';
        s.textContent = `
            /* Tabs */
            .al-tabs {
                display: flex;
                gap: 4px;
                padding: 0 20px;
                border-bottom: 1px solid var(--border);
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
            }
            .al-tab {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 14px 16px;
                font-size: .85rem;
                font-weight: 500;
                color: var(--muted);
                white-space: nowrap;
                border-bottom: 2px solid transparent;
                transition: color .18s var(--ease), border-color .18s var(--ease);
            }
            .al-tab:hover        { color: var(--fg); }
            .al-tab--active      { color: var(--fg); border-bottom-color: var(--fg); }
            .al-tab__icon        { font-size: .6rem; line-height: 1; }
            .al-tab__icon--bad   { color: var(--danger); }
            .al-tab__icon--warn  { color: var(--warning); }
            .al-tab__icon--info  { color: var(--info); }
            .al-tab__count {
                background: var(--bg);
                color: var(--muted);
                font-size: .7rem;
                font-weight: 700;
                padding: 1px 6px;
                border-radius: 999px;
                min-width: 20px;
                text-align: center;
                line-height: 1.5;
            }
            .al-tab--active .al-tab__count {
                background: var(--fg);
                color: #fff;
            }

            /* Inline restock */
            .al-restock {
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .al-restock__input {
                width: 72px;
                padding: 6px 10px;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-sm);
                background: #fff;
                font-size: .82rem;
                text-align: center;
                outline: none;
            }
            .al-restock__input:focus {
                border-color: var(--fg);
                box-shadow: 0 0 0 3px rgba(15,17,21,.06);
            }
            .al-restock__btn { padding: 5px 12px; font-size: .78rem; }

            /* Bulk bar */
            .al-bulk-input {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: .82rem;
                color: var(--muted);
            }
            .al-bulk-input input {
                width: 70px;
                padding: 5px 8px;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-sm);
                background: #fff;
                font-size: .82rem;
                text-align: center;
                outline: none;
            }
            .al-bulk-input input:focus { border-color: var(--fg); }

            /* Mobile */
            @media (max-width: 640px) {
                .al-tabs { padding: 0 12px; }
                .al-tab  { padding: 12px 12px; font-size: .8rem; }
            }
        `;
        document.head.appendChild(s);
    })();

})();