'use strict';


/* =========================================================
   INTERNAL HELPERS
   ========================================================= */

// Timestamp in base36, uppercase — e.g. "LX4K2A".
function stamp() {
    return Date.now().toString(36).toUpperCase();
}

// Random string of N base36 chars (default 4 ≈ 1.6M combos).
function rand(n) {
    if (n === undefined) n = 4;

    var out = '';
    while (out.length < n) {
        out += Math.random().toString(36).slice(2).toUpperCase();
    }
    return out.slice(0, n);
}

// Monotonic counter — guarantees uniqueness within the same ms.
var counter = 0;

function nextCounter() {
    counter = (counter + 1) % 100000;
    return counter.toString(36).toUpperCase().padStart(3, '0');
}


/* =========================================================
   PUBLIC GENERATORS
   ========================================================= */

// Order ID — PXC-XXXXXX-XXXX   (e.g. PXC-LX4K2A-7F3Q)
function orderId() {
    return 'PXC-' + stamp() + '-' + rand(4);
}

// User ID — u_xxxxxxx   (customer or admin)
function userId() {
    return 'u_' + stamp().toLowerCase() + rand(4).toLowerCase();
}

// Product ID / SKU — p_xxxxxxx
function productId() {
    return 'p_' + stamp().toLowerCase() + rand(4).toLowerCase();
}

// Category ID — slug-xxxx   (e.g. "electronics-7f3q")
function categoryId(name) {
    if (name === undefined) name = 'category';

    var slug = String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24);

    if (!slug) slug = 'category';

    return slug + '-' + rand(3).toLowerCase();
}

// Address ID — addr_xxxxxxx
function addressId() {
    return 'addr_' + stamp().toLowerCase() + rand(4).toLowerCase();
}

// Notification ID — n_xxxxxxx
function notificationId() {
    return 'n_' + stamp().toLowerCase() + rand(4).toLowerCase();
}

// Activity log entry ID — evt_xxxxxxx
function eventId() {
    return 'evt_' + stamp().toLowerCase() + rand(4).toLowerCase();
}

// Review ID — rev_xxxxxxx
function reviewId() {
    return 'rev_' + stamp().toLowerCase() + rand(4).toLowerCase();
}

// Generic fallback — <prefix>_xxxxxxx
function custom(prefix) {
    if (prefix === undefined) prefix = 'id';

    return String(prefix).replace(/_$/, '') + '_' +
        stamp().toLowerCase() + rand(4).toLowerCase();
}

// Short human code — 6 uppercase chars (e.g. "7F3QK2").
function shortCode(len) {
    if (len === undefined) len = 6;
    return rand(len).toUpperCase();
}


/* =========================================================
   EXPORTS
   ========================================================= */
module.exports = {
    orderId: orderId,
    userId: userId,
    productId: productId,
    categoryId: categoryId,
    addressId: addressId,
    notificationId: notificationId,
    eventId: eventId,
    reviewId: reviewId,
    custom: custom,
    shortCode: shortCode
};