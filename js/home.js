document.addEventListener('DOMContentLoaded', async function () {
    try { await PXC.load(); } catch (err) { console.error('[home] PXC.load:', err); }

    try { PXCUI.renderHeader(); } catch (err) { console.error('[home] header:', err); }
    try { PXCUI.renderFooter(); } catch (err) { console.error('[home] footer:', err); }

    try { renderHero(); } catch (err) { console.error('[home] hero:', err); }
    try { renderHeroSide(); } catch (err) { console.error('[home] heroSide:', err); }
    try { renderCategories(); } catch (err) { console.error('[home] categories:', err); }
    try { renderDeals(); } catch (err) { console.error('[home] deals:', err); }
    try { renderAds(); } catch (err) { console.error('[home] ads:', err); }
    try { renderFeatured(); } catch (err) { console.error('[home] featured:', err); }
    try { renderOffer(); } catch (err) { console.error('[home] offer:', err); }
    try { renderTrending(); } catch (err) { console.error('[home] trending:', err); }
    try { renderBrands(); } catch (err) { console.error('[home] brands:', err); }
    try { renderUSPs(); } catch (err) { console.error('[home] usps:', err); }
    try { renderNewsletter(); } catch (err) { console.error('[home] newsletter:', err); }
    try { startCountdown(); } catch (err) { console.error('[home] countdown:', err); }
    try { startHeroAuto(); } catch (err) { console.error('[home] heroAuto:', err); }

    // Re-sync wishlist hearts when any heart toggles
    document.addEventListener('pxc:wishlist-update', refreshAllWishlistHearts);
});


/* =========================================================
   HERO SLIDER
   ========================================================= */
var heroIndex = 0;
var heroTimer = null;

function renderHero() {
    var esc = PXCUI.escapeHtml;
    var slides = (PXC.banners && PXC.banners.hero) || [];
    var host = document.getElementById('heroSlider');
    if (!host || !slides.length) return;

    // ---- build each slide ----
    var slidesHtml = slides.map(function (s, i) {
        var active = (i === 0) ? 'active' : '';

        var badgeHtml = '';
        if (s.badge) {
            badgeHtml = '<span class="hero-badge">' + esc(s.badge) + '</span>';
        }

        return `
            <div class="hero-slide ${active}"
                 style="background-image:url('${esc(s.image)}')"
                 role="group"
                 aria-label="Slide ${i + 1} of ${slides.length}">
                <div class="hero-slide-content">
                    ${badgeHtml}
                    <h2>${esc(s.title)}</h2>
                    <p>${esc(s.subtitle)}</p>
                    <a href="${esc(s.link)}" class="btn btn-light">${esc(s.cta)}</a>
                </div>
            </div>
        `;
    }).join('');

    // ---- build each dot ----
    var dotsHtml = slides.map(function (_, i) {
        var active = (i === 0) ? 'active' : '';
        return `
            <button type="button" class="hero-dot ${active}"
                    data-i="${i}" role="tab"
                    aria-label="Go to slide ${i + 1}"></button>
        `;
    }).join('');

    host.innerHTML = slidesHtml + `
        <div class="hero-dots" id="heroDots" role="tablist">
            ${dotsHtml}
        </div>
    `;

    // ---- wire each dot ----
    var dots = host.querySelectorAll('.hero-dot');
    for (var di = 0; di < dots.length; di++) {
        (function (dot) {
            dot.addEventListener('click', function () {
                showHero(Number(dot.dataset.i));
                startHeroAuto();
            });
        })(dots[di]);
    }
}

function showHero(i) {
    heroIndex = i;

    var slides = document.querySelectorAll('.hero-slide');
    for (var si = 0; si < slides.length; si++) {
        slides[si].classList.toggle('active', si === i);
    }

    var dots = document.querySelectorAll('.hero-dot');
    for (var di = 0; di < dots.length; di++) {
        dots[di].classList.toggle('active', di === i);
    }
}

function startHeroAuto() {
    clearInterval(heroTimer);

    var banners = (PXC.banners && PXC.banners.hero) || [];
    var total = banners.length;
    if (total < 2) return;

    heroTimer = setInterval(function () {
        showHero((heroIndex + 1) % total);
    }, 6000);
}


