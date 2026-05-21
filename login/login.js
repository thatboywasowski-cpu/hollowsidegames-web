document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("login-form");
    var twoFactorForm = document.getElementById("login-2fa-form");
    var status = document.getElementById("login-status");
    var identifierInput = document.getElementById("login-identifier");
    var passwordInput = document.getElementById("login-password");
    var rememberInput = document.getElementById("remember-me");
    var twoFactorCodeInput = document.getElementById("login-2fa-code");
    var trustDeviceInput = document.getElementById("login-trust-device");
    var socialButtons = document.querySelectorAll("[data-social-provider]");
    var redirectUrl = window.HollowsideAuth.normalizeRedirectPath(
        new URLSearchParams(window.location.search).get("redirect") || "/"
    );

    socialButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            window.HollowsideAuth.startOAuthSignIn(button.getAttribute("data-social-provider"), {
                statusTarget: status,
                redirectPath: redirectUrl
            });
        });
    });

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(
            status,
            "Supabase is not connected yet. Add your project URL and anon key in /supabase-config.js to enable login.",
            "error"
        );
        return;
    }

    rememberInput.checked = window.HollowsideAuth.getRememberPreference() !== false;

    var existingClient = window.HollowsideAuth.createClient();
    existingClient.auth.getSession().then(function (result) {
        if (result.data && result.data.session) {
            window.HollowsideAuth.setStatus(status, "You're already logged in. Redirecting...", "info");
            window.setTimeout(function () {
                window.location.href = redirectUrl;
            }, 900);
        }
    });

    async function loadAccountContext(client) {
        try {
            var response = await client.rpc("get_my_account_context");
            return response.data && response.data[0] ? response.data[0] : null;
        } catch (error) {
            return null;
        }
    }

    function getTwoFactorEmail(user, context) {
        return (
            (context && context.two_factor_contact) ||
            (user && !window.HollowsideAuth.isVirtualEmail(user.email) ? user.email : "")
        );
    }

    async function continueAfterLogin(client, user) {
        var context = await loadAccountContext(client);
        var twoFactorEnabled = context && context.is_2fa_enabled;
        var twoFactorEmail = getTwoFactorEmail(user, context);

        if (twoFactorEnabled && twoFactorEmail && !window.HollowsideAuth.isTrustedDevice(user.id)) {
            await window.HollowsideAuth.sendEmailOtp(client, twoFactorEmail);
            form.hidden = true;
            twoFactorForm.hidden = false;
            twoFactorForm.setAttribute("data-2fa-email", twoFactorEmail);
            window.HollowsideAuth.setStatus(status, "A 6-digit login code was sent to your 2FA email.", "info");
            twoFactorCodeInput.focus();
            return;
        }

        window.HollowsideAuth.setStatus(status, "Login successful. Redirecting...", "success");
        window.setTimeout(function () {
            window.location.href = redirectUrl;
        }, 900);
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        window.HollowsideAuth.setStatus(status, "", "info");

        var identifier = identifierInput.value.trim();
        var password = passwordInput.value;
        var rememberMe = rememberInput.checked;

        if (!identifier) {
            window.HollowsideAuth.setStatus(status, "Enter your username or email to continue.", "error");
            identifierInput.focus();
            return;
        }

        if (!password) {
            window.HollowsideAuth.setStatus(status, "Enter your password to continue.", "error");
            passwordInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(form, true);
            window.HollowsideAuth.clearStoredSession();
            window.HollowsideAuth.setRememberPreference(rememberMe);

            var supabase = window.HollowsideAuth.createClient({ rememberMe: rememberMe });
            var email = await window.HollowsideAuth.resolveLoginEmail(supabase, identifier);
            var response = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (response.error) {
                throw response.error;
            }

            if (response.data && response.data.user) {
                await window.HollowsideAuth.ensureProfile(supabase, response.data.user);
            }

            await continueAfterLogin(supabase, response.data.user);
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while trying to log you in.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(form, false);
        }
    });

    twoFactorForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        var code = twoFactorCodeInput.value.trim();
        var email = twoFactorForm.getAttribute("data-2fa-email") || "";

        if (!/^[0-9]{6}$/.test(code)) {
            window.HollowsideAuth.setStatus(status, "Enter the 6-digit security code.", "error");
            twoFactorCodeInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(twoFactorForm, true);
            var supabase = window.HollowsideAuth.createClient();
            var response = await window.HollowsideAuth.verifyEmailOtp(supabase, email, code);
            var user = response.data && response.data.user ? response.data.user : null;

            if (trustDeviceInput.checked && user) {
                window.HollowsideAuth.trustDeviceFor30Days(user.id);
            }

            window.HollowsideAuth.setStatus(status, "Code verified. Redirecting...", "success");
            window.setTimeout(function () {
                window.location.href = redirectUrl;
            }, 900);
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "That code could not be verified.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(twoFactorForm, false);
        }
    });
});
