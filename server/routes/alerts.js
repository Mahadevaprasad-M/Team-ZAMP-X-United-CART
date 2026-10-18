'use strict';

const express = require('express');

const store = require('../lib/store');
const validate = require('../lib/validate');
const activity = require('../lib/activity');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const PRODUCTS_FILE = 'products.json';
const SETTINGS_FILE = 'settings.json';
const HARDCODED_THRESHOLD = 10;
const WATCH_MULTIPLIER = 1.5;


/* ============ HELPER: read data safely ============ */

// Read a JSON file from the store and always return an array
function readList(file) {
    const raw = store.read(file);
    return Array.isArray(raw) ? raw : [];
}

// Read settings with sensible defaults
function readSettings() {
    const s = store.read(SETTINGS_FILE) || {};

    return {
        defaultLowStockThreshold: Number.isFinite(+s.defaultLowStockThreshold)
            ? +s.defaultLowStockThreshold
            : HARDCODED_THRESHOLD,
        lowStockAlertsEnabled: s.lowStockAlertsEnabled !== false
    };
}


/* ============ HELPER: threshold & status ============ */

// Which threshold applies to this product?
// Order: product → settings → hardcoded
function thresholdFor(product, settings) {
    if (product && Number.isFinite(+product.lowStockThreshold)) {
        return +product.lowStockThreshold;
    }
    if (settings && Number.isFinite(+settings.defaultLowStockThreshold)) {
        return +settings.defaultLowStockThreshold;
    }
    return HARDCODED_THRESHOLD;
}

// Returns 'out' | 'low' | 'watch' | 'ok'
function stockStatus(product, threshold) {
    const stock = Number(product.stock) || 0;

    if (stock <= 0) return 'out';
    if (stock <= threshold) return 'low';
    if (stock <= threshold * WATCH_MULTIPLIER) return 'watch';
    return 'ok';
}


/* ============ HELPER: build a row ============ */

// Turn a product into a small row for the alerts page
function toAlertRow(product, threshold) {
    const stock = Number(product.stock) || 0;
    const status = stockStatus(product, threshold);

    // How many units to order to reach ~1.5× threshold
    const suggestedRestock = Math.max(1, Math.ceil(threshold * 1.5) - stock);

    // Sort rank: 0 = out (most urgent), 3 = ok
    const severityRank =
        status === 'out' ? 0 :
            status === 'low' ? 1 :
                status === 'watch' ? 2 : 3;

    return {
        productId: product.id,
        name: product.name,
        brand: product.brand || '',
        category: product.category || '',
        image: (product.images && product.images[0]) || '',
        price: Number(product.price) || 0,
        stock,
        threshold,
        status,
        suggestedRestock,
        severityRank
    };
}


/* ============ HELPER: compute all alerts ============ */

// Read products, bucket them into low / out / watch, and sort.
function computeAlerts() {
    const products = readList(PRODUCTS_FILE);
    const settings = readSettings();

    const low = [];
    const out = [];
    const watch = [];
    const all = [];

    for (const p of products) {
        if (!p || !p.id) continue;

        const threshold = thresholdFor(p, settings);
        const row = toAlertRow(p, threshold);

        if (row.status === 'out') {
            out.push(row);
            all.push(row);
        } else if (row.status === 'low') {
            low.push(row);
            all.push(row);
        } else if (row.status === 'watch') {
            watch.push(row);   // watch rows are NOT in `all`
        }
    }

    // `all` sorted by severity first, then lowest stock first
    all.sort((a, b) =>
        a.severityRank !== b.severityRank
            ? a.severityRank - b.severityRank
            : a.stock - b.stock
    );

    // Individual lists: lowest stock first
    out.sort((a, b) => a.stock - b.stock);
    low.sort((a, b) => a.stock - b.stock);
    watch.sort((a, b) => a.stock - b.stock);

    return { low, out, watch, all };
}


/* =========================================================
   GET /api/alerts/summary
   Fast counts for sidebar badge + dashboard KPI tile.
   ========================================================= */
