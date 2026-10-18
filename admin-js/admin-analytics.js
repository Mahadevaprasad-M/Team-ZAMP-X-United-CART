'use strict';

(function () {

    // ---------- page state ----------
    var state = {
        range: '7d',
        charts: {},      // canvasId -> Chart instance
        data: {}
    };

    var RANGES = [
        { key: '1d', label: 'Today' },
        { key: '7d', label: '7 days' },
        { key: '30d', label: '30 days' },
        { key: '90d', label: '90 days' },
        { key: '1y', label: '1 year' }
    ];

    // chart colors (match admin theme)
    var COLOR = {
        fg: '#0a0a0a',
        muted: '#6b7280',
        grid: '#e5e7eb',
        accent: '#dc2626',
        success: '#16a34a',
        info: '#2563eb',
        warning: '#d97706',
        palette: ['#0a0a0a', '#dc2626', '#2563eb', '#16a34a',
            '#d97706', '#7c3aed', '#0891b2', '#db2777']
    };

    /* =========================================================
       BOOT
       ========================================================= */
    document.addEventListener('DOMContentLoaded', async function () {
        var user = await AdminAuth.require();
        if (!user) return;

        AdminUI.mount({
            activePage: 'analytics',
            title: 'Analytics',
            subtitle: 'Sales, products and customer insights',
            content: renderLayout()
        });

        wireRangePicker();
        wireRefresh();

        await loadAll();
        openLiveSocket();
    });

    // load every section in parallel
    async function loadAll() {
        await Promise.all([
            loadSummary(),
            loadSales(),
            loadTopProducts(),
            loadByCategory(),
            loadCustomerStats(),
            loadOrderStatus()
        ]);
    }

    /* =========================================================
       LAYOUT  (HTML stays the same)
       ========================================================= */
    function renderLayout() {
        var rangeButtons = RANGES.map(function (r) {
            return `
                <button type="button"
                        class="an-range ${r.key === '7d' ? 'an-range--active' : ''}"
                        data-range="${r.key}">
                    ${r.label}
                </button>
            `;
        }).join('');

        return `
            <div class="admin-kpi-grid" id="anKpis">
                ${kpi('Revenue today', '—', 'Loading…')}
                ${kpi('Revenue this week', '—', 'Loading…')}
                ${kpi('Revenue this month', '—', 'Loading…')}
                ${kpi('Inventory value', '—', 'Loading…')}
            </div>

            <section class="admin-card admin-mb-3">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">Revenue over time</h3>
                        <p class="admin-card__subtitle">Daily revenue, orders and profit</p>
                    </div>
                    <div class="admin-flex admin-flex-wrap" style="gap:8px">
                        <div class="an-range-group" id="anRangeGroup">${rangeButtons}</div>
                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="anRefresh">
                            Refresh
                        </button>
                    </div>
                </div>
                <div class="admin-card__body">
                    <div class="an-chart-wrap" style="height:320px">
                        <canvas id="anSalesChart"></canvas>
                    </div>
                    <div class="an-chart-legend">
                        ${legendItem(COLOR.accent, 'Revenue', 'anSalesRevenue')}
                        ${legendItem(COLOR.success, 'Profit', 'anSalesProfit')}
                        ${legendItem(COLOR.info, 'Orders', 'anSalesOrders')}
                    </div>
                </div>
            </section>

            <div class="admin-row admin-row--2 admin-mb-3">
                <section class="admin-card">
                    <div class="admin-card__head">
                        <div>
                            <h3 class="admin-card__title">Top products</h3>
                            <p class="admin-card__subtitle">Best sellers by revenue</p>
                        </div>
                        <select id="anTopBy" class="an-topselect">
                            <option value="revenue">By revenue</option>
                            <option value="qty">By quantity</option>
                        </select>
                    </div>
                    <div class="admin-card__body">
                        <div class="an-chart-wrap" style="height:340px">
                            <canvas id="anTopChart"></canvas>
                        </div>
                    </div>
                </section>

                <section class="admin-card">
                    <div class="admin-card__head">
                        <div>
                            <h3 class="admin-card__title">Revenue by category</h3>
                            <p class="admin-card__subtitle">Split across categories</p>
                        </div>
                    </div>
                    <div class="admin-card__body">
                        <div class="an-chart-wrap" style="height:340px">
                            <canvas id="anCategoryChart"></canvas>
                        </div>
                    </div>
                </section>
            </div>

            <div class="admin-row admin-row--2">
                <section class="admin-card">
                    <div class="admin-card__head">
                        <div>
                            <h3 class="admin-card__title">Customer insights</h3>
                            <p class="admin-card__subtitle">New vs returning</p>
                        </div>
                    </div>
                    <div class="admin-card__body" id="anCustomerStats">
                        <div class="an-loading">Loading…</div>
                    </div>
                </section>

                <section class="admin-card">
                    <div class="admin-card__head">
                        <div>
                            <h3 class="admin-card__title">Order status</h3>
                            <p class="admin-card__subtitle">Lifetime breakdown</p>
                        </div>
                    </div>
                    <div class="admin-card__body" id="anOrderStatus">
                        <div class="an-loading">Loading…</div>
                    </div>
                </section>
            </div>
        `;
    }

    function kpi(label, value, hint) {
        return AdminUI.kpiTile({ label: label, value: value, hint: hint });
    }

    function legendItem(color, label, valueId) {
        return `
            <div class="an-legend-item">
                <span class="an-dot" style="background:${color}"></span>
                <span>${label}</span>
                <strong id="${valueId}">—</strong>
            </div>
        `;
    }

    /* =========================================================
       WIRING
       ========================================================= */
    function wireRangePicker() {
        var group = document.getElementById('anRangeGroup');
        if (!group) return;

        group.addEventListener('click', function (e) {
            var btn = e.target.closest('.an-range');
            if (!btn) return;

            var allBtns = document.querySelectorAll('.an-range');
            for (var i = 0; i < allBtns.length; i++) {
                allBtns[i].classList.toggle('an-range--active', allBtns[i] === btn);
            }

            state.range = btn.dataset.range;
            loadSales();
        });
    }

    function wireRefresh() {
        var btn = document.getElementById('anRefresh');
        if (!btn) return;

        btn.addEventListener('click', async function () {
            btn.disabled = true;
            btn.textContent = 'Refreshing…';

            await loadAll();

            btn.disabled = false;
            btn.textContent = 'Refresh';
            AdminUI.toast('Refreshed', 'success');
        });
    }

    /* =========================================================
       SUMMARY (KPI tiles)
       ========================================================= */
    async function loadSummary() {
        var host = document.getElementById('anKpis');
        if (!host) return;

        try {
            var res = await API.analytics.summary();
            var s = res.summary || res;
            state.data.summary = s;

            var today = s.today || {};
            var week = s.week || {};
            var month = s.month || {};
            var totals = s.totals || {};

            var todayHint;
            if (today.revenueChange != null) {
                var arrow = today.revenueChange >= 0 ? '▲ ' : '▼ ';
                todayHint = arrow + Math.abs(today.revenueChange).toFixed(1) + '% vs yesterday';
            } else {
                todayHint = 'Today so far';
            }

            host.innerHTML = [
                kpi('Revenue today',
                    AdminUI.money(today.revenue || 0),
                    todayHint),

                kpi('Revenue this week',
                    AdminUI.money(week.revenue || 0),
                    (week.orders || 0) + ' orders'),

                kpi('Revenue this month',
                    AdminUI.money(month.revenue || 0),
                    (month.orders || 0) + ' orders'),

                kpi('Inventory value',
                    AdminUI.money(totals.inventoryValue || 0),
                    totals.products + ' products · ' + (totals.lowStock || 0) + ' low')
            ].join('');

        } catch (err) {
            console.error('[analytics] summary:', err);
            host.innerHTML = [
                kpi('Revenue today', '—', 'Unavailable'),
                kpi('Revenue this week', '—', 'Unavailable'),
                kpi('Revenue this month', '—', 'Unavailable'),
                kpi('Inventory value', '—', 'Unavailable')
            ].join('');
        }
    }

    /* =========================================================
       SALES LINE CHART
       ========================================================= */
    async function loadSales() {
        try {
            var res = await API.analytics.sales(state.range);
            state.data.sales = res;

            var series = res.series || [];
            var labels = series.map(formatRangeLabel);
            var revenue = series.map(function (s) { return s.revenue; });
            var profit = series.map(function (s) { return s.profit; });
            var orders = series.map(function (s) { return s.orders; });

            // update legend totals
            var t = res.totals || {};
            setText('anSalesRevenue', AdminUI.money(t.revenue || 0));
            setText('anSalesProfit', AdminUI.money(t.profit || 0));
            setText('anSalesOrders', String(t.orders || 0));

            drawLineChart('anSalesChart', labels, revenue, profit, orders);

        } catch (err) {
            console.error('[analytics] sales:', err);
        }
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function formatRangeLabel(s) {
        if (!s) return '';

        // single day: "12 Oct"
        if (s.date === s.from && s.date === s.to) {
            var d = new Date(s.date + 'T00:00:00');
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        }

        // range: "5–11 Oct"
        var fromD = new Date(s.from + 'T00:00:00');
        var toD = new Date(s.to + 'T00:00:00');
        return fromD.getDate() + '–' +
            toD.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }

    function drawLineChart(canvasId, labels, revenue, profit, orders) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart(canvasId);

        var ctx = canvas.getContext('2d');

        // gradient fill under the revenue line
        var gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(220, 38, 38, .18)');
        gradient.addColorStop(1, 'rgba(220, 38, 38, 0)');

        state.charts[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Revenue',
                        data: revenue,
                        borderColor: COLOR.accent,
                        backgroundColor: gradient,
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: COLOR.accent,
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Profit',
                        data: profit,
                        borderColor: COLOR.success,
                        borderWidth: 2,
                        borderDash: [5, 4],
                        fill: false,
                        tension: 0.35,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        pointBackgroundColor: COLOR.success,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Orders',
                        data: orders,
                        borderColor: COLOR.info,
                        borderWidth: 1.8,
                        fill: false,
                        tension: 0.35,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        pointBackgroundColor: COLOR.info,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: tooltipConfig(function (ctx) {
                        var label = ctx.dataset.label || '';
                        var v = ctx.parsed.y;
                        return ' ' + label + ': ' +
                            (label === 'Orders' ? v : AdminUI.money(v));
                    })
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: COLOR.muted, font: { size: 11, family: 'Inter' } }
                    },
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        grid: { color: COLOR.grid },
                        border: { display: false },
                        ticks: {
                            color: COLOR.muted,
                            font: { size: 11, family: 'Inter' },
                            callback: compactMoney
                        }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        grid: { display: false },
                        border: { display: false },
                        ticks: { color: COLOR.muted, font: { size: 11, family: 'Inter' } }
                    }
                }
            }
        });
    }

    // shared tooltip style
    function tooltipConfig(labelFn) {
        return {
            backgroundColor: '#0a0a0a',
            padding: 12,
            titleFont: { family: 'Inter', weight: '600', size: 12 },
            bodyFont: { family: 'Inter', size: 12 },
            callbacks: { label: labelFn }
        };
    }

    function compactMoney(v) {
        var n = Number(v) || 0;
        if (Math.abs(n) >= 10000000) return '₹' + (n / 10000000).toFixed(1) + 'Cr';
        if (Math.abs(n) >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
        if (Math.abs(n) >= 1000) return '₹' + (n / 1000).toFixed(0) + 'k';
        return '₹' + n;
    }

    function destroyChart(id) {
        if (state.charts[id]) {
            state.charts[id].destroy();
            delete state.charts[id];
        }
    }

    /* =========================================================
       TOP PRODUCTS BAR CHART
       ========================================================= */
    async function loadTopProducts() {
        var select = document.getElementById('anTopBy');
        var by = select ? select.value : 'revenue';

        // bind the dropdown once
        if (select && !select.dataset.bound) {
            select.dataset.bound = '1';
            select.addEventListener('change', loadTopProducts);
        }

        try {
            var res = await API.analytics.topProducts(8);
            state.data.topProducts = res;

            var list = (res.products || []).slice();
            list.sort(function (a, b) {
                if (by === 'qty') {
                    return b.qty - a.qty;
                }
                return b.revenue - a.revenue;
            });

            var labels = list.map(function (p) { return shorten(p.name, 24); });
            var values = list.map(function (p) { return by === 'qty' ? p.qty : p.revenue; });

            drawBarChart('anTopChart', labels, values, by);

        } catch (err) {
            console.error('[analytics] top-products:', err);
        }
    }

    function shorten(s, n) {
        s = String(s || '');
        if (s.length > n) {
            return s.slice(0, n - 1) + '…';
        }
        return s;
    }

    function drawBarChart(canvasId, labels, values, mode) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart(canvasId);

        var ctx = canvas.getContext('2d');

        state.charts[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: mode === 'qty' ? 'Units sold' : 'Revenue',
                    data: values,
                    backgroundColor: COLOR.palette.slice(0, labels.length),
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 32
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: tooltipConfig(function (ctx) {
                        var v = ctx.parsed.x;
                        if (mode === 'qty') {
                            return ' ' + v + ' units';
                        }
                        return ' ' + AdminUI.money(v);
                    })
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: COLOR.grid },
                        border: { display: false },
                        ticks: {
                            color: COLOR.muted,
                            font: { size: 11, family: 'Inter' },
                            callback: function (v) {
                                return mode === 'qty' ? v : compactMoney(v);
                            }
                        }
                    },
                    y: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { color: COLOR.fg, font: { size: 12, family: 'Inter' } }
                    }
                }
            }
        });
    }

    /* =========================================================
       CATEGORY DOUGHNUT
       ========================================================= */
    async function loadByCategory() {
        try {
            var res = await API.analytics.byCategory();
            state.data.byCategory = res;

            var cats = (res.categories || []).filter(function (c) {
                return c.revenue > 0;
            });

            if (cats.length === 0) {
                showCategoryEmpty();
                return;
            }

            drawDoughnut(
                'anCategoryChart',
                cats.map(function (c) { return c.name; }),
                cats.map(function (c) { return c.revenue; })
            );

        } catch (err) {
            console.error('[analytics] by-category:', err);
        }
    }

    function showCategoryEmpty() {
        var canvas = document.getElementById('anCategoryChart');
        if (!canvas) return;
        var wrap = canvas.closest('.an-chart-wrap');
        if (!wrap) return;

        wrap.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;
                        height:100%;color:var(--muted);font-size:.9rem;
                        text-align:center;padding:0 20px">
                No revenue yet — place an order to see this chart.
            </div>
        `;
    }

    function drawDoughnut(canvasId, labels, values) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;

        destroyChart(canvasId);

        var ctx = canvas.getContext('2d');
        var total = values.reduce(function (s, v) { return s + v; }, 0);

        state.charts[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: COLOR.palette.slice(0, labels.length),
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: COLOR.fg,
                            font: { family: 'Inter', size: 12 },
                            padding: 12,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            generateLabels: function (chart) {
                                var data = chart.data;
                                return data.labels.map(function (label, i) {
                                    var value = data.datasets[0].data[i];
                                    var pct = total > 0
                                        ? ((value / total) * 100).toFixed(0)
                                        : 0;
                                    return {
                                        text: label + ' (' + pct + '%)',
                                        fillStyle: data.datasets[0].backgroundColor[i],
                                        strokeStyle: 'transparent',
                                        lineWidth: 0,
                                        pointStyle: 'circle'
                                    };
                                });
                            }
                        }
                    },
                    tooltip: tooltipConfig(function (ctx) {
                        return ' ' + AdminUI.money(ctx.parsed);
                    })
                }
            }
        });
    }

    /* =========================================================
       CUSTOMER STATS
       ========================================================= */
    async function loadCustomerStats() {
        var host = document.getElementById('anCustomerStats');
        if (!host) return;

        try {
            var res = await API.analytics.customerStats();
            var s = res.stats || {};
            state.data.customerStats = s;

            host.innerHTML = `
                <div class="an-stat-grid">
                    ${stat('Total customers', s.totalCustomers || 0)}
                    ${stat('Active this month', s.activeThisMonth || 0, 'Placed an order')}
                    ${stat('New this month', s.newThisMonth || 0, 'First order')}
                    ${stat('Returning', s.returning || 0, '2+ orders')}
                </div>

                ${barStack('One-time buyers', s.oneTime || 0, pct(s.oneTime, s.withOrders), COLOR.warning)}
                ${barStack('Returning buyers', s.returning || 0, pct(s.returning, s.withOrders), COLOR.success)}
            `;

        } catch (err) {
            console.error('[analytics] customer-stats:', err);
            host.innerHTML = '<div class="an-empty">Could not load customer stats</div>';
        }
    }

    function stat(label, value, hint) {
        if (hint === undefined) hint = '';
        return `
            <div class="an-stat">
                <div class="an-stat__label">${label}</div>
                <div class="an-stat__value">${value}</div>
                ${hint ? `<div class="an-stat__hint">${hint}</div>` : ''}
            </div>
        `;
    }

    function barStack(label, count, percent, color) {
        return `
            <div class="an-bar-stack">
                <div class="an-bar-stack__row">
                    <span>${label}</span>
                    <strong>${count}</strong>
                </div>
                <div class="an-bar-stack__track">
                    <div class="an-bar-stack__fill"
                         style="width:${percent}%;background:${color}"></div>
                </div>
            </div>
        `;
    }

    function pct(n, total) {
        if (!total) return 0;
        return Math.min(100, Math.round((n / total) * 100));
    }

    /* =========================================================
       ORDER STATUS FUNNEL
       ========================================================= */
    async function loadOrderStatus() {
        var host = document.getElementById('anOrderStatus');
        if (!host) return;

        try {
            var res = await API.orders.list({ limit: 500 });
            var orders = res.orders || [];

            var counts = { Processing: 0, Shipped: 0, Delivered: 0, Cancelled: 0 };
            var total = 0;

            for (var i = 0; i < orders.length; i++) {
                var st = orders[i].status || 'Processing';
                if (counts[st] !== undefined) counts[st]++;
                total++;
            }

            var items = [
                { label: 'Processing', color: COLOR.info },
                { label: 'Shipped', color: COLOR.warning },
                { label: 'Delivered', color: COLOR.success },
                { label: 'Cancelled', color: COLOR.accent }
            ];

            var html = items.map(function (it) {
                var n = counts[it.label];
                var p = total > 0 ? Math.round((n / total) * 100) : 0;
                return `
                    <div class="an-bar-stack">
                        <div class="an-bar-stack__row">
                            <span>${it.label}</span>
                            <strong>${n} <span class="admin-muted">(${p}%)</span></strong>
                        </div>
                        <div class="an-bar-stack__track">
                            <div class="an-bar-stack__fill"
                                 style="width:${p}%;background:${it.color}"></div>
                        </div>
                    </div>
                `;
            }).join('');

            html += `
                <div style="margin-top:12px;font-size:.85rem;color:var(--muted);text-align:center">
                    ${total} total order${total === 1 ? '' : 's'}
                </div>
            `;

            host.innerHTML = html;

        } catch (err) {
            console.error('[analytics] order-status:', err);
            host.innerHTML = '<div class="an-empty">Could not load order status</div>';
        }
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

        // debounced refresh on new order events
        var timer = null;
        socket.on('activity:new', function (entry) {
            if (!entry || !entry.type) return;
            if (entry.type.indexOf('order:') !== 0) return;

            clearTimeout(timer);
            timer = setTimeout(function () {
                loadSummary();
                loadSales();
                loadTopProducts();
                loadByCategory();
            }, 800);
        });
    }

    /* =========================================================
       INJECT PAGE STYLES  (CSS unchanged)
       ========================================================= */
    (function injectStyles() {
        if (document.getElementById('anStyles')) return;

        var s = document.createElement('style');
        s.id = 'anStyles';
        s.textContent = `
            .an-chart-wrap {
                position: relative;
                width: 100%;
            }

            .an-chart-legend {
                display: flex;
                gap: 24px;
                justify-content: center;
                flex-wrap: wrap;
                margin-top: 18px;
                padding-top: 18px;
                border-top: 1px solid var(--border);
            }
            .an-legend-item {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: .84rem;
                color: var(--muted);
            }
            .an-legend-item strong {
                color: var(--fg);
                font-weight: 700;
            }
            .an-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            /* Range picker */
            .an-range-group {
                display: inline-flex;
                background: var(--bg);
                border-radius: 999px;
                padding: 3px;
                gap: 2px;
            }
            .an-range {
                padding: 6px 14px;
                font-size: .78rem;
                font-weight: 600;
                border-radius: 999px;
                color: var(--muted);
                transition: background .18s var(--ease), color .18s var(--ease);
                white-space: nowrap;
            }
            .an-range:hover        { color: var(--fg); }
            .an-range--active      { background: #fff; color: var(--fg);
                                     box-shadow: 0 1px 3px rgba(15,17,21,.08); }

            .an-topselect {
                padding: 6px 12px;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-sm);
                background: #fff;
                font-size: .82rem;
                outline: none;
                cursor: pointer;
            }
            .an-topselect:focus { border-color: var(--fg); }

            .an-loading,
            .an-empty {
                padding: 40px;
                text-align: center;
                color: var(--muted);
                font-size: .9rem;
            }

            /* Customer stats grid */
            .an-stat-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
                margin-bottom: 20px;
            }
            .an-stat {
                background: var(--bg);
                border-radius: var(--radius-sm);
                padding: 14px 16px;
            }
            .an-stat__label {
                font-size: .7rem;
                font-weight: 700;
                letter-spacing: .1em;
                text-transform: uppercase;
                color: var(--muted);
            }
            .an-stat__value {
                font-family: 'Poppins', sans-serif;
                font-size: 1.4rem;
                font-weight: 700;
                letter-spacing: -.02em;
                margin-top: 4px;
                line-height: 1.15;
            }
            .an-stat__hint {
                font-size: .72rem;
                color: var(--muted);
                margin-top: 2px;
            }

            /* Bar stacks */
            .an-bar-stack              { margin-bottom: 14px; }
            .an-bar-stack:last-child   { margin-bottom: 0; }
            .an-bar-stack__row {
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                font-size: .85rem;
                margin-bottom: 6px;
                gap: 8px;
            }
            .an-bar-stack__row strong  { font-weight: 600; color: var(--fg); }
            .an-bar-stack__track {
                height: 6px;
                background: var(--bg);
                border-radius: 999px;
                overflow: hidden;
            }
            .an-bar-stack__fill {
                height: 100%;
                border-radius: inherit;
                transition: width .35s var(--ease);
                min-width: 2px;
            }

            @media (max-width: 640px) {
                .an-chart-legend  { gap: 12px; }
                .an-stat-grid     { grid-template-columns: 1fr 1fr; }
                .an-range-group   { overflow-x: auto; max-width: 100%; }
            }
        `;
        document.head.appendChild(s);
    })();

})();