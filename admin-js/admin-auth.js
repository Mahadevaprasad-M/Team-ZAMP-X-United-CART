'use strict';

(function (window, document) {

    // ---------- constants ----------
    var LOGIN_PAGE = 'login.html';
    var DASHBOARD = 'index.html';
    var ME_CACHE_KEY = 'pxc_admin_me_cache';
    var ME_CACHE_MS = 30 * 1000;   // cache /me for 30s

    // ---------- state ----------
    var currentUser = null;
    var lastVerified = 0;

    /* =========================================================
       JWT HELPERS  (payload is NOT trusted — for UI only)
       ========================================================= */
    function decodeJwt(token) {
        if (!token || typeof token !== 'string') return null;

        var parts = token.split('.');
        if (parts.length !== 3) return null;

        try {
            // base64url -> base64, add padding
            var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) {
                b64 += '=';
            }

            // decode base64 -> binary string -> percent-encoded -> URI-decoded JSON
            var binary = atob(b64);
            var chars = binary.split('');
            var percentEncoded = '';
            for (var i = 0; i < chars.length; i++) {
                var hex = chars[i].charCodeAt(0).toString(16);
                if (hex.length === 1) hex = '0' + hex;
                percentEncoded += '%' + hex;
            }

            var json = decodeURIComponent(percentEncoded);
            return JSON.parse(json);

        } catch (e) {
            return null;
        }
    }

    function isExpired(token) {
        var payload = decodeJwt(token);
        if (!payload || !payload.exp) return false;
        return payload.exp * 1000 <= Date.now();
    }

    /* =========================================================
       /me CACHE  (avoids hammering the server on every page nav)
       ========================================================= */
    function readCache() {
        try {
            var raw = sessionStorage.getItem(ME_CACHE_KEY);
            if (!raw) return null;

            var obj = JSON.parse(raw);
            if (!obj || typeof obj.at !== 'number') return null;
            if (Date.now() - obj.at > ME_CACHE_MS) return null;

            return obj.user || null;

        } catch (e) {
            return null;
        }
    }

    function writeCache(user) {
        try {
            sessionStorage.setItem(ME_CACHE_KEY, JSON.stringify({
                at: Date.now(),
                user: user
            }));
        } catch (e) { }
    }

    function clearCache() {
        try { sessionStorage.removeItem(ME_CACHE_KEY); }
        catch (e) { }
    }

    /* =========================================================
       REDIRECT / URL HELPERS
       ========================================================= */
    function redirectToLogin(reason) {
        var url = LOGIN_PAGE;
        if (reason) {
            url += '?reason=' + encodeURIComponent(reason);
        }
        // replace() so the back button doesn't loop
        window.location.replace(url);
    }

    function currentPagePath() {
        var parts = window.location.pathname.split('/');
        return parts.pop() || '';
    }

    function isOnLoginPage() {
        return /^login(\.html)?$/i.test(currentPagePath());
    }

    /* =========================================================
       EVENT BUS
       ========================================================= */
    function emit(name, detail) {
        try {
            document.dispatchEvent(new CustomEvent('pxc-admin:' + name, {
                detail: detail || {}
            }));
        } catch (e) { }
    }

    /* =========================================================
       PUBLIC API
       ========================================================= */
    var AdminAuth = {

        // ---------- LOGIN ----------
        login: async function (email, password) {
            try {
                var res = await window.API.auth.login(email, password);

                if (!res || !res.ok || !res.user) {
                    var errMsg = (res && res.error) || 'Login failed';
                    return { ok: false, error: errMsg };
                }

                if (res.user.role !== 'admin') {
                    window.API.token.clear();   // not an admin -> revoke
                    return {
                        ok: false,
                        error: 'This account does not have administrator access.'
                    };
                }

                currentUser = res.user;
                lastVerified = Date.now();
                writeCache(currentUser);
                emit('login', { user: currentUser });

                return { ok: true, user: currentUser };

            } catch (err) {
                var msg = (err && err.message) ? err.message : 'Login failed';
                return { ok: false, error: msg };
            }
        },

        // ---------- LOGOUT ----------
        logout: async function (redirect) {
            if (redirect === undefined) redirect = true;

            try { await window.API.auth.logout(); }
            catch (e) { }

            window.API.token.clear();
            clearCache();

            currentUser = null;
            lastVerified = 0;
            emit('logout', {});

            if (redirect) redirectToLogin('logout');
        },

        // ---------- SYNC USER (from cache) ----------
        user: function () {
            return currentUser || readCache();
        },

        // ---------- CHEAP LOCAL CHECK (no server call) ----------
        isLoggedIn: function () {
            var t = window.API.token.get();
            if (!t) return false;
            if (isExpired(t)) return false;
            return true;
        },

        // ---------- VERIFY WITH SERVER ----------
        verify: async function () {
            // 1. fresh cache? use it.
            var cached = readCache();
            if (cached && (Date.now() - lastVerified) < ME_CACHE_MS) {
                currentUser = cached;
                return currentUser;
            }

            // 2. no token? bail.
            if (!this.isLoggedIn()) {
                currentUser = null;
                clearCache();
                return null;
            }

            // 3. ask the server
            try {
                var res = await window.API.auth.me();

                if (!res || !res.ok || !res.user) {
                    currentUser = null;
                    clearCache();
                    return null;
                }

                if (res.user.role !== 'admin') {
                    // valid token but not admin — kill session
                    window.API.token.clear();
                    clearCache();
                    currentUser = null;
                    return null;
                }

                currentUser = res.user;
                lastVerified = Date.now();
                writeCache(currentUser);
                return currentUser;

            } catch (err) {
                // 401 -> api.js already cleared the token
                currentUser = null;
                clearCache();
                return null;
            }
        },

        // ---------- ROUTE GUARD (call on every admin page) ----------
        require: async function () {
            // prevent redirect loop if we're already on login page
            if (isOnLoginPage()) return null;

            var user = await this.verify();

            if (!user) {
                redirectToLogin('login-required');
                return null;
            }
            return user;
        },

        // ---------- BOUNCE IF ALREADY LOGGED IN (login page only) ----------
        redirectIfLoggedIn: async function (target) {
            if (target === undefined) target = DASHBOARD;

            var user = await this.verify();
            if (user) {
                window.location.replace(target);
                return true;
            }
            return false;
        },

        // ---------- AUTO-LOGOUT WHEN TOKEN EXPIRES ----------
        startExpiryWatcher: function () {
            if (this._watcher) return;

            var self = this;
            this._watcher = setInterval(function () {
                var t = window.API.token.get();
                if (!t) return;

                if (isExpired(t)) {
                    console.warn('[admin-auth] Token expired — logging out');
                    self.logout(true);
                }
            }, 60 * 1000);
        },

        // ---------- FORCE RE-VERIFY ----------
        invalidateCache: function () {
            clearCache();
            lastVerified = 0;
        },

        // ---------- DEBUG ----------
        _decodeJwt: decodeJwt,
        _isExpired: isExpired
    };

    /* Expose */
    window.AdminAuth = AdminAuth;

    /* Auto-start the expiry watcher on every admin page */
    AdminAuth.startExpiryWatcher();

})(window, document);