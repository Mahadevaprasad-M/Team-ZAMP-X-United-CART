'use strict';

const express = require('express');

const store = require('../lib/store');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const CUSTOMERS_FILE = 'customers.json';
const ORDERS_FILE = 'orders.json';
const USERS_FILE = 'users.json';

// Auto-VIP thresholds
const VIP_SPEND = 50000;
const VIP_ORDERS = 5;

// Pagination defaults
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;


/* ============ HELPERS ============ */

// Read a JSON file, always return an array
function readList(file) {
    const raw = store.read(file);
    return Array.isArray(raw) ? raw : [];
}

// Round money to 2 decimal places
function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

// True only for real finite numbers (including 0).
// Rejects null, undefined, '', NaN, Infinity.
// Why? Because +null === 0, so `hasCost(null)` would
// wrongly return true if we only used Number.isFinite.
function hasCost(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    return Number.isFinite(+v);
}

// Does this customer qualify for auto-VIP?
function qualifiesForVip(c) {
    if (!c) return false;

    return (Number(c.totalSpent) || 0) >= VIP_SPEND ||
        (Number(c.orderCount) || 0) >= VIP_ORDERS;
}

// Add computed display fields to a customer
function decorate(customer, userMap) {
    if (!customer) return customer;

    const u = userMap ? userMap.get(customer.id) : null;
    const autoVip = qualifiesForVip(customer);

    return {
        ...customer,
        joined: customer.joined || (u && u.joined) || null,
        role: u ? (u.role || 'customer') : 'customer',
        vip: customer.vip === true || autoVip,
        vipManual: customer.vip === true,
        vipAuto: autoVip,
        totalSpent: round2(customer.totalSpent),
        lastOrderAt: customer.lastOrderAt || null,
        notes: customer.notes || '',
        tags: Array.isArray(customer.tags) ? customer.tags : [],
        active: customer.active !== false
    };
}

// id → user object lookup
function buildUserMap() {
    const m = new Map();
    for (const u of readList(USERS_FILE)) {
        if (u && u.id) m.set(u.id, u);
    }
    return m;
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

// Start of the current month (local time)
function monthStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
}


/* =========================================================
   MERGED LIST — users.json + customers.json
   Every 'customer' role user gets a row. If a matching
   customers.json record exists it's merged in; otherwise
   a zero-order profile is synthesized.

   Admins are excluded — including any stale customers.json
   record created when an admin placed a test order.
   ========================================================= */
function buildMergedList() {
    const users = readList(USERS_FILE);
    const customers = readList(CUSTOMERS_FILE);

    // id → customer record
    const customerById = new Map();
    for (const c of customers) {
        if (c && c.id) customerById.set(c.id, c);
    }

    const merged = [];

    for (const u of users) {
        if (!u || !u.id) continue;

        // Skip admins — and drop any stale customer record
        if (u.role === 'admin') {
            customerById.delete(u.id);
            continue;
        }

        const existing = customerById.get(u.id);

        if (existing) {
            merged.push(existing);
            customerById.delete(u.id);
        } else {
            // Registered user, zero orders
            merged.push({
                id: u.id,
                name: u.name,
                email: u.email,
                joined: u.joined,
                orderCount: 0,
                totalSpent: 0,
                lastOrderAt: null
            });
        }
    }

    // Orphans — customers.json rows whose user was deleted
    for (const c of customerById.values()) {
        if (c && c.id) merged.push(c);
    }

    return merged;
}


/* =========================================================
   GET /api/customers
   List with search / filters / sort / pagination.
   ========================================================= */