/* =========================================================
   HERO SIDE CARDS
   ========================================================= */
function renderHeroSide() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('heroSide');
    if (!host) return;

    var ads = ((PXC.banners && PXC.banners.ads) || []).slice(0, 2);
    if (!ads.length) {
        host.innerHTML = '';
        return;
    }

    var html = ads.map(function (a) {
        var bg = '';
        if (a.image) {
            bg = "--bg-image:url('" + esc(a.image) + "');";
        }

        return `
            <a class="hero-side-card" href="${esc(a.link)}" style="${bg}">
                <div>
                    <h3>${esc(a.title)}</h3>
                    <p>${esc(a.subtitle)}</p>
                </div>
                <span class="hero-side-cta">Shop now →</span>
            </a>
        `;
    }).join('');

    host.innerHTML = html;
}


/* =========================================================
   CATEGORY STRIP
   ========================================================= */
function renderCategories() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('catStrip');
    if (!host) return;

    var html = PXC.categories.map(function (c) {
        return `
            <a class="cat-card"
               href="products.html?category=${encodeURIComponent(c.id)}"
               data-category-id="${esc(c.id)}">
                <div class="cat-icon">${c.icon}</div>
                <div class="cat-name">${esc(c.name)}</div>
            </a>
        `;
    }).join('');

    host.innerHTML = html;
}


/* =========================================================
   WISHLIST HEART SYNC
   ========================================================= */
function refreshAllWishlistHearts() {
    var buttons = document.querySelectorAll('[data-wish]');
    for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var id = btn.dataset.wish;
        var wish = PXC.isWishlisted(id);
        var svg = btn.querySelector('svg');

        btn.classList.toggle('active', wish);
        if (svg) {
            svg.setAttribute('fill', wish ? 'currentColor' : 'none');
        }

        var label = wish ? 'Remove from wishlist' : 'Add to wishlist';
        btn.setAttribute('aria-label', label);
    }
}


/* =========================================================
   DEALS OF THE DAY (top 4 by discount %)
   ========================================================= */
function renderDeals() {
    var host = document.getElementById('dealGrid');
    if (!host) return;

    var deals = PXC.products
        .filter(function (p) {
            return p.mrp > p.price;
        })
        .sort(function (a, b) {
            return PXC.discountPct(b) - PXC.discountPct(a);
        })
        .slice(0, 4);

    host.innerHTML = deals.map(function (p) {
        return PXCUI.productCard(p);
    }).join('');

    PXCUI.wireProductCards(host);
}


/* =========================================================
   TWO AD BANNERS
   ========================================================= */
function renderAds() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('adDuo');
    if (!host) return;

    var ads = (PXC.banners && PXC.banners.ads) || [];
    var html = ads.map(function (a) {
        return `
            <a href="${esc(a.link)}" class="ad-card"
               style="background-image:url('${esc(a.image)}')">
                <div>
                    <h3>${esc(a.title)}</h3>
                    <p>${esc(a.subtitle)}</p>
                    <span class="ad-cta">Explore →</span>
                </div>
            </a>
        `;
    }).join('');

    host.innerHTML = html;
}


/* =========================================================
   FEATURED PICKS
   ========================================================= */
function renderFeatured() {
    var host = document.getElementById('featuredGrid');
    if (!host) return;

    var items = PXC.products
        .filter(function (p) {
            return Array.isArray(p.tags) && p.tags.indexOf('featured') !== -1;
        })
        .slice(0, 8);

    host.innerHTML = items.map(function (p) {
        return PXCUI.productCard(p);
    }).join('');

    PXCUI.wireProductCards(host);
}


/* =========================================================
   OFFER BANNER
   ========================================================= */
function renderOffer() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('offerBanner');
    if (!host) return;

    var o = PXC.banners && PXC.banners.offer;
    if (!o) {
        host.innerHTML = '';
        return;
    }

    host.innerHTML = `
        <h2>${esc(o.title)}</h2>
        <p>${esc(o.subtitle)}</p>
        <a href="${esc(o.link)}" class="btn btn-light">${esc(o.cta)}</a>
    `;
}


