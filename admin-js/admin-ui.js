'use strict';

(function (window, document) {

    /* =========================================================
       NAVIGATION
       ========================================================= */
    var NAV = [
        { key: 'dashboard', href: 'index.html', label: 'Dashboard', icon: 'grid' },
        { key: 'inventory', href: 'inventory.html', label: 'Inventory', icon: 'box' },
        { key: 'orders', href: 'orders.html', label: 'Orders', icon: 'cart' },
        { key: 'customers', href: 'customers.html', label: 'Customers', icon: 'users' },
        { key: 'analytics', href: 'analytics.html', label: 'Analytics', icon: 'chart' },
        { key: 'alerts', href: 'alerts.html', label: 'Alerts', icon: 'bell', badgeKey: 'alerts' },
        { key: 'settings', href: 'settings.html', label: 'Settings', icon: 'cog' }
    ];

    /* =========================================================
       ICONS (inline SVG, stroke uses currentColor)
       ========================================================= */
    function svg(paths) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            paths + '</svg>';
    }

    var ICONS = {
        grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
        box: svg('<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>'),
        cart: svg('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L22 7H6"/>'),
        users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>'),
        chart: svg('<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/>'),
        bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
        cog: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
        menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    };

    /* =========================================================
       FORMATTERS
       ========================================================= */
    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function money(amount) {
        var n = Number(amount);
        if (Number.isFinite(n)) {
            return '₹' + n.toLocaleString('en-IN');
        }
        return '₹0';
    }

    var _dateFmt = new Intl.DateTimeFormat('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
    var _timeFmt = new Intl.DateTimeFormat('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    function date(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return _dateFmt.format(d);
    }

    function datetime(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return _timeFmt.format(d);
    }

    function relativeTime(iso) {
        if (!iso) return '—';

        var then = new Date(iso).getTime();
        if (!Number.isFinite(then)) return '—';

        var s = Math.floor((Date.now() - then) / 1000);
        if (s < 60) return 'just now';

        var m = Math.floor(s / 60);
        if (m < 60) return m + ' min ago';

        var h = Math.floor(m / 60);
        if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';

        var d = Math.floor(h / 24);
        if (d < 7) return d + ' day' + (d === 1 ? '' : 's') + ' ago';

        return date(iso);
    }

    function initials(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(function (p) {
            return p !== '';
        });

        if (parts.length === 0) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();

        return (parts[0].charAt(0) +
            parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function statusClass(status) {
        var s = String(status || '').toLowerCase();
        switch (s) {
            case 'delivered':
            case 'in stock':
            case 'ok':
            case 'active':
                return 'ok';

            case 'shipped':
            case 'low stock':
            case 'pending':
                return 'warn';

            case 'cancelled':
            case 'out of stock':
            case 'error':
            case 'inactive':
                return 'bad';

            default:
                return 'info';
        }
    }

    /* =========================================================
       TOAST
       ========================================================= */
    var _toastHost = null;

    function ensureToastHost() {
        if (_toastHost && document.body.contains(_toastHost)) {
            return _toastHost;
        }
        _toastHost = document.createElement('div');
        _toastHost.className = 'admin-toast-host';
        _toastHost.id = 'adminToastHost';
        document.body.appendChild(_toastHost);
        return _toastHost;
    }

    function toast(message, type, duration) {
        if (type === undefined) type = 'info';
        if (duration === undefined) duration = 3000;

        var host = ensureToastHost();
        var el = document.createElement('div');
        el.className = 'admin-toast admin-toast--' + type;
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');
        el.innerHTML =
            '<span class="admin-toast__dot"></span>' +
            '<span class="admin-toast__msg">' + escapeHtml(message) + '</span>';
        host.appendChild(el);

        el._pxcTimer = setTimeout(function () { removeToast(el); }, duration);
        el.addEventListener('click', function () {
            clearTimeout(el._pxcTimer);
            removeToast(el);
        });

        return el;
    }

    function removeToast(el) {
        if (!el || !el.parentNode) return;
        el.classList.add('admin-toast--leaving');
        setTimeout(function () { el.remove(); }, 220);
    }

    /* =========================================================
       LOADER
       ========================================================= */
    var _loaderEl = null;
    var _loaderCount = 0;   // supports nested show/hide

    function ensureLoader() {
        if (_loaderEl && document.body.contains(_loaderEl)) {
            return _loaderEl;
        }
        _loaderEl = document.createElement('div');
        _loaderEl.className = 'admin-loader';
        _loaderEl.id = 'adminLoader';
        _loaderEl.setAttribute('aria-hidden', 'true');
        _loaderEl.innerHTML =
            '<div class="admin-loader__inner">' +
            '<div class="admin-loader__spinner"></div>' +
            '<div class="admin-loader__text" id="adminLoaderText">Loading</div>' +
            '</div>';
        document.body.appendChild(_loaderEl);
        return _loaderEl;
    }

    function showLoader(text) {
        ensureLoader();
        _loaderCount++;

        if (text) {
            var t = document.getElementById('adminLoaderText');
            if (t) t.textContent = text;
        }
        _loaderEl.classList.add('admin-loader--active');
    }

    function hideLoader() {
        if (_loaderCount > 0) _loaderCount--;
        if (_loaderCount > 0) return;
        if (_loaderEl) _loaderEl.classList.remove('admin-loader--active');
    }

    /* =========================================================
       CONFIRM (promise-based replacement for window.confirm)
       ========================================================= */
    function confirmDialog(opts) {
        opts = opts || {};

        var title = opts.title || 'Are you sure?';
        var message = opts.message || '';
        var okLabel = opts.okLabel || 'Confirm';
        var cancelLabel = opts.cancelLabel || 'Cancel';
        var danger = !!opts.danger;

        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'admin-modal-overlay';
            overlay.innerHTML =
                '<div class="admin-modal admin-modal--sm" role="dialog" aria-modal="true">' +
                '<div class="admin-modal__body">' +
                '<h3 class="admin-modal__title">' + escapeHtml(title) + '</h3>' +
                (message ? '<p class="admin-modal__desc">' + escapeHtml(message) + '</p>' : '') +
                '</div>' +
                '<div class="admin-modal__actions">' +
                '<button type="button" class="admin-btn admin-btn--ghost" data-role="cancel">' +
                escapeHtml(cancelLabel) +
                '</button>' +
                '<button type="button" class="admin-btn ' +
                (danger ? 'admin-btn--danger' : 'admin-btn--primary') +
                '" data-role="ok">' +
                escapeHtml(okLabel) +
                '</button>' +
                '</div>' +
                '</div>';

            function close(result) {
                overlay.classList.remove('admin-modal-overlay--open');
                setTimeout(function () { overlay.remove(); }, 200);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }

            function onKey(e) {
                if (e.key === 'Escape') close(false);
                if (e.key === 'Enter') close(true);
            }

            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) {
                    return close(false);
                }
                var btn = e.target.closest('[data-role]');
                if (btn) {
                    close(btn.dataset.role === 'ok');
                }
            });

            document.addEventListener('keydown', onKey);
            document.body.appendChild(overlay);

            requestAnimationFrame(function () {
                overlay.classList.add('admin-modal-overlay--open');
                var ok = overlay.querySelector('[data-role="ok"]');
                if (ok) ok.focus();
            });
        });
    }

    /* =========================================================
       MODAL (form container)
       Returns { el, close, content }
       ========================================================= */
    function openModal(opts) {
        opts = opts || {};

        var title = opts.title || '';
        var content = opts.content || '';
        var width = opts.width || 'md';   // sm | md | lg

        var overlay = document.createElement('div');
        overlay.className = 'admin-modal-overlay';
        overlay.innerHTML =
            '<div class="admin-modal admin-modal--' + width + '" role="dialog" aria-modal="true">' +
            '<div class="admin-modal__head">' +
            '<h3 class="admin-modal__title">' + escapeHtml(title) + '</h3>' +
            '<button type="button" class="admin-modal__close" data-role="close" aria-label="Close">' +
            ICONS.close +
            '</button>' +
            '</div>' +
            '<div class="admin-modal__body admin-modal__body--padded" data-role="content">' +
            content +
            '</div>' +
            '</div>';

        function close() {
            overlay.classList.remove('admin-modal-overlay--open');
            setTimeout(function () { overlay.remove(); }, 200);
            document.removeEventListener('keydown', onKey);
        }

        function onKey(e) {
            if (e.key === 'Escape') close();
        }

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) return close();
            if (e.target.closest('[data-role="close"]')) return close();
        });

        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
        requestAnimationFrame(function () {
            overlay.classList.add('admin-modal-overlay--open');
        });

        return {
            el: overlay,
            close: close,
            content: overlay.querySelector('[data-role="content"]')
        };
    }

    /* =========================================================
       SIDEBAR + TOPBAR
       ========================================================= */
    function buildSidebar(activePage) {
        var user = window.AdminAuth && window.AdminAuth.user();

        var userChip = '';
        if (user) {
            userChip =
                '<div class="admin-sidebar__user">' +
                '<div class="admin-avatar admin-avatar--sm">' +
                escapeHtml(initials(user.name)) +
                '</div>' +
                '<div class="admin-sidebar__user-info">' +
                '<div class="admin-sidebar__user-name">' + escapeHtml(user.name) + '</div>' +
                '<div class="admin-sidebar__user-role">Administrator</div>' +
                '</div>' +
                '</div>';
        }

        var items = NAV.map(function (item) {
            var active = (item.key === activePage) ? ' admin-nav__item--active' : '';

            var badgeHtml = '';
            if (item.badgeKey) {
                badgeHtml = '<span class="admin-nav__badge" data-nav-badge="' +
                    item.badgeKey + '" hidden>0</span>';
            }

            return '<a class="admin-nav__item' + active + '" href="' + item.href +
                '" data-page="' + item.key + '">' +
                '<span class="admin-nav__icon">' + (ICONS[item.icon] || '') + '</span>' +
                '<span class="admin-nav__label">' + escapeHtml(item.label) + '</span>' +
                badgeHtml +
                '</a>';
        }).join('');

        return '<aside class="admin-sidebar" id="adminSidebar" aria-label="Admin navigation">' +
            '<div class="admin-sidebar__head">' +
            '<a href="index.html" class="admin-sidebar__brand">' +
            'TeamZamp<span>X</span>United' +
            '<small>Admin</small>' +
            '</a>' +
            '<button type="button" class="admin-sidebar__close" id="adminSidebarClose" aria-label="Close sidebar">' +
            ICONS.close +
            '</button>' +
            '</div>' +

            '<nav class="admin-nav">' + items + '</nav>' +

            '<div class="admin-sidebar__foot">' +
            userChip +
            '<button type="button" class="admin-sidebar__logout" id="adminLogoutBtn">' +
            '<span class="admin-nav__icon">' + ICONS.logout + '</span>' +
            '<span>Log out</span>' +
            '</button>' +
            '</div>' +
            '</aside>' +
            '<div class="admin-sidebar-backdrop" id="adminSidebarBackdrop"></div>';
    }

    function buildTopbar(opts) {
        var subtitleHtml = '';
        if (opts.subtitle) {
            subtitleHtml = '<p class="admin-topbar__subtitle">' +
                escapeHtml(opts.subtitle) + '</p>';
        }

        return '<header class="admin-topbar">' +
            '<button type="button" class="admin-topbar__burger" id="adminBurger" aria-label="Open navigation">' +
            ICONS.menu +
            '</button>' +

            '<div class="admin-topbar__titles">' +
            '<h1 class="admin-topbar__title">' + escapeHtml(opts.title || '') + '</h1>' +
            subtitleHtml +
            '</div>' +

            '<div class="admin-topbar__actions" id="adminTopbarActions">' +
            (opts.actions || '') +
            '</div>' +
            '</header>';
    }

    /* =========================================================
       WIRE CHROME (sidebar toggle, logout)
       ========================================================= */
    function wireChrome() {
        var sidebar = document.getElementById('adminSidebar');
        var backdrop = document.getElementById('adminSidebarBackdrop');
        var burger = document.getElementById('adminBurger');
        var closeBtn = document.getElementById('adminSidebarClose');

        function openSidebar() {
            if (!sidebar) return;
            sidebar.classList.add('admin-sidebar--open');
            if (backdrop) backdrop.classList.add('admin-sidebar-backdrop--open');
            document.body.classList.add('admin-body--no-scroll');
        }

        function closeSidebar() {
            if (!sidebar) return;
            sidebar.classList.remove('admin-sidebar--open');
            if (backdrop) backdrop.classList.remove('admin-sidebar-backdrop--open');
            document.body.classList.remove('admin-body--no-scroll');
        }

        if (burger) burger.addEventListener('click', openSidebar);
        if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
        if (backdrop) backdrop.addEventListener('click', closeSidebar);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeSidebar();
        });

        // auto-close sidebar after nav click (mobile only)
        var navLinks = document.querySelectorAll('.admin-nav__item');
        for (var i = 0; i < navLinks.length; i++) {
            (function (a) {
                a.addEventListener('click', function () {
                    if (window.innerWidth < 900) closeSidebar();
                });
            })(navLinks[i]);
        }

        // logout
        var logout = document.getElementById('adminLogoutBtn');
        if (logout) {
            logout.addEventListener('click', async function () {
                var yes = await confirmDialog({
                    title: 'Sign out?',
                    message: 'You will need to log in again to access the admin panel.',
                    okLabel: 'Sign out',
                    danger: true
                });
                if (yes) window.AdminAuth.logout(true);
            });
        }
    }

    /* =========================================================
       MOUNT — renders the whole admin shell into #adminRoot
       ========================================================= */
    function mount(opts) {
        opts = opts || {};

        var root = document.getElementById('adminRoot');
        if (!root) {
            root = document.createElement('div');
            root.id = 'adminRoot';
            document.body.appendChild(root);
        }

        var activePage = opts.activePage || '';

        var contentHtml;
        if (opts.content != null) {
            contentHtml = opts.content;
        } else {
            contentHtml = '';
        }

        root.className = 'admin-shell';
        root.innerHTML =
            buildSidebar(activePage) +
            '<div class="admin-main">' +
            buildTopbar(opts) +
            '<main class="admin-content" id="adminContent">' +
            contentHtml +
            '</main>' +
            '</div>';

        wireChrome();

        document.title = (opts.title ? opts.title + ' — ' : '') + 'TeamZampXUnited Admin';

        return document.getElementById('adminContent');
    }

    // Replace only the content area (keeps chrome intact).
    function setContent(html) {
        var host = document.getElementById('adminContent');
        if (host) {
            if (html != null) {
                host.innerHTML = html;
            } else {
                host.innerHTML = '';
            }
        }
    }

    /* =========================================================
       BUILDERS
       ========================================================= */
    function kpiTile(opts) {
        var tone = opts.tone || 'default';   // default | up | down | warn

        var hintHtml = '';
        if (opts.hint) {
            hintHtml = '<div class="admin-kpi__hint">' + escapeHtml(opts.hint) + '</div>';
        }

        return '<div class="admin-kpi admin-kpi--' + tone + '">' +
            '<div class="admin-kpi__label">' + escapeHtml(opts.label || '') + '</div>' +
            '<div class="admin-kpi__value">' + (opts.value || '0') + '</div>' +
            hintHtml +
            '</div>';
    }

    function statusBadge(status) {
        return '<span class="admin-badge admin-badge--' + statusClass(status) + '">' +
            escapeHtml(status || '—') +
            '</span>';
    }

    function emptyState(opts) {
        opts = opts || {};

        var msgHtml = '';
        if (opts.message) {
            msgHtml = '<p class="admin-empty__msg">' + escapeHtml(opts.message) + '</p>';
        }

        return '<div class="admin-empty">' +
            '<div class="admin-empty__icon">' + (opts.icon || '📭') + '</div>' +
            '<h3 class="admin-empty__title">' +
            escapeHtml(opts.title || 'Nothing here yet') +
            '</h3>' +
            msgHtml +
            (opts.actionHtml || '') +
            '</div>';
    }

    function th(label, opts) {
        opts = opts || {};

        var cls = '';
        if (opts.align) {
            cls = ' admin-th--' + opts.align;
        }

        var sortable = '';
        if (opts.sortable) {
            sortable = ' data-sortable="1"';
        }

        return '<th class="admin-th' + cls + '"' + sortable + '>' +
            escapeHtml(label) +
            '</th>';
    }

    function td(content, opts) {
        opts = opts || {};

        var cls = '';
        if (opts.align) {
            cls = ' admin-td--' + opts.align;
        }

        var attrs = '';
        if (opts.attrs) {
            attrs = ' ' + opts.attrs;
        }

        return '<td class="admin-td' + cls + '"' + attrs + '>' + content + '</td>';
    }

    /* =========================================================
       PUBLIC SURFACE
       ========================================================= */
    window.AdminUI = {
        mount: mount,
        setContent: setContent,

        // feedback
        toast: toast,
        showLoader: showLoader,
        hideLoader: hideLoader,
        confirm: confirmDialog,
        openModal: openModal,

        // builders
        kpiTile: kpiTile,
        statusBadge: statusBadge,
        emptyState: emptyState,
        th: th,
        td: td,

        // formatters
        escapeHtml: escapeHtml,
        money: money,
        date: date,
        datetime: datetime,
        relativeTime: relativeTime,
        initials: initials,
        statusClass: statusClass,

        // reusable data
        ICONS: ICONS,
        NAV: NAV
    };

})(window, document);