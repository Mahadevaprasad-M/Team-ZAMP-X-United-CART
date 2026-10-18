document.addEventListener('DOMContentLoaded', async function () {
    await PXC.load();

    PXCUI.renderHeader();
    PXCUI.renderFooter();

    // Already logged in → skip the auth page
    if (PXC.isLoggedIn()) {
        var next = sanitizeNext(new URLSearchParams(location.search).get('next')) || 'account.html';
        window.location.replace(next);
        return;
    }

    setupTabs();
    setupLoginForm();
    setupRegisterForm();
    setupPasswordToggles();
    setupPasswordStrength();
    prefillRememberedEmail();
});


/* =========================================================
   SAFE ?next=  (same-site URLs only)
   ========================================================= */
function sanitizeNext(raw) {
    if (!raw) return '';
    try {
        var url = new URL(raw, location.origin);
        if (url.origin !== location.origin) return '';
        return url.pathname.replace(/^\//, '') + url.search + url.hash;
    } catch (e) {
        return '';
    }
}


/* =========================================================
   TABS (Login ↔ Register)
   ========================================================= */
function setupTabs() {
    // Buttons with [data-auth-link]
    var links1 = document.querySelectorAll('[data-auth-link]');
    for (var i = 0; i < links1.length; i++) {
        (function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                location.hash = '#' + link.dataset.authLink;
                applyHash();
            });
        })(links1[i]);
    }

    // Plain anchors with href="#register" or href="#login"
    var links2 = document.querySelectorAll('a[href="#register"], a[href="#login"]');
    for (var j = 0; j < links2.length; j++) {
        (function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                location.hash = a.getAttribute('href');
                applyHash();
            });
        })(links2[j]);
    }

    window.addEventListener('hashchange', applyHash);
    applyHash();
}

function applyHash() {
    var hash = (location.hash || '#login').replace('#', '');
    var active = (hash === 'register') ? 'register' : 'login';

    // show / hide panels
    var panels = document.querySelectorAll('[data-auth-tab]');
    for (var i = 0; i < panels.length; i++) {
        if (panels[i].dataset.authTab === active) {
            panels[i].style.display = 'block';
        } else {
            panels[i].style.display = 'none';
        }
    }

    // highlight active tab
    var links = document.querySelectorAll('[data-auth-link]');
    for (var j = 0; j < links.length; j++) {
        var link = links[j];
        var isActive = (link.dataset.authLink === active);

        var color, border;
        if (isActive) {
            color = 'var(--foreground)';
            border = '2px solid var(--foreground)';
        } else {
            color = 'var(--muted-foreground)';
            border = '2px solid transparent';
        }

        link.style.color = color;
        link.style.borderBottom = border;
    }

    // focus first input in the active panel
    var panel = document.querySelector('[data-auth-tab="' + active + '"]');
    if (panel) {
        var first = panel.querySelector('input:not([type="checkbox"])');
        if (first) {
            setTimeout(function () { first.focus(); }, 60);
        }
    }

    clearAllErrors();
}


/* =========================================================
   LOGIN FORM
   ========================================================= */
function setupLoginForm() {
    var form = document.getElementById('loginForm');
    if (!form) return;

    form.dataset._pxcAuthBound = '1';   // tells the inline fallback to back off

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearAllErrors();

        var emailInput = form.email;
        var pwdInput = form.password;
        var remember = form.querySelector('input[name="remember"]');

        var email = (emailInput.value || '').trim();
        var pwd = pwdInput.value || '';

        // validate
        if (!email) {
            return showFieldError(emailInput, 'Please enter your email address.');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return showFieldError(emailInput, 'Please enter a valid email address.');
        }
        if (!pwd) {
            return showFieldError(pwdInput, 'Please enter your password.');
        }

        var submitBtn = form.querySelector('button[type="submit"]');
        setLoading(submitBtn, true, 'Logging in…');

        try {
            var res = await PXC.login(email, pwd);

            if (!res.ok) {
                if (/email/i.test(res.error)) return showFieldError(emailInput, res.error);
                if (/password/i.test(res.error)) return showFieldError(pwdInput, res.error);
                return showBannerError(res.error);
            }

            // remember me
            try {
                if (remember && remember.checked) {
                    localStorage.setItem('pxc_remember_email', email);
                } else {
                    localStorage.removeItem('pxc_remember_email');
                }
            } catch (e2) { }

            PXCUI.toast('Welcome back, ' + res.user.name + '! 👋', 'success');

            var next = sanitizeNext(new URLSearchParams(location.search).get('next')) || 'account.html';

            // small beat so the toast is visible
            setTimeout(function () {
                PXCUI.navigate(next, 'Signing in', 0);
            }, 500);

        } catch (err) {
            console.error('[auth] login failed:', err);
            showBannerError(err && err.message ? err.message : 'Something went wrong. Please try again.');
        } finally {
            setLoading(submitBtn, false, 'Login');
        }
    });
}


