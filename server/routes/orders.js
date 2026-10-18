'use strict';

const express = require('express');

const store = require('../lib/store');
const ids = require('../lib/ids');
const validate = require('../lib/validate');
const activity = require('../lib/activity');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const ORDERS_FILE = 'orders.json';
const PRODUCTS_FILE = 'products.json';
const CUSTOMERS_FILE = 'customers.json';
const SETTINGS_FILE = 'settings.json';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;


/* ============ HELPERS ============ */

// Read a JSON file, always return an array
function readList(file) {
    const raw = store.read(file);
    return Array.isArray(raw) ? raw : [];
}

// Read settings with sensible defaults
function readSettings() {
    const s = store.read(SETTINGS_FILE) || {};

    return {
        freeShippingThreshold: Number.isFinite(+s.freeShippingThreshold) ? +s.freeShippingThreshold : 499,
        shippingFee: Number.isFinite(+s.shippingFee) ? +s.shippingFee : 49,
        taxPercent: Number.isFinite(+s.taxPercent) ? +s.taxPercent : 0
    };
}

// Shipping fee rule (same as storefront)
function shippingFor(subtotal) {
    const s = readSettings();
    const n = Number(subtotal) || 0;

    if (n <= 0) return 0;
    return n > s.freeShippingThreshold ? 0 : s.shippingFee;
}

// True only for real finite numbers (rejects null/undefined/''/NaN)
function hasCost(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    return Number.isFinite(+v);
}

// Parse ?limit & ?offset with sane defaults
function pagination(req) {
    let limit = parseInt(req.query.limit, 10);
    let offset = parseInt(req.query.offset, 10);

    if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    return { limit, offset };
}

// Add computed display fields to an order
function decorate(order) {
    if (!order) return order;

    const items = Array.isArray(order.items) ? order.items : [];

    // Sum of all quantities
    const itemCount = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

    // Sum of price × qty
    const lineTotal = items.reduce(
        (s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0),
        0
    );

    // Profit only counts items that have a cost set
    let profit = 0;
    let anyCost = false;

    for (const i of items) {
        if (hasCost(i.cost)) {
            anyCost = true;
            profit += ((Number(i.price) || 0) - (Number(i.cost) || 0)) *
                (Number(i.qty) || 0);
        }
    }

    // CSS color tone for the status badge
    const statusTone =
        order.status === 'Delivered' ? 'ok' :
            order.status === 'Cancelled' ? 'bad' :
                order.status === 'Shipped' ? 'warn' : 'info';

    return {
        ...order,
        itemCount,
        lineTotal,
        profit: anyCost ? Math.round(profit * 100) / 100 : null,
        statusTone
    };
}


/* ============ HELPER: refresh customer stats ============ */
// Recompute orderCount / totalSpent / lastOrderAt for a customer.
async function refreshCustomerStats(customerId) {
    if (!customerId) return;

    // Cancelled orders do NOT count
    const orders = readList(ORDERS_FILE).filter(
        o => o && o.customerId === customerId && o.status !== 'Cancelled'
    );

    const orderCount = orders.length;

    const totalSpent = orders.reduce(
        (s, o) => s + (Number(o.total) || 0),
        0
    );

    const lastOrderAt = orders.length
        ? orders.reduce((latest, o) => {
            const d = new Date(o.date).getTime();
            return d > latest ? d : latest;
        }, 0)
        : 0;

    await store.mutate(CUSTOMERS_FILE, list => {
        if (!Array.isArray(list)) list = [];

        const idx = list.findIndex(c => c && c.id === customerId);
        if (idx !== -1) {
            list[idx] = {
                ...list[idx],
                orderCount,
                totalSpent,
                lastOrderAt: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
                updatedAt: new Date().toISOString()
            };
        }

        return list;
    }).catch(err => {
        console.warn('[orders] failed to update customer stats:', err.message);
    });
}


/* ============ HELPER: restock order items ============ */
// Add stock back for a set of order lines.
// Used when cancelling an order or deleting an order.
async function restockOrderItems(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const restocked = [];

    await store.mutate(PRODUCTS_FILE, list => {
        if (!Array.isArray(list)) return list;

        for (const line of items) {
            const idx = list.findIndex(p => p && p.id === line.productId);
            if (idx === -1) continue;

            const p = list[idx];
            p.stock = (Number(p.stock) || 0) + (Number(line.qty) || 0);
            p.updatedAt = new Date().toISOString();

            restocked.push({ product: p, qty: Number(line.qty) || 0 });
        }

        return list;
    });

    // Log one stock:changed event per restored line
    for (const { product, qty } of restocked) {
        activity.stockChanged(product, qty, Number(product.stock) || 0).catch(() => { });
    }

    return restocked;
}


