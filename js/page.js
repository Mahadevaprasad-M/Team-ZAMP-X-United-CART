document.addEventListener('DOMContentLoaded', async function () {
    try { await PXC.load(); } catch (err) { console.error('[page] PXC.load():', err); }

    try {
        PXCUI.renderHeader();
        PXCUI.renderFooter();
    } catch (err) {
        console.error('[page] Header/footer render failed:', err);
    }

    renderPage(resolveSlug());
});


/* =========================================================
   RESOLVE SLUG  (?page=xxx  →  filename)
   ========================================================= */
function resolveSlug() {
    var fromQuery = new URLSearchParams(location.search).get('page');
    if (fromQuery) return fromQuery.toLowerCase();

    var name = (location.pathname.split('/').pop() || '')
        .replace(/\.html?$/i, '')
        .toLowerCase();

    if (name && name !== 'coming-soon') {
        return name;
    }
    return 'coming-soon';
}


/* =========================================================
   PAGE CONFIG
   ========================================================= */
var PAGES = {

    /* ---------- Coming soon ---------- */
    'about': {
        type: 'coming-soon', icon: '🏢',
        title: 'About TeamZampXUnited',
        subtitle: 'Our story is still being written.',
        description: 'TeamZampXUnited is a modern Indian shopping destination bringing together electronics, fashion, groceries, home, beauty and sports — with one cart, one checkout, and free shipping over ₹499. Our full story page is coming soon.',
        cta: { label: 'Browse the store', href: 'products.html' }
    },
    'careers': {
        type: 'coming-soon', icon: '💼',
        title: 'Careers at TeamZampXUnited',
        subtitle: 'We are hiring soon.',
        description: 'We will be posting open roles across engineering, design, operations and customer support in the coming weeks. If you would like to be notified first, subscribe to our newsletter in the footer.',
        cta: { label: 'Get notified', href: 'index.html' }
    },
    'press': {
        type: 'coming-soon', icon: '📰',
        title: 'Press & Media',
        subtitle: 'Press kit coming soon.',
        description: 'For any press enquiries, interviews, or media assets, write to us at press@TeamZampXUnited.in and our team will get back within 48 hours.',
        cta: { label: 'Contact Press', href: 'contact.html' }
    },
    'sustainability': {
        type: 'coming-soon', icon: '🌱',
        title: 'Sustainability',
        subtitle: 'Doing our part for the planet.',
        description: 'We are working with delivery partners to use recyclable packaging, optimise delivery routes, and support local farmers and artisans. Full details of our initiatives will be published here soon.',
        cta: { label: 'Learn more', href: 'about.html' }
    },
    'checkout': {
        type: 'coming-soon', icon: '🔒',
        title: 'Checkout',
        subtitle: 'A faster, smarter checkout is on the way.',
        description: 'Our new one-tap checkout — with saved addresses, UPI, cards and cash on delivery — is under construction. For now, you can keep items in your cart and we will notify you the moment it goes live.',
        cta: { label: 'Back to cart', href: 'cart.html' }
    },
    'coming-soon': {
        type: 'coming-soon', icon: '🚀',
        title: 'Coming Soon',
        subtitle: 'This page is under construction.',
        description: 'We are working hard to bring you this page. In the meantime, explore the store or head back home.',
        cta: { label: 'Back to home', href: 'index.html' }
    },

    /* ---------- FAQ ---------- */
    'faq': {
        type: 'faq', icon: '❓',
        title: 'Frequently Asked Questions',
        subtitle: 'Answers to the questions we hear the most.',
        questions: [
            { q: 'How long does delivery take?', a: 'Standard delivery takes 2–4 business days across most Indian PIN codes. Metro cities usually receive orders within 48 hours.' },
            { q: 'Is shipping really free?', a: 'Yes — all orders above ₹499 ship free. Below that, a flat ₹49 shipping fee is added at checkout.' },
            { q: 'What is your return policy?', a: 'You can return most items within 7 days of delivery, provided they are unused and in original packaging. Some categories like innerwear and perishable groceries are non-returnable.' },
            { q: 'Do you offer Cash on Delivery?', a: 'Cash on Delivery is available on most products for orders up to ₹50,000. You will see the option on the checkout page.' },
            { q: 'How do I track my order?', a: 'Once your order ships, you will receive an SMS and email with a tracking link. You can also use the "Track Order" page in our footer.' },
            { q: 'Are the products genuine?', a: "Absolutely. Every product is sourced directly from the brand or an authorised distributor, and comes with the manufacturer's warranty where applicable." },
            { q: 'Can I change or cancel my order?', a: 'Yes — you can cancel any order free of charge before it ships. After shipment, you can refuse delivery or request a return.' },
            { q: 'How do I contact customer support?', a: 'Our team is available 24×7 at support@TeamZampXUnited.in or via the Contact page.' }
        ]
    },

    /* ---------- Form pages ---------- */
    'track': {
        type: 'form', icon: '📦',
        title: 'Track Your Order',
        subtitle: 'Enter your order ID and email to see the latest status.',
        formType: 'track'
    },
    'contact': {
        type: 'form', icon: '💬',
        title: 'Contact Us',
        subtitle: 'We usually reply within a few hours.',
        formType: 'contact',
        extraHtml: `
            <div style="margin-top:2rem;padding-top:1.5rem;
                        border-top:1px solid var(--border);
                        display:grid;
                        grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                        gap:1rem;font-size:.88rem">
                <div>
                    <div style="font-size:.72rem;text-transform:uppercase;
                                letter-spacing:.08em;color:var(--muted-foreground)">Email</div>
                    <a href="mailto:support@TeamZampXUnited.in"
                       style="font-weight:600;text-decoration:underline;text-underline-offset:3px">
                        support@TeamZampXUnited.in
                    </a>
                </div>
                <div>
                    <div style="font-size:.72rem;text-transform:uppercase;
                                letter-spacing:.08em;color:var(--muted-foreground)">Phone</div>
                    <div style="font-weight:600">+91 90000 00000</div>
                </div>
                <div>
                    <div style="font-size:.72rem;text-transform:uppercase;
                                letter-spacing:.08em;color:var(--muted-foreground)">Address</div>
                    <div style="font-weight:600">Bengaluru, India</div>
                </div>
            </div>
        `
    },
    'forgot-password': {
        type: 'form', icon: '🔑',
        title: 'Reset Your Password',
        subtitle: 'Enter your email and we will send you a reset link.',
        formType: 'forgot'
    },

    /* ---------- Articles ---------- */
    'terms': {
        type: 'article', icon: '📜',
        title: 'Terms & Conditions',
        subtitle: 'Last updated: 1 October 2024',
        sections: [
            { h: '1. Acceptance of Terms', p: 'By accessing or using TeamZampXUnited you agree to be bound by these Terms & Conditions and our Privacy Policy. If you do not agree with any part, please do not use our services.' },
            { h: '2. Accounts', p: 'You are responsible for maintaining the confidentiality of your account credentials and for all activity that happens under your account. Notify us immediately if you suspect unauthorised use.' },
            { h: '3. Products & Pricing', p: 'We make every effort to display accurate product information, but occasional errors may occur. Prices are subject to change without notice. In case of a pricing error, we will contact you before shipping.' },
            { h: '4. Orders & Payment', p: 'All orders are subject to acceptance and availability. Payment is collected at the time of order via the methods shown on the checkout page. We use industry-standard encryption for all transactions.' },
            { h: '5. Shipping & Delivery', p: 'Estimated delivery times are indicative and may vary due to weather, courier operations, or public holidays. Risk of loss passes to you upon delivery.' },
            { h: '6. Returns & Refunds', p: 'Eligible items can be returned within 7 days of delivery. Refunds are processed to the original payment method within 5–7 business days of us receiving the returned item.' },
            { h: '7. Limitation of Liability', p: 'To the maximum extent permitted by law, TeamZampXUnited shall not be liable for indirect, incidental, or consequential damages arising from your use of the service.' },
            { h: '8. Changes to Terms', p: 'We may update these terms from time to time. Continued use of the service after changes means you accept the revised terms.' },
            { h: '9. Contact', p: 'Questions about these terms? Write to us at legal@TeamZampXUnited.in.' }
        ]
    },
    'privacy': {
        type: 'article', icon: '🛡️',
        title: 'Privacy Policy',
        subtitle: 'Last updated: 1 October 2024',
        sections: [
            { h: '1. Information We Collect', p: 'We collect information you provide directly — such as your name, email, delivery address, and payment details — as well as data generated by using our service, like your browsing activity and device information.' },
            { h: '2. How We Use Your Information', p: 'We use your information to process orders, personalise recommendations, prevent fraud, send transactional and promotional messages (with your consent), and improve our products.' },
            { h: '3. Sharing', p: 'We share necessary data with delivery partners, payment processors, and analytics providers. We never sell your personal information.' },
            { h: '4. Cookies', p: 'We use cookies to keep you logged in, remember your cart, and understand how our site is used. You can disable cookies in your browser settings, though some features may not work.' },
            { h: '5. Security', p: 'We use HTTPS, encrypted storage, and strict access controls. Passwords are hashed. No method of transmission is 100% secure, but we work hard to protect your data.' },
            { h: '6. Your Rights', p: 'You may request access to, correction of, or deletion of your personal data at any time by emailing privacy@TeamZampXUnited.in.' },
            { h: '7. Children', p: 'Our services are not intended for children under 13. We do not knowingly collect data from them.' },
            { h: '8. Contact', p: 'For any privacy concerns, reach us at privacy@TeamZampXUnited.in.' }
        ]
    },
    'shipping': {
        type: 'article', icon: '🚚',
        title: 'Shipping & Returns',
        subtitle: 'Everything you need to know about delivery and returns.',
        sections: [
            { h: 'Delivery Timelines', p: 'Standard delivery: 2–4 business days. Express delivery (where available): next business day. Metro cities typically receive orders within 48 hours.' },
            { h: 'Shipping Charges', p: 'Free shipping on all orders above ₹499. Orders under ₹499 incur a flat ₹49 fee, added at checkout.' },
            { h: 'Order Tracking', p: 'Once your order ships, you will receive an SMS and email with a live tracking link. You can also track from the "Track Order" page at any time.' },
            { h: 'Delivery Areas', p: 'We currently deliver to over 26,000 PIN codes across India. For remote areas, delivery may take an additional 2–3 days.' },
            { h: 'Returns', p: 'Most items can be returned within 7 days of delivery. Items must be unused and in their original packaging with all tags. Some categories (innerwear, perishable groceries, personalised items) are non-returnable.' },
            { h: 'Refunds', p: 'Once we receive and inspect your return, refunds are processed within 5–7 business days to the original payment method. Cash-on-delivery orders are refunded via bank transfer.' },
            { h: 'Damaged or Wrong Items', p: 'If you receive a damaged or incorrect item, please contact support within 48 hours with photos. We will arrange a free replacement or full refund.' }
        ]
    }
};