router.get('/summary', auth.requireAdmin, (_req, res) => {
    try {
        const settings = readSettings();

        // If alerts are turned off, return all zeros
        if (settings.lowStockAlertsEnabled === false) {
            return res.json({
                ok: true,
                enabled: false,
                counts: { out: 0, low: 0, watch: 0, total: 0 },
                criticalItems: []
            });
        }

        const { low, out, watch, all } = computeAlerts();

        // Show up to 3 most urgent items on the dashboard card
        const criticalItems = all.slice(0, 3).map(r => ({
            productId: r.productId,
            name: r.name,
            image: r.image,
            stock: r.stock,
            threshold: r.threshold,
            status: r.status
        }));

        res.json({
            ok: true,
            enabled: true,
            counts: {
                out: out.length,
                low: low.length,
                watch: watch.length,
                total: out.length + low.length
            },
            criticalItems
        });
    } catch (err) {
        console.error('[alerts/summary]', err);
        res.status(500).json({ ok: false, error: 'Failed to load alert counts' });
    }
});


/* =========================================================
   GET /api/alerts/low-stock
   Products where 0 < stock <= threshold.
   ========================================================= */
router.get('/low-stock', auth.requireAdmin, (_req, res) => {
    try {
        const { low } = computeAlerts();
        res.json({ ok: true, count: low.length, products: low });
    } catch (err) {
        console.error('[alerts/low-stock]', err);
        res.status(500).json({ ok: false, error: 'Failed to load low-stock items' });
    }
});


/* =========================================================
   GET /api/alerts/out-of-stock
   Products where stock === 0.
   ========================================================= */
router.get('/out-of-stock', auth.requireAdmin, (_req, res) => {
    try {
        const { out } = computeAlerts();
        res.json({ ok: true, count: out.length, products: out });
    } catch (err) {
        console.error('[alerts/out-of-stock]', err);
        res.status(500).json({ ok: false, error: 'Failed to load out-of-stock items' });
    }
});


/* =========================================================
   GET /api/alerts/all
   Everything the alerts page needs in one call.
   ========================================================= */
router.get('/all', auth.requireAdmin, (_req, res) => {
    try {
        const settings = readSettings();
        const { low, out, watch, all } = computeAlerts();

        // "Value at risk" = price × suggestedRestock for every alert
        let valueAtRisk = 0;
        for (const r of all) {
            valueAtRisk += (r.price || 0) * Math.max(r.suggestedRestock, 0);
        }

        res.json({
            ok: true,
            enabled: settings.lowStockAlertsEnabled !== false,
            counts: {
                out: out.length,
                low: low.length,
                watch: watch.length,
                total: all.length
            },
            valueAtRisk: Math.round(valueAtRisk),
            products: all,
            lists: { out, low, watch }
        });
    } catch (err) {
        console.error('[alerts/all]', err);
        res.status(500).json({ ok: false, error: 'Failed to load alerts' });
    }
});


/* =========================================================
   POST /api/alerts/restock
   Bulk stock updates — all or nothing.
   If any productId is invalid, nothing is saved.
   ========================================================= */