/* ============ HELPER: decrement order items ============ */
// Reduce stock for a set of order lines.
// Runs INSIDE one products.json mutate → cannot oversell.
//
// Returns:
//   { ok: true,  changes: [{ product, qty, before, after }] }
//   { ok: false, error: 'Insufficient stock for "Name" — only N left', productId }
async function decrementOrderItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: true, changes: [] };
    }

    let failure = null;
    const changes = [];

    await store.mutate(PRODUCTS_FILE, list => {
        if (!Array.isArray(list)) {
            failure = { error: 'Product store unavailable', productId: null };
            return list;
        }

        /* ---- Pass 1: validate every line BEFORE touching anything ---- */
        for (const line of items) {
            const p = list.find(x => x && x.id === line.productId);

            if (!p) {
                failure = {
                    error: 'Product no longer available: ' + line.productId,
                    productId: line.productId
                };
                return list;
            }

            const have = Number(p.stock) || 0;
            const need = Number(line.qty) || 0;

            if (have < need) {
                failure = {
                    error: 'Insufficient stock for "' + p.name + '" — only ' + have + ' left',
                    productId: line.productId
                };
                return list;
            }
        }

        /* ---- Pass 2: apply the decrement ---- */
        const now = new Date().toISOString();

        for (const line of items) {
            const idx = list.findIndex(x => x && x.id === line.productId);
            if (idx === -1) continue;

            const p = list[idx];
            const before = Number(p.stock) || 0;
            const qty = Number(line.qty) || 0;

            p.stock = Math.max(0, before - qty);
            p.updatedAt = now;
            list[idx] = p;

            changes.push({ product: p, qty, before, after: p.stock });
        }

        return list;
    });

    if (failure) return { ok: false, ...failure };
    return { ok: true, changes };
}


/* ============ HELPER: rollback decrement ============ */
// Reverse a successful decrement (used if order write fails).
async function reIncrementOrderItems(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return;

    await store.mutate(PRODUCTS_FILE, list => {
        if (!Array.isArray(list)) return list;

        const now = new Date().toISOString();

        for (const ch of changes) {
            const idx = list.findIndex(p => p && p.id === ch.product.id);
            if (idx === -1) continue;

            list[idx].stock = (Number(list[idx].stock) || 0) + ch.qty;
            list[idx].updatedAt = now;
        }

        return list;
    });
}


/* =========================================================
   GET /api/orders
   Admin listing with filters + pagination.
   ========================================================= */
router.get('/', auth.requireAdmin, (req, res) => {
    try {
        let list = readList(ORDERS_FILE);

        /* ---- Filter: status ---- */
        if (req.query.status && req.query.status !== 'all') {
            const s = String(req.query.status);
            list = list.filter(o => o.status === s);
        }

        /* ---- Filter: customer ---- */
        if (req.query.customerId) {
            const id = String(req.query.customerId);
            list = list.filter(o => o.customerId === id);
        }

        /* ---- Search: order id, email, name ---- */
        if (req.query.q) {
            const q = String(req.query.q).toLowerCase().trim();

            list = list.filter(o =>
                String(o.id || '').toLowerCase().includes(q) ||
                String(o.customerEmail || '').toLowerCase().includes(q) ||
                String(o.customerName || '').toLowerCase().includes(q)
            );
        }

        /* ---- Filter: date range ---- */
        if (req.query.since) {
            const since = new Date(req.query.since).getTime();
            if (Number.isFinite(since)) {
                list = list.filter(o => new Date(o.date).getTime() >= since);
            }
        }
        if (req.query.until) {
            const until = new Date(req.query.until).getTime();
            if (Number.isFinite(until)) {
                list = list.filter(o => new Date(o.date).getTime() <= until);
            }
        }

        /* ---- Sort: newest first ---- */
        list = list.slice().sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );

        /* ---- Pagination ---- */
        const total = list.length;
        const { limit, offset } = pagination(req);
        const page = list.slice(offset, offset + limit).map(decorate);

        res.json({ ok: true, total, limit, offset, orders: page });

    } catch (err) {
        console.error('[orders/list]', err);
        res.status(500).json({ ok: false, error: 'Failed to load orders' });
    }
});