/* =========================================================
   RENDER (dispatches by page.type)
   ========================================================= */
function renderPage(slug) {
    var page = PAGES[slug];
    var root = document.getElementById('pageRoot');
    if (!root) return;

    if (!page) {
        document.title = 'Page not found — TeamZampXUnited';
        root.innerHTML = `
            <div class="coming-soon">
                <div class="cs-icon">🧭</div>
                <h1>Page not found</h1>
                <p>The page you are looking for doesn't exist or has moved.</p>
                <a href="index.html" class="btn btn-primary">Back to home</a>
            </div>
        `;
        return;
    }

    document.title = page.title + ' — TeamZampXUnited';

    var renderers = {
        'coming-soon': renderComingSoon,
        'article': renderArticle,
        'faq': renderFaq,
        'form': renderForm
    };

    var render = renderers[page.type];
    if (render) {
        render(page, root);
    }
}


/* ---------- Coming soon ---------- */
function renderComingSoon(page, root) {
    var esc = PXCUI.escapeHtml;

    root.innerHTML = `
        <div class="coming-soon">
            <div class="cs-icon">${page.icon}</div>
            <h1>${esc(page.title)}</h1>
            <p style="font-size:1rem;color:var(--foreground);font-weight:500;margin-bottom:.5rem">
                ${esc(page.subtitle)}
            </p>
            <p>${esc(page.description)}</p>
            ${page.cta ? `
                <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
                    <a href="${esc(page.cta.href)}" class="btn btn-primary">${esc(page.cta.label)}</a>
                    <a href="index.html" class="btn btn-outline">Back to home</a>
                </div>
            ` : ''}
        </div>
    `;
}


