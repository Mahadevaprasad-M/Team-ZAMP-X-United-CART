'use strict';

const express = require('express');

const store = require('../lib/store');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const ORDERS_FILE = 'orders.json';
const PRODUCTS_FILE = 'products.json';
const CATEGORIES_FILE = 'categories.json';
const CUSTOMERS_FILE = 'customers.json';
const SETTINGS_FILE = 'settings.json';


/* ============ HELPER: read data safely ============ */
function readList(file) {
    const raw = store.read(file);
    return Array.isArray(raw) ? raw : [];
}

// All orders that count towards revenue (skip Cancelled)
function validOrders() {
    return readList(ORDERS_FILE).filter(o => o && o.status !== 'Cancelled');
}


/* ============ HELPER: dates & money ============ */

// Round money to 2 decimal places
function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

// Start of the day N days ago (local server time)
function daysAgoStart(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
}

// Start of the current month (local server time)
function monthStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
}

// Date → "YYYY-MM-DD" string
function ymd(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}


/* ============ HELPER: range parsing ============ */

// Turn ?range=7d into { days, bucketSize, label }
function parseRange(raw) {
    const RANGES = {
        '1d': { days: 1, bucketSize: 1 },
        '7d': { days: 7, bucketSize: 1 },
        '30d': { days: 30, bucketSize: 1 },
        '90d': { days: 90, bucketSize: 7 },
        '1y': { days: 365, bucketSize: 30 }
    };

    const key = String(raw || '7d').toLowerCase();
    const r = RANGES[key] || RANGES['7d'];

    return { ...r, label: RANGES[key] ? key : '7d' };
}


/* ============ HELPER: time buckets ============ */

// Build empty buckets, oldest first.
// Each bucket covers `bucketSize` days (1 = daily, 7 = weekly, 30 = monthly).
function emptyBuckets(days, bucketSize = 1) {
    const buckets = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bucketCount = Math.ceil(days / bucketSize);

    for (let i = bucketCount - 1; i >= 0; i--) {
        const end = new Date(today);
        end.setDate(end.getDate() - i * bucketSize);

        const start = new Date(end);
        start.setDate(start.getDate() - (bucketSize - 1));

        buckets.push({
            date: ymd(end),
            from: ymd(start),
            to: ymd(end),
            revenue: 0,
            cost: 0,
            profit: 0,
            orders: 0,
            qty: 0
        });
    }

    return buckets;
}

// Add one order's numbers into the bucket it belongs to
function foldOrderIntoBuckets(order, buckets) {
    const t = new Date(order.date);
    if (isNaN(t.getTime())) return;

    const key = ymd(t);

    for (const b of buckets) {
        // Skip buckets that don't cover this date
        if (key < b.from || key > b.to) continue;

        let orderRevenue = 0;
        let orderCost = 0;
        let orderQty = 0;

        for (const item of order.items || []) {
            const price = Number(item.price) || 0;
            const qty = Number(item.qty) || 0;
            const cost = Number.isFinite(+item.cost) ? +item.cost : null;

            orderRevenue += price * qty;
            orderQty += qty;
            if (cost !== null) orderCost += cost * qty;
        }

        b.revenue += orderRevenue;
        b.cost += orderCost;
        b.profit = b.revenue - b.cost;
        b.orders += 1;
        b.qty += orderQty;
        return;
    }
}


/* =========================================================
   GET /api/analytics/summary
   One call — today / week / month + inventory health.
   ========================================================= */
