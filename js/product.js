document.addEventListener('DOMContentLoaded', async function () {
    // 1. Load catalogue
    await PXC.load();

    // 2. Always render chrome
    PXCUI.renderHeader();
    PXCUI.renderFooter();

    var root = document.getElementById('productRoot');
    if (!root) return;

    // 3. Data never loaded
    if (!PXC.products || !PXC.products.length) {
        document.title = 'Data not loaded — TeamZampXUnited';
        root.innerHTML = `
            <div class="empty-state" style="padding:5rem 1rem">
                <div style="font-size:3rem;margin-bottom:.5rem">⚠️</div>
                <h3>Product data failed to load</h3>
                <p>
                    Make sure <code>js/data.js</code> is included
                    <strong>before</strong> <code>js/store.js</code>.
                </p>
                <a href="products.html" class="btn btn-primary" style="margin-top:1rem">
                    Browse products
                </a>
            </div>
        `;
        return;
    }

    // 4. Resolve product id (multiple sources)
    var id = resolveProductId();

    // 5. No id → show catalogue
    if (!id) return renderCatalogFallback(root);

    // 6. Id given but not found
    var product = PXC.getProduct(id);
    if (!product) return renderNotFound(root, id);

    // 7. Track recently viewed
    try { PXC.trackRecentlyViewed(product.id); } catch (e) { }

    // 8. Render
    document.title = product.name + ' — TeamZampXUnited';
    renderProductPage(root, product);
});


/* =========================================================
   RESOLVE PRODUCT ID
   Tries: ?id= → #id → /product/id path → sessionStorage
   ========================================================= */
function resolveProductId() {
    // 1. ?id= query param
    try {
        var q = new URLSearchParams(location.search).get('id');
        if (q && q.trim()) return q.trim();
    } catch (e) { }

    // 2. #p001 hash
    if (location.hash && location.hash.length > 1) {
        var h = location.hash.replace('#', '').trim();
        if (h && /^[a-z0-9_-]+$/i.test(h) && PXC.getProduct(h)) return h;
    }

    // 3. /product/p001 path
    var parts = location.pathname.split('/').filter(function (s) { return s !== ''; });
    var last = parts[parts.length - 1];
    if (last && last !== 'product' && last !== 'product.html') {
        if (/^p\d+$/i.test(last) || PXC.getProduct(last)) return last;
    }

    // 4. sessionStorage (set by ui.js on product link clicks)
    try {
        var stored = sessionStorage.getItem('pxcLastProductId');
        if (stored && stored.trim()) return stored.trim();
    } catch (e) { }

    return null;
}


/* =========================================================
   CATALOG FALLBACK (when no id is present)
   ========================================================= */
function renderCatalogFallback(root) {
    document.title = 'All Products — TeamZampXUnited';

    var items = PXC.products.slice(0, 12);

    root.innerHTML = `
        <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href="index.html">Home</a>
            <span aria-hidden="true"> / </span>
            <span>Products</span>
        </nav>

        <div style="padding:1rem 0 2rem">
            <h1 style="font-family:'Poppins',sans-serif;font-size:1.5rem;
                       font-weight:700;letter-spacing:-.02em;margin-bottom:.4rem">
                All Products
            </h1>
            <p style="color:var(--muted-foreground);font-size:.9rem">
                Pick a product to see its full details.
            </p>
        </div>

        <div class="product-grid" id="catalogGrid">
            ${items.map(function (p) { return PXCUI.productCard(p); }).join('')}
        </div>

        <div style="text-align:center;padding:2rem 0 3rem">
            <a href="products.html" class="btn btn-primary">Browse all products</a>
        </div>
    `;

    PXCUI.wireProductCards(root);
}


/* =========================================================
   NOT FOUND
   ========================================================= */
function renderNotFound(root, id) {
    var esc = PXCUI.escapeHtml;
    document.title = 'Product not found — TeamZampXUnited';

    root.innerHTML = `
        <div class="empty-state" style="padding:5rem 1rem">
            <div style="font-size:3rem;margin-bottom:.5rem">🔍</div>
            <h3>Product not found</h3>
            <p>The product you're looking for (<code>${esc(id)}</code>) doesn't exist.</p>
            <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-top:1.25rem">
                <a href="products.html" class="btn btn-primary">Browse products</a>
                <a href="index.html" class="btn btn-outline">Back to home</a>
            </div>
        </div>
    `;
}