/* ---------- Long-form article ---------- */
function renderArticle(page, root) {
    var esc = PXCUI.escapeHtml;

    var sectionsHtml = page.sections.map(function (s) {
        return `
            <section>
                <h2>${esc(s.h)}</h2>
                <p>${esc(s.p)}</p>
            </section>
        `;
    }).join('');

    root.innerHTML = `
        <article class="static-page">
            <div style="font-size:2.5rem;margin-bottom:.5rem">${page.icon}</div>
            <h1>${esc(page.title)}</h1>
            <p class="lede">${esc(page.subtitle)}</p>
            ${sectionsHtml}
            <div style="margin-top:2.5rem;padding-top:1.5rem;
                        border-top:1px solid var(--border);
                        display:flex;gap:.5rem;flex-wrap:wrap">
                <a href="index.html" class="btn btn-primary btn-sm">Back to home</a>
                <a href="contact.html" class="btn btn-outline btn-sm">Contact us</a>
            </div>
        </article>
    `;
}


/* ---------- FAQ accordion ---------- */
function renderFaq(page, root) {
    var esc = PXCUI.escapeHtml;

    var questionsHtml = page.questions.map(function (item) {
        return `
            <details>
                <summary>
                    <span>${esc(item.q)}</span>
                    <span aria-hidden="true">+</span>
                </summary>
                <div>${esc(item.a)}</div>
            </details>
        `;
    }).join('');

    root.innerHTML = `
        <article class="static-page">
            <div style="font-size:2.5rem;margin-bottom:.5rem">${page.icon}</div>
            <h1>${esc(page.title)}</h1>
            <p class="lede">${esc(page.subtitle)}</p>

            <div style="display:flex;flex-direction:column;gap:.5rem">
                ${questionsHtml}
            </div>

            <div style="margin-top:2.5rem;padding-top:1.5rem;
                        border-top:1px solid var(--border);
                        display:flex;gap:.5rem;flex-wrap:wrap">
                <a href="contact.html" class="btn btn-primary btn-sm">Still need help? Contact us</a>
                <a href="index.html" class="btn btn-outline btn-sm">Back to home</a>
            </div>
        </article>
    `;
}