router.post('/restock', auth.requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};

        /* ---- STEP 1: basic shape check ---- */
        if (!Array.isArray(body.updates) || body.updates.length === 0) {
            return res.status(400).json({
                ok: false,
                error: 'updates must be a non-empty array',
                field: 'updates'
            });
        }
        if (body.updates.length > 100) {
            return res.status(400).json({
                ok: false,
                error: 'Too many updates in one request (max 100)',
                field: 'updates'
            });
        }

        /* ---- STEP 2: validate each line ---- */
        const normalised = [];

        for (let i = 0; i < body.updates.length; i++) {
            const raw = body.updates[i];

            // Must be an object
            if (!raw || typeof raw !== 'object') {
                return res.status(400).json({
                    ok: false,
                    error: `Update #${i + 1} is not an object`,
                    field: 'updates'
                });
            }

            // Must have a productId
            const productId = String(raw.productId || '').trim();
            if (!productId) {
                return res.status(400).json({
                    ok: false,
                    error: `Update #${i + 1} is missing productId`,
                    field: 'updates'
                });
            }

            // Must provide exactly ONE of "set" or "delta"
            const hasSet = raw.set !== undefined;
            const hasDelta = raw.delta !== undefined;

            if (hasSet === hasDelta) {
                return res.status(400).json({
                    ok: false,
                    error: `Update #${i + 1} must provide exactly one of "set" or "delta"`,
                    field: 'updates'
                });
            }

            // Value must be a valid number
            const v = validate.stockAdjustment(raw);
            if (!v.ok) {
                return res.status(400).json({
                    ok: false,
                    error: `Update #${i + 1}: ${v.error}`,
                    field: 'updates'
                });
            }

            normalised.push({
                productId,
                mode: v.value.mode,   // 'set' or 'delta'
                value: v.value.value
            });
        }

        /* ---- STEP 3: every productId must exist ---- */
        const products = readList(PRODUCTS_FILE);
        const productMap = new Map();

        for (const p of products) {
            if (p && p.id) productMap.set(p.id, p);
        }

        for (const line of normalised) {
            if (!productMap.has(line.productId)) {
                return res.status(404).json({
                    ok: false,
                    error: `Product not found: ${line.productId}`,
                    field: 'updates'
                });
            }
        }

        /* ---- STEP 4: apply changes (inside store.mutate = atomic) ---- */
        const applied = [];

        await store.mutate(PRODUCTS_FILE, list => {
            if (!Array.isArray(list)) return list;

            const now = new Date().toISOString();

            for (const line of normalised) {
                const idx = list.findIndex(p => p && p.id === line.productId);
                if (idx === -1) continue;

                const p = list[idx];
                const prevStock = Number(p.stock) || 0;

                // Calculate the new stock
                let nextStock;
                if (line.mode === 'set') {
                    nextStock = line.value;
                } else {
                    nextStock = Math.max(0, prevStock + line.value);   // never below 0
                }

                // Skip if nothing changes
                if (nextStock === prevStock) continue;

                p.stock = nextStock;
                p.updatedAt = now;
                list[idx] = p;

                applied.push({
                    productId: p.id,
                    name: p.name,
                    previousStock: prevStock,
                    newStock: nextStock,
                    delta: nextStock - prevStock,
                    product: p
                });
            }

            return list;
        });

        /* ---- STEP 5: nothing changed? Return "noop" ---- */
        if (applied.length === 0) {
            return res.json({
                ok: true,
                noop: true,
                message: 'No changes were needed',
                applied: []
            });
        }

        /* ---- STEP 6: log activity events ---- */
        const settings = readSettings();

        for (const item of applied) {
            // Always log a "stock changed" event
            activity.stockChanged(item.product, item.delta, item.newStock)
                .catch(() => { });

            const threshold = thresholdFor(item.product, settings);
            const prev = item.previousStock;

            // Was this restock enough to clear a low/out state?
            if (prev === 0 && item.newStock > 0) {
                activity.log({
                    type: 'stock:restocked',
                    message: `Restocked ${item.name} → ${item.newStock} units`,
                    meta: { productId: item.productId, from: prev, to: item.newStock },
                    actor: 'admin'
                }).catch(() => { });

            } else if (prev > 0 && prev <= threshold && item.newStock > threshold) {
                activity.log({
                    type: 'stock:restocked',
                    message: `Restocked ${item.name} above threshold (${item.newStock})`,
                    meta: { productId: item.productId, from: prev, to: item.newStock },
                    actor: 'admin'
                }).catch(() => { });
            }
        }

        /* ---- STEP 7: respond with a summary ---- */
        res.json({
            ok: true,
            applied: applied.map(a => ({
                productId: a.productId,
                name: a.name,
                previousStock: a.previousStock,
                newStock: a.newStock,
                delta: a.delta
            }))
        });

    } catch (err) {
        console.error('[alerts/restock]', err);
        res.status(500).json({
            ok: false,
            error: 'Could not apply restock. Please try again.'
        });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;