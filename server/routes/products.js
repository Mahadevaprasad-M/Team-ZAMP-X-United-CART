'use strict';

const express = require('express');

const store = require('../lib/store');
const ids = require('../lib/ids');
const validate = require('../lib/validate');
const activity = require('../lib/activity');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const PRODUCTS_FILE = 'products.json';
const SETTINGS_FILE = 'settings.json';
const DEFAULT_THRESHOLD = 10;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;


/* ============ HELPERS ============ */

// Read products array safely
function readProducts() {
    const raw = store.read(PRODUCTS_FILE);
    return Array.isArray(raw) ? raw : [];
}

// Threshold order: product override → settings → 10
function thresholdFor(product) {
    if (product && Number.isFinite(+product.lowStockThreshold)) {
        return +product.lowStockThreshold;
    }

    const settings = store.read(SETTINGS_FILE);
    if (settings && Number.isFinite(+settings.defaultLowStockThreshold)) {
        return +settings.defaultLowStockThreshold;
    }

    return DEFAULT_THRESHOLD;
}

// Fire stock:out / stock:low ONCE per transition
function maybeFireStockAlerts(product, previousStock) {
    const threshold = thresholdFor(product);
    const stock = Number(product.stock) || 0;

    if (stock === 0 && previousStock > 0) {
        activity.stockOut(product).catch(() => { });
        return;
    }

    if (stock > 0 && stock <= threshold && previousStock > threshold) {
        activity.stockLow(product, threshold).catch(() => { });
    }
}