router.get('/', auth.requireAdmin, (req, res) => {
    try {
        const userMap = buildUserMap();
        let list = buildMergedList().map(c => decorate(c, userMap));

        /* ---- Search by name or email ---- */
        if (req.query.q) {
            const q = String(req.query.q).toLowerCase().trim();

            list = list.filter(c =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.email || '').toLowerCase().includes(q)
            );
        }

        /* ---- Filters ---- */
        if (req.query.vip === '1') list = list.filter(c => c.vip);
        if (req.query.active === '1') list = list.filter(c => c.active);

        /* ---- Sorters ---- */
        const sorters = {
            spend: (a, b) => (b.totalSpent || 0) - (a.totalSpent || 0),
            orders: (a, b) => (b.orderCount || 0) - (a.orderCount || 0),
            name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
            recent: (a, b) => {
                const ta = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
                const tb = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
                if (ta !== tb) return tb - ta;

                // Fall back to join date for people with no orders
                const ja = a.joined ? new Date(a.joined).getTime() : 0;
                const jb = b.joined ? new Date(b.joined).getTime() : 0;
                return jb - ja;
            }
        };

        list.sort(sorters[req.query.sort] || sorters.recent);

        /* ---- Pagination ---- */
        const total = list.length;
        const { limit, offset } = pagination(req);
        const page = list.slice(offset, offset + limit);

        res.json({
            ok: true,
            total,
            limit,
            offset,
            customers: page
        });

    } catch (err) {
        console.error('[customers/list]', err);
        res.status(500).json({ ok: false, error: 'Failed to load customers' });
    }
});


/* =========================================================
   GET /api/customers/stats
   Aggregate KPIs across the merged list.
   ========================================================= */
router.get('/stats', auth.requireAdmin, (_req, res) => {
    try {
        const userMap = buildUserMap();
        const list = buildMergedList().map(c => decorate(c, userMap));

        const ms = monthStart().getTime();

        let totalSpend = 0;
        let totalOrders = 0;
        let vipCount = 0;
        let activeCount = 0;
        let newThisMonth = 0;
        let withOrders = 0;

        for (const c of list) {
            totalSpend += Number(c.totalSpent) || 0;
            totalOrders += Number(c.orderCount) || 0;

            if (c.vip) vipCount++;
            if (c.active) activeCount++;
            if ((Number(c.orderCount) || 0) > 0) withOrders++;

            if (c.joined) {
                const t = new Date(c.joined).getTime();
                if (Number.isFinite(t) && t >= ms) newThisMonth++;
            }
        }

        const averageSpend = withOrders > 0 ? round2(totalSpend / withOrders) : 0;

        res.json({
            ok: true,
            stats: {
                total: list.length,
                active: activeCount,
                vip: vipCount,
                withOrders,
                newThisMonth,
                totalSpend: round2(totalSpend),
                totalOrders,
                averageSpend
            }
        });

    } catch (err) {
        console.error('[customers/stats]', err);
        res.status(500).json({ ok: false, error: 'Failed to load customer stats' });
    }
});


/* =========================================================
   GET /api/customers/:id
   Detail + order history + lifetime metrics.
   ========================================================= */