/* =========================================================
   FORM PAGES
   ========================================================= */
function renderForm(page, root) {
    var formHtml = FORM_TEMPLATES[page.formType] || '';

    root.innerHTML = `
        <div class="static-page" style="max-width:560px">
            <div style="font-size:2.5rem;margin-bottom:.5rem">${page.icon}</div>
            <h1>${PXCUI.escapeHtml(page.title)}</h1>
            <p class="lede">${PXCUI.escapeHtml(page.subtitle)}</p>
            ${formHtml}
            ${page.extraHtml || ''}
        </div>
    `;

    wireForm(page.formType);
}

var FORM_TEMPLATES = {
    contact: `
        <form id="contactForm" novalidate style="display:flex;flex-direction:column;gap:1rem">
            <div class="form-group" style="margin:0">
                <label for="cName">Your name</label>
                <input type="text" id="cName" name="name" required placeholder="Prasad">
            </div>
            <div class="form-group" style="margin:0">
                <label for="cEmail">Email</label>
                <input type="email" id="cEmail" name="email" required placeholder="you@example.com">
            </div>
            <div class="form-group" style="margin:0">
                <label for="cSubject">Subject</label>
                <input type="text" id="cSubject" name="subject" required placeholder="How can we help?">
            </div>
            <div class="form-group" style="margin:0">
                <label for="cMessage">Message</label>
                <textarea id="cMessage" name="message" rows="5" required placeholder="Write your message here…"></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Send message</button>
        </form>
    `,

    track: `
        <form id="trackForm" novalidate style="display:flex;flex-direction:column;gap:1rem">
            <div class="form-group" style="margin:0">
                <label for="tOrderId">Order ID</label>
                <input type="text" id="tOrderId" name="orderId" required placeholder="e.g. PXC-ABC123">
            </div>
            <div class="form-group" style="margin:0">
                <label for="tEmail">Email used on the order</label>
                <input type="email" id="tEmail" name="email" required placeholder="you@example.com">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Track order</button>
        </form>
    `,

    forgot: `
        <form id="forgotForm" novalidate style="display:flex;flex-direction:column;gap:1rem">
            <div class="form-group" style="margin:0">
                <label for="fEmail">Email address</label>
                <input type="email" id="fEmail" name="email" required placeholder="you@example.com">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Send reset link</button>
        </form>
        <p style="font-size:.82rem;color:var(--muted-foreground);margin-top:1rem;text-align:center">
            Remembered it?
            <a href="login.html" style="color:var(--foreground);text-decoration:underline;text-underline-offset:3px">
                Back to login
            </a>
        </p>
    `
};


