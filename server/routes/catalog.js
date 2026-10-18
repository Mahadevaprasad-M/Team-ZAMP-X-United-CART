'use strict';

const express = require('express');
const store = require('../lib/store');

const router = express.Router();


/* ============ HELPERS ============ */

// Read a JSON file, always return an array
function readList(file) {
    const raw = store.read(file);
    return Array.isArray(raw) ? raw : [];
}

// Read a JSON file, always return a plain object
function readObj(file) {
    const raw = store.read(file);
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}


/* =========================================================
   GET /api/catalog/all — full bundle for the storefront
   ========================================================= */
router.get('/all', (_req, res) => {
    try {
        // Cache for 5 seconds (fresh enough, saves bandwidth)
        res.set('Cache-Control', 'public, max-age=5');

        res.json({
            ok: true,
            products: readList('products.json'),
            categories: readList('categories.json'),
            banners: readObj('banners.json'),
            reviews: readObj('reviews.json'),
            version: new Date().toISOString()
        });

    } catch (err) {
        console.error('[catalog/all]', err);
        res.status(500).json({ ok: false, error: 'Failed to load catalog' });
    }
});


/* =========================================================
   GET /api/catalog/categories
   ========================================================= */
router.get('/categories', (_req, res) => {
    try {
        // Cache for 10 seconds
        res.set('Cache-Control', 'public, max-age=10');

        res.json({
            ok: true,
            categories: readList('categories.json')
        });

    } catch (err) {
        console.error('[catalog/categories]', err);
        res.status(500).json({ ok: false, error: 'Failed to load categories' });
    }
});


/* =========================================================
   GET /api/catalog/banners
   ========================================================= */
router.get('/banners', (_req, res) => {
    try {
        // Cache for 10 seconds
        res.set('Cache-Control', 'public, max-age=10');

        res.json({
            ok: true,
            banners: readObj('banners.json')
        });

    } catch (err) {
        console.error('[catalog/banners]', err);
        res.status(500).json({ ok: false, error: 'Failed to load banners' });
    }
});


/* =========================================================
   GET /api/catalog/reviews
   ========================================================= */
router.get('/reviews', (_req, res) => {
    try {
        // Cache for 10 seconds
        res.set('Cache-Control', 'public, max-age=10');

        res.json({
            ok: true,
            reviews: readObj('reviews.json')
        });

    } catch (err) {
        console.error('[catalog/reviews]', err);
        res.status(500).json({ ok: false, error: 'Failed to load reviews' });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;