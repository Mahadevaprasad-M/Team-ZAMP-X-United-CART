/* ---------- Safe JSON parse for localStorage values ---------- */
function _pxcSafeJSON(raw, fallback) {
    try {
        if (raw === null || raw === undefined || raw === '') return fallback;
        var parsed = JSON.parse(raw);
        if (parsed === null || parsed === undefined) return fallback;
        return parsed;
    } catch (err) {
        console.warn('[PXC] Corrupted localStorage value, resetting:', err);
        return fallback;
    }
}


/* =========================================================
   API HELPER
   Thin fetch wrapper with bearer-token auth.
   ========================================================= */
var PXC_API = {
    base: '',
    tokenKey: 'pxc_customer_token',

    getToken: function () {
        try { return localStorage.getItem(this.tokenKey) || ''; }
        catch (e) { return ''; }
    },

    setToken: function (t) {
        try {
            if (t) localStorage.setItem(this.tokenKey, t);
            else localStorage.removeItem(this.tokenKey);
        } catch (e) { }
    },

    request: async function (method, path, body) {
        var headers = { Accept: 'application/json' };
        var token = this.getToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;

        var payload;
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        var res = await fetch(this.base + path, {
            method: method,
            headers: headers,
            body: payload
        });

        var data = null;
        try { data = await res.json(); }
        catch (e) { }

        return { status: res.status, ok: res.ok, data: data || {} };
    }
};


