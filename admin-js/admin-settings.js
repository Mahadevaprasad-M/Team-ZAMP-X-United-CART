'use strict';

(function () {

    // ---------- page state ----------
    var state = {
        settings: null,
        categories: [],
        dirty: false   // true if the form has unsaved changes
    };

    var settingsForm, categoriesHost;

    var ALLOWED_SVG_TAGS = new Set([
        'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline',
        'polygon', 'ellipse', 'defs', 'title', 'desc', 'linearGradient',
        'radialGradient', 'stop', 'clipPath', 'mask', 'pattern'
    ]);

    var ALLOWED_SVG_ATTRS = new Set([
        'xmlns', 'viewbox', 'width', 'height', 'fill', 'stroke',
        'stroke-width', 'stroke-linecap', 'stroke-linejoin',
        'stroke-dasharray', 'stroke-dashoffset', 'd', 'cx', 'cy', 'r',
        'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points',
        'transform', 'opacity', 'fill-opacity', 'stroke-opacity',
        'fill-rule', 'clip-rule', 'id', 'offset', 'stop-color',
        'stop-opacity', 'gradientunits', 'gradienttransform', 'class'
    ]);

    // small helper: same behaviour as `a ?? b`
    // (only falls back when the value is null or undefined — a 0 or '' is kept)
    function orDefault(value, fallback) {
        if (value === null || value === undefined) return fallback;
        return value;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeSvg(input) {
        if (typeof input !== 'string' || input.trim() === '') return '';

        // only attempt to parse if it looks like an SVG
        var trimmed = input.trim();
        if (!/^<svg[\s>]/i.test(trimmed)) {
            // not an SVG — treat as plain text (escaped)
            return escapeHtml(trimmed);
        }

        var doc;
        try {
            doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
        } catch (e) {
            return '';
        }

        // parser error -> return empty
        if (!doc || !doc.documentElement) return '';
        if (doc.querySelector('parsererror')) return '';

        var root = doc.documentElement;
        if (root.nodeName.toLowerCase() !== 'svg') return '';

        // walk the tree and strip anything not on the allow-list
        function clean(node) {
            // snapshot first — we may remove child nodes while looping
            var children = Array.from(node.childNodes);

            for (var i = 0; i < children.length; i++) {
                var child = children[i];

                // skip text nodes
                if (child.nodeType !== 1) continue;

                var tag = child.nodeName.toLowerCase();

                if (!ALLOWED_SVG_TAGS.has(tag)) {
                    child.remove();
                    continue;
                }

                // strip unsafe attributes
                // (snapshot first — removeAttribute mutates the live list)
                var attrs = Array.from(child.attributes);

                for (var j = 0; j < attrs.length; j++) {
                    var attr = attrs[j];
                    var name = attr.name.toLowerCase();
                    var val = String(attr.value || '').trim().toLowerCase();

                    // remove all event handlers
                    if (name.indexOf('on') === 0) {
                        child.removeAttribute(attr.name);
                        continue;
                    }

                    // remove unknown attributes
                    if (!ALLOWED_SVG_ATTRS.has(name)) {
                        child.removeAttribute(attr.name);
                        continue;
                    }

                    // block javascript: and data:text/html URLs
                    if (/^(javascript|data):/i.test(val) &&
                        !/^data:image\//i.test(val)) {
                        child.removeAttribute(attr.name);
                    }
                }

                // recurse
                clean(child);
            }
        }

        clean(root);

        return root.outerHTML;
    }


    /* =========================================================
       BOOT
       ========================================================= */
    document.addEventListener('DOMContentLoaded', async function () {
        var user = await AdminAuth.require();
        if (!user) return;

        AdminUI.mount({
            activePage: 'settings',
            title: 'Settings',
            subtitle: 'Store configuration and categories',
            content: renderLayout()
        });

        settingsForm = document.getElementById('setForm');
        categoriesHost = document.getElementById('setCategories');

        wireForm();
        wireCategories();
        wirePasswordChange();

        await loadSettings();
    });

    /* =========================================================
       LAYOUT  (HTML stays the same)
       ========================================================= */
    function renderLayout() {
        return `
            <section class="admin-card admin-mb-3">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">Store settings</h3>
                        <p class="admin-card__subtitle">Basic configuration that applies storewide</p>
                    </div>
                </div>

                <div class="admin-card__body">
                    <form id="setForm" class="admin-form admin-form--2col" novalidate>

                        <div class="admin-field admin-field--full">
                            <label for="setStoreName">Store name <span class="req">*</span></label>
                            <input type="text" id="setStoreName" name="storeName"
                                   placeholder="TeamZampXUnited" required>
                        </div>

                        <div class="admin-field">
                            <label for="setCurrency">Currency</label>
                            <select id="setCurrency" name="currency">
                                <option value="INR">INR — Indian Rupee (₹)</option>
                                <option value="USD">USD — US Dollar ($)</option>
                                <option value="EUR">EUR — Euro (€)</option>
                                <option value="GBP">GBP — Pound Sterling (£)</option>
                            </select>
                        </div>

                        <div class="admin-field">
                            <label for="setTax">Tax percent (%)</label>
                            <input type="number" id="setTax" name="taxPercent"
                                   min="0" max="100" step="0.01" placeholder="0">
                            <div class="admin-field__hint">Applied to every order subtotal</div>
                        </div>

                        <div class="admin-field">
                            <label for="setFreeShip">Free shipping threshold (₹)</label>
                            <input type="number" id="setFreeShip" name="freeShippingThreshold"
                                   min="0" step="1" placeholder="499">
                            <div class="admin-field__hint">Orders above this ship free</div>
                        </div>

                        <div class="admin-field">
                            <label for="setShipFee">Shipping fee (₹)</label>
                            <input type="number" id="setShipFee" name="shippingFee"
                                   min="0" step="1" placeholder="49">
                            <div class="admin-field__hint">Applied below the threshold</div>
                        </div>

                        <div class="admin-field">
                            <label for="setLowStock">Default low-stock threshold</label>
                            <input type="number" id="setLowStock" name="defaultLowStockThreshold"
                                   min="0" step="1" placeholder="10">
                            <div class="admin-field__hint">Used when a product has no per-item threshold</div>
                        </div>

                        <div class="admin-field">
                            <label>Low-stock alerts</label>
                            <label class="set-switch">
                                <input type="checkbox" id="setAlertsEnabled" name="lowStockAlertsEnabled">
                                <span class="set-switch__slider"></span>
                                <span class="set-switch__label">Enabled</span>
                            </label>
                            <div class="admin-field__hint">Show the alerts badge and page notifications</div>
                        </div>

                        <div class="admin-field admin-field--full"
                             style="flex-direction:row;justify-content:flex-end;gap:8px;margin-top:6px">
                            <button type="button" class="admin-btn admin-btn--ghost" id="setRevertBtn">
                                Revert changes
                            </button>
                            <button type="submit" class="admin-btn admin-btn--primary" id="setSaveBtn">
                                Save settings
                            </button>
                        </div>
                    </form>
                </div>
            </section>

            <section class="admin-card admin-mb-3">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">Categories</h3>
                        <p class="admin-card__subtitle" id="setCatCount">Loading…</p>
                    </div>
                    <button type="button" class="admin-btn admin-btn--primary admin-btn--sm" id="setAddCatBtn">
                        + Add category
                    </button>
                </div>

                <div class="admin-card__body admin-card__body--flush" id="setCategories">
                    <div style="padding:40px;text-align:center;color:var(--muted)">Loading…</div>
                </div>
            </section>

            <section class="admin-card">
                <div class="admin-card__head">
                    <div>
                        <h3 class="admin-card__title">Change password</h3>
                        <p class="admin-card__subtitle">Update your admin account password</p>
                    </div>
                </div>

                <div class="admin-card__body">
                    <form id="setPwdForm" class="admin-form admin-form--2col" novalidate>
                        <div class="admin-field">
                            <label for="setPwdCurrent">Current password</label>
                            <input type="password" id="setPwdCurrent" name="currentPassword" required>
                        </div>
                        <div class="admin-field"></div>

                        <div class="admin-field">
                            <label for="setPwdNew">New password</label>
                            <input type="password" id="setPwdNew" name="newPassword" minlength="6" required>
                        </div>
                        <div class="admin-field">
                            <label for="setPwdConfirm">Confirm new password</label>
                            <input type="password" id="setPwdConfirm" name="confirmPassword" minlength="6" required>
                        </div>

                        <div class="admin-field admin-field--full"
                             style="flex-direction:row;justify-content:flex-end;margin-top:6px">
                            <button type="submit" class="admin-btn admin-btn--outline" id="setPwdBtn">
                                Update password
                            </button>
                        </div>
                    </form>
                </div>
            </section>
        `;
    }

    /* =========================================================
       LOAD
       ========================================================= */
    async function loadSettings() {
        try {
            var res = await API.settings.get();
            state.settings = res.settings || {};
            state.categories = res.categories || [];

            fillForm();
            renderCategories();

        } catch (err) {
            console.error('[settings] load failed:', err);
            AdminUI.toast(err.message || 'Could not load settings', 'error');
        }
    }

    /* =========================================================
       STORE SETTINGS FORM
       ========================================================= */
    function fillForm() {
        var s = state.settings || {};

        document.getElementById('setStoreName').value = s.storeName || '';
        document.getElementById('setCurrency').value = s.currency || 'INR';
        document.getElementById('setTax').value = orDefault(s.taxPercent, 0);
        document.getElementById('setFreeShip').value = orDefault(s.freeShippingThreshold, 499);
        document.getElementById('setShipFee').value = orDefault(s.shippingFee, 49);
        document.getElementById('setLowStock').value = orDefault(s.defaultLowStockThreshold, 10);
        document.getElementById('setAlertsEnabled').checked = (s.lowStockAlertsEnabled !== false);

        state.dirty = false;
    }

    function wireForm() {
        if (!settingsForm) return;

        // mark form as dirty on any change
        settingsForm.addEventListener('input', function () { state.dirty = true; });
        settingsForm.addEventListener('change', function () { state.dirty = true; });

        // revert button
        document.getElementById('setRevertBtn').addEventListener('click', function () {
            fillForm();
            AdminUI.toast('Changes reverted');
        });

        // submit
        settingsForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            var btn = document.getElementById('setSaveBtn');
            var payload = {
                storeName: document.getElementById('setStoreName').value.trim(),
                currency: document.getElementById('setCurrency').value,
                taxPercent: Number(document.getElementById('setTax').value) || 0,
                freeShippingThreshold: Number(document.getElementById('setFreeShip').value),
                shippingFee: Number(document.getElementById('setShipFee').value),
                defaultLowStockThreshold: Number(document.getElementById('setLowStock').value),
                lowStockAlertsEnabled: document.getElementById('setAlertsEnabled').checked
            };

            // validation
            var errors = validateSettings(payload);
            if (errors) {
                AdminUI.toast(errors, 'error');
                return;
            }

            btn.disabled = true;
            var original = btn.textContent;
            btn.textContent = 'Saving…';

            try {
                var res = await API.settings.update(payload);
                if (!res || !res.ok) {
                    throw new Error((res && res.error) || 'Save failed');
                }

                state.settings = res.settings || state.settings;
                state.dirty = false;
                fillForm();
                AdminUI.toast('Settings saved', 'success');

            } catch (err) {
                AdminUI.toast(err.message || 'Could not save settings', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = original;
            }
        });

        // warn before leaving with unsaved changes
        window.addEventListener('beforeunload', function (e) {
            if (!state.dirty) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }

    // Returns an error message string, or null if valid.
    function validateSettings(p) {
        if (!p.storeName) {
            return 'Store name is required';
        }
        if (!Number.isFinite(p.freeShippingThreshold) || p.freeShippingThreshold < 0) {
            return 'Free-shipping threshold must be 0 or greater';
        }
        if (!Number.isFinite(p.shippingFee) || p.shippingFee < 0) {
            return 'Shipping fee must be 0 or greater';
        }
        if (!Number.isFinite(p.defaultLowStockThreshold) || p.defaultLowStockThreshold < 0) {
            return 'Low-stock threshold must be 0 or greater';
        }
        if (!Number.isFinite(p.taxPercent) || p.taxPercent < 0 || p.taxPercent > 100) {
            return 'Tax percent must be between 0 and 100';
        }
        return null;
    }

    /* =========================================================
       CATEGORIES
       ========================================================= */
    function wireCategories() {
        document.getElementById('setAddCatBtn').addEventListener('click', openAddCategoryModal);
    }

    function renderCategories() {
        if (!categoriesHost) return;

        var list = state.categories || [];

        var countEl = document.getElementById('setCatCount');
        if (countEl) {
            if (list.length === 0) {
                countEl.textContent = 'No categories yet';
            } else {
                countEl.textContent = list.length + ' categor' + (list.length === 1 ? 'y' : 'ies');
            }
        }

        if (list.length === 0) {
            categoriesHost.innerHTML = `
                <div style="padding:40px;text-align:center;color:var(--muted)">
                    <div style="font-size:2rem;margin-bottom:8px">🗂️</div>
                    <div style="font-weight:600;color:var(--fg);margin-bottom:4px">
                        No categories yet
                    </div>
                    <div style="font-size:.85rem">
                        Add your first category to organise products.
                    </div>
                </div>
            `;
            return;
        }

        var rows = list.map(renderCategoryRow).join('');
        categoriesHost.innerHTML = '<div class="set-cat-list">' + rows + '</div>';

        // wire delete buttons
        var delBtns = categoriesHost.querySelectorAll('[data-action="delete-category"]');
        for (var i = 0; i < delBtns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    confirmDeleteCategory(btn.dataset.id, btn.dataset.name);
                });
            })(delBtns[i]);
        }
    }

    function renderCategoryRow(c) {
        var esc = AdminUI.escapeHtml;
        var icon = c.icon || '';
        var color = c.color || '#f5f5f5';

        // sanitise the icon — blocks <script>, on* handlers, etc.
        var safeIcon = sanitizeSvg(icon);

        return `
            <div class="set-cat-row" data-id="${esc(c.id)}">
                <div class="set-cat-icon" style="background:${esc(color)}">
                    ${safeIcon || '<span style="font-size:1rem">📁</span>'}
                </div>
                <div class="set-cat-text">
                    <div class="set-cat-name">${esc(c.name)}</div>
                    <div class="set-cat-id">${esc(c.id)}</div>
                </div>
                <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm"
                        data-action="delete-category"
                        data-id="${esc(c.id)}"
                        data-name="${esc(c.name)}"
                        style="color:var(--danger)">
                    Delete
                </button>
            </div>
        `;
    }

    function openAddCategoryModal() {
        var modal = AdminUI.openModal({
            title: 'Add category',
            width: 'md',
            content: `
                <div class="admin-form">
                    <div class="admin-field">
                        <label for="catName">Category name <span class="req">*</span></label>
                        <input type="text" id="catName" name="name"
                               placeholder="e.g. Home & Kitchen" required>
                        <div class="admin-field__hint">A URL-friendly id will be generated automatically.</div>
                    </div>

                    <div class="admin-field">
                        <label for="catColor">Accent color</label>
                        <input type="text" id="catColor" name="color"
                               placeholder="#f5f5f5" value="#f5f5f5">
                        <div class="admin-field__hint">Hex color used in category badges</div>
                    </div>

                    <div class="admin-field">
                        <label for="catIcon">Icon (optional SVG markup)</label>
                        <textarea id="catIcon" name="icon" rows="3"
                                  placeholder='&lt;svg&gt;...&lt;/svg&gt;'></textarea>
                        <div class="admin-field__hint">Leave empty for a default folder icon.</div>
                    </div>

                    <div id="catFormError" hidden></div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
                    <button type="button" class="admin-btn admin-btn--ghost" data-role="cancel">Cancel</button>
                    <button type="button" class="admin-btn admin-btn--primary" data-role="save">
                        Create category
                    </button>
                </div>
            `
        });

        var nameInput = modal.el.querySelector('#catName');
        var colorInput = modal.el.querySelector('#catColor');
        var iconInput = modal.el.querySelector('#catIcon');
        var errHost = modal.el.querySelector('#catFormError');
        var saveBtn = modal.el.querySelector('[data-role="save"]');

        setTimeout(function () { nameInput.focus(); }, 60);

        modal.el.querySelector('[data-role="cancel"]').addEventListener('click', function () {
            modal.close();
        });

        async function save() {
            errHost.hidden = true;

            var name = nameInput.value.trim();
            var color = colorInput.value.trim() || '#f5f5f5';
            var icon = iconInput.value.trim();

            if (!name) {
                showCategoryError('Category name is required');
                nameInput.focus();
                return;
            }

            // sanitise before sending to the server
            var safeIcon = sanitizeSvg(icon);

            saveBtn.disabled = true;
            var original = saveBtn.textContent;
            saveBtn.textContent = 'Saving…';

            try {
                var res = await API.request('POST', '/api/settings/categories', {
                    body: { name: name, color: color, icon: safeIcon }
                });

                if (!res || !res.ok) {
                    throw new Error((res && res.error) || 'Could not create category');
                }

                state.categories = res.categories || [];
                renderCategories();
                modal.close();
                AdminUI.toast('Category created', 'success');

            } catch (err) {
                saveBtn.disabled = false;
                saveBtn.textContent = original;
                showCategoryError(err.message || 'Failed to save');
            }
        }

        function showCategoryError(message) {
            errHost.hidden = false;
            errHost.innerHTML =
                '<div class="admin-banner admin-banner--error" style="margin-top:12px">' +
                AdminUI.escapeHtml(message) +
                '</div>';
        }

        saveBtn.addEventListener('click', save);
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') save();
        });
    }

    async function confirmDeleteCategory(id, name) {
        var ok = await AdminUI.confirm({
            title: 'Delete category "' + name + '"?',
            message: 'Products in this category will keep their category id but lose the link. They can be re-categorised later.',
            okLabel: 'Delete category',
            danger: true
        });
        if (!ok) return;

        try {
            var res = await API.request('DELETE',
                '/api/settings/categories/' + encodeURIComponent(id));

            if (!res || !res.ok) {
                throw new Error((res && res.error) || 'Delete failed');
            }

            state.categories = res.categories || [];
            renderCategories();

            var msg;
            if (res.affectedProducts > 0) {
                msg = 'Category deleted · ' + res.affectedProducts + ' product(s) affected';
            } else {
                msg = 'Category deleted';
            }
            AdminUI.toast(msg, 'success');

        } catch (err) {
            AdminUI.toast(err.message || 'Could not delete category', 'error');
        }
    }

    /* =========================================================
       CHANGE PASSWORD
       ========================================================= */
    function wirePasswordChange() {
        var form = document.getElementById('setPwdForm');
        if (!form) return;

        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            var current = form.currentPassword.value;
            var newPwd = form.newPassword.value;
            var confirm = form.confirmPassword.value;

            // validation
            if (!current || !newPwd || !confirm) {
                AdminUI.toast('Please fill in all password fields', 'error');
                return;
            }
            if (newPwd.length < 6) {
                AdminUI.toast('New password must be at least 6 characters', 'error');
                return;
            }
            if (newPwd !== confirm) {
                AdminUI.toast('New passwords do not match', 'error');
                return;
            }
            if (newPwd === current) {
                AdminUI.toast('New password must differ from the current one', 'error');
                return;
            }

            var btn = document.getElementById('setPwdBtn');
            btn.disabled = true;
            var original = btn.textContent;
            btn.textContent = 'Updating…';

            try {
                await API.auth.changePassword(current, newPwd);
                form.reset();
                AdminUI.toast('Password updated successfully', 'success');
            } catch (err) {
                AdminUI.toast(err.message || 'Could not update password', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = original;
            }
        });
    }

    /* =========================================================
       INJECT PAGE STYLES  (CSS unchanged)
       ========================================================= */
    (function injectStyles() {
        if (document.getElementById('setStyles')) return;

        var s = document.createElement('style');
        s.id = 'setStyles';
        s.textContent = `
            /* Category list */
            .set-cat-list { padding: 8px 0; }

            .set-cat-row {
                display: flex;
                align-items: center;
                gap: 14px;
                padding: 14px 20px;
                border-bottom: 1px solid var(--border);
                transition: background .15s var(--ease);
            }
            .set-cat-row:last-child { border-bottom: none; }
            .set-cat-row:hover      { background: #fafbfc; }

            .set-cat-icon {
                width: 40px;
                height: 40px;
                border-radius: var(--radius-sm);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .set-cat-icon svg { width: 22px; height: 22px; }

            .set-cat-text { flex: 1; min-width: 0; }
            .set-cat-name {
                font-weight: 600;
                font-size: .92rem;
                color: var(--fg);
            }
            .set-cat-id {
                font-size: .74rem;
                color: var(--muted);
                font-family: 'SFMono-Regular', Menlo, monospace;
                margin-top: 2px;
            }

            /* Toggle switch */
            .set-switch {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                user-select: none;
                padding: 4px 0;
            }
            .set-switch input { display: none; }
            .set-switch__slider {
                position: relative;
                width: 42px;
                height: 24px;
                background: #d1d5db;
                border-radius: 999px;
                transition: background .2s var(--ease);
                flex-shrink: 0;
            }
            .set-switch__slider::before {
                content: '';
                position: absolute;
                top: 3px;
                left: 3px;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: #fff;
                transition: transform .2s var(--ease);
                box-shadow: 0 1px 3px rgba(0,0,0,.15);
            }
            .set-switch input:checked + .set-switch__slider {
                background: var(--success);
            }
            .set-switch input:checked + .set-switch__slider::before {
                transform: translateX(18px);
            }
            .set-switch__label {
                font-size: .88rem;
                font-weight: 500;
                color: var(--fg-soft);
            }

            @media (max-width: 640px) {
                .set-cat-row  { padding: 12px 14px; gap: 10px; }
                .set-cat-icon { width: 34px; height: 34px; }
            }
        `;
        document.head.appendChild(s);
    })();

})();