/* =========================================================
   GET /api/orders/stats
   MUST be before /:id — otherwise "stats" is treated as an id.
   ========================================================= */
router.get('/stats', auth.requireAdmin, (_req, res) => {
    try {
        const orders = readList(ORDERS_FILE);

        const now = new Date();
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startWeek = new Date(startToday); startWeek.setDate(startToday.getDate() - 6);
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Helper: count + revenue since a given start date
        function statsSince(start) {
            let count = 0;
            let revenue = 0;

            for (const o of orders) {
                if (!o || o.status === 'Cancelled') continue;
                if (new Date(o.date).getTime() >= start.getTime()) {
                    count++;
                    revenue += Number(o.total) || 0;
                }
            }

            return { count, revenue };
        }

        const byStatus = { Processing: 0, Shipped: 0, Delivered: 0, Cancelled: 0 };
        let lifetime = 0;
        let lifetimeRevenue = 0;

        for (const o of orders) {
            if (!o) continue;

            const s = o.status || 'Processing';

            if (s in byStatus) byStatus[s]++;

            if (s !== 'Cancelled') {
                lifetime++;
                lifetimeRevenue += Number(o.total) || 0;
            }
        }

        res.json({
            ok: true,
            stats: {
                today: statsSince(startToday),
                week: statsSince(startWeek),
                month: statsSince(startMonth),
                lifetime: { count: lifetime, revenue: lifetimeRevenue },
                byStatus
            }
        });

    } catch (err) {
        console.error('[orders/stats]', err);
        res.status(500).json({ ok: false, error: 'Failed to load order stats' });
    }
});


/* =========================================================
   GET /api/orders/mine — current user's orders
   ========================================================= */
router.get('/mine', auth.requireAuth, (req, res) => {
    try {
        const mine = readList(ORDERS_FILE)
            .filter(o => o && o.customerId === req.user.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map(decorate);

        res.json({ ok: true, orders: mine });

    } catch (err) {
        console.error('[orders/mine]', err);
        res.status(500).json({ ok: false, error: 'Failed to load your orders' });
    }
});


/* =========================================================
   GET /api/orders/:id
   Admin sees any; customer sees only their own.
   ========================================================= */
router.get('/:id', auth.optionalAuth, (req, res) => {
    try {
        const order = readList(ORDERS_FILE).find(o => o && o.id === req.params.id);

        if (!order) {
            return res.status(404).json({ ok: false, error: 'Order not found' });
        }

        const isAdmin = req.user && req.user.role === 'admin';
        const isOwner = req.user && order.customerId === req.user.id;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({
                ok: false,
                error: 'You do not have permission to view this order'
            });
        }

        res.json({ ok: true, order: decorate(order) });

    } catch (err) {
        console.error('[orders/get]', err);
        res.status(500).json({ ok: false, error: 'Failed to load order' });
    }
});


/* =========================================================
   POST /api/orders — place an order

   Every line is re-priced from products.json (never trust
   the client). Stock is checked AND decremented inside one
   mutate → no overselling. If the order write fails after
   that, stock is rolled back.
   ========================================================= */
