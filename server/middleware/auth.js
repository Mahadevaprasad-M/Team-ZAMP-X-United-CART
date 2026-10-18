'use strict';

var jwt = require('jsonwebtoken');
var store = require('../lib/store');


/* =========================================================
   SECRET
   ========================================================= */
var FALLBACK_SECRET = 'DEV-ONLY-CHANGE-ME-TeamZampXUnited-do-not-use-in-production';

var warned = false;

function getSecret() {
    var s = process.env.JWT_SECRET;
    if (s && s.length >= 16) return s;

    if (!warned) {
        console.warn(
            '\n[auth] ⚠  JWT_SECRET is not set (or too short).\n' +
            '[auth] ⚠  Using a dev-only fallback. Set JWT_SECRET\n' +
            '[auth] ⚠  in your environment before deploying.\n'
        );
        warned = true;
    }
    return FALLBACK_SECRET;
}


/* =========================================================
   TOKEN LIFETIME
   ========================================================= */
var EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';


/* =========================================================
   SIGN
   Never put sensitive data in the payload — JWTs are
   base64-encoded, not encrypted.
   ========================================================= */
function signToken(user) {
    if (!user || !user.id) {
        throw new Error('[auth] signToken needs a user with an id');
    }

    var payload = {
        id: user.id,
        email: user.email,
        role: user.role || 'customer'
    };

    return jwt.sign(payload, getSecret(), { expiresIn: EXPIRES_IN });
}


/* =========================================================
   VERIFY
   ========================================================= */
function verifyToken(token) {
    return jwt.verify(token, getSecret());
}


/* =========================================================
   HELPERS
   ========================================================= */

// Extract the bearer token from the request. Null if missing.
function extractBearer(req) {
    var header = req.headers && req.headers.authorization;
    if (!header || typeof header !== 'string') return null;

    var match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;

    return match[1].trim() || null;
}

/**
 * Look up the user from the token payload.
 * The JWT only claims an id — we still verify the user
 * actually exists so a deleted account can't keep calling.
 */
function loadUser(id) {
    if (!id) return null;

    var users = store.read('users.json');
    if (!Array.isArray(users)) return null;

    // find the matching user with a plain for loop
    var u = null;
    for (var i = 0; i < users.length; i++) {
        var candidate = users[i];
        if (candidate && candidate.id === id) {
            u = candidate;
            break;
        }
    }
    if (!u) return null;

    // Strip secrets before handing to routes
    return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role || 'customer',
        joined: u.joined
    };
}

// Standard 401 for a bad/expired token.
function authFailure(res, err) {
    var message;
    if (err && err.name === 'TokenExpiredError') {
        message = 'Session expired — please log in again';
    } else {
        message = 'Invalid session token';
    }

    return res.status(401).json({
        ok: false,
        error: message
    });
}


/* =========================================================
   MIDDLEWARE: requireAuth
   Rejects with 401 if not authenticated.
   ========================================================= */
function requireAuth(req, res, next) {
    var token = extractBearer(req);
    if (!token) {
        return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    var payload;
    try {
        payload = verifyToken(token);
    } catch (err) {
        return authFailure(res, err);
    }

    var user = loadUser(payload.id);
    if (!user) {
        return res.status(401).json({ ok: false, error: 'Account no longer exists' });
    }

    req.user = user;
    next();
}


/* =========================================================
   MIDDLEWARE: requireAdmin
   Same as requireAuth + role check.
   Returns 403 (not 401) for logged-in non-admins.
   ========================================================= */
function requireAdmin(req, res, next) {
    var token = extractBearer(req);
    if (!token) {
        return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    var payload;
    try {
        payload = verifyToken(token);
    } catch (err) {
        return authFailure(res, err);
    }

    var user = loadUser(payload.id);
    if (!user) {
        return res.status(401).json({ ok: false, error: 'Account no longer exists' });
    }

    if (user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Administrator access required' });
    }

    req.user = user;
    next();
}


/* =========================================================
   MIDDLEWARE: optionalAuth
   Sets req.user if a valid token is present, never rejects.
   Use for public routes that behave differently when logged in.
   ========================================================= */
function optionalAuth(req, _res, next) {
    var token = extractBearer(req);
    if (!token) return next();

    try {
        var payload = verifyToken(token);
        var user = loadUser(payload.id);
        if (user) req.user = user;
    } catch (e) {
        // Silently ignore — treat as anonymous
    }

    next();
}


/* =========================================================
   INLINE HELPERS (for route handlers)
   ========================================================= */

// True if req.user is an admin.
function isAdmin(req) {
    return !!(req.user && req.user.role === 'admin');
}

// True if req.user owns the resource, or is an admin.
function canAccess(req, resource) {
    if (!req.user) return false;
    if (isAdmin(req)) return true;

    var ownerId = resource && (resource.userId || resource.customerId);
    return ownerId === req.user.id;
}

// 403 response for "you can't access this".
function denyAccess(res) {
    return res.status(403).json({
        ok: false,
        error: 'You do not have permission to access this resource'
    });
}


/* =========================================================
   EXPORTS
   ========================================================= */
module.exports = {
    // Middleware
    requireAuth: requireAuth,
    requireAdmin: requireAdmin,
    optionalAuth: optionalAuth,

    // Inline helpers
    isAdmin: isAdmin,
    canAccess: canAccess,
    denyAccess: denyAccess,

    // Token helpers
    signToken: signToken,
    verifyToken: verifyToken,

    // Constants
    EXPIRES_IN: EXPIRES_IN
};