router.get('/:id', auth.requireAdmin, (req, res) => {
    try {
        const id = req.params.id;
        const userMap = buildUserMap();

        // Admins are never customers — refuse
        const u = userMap.get(id);
        if (u && u.role === 'admin') {
            return res.status(404).json({ ok: false, error: 'Customer not found' });
        }

        // Find or synthesize the customer record
        let customer = readList(CUSTOMERS_FILE).find(c => c && c.id === id);

        if (!customer) {
            if (!u) {
                return res.status(404).json({ ok: false, error: 'Customer not found' });
            }

            customer = {
                id: u.id,
                name: u.name,
                email: u.email,
                joined: u.joined,
                orderCount: 0,
                totalSpent: 0,
                lastOrderAt: null
            };
        }

        // All orders for this customer
        const allOrders = readList(ORDERS_FILE)
            .filter(o => o && o.customerId === id);

        // Order list — newest first, INCLUDES cancelled
        const orders = allOrders
            .slice()
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map(o => ({
                id: o.id,
                date: o.date,
                status: o.status || 'Processing',
                total: Number(o.total) || 0,
                itemCount: (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0),
                items: (o.items || []).map(i => ({
                    productId: i.productId,
                    name: i.name,
                    qty: Number(i.qty) || 0,
                    price: Number(i.price) || 0
                }))
            }));

        // Lifetime metrics — EXCLUDES cancelled
        let lifetimeRevenue = 0;
        let lifetimeProfit = 0;
        let hasAnyCost = false;

        for (const o of allOrders) {
            if (o.status === 'Cancelled') continue;

            lifetimeRevenue += Number(o.total) || 0;

            for (const item of o.items || []) {
                if (hasCost(item.cost)) {
                    hasAnyCost = true;
                    lifetimeProfit +=
                        ((Number(item.price) || 0) - (Number(item.cost) || 0)) *
                        (Number(item.qty) || 0);
                }
            }
        }

        res.json({
            ok: true,
            customer: decorate(customer, userMap),
            orders,
            metrics: {
                lifetimeRevenue: round2(lifetimeRevenue),
                lifetimeProfit: hasAnyCost ? round2(lifetimeProfit) : null,
                orderCount: orders.filter(o => o.status !== 'Cancelled').length,
                cancelledCount: orders.filter(o => o.status === 'Cancelled').length
            }
        });

    } catch (err) {
        console.error('[customers/get]', err);
        res.status(500).json({ ok: false, error: 'Failed to load customer' });
    }
});


/* =========================================================
   PATCH /api/customers/:id
   Update notes / tags / vip / active (whitelisted).
   ========================================================= */
router.patch('/:id', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body || {};

        /* ---- 1. Build whitelist of allowed fields ---- */
        const allowed = {};

        if (body.notes !== undefined) {
            allowed.notes = String(body.notes || '').slice(0, 1000);
        }

        if (body.tags !== undefined) {
            if (!Array.isArray(body.tags)) {
                return res.status(400).json({
                    ok: false,
                    error: 'tags must be an array of strings',
                    field: 'tags'
                });
            }

            allowed.tags = body.tags
                .map(t => String(t || '').trim())
                .filter(Boolean)
                .slice(0, 10);
        }

        if (body.vip !== undefined) allowed.vip = !!body.vip;
        if (body.active !== undefined) allowed.active = !!body.active;

        if (Object.keys(allowed).length === 0) {
            return res.status(400).json({
                ok: false,
                error: 'No updatable fields provided'
            });
        }

        /* ---- 2. Look up user + customer ---- */
        const userMap = buildUserMap();
        const customers = readList(CUSTOMERS_FILE);
        const exists = customers.some(c => c && c.id === id);
        const u = userMap.get(id);

        // Refuse to edit admins
        if (u && u.role === 'admin') {
            return res.status(404).json({ ok: false, error: 'Customer not found' });
        }

        /* ---- 3. Create a customer record if only user exists ---- */
        if (!exists) {
            if (!u) {
                return res.status(404).json({ ok: false, error: 'Customer not found' });
            }

            await store.mutate(CUSTOMERS_FILE, list => {
                if (!Array.isArray(list)) list = [];

                list.push({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    joined: u.joined,
                    orderCount: 0,
                    totalSpent: 0,
                    lastOrderAt: null
                });

                return list;
            });
        }

        /* ---- 4. Apply the update (atomic) ---- */
        let updated = null;

        await store.mutate(CUSTOMERS_FILE, list => {
            if (!Array.isArray(list)) list = [];

            const idx = list.findIndex(c => c && c.id === id);
            if (idx !== -1) {
                list[idx] = {
                    ...list[idx],
                    ...allowed,
                    updatedAt: new Date().toISOString()
                };
                updated = list[idx];
            }

            return list;
        });

        if (!updated) {
            return res.status(404).json({ ok: false, error: 'Customer not found' });
        }

        /* ---- 5. Respond ---- */
        res.json({
            ok: true,
            customer: decorate(updated, userMap)
        });

    } catch (err) {
        console.error('[customers/patch]', err);
        res.status(500).json({ ok: false, error: 'Could not update customer' });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;