'use strict';

const express = require('express');

const store = require('../lib/store');
const ids = require('../lib/ids');
const validate = require('../lib/validate');
const activity = require('../lib/activity');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const SETTINGS_FILE = 'settings.json';
const CATEGORIES_FILE = 'categories.json';
const PRODUCTS_FILE = 'products.json';

const DEFAULT_SETTINGS = {
    storeName: 'TeamZampXUnited',
    currency: 'INR',
    freeShippingThreshold: 499,
    shippingFee: 49,
    defaultLowStockThreshold: 10,
    taxPercent: 0,
    lowStockAlertsEnabled: true
};


/* ============ HELPERS ============ */

// Settings merged on top of defaults
function readSettings() {
    const raw = store.read(SETTINGS_FILE);
    return { ...DEFAULT_SETTINGS, ...(raw || {}) };
}

// Categories — always return an array
function readCategories() {
    const raw = store.read(CATEGORIES_FILE);
    return Array.isArray(raw) ? raw : [];
}


/* =========================================================
   GET /api/settings
   Current settings (merged with defaults) + full category list.
   ========================================================= */
router.get('/', auth.requireAdmin, (_req, res) => {
    try {
        res.json({
            ok: true,
            settings: readSettings(),
            categories: readCategories()
        });

    } catch (err) {
        console.error('[settings/get]', err);
        res.status(500).json({ ok: false, error: 'Failed to load settings' });
    }
});


/* =========================================================
   PUT /api/settings
   Partial update — only fields present in the body change.
   ========================================================= */
router.put('/', auth.requireAdmin, async (req, res) => {
    try {
        /* ---- 1. Validate ---- */
        const v = validate.settings(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        const updates = v.value;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ ok: false, error: 'No fields to update' });
        }

        /* ---- 2. Merge with current + persist ---- */
        const current = readSettings();

        const merged = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await store.write(SETTINGS_FILE, merged);

        /* ---- 3. Activity log (fire & forget) ---- */
        activity.settingsUpdated(updates).catch(() => { });

        /* ---- 4. Respond ---- */
        res.json({ ok: true, settings: merged });

    } catch (err) {
        console.error('[settings/put]', err);
        res.status(500).json({ ok: false, error: 'Could not save settings' });
    }
});


/* =========================================================
   POST /api/settings/categories
   Add a category. Rejects duplicates (case-insensitive).
   ========================================================= */
router.post('/categories', auth.requireAdmin, async (req, res) => {
    try {
        /* ---- 1. Validate ---- */
        const v = validate.category(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        const { name, icon, color } = v.value;

        /* ---- 2. Duplicate check (case-insensitive) ---- */
        const categories = readCategories();

        const exists = categories.some(c =>
            String(c.name || '').toLowerCase() === name.toLowerCase()
        );

        if (exists) {
            return res.status(409).json({
                ok: false,
                error: 'A category with this name already exists',
                field: 'name'
            });
        }

        /* ---- 3. Build + persist ---- */
        const category = {
            id: ids.categoryId(name),
            name,
            icon,
            color
        };

        await store.mutate(CATEGORIES_FILE, list => {
            if (!Array.isArray(list)) list = [];
            list.push(category);
            return list;
        });

        /* ---- 4. Activity log ---- */
        activity.log({
            type: 'category:new',
            message: 'Category added: ' + name,
            meta: { categoryId: category.id },
            actor: 'admin'
        }).catch(() => { });

        /* ---- 5. Respond ---- */
        res.status(201).json({
            ok: true,
            category,
            categories: readCategories()
        });

    } catch (err) {
        console.error('[settings/categories/post]', err);
        res.status(500).json({ ok: false, error: 'Could not add category' });
    }
});


/* =========================================================
   DELETE /api/settings/categories/:id
   Products in this category keep their category string —
   they become "uncategorized" on the alerts page.
   ========================================================= */
router.delete('/categories/:id', auth.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        /* ---- 1. Find the category ---- */
        const target = readCategories().find(c => c && c.id === id);

        if (!target) {
            return res.status(404).json({ ok: false, error: 'Category not found' });
        }

        /* ---- 2. Count affected products (informational) ---- */
        const products = store.read(PRODUCTS_FILE);

        const productCount = Array.isArray(products)
            ? products.filter(p => p && p.category === id).length
            : 0;

        /* ---- 3. Remove ---- */
        await store.mutate(CATEGORIES_FILE, list =>
            list.filter(c => c && c.id !== id)
        );

        /* ---- 4. Activity log ---- */
        activity.log({
            type: 'category:deleted',
            message: 'Category deleted: ' + target.name,
            meta: { categoryId: id, affectedProducts: productCount },
            actor: 'admin'
        }).catch(() => { });

        /* ---- 5. Respond ---- */
        res.json({
            ok: true,
            deletedId: id,
            affectedProducts: productCount,
            categories: readCategories()
        });

    } catch (err) {
        console.error('[settings/categories/delete]', err);
        res.status(500).json({ ok: false, error: 'Could not delete category' });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;