/* =========================================================
   PRODUCT PAGE RENDER
   ========================================================= */
function renderProductPage(root, p) {
    var esc = PXCUI.escapeHtml;
    var cap = PXCUI.capitalize;
    var disc = PXC.discountPct(p);
    var reviews = PXC.getReviews(p.id);

    var avgRating;
    if (reviews.length) {
        var sum = 0;
        for (var rs = 0; rs < reviews.length; rs++) {
            sum += reviews[rs].rating;
        }
        avgRating = (sum / reviews.length).toFixed(1);
    } else {
        avgRating = p.rating;
    }

    var inStock = p.stock > 0;
    var wish = PXC.isWishlisted(p.id);

    // Build the meta rows first (each is a small HTML string)
    var availabilityHtml = '<span style="color:' + (inStock ? 'var(--success)' : 'var(--destructive)') + '">' +
        (inStock ? (p.stock + ' in stock') : 'Out of stock') +
        '</span>';

    var categoryMetaHtml =
        '<span>' +
        '<a href="products.html?category=' + encodeURIComponent(p.category) + '">' +
        esc(cap(p.category)) +
        '</a>' +
        '&nbsp;/&nbsp;' + esc(p.subcategory) +
        '</span>';

    // Thumbs block — only rendered when there is more than 1 image
    var thumbsHtml = '';
    if (p.images.length > 1) {
        var thumbButtons = p.images.map(function (img, i) {
            var active = (i === 0) ? 'active' : '';
            return `
                <button type="button"
                        class="${active}"
                        data-i="${i}"
                        aria-label="Image ${i + 1}">
                    <img src="${esc(img)}" alt="">
                </button>
            `;
        }).join('');

        thumbsHtml = `
            <div class="gallery-thumbs" id="galleryThumbs" role="tablist" aria-label="Product images">
                ${thumbButtons}
            </div>
        `;
    }

    // MRP/discount line — only when there is an actual discount
    var mrpBlock = '';
    if (p.mrp > p.price) {
        mrpBlock =
            '<span class="detail-mrp">' + PXC.fmt(p.mrp) + '</span>' +
            '<span class="detail-discount">' + disc + '% off</span>';
    }

    // Review count text
    var reviewWord = (reviews.length === 1) ? '' : 's';

    // Disabled attribute for out-of-stock actions
    var disabledAttr = inStock ? '' : 'disabled style="opacity:.5;cursor:not-allowed"';
    var cartLabel = inStock ? 'Add to Cart' : 'Out of Stock';

    // Wishlist label + fill
    var wishFill = wish ? 'currentColor' : 'none';
    var wishLabel = wish ? 'Wishlisted' : 'Add to Wishlist';

    // Specs table rows
    var specsHtml = '';
    var specs = p.specifications || {};
    var specKeys = Object.keys(specs);
    for (var si = 0; si < specKeys.length; si++) {
        var key = specKeys[si];
        specsHtml += '<tr><td>' + esc(key) + '</td><td>' + esc(specs[key]) + '</td></tr>';
    }

    // Feature list rows
    var featuresHtml = '';
    var feats = p.features || [];
    for (var fi = 0; fi < feats.length; fi++) {
        featuresHtml += '<li>' + esc(feats[fi]) + '</li>';
    }

    root.innerHTML = `
        <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href="index.html">Home</a>
            <span aria-hidden="true"> / </span>
            <a href="products.html">Products</a>
            <span aria-hidden="true"> / </span>
            <a href="products.html?category=${encodeURIComponent(p.category)}">
                ${esc(cap(p.category))}
            </a>
            <span aria-hidden="true"> / </span>
            <span>${esc(p.name)}</span>
        </nav>

        <div class="product-detail">
            <!-- Gallery -->
            <div class="gallery">
                <div class="gallery-main" id="galleryMain" tabindex="0">
                    <img id="galleryMainImg" src="${esc(p.images[0])}" alt="${esc(p.name)}">
                </div>

                ${thumbsHtml}
            </div>

            <!-- Info -->
            <div class="detail-info">
                <div class="detail-brand">${esc(p.brand)}</div>
                <h1>${esc(p.name)}</h1>

                <div class="rating-row" style="margin-top:.5rem">
                    <span class="rating-pill">${avgRating} ★</span>
                    <span class="rating-count">
                        ${p.ratingCount.toLocaleString('en-IN')} ratings
                    </span>
                    <span aria-hidden="true" style="color:var(--muted-foreground)">·</span>
                    <a href="#reviews" id="reviewsJumpLink"
                       style="color:var(--muted-foreground);font-size:.8rem">
                        ${reviews.length} review${reviewWord}
                    </a>
                </div>

                <div class="detail-price-row">
                    <span class="detail-price">${PXC.fmt(p.price)}</span>
                    ${mrpBlock}
                </div>

                <p style="font-size:.8rem;color:var(--success);font-weight:600">
                    Inclusive of all taxes · Free shipping over ₹${PXC.FREE_SHIPPING_THRESHOLD}
                </p>

                <p class="detail-desc">${esc(p.description)}</p>

                <div class="detail-actions">
                    <button type="button" class="btn btn-primary" id="addCartBtn" ${disabledAttr}>
                        ${cartLabel}
                    </button>

                    <button type="button" class="btn btn-outline" id="buyNowBtn" ${disabledAttr}>
                        Buy Now
                    </button>

                    <button type="button" class="btn btn-outline" id="wishBtn">
                        <svg width="18" height="18" viewBox="0 0 24 24"
                             fill="${wishFill}"
                             stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                        <span id="wishLabel">
                            ${wishLabel}
                        </span>
                    </button>
                </div>

                <div class="detail-meta">
                    ${metaRow('Availability', availabilityHtml)}
                    ${metaRow('Delivery', '<span>Free delivery in 2–4 business days</span>')}
                    ${metaRow('Returns', '<span>7-day easy return policy</span>')}
                    ${metaRow('Category', categoryMetaHtml)}
                    ${metaRow('Product ID', '<span>' + esc(String(p.id).toUpperCase()) + '</span>')}
                </div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="tabs" id="tabs" role="tablist">
            <button type="button" class="tab-btn active" data-tab="specs" role="tab" aria-selected="true">
                Specifications
            </button>
            <button type="button" class="tab-btn" data-tab="features" role="tab" aria-selected="false">
                Key Features
            </button>
            <button type="button" class="tab-btn" data-tab="reviews" role="tab" aria-selected="false">
                Reviews (<span id="reviewsTabCount">${reviews.length}</span>)
            </button>
            <button type="button" class="tab-btn" data-tab="shipping" role="tab" aria-selected="false">
                Shipping &amp; Returns
            </button>
        </div>

        <!-- Specs -->
        <div class="tab-panel active" id="tab-specs" role="tabpanel">
            <table class="spec-table">
                <tbody>${specsHtml}</tbody>
            </table>
        </div>

        <!-- Features -->
        <div class="tab-panel" id="tab-features" role="tabpanel">
            <ul class="feature-list">${featuresHtml}</ul>
        </div>

        <!-- Reviews -->
        <div class="tab-panel" id="tab-reviews" role="tabpanel">
            <div id="reviewsHost">
                ${renderReviewsBlock(p.id, avgRating, reviews)}
            </div>
        </div>

        <!-- Shipping -->
        <div class="tab-panel" id="tab-shipping" role="tabpanel">
            <p style="font-size:.9rem;line-height:1.7;color:#333">
                <strong>Shipping:</strong> Free standard shipping on all orders
                above ₹${PXC.FREE_SHIPPING_THRESHOLD}. Delivery in 2–4 business days.<br><br>

                <strong>Returns:</strong> 7-day easy returns from the date of
                delivery. Items must be unused and in original packaging.<br><br>

                <strong>Warranty:</strong> As per manufacturer's policy.<br><br>

                <strong>Questions?</strong>
                <a href="contact.html" style="text-decoration:underline">Contact us</a>.
            </p>
        </div>

        <!-- Related -->
        <section class="section">
            <div class="section-head">
                <h2 class="section-title">You may also like</h2>
                <a href="products.html?category=${encodeURIComponent(p.category)}"
                   class="link-more">
                    See all in ${esc(cap(p.category))} →
                </a>
            </div>
            <div class="product-grid" id="relatedGrid"></div>
        </section>
    `;

    wireGallery(p);
    wireActions(p);
    wireTabs();
    wireReviewForm(p.id);
    wireReviewsJumpLink();
    renderRelated(p);

    // Live-sync hearts when any wishlist changes
    document.addEventListener('pxc:wishlist-update', function () {
        syncWishButton(p.id);
        syncRelatedHearts();
    });

    // Live-sync reviews if added elsewhere
    document.addEventListener('pxc:review-update', function (e) {
        if (e.detail && e.detail.productId === p.id) refreshReviewsBlock(p);
    });
}

