var PXCUI = {

    /* =========================================================
       SHARED UTILITIES
       ========================================================= */

    // HTML-escape any value before injecting into a template.
    escapeHtml: function (str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    // Capitalize the first letter.
    capitalize: function (str) {
        str = String(str || '');
        return str.charAt(0).toUpperCase() + str.slice(1);
    },


    /* =========================================================
       PAGE LOADER
       ========================================================= */
    _ensureLoader: function () {
        if (document.getElementById('pxcPageLoader')) return;

        var el = document.createElement('div');
        el.id = 'pxcPageLoader';
        el.className = 'pxc-page-loader';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `
            <div class="pxc-page-loader__inner">
                <div class="pxc-page-loader__spinner"></div>
                <div class="pxc-page-loader__text" id="pxcLoaderText">Loading</div>
            </div>
        `;
        document.body.appendChild(el);
    },

    showLoader: function (text) {
        this._ensureLoader();
        var el = document.getElementById('pxcPageLoader');
        var t = document.getElementById('pxcLoaderText');
        if (t && text) t.textContent = text;
        if (el) el.classList.add('active');
    },

    hideLoader: function () {
        var el = document.getElementById('pxcPageLoader');
        if (el) el.classList.remove('active');
    },

    // Navigate with loader + watchdog (so it never gets stuck).
    navigate: function (url, label, delay) {
        if (label === undefined) label = 'Loading';
        if (delay === undefined) delay = 220;

        if (!url) return;

        // Same-page navigation? Just skip the loader.
        try {
            var target = new URL(url, location.href);
            if (target.pathname === location.pathname &&
                target.search === location.search &&
                target.hash === location.hash) {
                return;
            }
        } catch (e) { /* ignore */ }

        this.showLoader(label);

        var self = this;
        var watchdog = setTimeout(function () { self.hideLoader(); }, 4000);

        setTimeout(function () {
            clearTimeout(watchdog);
            window.location.href = url;
        }, delay);
    },


    /* =========================================================
       LOGIN GATE
       Use: if (!PXCUI.requireLogin('add items to your cart')) return;
       ========================================================= */
    requireLogin: function (actionText) {
        if (actionText === undefined) actionText = 'continue';

        if (PXC.isLoggedIn()) return true;

        this.toast('Please log in to ' + actionText, 'error');

        var next;
        try {
            next = location.pathname.split('/').pop() + location.search + location.hash;
        } catch (e) {
            next = 'index.html';
        }

        var self = this;
        setTimeout(function () {
            self.navigate('login.html?next=' + encodeURIComponent(next), 'Going to login', 0);
        }, 500);

        return false;
    },


    /* =========================================================
       GLOBAL LINK INTERCEPTOR
       Adds loader + saves search/category/product hints to
       sessionStorage so they survive file:// & query-stripping.
       ========================================================= */
    _wireSmoothLinks: function () {
        if (document._pxcLinksBound) return;
        document._pxcLinksBound = true;

        var self = this;
        document.addEventListener('click', function (e) {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (e.defaultPrevented) return;

            var a = e.target.closest('a[href]');
            if (!a) return;

            var href = a.getAttribute('href');
            if (!href) return;

            // Skip anchor / protocol / target / download
            if (href.indexOf('#') === 0 ||
                href.indexOf('mailto:') === 0 ||
                href.indexOf('tel:') === 0 ||
                href.indexOf('javascript:') === 0) return;
            if (a.target && a.target !== '_self') return;
            if (a.hasAttribute('download')) return;
            if (a.dataset.noLoader !== undefined) return;

            // External link check (file:// safe)
            if (isExternalLink(href)) return;

            // ----- Persist hints to sessionStorage -----
            saveProductHint(a, href);
            saveCategoryHint(a, href);
            saveSearchHint(a, href);

            // Same-page navigation? Let it happen naturally.
            var url;
            try { url = new URL(href, location.href); }
            catch (e) { return; }

            if (url.pathname === location.pathname && url.search === location.search) return;

            e.preventDefault();
            self.navigate(url.pathname + url.search + url.hash);
        });
    },


    /* =========================================================
       HEADER
       ========================================================= */
    renderHeader: function () {
        var host = document.getElementById('site-header');
        if (!host) return;

        // Preserve the current search value across re-renders
        var searchEl = document.getElementById('navSearchInput');
        var prevSearch = searchEl ? (searchEl.value || '') : '';

        var loggedIn = PXC.isLoggedIn();
        var user = PXC.user;
        var page = this._currentPage();
        var showSearchMobile = (page === 'products' || page === 'index' || page === '');
        var unread = loggedIn ? PXC.unreadNotificationCount() : 0;

        var searchMobileClass = showSearchMobile ? '' : 'navbar-search--mobile-hidden';
        var actionsHtml = loggedIn
            ? this._renderLoggedInActions(user, unread)
            : this._renderGuestActions();

        host.innerHTML = `
            <header class="navbar" id="navbar">
                <div class="container">
                    <div class="navbar-content">

                        <button class="menu-trigger" id="menuTrigger" aria-label="Open menu" type="button">
                            ${ICON_MENU}
                        </button>

                        <div class="navbar-logo">
                            <a href="index.html">TeamZamp<span>X</span>United</a>
                        </div>

                        <nav class="navbar-navigation">
                            <a href="index.html">Home</a>
                            <a href="products.html" data-clear-filters>Shop</a>
                            <a href="products.html?category=electronics">Electronics</a>
                            <a href="products.html?category=fashion">Fashion</a>
                            <a href="products.html?category=groceries">Groceries</a>
                        </nav>

                        <form class="navbar-search ${searchMobileClass}"
                              id="navSearch" role="search" autocomplete="off">
                            <input type="search" id="navSearchInput"
                                   value="${this.escapeHtml(prevSearch)}"
                                   placeholder="Search for products, brands and more…"
                                   aria-label="Search products">
                            <button type="submit" aria-label="Search">${ICON_SEARCH}</button>
                        </form>

                        <div class="navbar-actions">
                            ${actionsHtml}

                            <a href="products.html?wishlist=1" class="icon-btn"
                               id="wishlistNavBtn" aria-label="Wishlist" data-no-loader>
                                ${ICON_HEART}
                                <span class="badge" id="wishCount">0</span>
                            </a>

                            <a href="cart.html" class="icon-btn" aria-label="Cart">
                                ${ICON_BAG}
                                <span class="badge" id="cartCount">0</span>
                            </a>
                        </div>
                    </div>
                </div>
            </header>

            <!-- Notifications panel -->
            <div class="pxc-notif-panel" id="notifPanel" hidden>
                <div class="pxc-notif-panel__head">
                    <strong>Notifications</strong>
                    <button type="button" id="notifClose" aria-label="Close">✕</button>
                </div>
                <div class="pxc-notif-panel__body" id="notifBody"></div>
            </div>

            <!-- Mobile drawer -->
            <div class="mobile-menu" id="mobileMenu">
                <div class="mobile-menu-container">
                    <div class="mobile-menu-header">
                        <a href="index.html" class="mobile-menu-logo">TeamZampXUnited</a>
                        <button type="button" id="mobileClose" aria-label="Close menu">${ICON_CLOSE}</button>
                    </div>

                    <nav class="mobile-menu-nav">
                        <div class="mobile-menu-section">
                            <a href="index.html" class="mobile-menu-link">Home</a>
                        </div>
                        <div class="mobile-menu-section">
                            <a href="products.html" class="mobile-menu-link" data-clear-filters>All Products</a>
                        </div>
                        <div class="mobile-menu-section">
                            <div class="mobile-menu-section-header" data-toggle="cats">
                                <span>Categories</span>
                                <svg class="chevron" width="20" height="20" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                    <polyline points="9 18 15 12 9 6"/>
                                </svg>
                            </div>
                            <div class="mobile-menu-section-content" id="cats-content"></div>
                        </div>
                        <div class="mobile-menu-section">
                            <a href="account.html" class="mobile-menu-link">My Account</a>
                        </div>
                        <div class="mobile-menu-section">
                            <a href="products.html?wishlist=1" class="mobile-menu-link">Wishlist</a>
                        </div>
                        <div class="mobile-menu-section">
                            <a href="cart.html" class="mobile-menu-link">Cart</a>
                        </div>
                        <div class="mobile-menu-section">
                            <a href="about.html" class="mobile-menu-link">About</a>
                        </div>
                        <div class="mobile-menu-section">
                            <a href="contact.html" class="mobile-menu-link">Contact</a>
                        </div>
                    </nav>

                    <div class="mobile-menu-footer">
                        ${loggedIn ? `
                            <a href="account.html" class="btn btn-primary btn-sm">My Account</a>
                            <button type="button" class="btn btn-outline btn-sm" id="logoutDrawerBtn">Logout</button>
                        ` : `
                            <a href="login.html" class="btn btn-primary btn-sm">Login</a>
                            <a href="login.html#register" class="btn btn-outline btn-sm">Register</a>
                        `}
                    </div>
                </div>
            </div>
        `;

        // Fill mobile category list
        var catHost = document.getElementById('cats-content');
        if (catHost) {
            var catHtml = '';
            for (var ci = 0; ci < PXC.categories.length; ci++) {
                var c = PXC.categories[ci];
                catHtml +=
                    '<a href="products.html?category=' + c.id + '">' +
                    c.icon + ' <span>' + this.escapeHtml(c.name) + '</span>' +
                    '</a>';
            }
            catHost.innerHTML = catHtml;
        }

        this._wireHeader();
        this._wireSmoothLinks();
        this.updateBadges();
    },

    _renderLoggedInActions: function (user, unread) {
        var notifStyle = unread ? '' : 'display:none';

        return `
            <a href="account.html" class="icon-btn" aria-label="My account"
               title="${this.escapeHtml(user.name)}">
                ${ICON_USER}
            </a>

            <button type="button" class="icon-btn" id="notifBtn"
                    aria-label="Notifications" title="Notifications">
                ${ICON_BELL}
                <span class="badge" id="notifCount"
                      style="${notifStyle}">${unread}</span>
            </button>

            <button type="button" class="icon-btn" id="logoutTopBtn"
                    aria-label="Logout" title="Logout">
                ${ICON_LOGOUT}
            </button>
        `;
    },

    _renderGuestActions: function () {
        return `
            <a href="login.html" class="btn btn-outline btn-sm nav-auth-btn">Login</a>
            <a href="login.html#register" class="btn btn-primary btn-sm nav-auth-btn">Register</a>
        `;
    },

    // Current page slug (index, products, cart, …)
    _currentPage: function () {
        var file = (location.pathname.split('/').pop() || '')
            .replace(/\.html?$/i, '')
            .toLowerCase();
        return file || 'index';
    },


    /* =========================================================
       HEADER EVENT WIRING
       ========================================================= */
    _wireHeader: function () {
        this._wireNavbarScroll();
        this._wireMobileDrawer();
        this._wireSearch();
        this._wireLogoutButtons();
        this._wireWishlistNavLink();
        this._wireNotifications();
    },

    _wireNavbarScroll: function () {
        var navbar = document.getElementById('navbar');
        if (!navbar || navbar._pxcScrollBound) return;

        navbar._pxcScrollBound = true;
        window.addEventListener('scroll', function () {
            navbar.classList.toggle('scrolled', window.scrollY > 20);
        }, { passive: true });
    },

    _wireMobileDrawer: function () {
        var trigger = document.getElementById('menuTrigger');
        var menu = document.getElementById('mobileMenu');
        var close = document.getElementById('mobileClose');
        if (!trigger || !menu || !close) return;

        function openMenu() {
            menu.classList.add('active');

            var scrollbarW = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.overflow = 'hidden';
            if (scrollbarW > 0) document.body.style.paddingRight = scrollbarW + 'px';
        }

        function shutMenu() {
            menu.classList.remove('active');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }

        trigger.addEventListener('click', openMenu);
        close.addEventListener('click', shutMenu);

        menu.addEventListener('click', function (e) {
            if (e.target === menu) shutMenu();
        });

        // Accordion headers
        var headers = menu.querySelectorAll('.mobile-menu-section-header');
        for (var i = 0; i < headers.length; i++) {
            (function (h) {
                h.addEventListener('click', function () {
                    h.classList.toggle('active');
                    var content = document.getElementById(h.dataset.toggle + '-content');
                    if (content) content.classList.toggle('active');
                });
            })(headers[i]);
        }

        // Auto-close on any link click
        var links = menu.querySelectorAll('a');
        for (var j = 0; j < links.length; j++) {
            links[j].addEventListener('click', shutMenu);
        }
    },

    _wireSearch: function () {
        var form = document.getElementById('navSearch');
        var input = document.getElementById('navSearchInput');
        if (!form || !input) return;

        var self = this;
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var q = input.value.trim();

            try {
                if (q) sessionStorage.setItem('pxcLastSearch', q);
                else sessionStorage.removeItem('pxcLastSearch');
                sessionStorage.removeItem('pxcLastCategory');
            } catch (e2) { }

            var url = q ? 'products.html?q=' + encodeURIComponent(q) : 'products.html';
            self.navigate(url, 'Searching');
        });
    },

    _wireLogoutButtons: function () {
        var self = this;

        var topBtn = document.getElementById('logoutTopBtn');
        if (topBtn) {
            topBtn.addEventListener('click', function () { self._doLogout(); });
        }

        var drawerBtn = document.getElementById('logoutDrawerBtn');
        if (drawerBtn) {
            drawerBtn.addEventListener('click', function () { self._doLogout(); });
        }
    },

    // Set a session flag so products.js can show wishlist-only
    // view even when the URL query gets stripped.
    _wireWishlistNavLink: function () {
        var btn = document.getElementById('wishlistNavBtn');
        if (!btn || btn._pxcWishBound) return;

        btn._pxcWishBound = true;
        btn.addEventListener('click', function () {
            try {
                sessionStorage.setItem('pxcShowWishlistOnly', '1');
                sessionStorage.removeItem('pxcLastSearch');
                sessionStorage.removeItem('pxcLastCategory');
            } catch (e) { }
        });
    },

    _wireNotifications: function () {
        var notifBtn = document.getElementById('notifBtn');
        var notifPanel = document.getElementById('notifPanel');
        if (!notifBtn || !notifPanel) return;

        var notifClose = document.getElementById('notifClose');
        var self = this;

        notifBtn.addEventListener('click', function (e) {
            e.stopPropagation();

            var isOpen = !notifPanel.hidden;
            if (isOpen) {
                notifPanel.hidden = true;
                return;
            }

            self._renderNotifications();
            notifPanel.hidden = false;

            // Mark read after a beat so the badge change is visible
            setTimeout(function () { PXC.markNotificationsRead(); }, 400);
        });

        if (notifClose) {
            notifClose.addEventListener('click', function () {
                notifPanel.hidden = true;
            });
        }

        // Click outside closes
        document.addEventListener('click', function (e) {
            if (notifPanel.hidden) return;
            if (notifPanel.contains(e.target)) return;
            if (notifBtn.contains(e.target)) return;
            notifPanel.hidden = true;
        });

        // Escape closes
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') notifPanel.hidden = true;
        });
    },

    _renderNotifications: function () {
        var body = document.getElementById('notifBody');
        if (!body) return;

        var list = PXC.getUserNotifications().slice().reverse();

        if (!list.length) {
            body.innerHTML = `
                <div style="padding:1.5rem 1rem;text-align:center;
                            color:var(--muted-foreground);font-size:.85rem">
                    You have no notifications yet.
                </div>
            `;
            return;
        }

        var top = list.slice(0, 20);
        var html = '';
        for (var i = 0; i < top.length; i++) {
            var n = top[i];
            var unreadClass = n.read ? '' : 'unread';
            html +=
                '<div class="pxc-notif-item ' + unreadClass + '">' +
                '<div class="pxc-notif-item__msg">' + this.escapeHtml(n.message) + '</div>' +
                '<div class="pxc-notif-item__date">' +
                this.escapeHtml(new Date(n.date).toLocaleString('en-IN', {
                    day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit'
                })) +
                '</div>' +
                '</div>';
        }
        body.innerHTML = html;
    },

    _doLogout: function () {
        PXC.logout();
        this.toast('Logged out successfully', 'success');
        this.navigate('index.html', 'Signing out', 400);
    },


    /* =========================================================
       FOOTER
       ========================================================= */
    renderFooter: function () {
        var host = document.getElementById('site-footer');
        if (!host) return;

        var year = new Date().getFullYear();

        host.innerHTML = `
            <footer class="footer">
                <div class="container">
                    <div class="footer-grid">
                        <div class="footer-column">
                            <h3>Shop</h3>
                            <ul>
                                <li><a href="products.html?category=electronics">Electronics</a></li>
                                <li><a href="products.html?category=fashion">Fashion</a></li>
                                <li><a href="products.html?category=groceries">Groceries</a></li>
                                <li><a href="products.html?category=home">Home</a></li>
                                <li><a href="products.html?category=beauty">Beauty</a></li>
                                <li><a href="products.html?category=sports">Sports</a></li>
                            </ul>
                        </div>

                        <div class="footer-column">
                            <h3>Company</h3>
                            <ul>
                                <li><a href="about.html">About TeamZampXUnited</a></li>
                                <li><a href="careers.html">Careers</a></li>
                                <li><a href="press.html">Press</a></li>
                                <li><a href="sustainability.html">Sustainability</a></li>
                            </ul>
                        </div>

                        <div class="footer-column">
                            <h3>Help</h3>
                            <ul>
                                <li><a href="contact.html">Contact Us</a></li>
                                <li><a href="shipping.html">Shipping &amp; Returns</a></li>
                                <li><a href="faq.html">FAQ</a></li>
                                <li><a href="track.html">Track Order</a></li>
                                <li><a href="terms.html">Terms &amp; Conditions</a></li>
                                <li><a href="privacy.html">Privacy Policy</a></li>
                            </ul>
                        </div>

                        <div class="footer-column">
                            <h3>Newsletter</h3>
                            <p>Get exclusive deals &amp; early access to new drops.</p>
                            <form class="footer-newsletter-form" data-newsletter>
                                <input type="email" placeholder="Your email" required
                                       aria-label="Email address">
                                <button type="submit" class="btn btn-primary btn-sm">Join</button>
                            </form>
                        </div>
                    </div>

                    <div class="footer-bottom">
                        <div class="footer-logo">
                            TeamZampXUnited
                            <p>© ${year} TeamZampXUnited. All rights reserved.</p>
                        </div>
                        <div class="footer-social">
                            <a href="#" aria-label="Instagram" data-no-loader>${ICON_INSTAGRAM}</a>
                            <a href="#" aria-label="Twitter"   data-no-loader>${ICON_TWITTER}</a>
                            <a href="#" aria-label="Facebook"  data-no-loader>${ICON_FACEBOOK}</a>
                        </div>
                    </div>
                </div>
            </footer>
        `;

        this._wireNewsletterForms(host);
    },

    _wireNewsletterForms: function (scope) {
        var root = scope || document;
        var self = this;

        var forms = root.querySelectorAll('[data-newsletter]');
        for (var i = 0; i < forms.length; i++) {
            (function (form) {
                if (form._pxcNewsletterBound) return;
                form._pxcNewsletterBound = true;

                form.addEventListener('submit', function (e) {
                    e.preventDefault();

                    var input = form.querySelector('input[type="email"]');
                    if (!input) return;

                    var res = PXC.subscribe(input.value);

                    if (!res.ok) {
                        self.toast(res.error || 'Subscription failed', 'error');
                        return;
                    }

                    var message;
                    if (res.already) {
                        message = 'You are already subscribed ✨';
                    } else {
                        message = 'Subscribed! Welcome aboard ✨';
                    }
                    self.toast(message, 'success');
                    form.reset();
                });
            })(forms[i]);
        }
    },


    /* =========================================================
       BADGES
       ========================================================= */
    updateBadges: function () {
        var c = document.getElementById('cartCount');
        var w = document.getElementById('wishCount');
        var n = document.getElementById('notifCount');

        if (c) c.textContent = PXC.cartCount();
        if (w) w.textContent = PXC.wishlistCount();

        if (n) {
            var unread = PXC.isLoggedIn() ? PXC.unreadNotificationCount() : 0;
            n.textContent = unread;
            n.style.display = unread ? '' : 'none';
        }
    },


    /* =========================================================
       TOAST
       ========================================================= */
    toast: function (msg, type) {
        if (type === undefined) type = '';

        var host = document.getElementById('toastHost');

        if (!host) {
            host = document.createElement('div');
            host.id = 'toastHost';
            host.className = 'toast-host';
            document.body.appendChild(host);
        }

        var el = document.createElement('div');
        el.className = 'toast ' + type;
        el.textContent = msg;
        host.appendChild(el);

        setTimeout(function () { el.remove(); }, 2800);
    },


    /* =========================================================
       PRODUCT CARD RENDERER
       opts: showAddToCart | showBadge | showRating
       ========================================================= */
    productCard: function (p, opts) {
        if (opts === undefined) opts = {};

        var esc = this.escapeHtml;
        var disc = PXC.discountPct(p);
        var wish = PXC.isWishlisted(p.id);

        var showAddToCart = opts.showAddToCart !== false;
        var showBadge = opts.showBadge !== false;
        var showRating = opts.showRating !== false;

        // Badge HTML
        var badge = '';
        if (showBadge) {
            if (p.tags.indexOf('bestseller') !== -1) {
                badge = '<span class="product-badge bestseller">Bestseller</span>';
            } else if (p.tags.indexOf('new') !== -1) {
                badge = '<span class="product-badge new">New</span>';
            } else if (disc > 0) {
                badge = '<span class="product-badge">' + disc + '% OFF</span>';
            }
        }

        var productUrl = 'product.html?id=' + encodeURIComponent(p.id);

        var wishLabel = wish ? 'Remove from wishlist' : 'Add to wishlist';
        var wishFill = wish ? 'currentColor' : 'none';
        var wishClass = wish ? 'active' : '';

        var mrpBlock = '';
        if (p.mrp > p.price) {
            mrpBlock =
                '<span class="mrp">' + PXC.fmt(p.mrp) + '</span>' +
                '<span class="discount">' + disc + '% off</span>';
        }

        var ratingBlock = '';
        if (showRating) {
            ratingBlock = `
                <div class="rating-row">
                    <span class="rating-pill">${p.rating} ★</span>
                    <span class="rating-count">(${p.ratingCount.toLocaleString('en-IN')})</span>
                </div>
            `;
        }

        var addBtnBlock = '';
        if (showAddToCart) {
            addBtnBlock = `
                <button type="button"
                        class="btn btn-outline btn-sm btn-block card-add"
                        style="margin-top:.6rem"
                        data-add="${esc(p.id)}">
                    Add to cart
                </button>
            `;
        }

        return `
            <div class="product-card">
                <a href="${productUrl}" class="thumb" data-product-id="${esc(p.id)}">
                    ${badge}
                    <img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">
                    <span class="quick-view">View details</span>
                </a>

                <button type="button" class="wishlist-btn ${wishClass}"
                        data-wish="${esc(p.id)}"
                        aria-label="${wishLabel}">
                    <svg width="18" height="18" viewBox="0 0 24 24"
                         fill="${wishFill}"
                         stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </button>

                <div class="body">
                    <div class="brand">${esc(p.brand)}</div>
                    <a href="${productUrl}" class="name" data-product-id="${esc(p.id)}">
                        ${esc(p.name)}
                    </a>

                    ${ratingBlock}

                    <div class="price-row">
                        <span class="price">${PXC.fmt(p.price)}</span>
                        ${mrpBlock}
                    </div>

                    ${addBtnBlock}
                </div>
            </div>
        `;
    },


    /* =========================================================
       PRODUCT CARD WIRING
       Safe to call multiple times on the same scope.
       ========================================================= */
    wireProductCards: function (scope) {
        if (!scope) return;

        var self = this;

        // ---- wishlist hearts ----
        var wishButtons = scope.querySelectorAll('[data-wish]');
        for (var i = 0; i < wishButtons.length; i++) {
            (function (btn) {
                if (btn._pxcBound) return;
                btn._pxcBound = true;

                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();

                    var id = btn.dataset.wish;
                    var added = PXC.toggleWishlist(id);

                    btn.classList.toggle('active', added);

                    var svg = btn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');

                    btn.setAttribute('aria-label', added ? 'Remove from wishlist' : 'Add to wishlist');
                    self.toast(added ? 'Added to wishlist ❤️' : 'Removed from wishlist');
                });
            })(wishButtons[i]);
        }

        // ---- add-to-cart (login-gated) ----
        var addButtons = scope.querySelectorAll('[data-add]');
        for (var j = 0; j < addButtons.length; j++) {
            (function (btn) {
                if (btn._pxcBound) return;
                btn._pxcBound = true;

                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (!self.requireLogin('add items to your cart')) return;

                    PXC.addToCart(btn.dataset.add, 1);
                    self.toast('Added to cart 🛒', 'success');
                });
            })(addButtons[j]);
        }

        // ---- product links — save product id as session hint ----
        var productLinks = scope.querySelectorAll('[data-product-id]');
        for (var k = 0; k < productLinks.length; k++) {
            (function (a) {
                if (a._pxcBound) return;
                a._pxcBound = true;

                a.addEventListener('click', function () {
                    try {
                        sessionStorage.setItem('pxcLastProductId', a.dataset.productId);
                    } catch (e) { }
                });
            })(productLinks[k]);
        }
    }
};


