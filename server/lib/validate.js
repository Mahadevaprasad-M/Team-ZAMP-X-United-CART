'use strict';


/* =========================================================
   PRIMITIVES
   ========================================================= */

// Trim a value to a string. '' for null/undefined.
function str(v) {
    return String(v == null ? '' : v).trim();
}

// Coerce to number. NaN if not finite.
function num(v) {
    var n = (typeof v === 'number') ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : NaN;
}

// Coerce to integer.
function int(v) {
    var n = num(v);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

// Basic email shape check.
function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v));
}

// True for an array (even empty).
function isArray(v) {
    return Array.isArray(v);
}

// Coerce to a trimmed string array, dropping empties.
function strArray(v) {
    if (!isArray(v)) return [];

    var result = [];
    for (var i = 0; i < v.length; i++) {
        var s = str(v[i]);
        if (s.length > 0) result.push(s);
    }
    return result;
}


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */
function ok(value) {
    return { ok: true, value: value };
}

function fail(error, field) {
    var out = { ok: false, error: error };
    if (field) out.field = field;
    return out;
}


/* =========================================================
   AUTH
   ========================================================= */

// Login: { email, password }
function login(body) {
    body = body || {};

    var email = str(body.email).toLowerCase();
    var password = String(body.password == null ? '' : body.password);

    if (!email) return fail('Email is required', 'email');
    if (!isEmail(email)) return fail('Enter a valid email address', 'email');
    if (!password) return fail('Password is required', 'password');

    return ok({ email: email, password: password });
}

// Register: { name, email, password }
function register(body) {
    body = body || {};

    var name = str(body.name);
    var email = str(body.email).toLowerCase();
    var password = String(body.password == null ? '' : body.password);

    if (name.length < 2) return fail('Please enter your full name', 'name');
    if (name.length > 60) return fail('Name is too long (max 60 characters)', 'name');
    if (!isEmail(email)) return fail('Enter a valid email address', 'email');
    if (password.length < 6) return fail('Password must be at least 6 characters', 'password');
    if (!password.trim()) return fail('Password cannot be only spaces', 'password');
    if (password.length > 200) return fail('Password is too long', 'password');

    return ok({ name: name, email: email, password: password });
}


/* =========================================================
   PRODUCTS
   ========================================================= */

// Legacy allow-list — kept for backwards compatibility only.
var ALLOWED_TAGS = ['featured', 'bestseller', 'new', 'sale'];

// Any lowercase letters, numbers, dashes — 1 to 24 chars.
var TAG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

function isSafeTag(tag) {
    return TAG_RE.test(String(tag || ''));
}