// Add derived fields: discountPct, lowStockThreshold, stockStatus
function withComputed(p) {
    const price = Number(p.price) || 0;
    const mrp = Number(p.mrp) || 0;

    const discountPct = (mrp > price && mrp > 0)
        ? Math.round(((mrp - price) / mrp) * 100)
        : 0;

    const threshold = thresholdFor(p);
    const stock = Number(p.stock) || 0;

    const stockStatus =
        stock <= 0 ? 'out' :
            stock <= threshold ? 'low' : 'ok';

    return {
        ...p,
        discountPct,
        lowStockThreshold: threshold,
        stockStatus
    };
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

// Log stock:changed + fire alerts when stock actually changed
function logStockChange(product, previousStock) {
    const newStock = Number(product.stock) || 0;
    if (newStock === previousStock) return;

    activity.stockChanged(product, newStock - previousStock, newStock).catch(() => { });
    maybeFireStockAlerts(product, previousStock);
}


/* =========================================================
   GET /api/products — public list + filters + sort
   ========================================================= */
router.get('/', (req, res) => {
    try {
        let list = readProducts();
        const totalUnfiltered = list.length;

        /* ---- Search (name / brand / category / subcategory) ---- */
        if (req.query.q) {
            const q = String(req.query.q).toLowerCase().trim();

            list = list.filter(p =>
                (p.name || '').toLowerCase().includes(q) ||
                (p.brand || '').toLowerCase().includes(q) ||
                (p.category || '').toLowerCase().includes(q) ||
                (p.subcategory || '').toLowerCase().includes(q)
            );
        }

        /* ---- Category ---- */
        if (req.query.category && req.query.category !== 'all') {
            const cat = String(req.query.category).toLowerCase();
            list = list.filter(p => p.category === cat);
        }

        /* ---- Brand ---- */
        if (req.query.brand && req.query.brand !== 'all') {
            const brand = String(req.query.brand);
            list = list.filter(p => p.brand === brand);
        }

        /* ---- Tag ---- */
        if (req.query.tag) {
            const tag = String(req.query.tag);
            list = list.filter(p => Array.isArray(p.tags) && p.tags.includes(tag));
        }

        /* ---- Min rating ---- */
        if (req.query.minRating) {
            const min = Number(req.query.minRating);
            if (Number.isFinite(min)) {
                list = list.filter(p => Number(p.rating) >= min);
            }
        }

        /* ---- Max price ---- */
        if (req.query.priceMax) {
            const max = Number(req.query.priceMax);
            if (Number.isFinite(max)) {
                list = list.filter(p => Number(p.price) <= max);
            }
        }

        /* ---- Low-stock-only ---- */
        if (req.query.lowStock === '1') {
            list = list.filter(p => (Number(p.stock) || 0) <= thresholdFor(p));
        }

        /* ---- Sorters ---- */
        const hasTag = (p, tag) => Array.isArray(p.tags) && p.tags.includes(tag);

        const sorters = {
            'price-asc': (a, b) => a.price - b.price,
            'price-desc': (a, b) => b.price - a.price,
            'rating': (a, b) => b.rating - a.rating,
            'stock-asc': (a, b) => (a.stock || 0) - (b.stock || 0),
            'name': (a, b) => String(a.name).localeCompare(String(b.name)),
            'new': (a, b) => (hasTag(b, 'new') ? 1 : 0) - (hasTag(a, 'new') ? 1 : 0),
            'discount': (a, b) => withComputed(b).discountPct - withComputed(a).discountPct,
            'featured': (a, b) => (hasTag(b, 'featured') ? 1 : 0) - (hasTag(a, 'featured') ? 1 : 0)
        };

        list.sort(sorters[String(req.query.sort || 'featured')] || sorters.featured);

        /* ---- Paginate ---- */
        const total = list.length;
        const { limit, offset } = pagination(req);
        const page = list.slice(offset, offset + limit).map(withComputed);

        res.json({
            ok: true,
            total,
            totalAll: totalUnfiltered,
            limit,
            offset,
            products: page
        });

    } catch (err) {
        console.error('[products/list]', err);
        res.status(500).json({ ok: false, error: 'Failed to load products' });
    }
});


/* =========================================================
   GET /api/products/:id — public single fetch
   ========================================================= */
router.get('/:id', (req, res) => {
    try {
        const product = readProducts().find(p => p.id === req.params.id);

        if (!product) {
            return res.status(404).json({ ok: false, error: 'Product not found' });
        }

        res.json({ ok: true, product: withComputed(product) });

    } catch (err) {
        console.error('[products/get]', err);
        res.status(500).json({ ok: false, error: 'Failed to load product' });
    }
});


/* =========================================================
   POST /api/products — admin create
   ========================================================= */
router.post('/', auth.requireAdmin, async (req, res) => {
    try {
        /* ---- 1. Validate (full product) ---- */
        const v = validate.product(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        /* ---- 2. Build record ---- */
        const now = new Date().toISOString();

        const product = {
            id: ids.productId(),
            ...v.value,
            createdAt: now,
            updatedAt: now
        };

        // Ensure required collections exist
        if (!Array.isArray(product.images)) product.images = [];
        if (!Array.isArray(product.tags)) product.tags = [];
        if (!Array.isArray(product.features)) product.features = [];
        if (!product.specifications) product.specifications = {};

        /* ---- 3. Append ---- */
        await store.mutate(PRODUCTS_FILE, list => {
            if (!Array.isArray(list)) list = [];
            list.push(product);
            return list;
        });

        /* ---- 4. Activity ---- */
        activity.productCreated(product).catch(() => { });

        const stock = Number(product.stock) || 0;
        const threshold = thresholdFor(product);

        if (stock === 0) {
            activity.stockOut(product).catch(() => { });
        } else if (stock <= threshold) {
            activity.stockLow(product, threshold).catch(() => { });
        }

        res.status(201).json({ ok: true, product: withComputed(product) });

    } catch (err) {
        console.error('[products/create]', err);
        res.status(500).json({ ok: false, error: 'Could not create product' });
    }
});


/* =========================================================
   PUT /api/products/:id — admin update (PARTIAL MERGE)

   FIX: validates with { partial: true } so admin edits
   don't wipe fields the form doesn't send (like specs).
   ========================================================= */
router.put('/:id', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        /* ---- 1. Validate as PARTIAL ---- */
        const v = validate.product(req.body, { partial: true });
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }
        if (Object.keys(v.value).length === 0) {
            return res.status(400).json({ ok: false, error: 'No fields to update' });
        }

        /* ---- 2. Find existing ---- */
        const existing = readProducts().find(p => p.id === id);
        if (!existing) {
            return res.status(404).json({ ok: false, error: 'Product not found' });
        }

        const previousStock = Number(existing.stock) || 0;

        /* ---- 3. Merge — missing fields keep their old values ---- */
        const updated = {
            ...existing,
            ...v.value,
            id,
            createdAt: existing.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        /* ---- 4. Persist ---- */
        await store.mutate(PRODUCTS_FILE, list => {
            const idx = list.findIndex(p => p && p.id === id);
            if (idx !== -1) list[idx] = updated;
            return list;
        });

        /* ---- 5. Log + alerts ---- */
        activity.productUpdated(updated, 'updated').catch(() => { });
        logStockChange(updated, previousStock);

        res.json({ ok: true, product: withComputed(updated) });

    } catch (err) {
        console.error('[products/update]', err);
        res.status(500).json({ ok: false, error: 'Could not update product' });
    }
});