/* =========================================================
   TRENDING (top rated)
   ========================================================= */
function renderTrending() {
    var host = document.getElementById('trendGrid');
    if (!host) return;

    var items = PXC.products
        .slice()
        .sort(function (a, b) {
            return b.rating - a.rating;
        })
        .slice(0, 8);

    host.innerHTML = items.map(function (p) {
        return PXCUI.productCard(p);
    }).join('');

    PXCUI.wireProductCards(host);
}


/* =========================================================
   BRAND STRIP (marquee)
   Duplicates list so translateX(-50%) loops seamlessly.
   ========================================================= */
function renderBrands() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('brandStrip');
    if (!host) return;

    var brands = (PXC.banners && PXC.banners.brands) || [];
    if (!brands.length) {
        host.innerHTML = '';
        return;
    }

    // small helper — same markup for both passes
    function chip(b, ariaHidden) {
        var hiddenAttr = ariaHidden ? 'aria-hidden="true" tabindex="-1"' : '';
        return `
            <a class="brand-chip"
               href="products.html?q=${encodeURIComponent(b)}"
               data-no-loader
               ${hiddenAttr}>
                ${esc(b)}
            </a>
        `;
    }

    var firstPass = brands.map(function (b) { return chip(b, false); }).join('');
    var secondPass = brands.map(function (b) { return chip(b, true); }).join('');

    host.innerHTML = `
        <div class="marquee-track">
            ${firstPass}
            ${secondPass}
        </div>
    `;
}


/* =========================================================
   USP ROW (marquee)

   FIX: previously this rendered the USP list 4× total
   (usps.concat(usps), then rendered that twice = 16 items).
   The marquee CSS loops at translateX(-50%), so the list
   only needs to appear twice — same as renderBrands().
   Now: 8 items total (4 original + 4 repeated).
   ========================================================= */
function renderUSPs() {
    var esc = PXCUI.escapeHtml;
    var host = document.getElementById('uspRow');
    if (!host) return;

    var usps = (PXC.banners && PXC.banners.usps) || [];
    if (!usps.length) {
        host.innerHTML = '';
        return;
    }

    // small helper — same markup for both passes
    function item(u, ariaHidden) {
        var hiddenAttr = ariaHidden ? 'aria-hidden="true"' : '';
        return `
            <div class="usp" ${hiddenAttr}>
                <div class="usp-icon">${u.icon}</div>
                <div>
                    <h4>${esc(u.title)}</h4>
                    <p>${esc(u.text)}</p>
                </div>
            </div>
        `;
    }

    var firstPass = usps.map(function (u) { return item(u, false); }).join('');
    var secondPass = usps.map(function (u) { return item(u, true); }).join('');

    host.innerHTML = `
        <div class="marquee-track">
            ${firstPass}
            ${secondPass}
        </div>
    `;
}


/* =========================================================
   NEWSLETTER BOX
   ========================================================= */
function renderNewsletter() {
    var host = document.getElementById('newsletterBox');
    if (!host) return;

    host.innerHTML = `
        <div class="newsletter">
            <h2>Join the TeamZampXUnited family</h2>
            <p>Subscribe for exclusive offers, new arrivals and insider deals.</p>
            <form class="newsletter-form" data-newsletter>
                <input type="email" placeholder="Enter your email" required
                       aria-label="Email address">
                <button class="btn btn-light" type="submit">Subscribe</button>
            </form>
        </div>
    `;

    PXCUI._wireNewsletterForms(host);
}


/* =========================================================
   COUNTDOWN (resets at midnight)
   ========================================================= */
function startCountdown() {
    var h = document.getElementById('cdH');
    var m = document.getElementById('cdM');
    var s = document.getElementById('cdS');
    if (!h || !m || !s) return;

    function tick() {
        var end = new Date();
        end.setHours(23, 59, 59, 999);

        var diff = Math.max(0, end - new Date());

        h.textContent = String(Math.floor(diff / 3600000)).padStart(2, '0');
        m.textContent = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        s.textContent = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    }

    tick();
    setInterval(tick, 1000);
}