/* =========================================================
   FORM HANDLERS
   ========================================================= */
function wireForm(type) {
    var handlers = {
        contact: wireContactForm,
        track: wireTrackForm,
        forgot: wireForgotForm
    };
    var handler = handlers[type];
    if (handler) handler();
}

function wireContactForm() {
    var f = document.getElementById('contactForm');
    if (!f) return;

    f.addEventListener('submit', function (e) {
        e.preventDefault();

        var name = (f.name.value || '').trim();
        var email = (f.email.value || '').trim();
        var subject = (f.subject.value || '').trim();
        var message = (f.message.value || '').trim();

        if (!name || !email || !subject || !message) {
            return PXCUI.toast('Please fill in all fields.', 'error');
        }
        if (!isValidEmail(email)) {
            return PXCUI.toast('Please enter a valid email address.', 'error');
        }

        // save to legacy localStorage (backwards compatibility)
        var messages = [];
        try {
            messages = JSON.parse(localStorage.getItem('pxc_messages') || '[]');
            if (!Array.isArray(messages)) messages = [];
        } catch (e2) {
            messages = [];
        }

        messages.push({
            name: name,
            email: email,
            subject: subject,
            message: message,
            date: new Date().toISOString()
        });

        try {
            localStorage.setItem('pxc_messages', JSON.stringify(messages));
        } catch (err) {
            console.warn('[PXC] Could not save message:', err);
        }

        // push to the new notifications database
        try {
            PXC.addNotification('Message from ' + name + ': "' + subject + '"', 'contact');
        } catch (err) {
            console.warn('[PXC] Could not add notification:', err);
        }

        PXCUI.toast("Message sent! We'll get back to you soon ✨", 'success');
        f.reset();
    });
}

function wireTrackForm() {
    var f = document.getElementById('trackForm');
    if (!f) return;

    f.addEventListener('submit', function (e) {
        e.preventDefault();

        var orderId = (f.orderId.value || '').trim().toUpperCase();
        var email = (f.email.value || '').trim();

        if (!orderId || !email) {
            return PXCUI.toast('Please fill in both fields.', 'error');
        }
        if (!isValidEmail(email)) {
            return PXCUI.toast('Please enter a valid email address.', 'error');
        }
        if (!PXC.isLoggedIn()) {
            return PXCUI.toast('Please log in with the account used to place the order.', 'error');
        }
        if (PXC.user.email.toLowerCase() !== email.toLowerCase()) {
            return PXCUI.toast('No matching order found for those details.', 'error');
        }

        var found = PXC.getUserOrders().find(function (o) {
            return o.id.toUpperCase() === orderId;
        });

        if (found) {
            PXCUI.toast('Order ' + found.id + ' — Status: ' + found.status + ' ✅', 'success');
        } else {
            PXCUI.toast('Order not found. Please check your details.', 'error');
        }
    });
}

function wireForgotForm() {
    var f = document.getElementById('forgotForm');
    if (!f) return;

    f.addEventListener('submit', function (e) {
        e.preventDefault();

        var email = (f.email.value || '').trim();
        if (!isValidEmail(email)) {
            return PXCUI.toast('Please enter a valid email address.', 'error');
        }

        // demo site — no email server, so be honest
        PXCUI.toast('Demo only — no reset email is actually sent.', 'error');
        f.reset();
    });
}

function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}