function metaRow(label, valueHtml) {
    return `
        <div class="row">
            <strong>${label}</strong>
            ${valueHtml}
        </div>
    `;
}

function syncRelatedHearts() {
    var buttons = document.querySelectorAll('#relatedGrid [data-wish]');
    for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var isWish = PXC.isWishlisted(btn.dataset.wish);
        btn.classList.toggle('active', isWish);

        var svg = btn.querySelector('svg');
        if (svg) {
            svg.setAttribute('fill', isWish ? 'currentColor' : 'none');
        }
    }
}


/* =========================================================
   REVIEWS BLOCK
   ========================================================= */
function renderReviewsBlock(productId, avgRating, reviews) {
    var esc = PXCUI.escapeHtml;
    var canReview = PXC.isLoggedIn() && !PXC.hasUserReviewed(productId);
    var hasReviewed = PXC.isLoggedIn() && PXC.hasUserReviewed(productId);

    // ---- review list ----
    var listHtml;
    if (reviews.length) {
        listHtml = reviews.map(reviewItem).join('');
    } else {
        listHtml = '<p style="color:var(--muted-foreground);padding:.5rem 0">' +
            'No reviews yet. Be the first to review this product.' +
            '</p>';
    }

    // ---- rating header (only when there are reviews) ----
    var headerHtml = '';
    if (reviews.length) {
        var rounded = Math.round(avgRating);
        var filled = '★'.repeat(rounded);
        var empty = '☆'.repeat(5 - rounded);
        var revWord = (reviews.length === 1) ? '' : 's';

        headerHtml =
            '<div style="margin-bottom:1rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap">' +
            '<div style="font-size:2rem;font-family:\'Poppins\',sans-serif;' +
            'font-weight:800;letter-spacing:-.02em">' +
            avgRating +
            '</div>' +
            '<div>' +
            '<div class="stars">' + filled + empty + '</div>' +
            '<div style="font-size:.82rem;color:var(--muted-foreground)">' +
            'Based on ' + reviews.length + ' review' + revWord +
            '</div>' +
            '</div>' +
            '</div>';
    }

    // ---- form area ----
    var formHtml = '';

    if (canReview) {
        // build the 5 star buttons
        var starButtons = '';
        for (var n = 1; n <= 5; n++) {
            var nWord = (n === 1) ? '' : 's';
            starButtons +=
                '<button type="button" class="star-btn" ' +
                'data-star="' + n + '" ' +
                'aria-label="' + n + ' star' + nWord + '">★</button>';
        }

        formHtml = `
            <div class="review-form-wrap" id="reviewFormWrap">
                <h3>Write a review</h3>
                <form id="reviewForm" novalidate>
                    <div class="form-group">
                        <label>Your rating</label>
                        <div class="star-picker" id="starPicker" data-value="5">
                            ${starButtons}
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="reviewTitle">Title</label>
                        <input type="text" id="reviewTitle" name="title"
                               placeholder="Sum it up in a few words"
                               maxlength="80" required>
                    </div>

                    <div class="form-group">
                        <label for="reviewText">Your review</label>
                        <textarea id="reviewText" name="text"
                                  placeholder="What did you like or dislike?"
                                  rows="4" maxlength="800" required></textarea>
                    </div>

                    <button type="submit" class="btn btn-primary" id="reviewSubmitBtn">
                        Submit review
                    </button>
                </form>
            </div>
        `;
    } else if (hasReviewed) {
        formHtml = `
            <div class="review-form-wrap" style="text-align:center">
                <p style="color:var(--muted-foreground);font-size:.85rem;margin:0">
                    ✅ Thanks — you've already reviewed this product.
                </p>
            </div>
        `;
    } else {
        var loginNext = 'login.html?next=product.html%3Fid%3D' + encodeURIComponent(productId);
        formHtml = `
            <div class="review-form-wrap" style="text-align:center">
                <p style="color:var(--muted-foreground);font-size:.85rem;margin:0 0 .75rem">
                    Log in to write a review.
                </p>
                <a href="${loginNext}"
                   class="btn btn-outline btn-sm">Login</a>
            </div>
        `;
    }

    return headerHtml +
        '<div class="reviews-list">' + listHtml + '</div>' +
        formHtml;
}

