'use strict';

const express = require('express');

const store = require('../lib/store');
const ids = require('../lib/ids');
const validate = require('../lib/validate');
const activity = require('../lib/activity');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const REVIEWS_FILE = 'reviews.json';
const PRODUCTS_FILE = 'products.json';
const MAX_PER_PRODUCT = 500;


/* ============ HELPERS ============ */

// Read reviews store — always return a plain object
function readReviews() {
    const raw = store.read(REVIEWS_FILE);
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

// Read products — always return an array
function readProducts() {
    const raw = store.read(PRODUCTS_FILE);
    return Array.isArray(raw) ? raw : [];
}

// Does this product exist?
function productExists(productId) {
    if (!productId) return false;
    return readProducts().some(p => p && p.id === productId);
}

// Sanitize a review entry (protects against bad data)
function normalizeReview(r) {
    if (!r || typeof r !== 'object') return null;

    return {
        id: typeof r.id === 'string' ? r.id : null,
        userId: typeof r.userId === 'string' ? r.userId : null,
        user: typeof r.user === 'string' ? r.user : 'Anonymous',
        rating: Number.isFinite(+r.rating)
            ? Math.max(1, Math.min(5, Math.floor(+r.rating)))
            : 5,
        title: typeof r.title === 'string' ? r.title : '',
        text: typeof r.text === 'string' ? r.text : '',
        date: typeof r.date === 'string' ? r.date : ''
    };
}

// Ensure value is a plain object (used inside mutate)
function asObject(raw) {
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}


/* =========================================================
   GET /api/reviews/:productId
   Public. All reviews for one product, newest first.
   ========================================================= */
router.get('/:productId', (req, res) => {
    try {
        const productId = String(req.params.productId || '').trim();

        /* ---- 1. Basic validation ---- */
        if (!productId) {
            return res.status(400).json({ ok: false, error: 'Product id is required' });
        }
        if (!productExists(productId)) {
            return res.status(404).json({ ok: false, error: 'Product not found' });
        }

        /* ---- 2. Load + clean + sort ---- */
        const all = readReviews();
        const list = Array.isArray(all[productId]) ? all[productId] : [];

        const cleaned = list
            .map(normalizeReview)
            .filter(Boolean)
            .sort((a, b) => {
                // Newest date first
                if (a.date !== b.date) {
                    return String(b.date).localeCompare(String(a.date));
                }
                // Tie-break on id
                return String(b.id || '').localeCompare(String(a.id || ''));
            });

        /* ---- 3. Respond ---- */
        res.json({
            ok: true,
            productId,
            count: cleaned.length,
            reviews: cleaned
        });

    } catch (err) {
        console.error('[reviews/get]', err);
        res.status(500).json({ ok: false, error: 'Failed to load reviews' });
    }
});


/* =========================================================
   POST /api/reviews/:productId
   Login required. Adds a review.

   Body: { rating, title, text }

   Errors:
     400 — invalid rating / title / text
     404 — product doesn't exist
     409 — user already reviewed this product
     503 — product is at MAX_PER_PRODUCT reviews
   ========================================================= */
router.post('/:productId', auth.requireAuth, async (req, res) => {
    try {
        const productId = String(req.params.productId || '').trim();

        /* ---- 1. Product must exist ---- */
        if (!productId) {
            return res.status(400).json({ ok: false, error: 'Product id is required' });
        }
        if (!productExists(productId)) {
            return res.status(404).json({ ok: false, error: 'Product not found' });
        }

        /* ---- 2. Validate body ---- */
        const v = validate.review(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        const { rating, title, text } = v.value;

        /* ---- 3. Build review entry ---- */
        const entry = {
            id: ids.reviewId(),
            userId: req.user.id,
            user: req.user.name || 'Anonymous',
            rating,
            title,
            text,
            date: new Date().toISOString().split('T')[0]   // YYYY-MM-DD
        };

        /* ---- 4. Append atomically (duplicate + cap checked inside) ---- */
        let conflict = null;
        let tooMany = false;

        await store.mutate(REVIEWS_FILE, raw => {
            const list = asObject(raw);

            if (!Array.isArray(list[productId])) list[productId] = [];

            // Duplicate check: one review per user per product
            const already = list[productId].some(r =>
                r && r.userId && r.userId === req.user.id
            );
            if (already) {
                conflict = 'You have already reviewed this product';
                return list;
            }

            // Cap check
            if (list[productId].length >= MAX_PER_PRODUCT) {
                tooMany = true;
                return list;
            }

            list[productId].push(entry);
            return list;
        });

        if (conflict) {
            return res.status(409).json({ ok: false, error: conflict });
        }
        if (tooMany) {
            return res.status(503).json({
                ok: false,
                error: 'This product has too many reviews. Try again later.'
            });
        }

        /* ---- 5. Log activity (fire & forget) ---- */
        activity.log({
            type: 'review:new',
            message: `${req.user.name} reviewed a product (${rating}★)`,
            meta: { productId, userId: req.user.id, rating },
            actor: 'customer:' + req.user.id
        }).catch(() => { });

        /* ---- 6. Respond ---- */
        res.status(201).json({ ok: true, review: entry });

    } catch (err) {
        console.error('[reviews/post]', err);
        res.status(500).json({
            ok: false,
            error: 'Could not save your review. Please try again.'
        });
    }
});


/* =========================================================
   DELETE /api/reviews/:productId/:reviewId
   Allowed for: admin (any) or the review's author (own).

   Errors:
     403 — not admin, not owner
     404 — review not found
   ========================================================= */
router.delete('/:productId/:reviewId', auth.requireAuth, async (req, res) => {
    try {
        const productId = String(req.params.productId || '').trim();
        const reviewId = String(req.params.reviewId || '').trim();

        /* ---- 1. Basic validation ---- */
        if (!productId || !reviewId) {
            return res.status(400).json({
                ok: false,
                error: 'Product id and review id are required'
            });
        }

        /* ---- 2. Find the review ---- */
        const all = readReviews();
        const list = Array.isArray(all[productId]) ? all[productId] : [];
        const target = list.find(r => r && r.id === reviewId);

        if (!target) {
            return res.status(404).json({ ok: false, error: 'Review not found' });
        }

        /* ---- 3. Permission: admin OR owner ---- */
        const isAdmin = req.user && req.user.role === 'admin';
        const isOwner = target.userId && target.userId === req.user.id;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({
                ok: false,
                error: 'You do not have permission to delete this review'
            });
        }

        /* ---- 4. Remove atomically ---- */
        await store.mutate(REVIEWS_FILE, raw => {
            const list = asObject(raw);
            if (!Array.isArray(list[productId])) return list;

            list[productId] = list[productId].filter(r => !r || r.id !== reviewId);
            return list;
        });

        /* ---- 5. Log activity ---- */
        activity.log({
            type: 'review:deleted',
            message: `Review deleted on ${productId}`,
            meta: { productId, reviewId, by: req.user.id },
            actor: isAdmin ? 'admin' : ('customer:' + req.user.id)
        }).catch(() => { });

        /* ---- 6. Respond ---- */
        res.json({ ok: true, deletedId: reviewId });

    } catch (err) {
        console.error('[reviews/delete]', err);
        res.status(500).json({ ok: false, error: 'Could not delete review' });
    }
});


/* ============ EXPORTS ============ */
module.exports = router;