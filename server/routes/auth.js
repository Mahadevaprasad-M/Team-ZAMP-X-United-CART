'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const store = require('../lib/store');
const ids = require('../lib/ids');
const validate = require('../lib/validate');
const activity = require('../lib/activity');
const auth = require('../middleware/auth');

const router = express.Router();


/* ============ CONSTANTS ============ */
const USERS_FILE = 'users.json';
const BCRYPT_ROUNDS = 10;      // ~100ms per hash
const MAX_USERS = 10000;   // sanity cap

// A REAL bcrypt hash of a dummy password.
// Used to keep login timing constant when email is unknown
// (prevents timing attacks). MUST be a valid hash.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';


/* ============ HELPERS ============ */

// Return only safe fields — never send the password hash
function publicUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'customer',
        joined: user.joined
    };
}

// Look up user by email (case-insensitive)
function findUserByEmail(email) {
    const users = store.read(USERS_FILE);
    if (!Array.isArray(users)) return null;

    const needle = String(email || '').trim().toLowerCase();

    return users.find(u =>
        u && String(u.email).toLowerCase() === needle
    ) || null;
}

// Look up user by id
function findUserById(id) {
    if (!id) return null;

    const users = store.read(USERS_FILE);
    if (!Array.isArray(users)) return null;

    return users.find(u => u && u.id === id) || null;
}


/* =========================================================
   POST /api/auth/register
   Body: { name, email, password } → { ok, token, user }
   ========================================================= */
router.post('/register', async (req, res) => {
    try {
        /* ---- 1. Validate input ---- */
        const v = validate.register(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        const { name, email, password } = v.value;

        /* ---- 2. Reject duplicates ---- */
        if (findUserByEmail(email)) {
            return res.status(409).json({
                ok: false,
                error: 'An account with this email already exists',
                field: 'email'
            });
        }

        /* ---- 3. Cap total users ---- */
        const users = store.read(USERS_FILE);
        if (Array.isArray(users) && users.length >= MAX_USERS) {
            return res.status(503).json({
                ok: false,
                error: 'Registration is temporarily unavailable'
            });
        }

        /* ---- 4. Hash password ---- */
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        /* ---- 5. Build the user object ---- */
        const user = {
            id: ids.userId(),
            name,
            email,
            hash,
            role: 'customer',   // NEVER trust the client for this
            joined: new Date().toISOString()
        };

        /* ---- 6. Append to users.json (atomic) ---- */
        await store.mutate(USERS_FILE, list => {
            if (!Array.isArray(list)) list = [];
            list.push(user);
            return list;
        });

        /* ---- 7. Log activity (fire & forget) ---- */
        activity.customerRegistered(user).catch(() => { });

        /* ---- 8. Sign + respond ---- */
        const token = auth.signToken(user);

        res.status(201).json({
            ok: true,
            token,
            user: publicUser(user)
        });

    } catch (err) {
        console.error('[auth/register]', err);
        res.status(500).json({
            ok: false,
            error: 'Could not create your account. Please try again.'
        });
    }
});


/* =========================================================
   POST /api/auth/login
   Body: { email, password } → { ok, token, user }

   Security notes:
     • Same error for "email not found" and "wrong password"
       → prevents email enumeration.
     • Always runs bcrypt.compare() (against DUMMY_HASH
       when the email is unknown) → constant response time.
   ========================================================= */
router.post('/login', async (req, res) => {
    try {
        /* ---- 1. Validate input ---- */
        const v = validate.login(req.body);
        if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: v.field });
        }

        const { email, password } = v.value;
        const GENERIC_ERROR = 'Incorrect email or password';

        /* ---- 2. Look up user ---- */
        const user = findUserByEmail(email);

        // Unknown email → still burn bcrypt time, then 401
        if (!user) {
            try { await bcrypt.compare(password, DUMMY_HASH); } catch (_) { }
            return res.status(401).json({ ok: false, error: GENERIC_ERROR });
        }

        /* ---- 3. Verify password ---- */
        let matches = false;
        try {
            matches = await bcrypt.compare(password, user.hash || '');
        } catch (_) {
            matches = false;
        }

        if (!matches) {
            return res.status(401).json({ ok: false, error: GENERIC_ERROR });
        }

        /* ---- 4. Log admin sign-ins ---- */
        if (user.role === 'admin') {
            activity.adminLogin(user).catch(() => { });
        }

        /* ---- 5. Sign + respond ---- */
        const token = auth.signToken(user);

        res.json({
            ok: true,
            token,
            user: publicUser(user)
        });

    } catch (err) {
        console.error('[auth/login]', err);
        res.status(500).json({
            ok: false,
            error: 'Login failed. Please try again.'
        });
    }
});


/* =========================================================
   GET /api/auth/me — current user
   Headers: Authorization: Bearer <token>
   ========================================================= */
router.get('/me', auth.requireAuth, (req, res) => {
    res.json({ ok: true, user: publicUser(req.user) });
});


/* =========================================================
   POST /api/auth/change-password
   Body: { currentPassword, newPassword } → { ok: true }
   ========================================================= */
router.post('/change-password', auth.requireAuth, async (req, res) => {
    try {
        const body = req.body || {};

        const currentPassword = String(body.currentPassword == null ? '' : body.currentPassword);
        const newPassword = String(body.newPassword == null ? '' : body.newPassword);

        /* ---- 1. Validate input ---- */
        if (!currentPassword) {
            return res.status(400).json({
                ok: false, error: 'Current password is required', field: 'currentPassword'
            });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({
                ok: false, error: 'New password must be at least 6 characters', field: 'newPassword'
            });
        }
        if (newPassword.length > 200) {
            return res.status(400).json({
                ok: false, error: 'New password is too long', field: 'newPassword'
            });
        }
        if (newPassword === currentPassword) {
            return res.status(400).json({
                ok: false, error: 'New password must differ from the current one', field: 'newPassword'
            });
        }

        /* ---- 2. Load the full user (with hash) ---- */
        const user = findUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ ok: false, error: 'Account not found' });
        }

        /* ---- 3. Verify current password ---- */
        let matches = false;
        try {
            matches = await bcrypt.compare(currentPassword, user.hash || '');
        } catch (_) {
            matches = false;
        }

        if (!matches) {
            return res.status(401).json({
                ok: false, error: 'Current password is incorrect', field: 'currentPassword'
            });
        }

        /* ---- 4. Hash the new password ---- */
        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

        /* ---- 5. Update in place (atomic) ---- */
        await store.mutate(USERS_FILE, list => {
            if (!Array.isArray(list)) return list;

            const idx = list.findIndex(u => u && u.id === user.id);
            if (idx !== -1) list[idx].hash = newHash;

            return list;
        });

        /* ---- 6. Log the change ---- */
        activity.log({
            type: 'password:changed',
            message: `Password changed for ${user.email}`,
            meta: { userId: user.id },
            actor: 'user:' + user.id
        }).catch(() => { });

        /* ---- 7. Respond ---- */
        res.json({ ok: true });

    } catch (err) {
        console.error('[auth/change-password]', err);
        res.status(500).json({
            ok: false,
            error: 'Could not change password. Please try again.'
        });
    }
});


/* =========================================================
   POST /api/auth/logout — no-op
   JWTs are stateless — this just gives the frontend
   one predictable place to call when logging out.
   ========================================================= */
router.post('/logout', (req, res) => {
    res.json({ ok: true });
});


/* ============ EXPORTS ============ */
module.exports = router;