/* =========================================================
   LINK-INTERCEPTOR HELPERS
   ========================================================= */

// True if the href points to a different origin.
function isExternalLink(href) {
    var isExternalHttp =
        /^https?:\/\//i.test(href) &&
        href.indexOf(location.origin) !== 0 &&
        !(location.protocol === 'file:' && href.indexOf('file:') === 0);

    if (!isExternalHttp) return false;
    if (location.protocol === 'file:') return true;

    try {
        var u = new URL(href, location.href);
        return u.origin !== location.origin;
    } catch (e) {
        return true;
    }
}

function saveProductHint(a, href) {
    var productId = a.dataset.productId || null;

    if (!productId) {
        var m = href.match(/product\.html\?id=([^&#]+)/i) ||
            href.match(/\/product\/([^/?#]+)/i);
        if (m) productId = decodeURIComponent(m[1]);
    }

    if (productId) {
        try { sessionStorage.setItem('pxcLastProductId', productId); }
        catch (e) { }
    }
}

function saveCategoryHint(a, href) {
    var catMatch = href.match(/[?&]category=([^&#]+)/i);

    if (catMatch) {
        var cat = decodeURIComponent(catMatch[1]).trim();
        try {
            if (cat && cat !== 'all') sessionStorage.setItem('pxcLastCategory', cat);
            else sessionStorage.removeItem('pxcLastCategory');
        } catch (e) { }
    } else if (/products\.html(\?|#|$)/i.test(href)) {
        // Plain products.html — clear stale category
        try { sessionStorage.removeItem('pxcLastCategory'); }
        catch (e) { }
    }
}

function saveSearchHint(a, href) {
    var shouldClear = a.dataset.clearFilters !== undefined;
    var qMatch = href.match(/[?&]q=([^&#]+)/i);

    if (shouldClear) {
        try {
            sessionStorage.removeItem('pxcLastSearch');
            sessionStorage.removeItem('pxcLastCategory');
        } catch (e) { }
        return;
    }

    if (qMatch) {
        var q = decodeURIComponent(qMatch[1]).trim();
        try {
            if (q) sessionStorage.setItem('pxcLastSearch', q);
            else sessionStorage.removeItem('pxcLastSearch');
        } catch (e) { }
        return;
    }

    // Plain products.html link (no filters) — wipe stale search
    if (/products\.html(\?|#|$)/i.test(href) &&
        !/[?&](category|brand|tag|sort|wishlist|priceMax|minRating)=/i.test(href)) {
        try { sessionStorage.removeItem('pxcLastSearch'); }
        catch (e) { }
    }
}


/* =========================================================
   ICONS (inline SVG)
   ========================================================= */
var ICON_MENU = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="4" y1="6"  x2="20" y2="6"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="18" x2="20" y2="18"/>
    </svg>
`;

var ICON_CLOSE = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6"  y2="18"/>
        <line x1="6"  y1="6" x2="18" y2="18"/>
    </svg>
`;

var ICON_SEARCH = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="7"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
`;

var ICON_USER = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
    </svg>
`;

var ICON_BELL = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
    </svg>
`;

var ICON_LOGOUT = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
`;

var ICON_HEART = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
`;

var ICON_BAG = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6Z"/>
        <path d="M3 6h18"/>
        <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
`;

var ICON_INSTAGRAM = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="20" rx="5"/>
        <circle cx="12" cy="12" r="4"/>
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>
    </svg>
`;

var ICON_TWITTER = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-1-4.8 4-8.9 7.9-5A10 10 0 0 0 22 4"/>
    </svg>
`;

var ICON_FACEBOOK = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
    </svg>
`;


/* =========================================================
   AUTO-WIRING
   ========================================================= */
document.addEventListener('pxc:cart-update', function () { PXCUI.updateBadges(); });
document.addEventListener('pxc:wishlist-update', function () { PXCUI.updateBadges(); });
document.addEventListener('pxc:notifications-update', function () { PXCUI.updateBadges(); });

document.addEventListener('pxc:auth-update', function () {
    if (document.getElementById('site-header')) PXCUI.renderHeader();
});

/* Loader safety nets */
window.addEventListener('pageshow', function () { PXCUI.hideLoader(); });
window.addEventListener('load', function () { PXCUI.hideLoader(); });
window.addEventListener('pagehide', function () { PXCUI.hideLoader(); });
setTimeout(function () { PXCUI.hideLoader(); }, 5000);

window.PXCUI = PXCUI;