router.get('/summary', auth.requireAdmin, (_req, res) => {
    try {
        const orders = validOrders();
        const products = readList(PRODUCTS_FILE);
        const cats = readList(CATEGORIES_FILE);
        const customers = readList(CUSTOMERS_FILE);

        /* ---- Today vs yesterday ---- */
        const todayStart = daysAgoStart(0).getTime();
        const yStart = daysAgoStart(1).getTime();

        let todayRevenue = 0, todayOrders = 0, todayPending = 0;
        let yRevenue = 0, yOrders = 0;

        for (const o of orders) {
            const t = new Date(o.date).getTime();
            const total = Number(o.total) || 0;

            if (t >= todayStart) {
                todayRevenue += total;
                todayOrders++;
                if (o.status === 'Processing') todayPending++;
            } else if (t >= yStart) {
                yRevenue += total;
                yOrders++;
            }
        }

        // % change vs yesterday (0% if no yesterday data and no sales)
        const revenueChange = yRevenue > 0
            ? round2(((todayRevenue - yRevenue) / yRevenue) * 100)
            : (todayRevenue > 0 ? 100 : 0);

        /* ---- Week + month ---- */
        const weekStartMs = daysAgoStart(6).getTime();
        const monthStartMs = monthStart().getTime();

        let weekRevenue = 0, weekOrders = 0;
        let monthRevenue = 0, monthOrders = 0;

        for (const o of orders) {
            const t = new Date(o.date).getTime();
            const total = Number(o.total) || 0;

            if (t >= weekStartMs) { weekRevenue += total; weekOrders++; }
            if (t >= monthStartMs) { monthRevenue += total; monthOrders++; }
        }

        /* ---- Inventory health ---- */
        const settings = store.read(SETTINGS_FILE) || {};
        const defaultThreshold = Number.isFinite(+settings.defaultLowStockThreshold)
            ? +settings.defaultLowStockThreshold
            : 10;

        let lowStock = 0;
        let outOfStock = 0;
        let inventoryValue = 0;

        for (const p of products) {
            const stock = Number(p.stock) || 0;
            const threshold = Number.isFinite(+p.lowStockThreshold)
                ? +p.lowStockThreshold
                : defaultThreshold;

            if (stock === 0) outOfStock++;
            else if (stock <= threshold) lowStock++;

            if (Number.isFinite(+p.cost)) {
                inventoryValue += (+p.cost) * stock;
            }
        }

        res.json({
            ok: true,
            summary: {
                today: {
                    revenue: round2(todayRevenue),
                    revenueChange,
                    orders: todayOrders,
                    pending: todayPending,
                    previousRevenue: round2(yRevenue),
                    previousOrders: yOrders
                },
                week: {
                    revenue: round2(weekRevenue),
                    orders: weekOrders
                },
                month: {
                    revenue: round2(monthRevenue),
                    orders: monthOrders
                },
                totals: {
                    products: products.length,
                    categories: cats.length,
                    customers: customers.length,
                    lowStock,
                    outOfStock,
                    inventoryValue: round2(inventoryValue)
                }
            }
        });

    } catch (err) {
        console.error('[analytics/summary]', err);
        res.status(500).json({ ok: false, error: 'Failed to load summary' });
    }
});


/* =========================================================
   GET /api/analytics/sales?range=7d|30d|90d|1y
   Time-series revenue / profit / orders / qty.
   ========================================================= */
router.get('/sales', auth.requireAdmin, (req, res) => {
    try {
        const range = parseRange(req.query.range);
        const orders = validOrders();

        const buckets = emptyBuckets(range.days, range.bucketSize);
        const rangeStart = buckets.length ? buckets[0].from : ymd(new Date());

        for (const o of orders) {
            if (ymd(o.date) < rangeStart) continue;
            foldOrderIntoBuckets(o, buckets);
        }

        const series = buckets.map(b => ({
            date: b.date,
            from: b.from,
            to: b.to,
            revenue: round2(b.revenue),
            cost: round2(b.cost),
            profit: round2(b.profit),
            orders: b.orders,
            qty: b.qty
        }));

        const totals = series.reduce((acc, s) => {
            acc.revenue += s.revenue;
            acc.profit += s.profit;
            acc.orders += s.orders;
            acc.qty += s.qty;
            return acc;
        }, { revenue: 0, profit: 0, orders: 0, qty: 0 });

        Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });

        res.json({
            ok: true,
            range: range.label,
            days: range.days,
            series,
            totals
        });

    } catch (err) {
        console.error('[analytics/sales]', err);
        res.status(500).json({ ok: false, error: 'Failed to load sales data' });
    }
});


/* =========================================================
   GET /api/analytics/top-products?limit=10&by=revenue|qty
   Best-selling products by revenue or quantity.
   ========================================================= */