// Product body — POST (create) and PUT (update).
// opts.partial — allow partial fields (PATCH)
function product(body, opts) {
    body = body || {};
    if (opts === undefined) opts = {};

    var partial = !!opts.partial;
    var out = {};

    /* Name */
    if (!partial || body.name !== undefined) {
        var name = str(body.name);
        if (name.length < 2) return fail('Product name is required', 'name');
        if (name.length > 150) return fail('Product name is too long', 'name');
        out.name = name;
    }

    /* Category */
    if (!partial || body.category !== undefined) {
        var category = str(body.category).toLowerCase();
        if (!category) return fail('Category is required', 'category');
        out.category = category;
    }

    /* Subcategory (optional) */
    if (body.subcategory !== undefined) {
        out.subcategory = str(body.subcategory).toLowerCase();
    } else if (!partial) {
        out.subcategory = '';
    }

    /* Brand */
    if (!partial || body.brand !== undefined) {
        var brand = str(body.brand);
        if (!brand) return fail('Brand is required', 'brand');
        out.brand = brand;
    }

    /* Price */
    if (!partial || body.price !== undefined) {
        var price = num(body.price);
        if (!Number.isFinite(price) || price <= 0) {
            return fail('Price must be a positive number', 'price');
        }
        if (price > 100000000) return fail('Price seems too high', 'price');
        out.price = Math.round(price * 100) / 100;
    }

    /* MRP */
    if (!partial || body.mrp !== undefined) {
        var mrp = num(body.mrp);
        if (!Number.isFinite(mrp) || mrp <= 0) {
            return fail('MRP must be a positive number', 'mrp');
        }
        out.mrp = Math.round(mrp * 100) / 100;
    }

    /* Cross-field: MRP >= price */
    if (out.price !== undefined && out.mrp !== undefined && out.mrp < out.price) {
        return fail('MRP cannot be lower than the selling price', 'mrp');
    }

    /* Cost (optional, for profit analytics) */
    if (body.cost !== undefined) {
        var cost = num(body.cost);
        if (Number.isFinite(cost) && cost >= 0) {
            out.cost = Math.round(cost * 100) / 100;
        }
    }

    /* Stock */
    if (!partial || body.stock !== undefined) {
        var stock = int(body.stock);
        if (!Number.isFinite(stock) || stock < 0) {
            return fail('Stock must be zero or a positive whole number', 'stock');
        }
        out.stock = stock;
    }

    /* Low-stock threshold (optional) */
    if (body.lowStockThreshold !== undefined) {
        var t = int(body.lowStockThreshold);
        if (Number.isFinite(t) && t >= 0) out.lowStockThreshold = t;
    }

    /* Rating + ratingCount (seed-only) */
    if (body.rating !== undefined) {
        var r = num(body.rating);
        if (Number.isFinite(r)) out.rating = Math.max(0, Math.min(5, r));
    }
    if (body.ratingCount !== undefined) {
        var rc = int(body.ratingCount);
        if (Number.isFinite(rc) && rc >= 0) out.ratingCount = rc;
    }

    /* Images */
    if (body.images !== undefined) {
        out.images = strArray(body.images);
    } else if (!partial) {
        out.images = [];
    }

    /* Tags — allow any safe tag (lowercase letters, numbers, dashes) */
    if (body.tags !== undefined) {
        var rawTags = strArray(body.tags);
        var safeTags = [];
        for (var ti = 0; ti < rawTags.length; ti++) {
            var lowered = rawTags[ti].toLowerCase();
            if (isSafeTag(lowered)) safeTags.push(lowered);
        }
        out.tags = safeTags;
    } else if (!partial) {
        out.tags = [];
    }

    /* Features */
    if (body.features !== undefined) {
        out.features = strArray(body.features);
    } else if (!partial) {
        out.features = [];
    }

    /* Specifications (plain object) */
    if (body.specifications !== undefined) {
        var spec = body.specifications;

        if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
            var cleaned = {};
            var specKeys = Object.keys(spec);
            for (var si = 0; si < specKeys.length; si++) {
                var key = str(specKeys[si]);
                if (key) cleaned[key] = str(spec[specKeys[si]]);
            }
            out.specifications = cleaned;
        } else {
            out.specifications = {};
        }
    } else if (!partial) {
        out.specifications = {};
    }

    /* Description */
    if (body.description !== undefined) {
        var d = str(body.description);
        if (d.length > 2000) return fail('Description is too long', 'description');
        out.description = d;
    } else if (!partial) {
        out.description = '';
    }

    return ok(out);
}

// Stock adjustment — { delta } OR { set }
function stockAdjustment(body) {
    body = body || {};

    if (body.set !== undefined) {
        var setVal = int(body.set);
        if (!Number.isFinite(setVal) || setVal < 0) {
            return fail('Stock must be zero or greater', 'set');
        }
        return ok({ mode: 'set', value: setVal });
    }

    if (body.delta !== undefined) {
        var delta = int(body.delta);
        if (!Number.isFinite(delta) || delta === 0) {
            return fail('Delta must be a non-zero whole number', 'delta');
        }
        if (Math.abs(delta) > 100000) {
            return fail('Delta is too large', 'delta');
        }
        return ok({ mode: 'delta', value: delta });
    }

    return fail('Provide either "delta" or "set"', 'delta');
}


/* =========================================================
   ORDERS
   ========================================================= */

var ALLOWED_ORDER_STATUSES = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];

// Order body — POST /api/orders (checkout).
function order(body) {
    body = body || {};

    /* Items */
    if (!isArray(body.items) || body.items.length === 0) {
        return fail('Cart is empty', 'items');
    }

    var items = [];

    for (var i = 0; i < body.items.length; i++) {
        var raw = body.items[i];
        if (!raw || typeof raw !== 'object') continue;

        var productId = str(raw.productId || raw.id);
        var qty = int(raw.qty);

        if (!productId) continue;
        if (!Number.isFinite(qty) || qty < 1) continue;
        if (qty > 999) return fail('Quantity too large (max 999)', 'items');

        items.push({ productId: productId, qty: qty });
    }

    if (items.length === 0) {
        return fail('No valid items in cart', 'items');
    }

    /* Address */
    var addr = body.address || {};
    var address = {
        name: str(addr.name),
        phone: str(addr.phone),
        line1: str(addr.line1),
        line2: str(addr.line2),
        city: str(addr.city),
        state: str(addr.state),
        pincode: str(addr.pincode)
    };

    if (!address.line1) return fail('Delivery address is required', 'address.line1');
    if (!address.city) return fail('City is required', 'address.city');

    /* Payment */
    var rawMethod = str((body.payment && body.payment.method) || 'COD').toUpperCase();
    var payment = {
        method: rawMethod,
        status: 'Pending'
    };

    if (['COD', 'UPI', 'CARD'].indexOf(payment.method) === -1) {
        payment.method = 'COD';
    }

    /* Notes */
    var notes = str(body.notes).slice(0, 500);

    return ok({ items: items, address: address, payment: payment, notes: notes });
}

