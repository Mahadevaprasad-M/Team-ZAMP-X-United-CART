'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');


/* =========================================================
   CONFIG
   ========================================================= */
var DATA_DIR = path.join(__dirname, 'data');
var RESET = process.argv.indexOf('--reset') !== -1;

var PROTECTED_FILES = [
    'users.json',
    'orders.json',
    'customers.json',
    'activity-log.json',
    'settings.json'
];

/** Default settings created only if settings.json is missing. */
var DEFAULT_SETTINGS = {
    storeName: 'TeamZampXUnited',
    currency: 'INR',
    freeShippingThreshold: 499,
    shippingFee: 49,
    defaultLowStockThreshold: 10,
    taxPercent: 0,
    lowStockAlertsEnabled: true
};


/* =========================================================
   LOAD js/data.js IN A SANDBOX
   js/data.js is a browser file (`window.PXC_DATA = ...`).
   We run it in a vm context with a fake window so we can
   read the result from Node.
   ========================================================= */
function loadDataBundle() {
    var dataFile = path.join(__dirname, '..', 'js', 'data.js');

    if (!fs.existsSync(dataFile)) {
        throw new Error('Cannot find js/data.js at ' + dataFile);
    }

    var code = fs.readFileSync(dataFile, 'utf8');
    var sandbox = { window: {} };

    try {
        vm.createContext(sandbox);
        vm.runInContext(code, sandbox, { filename: 'js/data.js' });
    } catch (err) {
        throw new Error('Failed to evaluate js/data.js: ' + err.message);
    }

    var data = sandbox.window.PXC_DATA;
    if (!data || typeof data !== 'object') {
        throw new Error('js/data.js did not define window.PXC_DATA');
    }

    return data;
}


/* =========================================================
   JSON READ / WRITE
   ========================================================= */
function writeJson(filename, value) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    var full = path.join(DATA_DIR, filename);
    fs.writeFileSync(full, JSON.stringify(value, null, 2), 'utf8');
    console.log('  wrote', filename, '(' + sizeOf(value) + ')');
}