router.get('/top-products', auth.requireAdmin, (req, res) => {
    try {
        let limit = parseInt(req.query.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 10;
        if (limit > 100) limit = 100;

        const by = req.query.by === 'qty' ? 'qty' : 'revenue';

        const orders = validOrders();
        const agg = new Map();   // productId → totals

        for (const o of orders) {
            for (const item of o.items || []) {
                const id = item.productId || item.id;
                if (!id) continue;

                if (!agg.has(id)) {
                    agg.set(id, {
                        productId: id,
                        name: item.name || '—',
                        brand: item.brand || '',
                        image: item.image || '',
                        qty: 0,
                        revenue: 0,
                        cost: 0,
                        orders: 0
                    });
                }

                const a = agg.get(id);
                const qty = Number(item.qty) || 0;
                const price = Number(item.price) || 0;
                const cost = Number.isFinite(+item.cost) ? +item.cost : null;

                a.qty += qty;
                a.revenue += price * qty;
                a.orders += 1;
                if (cost !== null) a.cost += cost * qty;

                // Prefer newer name/image if the order carried one
                if (item.name) a.name = item.name;
                if (item.image) a.image = item.image;
            }
        }

        const list = Array.from(agg.values()).map(a => ({
            productId: a.productId,
            name: a.name,
            brand: a.brand,
            image: a.image,
            qty: a.qty,
            orders: a.orders,
            revenue: round2(a.revenue),
            cost: round2(a.cost),
            profit: round2(a.revenue - a.cost)
        }));

        // Sort by chosen column, biggest first
        list.sort((a, b) => by === 'qty'
            ? b.qty - a.qty
            : b.revenue - a.revenue
        );

        res.json({
            ok: true,
            by,
            products: list.slice(0, limit)
        });

    } catch (err) {
        console.error('[analytics/top-products]', err);
        res.status(500).json({ ok: false, error: 'Failed to load top products' });
    }
});


/* =========================================================
   GET /api/analytics/by-category
   Revenue split per category + an "uncategorized" bucket.
   ========================================================= */
router.get('/by-category', auth.requireAdmin, (_req, res) => {
    try {
        const orders = validOrders();
        const cats = readList(CATEGORIES_FILE);
        const products = readList(PRODUCTS_FILE);

        // Lookup: productId → categoryId
        const productCategory = new Map();
        for (const p of products) {
            if (p && p.id) productCategory.set(p.id, p.category || '_unknown');
        }

        // Start every known category at zero
        const agg = new Map();
        for (const c of cats) {
            agg.set(c.id, {
                id: c.id,
                name: c.name || c.id,
                revenue: 0,
                cost: 0,
                qty: 0,
                orders: 0
            });
        }

        // Anything pointing to a missing category goes here
        const uncategorized = { revenue: 0, cost: 0, qty: 0, orders: 0 };

        for (const o of orders) {
            const seenCats = new Set();   // count each category once per order

            for (const item of o.items || []) {
                const id = item.productId || item.id;
                const catId = productCategory.get(id) || '_unknown';

                const qty = Number(item.qty) || 0;
                const price = Number(item.price) || 0;
                const cost = Number.isFinite(+item.cost) ? +item.cost : null;

                // Uncategorized bucket
                if (catId === '_unknown' || !agg.has(catId)) {
                    uncategorized.revenue += price * qty;
                    uncategorized.qty += qty;
                    if (cost !== null) uncategorized.cost += cost * qty;

                    if (!seenCats.has(catId)) {
                        uncategorized.orders++;
                        seenCats.add(catId);
                    }
                    continue;
                }

                const a = agg.get(catId);
                a.revenue += price * qty;
                a.qty += qty;
                if (cost !== null) a.cost += cost * qty;

                if (!seenCats.has(catId)) {
                    a.orders++;
                    seenCats.add(catId);
                }
            }
        }

        const list = Array.from(agg.values())
            .map(a => ({
                id: a.id,
                name: a.name,
                revenue: round2(a.revenue),
                cost: round2(a.cost),
                profit: round2(a.revenue - a.cost),
                qty: a.qty,
                orders: a.orders
            }))
            .sort((a, b) => b.revenue - a.revenue);

        res.json({
            ok: true,
            categories: list,
            uncategorized: {
                revenue: round2(uncategorized.revenue),
                profit: round2(uncategorized.revenue - uncategorized.cost),
                qty: uncategorized.qty,
                orders: uncategorized.orders
            }
        });

    } catch (err) {
        console.error('[analytics/by-category]', err);
        res.status(500).json({ ok: false, error: 'Failed to load category data' });
    }
});


/* =========================================================
   GET /api/analytics/customer-stats
   New vs returning customers, plus activity this month.
   ========================================================= */
router.get('/customer-stats', auth.requireAdmin, (_req, res) => {
    try {
        const orders = validOrders();
        const customers = readList(CUSTOMERS_FILE);

        // Group every order by customerId
        const byCustomer = new Map();
        for (const o of orders) {
            const id = o.customerId;
            if (!id) continue;
            if (!byCustomer.has(id)) byCustomer.set(id, []);
            byCustomer.get(id).push(o);
        }

        const monthStartMs = monthStart().getTime();

        let newThisMonth = 0;
        let activeThisMonth = 0;
        let returning = 0;
        let oneTime = 0;

        for (const [, list] of byCustomer) {
            // Returning = 2+ orders, one-time = exactly 1
            if (list.length > 1) returning++;
            else oneTime++;

            // Did they order at least once this month?
            const hasOrderThisMonth = list.some(o =>
                new Date(o.date).getTime() >= monthStartMs
            );
            if (hasOrderThisMonth) activeThisMonth++;

            // "New this month" = their EARLIEST order was this month
            const earliest = list.reduce((min, o) => {
                const t = new Date(o.date).getTime();
                return t < min ? t : min;
            }, Infinity);

            if (earliest >= monthStartMs) newThisMonth++;
        }

        res.json({
            ok: true,
            stats: {
                totalCustomers: customers.length,
                withOrders: byCustomer.size,
                returning,
                oneTime,
                newThisMonth,
                activeThisMonth
            }
        });

    } catch (err) {
        console.error('[analytics/customer-stats]', err);
        res.status(500).json({ ok: false, error: 'Failed to load customer stats' });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;