// Order status update — { status }
function orderStatus(body) {
    body = body || {};
    var status = str(body.status);

    if (!status) return fail('Status is required', 'status');
    if (ALLOWED_ORDER_STATUSES.indexOf(status) === -1) {
        return fail('Status must be one of: ' + ALLOWED_ORDER_STATUSES.join(', '), 'status');
    }

    return ok({ status: status });
}


/* =========================================================
   REVIEWS
   ========================================================= */

// Review: { rating, title, text }
function review(body) {
    body = body || {};

    var rating = int(body.rating);
    var title = str(body.title).slice(0, 100);
    var text = str(body.text).slice(0, 1000);

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return fail('Rating must be between 1 and 5', 'rating');
    }
    if (title.length < 2) return fail('Please add a short title', 'title');
    if (text.length < 4) return fail('Review is a bit too short', 'text');

    return ok({ rating: rating, title: title, text: text });
}


/* =========================================================
   CATEGORIES
   ========================================================= */

function category(body) {
    body = body || {};

    var name = str(body.name);
    var icon = str(body.icon);
    var color = str(body.color) || '#f5f5f5';

    if (name.length < 2) return fail('Category name is required', 'name');
    if (name.length > 40) return fail('Category name is too long', 'name');

    return ok({ name: name, icon: icon, color: color });
}


/* =========================================================
   SETTINGS
   ========================================================= */

function settings(body) {
    body = body || {};
    var out = {};

    if (body.storeName !== undefined) {
        var n1 = str(body.storeName);
        if (!n1) return fail('Store name cannot be empty', 'storeName');
        out.storeName = n1.slice(0, 80);
    }

    if (body.currency !== undefined) {
        var c = str(body.currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) return fail('Currency must be a 3-letter code', 'currency');
        out.currency = c;
    }

    if (body.freeShippingThreshold !== undefined) {
        var n2 = num(body.freeShippingThreshold);
        if (!Number.isFinite(n2) || n2 < 0) return fail('Threshold must be ≥ 0', 'freeShippingThreshold');
        out.freeShippingThreshold = n2;
    }

    if (body.shippingFee !== undefined) {
        var n3 = num(body.shippingFee);
        if (!Number.isFinite(n3) || n3 < 0) return fail('Shipping fee must be ≥ 0', 'shippingFee');
        out.shippingFee = n3;
    }

    if (body.defaultLowStockThreshold !== undefined) {
        var n4 = int(body.defaultLowStockThreshold);
        if (!Number.isFinite(n4) || n4 < 0) return fail('Threshold must be ≥ 0', 'defaultLowStockThreshold');
        out.defaultLowStockThreshold = n4;
    }

    if (body.taxPercent !== undefined) {
        var n5 = num(body.taxPercent);
        if (!Number.isFinite(n5) || n5 < 0 || n5 > 100) return fail('Tax must be 0–100', 'taxPercent');
        out.taxPercent = n5;
    }

    if (body.lowStockAlertsEnabled !== undefined) {
        out.lowStockAlertsEnabled = !!body.lowStockAlertsEnabled;
    }

    return ok(out);
}


/* =========================================================
   EXPORTS
   ========================================================= */
module.exports = {
    /* Primitives */
    str: str,
    num: num,
    int: int,
    isEmail: isEmail,
    isArray: isArray,
    strArray: strArray,

    /* Response helpers */
    ok: ok,
    fail: fail,

    /* Validators */
    login: login,
    register: register,
    product: product,
    stockAdjustment: stockAdjustment,
    order: order,
    orderStatus: orderStatus,
    review: review,
    category: category,
    settings: settings,

    /* Constants */
    ALLOWED_TAGS: ALLOWED_TAGS,
    ALLOWED_ORDER_STATUSES: ALLOWED_ORDER_STATUSES,
    isSafeTag: isSafeTag
};