'use strict';

var store = require('./store');
var ids = require('./ids');


/* ---------- Constants ---------- */
var LOG_FILE = 'activity-log.json';
var MAX_EVENTS = 500;
var ROOM_ADMIN = 'admin';

/* Socket.IO handle — set once by server.js */
var ioInstance = null;


/* =========================================================
   BIND SOCKET.IO
   Called once at boot by server.js. Until then, log() still
   writes to disk — it just skips the broadcast.
   ========================================================= */
function setIO(io) {
    ioInstance = io || null;

    if (ioInstance) {
        console.log('[activity] Socket.IO bound — live feed enabled');
    } else {
        console.log('[activity] Socket.IO not bound — disk-only mode');
    }
}


/* =========================================================
   CORE — write + broadcast
   ========================================================= */
async function log(event) {
    if (!event || typeof event !== 'object') {
        throw new Error('[activity] log() needs an event object');
    }

    var metaSafe = (event.meta && typeof event.meta === 'object') ? event.meta : {};

    var entry = {
        id: ids.eventId(),
        type: String(event.type || 'info'),
        message: String(event.message || ''),
        meta: metaSafe,
        actor: String(event.actor || 'system'),
        date: new Date().toISOString()
    };

    // Persist to disk (newest first, capped)
    try {
        await store.mutate(LOG_FILE, function (list) {
            if (!Array.isArray(list)) list = [];
            list.unshift(entry);
            if (list.length > MAX_EVENTS) list.length = MAX_EVENTS;
            return list;
        });
    } catch (err) {
        console.error('[activity] Failed to persist event:', err.message);
        // Don't rethrow — the caller's main write already succeeded
    }

    // Broadcast to admins (best-effort)
    broadcast('activity:new', entry);

    return entry;
}

/**
 * Low-level broadcaster. Public so routes can push events
 * that don't need to be logged.
 */
function broadcast(eventName, payload, room) {
    if (room === undefined) room = ROOM_ADMIN;

    if (!ioInstance) return false;
    try {
        ioInstance.to(room).emit(eventName, payload);
        return true;
    } catch (err) {
        console.error('[activity] Broadcast ' + eventName + ' failed:', err.message);
        return false;
    }
}


/* =========================================================
   READ / CLEAR
   ========================================================= */
function recent(limit) {
    if (limit === undefined) limit = 50;

    var list = store.read(LOG_FILE);
    if (!Array.isArray(list)) return [];
    return list.slice(0, Math.max(0, limit));
}

async function clear() {
    await store.write(LOG_FILE, []);
    broadcast('activity:cleared', { date: new Date().toISOString() });
}


/* =========================================================
   NAMED HELPERS
   Guarantee consistent type strings + messages across routes.
   ========================================================= */

/* ---------- Orders ---------- */
async function orderCreated(order) {
    var items = order.items || [];
    var itemCount = 0;
    for (var i = 0; i < items.length; i++) {
        itemCount += (items[i].qty || 0);
    }

    return log({
        type: 'order:new',
        message: 'New order ' + order.id + ' — ' + formatMoney(order.total),
        meta: {
            orderId: order.id,
            customerId: order.customerId,
            customerName: order.customerName,
            total: order.total,
            itemCount: itemCount
        },
        actor: 'customer:' + (order.customerId || 'guest')
    });
}

async function orderStatusChanged(order, previousStatus) {
    return log({
        type: 'order:status',
        message: 'Order ' + order.id + ' → ' + order.status,
        meta: {
            orderId: order.id,
            previousStatus: previousStatus,
            newStatus: order.status
        },
        actor: 'admin'
    });
}

async function orderDeleted(order) {
    return log({
        type: 'order:deleted',
        message: 'Order ' + order.id + ' deleted',
        meta: { orderId: order.id, total: order.total },
        actor: 'admin'
    });
}


/* ---------- Products / Stock ---------- */
async function productCreated(product) {
    return log({
        type: 'product:new',
        message: 'Product added: ' + product.name,
        meta: { productId: product.id, name: product.name, price: product.price },
        actor: 'admin'
    });
}

async function productUpdated(product, action) {
    if (action === undefined) action = 'edited';

    return log({
        type: 'product:updated',
        message: 'Product ' + action + ': ' + product.name,
        meta: { productId: product.id, action: action },
        actor: 'admin'
    });
}

async function productDeleted(product) {
    return log({
        type: 'product:deleted',
        message: 'Product deleted: ' + product.name,
        meta: { productId: product.id, name: product.name },
        actor: 'admin'
    });
}

async function stockChanged(product, delta, newStock) {
    var sign = (delta > 0) ? '+' : '';

    return log({
        type: 'stock:changed',
        message: 'Stock ' + sign + delta + ' → ' + product.name + ' (' + newStock + ' left)',
        meta: {
            productId: product.id,
            name: product.name,
            delta: delta,
            newStock: newStock
        },
        actor: 'admin'
    });
}

async function stockLow(product, threshold) {
    return log({
        type: 'stock:low',
        message: 'Low stock: ' + product.name + ' (' + product.stock + ' left)',
        meta: {
            productId: product.id,
            name: product.name,
            stock: product.stock,
            threshold: threshold
        },
        actor: 'system'
    });
}

async function stockOut(product) {
    return log({
        type: 'stock:out',
        message: 'Out of stock: ' + product.name,
        meta: { productId: product.id, name: product.name },
        actor: 'system'
    });
}


/* ---------- Customers / Auth ---------- */
async function customerRegistered(user) {
    return log({
        type: 'customer:new',
        message: 'New customer: ' + user.name,
        meta: { userId: user.id, email: user.email },
        actor: 'system'
    });
}

async function adminLogin(user) {
    return log({
        type: 'admin:login',
        message: 'Admin signed in: ' + user.name,
        meta: { userId: user.id },
        actor: 'admin:' + user.id
    });
}


/* ---------- Settings ---------- */
async function settingsUpdated(changes) {
    return log({
        type: 'settings:updated',
        message: 'Store settings updated',
        meta: { changes: changes },
        actor: 'admin'
    });
}


/* =========================================================
   UTIL
   ========================================================= */
function formatMoney(amount) {
    var n = Number(amount) || 0;
    return '₹' + n.toLocaleString('en-IN');
}


/* =========================================================
   EXPORTS
   ========================================================= */
module.exports = {
    /* Core */
    setIO: setIO,
    log: log,
    broadcast: broadcast,
    recent: recent,
    clear: clear,

    /* Named helpers */
    orderCreated: orderCreated,
    orderStatusChanged: orderStatusChanged,
    orderDeleted: orderDeleted,
    productCreated: productCreated,
    productUpdated: productUpdated,
    productDeleted: productDeleted,
    stockChanged: stockChanged,
    stockLow: stockLow,
    stockOut: stockOut,
    customerRegistered: customerRegistered,
    adminLogin: adminLogin,
    settingsUpdated: settingsUpdated,

    /* Constants */
    ROOM_ADMIN: ROOM_ADMIN,
    MAX_EVENTS: MAX_EVENTS
};