var PXC = {

    /* =========================================================
       IN-MEMORY CATALOGUE (filled by load())
       ========================================================= */
    products: [],
    categories: [],
    banners: {},
    reviews: {},

    /* =========================================================
       PERSISTENT STATE
       ========================================================= */
    cart: _pxcSafeJSON(localStorage.getItem('pxc_cart'), []),
    wishlist: _pxcSafeJSON(localStorage.getItem('pxc_wishlist'), []),
    users: _pxcSafeJSON(localStorage.getItem('pxc_users'), []),
    user: _pxcSafeJSON(localStorage.getItem('pxc_session'), null),
    subscribers: _pxcSafeJSON(localStorage.getItem('pxc_subscribers'), []),
    orders: _pxcSafeJSON(localStorage.getItem('pxc_orders'), []),
    addresses: _pxcSafeJSON(localStorage.getItem('pxc_addresses'), []),
    userReviews: _pxcSafeJSON(localStorage.getItem('pxc_user_reviews'), {}),
    notifications: _pxcSafeJSON(localStorage.getItem('pxc_notifications'), []),
    recentlyViewed: _pxcSafeJSON(localStorage.getItem('pxc_recent'), []),

    /* =========================================================
       SHIPPING POLICY (single source of truth)
       ========================================================= */
    FREE_SHIPPING_THRESHOLD: 499,
    SHIPPING_FEE: 49,


    /* =========================================================
       BASIC HELPERS
       ========================================================= */
    fmt: function (price) {
        var n = Number(price);
        if (Number.isFinite(n)) return '₹' + n.toLocaleString('en-IN');
        return '₹0';
    },

    discountPct: function (p) {
        if (!p || !p.mrp || p.mrp <= p.price) return 0;
        return Math.round(((p.mrp - p.price) / p.mrp) * 100);
    },

    shippingFor: function (subtotal) {
        var s = Number(subtotal) || 0;
        if (s <= 0) return 0;
        return s > this.FREE_SHIPPING_THRESHOLD ? 0 : this.SHIPPING_FEE;
    },

    _persist: function (key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('[PXC] Could not save', key, e);
        }
    },


    /* =========================================================
       PASSWORD HASHING (local fallback mode only)
       ========================================================= */
    _randomSalt: function () {
        var arr = new Uint8Array(16);
        if (window.crypto && crypto.getRandomValues) {
            crypto.getRandomValues(arr);
        } else {
            for (var i = 0; i < 16; i++) {
                arr[i] = Math.floor(Math.random() * 256);
            }
        }

        var list = Array.from(arr);
        var hex = '';
        for (var j = 0; j < list.length; j++) {
            hex += list[j].toString(16).padStart(2, '0');
        }
        return hex;
    },

    _hashPassword: async function (password, salt) {
        var text = salt + '|' + password + '|TeamZampXUnited';
        var bytes = new TextEncoder().encode(text);

        // Preferred: SHA-256 via SubtleCrypto
        if (window.crypto && crypto.subtle && crypto.subtle.digest) {
            try {
                var buf = await crypto.subtle.digest('SHA-256', bytes);
                var byteArr = Array.from(new Uint8Array(buf));
                var hex = '';
                for (var i = 0; i < byteArr.length; i++) {
                    hex += byteArr[i].toString(16).padStart(2, '0');
                }
                return hex;
            } catch (e) { }
        }

        // Fallback: simple DJB2-ish hash
        var h = 5381;
        for (var j = 0; j < bytes.length; j++) {
            h = ((h << 5) + h + bytes[j]) | 0;
        }
        return 'fb_' + (h >>> 0).toString(16);
    },


    /* =========================================================
       LOAD DATA
       Tries 3 sources: live API → inline bundle → JSON files.
       ========================================================= */
    load: async function () {
        var onHttp = location.protocol === 'http:' || location.protocol === 'https:';

        /* ---------- 1. Live API ---------- */
        if (onHttp) {
            try {
                var res = await fetch('/api/catalog/all', {
                    headers: { Accept: 'application/json' }
                });

                if (res.ok) {
                    var data = await res.json();
                    if (data && data.ok) {
                        this._applyCatalog(data);
                        console.log('[PXC] Loaded from live API —',
                            this.products.length, 'products');
                        return this;
                    }
                }
            } catch (err) {
                console.warn('[PXC] Live API unavailable:', err.message);
            }
        }

        /* ---------- 2. Inline bundle ---------- */
        if (window.PXC_DATA && typeof window.PXC_DATA === 'object') {
            this._applyCatalog(window.PXC_DATA);
            console.log('[PXC] Loaded from inline bundle —',
                this.products.length, 'products');
            return this;
        }

        /* ---------- 3. Fetch JSON files ---------- */
        try {
            var prods = await tryFetch(['data/products.json', 'products.json']);
            var cats = await tryFetch(['data/categories.json', 'categories.json']);
            var bans = await tryFetch(['data/banners.json', 'banners.json']);
            var revs = await tryFetch(['data/reviews.json', 'reviews.json']);

            this._applyCatalog({
                products: (prods && prods.products) || [],
                categories: (cats && cats.categories) || [],
                banners: bans || {},
                reviews: revs || {}
            });

            console.log('[PXC] Loaded from JSON files —', this.products.length, 'products');
        } catch (err) {
            console.error('[PXC] Failed to load data:', err);
            this._applyCatalog({ products: [], categories: [], banners: {}, reviews: {} });
        }

        return this;
    },


    /* =========================================================
       INTERNAL: apply + normalize a data bundle
       ========================================================= */
    _applyCatalog: function (data) {
        this.products = Array.isArray(data.products) ? data.products : [];
        this.categories = Array.isArray(data.categories) ? data.categories : [];
        this.banners = data.banners || {};
        this.reviews = data.reviews || {};

        this._normalizeProducts();
        this._normalizeCategories();
        this._normalizeBanners();
        this._mergeUserReviews();
    },


    /* =========================================================
       NORMALIZATION
       ========================================================= */
    _normalizeProducts: function () {
        if (!Array.isArray(this.products)) {
            this.products = [];
            return;
        }

        var PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
            '<rect width="400" height="400" fill="#f4f4f4"/>' +
            '<text x="50%" y="50%" font-family="sans-serif" font-size="18" ' +
            'fill="#9ca3af" text-anchor="middle" dy=".35em">No image</text>' +
            '</svg>'
        );

        for (var i = 0; i < this.products.length; i++) {
            var p = this.products[i];
            if (!p || typeof p !== 'object') continue;

            if (!Array.isArray(p.tags)) p.tags = [];
            if (!Array.isArray(p.features)) p.features = [];

            // Non-empty array of valid image URLs
            var rawImgs = Array.isArray(p.images) ? p.images : [];
            var cleanImgs = [];
            for (var j = 0; j < rawImgs.length; j++) {
                var u = rawImgs[j];
                if (typeof u === 'string' && u.trim() !== '') {
                    cleanImgs.push(u);
                }
            }
            p.images = cleanImgs;
            if (p.images.length === 0) p.images = [PLACEHOLDER];

            // Plain object for specifications
            if (!p.specifications || typeof p.specifications !== 'object'
                || Array.isArray(p.specifications)) {
                p.specifications = {};
            }

            // Numeric fields
            var priceNum = Number(p.price);
            var mrpNum = Number(p.mrp);
            var rateNum = Number(p.rating);
            var rcNum = Number(p.ratingCount);
            var stockNum = Number(p.stock);

            p.price = (Number.isFinite(priceNum) && priceNum > 0) ? priceNum : 0;
            p.mrp = (Number.isFinite(mrpNum) && mrpNum > 0) ? mrpNum : p.price;
            p.rating = Number.isFinite(rateNum) ? Math.max(0, Math.min(5, rateNum)) : 0;
            p.ratingCount = (Number.isFinite(rcNum) && rcNum >= 0) ? Math.floor(rcNum) : 0;
            p.stock = (Number.isFinite(stockNum) && stockNum >= 0) ? Math.floor(stockNum) : 0;

            var lstNum = Number(p.lowStockThreshold);
            p.lowStockThreshold = Number.isFinite(lstNum) ? lstNum : 10;
        }
    },

    _normalizeCategories: function () {
        if (!Array.isArray(this.categories)) {
            this.categories = [];
            return;
        }
        for (var i = 0; i < this.categories.length; i++) {
            var c = this.categories[i];
            if (!c || typeof c !== 'object') continue;
            if (typeof c.id !== 'string') c.id = String(c.id || '');
            if (typeof c.name !== 'string') c.name = String(c.name || '');
            if (typeof c.icon !== 'string') c.icon = '';
            if (typeof c.color !== 'string') c.color = '#f5f5f5';
        }
    },

    _normalizeBanners: function () {
        if (!this.banners || typeof this.banners !== 'object') {
            this.banners = {};
            return;
        }
        var b = this.banners;

        if (!Array.isArray(b.hero)) b.hero = [];
        if (!Array.isArray(b.ads)) b.ads = [];
        if (!Array.isArray(b.brands)) b.brands = [];
        if (!Array.isArray(b.usps)) b.usps = [];

        var kinds = ['hero', 'ads'];
        var bannerFields = ['title', 'subtitle', 'image', 'link', 'cta', 'badge'];

        for (var ki = 0; ki < kinds.length; ki++) {
            var list = b[kinds[ki]];
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                if (!item || typeof item !== 'object') continue;
                for (var fi = 0; fi < bannerFields.length; fi++) {
                    var f = bannerFields[fi];
                    if (typeof item[f] !== 'string') item[f] = '';
                }
            }
        }

        if (b.offer && typeof b.offer === 'object') {
            var offerFields = ['title', 'subtitle', 'cta', 'link'];
            for (var oi = 0; oi < offerFields.length; oi++) {
                var of = offerFields[oi];
                if (typeof b.offer[of] !== 'string') b.offer[of] = '';
            }
        }
    },

    _mergeUserReviews: function () {
        var userRev = this.userReviews || {};
        var pids = Object.keys(userRev);

        for (var i = 0; i < pids.length; i++) {
            var pid = pids[i];
            if (!Array.isArray(userRev[pid])) continue;
            if (!Array.isArray(this.reviews[pid])) this.reviews[pid] = [];

            var entries = userRev[pid];
            for (var j = 0; j < entries.length; j++) {
                var r = entries[j];
                if (!r || typeof r !== 'object') continue;

                var key = (r.userId || '') + '|' + (r.user || '') + '|' +
                    (r.date || '') + '|' + (r.title || '');

                var exists = false;
                var existing = this.reviews[pid];
                for (var k = 0; k < existing.length; k++) {
                    var x = existing[k];
                    var xKey = (x.userId || '') + '|' + (x.user || '') + '|' +
                        (x.date || '') + '|' + (x.title || '');
                    if (xKey === key) { exists = true; break; }
                }

                if (!exists) this.reviews[pid].push(r);
            }
        }
    },


    /* =========================================================
       PRODUCT HELPERS
       ========================================================= */
    getProduct: function (id) {
        if (!id) return undefined;
        for (var i = 0; i < this.products.length; i++) {
            var p = this.products[i];
            if (p && p.id === id) return p;
        }
        return undefined;
    },

    search: function (query) {
        var q = String(query || '').toLowerCase().trim();
        if (!q) return this.products.slice();
        var results = [];
        for (var i = 0; i < this.products.length; i++) {
            var p = this.products[i];
            if (String(p.name).toLowerCase().indexOf(q) !== -1 ||
                String(p.brand).toLowerCase().indexOf(q) !== -1 ||
                String(p.category).toLowerCase().indexOf(q) !== -1 ||
                String(p.subcategory).toLowerCase().indexOf(q) !== -1) {
                results.push(p);
            }
        }
        return results;
    },


    /* =========================================================
       CART
       ========================================================= */
    addToCart: function (id, qty) {
        if (qty === undefined) qty = 1;
        if (!id) return;

        var item = null;
        for (var i = 0; i < this.cart.length; i++) {
            if (this.cart[i].id === id) { item = this.cart[i]; break; }
        }

        if (item) item.qty += qty;
        else this.cart.push({ id: id, qty: qty });

        this._saveCart();
    },

    removeFromCart: function (id) {
        var next = [];
        for (var i = 0; i < this.cart.length; i++) {
            if (this.cart[i].id !== id) next.push(this.cart[i]);
        }
        this.cart = next;
        this._saveCart();
    },

    updateQty: function (id, qty) {
        if (qty < 1) return this.removeFromCart(id);

        for (var i = 0; i < this.cart.length; i++) {
            if (this.cart[i].id === id) { this.cart[i].qty = qty; break; }
        }
        this._saveCart();
    },

    clearCart: function () {
        this.cart = [];
        this._saveCart();
    },

    cartCount: function () {
        var total = 0;
        for (var i = 0; i < this.cart.length; i++) {
            total += Number(this.cart[i].qty) || 0;
        }
        return total;
    },

    cartSubtotal: function () {
        var total = 0;
        for (var i = 0; i < this.cart.length; i++) {
            var item = this.cart[i];
            var p = this.getProduct(item.id);
            if (p) total += p.price * item.qty;
        }
        return total;
    },

    _saveCart: function () {
        this._persist('pxc_cart', this.cart);
        document.dispatchEvent(new CustomEvent('pxc:cart-update'));
    },


    /* =========================================================
       WISHLIST
       ========================================================= */
    toggleWishlist: function (id) {
        var idx = this.wishlist.indexOf(id);
        var added;

        if (idx === -1) {
            this.wishlist.push(id);
            added = true;
        } else {
            this.wishlist.splice(idx, 1);
            added = false;
        }

        this._persist('pxc_wishlist', this.wishlist);
        document.dispatchEvent(new CustomEvent('pxc:wishlist-update'));
        return added;
    },

    isWishlisted: function (id) { return this.wishlist.indexOf(id) !== -1; },
    wishlistCount: function () { return this.wishlist.length; },


    /* =========================================================
       REGISTER
       Server-first, falls back to local-only.
       ========================================================= */
    register: async function (name, email, password) {
        name = String(name || '').trim();
        email = String(email || '').trim().toLowerCase();

        if (!name || !email || !password) {
            return { ok: false, error: 'All fields are required.' };
        }
        if (password.length < 6) {
            return { ok: false, error: 'Password must be at least 6 characters.' };
        }

        var onHttp = location.protocol === 'http:' || location.protocol === 'https:';

        if (onHttp) {
            try {
                var res = await PXC_API.request('POST', '/api/auth/register', {
                    name: name, email: email, password: password
                });

                if (res.ok && res.data && res.data.ok) {
                    PXC_API.setToken(res.data.token);
                    var user = res.data.user;
                    this._startSession(user);
                    console.log('[PXC] Registered on server:', email);
                    return { ok: true, user: user };
                }

                if (res.data && res.data.error) {
                    return { ok: false, error: res.data.error, field: res.data.field };
                }
            } catch (err) {
                console.warn('[PXC] Server register failed, using local:', err.message);
            }
        }

        /* ---- Local-only fallback ---- */
        for (var i = 0; i < this.users.length; i++) {
            if (this.users[i].email === email) {
                return { ok: false, error: 'An account with this email already exists.' };
            }
        }

        var salt = this._randomSalt();
        var hash = await this._hashPassword(password, salt);

        var newUser = {
            id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: name,
            email: email,
            salt: salt,
            hash: hash,
            joined: new Date().toISOString()
        };

        this.users.push(newUser);
        this._persist('pxc_users', this.users);

        this._startSession(newUser);
        return { ok: true, user: newUser };
    },


    /* =========================================================
       LOGIN
       Server-first, falls back to local-only.
       ========================================================= */
    login: async function (email, password) {
        email = String(email || '').trim().toLowerCase();
        password = String(password || '');

        var onHttp = location.protocol === 'http:' || location.protocol === 'https:';

        if (onHttp) {
            try {
                var res = await PXC_API.request('POST', '/api/auth/login', {
                    email: email, password: password
                });

                if (res.ok && res.data && res.data.ok) {
                    PXC_API.setToken(res.data.token);
                    var user = res.data.user;
                    this._startSession(user);
                    console.log('[PXC] Logged in via server:', email);
                    return { ok: true, user: user };
                }

                if (res.data && res.data.error) {
                    return { ok: false, error: res.data.error };
                }
            } catch (err) {
                console.warn('[PXC] Server login failed, using local:', err.message);
            }
        }

        /* ---- Local-only fallback ---- */
        var localUser = null;
        for (var i = 0; i < this.users.length; i++) {
            if (this.users[i].email === email) {
                localUser = this.users[i];
                break;
            }
        }
        if (!localUser) {
            return { ok: false, error: 'No account found with that email.' };
        }

        // Migrate old plaintext password to hashed form
        if (localUser.password !== undefined && localUser.hash === undefined) {
            if (localUser.password !== password) {
                return { ok: false, error: 'Incorrect password.' };
            }

            var salt = this._randomSalt();
            localUser.salt = salt;
            localUser.hash = await this._hashPassword(password, salt);
            delete localUser.password;
            this._persist('pxc_users', this.users);
        } else {
            var hash = await this._hashPassword(password, localUser.salt);
            if (hash !== localUser.hash) {
                return { ok: false, error: 'Incorrect password.' };
            }
        }

        this._startSession(localUser);
        return { ok: true, user: localUser };
    },

    _startSession: function (user) {
        var session = {
            id: user.id,
            name: user.name,
            email: user.email,
            joined: user.joined
        };
        this._persist('pxc_session', session);
        this.user = session;
        document.dispatchEvent(new CustomEvent('pxc:auth-update'));
        return true;
    },

    logout: function () {
        try { localStorage.removeItem('pxc_session'); } catch (e) { }
        try { PXC_API.setToken(''); } catch (e) { }
        this.user = null;
        document.dispatchEvent(new CustomEvent('pxc:auth-update'));
    },

    isLoggedIn: function () { return !!this.user; },


    /* =========================================================
       ORDERS
       ========================================================= */

    // Synchronous — reads cached orders from localStorage.
    getUserOrders: function () {
        if (!this.user) return [];
        var result = [];
        for (var i = 0; i < this.orders.length; i++) {
            if (this.orders[i].userId === this.user.id) {
                result.push(this.orders[i]);
            }
        }
        return result;
    },

    /* ---------------------------------------------------------
       FETCH MY ORDERS (async)
       Pulls fresh orders from /api/orders/mine so customer
       status stays in sync with admin changes.

       IMPORTANT: does NOT dispatch 'pxc:orders-update'.
       That event is for WRITES (placeOrder). Firing it here
       would create an infinite loop:
           fetchMyOrders → event → renderOrders → fetchMyOrders…
       --------------------------------------------------------- */
    fetchMyOrders: async function () {
        if (!this.user) return [];

        var onHttp = location.protocol === 'http:' || location.protocol === 'https:';
        if (!onHttp) return this.getUserOrders();

        try {
            var res = await PXC_API.request('GET', '/api/orders/mine');

            if (res.ok && res.data && res.data.ok && Array.isArray(res.data.orders)) {
                var serverOrders = [];
                for (var i = 0; i < res.data.orders.length; i++) {
                    var o = res.data.orders[i];

                    var mappedItems = [];
                    var rawItems = o.items || [];
                    for (var j = 0; j < rawItems.length; j++) {
                        var ri = rawItems[j];
                        mappedItems.push({
                            id: ri.productId,
                            productId: ri.productId,
                            name: ri.name,
                            qty: Number(ri.qty) || 0,
                            price: Number(ri.price) || 0
                        });
                    }

                    serverOrders.push({
                        id: o.id,
                        userId: o.customerId || this.user.id,
                        items: mappedItems,
                        total: Number(o.total) || 0,
                        subtotal: Number(o.subtotal) || 0,
                        shipping: Number(o.shipping) || 0,
                        tax: Number(o.tax) || 0,
                        status: o.status || 'Processing',
                        date: o.date,
                        serverSync: true
                    });
                }

                // Replace only this user's orders; keep others intact
                var others = [];
                for (var k = 0; k < this.orders.length; k++) {
                    if (this.orders[k].userId !== this.user.id) {
                        others.push(this.orders[k]);
                    }
                }
                this.orders = others.concat(serverOrders);
                this._persist('pxc_orders', this.orders);

                // ⚠️ No 'pxc:orders-update' dispatch — see header note.
                console.log('[PXC] Fetched', serverOrders.length, 'orders from server');
                return serverOrders;
            }

            if (res.data && res.data.error) {
                console.warn('[PXC] fetchMyOrders error:', res.data.error);
            }
        } catch (err) {
            console.warn('[PXC] fetchMyOrders failed, using local cache:', err.message);
        }

        return this.getUserOrders();
    },

    /* ---------------------------------------------------------
       PLACE ORDER (async)
       Server-first. On HTTP 401 we REFUSE — no ghost order.
       On network error we fall back to a local-only order.
       --------------------------------------------------------- */
    placeOrder: async function (items, total, address) {
        if (!this.user) {
            return { ok: false, error: 'You must be logged in to place an order.' };
        }
        if (!Array.isArray(items) || items.length === 0) {
            return { ok: false, error: 'Your cart is empty.' };
        }

        var onHttp = location.protocol === 'http:' || location.protocol === 'https:';

        /* ---------- 1. Try the server ---------- */
        if (onHttp) {
            var orderAddress = address || {
                name: this.user.name || 'Customer',
                phone: '',
                line1: 'Demo address (storefront checkout)',
                line2: '',
                city: 'Demo City',
                state: '',
                pincode: ''
            };

            var serverItems = [];
            for (var i = 0; i < items.length; i++) {
                serverItems.push({ productId: items[i].id, qty: items[i].qty });
            }

            try {
                var res = await PXC_API.request('POST', '/api/orders', {
                    items: serverItems,
                    address: orderAddress,
                    payment: { method: 'COD' },
                    notes: ''
                });

                /* Success */
                if (res.ok && res.data && res.data.ok && res.data.order) {
                    var serverOrder = res.data.order;

                    var mappedItems = [];
                    var rawItems = serverOrder.items || [];
                    for (var j = 0; j < rawItems.length; j++) {
                        var it = rawItems[j];
                        mappedItems.push({
                            id: it.productId,
                            productId: it.productId,
                            name: it.name,
                            qty: it.qty,
                            price: it.price
                        });
                    }

                    var localOrder = {
                        id: serverOrder.id,
                        userId: this.user.id,
                        items: mappedItems,
                        total: serverOrder.total,
                        status: serverOrder.status || 'Processing',
                        date: serverOrder.date,
                        serverSync: true
                    };

                    this.orders.push(localOrder);
                    this._persist('pxc_orders', this.orders);

                    this.addNotification('Order ' + localOrder.id + ' placed successfully', 'order');

                    // Correct place to fire the event — state changed
                    document.dispatchEvent(new CustomEvent('pxc:orders-update'));
                    console.log('[PXC] Order placed on server:', localOrder.id);

                    return { ok: true, order: localOrder };
                }

                /* ---- FIX: 401 → REFUSE. Do NOT create a ghost order. ---- */
                if (res.status === 401) {
                    return {
                        ok: false,
                        error: 'Your session has expired. Please log in again to place your order.'
                    };
                }

                /* ---- Other server rejections (409 stock, 400 validation, etc.) ---- */
                var errMsg = (res.data && res.data.error) || 'Order failed';
                return { ok: false, error: errMsg };

            } catch (err) {
                // Network error only — safe to fall back to local
                console.warn('[PXC] Server unreachable, saving order locally:', err.message);
            }
        }

        /* ---------- 2. Local-only fallback (offline / file://) ---------- */
        var localItems = [];
        for (var li = 0; li < items.length; li++) {
            var origItem = items[li];
            var prod = this.getProduct(origItem.id);
            localItems.push({
                id: origItem.id,
                productId: origItem.id,
                name: prod ? prod.name : '',
                qty: origItem.qty,
                price: origItem.price
            });
        }

        var localOrder2 = {
            id: 'PXC-' + Date.now().toString(36).toUpperCase(),
            userId: this.user.id,
            items: localItems,
            total: total,
            status: 'Processing',
            date: new Date().toISOString(),
            serverSync: false
        };

        this.orders.push(localOrder2);
        this._persist('pxc_orders', this.orders);

        this.addNotification('Order ' + localOrder2.id + ' placed successfully', 'order');

        document.dispatchEvent(new CustomEvent('pxc:orders-update'));
        return { ok: true, order: localOrder2 };
    },


    /* =========================================================
       ADDRESSES
       ========================================================= */
    getUserAddresses: function () {
        if (!this.user) return [];
        var result = [];
        for (var i = 0; i < this.addresses.length; i++) {
            if (this.addresses[i].userId === this.user.id) {
                result.push(this.addresses[i]);
            }
        }
        return result;
    },

    addAddress: function (addr) {
        if (!this.user) return null;
        if (!addr || !addr.line1 || !addr.city) return null;

        var entry = {
            id: 'addr_' + Date.now().toString(36),
            userId: this.user.id,
            label: String(addr.label || 'Home').trim(),
            name: String(addr.name || this.user.name).trim(),
            phone: String(addr.phone || '').trim(),
            line1: String(addr.line1).trim(),
            line2: String(addr.line2 || '').trim(),
            city: String(addr.city).trim(),
            state: String(addr.state || '').trim(),
            pincode: String(addr.pincode || '').trim(),
            isDefault: !!addr.isDefault,
            createdAt: new Date().toISOString()
        };

        if (entry.isDefault) {
            for (var i = 0; i < this.addresses.length; i++) {
                if (this.addresses[i].userId === this.user.id) {
                    this.addresses[i].isDefault = false;
                }
            }
        }

        this.addresses.push(entry);
        this._persist('pxc_addresses', this.addresses);
        return entry;
    },

    removeAddress: function (id) {
        var next = [];
        for (var i = 0; i < this.addresses.length; i++) {
            if (this.addresses[i].id !== id) next.push(this.addresses[i]);
        }
        this.addresses = next;
        this._persist('pxc_addresses', this.addresses);
    },


    /* =========================================================
       REVIEWS
       Server-first. 401 now THROWS so the UI can prompt login.
       ========================================================= */
    getReviews: function (productId) {
        if (this.reviews && this.reviews[productId]) return this.reviews[productId];
        return [];
    },

    userReviewForProduct: function (productId) {
        if (!this.user) return [];
        var all = this.getReviews(productId);
        var result = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i].userId === this.user.id) result.push(all[i]);
        }
        return result;
    },

    hasUserReviewed: function (productId) {
        return this.userReviewForProduct(productId).length > 0;
    },

    addReview: async function (productId, review) {
        if (!this.user || !productId || !review) return null;
        if (this.hasUserReviewed(productId)) return null;   // one per user per product

        var onHttp = location.protocol === 'http:' || location.protocol === 'https:';

        /* ---------- 1. Try the server ---------- */
        if (onHttp) {
            try {
                var res = await PXC_API.request(
                    'POST',
                    '/api/reviews/' + encodeURIComponent(productId),
                    {
                        rating: Math.max(1, Math.min(5, Number(review.rating) || 5)),
                        title: String(review.title || '').trim() || 'Review',
                        text: String(review.text || '').trim()
                    }
                );

                if (res.ok && res.data && res.data.ok && res.data.review) {
                    var saved = res.data.review;

                    if (!this.reviews[productId]) this.reviews[productId] = [];
                    this.reviews[productId].push(saved);

                    if (!this.userReviews[productId]) this.userReviews[productId] = [];
                    this.userReviews[productId].push(saved);
                    this._persist('pxc_user_reviews', this.userReviews);

                    document.dispatchEvent(new CustomEvent('pxc:review-update', {
                        detail: { productId: productId }
                    }));

                    console.log('[PXC] Review saved on server');
                    return saved;
                }

                /* ---- FIX: 401 → THROW so the UI shows "session expired" ---- */
                if (res.status === 401) {
                    throw new Error('Your session has expired. Please log in again to post your review.');
                }

                if (res.data && res.data.error) {
                    console.warn('[PXC] Server rejected review:', res.data.error);
                    if (/already/i.test(res.data.error)) return null;
                    // Other errors fall through to local
                }
            } catch (err) {
                // If it's our own 401 throw, propagate it
                if (/session has expired/i.test(err.message)) throw err;
                console.warn('[PXC] Server review failed, saving locally:', err.message);
            }
        }

        /* ---------- 2. Local-only fallback ---------- */
        var entry = {
            user: this.user.name,
            userId: this.user.id,
            rating: Math.max(1, Math.min(5, Number(review.rating) || 5)),
            title: String(review.title || '').trim() || 'Review',
            text: String(review.text || '').trim(),
            date: new Date().toISOString().split('T')[0]
        };

        if (!this.userReviews[productId]) this.userReviews[productId] = [];
        this.userReviews[productId].push(entry);
        this._persist('pxc_user_reviews', this.userReviews);

        if (!this.reviews[productId]) this.reviews[productId] = [];
        this.reviews[productId].push(entry);

        document.dispatchEvent(new CustomEvent('pxc:review-update', {
            detail: { productId: productId }
        }));
        return entry;
    },


    /* =========================================================
       RECENTLY VIEWED
       ========================================================= */
    trackRecentlyViewed: function (productId) {
        if (!productId) return;

        var filtered = [];
        for (var i = 0; i < this.recentlyViewed.length; i++) {
            if (this.recentlyViewed[i] !== productId) {
                filtered.push(this.recentlyViewed[i]);
            }
        }

        this.recentlyViewed = [productId].concat(filtered).slice(0, 12);
        this._persist('pxc_recent', this.recentlyViewed);
    },

    getRecentlyViewed: function () {
        var result = [];
        for (var i = 0; i < this.recentlyViewed.length; i++) {
            var p = this.getProduct(this.recentlyViewed[i]);
            if (p) result.push(p);
        }
        return result;
    },


    /* =========================================================
       NOTIFICATIONS
       ========================================================= */
    addNotification: function (message, type) {
        if (type === undefined) type = 'info';
        if (!message) return null;

        var entry = {
            id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            userId: this.user ? this.user.id : 'guest',
            message: String(message),
            type: String(type),
            read: false,
            date: new Date().toISOString()
        };

        this.notifications.push(entry);
        this._persist('pxc_notifications', this.notifications);
        document.dispatchEvent(new CustomEvent('pxc:notifications-update'));
        return entry;
    },

    getUserNotifications: function () {
        if (!this.user) return [];
        var result = [];
        for (var i = 0; i < this.notifications.length; i++) {
            if (this.notifications[i].userId === this.user.id) {
                result.push(this.notifications[i]);
            }
        }
        return result;
    },

    markNotificationsRead: function () {
        if (!this.user) return;
        for (var i = 0; i < this.notifications.length; i++) {
            if (this.notifications[i].userId === this.user.id) {
                this.notifications[i].read = true;
            }
        }
        this._persist('pxc_notifications', this.notifications);
        document.dispatchEvent(new CustomEvent('pxc:notifications-update'));
    },

    unreadNotificationCount: function () {
        var all = this.getUserNotifications();
        var count = 0;
        for (var i = 0; i < all.length; i++) {
            if (!all[i].read) count++;
        }
        return count;
    },


    /* =========================================================
       NEWSLETTER
       ========================================================= */
    subscribe: function (email) {
        email = String(email || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { ok: false, error: 'Please enter a valid email address.' };
        }

        for (var i = 0; i < this.subscribers.length; i++) {
            if (this.subscribers[i].email === email) {
                return { ok: true, already: true };
            }
        }

        this.subscribers.push({ email: email, date: new Date().toISOString() });
        this._persist('pxc_subscribers', this.subscribers);
        return { ok: true };
    },


    /* =========================================================
       DEBUG
       ========================================================= */
    _dump: function () {
        console.log('Products:       ', this.products.length);
        console.log('Categories:     ', this.categories.length);
        console.log('Users:          ', this.users);
        console.log('Session:        ', this.user);
        console.log('Cart:           ', this.cart);
        console.log('Wishlist:       ', this.wishlist);
        console.log('Orders:         ', this.orders);
        console.log('Addresses:      ', this.addresses);
        console.log('User reviews:   ', this.userReviews);
        console.log('Notifications:  ', this.notifications);
        console.log('Recently viewed:', this.recentlyViewed);
    },

    _resetAll: function () {
        var keys = [
            'pxc_cart', 'pxc_wishlist', 'pxc_users', 'pxc_session',
            'pxc_subscribers', 'pxc_orders', 'pxc_addresses',
            'pxc_user_reviews', 'pxc_notifications', 'pxc_recent',
            'pxc_customer_token'
        ];
        for (var i = 0; i < keys.length; i++) {
            try { localStorage.removeItem(keys[i]); }
            catch (e) { }
        }

        this.cart = [];
        this.wishlist = [];
        this.users = [];
        this.user = null;
        this.subscribers = [];
        this.orders = [];
        this.addresses = [];
        this.userReviews = {};
        this.notifications = [];
        this.recentlyViewed = [];

        location.reload();
    }
};


/* Helper: try multiple URLs, return first JSON that succeeds */
async function tryFetch(candidates) {
    for (var i = 0; i < candidates.length; i++) {
        var p = candidates[i];
        try {
            var r = await fetch(p);
            if (r.ok) return await r.json();
        } catch (e) { }
    }
    return null;
}

window.PXC = PXC;