/* =========================================================
   REGISTER FORM
   ========================================================= */
function setupRegisterForm() {
    var form = document.getElementById('registerForm');
    if (!form) return;

    form.dataset._pxcAuthBound = '1';

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearAllErrors();

        var nameInput = form.name;
        var emailInput = form.email;
        var pwdInput = form.password;
        var confirmInput = form.confirm;
        var termsInput = form.querySelector('input[name="terms"]');

        var name = (nameInput.value || '').trim();
        var email = (emailInput.value || '').trim();
        var pwd = pwdInput.value || '';
        var confirm = confirmInput.value || '';

        // validate
        if (name.length < 2) {
            return showFieldError(nameInput, 'Please enter your full name.');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return showFieldError(emailInput, 'Please enter a valid email address.');
        }
        if (pwd.length < 6) {
            return showFieldError(pwdInput, 'Password must be at least 6 characters.');
        }
        if (!pwd.trim()) {
            return showFieldError(pwdInput, 'Password cannot be only spaces.');
        }
        if (pwd !== confirm) {
            return showFieldError(confirmInput, 'Passwords do not match.');
        }
        if (termsInput && !termsInput.checked) {
            return showBannerError('Please agree to the Terms & Privacy Policy.');
        }

        var submitBtn = form.querySelector('button[type="submit"]');
        setLoading(submitBtn, true, 'Creating account…');

        try {
            var res = await PXC.register(name, email, pwd);

            if (!res.ok) {
                if (/email/i.test(res.error)) return showFieldError(emailInput, res.error);
                if (/password/i.test(res.error)) return showFieldError(pwdInput, res.error);
                return showBannerError(res.error);
            }

            try { localStorage.setItem('pxc_remember_email', email); } catch (e2) { }

            PXCUI.toast('Welcome aboard, ' + res.user.name + '! 🎉', 'success');

            var next = sanitizeNext(new URLSearchParams(location.search).get('next')) || 'account.html';

            setTimeout(function () {
                PXCUI.navigate(next, 'Setting up your account', 0);
            }, 500);

        } catch (err) {
            console.error('[auth] register failed:', err);
            showBannerError(err && err.message ? err.message : 'Something went wrong. Please try again.');
        } finally {
            setLoading(submitBtn, false, 'Create account');
        }
    });
}


/* =========================================================
   SHOW / HIDE PASSWORD
   ========================================================= */
function setupPasswordToggles() {
    var buttons = document.querySelectorAll('[data-toggle-password]');
    for (var i = 0; i < buttons.length; i++) {
        (function (btn) {
            var input = document.getElementById(btn.dataset.togglePassword);
            if (!input) return;

            // flag so the inline fallback doesn't double-bind
            input._pxcBoundByAuth = true;

            btn.addEventListener('click', function () {
                var isPwd = (input.type === 'password');

                if (isPwd) {
                    input.type = 'text';
                    btn.textContent = 'Hide';
                } else {
                    input.type = 'password';
                    btn.textContent = 'Show';
                }
            });
        })(buttons[i]);
    }
}


/* =========================================================
   PASSWORD STRENGTH METER
   ========================================================= */
