document.addEventListener('DOMContentLoaded', async function () {
    await PXC.load();

    PXCUI.renderHeader();
    PXCUI.renderFooter();

    renderCart();

    // Re-render whenever the cart changes (add / remove / qty)
    document.addEventListener('pxc:cart-update', renderCart);
});


/* =========================================================
   MAIN RENDER
   ========================================================= */
function renderCart() {
    var listEl = document.getElementById('cartList');
    var summaryEl = document.getElementById('cartSummary');
    var countEl = document.getElementById('cartItemCount');

    if (!listEl) return;

    // Products haven't loaded yet
    if (!PXC.products || !PXC.products.length) {
        if (countEl) countEl.textContent = 'Loading your items…';

        listEl.innerHTML = `
            <div class="empty-state" style="padding:3rem 1rem">
                <h3>Loading products…</h3>
                <p>Please wait a moment.</p>
            </div>
        `;
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }

    var itemCount = PXC.cartCount();

    // Header count + page title
    if (countEl) {
        if (itemCount === 0) {
            countEl.textContent = 'Your cart is empty';
        } else {
            var itemWord = (itemCount === 1) ? '' : 's';
            countEl.textContent = itemCount + ' item' + itemWord + ' in your cart';
        }
    }
    document.title = 'Your Cart (' + itemCount + ') — TeamZampXUnited';

    // Empty cart
    if (itemCount === 0) {
        listEl.innerHTML = emptyCartHtml();

        if (summaryEl) {
            summaryEl.style.display = 'none';
            summaryEl.innerHTML = '';
        }

        renderRecommendations();
        return;
    }

    // Populated cart
    if (summaryEl) summaryEl.style.display = 'block';

    listEl.innerHTML = PXC.cart
        .map(function (item) {
            var p = PXC.getProduct(item.id);
            if (p) {
                return cartRowHtml(p, item.qty);
            }
            return '';
        })
        .join('');

    wireCartRows(listEl);
    renderSummary(summaryEl);
    renderRecommendations();
}


/* =========================================================
   CART ROW
   ========================================================= */
function cartRowHtml(p, qty) {
    var esc = PXCUI.escapeHtml;
    var cap = PXCUI.capitalize;

    var lineTotal = p.price * qty;
    var href = 'product.html?id=' + encodeURIComponent(p.id);

    return `
        <div class="cart-row" data-id="${esc(p.id)}">
            <a href="${href}" class="thumb">
                <img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">
            </a>

            <div class="cart-row-info">
                <h3><a href="${href}">${esc(p.name)}</a></h3>
                <div class="cat">${esc(p.brand)} · ${esc(cap(p.category))}</div>
                <div style="font-size:.8rem;color:var(--muted-foreground);margin-bottom:.5rem">
                    ${PXC.fmt(p.price)} each
                </div>

                <div class="qty" role="group" aria-label="Quantity">
                    <button type="button" data-dec="${esc(p.id)}" aria-label="Decrease quantity">−</button>
                    <span aria-live="polite">${qty}</span>
                    <button type="button" data-inc="${esc(p.id)}" aria-label="Increase quantity">+</button>
                </div>
            </div>

            <div class="cart-row-right">
                <div class="price">${PXC.fmt(lineTotal)}</div>
                <button type="button" class="remove-link" data-remove="${esc(p.id)}">
                    Remove
                </button>
            </div>
        </div>
    `;
}


/* =========================================================
   WIRE ROW EVENTS
   ========================================================= */
function wireCartRows(scope) {
    // ---- increase ----
    var incBtns = scope.querySelectorAll('[data-inc]');
    for (var i = 0; i < incBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                var itm = PXC.cart.find(function (x) {
                    return x.id === btn.dataset.inc;
                });
                if (itm) {
                    PXC.updateQty(itm.id, itm.qty + 1);
                }
            });
        })(incBtns[i]);
    }

    // ---- decrease (removes at 1) ----
    var decBtns = scope.querySelectorAll('[data-dec]');
    for (var j = 0; j < decBtns.length; j++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                var itm = PXC.cart.find(function (x) {
                    return x.id === btn.dataset.dec;
                });
                if (!itm) return;

                if (itm.qty <= 1) {
                    PXC.removeFromCart(itm.id);
                    PXCUI.toast('Item removed from cart');
                } else {
                    PXC.updateQty(itm.id, itm.qty - 1);
                }
            });
        })(decBtns[j]);
    }

    // ---- remove ----
    var removeBtns = scope.querySelectorAll('[data-remove]');
    for (var k = 0; k < removeBtns.length; k++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                PXC.removeFromCart(btn.dataset.remove);
                PXCUI.toast('Item removed from cart');
            });
        })(removeBtns[k]);
    }
}


/* =========================================================
   ORDER SUMMARY
   ========================================================= */