function refreshReviewsBlock(p) {
    var host = document.getElementById('reviewsHost');
    if (!host) return;

    var reviews = PXC.getReviews(p.id);

    var avgRating;
    if (reviews.length) {
        var sum = 0;
        for (var i = 0; i < reviews.length; i++) {
            sum += reviews[i].rating;
        }
        avgRating = (sum / reviews.length).toFixed(1);
    } else {
        avgRating = p.rating;
    }

    host.innerHTML = renderReviewsBlock(p.id, avgRating, reviews);
    wireReviewForm(p.id);

    var countEl = document.getElementById('reviewsTabCount');
    if (countEl) countEl.textContent = reviews.length;
}


/* =========================================================
   GALLERY
   ========================================================= */
function wireGallery(p) {
    var thumbsHost = document.getElementById('galleryThumbs');
    var mainImg = document.getElementById('galleryMainImg');
    var main = document.getElementById('galleryMain');

    if (!thumbsHost || !mainImg || !main) return;

    // Thumbnail click
    thumbsHost.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-i]');
        if (!btn) return;

        mainImg.src = p.images[Number(btn.dataset.i)];

        var buttons = thumbsHost.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].classList.toggle('active', buttons[i] === btn);
        }
    });

    // Arrow-key navigation
    main.addEventListener('keydown', function (e) {
        var buttons = thumbsHost.querySelectorAll('button');
        if (!buttons.length) return;

        // find the active thumb index
        var current = -1;
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].classList.contains('active')) {
                current = i;
                break;
            }
        }

        if (e.key === 'ArrowRight') {
            buttons[(current + 1) % buttons.length].click();
        }
        if (e.key === 'ArrowLeft') {
            buttons[(current - 1 + buttons.length) % buttons.length].click();
        }
    });
}


