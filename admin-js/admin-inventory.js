'use strict';

(function () {

    // ---------- page state ----------
    var state = {
        products: [],         // full list from server
        filtered: [],         // after search/filter/sort
        selected: new Set(),  // product ids
        filters: { q: '', category: 'all', brand: 'all', status: 'all' },
        sort: 'name',
        categories: [],
        lastEditedId: null    // used to flash the row we just edited
    };

    var tableHost, countLabel, bulkBar;

    // ---------- socket debounce ----------
    var _socketReloadTimer = null;

    function scheduleSocketReload() {
        clearTimeout(_socketReloadTimer);
        _socketReloadTimer = setTimeout(function () {
            _socketReloadTimer = null;
            loadProducts(false);
        }, 500);
    }

    /* =========================================================
       BOOT
       ========================================================= */
    document.addEventListener('DOMContentLoaded', async function () {
        var user = await AdminAuth.require();
        if (!user) return;

        AdminUI.mount({
            activePage: 'inventory',
            title: 'Inventory',
            subtitle: 'Manage products, prices and stock',
            content: renderLayout()
        });

        tableHost = document.getElementById('invTableHost');
        countLabel = document.getElementById('invCount');
        bulkBar = document.getElementById('invBulkBar');

        wireToolbar();
        wireBulkBar();

        await loadCategories();
        await loadProducts();

        openLiveSocket();
    });

    /* =========================================================
       LAYOUT  (HTML stays the same)
       ========================================================= */
    function renderLayout() {
        return `
            <section class="admin-card admin-mb-3">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">Product catalogue</h3>
                        <p class="admin-card__subtitle" id="invCount">Loading…</p>
                    </div>
                    <div class="admin-flex admin-flex-wrap" style="gap:8px">
                        <button type="button" class="admin-btn admin-btn--outline admin-btn--sm"
                                id="invExportBtn" title="Export visible products as CSV">
                            Export CSV
                        </button>
                        <button type="button" class="admin-btn admin-btn--primary admin-btn--sm" id="invAddBtn">
                            + Add product
                        </button>
                    </div>
                </div>

                <div class="admin-card__body" id="invToolbar">
                    <div class="admin-toolbar">
                        <div class="admin-search admin-toolbar__grow">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round">
                                <circle cx="11" cy="11" r="7"/>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            </svg>
                            <input type="search" id="invSearch"
                                   placeholder="Search by name, brand or SKU…"
                                   autocomplete="off">
                        </div>

                        <select id="invCategoryFilter" aria-label="Filter by category">
                            <option value="all">All categories</option>
                        </select>

                        <select id="invStatusFilter" aria-label="Filter by stock status">
                            <option value="all">All stock</option>
                            <option value="ok">In stock</option>
                            <option value="low">Low stock</option>
                            <option value="out">Out of stock</option>
                        </select>

                        <select id="invSort" aria-label="Sort products">
                            <option value="name">Name (A–Z)</option>
                            <option value="name-desc">Name (Z–A)</option>
                            <option value="stock-asc">Stock (low → high)</option>
                            <option value="stock-desc">Stock (high → low)</option>
                            <option value="price-asc">Price (low → high)</option>
                            <option value="price-desc">Price (high → low)</option>
                            <option value="newest">Newest first</option>
                        </select>

                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="invResetFilters">
                            Reset
                        </button>
                    </div>
                </div>
            </section>

            <div class="admin-card" style="display:none" id="invBulkBar">
                <div class="admin-card__body" style="padding:14px 20px">
                    <div class="admin-flex admin-flex-wrap" style="gap:12px">
                        <strong id="invBulkCount" style="font-size:.9rem">0 selected</strong>
                        <div style="flex:1"></div>
                        <button type="button" class="admin-btn admin-btn--outline admin-btn--sm" id="invBulkRestock">
                            Bulk restock
                        </button>
                        <button type="button" class="admin-btn admin-btn--danger admin-btn--sm" id="invBulkDelete">
                            Delete selected
                        </button>
                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" id="invBulkClear">
                            Clear
                        </button>
                    </div>
                </div>
            </div>

            <section class="admin-card">
                <div class="admin-card__body admin-card__body--flush" id="invTableHost">
                    ${skeleton()}
                </div>
            </section>
        `;
    }

    function skeleton(rows) {
        if (rows === undefined) rows = 6;

        var out = '<div style="padding:16px 20px">';
        for (var i = 0; i < rows; i++) {
            out += `<div style="height:52px;border-radius:8px;margin-bottom:12px;
                        background:linear-gradient(90deg,#f1f3f5 0%,#e9ecef 50%,#f1f3f5 100%);
                        background-size:200% 100%;
                        animation:adminShimmer 1.4s ease-in-out infinite"></div>`;
        }
        return out + '</div>';
    }

    /* =========================================================
       DATA LOADING — categories

       Try canonical endpoint first, fall back to deriving
       categories from the products list.
       ========================================================= */
    async function loadCategories() {
        var cats = [];

        // ---- 1. try the canonical endpoint ----
        try {
            var res = await API.request('GET', '/api/catalog/categories');
            if (res && Array.isArray(res.categories)) {
                cats = res.categories.map(function (c) {
                    if (c && typeof c.id === 'string') {
                        return c.id;
                    }
                    return null;
                }).filter(function (c) {
                    return c !== null;
                });
            }
        } catch (e) {
            // endpoint may not be reachable — fall through to products
        }

        // ---- 2. fallback: derive from products ----
        if (cats.length === 0) {
            try {
                var res2 = await API.products.list({ limit: 500 });
                var seen = new Set();
                var products = res2.products || [];
                for (var i = 0; i < products.length; i++) {
                    var p = products[i];
                    if (p && typeof p.category === 'string' && p.category) {
                        seen.add(p.category);
                    }
                }
                cats = Array.from(seen);
            } catch (e) {
                cats = [];
            }
        }

        state.categories = cats.slice().sort();

        // ---- 3. populate the <select> (keep the "all" option) ----
        var sel = document.getElementById('invCategoryFilter');
        if (!sel) return;

        // remove everything except the first "All categories" option
        while (sel.options.length > 1) {
            sel.remove(1);
        }

        for (var k = 0; k < state.categories.length; k++) {
            var c = state.categories[k];
            var opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c.charAt(0).toUpperCase() + c.slice(1);
            sel.appendChild(opt);
        }
    }

    /* =========================================================
       DATA LOADING — products
       ========================================================= */
    async function loadProducts(showLoader) {
        if (showLoader === undefined) showLoader = true;

        if (showLoader && tableHost) {
            tableHost.innerHTML = skeleton();
        }

        try {
            var res = await API.products.list({ limit: 500 });
            state.products = Array.isArray(res.products) ? res.products : [];
            applyAndRender();

        } catch (err) {
            console.error('[inventory] load failed:', err);
            if (tableHost) {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '⚠️',
                    title: 'Could not load products',
                    message: err.message || 'Please refresh the page.'
                });
            }
        }
    }

    /* =========================================================
       FILTER + SORT + RENDER
       ========================================================= */
    function applyAndRender() {
        var list = state.products.slice();

        // search: name, brand, id
        if (state.filters.q) {
            var q = state.filters.q.toLowerCase();
            list = list.filter(function (p) {
                var name = String(p.name || '').toLowerCase();
                var brand = String(p.brand || '').toLowerCase();
                var pid = String(p.id || '').toLowerCase();
                return name.indexOf(q) !== -1 ||
                    brand.indexOf(q) !== -1 ||
                    pid.indexOf(q) !== -1;
            });
        }

        // category
        if (state.filters.category !== 'all') {
            list = list.filter(function (p) {
                return p.category === state.filters.category;
            });
        }

        // stock status
        if (state.filters.status !== 'all') {
            list = list.filter(function (p) {
                var stock = Number(p.stock) || 0;
                var threshold = Number(p.lowStockThreshold) || 10;
                var s = state.filters.status;

                if (s === 'out') return stock === 0;
                if (s === 'low') return stock > 0 && stock <= threshold;
                if (s === 'ok') return stock > threshold;
                return true;
            });
        }

        // sort — lookup object instead of a switch
        var sorters = {
            'name': function (a, b) {
                return String(a.name || '').localeCompare(String(b.name || ''));
            },
            'name-desc': function (a, b) {
                return String(b.name || '').localeCompare(String(a.name || ''));
            },
            'stock-asc': function (a, b) {
                return (a.stock || 0) - (b.stock || 0);
            },
            'stock-desc': function (a, b) {
                return (b.stock || 0) - (a.stock || 0);
            },
            'price-asc': function (a, b) {
                return (a.price || 0) - (b.price || 0);
            },
            'price-desc': function (a, b) {
                return (b.price || 0) - (a.price || 0);
            },
            'newest': function (a, b) {
                var ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                var tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return tb - ta;
            }
        };
        list.sort(sorters[state.sort] || sorters.name);

        state.filtered = list;
        renderTable();
        updateCount();
    }

    function updateCount() {
        var total = state.products.length;
        var visible = state.filtered.length;

        if (countLabel) {
            if (visible === total) {
                countLabel.textContent = total + ' product' + (total === 1 ? '' : 's');
            } else {
                countLabel.textContent = visible + ' of ' + total + ' products';
            }
        }
    }

    function renderTable() {
        if (!tableHost) return;

        var list = state.filtered;

        // empty states
        if (list.length === 0) {
            if (state.products.length === 0) {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '📦',
                    title: 'No products yet',
                    message: 'Add your first product to get started.',
                    actionHtml:
                        '<button type="button" class="admin-btn admin-btn--primary" ' +
                        'onclick="document.getElementById(\'invAddBtn\').click()">+ Add product</button>'
                });
            } else {
                tableHost.innerHTML = AdminUI.emptyState({
                    icon: '🔍',
                    title: 'No matching products',
                    message: 'Try a different search or reset the filters.',
                    actionHtml:
                        '<button type="button" class="admin-btn admin-btn--outline" ' +
                        'onclick="document.getElementById(\'invResetFilters\').click()">Reset filters</button>'
                });
            }
            return;
        }

        var allChecked = list.every(function (p) {
            return state.selected.has(p.id);
        });

        tableHost.innerHTML = `
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th class="admin-th admin-th--center" style="width:38px">
                                <input type="checkbox" id="invSelectAll"
                                       ${allChecked ? 'checked' : ''}
                                       aria-label="Select all">
                            </th>
                            <th class="admin-th">Product</th>
                            <th class="admin-th">Category</th>
                            <th class="admin-th admin-th--right">Price</th>
                            <th class="admin-th admin-th--center">Stock</th>
                            <th class="admin-th admin-th--center">Status</th>
                            <th class="admin-th admin-th--right" style="width:140px">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${list.map(renderRow).join('')}</tbody>
                </table>
            </div>
        `;

        wireTableEvents();
    }

    function renderRow(p) {
        var esc = AdminUI.escapeHtml;
        var stock = Number(p.stock) || 0;
        var threshold = Number(p.lowStockThreshold) || 10;

        var status;
        if (stock === 0) {
            status = 'out';
        } else if (stock <= threshold) {
            status = 'low';
        } else {
            status = 'ok';
        }

        var checked = state.selected.has(p.id);
        var flash = state.lastEditedId === p.id;

        var toneClass, statusLabel;
        if (status === 'out') {
            toneClass = 'bad';
            statusLabel = 'Out of stock';
        } else if (status === 'low') {
            toneClass = 'warn';
            statusLabel = 'Low';
        } else {
            toneClass = 'ok';
            statusLabel = 'In stock';
        }

        var styleAttr = '';
        if (flash) {
            styleAttr = 'style="background:#fffbea;"';
        }

        var subcatHtml = '';
        if (p.subcategory) {
            subcatHtml = '<br><small class="admin-muted">' + esc(p.subcategory) + '</small>';
        }

        var mrpHtml = '';
        if (p.mrp > p.price) {
            mrpHtml = '<br><small class="admin-muted" style="text-decoration:line-through">' +
                AdminUI.money(p.mrp) + '</small>';
        }

        return `
            <tr data-id="${esc(p.id)}" ${styleAttr}>
                <td class="admin-td admin-td--center">
                    <input type="checkbox" class="inv-row-check"
                           data-id="${esc(p.id)}"
                           ${checked ? 'checked' : ''}
                           aria-label="Select ${esc(p.name)}">
                </td>

                <td class="admin-td">
                    <div class="admin-cell-media">
                        <img class="admin-thumb"
                             src="${esc((p.images && p.images[0]) || '')}"
                             alt=""
                             onerror="this.style.visibility='hidden'">
                        <div class="admin-cell-media__text">
                            <div class="admin-cell-media__name">${esc(p.name)}</div>
                            <div class="admin-cell-media__meta">${esc(p.brand || '—')} · ${esc(p.id)}</div>
                        </div>
                    </div>
                </td>

                <td class="admin-td">
                    <span class="admin-muted" style="text-transform:capitalize">
                        ${esc(p.category || '—')}
                    </span>
                    ${subcatHtml}
                </td>

                <td class="admin-td admin-td--right admin-td--strong">
                    ${AdminUI.money(p.price)}
                    ${mrpHtml}
                </td>

                <td class="admin-td admin-td--center">
                    <div class="inv-stock-cell" data-id="${esc(p.id)}">
                        <button type="button" class="inv-stock-btn" data-stock-action="dec"
                                data-id="${esc(p.id)}" aria-label="Decrease stock">−</button>
                        <button type="button" class="inv-stock-value"
                                data-stock-action="edit" data-id="${esc(p.id)}"
                                title="Click to set exact value">
                            ${stock}
                        </button>
                        <button type="button" class="inv-stock-btn" data-stock-action="inc"
                                data-id="${esc(p.id)}" aria-label="Increase stock">+</button>
                    </div>
                </td>

                <td class="admin-td admin-td--center">
                    <span class="admin-badge admin-badge--${toneClass}">${statusLabel}</span>
                </td>

                <td class="admin-td admin-td--right">
                    <div class="admin-row-actions">
                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm"
                                data-action="edit" data-id="${esc(p.id)}">Edit</button>
                        <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm"
                                data-action="delete" data-id="${esc(p.id)}"
                                style="color:var(--danger)">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }

    /* =========================================================
       TABLE EVENTS
       ========================================================= */
    function wireTableEvents() {
        // select all
        var selectAll = document.getElementById('invSelectAll');
        if (selectAll) {
            selectAll.addEventListener('change', function () {
                state.filtered.forEach(function (p) {
                    if (selectAll.checked) {
                        state.selected.add(p.id);
                    } else {
                        state.selected.delete(p.id);
                    }
                });
                renderTable();
                updateBulkBar();
            });
        }

        // individual checkboxes
        document.querySelectorAll('.inv-row-check').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var id = cb.dataset.id;
                if (cb.checked) {
                    state.selected.add(id);
                } else {
                    state.selected.delete(id);
                }
                updateBulkBar();
            });
        });

        // stock buttons
        document.querySelectorAll('[data-stock-action]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                var action = btn.dataset.stockAction;
                if (action === 'inc') return adjustStock(id, +1);
                if (action === 'dec') return adjustStock(id, -1);
                if (action === 'edit') return promptSetStock(id);
            });
        });

        // edit / delete
        document.querySelectorAll('[data-action]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                var action = btn.dataset.action;
                if (action === 'edit') return openProductModal(id);
                if (action === 'delete') return confirmDelete([id]);
            });
        });

        // clear the flash highlight after a moment
        if (state.lastEditedId) {
            setTimeout(function () {
                state.lastEditedId = null;
                document.querySelectorAll('tr[data-id]').forEach(function (tr) {
                    tr.style.background = '';
                });
            }, 1200);
        }
    }

    /* =========================================================
       TOOLBAR
       ========================================================= */
    function wireToolbar() {
        var search = document.getElementById('invSearch');
        var catEl = document.getElementById('invCategoryFilter');
        var statusEl = document.getElementById('invStatusFilter');
        var sortEl = document.getElementById('invSort');

        // debounced search
        var timer;
        search.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                state.filters.q = search.value.trim();
                applyAndRender();
            }, 180);
        });

        catEl.addEventListener('change', function (e) {
            state.filters.category = e.target.value;
            applyAndRender();
        });

        statusEl.addEventListener('change', function (e) {
            state.filters.status = e.target.value;
            applyAndRender();
        });

        sortEl.addEventListener('change', function (e) {
            state.sort = e.target.value;
            applyAndRender();
        });

        document.getElementById('invResetFilters').addEventListener('click', function () {
            state.filters = { q: '', category: 'all', brand: 'all', status: 'all' };
            state.sort = 'name';

            search.value = '';
            catEl.value = 'all';
            statusEl.value = 'all';
            sortEl.value = 'name';

            applyAndRender();
        });

        document.getElementById('invAddBtn').addEventListener('click', function () {
            openProductModal(null);
        });

        document.getElementById('invExportBtn').addEventListener('click', exportCSV);
    }

    /* =========================================================
       BULK BAR
       ========================================================= */
    function wireBulkBar() {
        document.getElementById('invBulkClear').addEventListener('click', function () {
            state.selected.clear();
            renderTable();
            updateBulkBar();
        });

        document.getElementById('invBulkRestock').addEventListener('click', bulkRestock);

        document.getElementById('invBulkDelete').addEventListener('click', function () {
            confirmDelete(Array.from(state.selected));
        });
    }

    function updateBulkBar() {
        if (!bulkBar) return;

        var count = state.selected.size;
        bulkBar.style.display = (count === 0) ? 'none' : 'block';

        if (count > 0) {
            document.getElementById('invBulkCount').textContent = count + ' selected';
        }
    }

    /* =========================================================
       STOCK ADJUST
       ========================================================= */
    async function adjustStock(id, delta) {
        var product = state.products.find(function (p) { return p.id === id; });
        if (!product) return;

        // optimistic UI
        var previousStock = product.stock;
        product.stock = Math.max(0, (product.stock || 0) + delta);
        renderTable();

        try {
            var res = await API.products.patchStock(id, { delta: delta });
            if (res && res.product) {
                var idx = state.products.findIndex(function (p) { return p.id === id; });
                if (idx !== -1) {
                    state.products[idx] = res.product;
                }
                state.lastEditedId = id;
                applyAndRender();
            }
        } catch (err) {
            // rollback
            product.stock = previousStock;
            renderTable();
            AdminUI.toast(err.message || 'Could not update stock', 'error');
        }
    }

    async function promptSetStock(id) {
        var product = state.products.find(function (p) { return p.id === id; });
        if (!product) return;

        var modal = AdminUI.openModal({
            title: 'Set stock',
            width: 'sm',
            content: `
                <div class="admin-field">
                    <label>New stock level for <strong>${AdminUI.escapeHtml(product.name)}</strong></label>
                    <input type="number" id="setStockInput"
                           value="${product.stock || 0}"
                           min="0" step="1" autocomplete="off">
                    <div class="admin-field__hint">
                        Current stock: ${product.stock} · threshold: ${product.lowStockThreshold || 10}
                    </div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
                    <button type="button" class="admin-btn admin-btn--ghost" data-role="cancel">Cancel</button>
                    <button type="button" class="admin-btn admin-btn--primary" data-role="save">Save</button>
                </div>
            `
        });

        var input = modal.el.querySelector('#setStockInput');
        setTimeout(function () {
            input.focus();
            input.select();
        }, 50);

        async function save() {
            var newStock = parseInt(input.value, 10);
            if (!Number.isFinite(newStock) || newStock < 0) {
                AdminUI.toast('Please enter a valid number', 'error');
                input.focus();
                return;
            }
            modal.close();

            try {
                var res = await API.products.patchStock(id, { set: newStock });
                if (res && res.product) {
                    var idx = state.products.findIndex(function (p) { return p.id === id; });
                    if (idx !== -1) {
                        state.products[idx] = res.product;
                    }
                    state.lastEditedId = id;
                    applyAndRender();
                    AdminUI.toast('Stock updated', 'success');
                }
            } catch (err) {
                AdminUI.toast(err.message || 'Could not update stock', 'error');
            }
        }

        modal.el.querySelector('[data-role="save"]').addEventListener('click', save);
        modal.el.querySelector('[data-role="cancel"]').addEventListener('click', function () {
            modal.close();
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') save();
        });
    }

    /* =========================================================
       ADD / EDIT PRODUCT MODAL
       ========================================================= */
    function openProductModal(id) {
        var isEdit = !!id;
        var existing = isEdit ? state.products.find(function (p) { return p.id === id; }) : null;

        if (isEdit && !existing) {
            AdminUI.toast('Product not found', 'error');
            return;
        }

        var p = existing || {
            name: '', brand: '', category: '', subcategory: '',
            price: '', mrp: '', cost: '', stock: 0, lowStockThreshold: 10,
            description: '', images: [], features: [], tags: [], specifications: {}
        };

        var catOptions = state.categories.map(function (c) {
            return '<option value="' + AdminUI.escapeHtml(c) + '"></option>';
        }).join('');

        var modal = AdminUI.openModal({
            title: isEdit ? 'Edit product' : 'Add product',
            width: 'lg',
            content: `
                <form id="invProductForm" class="admin-form admin-form--2col" novalidate>

                    <div class="admin-field admin-field--full">
                        <label for="pName">Product name <span class="req">*</span></label>
                        <input type="text" id="pName" name="name"
                               value="${AdminUI.escapeHtml(p.name)}"
                               placeholder="e.g. Apple iPhone 15 Pro" required>
                    </div>

                    <div class="admin-field">
                        <label for="pBrand">Brand <span class="req">*</span></label>
                        <input type="text" id="pBrand" name="brand"
                               value="${AdminUI.escapeHtml(p.brand)}"
                               placeholder="e.g. Apple" required>
                    </div>

                    <div class="admin-field">
                        <label for="pCategory">Category <span class="req">*</span></label>
                        <input type="text" id="pCategory" name="category"
                               value="${AdminUI.escapeHtml(p.category)}"
                               list="invCategories"
                               placeholder="e.g. electronics" required>
                        <datalist id="invCategories">${catOptions}</datalist>
                    </div>

                    <div class="admin-field">
                        <label for="pSubcategory">Subcategory</label>
                        <input type="text" id="pSubcategory" name="subcategory"
                               value="${AdminUI.escapeHtml(p.subcategory || '')}"
                               placeholder="e.g. smartphones">
                    </div>

                    <div class="admin-field">
                        <label for="pPrice">Selling price (₹) <span class="req">*</span></label>
                        <input type="number" id="pPrice" name="price"
                               value="${p.price || ''}"
                               min="0.01" step="0.01" required>
                    </div>

                    <div class="admin-field">
                        <label for="pMrp">MRP (₹) <span class="req">*</span></label>
                        <input type="number" id="pMrp" name="mrp"
                               value="${p.mrp || ''}"
                               min="0.01" step="0.01" required>
                    </div>

                    <div class="admin-field">
                        <label for="pCost">Cost price (₹)</label>
                        <input type="number" id="pCost" name="cost"
                               value="${p.cost || ''}"
                               min="0" step="0.01">
                        <div class="admin-field__hint">Optional — used for profit analytics</div>
                    </div>

                    <div class="admin-field">
                        <label for="pStock">Stock <span class="req">*</span></label>
                        <input type="number" id="pStock" name="stock"
                               value="${p.stock || 0}"
                               min="0" step="1" required>
                    </div>

                    <div class="admin-field">
                        <label for="pThreshold">Low-stock threshold</label>
                        <input type="number" id="pThreshold" name="lowStockThreshold"
                               value="${p.lowStockThreshold || 10}"
                               min="0" step="1">
                        <div class="admin-field__hint">Alert when stock drops to this level</div>
                    </div>

                    <div class="admin-field admin-field--full">
                        <label for="pImages">Image URLs (one per line)</label>
                        <textarea id="pImages" name="images" rows="3"
                                  placeholder="https://example.com/image.jpg">${(p.images || []).join('\n')}</textarea>
                    </div>

                    <div class="admin-field admin-field--full">
                        <label for="pDescription">Description</label>
                        <textarea id="pDescription" name="description" rows="3"
                                  placeholder="Short product description…">${AdminUI.escapeHtml(p.description || '')}</textarea>
                    </div>

                    <div class="admin-field admin-field--full">
                        <label for="pFeatures">Key features (one per line)</label>
                        <textarea id="pFeatures" name="features" rows="3"
                                  placeholder="Titanium design&#10;A17 Pro chip">${(p.features || []).join('\n')}</textarea>
                    </div>

                    <div class="admin-field admin-field--full">
                        <label for="pTags">Tags</label>
                        <input type="text" id="pTags" name="tags"
                               value="${(p.tags || []).join(', ')}"
                               placeholder="featured, bestseller, new">
                        <div class="admin-field__hint">
                            Comma-separated. Lowercase letters, numbers and dashes only
                            (e.g. <code>featured</code>, <code>running</code>, <code>winter-sale</code>).
                        </div>
                    </div>

                    <div class="admin-field admin-field--full" id="invFormErrors" hidden></div>
                </form>
            `
        });

        // footer with action buttons
        var footer = document.createElement('div');
        footer.className = 'admin-modal__actions';
        footer.innerHTML = `
            <button type="button" class="admin-btn admin-btn--ghost" data-role="cancel">Cancel</button>
            <button type="button" class="admin-btn admin-btn--primary" data-role="save">
                ${isEdit ? 'Save changes' : 'Create product'}
            </button>
        `;
        modal.el.querySelector('.admin-modal').appendChild(footer);

        modal.el.querySelector('[data-role="cancel"]').addEventListener('click', function () {
            modal.close();
        });

        var saveBtn = modal.el.querySelector('[data-role="save"]');
        saveBtn.addEventListener('click', function () {
            submitForm(isEdit ? id : null, modal, saveBtn);
        });

        setTimeout(function () {
            var first = modal.el.querySelector('#pName');
            if (first) first.focus();
        }, 60);
    }

    async function submitForm(id, modal, saveBtn) {
        var form = modal.el.querySelector('#invProductForm');
        var errorsHost = modal.el.querySelector('#invFormErrors');

        errorsHost.hidden = true;
        errorsHost.innerHTML = '';

        var fd = new FormData(form);

        function toLines(str) {
            return String(str || '').split('\n').map(function (s) {
                return s.trim();
            }).filter(function (s) {
                return s !== '';
            });
        }

        function toList(str) {
            return String(str || '').split(',').map(function (s) {
                return s.trim();
            }).filter(function (s) {
                return s !== '';
            });
        }

        var payload = {
            name: String(fd.get('name') || '').trim(),
            brand: String(fd.get('brand') || '').trim(),
            category: String(fd.get('category') || '').trim().toLowerCase(),
            subcategory: String(fd.get('subcategory') || '').trim().toLowerCase(),
            price: Number(fd.get('price')),
            mrp: Number(fd.get('mrp')),
            stock: parseInt(fd.get('stock'), 10),
            description: String(fd.get('description') || '').trim(),
            images: toLines(fd.get('images')),
            features: toLines(fd.get('features')),
            tags: toList(fd.get('tags'))
        };

        var cost = fd.get('cost');
        var threshold = fd.get('lowStockThreshold');

        if (cost !== null && String(cost).trim() !== '') {
            payload.cost = Number(cost);
        }
        if (threshold !== null && String(threshold).trim() !== '') {
            payload.lowStockThreshold = parseInt(threshold, 10);
        }

        // client-side sanity checks
        if (!payload.name || payload.name.length < 2) {
            return showFormError(modal, 'Product name is required', 'name');
        }
        if (!payload.brand) {
            return showFormError(modal, 'Brand is required', 'brand');
        }
        if (!payload.category) {
            return showFormError(modal, 'Category is required', 'category');
        }
        if (!Number.isFinite(payload.price) || payload.price <= 0) {
            return showFormError(modal, 'Price must be a positive number', 'price');
        }
        if (!Number.isFinite(payload.mrp) || payload.mrp <= 0) {
            return showFormError(modal, 'MRP must be a positive number', 'mrp');
        }
        if (payload.mrp < payload.price) {
            return showFormError(modal, 'MRP cannot be less than the selling price', 'mrp');
        }
        if (!Number.isFinite(payload.stock) || payload.stock < 0) {
            return showFormError(modal, 'Stock must be zero or greater', 'stock');
        }

        // submit
        saveBtn.disabled = true;
        var originalLabel = saveBtn.textContent;
        saveBtn.textContent = 'Saving…';

        try {
            var res;
            if (id) {
                res = await API.products.update(id, payload);
            } else {
                res = await API.products.create(payload);
            }

            if (!res || !res.ok || !res.product) {
                throw new Error((res && res.error) || 'Save failed');
            }

            // update local list
            if (id) {
                var idx = state.products.findIndex(function (p) { return p.id === id; });
                if (idx !== -1) {
                    state.products[idx] = res.product;
                }
            } else {
                state.products.push(res.product);
            }

            state.lastEditedId = res.product.id;
            modal.close();
            applyAndRender();
            AdminUI.toast(id ? 'Product updated' : 'Product created', 'success');

        } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalLabel;
            showFormError(modal, err.message || 'Could not save product');
        }
    }

    function showFormError(modal, message, field) {
        var host = modal.el.querySelector('#invFormErrors');
        if (!host) return;

        host.hidden = false;
        host.innerHTML =
            '<div class="admin-banner admin-banner--error">' +
            AdminUI.escapeHtml(message) +
            '</div>';

        if (!field) return;

        var input = modal.el.querySelector('[name="' + field + '"]');
        if (!input) return;

        var wrapper = input.closest('.admin-field');
        if (!wrapper) return;

        wrapper.classList.add('admin-field--error');
        input.focus();
        input.addEventListener('input', function () {
            wrapper.classList.remove('admin-field--error');
            host.hidden = true;
        }, { once: true });
    }

    /* =========================================================
       DELETE
       ========================================================= */
    async function confirmDelete(ids) {
        if (ids.length === 0) return;

        var label;
        if (ids.length === 1) {
            label = 'this product';
        } else {
            label = ids.length + ' products';
        }

        var ok = await AdminUI.confirm({
            title: 'Delete ' + label + '?',
            message: 'This action cannot be undone. The product will be removed from the catalogue.',
            okLabel: 'Delete',
            danger: true
        });
        if (!ok) return;

        var deleted = 0;
        var failures = [];

        AdminUI.showLoader('Deleting…');

        // sequential to avoid hammering the server
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            try {
                await API.products.remove(id);
                state.products = state.products.filter(function (p) {
                    return p.id !== id;
                });
                state.selected.delete(id);
                deleted++;
            } catch (err) {
                failures.push({ id: id, error: err.message });
            }
        }

        AdminUI.hideLoader();
        applyAndRender();
        updateBulkBar();

        if (deleted > 0 && failures.length === 0) {
            AdminUI.toast(
                deleted === 1 ? 'Product deleted' : deleted + ' products deleted',
                'success'
            );
        } else if (failures.length > 0 && deleted === 0) {
            AdminUI.toast('Could not delete: ' + failures[0].error, 'error');
        } else if (failures.length > 0) {
            AdminUI.toast(deleted + ' deleted, ' + failures.length + ' failed', 'warn');
        }
    }

    /* =========================================================
       BULK RESTOCK
       ========================================================= */
    async function bulkRestock() {
        var ids = Array.from(state.selected);
        if (ids.length === 0) return;

        var previewItems = ids.slice(0, 8).map(function (id) {
            var p = state.products.find(function (x) { return x.id === id; });
            if (p) {
                return '<li>' + AdminUI.escapeHtml(p.name) + '</li>';
            }
            return '';
        }).join('');

        var previewExtra = '';
        if (ids.length > 8) {
            previewExtra = '<li>… and ' + (ids.length - 8) + ' more</li>';
        }

        var preview = previewItems + previewExtra;

        var modal = AdminUI.openModal({
            title: 'Bulk restock',
            width: 'md',
            content: `
                <div class="admin-field">
                    <label>Add stock to <strong>${ids.length}</strong> product${ids.length === 1 ? '' : 's'}</label>
                    <input type="number" id="bulkRestockAmount"
                           value="20" min="1" step="1" autocomplete="off">
                    <div class="admin-field__hint">
                        The amount will be ADDED to each product's current stock.
                    </div>
                </div>
                <div style="margin-top:12px;font-size:.84rem;color:var(--muted)">
                    Products affected:
                    <ul style="margin:6px 0 0 18px;padding:0">${preview}</ul>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
                    <button type="button" class="admin-btn admin-btn--ghost" data-role="cancel">Cancel</button>
                    <button type="button" class="admin-btn admin-btn--primary" data-role="save">Restock</button>
                </div>
            `
        });

        var input = modal.el.querySelector('#bulkRestockAmount');
        setTimeout(function () {
            input.focus();
            input.select();
        }, 50);

        async function apply() {
            var amount = parseInt(input.value, 10);
            if (!Number.isFinite(amount) || amount < 1) {
                AdminUI.toast('Please enter a valid amount', 'error');
                input.focus();
                return;
            }

            modal.close();
            AdminUI.showLoader('Restocking…');

            var updates = ids.map(function (productId) {
                return { productId: productId, delta: amount };
            });

            try {
                var res = await API.request('POST', '/api/alerts/restock', {
                    body: { updates: updates }
                });

                await loadProducts(false);
                state.selected.clear();
                updateBulkBar();

                var applied = (res && res.applied) ? res.applied.length : ids.length;
                AdminUI.toast(applied + ' products restocked', 'success');

            } catch (err) {
                AdminUI.toast(err.message || 'Restock failed', 'error');
            } finally {
                AdminUI.hideLoader();
            }
        }

        modal.el.querySelector('[data-role="save"]').addEventListener('click', apply);
        modal.el.querySelector('[data-role="cancel"]').addEventListener('click', function () {
            modal.close();
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') apply();
        });
    }

    /* =========================================================
       EXPORT CSV
       ========================================================= */
    function exportCSV() {
        var list = state.filtered;
        if (list.length === 0) {
            AdminUI.toast('Nothing to export', 'warn');
            return;
        }

        var headers = [
            'ID', 'Name', 'Brand', 'Category', 'Subcategory',
            'Price', 'MRP', 'Cost', 'Stock', 'Threshold',
            'Tags', 'Created', 'Updated'
        ];

        var rows = list.map(function (p) {
            return [
                p.id, p.name, p.brand, p.category, p.subcategory || '',
                p.price, p.mrp, p.cost || '', p.stock, p.lowStockThreshold || 10,
                (p.tags || []).join('|'), p.createdAt || '', p.updatedAt || ''
            ];
        });

        var allRows = [headers].concat(rows);

        var csvLines = allRows.map(function (row) {
            var cells = row.map(function (cell) {
                var s;
                if (cell === null || cell === undefined) {
                    s = '';
                } else {
                    s = String(cell);
                }
                if (/[",\n]/.test(s)) {
                    return '"' + s.replace(/"/g, '""') + '"';
                }
                return s;
            });
            return cells.join(',');
        });

        var csv = csvLines.join('\n');

        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');

        a.href = url;
        a.download = 'TeamZampXUnited-products-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        AdminUI.toast('Exported ' + list.length + ' products', 'success');
    }

    /* =========================================================
       LIVE SOCKET
       ========================================================= */
    function openLiveSocket() {
        if (typeof io !== 'function') return;

        var socket;
        try {
            socket = io({
                auth: { token: API.token.get() },
                transports: ['websocket', 'polling']
            });
        } catch (e) {
            return;
        }

        socket.on('activity:new', function (entry) {
            if (!entry || !entry.type) return;

            var affectsProducts =
                entry.type.indexOf('product:') === 0 ||
                entry.type.indexOf('stock:') === 0;

            if (affectsProducts) scheduleSocketReload();
        });
    }

})();