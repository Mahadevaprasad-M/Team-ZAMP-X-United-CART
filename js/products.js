var state = {
    q: '',
    category: 'all',
    brand: 'all',
    priceMax: Infinity,
    minRating: 0,
    sort: 'featured',
    tag: '',
    wishlistOnly: false,
    page: 1,
    perPage: 12
};


/* =========================================================
   BOOT
   ========================================================= */
document.addEventListener('DOMContentLoaded', async function () {
    try { await PXC.load(); }
    catch (err) { console.error('[products] PXC.load failed:', err); }

    try { PXCUI.renderHeader(); } catch (err) { console.error(err); }
    try { PXCUI.renderFooter(); } catch (err) { console.error(err); }

    // Data failed to load
    if (!PXC.products || !PXC.products.length) {
        var grid = document.getElementById('productsGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1">
                    <h3>Could not load products</h3>
                    <p>Please refresh the page or check that js/data.js is loaded.</p>
                </div>
            `;
        }
        return;
    }

    try { readUrlIntoState(); } catch (err) { console.error(err); }
    try { buildFilterUI(); } catch (err) { console.error(err); }
    try { buildToolbar(); } catch (err) { console.error(err); }
    try { syncSearchInput(); } catch (err) { console.error(err); }
    try { wireMobileFilterDrawer(); } catch (err) { console.error(err); }
    try { applyAndRender(); } catch (err) { console.error(err); }

    var clearBtn = document.getElementById('clearFilters');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);

    // Re-render wishlist view when hearts toggle
    document.addEventListener('pxc:wishlist-update', function () {
        if (state.wishlistOnly) applyAndRender();
    });
});


/* =========================================================
   URL + SESSION STORAGE → STATE
   ========================================================= */
function readUrlIntoState() {
    var params = new URLSearchParams(location.search);
    var bareUrl = !location.search && !location.hash;

    // Bare URL → clear stale hints
    if (bareUrl) {
        safeRemove('pxcLastSearch');
        safeRemove('pxcLastCategory');
    }

    // Search
    var q = params.get('q');
    if (!q && !bareUrl) q = safeGet('pxcLastSearch') || '';
    state.q = q || '';

    // Category
    var category = params.get('category');
    if (!category && !bareUrl) category = safeGet('pxcLastCategory') || '';
    state.category = category || 'all';

    // Simple URL params
    state.brand = params.get('brand') || 'all';
    state.sort = params.get('sort') || 'featured';
    state.tag = params.get('tag') || '';

    // Wishlist-only (URL, hash, or session flag — consumed once)
    var wishFromUrl = params.get('wishlist') === '1' || location.hash === '#wishlist';
    var wishFromSession = safeGet('pxcShowWishlistOnly') === '1';
    if (wishFromSession) safeRemove('pxcShowWishlistOnly');
    state.wishlistOnly = wishFromUrl || wishFromSession;

    // Price
    var pMax = params.get('priceMax');
    if (pMax === '25000+') {
        state.priceMax = -1;
    } else if (pMax !== null && pMax !== '') {
        state.priceMax = Number(pMax) || Infinity;
    } else {
        state.priceMax = Infinity;
    }

    // Rating
    state.minRating = Number(params.get('minRating')) || 0;
}


/* Small localStorage/sessionStorage wrappers */
function safeGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }
function safeRemove(k) { try { sessionStorage.removeItem(k); } catch (e) { } }


/* =========================================================
   SAFE STRING HELPERS (fix: crash on missing fields)
   ========================================================= */
function lower(v) {
    return String(v == null ? '' : v).toLowerCase();
}

function safeName(p) { return lower(p && p.name); }
function safeBrand(p) { return lower(p && p.brand); }
function safeCategory(p) { return lower(p && p.category); }
function safeSubcategory(p) { return lower(p && p.subcategory); }

function hasTag(p, tag) {
    if (!p || !Array.isArray(p.tags)) return false;
    return p.tags.indexOf(tag) !== -1;
}


/* =========================================================
   SYNC NAVBAR SEARCH BOX
   ========================================================= */
function syncSearchInput() {
    var input = document.getElementById('navSearchInput');
    if (input && state.q) input.value = state.q;
}


/* =========================================================
   FILTER UI
   ========================================================= */
function buildFilterUI() {
    buildCategoryFilter();
    buildBrandFilter();
    buildPriceFilter();
    buildRatingFilter();
    updateFilterToggleBadge();
}

// Generic radio-group builder used by all four filters
function buildRadioGroup(host, name, options, currentValue, onChange) {
    var html = '';
    for (var i = 0; i < options.length; i++) {
        var o = options[i];
        var checked = (o.value == currentValue) ? 'checked' : '';
        html += `
            <label>
                <input type="radio" name="${name}" value="${o.value}" ${checked}>
                <span>${o.label}</span>
            </label>
        `;
    }
    host.innerHTML = html;

    var inputs = host.querySelectorAll('input[name="' + name + '"]');
    for (var j = 0; j < inputs.length; j++) {
        (function (inp) {
            inp.addEventListener('change', function () {
                onChange(inp.value);
            });
        })(inputs[j]);
    }
}

/* ---------- Category ---------- */
function buildCategoryFilter() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('filterCategories');
    if (!host) return;

    var options = [{ value: 'all', label: 'All Categories' }];
    for (var i = 0; i < PXC.categories.length; i++) {
        var c = PXC.categories[i];
        options.push({ value: c.id, label: esc(c.name) });
    }

    buildRadioGroup(host, 'cat', options, state.category, function (value) {
        state.category = value;
        state.page = 1;
        persistCategory(value);
        applyAndRender();
    });
}

/* ---------- Brand ---------- */
function buildBrandFilter() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('filterBrands');
    if (!host) return;

    // collect unique brand names in a Set
    var brandSet = new Set();
    for (var i = 0; i < PXC.products.length; i++) {
        var p = PXC.products[i];
        if (p && p.brand) {
            brandSet.add(p.brand);
        }
    }
    var brands = Array.from(brandSet).sort();

    var options = [{ value: 'all', label: 'All Brands' }];
    for (var j = 0; j < brands.length; j++) {
        options.push({ value: brands[j], label: esc(brands[j]) });
    }

    buildRadioGroup(host, 'brand', options, state.brand, function (value) {
        state.brand = value;
        state.page = 1;
        applyAndRender();
    });
}

/* ---------- Price ---------- */
function buildPriceFilter() {
    var host = document.getElementById('filterPrice');
    if (!host) return;

    var options = [
        { value: 'any', label: 'Any price', match: function (v) { return v === Infinity; } },
        { value: '500', label: 'Under ₹500', match: function (v) { return v === 500; } },
        { value: '5000', label: 'Under ₹5,000', match: function (v) { return v === 5000; } },
        { value: '25000', label: 'Under ₹25,000', match: function (v) { return v === 25000; } },
        { value: '25000+', label: '₹25,000 & above', match: function (v) { return v === -1; } }
    ];

    // pick the option whose match() returns true for the current priceMax
    var matchedOption = null;
    for (var i = 0; i < options.length; i++) {
        if (options[i].match(state.priceMax)) {
            matchedOption = options[i];
            break;
        }
    }
    var current = matchedOption ? matchedOption.value : 'any';

    buildRadioGroup(host, 'price', options, current, function (value) {
        if (value === 'any') {
            state.priceMax = Infinity;
        } else if (value === '25000+') {
            state.priceMax = -1;
        } else {
            state.priceMax = Number(value);
        }
        state.page = 1;
        applyAndRender();
    });
}

/* ---------- Rating ---------- */
function buildRatingFilter() {
    var host = document.getElementById('filterRating');
    if (!host) return;

    var options = [
        { value: 0, label: 'Any rating' },
        { value: 4, label: '4★ & above' },
        { value: 4.5, label: '4.5★ & above' }
    ];

    buildRadioGroup(host, 'rating', options, state.minRating, function (value) {
        state.minRating = Number(value);
        state.page = 1;
        applyAndRender();
    });
}


/* =========================================================
   MOBILE FILTER DRAWER
   ========================================================= */
function wireMobileFilterDrawer() {
    var toggle = document.getElementById('filterToggle');
    var filters = document.querySelector('.filters');
    if (!toggle || !filters) return;

    if (!filters.querySelector('.filters-mobile-head')) {
        var head = document.createElement('div');
        head.className = 'filters-mobile-head';
        head.innerHTML = `
            <span>Filters</span>
            <button type="button" class="filters-close" aria-label="Close filters">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6"  y2="18"/>
                    <line x1="6"  y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        filters.insertBefore(head, filters.firstChild);
        head.querySelector('.filters-close').addEventListener('click', closeFilters);
    }

    function openFilters() {
        filters.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeFilters() {
        filters.classList.remove('open');
        document.body.style.overflow = '';
        updateFilterToggleBadge();
    }

    toggle.addEventListener('click', openFilters);

    filters.addEventListener('change', function () {
        if (window.innerWidth < 768) setTimeout(closeFilters, 180);
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && filters.classList.contains('open')) closeFilters();
    });
}

function updateFilterToggleBadge() {
    var btn = document.getElementById('filterToggle');
    if (!btn) return;

    var count = 0;
    if (state.category !== 'all') count++;
    if (state.brand !== 'all') count++;
    if (state.priceMax !== Infinity) count++;
    if (state.minRating > 0) count++;

    var existing = btn.querySelector('.filter-count');
    if (existing) existing.remove();

    if (count > 0) {
        var badge = document.createElement('span');
        badge.className = 'filter-count';
        badge.textContent = count;
        btn.appendChild(badge);
    }
}


/* =========================================================
   TOOLBAR (sort dropdown)
   ========================================================= */
function buildToolbar() {
    var sortSelect = document.getElementById('sortSelect');
    if (!sortSelect) return;

    sortSelect.value = state.sort;

    if (!sortSelect._pxcBound) {
        sortSelect._pxcBound = true;
        sortSelect.addEventListener('change', function (e) {
            state.sort = e.target.value;
            state.page = 1;
            applyAndRender();
        });
    }
}


/* =========================================================
   CLEAR ALL FILTERS
   ========================================================= */
function clearAllFilters() {
    state.category = 'all';
    state.brand = 'all';
    state.priceMax = Infinity;
    state.minRating = 0;
    state.wishlistOnly = false;
    state.sort = 'featured';
    state.tag = '';
    state.q = '';
    state.page = 1;

    safeRemove('pxcLastSearch');
    safeRemove('pxcLastCategory');

    var navInput = document.getElementById('navSearchInput');
    if (navInput) navInput.value = '';

    var radioDefaults = { cat: 'all', brand: 'all', price: 'any', rating: '0' };
    var radios = document.querySelectorAll('.filters input[type="radio"]');
    for (var i = 0; i < radios.length; i++) {
        var radio = radios[i];
        if (radioDefaults[radio.name] === radio.value) radio.checked = true;
    }

    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect) sortSelect.value = 'featured';

    applyAndRender();
    updateFilterToggleBadge();
    PXCUI.toast('Filters cleared');
}


/* =========================================================
   PERSIST CATEGORY (survives query-stripping servers)
   ========================================================= */
function persistCategory(cat) {
    if (cat && cat !== 'all') {
        safeSet('pxcLastCategory', cat);
    } else {
        safeRemove('pxcLastCategory');
    }
}


/* =========================================================
   FILTER → SORT → RENDER
   ========================================================= */
function applyAndRender() {
    var list = Array.isArray(PXC.products) ? PXC.products.slice() : [];

    // Search — SAFE string coercion (fix: no more crashes)
    if (state.q) {
        var q = lower(state.q).trim();
        list = list.filter(function (p) {
            return safeName(p).indexOf(q) !== -1 ||
                safeBrand(p).indexOf(q) !== -1 ||
                safeCategory(p).indexOf(q) !== -1 ||
                safeSubcategory(p).indexOf(q) !== -1;
        });
    }

    // Category / brand
    if (state.category !== 'all') {
        list = list.filter(function (p) { return p.category === state.category; });
    }
    if (state.brand !== 'all') {
        list = list.filter(function (p) { return p.brand === state.brand; });
    }

    // Price
    if (state.priceMax === -1) {
        list = list.filter(function (p) { return p.price >= 25000; });
    } else if (state.priceMax !== Infinity && Number.isFinite(state.priceMax)) {
        list = list.filter(function (p) { return p.price <= state.priceMax; });
    }

    // Rating
    if (state.minRating > 0) {
        list = list.filter(function (p) { return p.rating >= state.minRating; });
    }

    // Tag
    if (state.tag) {
        list = list.filter(function (p) { return hasTag(p, state.tag); });
    }

    // Wishlist-only
    if (state.wishlistOnly) {
        list = list.filter(function (p) { return PXC.isWishlisted(p.id); });
    }

    // Sort — SAFE tag access (fix: no more crashes)
    var sorters = {
        'price-asc': function (a, b) { return (a.price || 0) - (b.price || 0); },
        'price-desc': function (a, b) { return (b.price || 0) - (a.price || 0); },
        'rating': function (a, b) { return (b.rating || 0) - (a.rating || 0); },
        'new': function (a, b) { return (hasTag(b, 'new') ? 1 : 0) - (hasTag(a, 'new') ? 1 : 0); },
        'discount': function (a, b) { return PXC.discountPct(b) - PXC.discountPct(a); },
        'featured': function (a, b) { return (hasTag(b, 'featured') ? 1 : 0) - (hasTag(a, 'featured') ? 1 : 0); }
    };
    list.sort(sorters[state.sort] || sorters.featured);

    updateHeaders(list.length);

    // Pagination
    var totalPages = Math.max(1, Math.ceil(list.length / state.perPage));
    if (state.page > totalPages) state.page = totalPages;

    var start = (state.page - 1) * state.perPage;
    var pageItems = list.slice(start, start + state.perPage);

    // Grid
    var grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (!pageItems.length) {
        renderEmptyState(grid);
        renderPagination(0);
        syncUrl();
        return;
    }

    grid.innerHTML = pageItems.map(function (p) {
        return PXCUI.productCard(p);
    }).join('');
    PXCUI.wireProductCards(grid);
    renderPagination(totalPages);
    syncUrl();
    updateFilterToggleBadge();
}

function renderEmptyState(grid) {
    var esc = PXCUI.escapeHtml;

    var reason;
    if (state.q) {
        reason = 'No products match "' + esc(state.q) + '".';
    } else if (state.wishlistOnly) {
        reason = "You haven't saved any products to your wishlist yet.";
    } else if (state.category !== 'all') {
        reason = 'No products in this category match your other filters.';
    } else {
        reason = 'Try changing filters or search keywords.';
    }

    grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
            <div style="font-size:3rem;margin-bottom:.5rem">🔍</div>
            <h3>No products found</h3>
            <p>${reason}</p>
            <div style="display:flex;gap:.5rem;justify-content:center;
                        flex-wrap:wrap;margin-top:1rem">
                <button type="button" class="btn btn-outline btn-sm" id="emptyClearBtn">
                    Clear all filters
                </button>
                <a href="products.html" class="btn btn-primary btn-sm">Browse all products</a>
            </div>
        </div>
    `;

    var emptyClear = document.getElementById('emptyClearBtn');
    if (emptyClear) emptyClear.addEventListener('click', clearAllFilters);
}


/* =========================================================
   HEADERS
   ========================================================= */
function updateHeaders(count) {
    var titleEl = document.getElementById('pageTitle');
    var descEl = document.getElementById('pageDesc');
    var countEl = document.getElementById('productsCount');

    var title = 'All Products';
    if (state.wishlistOnly) {
        title = 'My Wishlist';
    } else if (state.q) {
        title = 'Search: "' + state.q + '"';
    } else if (state.tag === 'featured') {
        title = 'Featured Picks';
    } else if (state.tag === 'new') {
        title = 'New Arrivals';
    } else if (state.category !== 'all') {
        var cat = PXC.categories.find(function (c) { return c.id === state.category; });
        title = cat ? cat.name : 'Products';
    }

    if (titleEl) titleEl.textContent = title;

    var productWord = (count === 1) ? '' : 's';
    var text = count + ' product' + productWord + ' found';
    if (descEl) descEl.textContent = text;
    if (countEl) countEl.textContent = text;
}


/* =========================================================
   URL SYNC (replaceState — no history spam)
   ========================================================= */
function syncUrl() {
    var params = new URLSearchParams();

    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.brand !== 'all') params.set('brand', state.brand);
    if (state.sort !== 'featured') params.set('sort', state.sort);
    if (state.tag) params.set('tag', state.tag);
    if (state.wishlistOnly) params.set('wishlist', '1');
    if (state.minRating) params.set('minRating', state.minRating);

    if (state.priceMax === -1) {
        params.set('priceMax', '25000+');
    } else if (state.priceMax !== Infinity) {
        params.set('priceMax', state.priceMax);
    }

    var qs = params.toString();
    var url = location.pathname + (qs ? '?' + qs : '');
    try { history.replaceState(null, '', url); } catch (e) { }
}


/* =========================================================
   PAGINATION
   ========================================================= */
function renderPagination(total) {
    var host = document.getElementById('pagination');
    if (!host) return;

    if (total <= 1) {
        host.innerHTML = '';
        return;
    }

    var parts = [];

    parts.push(`
        <button type="button" class="btn btn-sm btn-outline" data-page="${state.page - 1}"
                ${state.page === 1 ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>
            ← Prev
        </button>
    `);

    var pageNums = pageRange(state.page, total);
    for (var i = 0; i < pageNums.length; i++) {
        var pg = pageNums[i];
        if (pg === '…') {
            parts.push('<span style="padding:.4rem .5rem;color:var(--muted-foreground)">…</span>');
        } else {
            var cls = (pg === state.page) ? 'btn-primary' : 'btn-outline';
            parts.push(`
                <button type="button" class="btn btn-sm ${cls}" data-page="${pg}">${pg}</button>
            `);
        }
    }

    parts.push(`
        <button type="button" class="btn btn-sm btn-outline" data-page="${state.page + 1}"
                ${state.page === total ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>
            Next →
        </button>
    `);

    host.innerHTML = parts.join('');

    var buttons = host.querySelectorAll('button[data-page]');
    for (var j = 0; j < buttons.length; j++) {
        (function (b) {
            if (b.disabled) return;

            b.addEventListener('click', function () {
                var p = Number(b.dataset.page);
                if (p < 1 || p > total || p === state.page) return;

                state.page = p;
                applyAndRender();
                window.scrollTo({ top: 200, behavior: 'smooth' });
            });
        })(buttons[j]);
    }
}

function pageRange(current, total) {
    if (total <= 7) {
        var allPages = [];
        for (var k = 1; k <= total; k++) {
            allPages.push(k);
        }
        return allPages;
    }

    var pages = [1];
    var left = Math.max(2, current - 1);
    var right = Math.min(total - 1, current + 1);

    if (left > 2) pages.push('…');
    for (var pi = left; pi <= right; pi++) {
        pages.push(pi);
    }
    if (right < total - 1) pages.push('…');
    pages.push(total);

    return pages;
}