function readJson(filename, fallback) {
    var full = path.join(DATA_DIR, filename);
    if (!fs.existsSync(full)) return fallback;

    try {
        return JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

/** Human-readable size of an array or object. */
function sizeOf(v) {
    if (Array.isArray(v)) return v.length + ' items';
    if (v && typeof v === 'object') return Object.keys(v).length + ' keys';
    return typeof v;
}

/** Turn any value into an array (for safe iteration). */
function asArray(v) {
    return Array.isArray(v) ? v : [];
}


/* =========================================================
   HEADER
   ========================================================= */
console.log('');
console.log('=====================================================');
console.log('  TeamZampXUnited - Seed script');
console.log('=====================================================');
console.log('  Mode:  ' + (RESET ? 'RESET (wipe + reseed)' : 'ADDITIVE (keep existing)'));
console.log('  Data:  ' + DATA_DIR);
console.log('');


/* =========================================================
   STEP 1 — Optional wipe
   ========================================================= */
if (RESET) {
    console.log('Step 1: wiping data files (preserving live data)...');

    if (fs.existsSync(DATA_DIR)) {
        var dirEntries = fs.readdirSync(DATA_DIR);

        for (var fi = 0; fi < dirEntries.length; fi++) {
            var f = dirEntries[fi];

            // only touch .json files
            if (f.slice(-5) !== '.json') continue;

            // never touch protected files
            if (PROTECTED_FILES.indexOf(f) !== -1) continue;

            fs.unlinkSync(path.join(DATA_DIR, f));
            console.log('  removed', f);
        }

        for (var pi = 0; pi < PROTECTED_FILES.length; pi++) {
            var pf = PROTECTED_FILES[pi];
            if (fs.existsSync(path.join(DATA_DIR, pf))) {
                console.log('  kept   ', pf);
            }
        }
    } else {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log('  created', DATA_DIR);
    }
    console.log('');
} else {
    console.log('Step 1: skipping reset (use --reset to wipe)');
    console.log('');
}


/* =========================================================
   STEP 2 — Load the bundle
   ========================================================= */
console.log('Step 2: loading js/data.js...');

var bundle;
try {
    bundle = loadDataBundle();
} catch (err) {
    console.error('');
    console.error('ERROR: ' + err.message);
    console.error('');
    process.exit(1);
}

console.log('  found',
    asArray(bundle.products).length, 'products,',
    asArray(bundle.categories).length, 'categories');
console.log('');


/* =========================================================
   STEP 3 — Products  (merge by id)
   ========================================================= */
console.log('Step 3: writing products...');
{
    var existingProducts = RESET ? [] : readJson('products.json', []);
    var existingProductsArr = asArray(existingProducts);

    // collect the ids that already exist
    var existingProductIdList = [];
    for (var ei3 = 0; ei3 < existingProductsArr.length; ei3++) {
        existingProductIdList.push(existingProductsArr[ei3].id);
    }
    var existingProductIds = new Set(existingProductIdList);

    // Enrich each incoming product with fields the admin API expects
    var incomingProducts = asArray(bundle.products).map(function (p) {
        var thresh = Number(p.lowStockThreshold);
        return Object.assign({}, p, {
            lowStockThreshold: Number.isFinite(thresh) ? thresh : 10,
            createdAt: p.createdAt || new Date().toISOString(),
            updatedAt: p.updatedAt || new Date().toISOString()
        });
    });

    var mergedProducts = existingProductsArr.slice();
    var added3 = 0;

    for (var mi3 = 0; mi3 < incomingProducts.length; mi3++) {
        var p3 = incomingProducts[mi3];
        if (!existingProductIds.has(p3.id)) {
            mergedProducts.push(p3);
            added3++;
        }
    }

    writeJson('products.json', mergedProducts);
    console.log('  added', added3, 'new,', mergedProducts.length, 'total');
}
console.log('');


/* =========================================================
   STEP 4 — Categories  (merge by id)
   Custom categories the admin added are preserved.
   ========================================================= */
console.log('Step 4: writing categories...');
{
    var incomingCats = asArray(bundle.categories);

    if (RESET) {
        writeJson('categories.json', incomingCats);
        console.log('  reset:', incomingCats.length, 'categories');
    } else {
        var existingCats = readJson('categories.json', []);
        var existingCatsArr = asArray(existingCats);

        var existingCatIdList = [];
        for (var ei4 = 0; ei4 < existingCatsArr.length; ei4++) {
            existingCatIdList.push(existingCatsArr[ei4] && existingCatsArr[ei4].id);
        }
        var existingCatIds = new Set(existingCatIdList);

        var mergedCats = existingCatsArr.slice();
        var added4 = 0;

        for (var ci4 = 0; ci4 < incomingCats.length; ci4++) {
            var c4 = incomingCats[ci4];
            if (!c4 || !c4.id) continue;
            if (!existingCatIds.has(c4.id)) {
                mergedCats.push(c4);
                added4++;
            }
        }

        writeJson('categories.json', mergedCats);
        console.log('  added', added4, 'new,', mergedCats.length, 'total');
    }
}
console.log('');


/* =========================================================
   STEP 5 — Banners  (only write if missing / --reset)
   Custom banners the admin edited are preserved.
   ========================================================= */
console.log('Step 5: writing banners...');
{
    var incomingBanners = bundle.banners || {};
    var bannersPath = path.join(DATA_DIR, 'banners.json');
    var bannersExist = fs.existsSync(bannersPath);

    if (RESET) {
        writeJson('banners.json', incomingBanners);
        console.log('  reset');
    } else if (bannersExist) {
        console.log('  banners.json already exists - keeping');
    } else {
        writeJson('banners.json', incomingBanners);
        console.log('  created banners.json (first run)');
    }
}
console.log('');


/* =========================================================
   STEP 6 — Reviews  (merge by user|date to avoid duplicates)
   ========================================================= */
console.log('Step 6: writing reviews...');
{
    var existingReviews = RESET ? {} : readJson('reviews.json', {});
    var incomingReviews = bundle.reviews || {};
    var mergedReviews = Object.assign({}, existingReviews);

    var reviewPids = Object.keys(incomingReviews);

    for (var pi6 = 0; pi6 < reviewPids.length; pi6++) {
        var pid = reviewPids[pi6];
        var reviewList = asArray(incomingReviews[pid]);

        if (!Array.isArray(mergedReviews[pid])) mergedReviews[pid] = [];

        // build the "user|date" seen-set for this product
        var seenKeyList = [];
        for (var si6 = 0; si6 < mergedReviews[pid].length; si6++) {
            var r0 = mergedReviews[pid][si6];
            seenKeyList.push((r0.user || '') + '|' + (r0.date || ''));
        }
        var seenKeys = new Set(seenKeyList);

        for (var ri6 = 0; ri6 < reviewList.length; ri6++) {
            var r6 = reviewList[ri6];
            var key6 = (r6.user || '') + '|' + (r6.date || '');
            if (!seenKeys.has(key6)) {
                mergedReviews[pid].push(r6);
                seenKeys.add(key6);
            }
        }
    }

    writeJson('reviews.json', mergedReviews);
}
console.log('');


/* =========================================================
   STEP 7 — Settings  (only create if missing)
   Never overwrite admin-configured values.
   ========================================================= */
console.log('Step 7: ensuring settings.json exists...');
{
    var existingSettings = readJson('settings.json', null);

    if (existingSettings && !RESET) {
        console.log('  settings.json already exists - keeping');
    } else if (existingSettings && RESET) {
        // settings.json is in PROTECTED_FILES, so it was not wiped.
        console.log('  settings.json protected - keeping');
    } else {
        writeJson('settings.json', Object.assign({}, DEFAULT_SETTINGS, {
            updatedAt: new Date().toISOString()
        }));
    }
}
console.log('');


/* =========================================================
   DONE
   ========================================================= */
console.log('=====================================================');
console.log('  Seed complete');
console.log('=====================================================');
console.log('');
console.log('  Restart your server (Ctrl+C, then npm start)');
console.log('  to pick up the new data if it was running.');
console.log('');