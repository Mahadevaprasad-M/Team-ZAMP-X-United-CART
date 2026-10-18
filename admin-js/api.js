'use strict';

(function (window) {

    // ---------- settings ----------
    var API_BASE = '';
    var TOKEN_KEY = 'pxc_admin_token';
    var LOGIN_PAGE = 'login.html';

    // ---------- our own error type ----------
    class ApiError extends Error {
        constructor(message, status, field) {
            super(message || 'Request failed');
            this.name = 'ApiError';
            this.status = Number(status) || 0;
            this.field = field || null;
        }
    }

    // ---------- where the token is saved ----------
    var token = {
        get: function () {
            try { return localStorage.getItem(TOKEN_KEY) || ''; }
            catch (e) { return ''; }
        },
        set: function (value) {
            try { localStorage.setItem(TOKEN_KEY, value || ''); }
            catch (e) { }
        },
        clear: function () {
            try { localStorage.removeItem(TOKEN_KEY); }
            catch (e) { }
        },
        exists: function () {
            return token.get() !== '';
        }
    };

    /* =========================================================
       1. THE MAIN REQUEST FUNCTION
       ========================================================= */
    async function request(method, path, options) {
        options = options || {};
        var url = API_BASE + path;

        // --- build the headers ---
        var headers = {};
        if (options.headers) {
            for (var name in options.headers) {
                headers[name] = options.headers[name];
            }
        }
        if (!headers['Accept']) {
            headers['Accept'] = 'application/json';
        }

        // --- attach the saved token ---
        var savedToken = token.get();
        if (savedToken && !headers['Authorization']) {
            headers['Authorization'] = 'Bearer ' + savedToken;
        }

        // --- turn the body into JSON text ---
        var body = options.body;
        if (body !== undefined && body !== null &&
            typeof body !== 'string' &&
            !(body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }

        // --- send it ---
        var res;
        try {
            res = await fetch(url, {
                method: method,
                headers: headers,
                body: body,
                credentials: 'same-origin'
            });
        } catch (networkError) {
            throw new ApiError('Network error — could not reach the server', 0);
        }

        // --- session expired? ---
        if (res.status === 401) {
            token.clear();
            if (!isOnLoginPage()) {
                setTimeout(function () {
                    window.location.href = LOGIN_PAGE + '?reason=expired';
                }, 400);
            }
            throw new ApiError('Your session has expired. Please log in again.', 401);
        }

        // --- read the reply ---
        var text = await res.text();
        var data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (e) {
                data = { ok: false, error: text };
            }
        }

        // --- if the server said "no" ---
        if (!res.ok) {
            var msg = (data && (data.error || data.message)) || defaultMessageForStatus(res.status);
            var field = data && data.field;
            throw new ApiError(msg, res.status, field);
        }

        // --- success ---
        if (data === null) {
            return { ok: true };
        }
        return data;
    }

    /* =========================================================
       2. SMALL HELPERS
       ========================================================= */

    function isOnLoginPage() {
        var path = window.location.pathname;
        return /\/admin\/login(\.html)?$/i.test(path) ||
            /\/login\.html$/i.test(path);
    }

    function defaultMessageForStatus(status) {
        var messages = {
            400: 'Invalid request',
            401: 'Please log in again',
            403: 'You do not have permission',
            404: 'Not found',
            409: 'That already exists',
            500: 'Server error — please try again',
            503: 'Service temporarily unavailable'
        };
        if (messages[status]) {
            return messages[status];
        }
        return 'Request failed (' + status + ')';
    }

    // build a query string like "?page=2&limit=10"
    function qs(params) {
        if (!params) {
            return '';
        }
        var parts = [];
        var keys = Object.keys(params);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = params[key];
            if (value === undefined || value === null || value === '') {
                continue;
            }
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        }
        if (parts.length === 0) {
            return '';
        }
        return '?' + parts.join('&');
    }

    var enc = encodeURIComponent;

    /* =========================================================
       3. THE PUBLIC API
       ========================================================= */
    var API = {

        // ---------- AUTH ----------
        auth: {
            login: async function (email, password) {
                var res = await request('POST', '/api/auth/login', {
                    body: { email: email, password: password }
                });
                if (res && res.token) {
                    token.set(res.token);
                }
                return res;
            },

            register: async function (name, email, password) {
                var res = await request('POST', '/api/auth/register', {
                    body: { name: name, email: email, password: password }
                });
                if (res && res.token) {
                    token.set(res.token);
                }
                return res;
            },

            me: function () {
                return request('GET', '/api/auth/me');
            },

            changePassword: function (currentPassword, newPassword) {
                return request('POST', '/api/auth/change-password', {
                    body: { currentPassword: currentPassword, newPassword: newPassword }
                });
            },

            logout: async function () {
                try {
                    await request('POST', '/api/auth/logout');
                } catch (e) { }
                token.clear();
            }
        },

        // ---------- PRODUCTS ----------
        products: {
            list: function (params) {
                return request('GET', '/api/products' + qs(params));
            },
            get: function (id) {
                return request('GET', '/api/products/' + enc(id));
            },
            create: function (body) {
                return request('POST', '/api/products', { body: body });
            },
            update: function (id, body) {
                return request('PUT', '/api/products/' + enc(id), { body: body });
            },
            patch: function (id, body) {
                return request('PATCH', '/api/products/' + enc(id), { body: body });
            },
            patchStock: function (id, adjustment) {
                return request('PATCH', '/api/products/' + enc(id) + '/stock', { body: adjustment });
            },
            remove: function (id) {
                return request('DELETE', '/api/products/' + enc(id));
            }
        },

        // ---------- ORDERS ----------
        orders: {
            list: function (params) {
                return request('GET', '/api/orders' + qs(params));
            },
            get: function (id) {
                return request('GET', '/api/orders/' + enc(id));
            },
            mine: function () {
                return request('GET', '/api/orders/mine');
            },
            create: function (body) {
                return request('POST', '/api/orders', { body: body });
            },
            updateStatus: function (id, status) {
                return request('PATCH', '/api/orders/' + enc(id) + '/status', {
                    body: { status: status }
                });
            },
            remove: function (id) {
                return request('DELETE', '/api/orders/' + enc(id));
            }
        },

        // ---------- CUSTOMERS ----------
        customers: {
            list: function (params) {
                return request('GET', '/api/customers' + qs(params));
            },
            get: function (id) {
                return request('GET', '/api/customers/' + enc(id));
            }
        },

        // ---------- ANALYTICS ----------
        analytics: {
            summary: function () {
                return request('GET', '/api/analytics/summary');
            },
            sales: function (range) {
                return request('GET', '/api/analytics/sales' + qs({ range: range }));
            },
            topProducts: function (limit) {
                return request('GET', '/api/analytics/top-products' + qs({ limit: limit }));
            },
            byCategory: function () {
                return request('GET', '/api/analytics/by-category');
            },
            customerStats: function () {
                return request('GET', '/api/analytics/customer-stats');
            }
        },

        // ---------- ALERTS ----------
        alerts: {
            summary: function () {
                return request('GET', '/api/alerts/summary');
            },
            all: function () {
                return request('GET', '/api/alerts/all');
            },
            lowStock: function () {
                return request('GET', '/api/alerts/low-stock');
            },
            outOfStock: function () {
                return request('GET', '/api/alerts/out-of-stock');
            },
            restock: function (updates) {
                var list = Array.isArray(updates) ? updates : [updates];
                return request('POST', '/api/alerts/restock', { body: { updates: list } });
            }
        },

        // ---------- SETTINGS ----------
        settings: {
            get: function () {
                return request('GET', '/api/settings');
            },
            update: function (body) {
                return request('PUT', '/api/settings', { body: body });
            }
        },

        // ---------- HEALTH ----------
        health: function () {
            return request('GET', '/api/health');
        },

        // ---------- escape hatch ----------
        request: request,
        token: token,
        ApiError: ApiError
    };

    window.API = API;
    window.ApiError = ApiError;

})(window);