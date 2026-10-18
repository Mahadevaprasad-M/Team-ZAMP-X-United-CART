'use strict';

// Load .env if available (dev convenience)
try { require('dotenv').config(); } catch (_) { }

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Server: SocketServer } = require('socket.io');

const store = require('./lib/store');
const ids = require('./lib/ids');
const activity = require('./lib/activity');
const auth = require('./middleware/auth');


/* ============ CONSTANTS ============ */
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const PROJECT_ROOT = path.join(__dirname, '..');

const CORS_ORIGINS = IS_PROD
    ? (process.env.CORS_ORIGINS || '').split(',').filter(Boolean)
    : true;


/* ============ APP + HTTP SERVER ============ */
const app = express();
const httpServer = http.createServer(app);


/* ============ SOCKET.IO ============ */
const io = new SocketServer(httpServer, {
    cors: {
        origin: CORS_ORIGINS,
        methods: ['GET', 'POST'],
        credentials: true
    },
    pingTimeout: 20000,
    pingInterval: 25000
});

activity.setIO(io);


/* ============ MIDDLEWARE ============ */

// CORS
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));

// Body parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logger (dev only)
if (!IS_PROD) {
    app.use((req, _res, next) => {
        if (req.path.startsWith('/api') && req.path !== '/api/health') {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        }
        next();
    });
}


/* ============ API ROUTES ============ */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/reviews', require('./routes/reviews'));

// Health check
app.get('/api/health', (_req, res) => {
    const body = {
        ok: true,
        status: 'healthy',
        version: '1.0.0',
        env: NODE_ENV,
        uptimeSec: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
    };

    // Hide data dir path in production
    if (!IS_PROD) body.dataDir = store.getDataDir();

    res.json(body);
});


/* ============ STATIC FILES ============ */

// Block sensitive paths (e.g. /server/data/users.json)
app.use((req, res, next) => {
    const p = req.path.toLowerCase();

    const blocked =
        p.startsWith('/server') ||
        p.startsWith('/node_modules') ||
        p.startsWith('/.git') ||
        p === '/package.json' ||
        p === '/package-lock.json' ||
        p.startsWith('/.env');

    if (blocked) return res.status(403).type('text').send('Forbidden');
    next();
});

// Block other dotfiles (.DS_Store etc.) except .well-known
app.use((req, res, next) => {
    if (/\/\.[^/]/.test(req.path) && !req.path.startsWith('/.well-known')) {
        return res.status(403).type('text').send('Forbidden');
    }
    next();
});

// Serve project root as static files
app.use(express.static(PROJECT_ROOT, {
    extensions: ['html'],
    index: ['index.html']
}));

app.get('/', (_req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'index.html'));
});


/* ============ 404 HANDLER ============ */
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            ok: false,
            error: 'Endpoint not found',
            path: req.path
        });
    }

    res.status(404).sendFile(path.join(PROJECT_ROOT, 'coming-soon.html'), err => {
        if (err) res.status(404).type('text').send('404 - Page not found');
    });
});


/* ============ GLOBAL ERROR HANDLER ============ */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
    console.error('[server] Unhandled error:', err);

    const status = err.status || err.statusCode || 500;
    const message = (IS_PROD && status === 500)
        ? 'Something went wrong. Please try again.'
        : (err.message || 'Internal server error');

    res.status(status).json({ ok: false, error: message });
});


/* ============ SOCKET.IO — CONNECTION ============ */
// Admins join ROOM_ADMIN after JWT verification.
function joinAdminRoom(socket, token) {
    if (!token) return false;

    try {
        const payload = auth.verifyToken(token);
        const users = store.read('users.json');
        const user = Array.isArray(users)
            ? users.find(u => u && u.id === payload.id)
            : null;

        if (!user || user.role !== 'admin') return false;

        socket.join(activity.ROOM_ADMIN);
        socket.data.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        };
        return true;
    } catch (_) {
        return false; // invalid / expired token
    }
}