/* =========================================================
   ACTIONS (Add to Cart / Buy Now / Wishlist)
   ========================================================= */
function wireActions(p) {
    var addBtn = document.getElementById('addCartBtn');
    var buyBtn = document.getElementById('buyNowBtn');
    var wishBtn = document.getElementById('wishBtn');

    if (addBtn && !addBtn.disabled) {
        addBtn.addEventListener('click', function () {
            if (!PXCUI.requireLogin('add items to your cart')) return;
            PXC.addToCart(p.id, 1);
            PXCUI.toast('Added to cart 🛒', 'success');
        });
    }

    if (buyBtn && !buyBtn.disabled) {
        buyBtn.addEventListener('click', function () {
            if (!PXCUI.requireLogin('buy this product')) return;
            PXC.addToCart(p.id, 1);
            PXCUI.navigate('cart.html', 'Going to cart');
        });
    }

    if (wishBtn) {
        wishBtn.addEventListener('click', function () {
            PXC.toggleWishlist(p.id);
            var isWish = PXC.isWishlisted(p.id);
            PXCUI.toast(isWish ? 'Added to wishlist ❤️' : 'Removed from wishlist');
        });
    }
}

function syncWishButton(id) {
    var wishBtn = document.getElementById('wishBtn');
    var label = document.getElementById('wishLabel');
    if (!wishBtn) return;

    var isWish = PXC.isWishlisted(id);
    var svg = wishBtn.querySelector('svg');

    if (svg) svg.setAttribute('fill', isWish ? 'currentColor' : 'none');
    if (label) label.textContent = isWish ? 'Wishlisted' : 'Add to Wishlist';
}


/* =========================================================
   TABS
   ========================================================= */