function setupPasswordStrength() {
    var pwd = document.getElementById('registerPassword');
    var meter = document.getElementById('pwdStrength');
    if (!pwd || !meter) return;

    pwd.addEventListener('input', function () {
        var v = pwd.value;

        if (!v) {
            meter.textContent = '';
            meter.style.color = '';
            return;
        }

        var score = 0;
        if (v.length >= 6) score++;
        if (v.length >= 10) score++;
        if (/[A-Z]/.test(v)) score++;
        if (/[0-9]/.test(v)) score++;
        if (/[^A-Za-z0-9]/.test(v)) score++;

        var label, color;
        if (score <= 2) {
            label = 'Weak';
            color = '#dc2626';
        } else if (score <= 3) {
            label = 'Medium';
            color = '#f59e0b';
        } else {
            label = 'Strong';
            color = '#16a34a';
        }

        meter.textContent = 'Strength: ' + label;
        meter.style.color = color;
    });
}


/* =========================================================
   REMEMBER ME (prefill)
   ========================================================= */
function prefillRememberedEmail() {
    var remembered = '';
    try { remembered = localStorage.getItem('pxc_remember_email') || ''; } catch (e) { }
    if (!remembered) return;

    var loginEmail = document.getElementById('loginEmail');
    var registerEmail = document.getElementById('registerEmail');
    var rememberChk = document.querySelector('#loginForm input[name="remember"]');

    if (loginEmail && !loginEmail.value) loginEmail.value = remembered;
    if (registerEmail && !registerEmail.value) registerEmail.value = remembered;
    if (rememberChk) rememberChk.checked = true;
}


/* =========================================================
   INLINE FIELD ERROR
   ========================================================= */
function showFieldError(input, msg) {
    if (!input) return;

    // remove previous error
    var prev = input.parentElement.querySelector('.field-error');
    if (prev) prev.remove();

    input.style.borderColor = 'var(--destructive)';
    input.setAttribute('aria-invalid', 'true');

    var err = document.createElement('div');
    err.className = 'field-error';
    err.textContent = msg;
    input.parentElement.appendChild(err);

    input.focus();

    // clear on next input
    function clear() {
        input.style.borderColor = '';
        input.removeAttribute('aria-invalid');

        var e2 = input.parentElement.querySelector('.field-error');
        if (e2) e2.remove();
        input.removeEventListener('input', clear);
    }
    input.addEventListener('input', clear);
}


/* =========================================================
   BANNER ERROR
   ========================================================= */
function showBannerError(msg) {
    var panels = document.querySelectorAll('[data-auth-tab]');
    var visible = null;

    for (var i = 0; i < panels.length; i++) {
        if (panels[i].style.display !== 'none') {
            visible = panels[i];
            break;
        }
    }

    if (!visible) {
        PXCUI.toast(msg, 'error');
        return;
    }

    var prev = visible.querySelector('.banner-error');
    if (prev) prev.remove();

    var el = document.createElement('div');
    el.className = 'banner-error';
    el.innerHTML = '<span>' + PXCUI.escapeHtml(msg) + '</span>';

    var form = visible.querySelector('form');
    if (form) visible.insertBefore(el, form);
    else visible.prepend(el);

    PXCUI.toast(msg, 'error');
}

function clearAllErrors() {
    var fieldErrors = document.querySelectorAll('.field-error');
    for (var i = 0; i < fieldErrors.length; i++) {
        fieldErrors[i].remove();
    }

    var bannerErrors = document.querySelectorAll('.banner-error');
    for (var j = 0; j < bannerErrors.length; j++) {
        bannerErrors[j].remove();
    }

    var inputs = document.querySelectorAll('.form-group input');
    for (var k = 0; k < inputs.length; k++) {
        inputs[k].style.borderColor = '';
        inputs[k].removeAttribute('aria-invalid');
    }
}


/* =========================================================
   LOADING STATE ON SUBMIT BUTTON
   ========================================================= */
function setLoading(btn, loading, label) {
    if (!btn) return;

    if (loading) {
        btn.disabled = true;
        btn.dataset._pxcLabel = btn.textContent;
        btn.textContent = label || 'Please wait…';
        btn.style.opacity = '.75';
        btn.style.cursor = 'not-allowed';
    } else {
        btn.disabled = false;
        btn.textContent = label || btn.dataset._pxcLabel || 'Submit';
        btn.style.opacity = '';
        btn.style.cursor = '';
    }
}