/* =========================================================
   PATCH /api/products/:id — admin partial update
   (same as PUT but with a different activity label)
   ========================================================= */
router.patch('/:id', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        /* ---- 1. Validate (partial mode) ---- */
        const v = validate.product(req.body, { partial: true });
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }
        if (Object.keys(v.value).length === 0) {
            return res.status(400).json({ ok: false, error: 'No fields to update' });
        }

        /* ---- 2. Find existing ---- */
        const existing = readProducts().find(p => p.id === id);
        if (!existing) {
            return res.status(404).json({ ok: false, error: 'Product not found' });
        }

        const previousStock = Number(existing.stock) || 0;

        /* ---- 3. Merge ---- */
        const updated = {
            ...existing,
            ...v.value,
            id,
            updatedAt: new Date().toISOString()
        };

        /* ---- 4. Persist ---- */
        await store.mutate(PRODUCTS_FILE, list => {
            const idx = list.findIndex(p => p && p.id === id);
            if (idx !== -1) list[idx] = updated;
            return list;
        });

        /* ---- 5. Log + alerts ---- */
        activity.productUpdated(updated, 'edited').catch(() => { });
        logStockChange(updated, previousStock);

        res.json({ ok: true, product: withComputed(updated) });

    } catch (err) {
        console.error('[products/patch]', err);
        res.status(500).json({ ok: false, error: 'Could not update product' });
    }
});


/* =========================================================
   PATCH /api/products/:id/stock — adjust stock
   Body (one of):
     { "delta": -5 }   → decrement (clamped at 0)
     { "delta": 10 }   → increment
     { "set": 42 }     → set to exactly 42
   ========================================================= */
router.patch('/:id/stock', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        /* ---- 1. Validate ---- */
        const v = validate.stockAdjustment(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        /* ---- 2. Find existing ---- */
        const existing = readProducts().find(p => p.id === id);
        if (!existing) {
            return res.status(404).json({ ok: false, error: 'Product not found' });
        }

        const previousStock = Number(existing.stock) || 0;

        /* ---- 3. Compute new stock ---- */
        let newStock;

        if (v.value.mode === 'set') {
            newStock = v.value.value;
        } else {
            newStock = Math.max(0, previousStock + v.value.value);
        }

        // If nothing changed, return noop
        if (newStock === previousStock) {
            return res.json({
                ok: true,
                product: withComputed(existing),
                noop: true
            });
        }

        /* ---- 4. Merge + persist ---- */
        const updated = {
            ...existing,
            stock: newStock,
            updatedAt: new Date().toISOString()
        };

        await store.mutate(PRODUCTS_FILE, list => {
            const idx = list.findIndex(p => p && p.id === id);
            if (idx !== -1) list[idx] = updated;
            return list;
        });

        /* ---- 5. Log + alerts ---- */
        activity.stockChanged(updated, newStock - previousStock, newStock).catch(() => { });
        maybeFireStockAlerts(updated, previousStock);

        res.json({ ok: true, product: withComputed(updated) });

    } catch (err) {
        console.error('[products/stock]', err);
        res.status(500).json({ ok: false, error: 'Could not adjust stock' });
    }
});


/* =========================================================
   DELETE /api/products/:id — admin remove
   ========================================================= */
router.delete('/:id', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        const existing = readProducts().find(p => p.id === id);
        if (!existing) {
            return res.status(404).json({ ok: false, error: 'Product not found' });
        }

        await store.mutate(PRODUCTS_FILE, list =>
            list.filter(p => p && p.id !== id)
        );

        activity.productDeleted(existing).catch(() => { });

        res.json({ ok: true, deletedId: id });

    } catch (err) {
        console.error('[products/delete]', err);
        res.status(500).json({ ok: false, error: 'Could not delete product' });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;