router.post('/', auth.requireAuth, async (req, res) => {
    try {
        /* ---- 1. Validate request ---- */
        const v = validate.order(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        const { items, address, payment, notes } = v.value;

        /* ---- 2. Re-price every line from products.json ---- */
        const priced = [];
        const products = readList(PRODUCTS_FILE);

        for (const line of items) {
            const p = products.find(x => x && x.id === line.productId);

            if (!p) {
                return res.status(400).json({
                    ok: false,
                    error: 'Product no longer available: ' + line.productId,
                    field: 'items'
                });
            }

            // Early stock hint (final check happens inside decrementOrderItems)
            if ((Number(p.stock) || 0) < line.qty) {
                return res.status(409).json({
                    ok: false,
                    error: `Insufficient stock for "${p.name}" — only ${Number(p.stock) || 0} left`,
                    field: 'items'
                });
            }

            priced.push({
                productId: p.id,
                name: p.name,
                brand: p.brand,
                image: (p.images && p.images[0]) || '',
                qty: line.qty,
                price: Number(p.price) || 0,
                cost: hasCost(p.cost) ? +p.cost : null
            });
        }

        /* ---- 3. Totals ---- */
        const subtotal = priced.reduce((s, i) => s + i.price * i.qty, 0);
        const shipping = shippingFor(subtotal);

        const settings = readSettings();
        const tax = settings.taxPercent > 0
            ? Math.round(subtotal * settings.taxPercent) / 100
            : 0;

        const total = subtotal + shipping + tax;

        /* ---- 4. Build the order object ---- */
        const now = new Date().toISOString();

        const order = {
            id: ids.orderId(),
            customerId: req.user.id,
            customerName: req.user.name || address.name || 'Customer',
            customerEmail: req.user.email,
            items: priced.map(i => ({
                productId: i.productId,
                name: i.name,
                brand: i.brand,
                image: i.image,
                qty: i.qty,
                price: i.price,
                cost: i.cost
            })),
            subtotal,
            shipping,
            tax,
            total,
            address,
            payment: payment || { method: 'COD', status: 'Pending' },
            status: 'Processing',
            notes: notes || '',
            date: now,
            updatedAt: now,
            statusHistory: [{ status: 'Processing', date: now, by: req.user.id }]
        };

        /* ---- 5. Decrement stock atomically ---- */
        const stockResult = await decrementOrderItems(priced);

        if (!stockResult.ok) {
            return res.status(409).json({
                ok: false,
                error: stockResult.error,
                field: 'items'
            });
        }

        /* ---- 6. Save the order. If write fails → rollback stock ---- */
        try {
            await store.mutate(ORDERS_FILE, list => {
                if (!Array.isArray(list)) list = [];
                list.push(order);
                return list;
            });
        } catch (writeErr) {
            console.error('[orders/create] order write failed — rolling back stock:', writeErr);
            await reIncrementOrderItems(stockResult.changes).catch(() => { });
            throw writeErr;
        }

        /* ---- 7. Ensure customer profile exists + refresh stats ---- */
        try {
            await store.mutate(CUSTOMERS_FILE, list => {
                if (!Array.isArray(list)) list = [];

                let idx = list.findIndex(c => c && c.id === req.user.id);

                // Create profile if missing
                if (idx === -1) {
                    list.push({
                        id: req.user.id,
                        name: req.user.name,
                        email: req.user.email,
                        joined: req.user.joined || now,
                        orderCount: 0,
                        totalSpent: 0,
                        lastOrderAt: null
                    });
                    idx = list.length - 1;
                }

                // Update name/email if the user has newer ones
                list[idx].name = req.user.name || list[idx].name;
                list[idx].email = req.user.email || list[idx].email;

                return list;
            });

            await refreshCustomerStats(req.user.id);
        } catch (custErr) {
            // Non-fatal: order + stock are already correct.
            console.warn('[orders/create] customer stats update failed:', custErr.message);
        }

        /* ---- 8. Activity events (fire & forget) ---- */
        activity.orderCreated(order).catch(() => { });

        for (const ch of stockResult.changes) {
            activity.stockChanged(ch.product, -ch.qty, ch.after).catch(() => { });

            const threshold = Number.isFinite(+ch.product.lowStockThreshold)
                ? +ch.product.lowStockThreshold
                : 10;

            // Did this sale push stock to zero or below threshold?
            if (ch.after === 0 && ch.before > 0) {
                activity.stockOut(ch.product).catch(() => { });
            } else if (ch.after > 0 && ch.after <= threshold && ch.before > threshold) {
                activity.stockLow(ch.product, threshold).catch(() => { });
            }
        }

        /* ---- 9. Respond ---- */
        res.status(201).json({ ok: true, order: decorate(order) });

    } catch (err) {
        console.error('[orders/create]', err);
        res.status(500).json({
            ok: false,
            error: 'Could not place order. Please try again.'
        });
    }
});


/* =========================================================
   PATCH /api/orders/:id/status
   Admin-only. Two special transitions:

     • → Cancelled     : restore stock.
     • ← Cancelled     : re-check stock, then re-decrement.
                         Refuses if stock is insufficient.
   ========================================================= */
router.patch('/:id/status', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        /* ---- 1. Validate the new status ---- */
        const v = validate.orderStatus(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        const nextStatus = v.value.status;

        /* ---- 2. Find the order ---- */
        const order = readList(ORDERS_FILE).find(o => o && o.id === id);
        if (!order) {
            return res.status(404).json({ ok: false, error: 'Order not found' });
        }

        const previousStatus = order.status || 'Processing';

        if (previousStatus === nextStatus) {
            return res.json({ ok: true, order: decorate(order), noop: true });
        }

        /* ---- 3a. Moving INTO Cancelled → restore stock ---- */
        let restocked = false;

        if (nextStatus === 'Cancelled' && previousStatus !== 'Cancelled') {
            await restockOrderItems(order.items);
            restocked = true;
        }

        /* ---- 3b. Moving OUT OF Cancelled → re-decrement stock ---- */
        let stockResult = null;

        if (previousStatus === 'Cancelled' && nextStatus !== 'Cancelled') {
            const linesToReserve = (order.items || [])
                .map(i => ({ productId: i.productId, qty: Number(i.qty) || 0 }))
                .filter(l => l.productId && l.qty > 0);

            stockResult = await decrementOrderItems(linesToReserve);

            if (!stockResult.ok) {
                return res.status(409).json({
                    ok: false,
                    error: 'Cannot un-cancel: ' + stockResult.error,
                    field: 'status'
                });
            }
        }

        /* ---- 4. Auto-mark COD as Paid on Delivered ---- */
        const payment = { ...(order.payment || {}) };
        if (nextStatus === 'Delivered' && payment.method === 'COD') {
            payment.status = 'Paid';
        }

        /* ---- 5. Save the updated order ---- */
        const now = new Date().toISOString();

        const historyEntry = { status: nextStatus, date: now, by: req.user.id };

        const updated = {
            ...order,
            status: nextStatus,
            payment,
            updatedAt: now,
            statusHistory: Array.isArray(order.statusHistory)
                ? order.statusHistory.concat([historyEntry])
                : [historyEntry]
        };

        try {
            await store.mutate(ORDERS_FILE, list => {
                const idx = list.findIndex(o => o && o.id === id);
                if (idx !== -1) list[idx] = updated;
                return list;
            });
        } catch (writeErr) {
            // Rollback the un-cancel re-decrement if the order write failed
            if (stockResult && stockResult.ok) {
                await reIncrementOrderItems(stockResult.changes).catch(() => { });
            }
            throw writeErr;
        }

        /* ---- 6. Refresh customer stats if cancellation state changed ---- */
        if (previousStatus === 'Cancelled' || nextStatus === 'Cancelled') {
            await refreshCustomerStats(order.customerId);
        }

        /* ---- 7. Activity events ---- */
        activity.orderStatusChanged(updated, previousStatus).catch(() => { });

        if (stockResult && stockResult.ok) {
            for (const ch of stockResult.changes) {
                activity.stockChanged(ch.product, -ch.qty, ch.after).catch(() => { });
            }
        }

        res.json({
            ok: true,
            order: decorate(updated),
            restocked,
            reserved: !!(stockResult && stockResult.ok)
        });

    } catch (err) {
        console.error('[orders/status]', err);
        res.status(500).json({ ok: false, error: 'Could not update status' });
    }
});


/* =========================================================
   DELETE /api/orders/:id
   Admin-only. Restores stock UNLESS the order was:
     • Cancelled (already restocked earlier)
     • Delivered (that stock is permanently sold)
   ========================================================= */
router.delete('/:id', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        const order = readList(ORDERS_FILE).find(o => o && o.id === id);
        if (!order) {
            return res.status(404).json({ ok: false, error: 'Order not found' });
        }

        const status = order.status || 'Processing';

        // Only Processing / Shipped still "hold" stock
        const shouldRestock = status === 'Processing' || status === 'Shipped';
        let restocked = false;

        if (shouldRestock) {
            await restockOrderItems(order.items);
            restocked = true;
        }

        /* ---- Remove the order from the file ---- */
        await store.mutate(ORDERS_FILE, list =>
            list.filter(o => o && o.id !== id)
        );

        await refreshCustomerStats(order.customerId);
        activity.orderDeleted(order).catch(() => { });

        res.json({ ok: true, deletedId: id, restocked });

    } catch (err) {
        console.error('[orders/delete]', err);
        res.status(500).json({ ok: false, error: 'Could not delete order' });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;