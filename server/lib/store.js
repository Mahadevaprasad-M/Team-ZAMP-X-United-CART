'use strict';

var fs = require('fs');
var path = require('path');


/* =========================================================
   DATA DIRECTORY
   ========================================================= */
var DATA_DIR = process.env.PXC_DATA_DIR
    ? path.resolve(process.env.PXC_DATA_DIR)
    : path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('[store] Created data folder:', DATA_DIR);
}


/* =========================================================
   DEFAULT CONTENTS
   ========================================================= */
var DEFAULTS = {
    'products.json': [],
    'categories.json': [],
    'orders.json': [],
    'customers.json': [],
    'users.json': [],
    'reviews.json': {},
    'activity-log.json': [],
    'banners.json': {},

    'settings.json': {
        storeName: 'TeamZampXUnited',
        currency: 'INR',
        freeShippingThreshold: 499,
        shippingFee: 49,
        defaultLowStockThreshold: 10,
        taxPercent: 0,
        lowStockAlertsEnabled: true,
        updatedAt: new Date().toISOString()
    }
};


/* =========================================================
   STATE
   ========================================================= */
var cache = new Map();   // filename -> parsed value
var writeQueues = new Map();   // filename -> Promise chain


/* =========================================================
   WRITE QUEUE
   Serialises writes per file. Only public entry points
   (write, mutate, remove) call enqueue(). The internal
   _writeSync never re-enqueues.
   ========================================================= */
function enqueue(filename, task) {
    var previous = writeQueues.get(filename) || Promise.resolve();
    var next = previous.then(task, task);

    // store a "sink" chain that ignores errors so a failed write
    // doesn't break every subsequent write on the same file
    writeQueues.set(filename, next.catch(function () { }));

    return next;
}


/* =========================================================
   PATH HELPER
   ========================================================= */
function filePath(filename) {
    return path.join(DATA_DIR, filename);
}


/* =========================================================
   READ (sync)
   Uses cache; creates file with default if missing;
   resets to default if corrupted.
   ========================================================= */
function read(filename) {
    if (!filename || typeof filename !== 'string') {
        throw new Error('[store] read() needs a filename');
    }

    if (cache.has(filename)) return cache.get(filename);

    var full = filePath(filename);

    // File doesn't exist -> create with default
    if (!fs.existsSync(full)) {
        var def = getDefault(filename);
        fs.writeFileSync(full, JSON.stringify(def, null, 2), 'utf8');
        cache.set(filename, def);
        console.log('[store] Created default file:', filename);
        return def;
    }

    try {
        var raw = fs.readFileSync(full, 'utf8');

        // File exists but is empty -> use default
        if (!raw.trim()) {
            var def2 = getDefault(filename);
            cache.set(filename, def2);
            return def2;
        }

        var parsed = JSON.parse(raw);
        cache.set(filename, parsed);
        return parsed;

    } catch (err) {
        console.warn('[store] Corrupted ' + filename + ' — resetting to default.', err.message);
        var def3 = getDefault(filename);
        fs.writeFileSync(full, JSON.stringify(def3, null, 2), 'utf8');
        cache.set(filename, def3);
        return def3;
    }
}


/* =========================================================
   _writeSync — actual disk write (private)
   Atomic via temp file + rename. Does NOT touch the queue.
   Called by write() and mutate() directly.
   ========================================================= */
function _writeSync(filename, value) {
    var full = filePath(filename);
    var tmp = full + '.tmp-' + process.pid + '-' + Date.now();
    var json = JSON.stringify(value, null, 2);

    try {
        fs.writeFileSync(tmp, json, 'utf8');
        fs.renameSync(tmp, full);   // atomic replace
        cache.set(filename, value);
        return value;

    } catch (err) {
        // best-effort cleanup of the leftover temp file
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch (e2) { }

        console.error('[store] Failed to write ' + filename + ':', err.message);
        throw err;
    }
}


/* =========================================================
   WRITE (public — goes through the queue)
   ========================================================= */
function write(filename, value) {
    if (!filename || typeof filename !== 'string') {
        return Promise.reject(new Error('[store] write() needs a filename'));
    }

    return enqueue(filename, function () {
        return _writeSync(filename, value);
    });
}


/* =========================================================
   MUTATE — read → transform → write, one queue slot
   ========================================================= */
function mutate(filename, transformFn) {
    if (typeof transformFn !== 'function') {
        return Promise.reject(new Error('[store] mutate() needs a transform function'));
    }

    return enqueue(filename, async function () {
        var current = read(filename);
        var next = await transformFn(current);
        return _writeSync(filename, next);
    });
}


/* =========================================================
   DEFAULTS
   ========================================================= */
function getDefault(filename) {
    if (filename in DEFAULTS) {
        // deep-clone so callers can't mutate the shared DEFAULTS object
        return JSON.parse(JSON.stringify(DEFAULTS[filename]));
    }
    return [];
}


/* =========================================================
   UTILITIES
   ========================================================= */
function exists(filename) {
    return fs.existsSync(filePath(filename));
}

function remove(filename) {
    return enqueue(filename, function () {
        var full = filePath(filename);
        if (fs.existsSync(full)) fs.unlinkSync(full);
        cache.delete(filename);
        return true;
    });
}

function clearCache() {
    cache.clear();
}

function getDataDir() {
    return DATA_DIR;
}


/* =========================================================
   EXPORTS
   ========================================================= */
module.exports = {
    read: read,
    write: write,
    mutate: mutate,
    exists: exists,
    remove: remove,
    clearCache: clearCache,
    getDataDir: getDataDir,
    DEFAULTS: DEFAULTS
};