io.on('connection', socket => {
    const authToken = socket.handshake
        && socket.handshake.auth
        && socket.handshake.auth.token;

    if (joinAdminRoom(socket, authToken)) {
        console.log(`[socket] admin connected: ${socket.data.user.email} (${socket.id})`);
    }

    // Allow re-join (e.g. after token refresh)
    socket.on('join:admin', token => {
        if (joinAdminRoom(socket, token)) {
            socket.emit('joined:admin', { ok: true });
        }
    });

    socket.on('disconnect', reason => {
        if (socket.data && socket.data.user) {
            console.log(`[socket] disconnect: ${socket.data.user.email} (${reason})`);
        }
    });
});


/* ============ SEED DEFAULT ADMIN ============ */
// Uses hashSync — async variant can hang on some Windows/Node setups.
function seedDefaultAdmin() {
    try {
        const users = store.read('users.json');
        const list = Array.isArray(users) ? users : [];
        const hasAdmin = list.some(u => u && u.role === 'admin');

        if (hasAdmin) {
            console.log('[seed] Admin account already exists - skipping');
            return;
        }

        console.log('[seed] No admin found - creating default admin...');

        const admin = {
            id: ids.userId(),
            name: 'Store Admin',
            email: 'admin@TeamZampXUnited.in',
            hash: bcrypt.hashSync('admin123', 10),
            role: 'admin',
            joined: new Date().toISOString()
        };

        list.push(admin);

        // Sync write — we're in the boot path
        const fs = require('fs');
        const fullPath = path.join(store.getDataDir(), 'users.json');
        fs.writeFileSync(fullPath, JSON.stringify(list, null, 2), 'utf8');

        // Refresh cache so auth routes see the new admin
        store.clearCache();

        console.log('');
        console.log('===================================================');
        console.log('  DEFAULT ADMIN CREATED');
        console.log('  Email:    admin@TeamZampXUnited.in');
        console.log('  Password: admin123');
        console.log('  Change this password after first login.');
        console.log('===================================================');
        console.log('');

    } catch (err) {
        console.error('[seed] Failed to seed default admin:', err.message);
        console.error(err.stack);
    }
}


/* ============ START LISTENING ============ */
function start() {
    console.log('[boot] step 1/4 - ensuring data files exist');
    [
        'users.json', 'settings.json', 'activity-log.json',
        'products.json', 'categories.json', 'orders.json', 'reviews.json'
    ].forEach(f => store.read(f));

    console.log('[boot] step 2/4 - seeding admin (if needed)');
    seedDefaultAdmin();

    console.log('[boot] step 3/4 - attaching HTTP error handler');
    httpServer.on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.error('');
            console.error('===================================================');
            console.error('  PORT ' + PORT + ' IS ALREADY IN USE');
            console.error('  Another process is listening on that port.');
            console.error('  Close it, or run with a different port:');
            console.error('    set PORT=4000 && npm start');
            console.error('===================================================');
            console.error('');
        } else {
            console.error('[server] HTTP server error:', err);
        }
        process.exit(1);
    });

    console.log('[boot] step 4/4 - listening on port ' + PORT);
    httpServer.listen(PORT, () => {
        console.log('');
        console.log('===================================================');
        console.log('  TeamZampXUnited API');
        console.log('===================================================');
        console.log('  Env:      ' + NODE_ENV);
        console.log('  Port:     ' + PORT);
        console.log('  Data:     ' + store.getDataDir());
        console.log('  Store:    http://localhost:' + PORT + '/');
        console.log('  Admin:    http://localhost:' + PORT + '/admin/');
        console.log('  Health:   http://localhost:' + PORT + '/api/health');
        console.log('===================================================');
        console.log('');
    });
}


/* ============ GRACEFUL SHUTDOWN ============ */
function shutdown(signal) {
    console.log(`\n[server] ${signal} received - shutting down...`);

    io.close(() => {
        httpServer.close(() => {
            console.log('[server] Goodbye.');
            process.exit(0);
        });
    });

    // Force exit if clean shutdown hangs
    setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', reason => {
    console.error('[server] Unhandled rejection:', reason);
});


/* ============ GO ============ */
console.log('[boot] calling start()...');
try {
    start();
} catch (err) {
    console.error('[server] Fatal startup error:', err);
    console.error(err.stack);
    process.exit(1);
}


/* Export for testing tools (supertest etc.) */
module.exports = { app, httpServer, io };