function renderSummary(host) {
    if (!host) return;

    var subtotal = PXC.cartSubtotal();
    var shipping = PXC.shippingFor(subtotal);
    var total = subtotal + shipping;
    var threshold = PXC.FREE_SHIPPING_THRESHOLD;

    // Progress to free shipping
    var toGo = Math.max(0, threshold - subtotal);
    var pct = Math.min(100, Math.round((subtotal / threshold) * 100));

    // Ship text + progress bar are only shown when there IS a shipping fee
    var shipBlock;
    if (shipping > 0) {
        shipBlock = `
            <div style="font-size:.78rem;color:var(--muted-foreground);padding:.35rem 0 0">
                Add <strong>${PXC.fmt(toGo)}</strong> more for free shipping.
            </div>
            <div class="ship-progress" aria-hidden="true">
                <div class="ship-progress__bar" style="width:${pct}%"></div>
            </div>
        `;
    } else {
        shipBlock = `
            <div style="font-size:.78rem;color:var(--success);padding:.35rem 0">
                🎉 You've unlocked free shipping!
            </div>
        `;
    }

    // Shipping amount cell
    var shippingCell;
    if (shipping === 0) {
        shippingCell = '<span style="color:var(--success);font-weight:600">FREE</span>';
    } else {
        shippingCell = PXC.fmt(shipping);
    }

    host.innerHTML = `
        <h3>Order Summary</h3>

        <div class="summary-row">
            <span>Items (${PXC.cartCount()})</span>
            <span>${PXC.fmt(subtotal)}</span>
        </div>

        <div class="summary-row">
            <span>Shipping</span>
            <span>${shippingCell}</span>
        </div>

        ${shipBlock}

        <div class="summary-row total">
            <span>Total</span>
            <span>${PXC.fmt(total)}</span>
        </div>

        <button type="button" class="btn btn-primary btn-block" style="margin-top:1rem" id="checkoutBtn">
            Proceed to Checkout
        </button>

        <a href="products.html" class="btn btn-outline btn-block" style="margin-top:.5rem">
            Continue shopping
        </a>

        <div style="font-size:.75rem;color:var(--muted-foreground);text-align:center;margin-top:.9rem;line-height:1.6">
            🔒 Secure checkout · 7-day returns · Free shipping over ₹${threshold}
        </div>
    `;

    var checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) checkoutBtn.addEventListener('click', handleCheckout);
}


/* =========================================================
   CHECKOUT
   ========================================================= */
async function handleCheckout() {
    // Must be logged in
    if (!PXCUI.requireLogin('place an order')) return;

    // Cart must not be empty
    if (PXC.cartCount() === 0) {
        PXCUI.toast('Your cart is empty', 'error');
        return;
    }

    // Lock the button while placing (prevents double-click)
    var btn = document.getElementById('checkoutBtn');
    var originalLabel = btn ? btn.textContent : '';

    if (btn && btn.disabled) return;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Placing order…';
        btn.style.opacity = '.75';
        btn.style.cursor = 'wait';
    }

    // Compute totals
    var subtotal = PXC.cartSubtotal();
    var shipping = PXC.shippingFor(subtotal);
    var total = subtotal + shipping;

    // Snapshot items
    var items = PXC.cart.map(function (i) {
        var p = PXC.getProduct(i.id);
        var price = p ? p.price : 0;
        return { id: i.id, qty: i.qty, price: price };
    });

    // Place order (async)
    var result;
    try {
        result = await PXC.placeOrder(items, total);
    } catch (err) {
        result = { ok: false, error: (err && err.message) || 'Could not place order.' };
    }

    // Handle failure
    if (!result || !result.ok) {
        var errMsg = (result && result.error) || 'Could not place order. Please try again.';
        PXCUI.toast(errMsg, 'error');

        if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel || 'Proceed to Checkout';
            btn.style.opacity = '';
            btn.style.cursor = '';
        }
        return;
    }

    // Success → clear cart, toast, redirect
    var order = result.order;

    PXC.clearCart();
    PXCUI.toast('Order ' + order.id + ' placed! 🎉', 'success');
    PXCUI.navigate('account.html#orders', 'Finalising order', 600);
    // (No need to restore button state — we're navigating away.)
}


/* =========================================================
   EMPTY CART STATE
   ========================================================= */
function emptyCartHtml() {
    return `
        <div class="empty-state" style="padding:3rem 1rem">
            <div style="font-size:3rem;margin-bottom:.75rem">🛒</div>
            <h3>Your cart is empty</h3>
            <p>Looks like you haven't added anything yet.</p>
            <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-top:1rem">
                <a href="products.html" class="btn btn-primary">Start shopping</a>
                <a href="products.html?sort=discount" class="btn btn-outline">View deals</a>
            </div>
        </div>
    `;
}


/* =========================================================
   RECOMMENDATIONS
   Looks for #cartRecommendations, then falls back to the
   cart section, then to #cartList's parent.
   ========================================================= */
function renderRecommendations() {
    var host = document.getElementById('cartRecommendations');

    if (!host) {
        var listEl = document.getElementById('cartList');
        var cartSection = listEl ? listEl.closest('section.container') : null;
        var anchor = cartSection || (listEl ? listEl.parentElement : null);

        if (!anchor) return;

        host = document.createElement('div');
        host.id = 'cartRecommendations';
        anchor.appendChild(host);
    }

    var inCartIds = PXC.cart.map(function (i) { return i.id; });

    var items = PXC.products
        .filter(function (p) {
            return inCartIds.indexOf(p.id) === -1;
        })
        .sort(function (a, b) {
            return b.rating - a.rating;
        })
        .slice(0, 4);

    if (items.length === 0) {
        host.innerHTML = '';
        return;
    }

    host.innerHTML = `
        <div class="section-head" style="margin-top:2.5rem">
            <h2 class="section-title">You may also like</h2>
            <a href="products.html" class="link-more">View all →</a>
        </div>
        <div class="product-grid" id="cartRecGrid">
            ${items.map(function (p) { return PXCUI.productCard(p); }).join('')}
        </div>
    `;

    PXCUI.wireProductCards(host);
}