function wireTabs() {
    var tabsEl = document.getElementById('tabs');
    if (!tabsEl) return;

    tabsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.tab-btn');
        if (btn) activateTab(btn.dataset.tab);
    });

    // Activate on load if the URL already points to #reviews
    if (location.hash === '#reviews') activateTab('reviews');

    // React to hash changes (once)
    if (!window._pxcTabHashBound) {
        window._pxcTabHashBound = true;
        window.addEventListener('hashchange', function () {
            if (location.hash !== '#reviews') return;
            activateTab('reviews');
            var el = document.getElementById('tab-reviews');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
}

function activateTab(name) {
    var tabButtons = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < tabButtons.length; i++) {
        var b = tabButtons[i];
        var active = (b.dataset.tab === name);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
    }

    var panels = document.querySelectorAll('.tab-panel');
    for (var j = 0; j < panels.length; j++) {
        panels[j].classList.toggle('active', panels[j].id === 'tab-' + name);
    }
}


/* =========================================================
   REVIEW JUMP LINK ("X reviews" → #reviews tab)
   ========================================================= */
function wireReviewsJumpLink() {
    var link = document.getElementById('reviewsJumpLink');
    if (!link) return;

    link.addEventListener('click', function (e) {
        e.preventDefault();
        activateTab('reviews');

        try { history.replaceState(null, '', '#reviews'); } catch (e2) { }

        var el = document.getElementById('tab-reviews');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}


/* =========================================================
   REVIEW FORM (async submit)
   ========================================================= */
function wireReviewForm(productId) {
    var form = document.getElementById('reviewForm');
    var picker = document.getElementById('starPicker');
    if (!form || !picker) return;

    // ----- Star picker -----
    var rating = Number(picker.dataset.value) || 5;

    function paintStars(val) {
        var buttons = picker.querySelectorAll('.star-btn');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var n = Number(btn.dataset.star);
            btn.classList.toggle('active', n <= val);
            btn.setAttribute('aria-pressed', n === val ? 'true' : 'false');
        }
    }
    paintStars(rating);

    picker.addEventListener('click', function (e) {
        var btn = e.target.closest('.star-btn');
        if (!btn) return;
        rating = Number(btn.dataset.star) || 5;
        picker.dataset.value = String(rating);
        paintStars(rating);
    });

    picker.addEventListener('mouseover', function (e) {
        var btn = e.target.closest('.star-btn');
        if (btn) paintStars(Number(btn.dataset.star));
    });

    picker.addEventListener('mouseleave', function () {
        paintStars(rating);
    });

    // ----- Submit -----
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        if (!PXCUI.requireLogin('write a review')) return;

        var titleInput = form.querySelector('#reviewTitle');
        var textInput = form.querySelector('#reviewText');
        var submitBtn = form.querySelector('#reviewSubmitBtn');

        var title = (titleInput.value || '').trim();
        var text = (textInput.value || '').trim();

        if (!title) {
            titleInput.focus();
            return PXCUI.toast('Please add a short title.', 'error');
        }
        if (text.length < 4) {
            textInput.focus();
            return PXCUI.toast('Your review is a bit too short.', 'error');
        }

        // Lock button while server call is in flight
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.dataset._label = submitBtn.textContent;
            submitBtn.textContent = 'Posting…';
            submitBtn.style.opacity = '.75';
            submitBtn.style.cursor = 'wait';
        }

        var entry = null;
        var error = null;

        try {
            entry = await PXC.addReview(productId, { rating: rating, title: title, text: text });
        } catch (err) {
            error = err;
        }

        // Always restore the button
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtn.dataset._label || 'Submit review';
            submitBtn.style.opacity = '';
            submitBtn.style.cursor = '';
        }

        if (!entry) {
            var message = (error && error.message)
                || 'Could not save your review. You may have already reviewed this product.';
            return PXCUI.toast(message, 'error');
        }

        PXCUI.toast('Thanks for your review! ⭐', 'success');
        // refreshReviewsBlock fires via the pxc:review-update listener
    });
}


/* =========================================================
   REVIEW ITEM
   ========================================================= */
function reviewItem(r) {
    var esc = PXCUI.escapeHtml;
    var stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);

    return `
        <div class="review-item">
            <div class="review-head">
                <span class="review-user">${esc(r.user)}</span>
                <span class="review-date">${esc(r.date)}</span>
            </div>
            <div class="stars" aria-label="${r.rating} out of 5 stars">${stars}</div>
            <div class="review-title">${esc(r.title)}</div>
            <div class="review-text">${esc(r.text)}</div>
        </div>
    `;
}


/* =========================================================
   RELATED PRODUCTS
   ========================================================= */
function renderRelated(p) {
    var host = document.getElementById('relatedGrid');
    if (!host) return;

    var related = PXC.products.filter(function (x) {
        return x.category === p.category && x.id !== p.id;
    });

    // Top up with other products if we don't have 4 yet
    if (related.length < 4) {
        var fillers = PXC.products.filter(function (x) {
            if (x.id === p.id) return false;
            for (var ri = 0; ri < related.length; ri++) {
                if (related[ri].id === x.id) return false;
            }
            return true;
        });
        related = related.concat(fillers);
    }

    related = related.slice(0, 4);

    host.innerHTML = related.map(function (x) {
        return PXCUI.productCard(x);
    }).join('');

    PXCUI.wireProductCards(host);
}