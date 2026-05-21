document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("login-form");
    var twoFactorForm = document.getElementById("login-2fa-form");
    var status = document.getElementById("login-status");
    var identifierInput = document.getElementById("login-identifier");
    var passwordInput = document.getElementById("login-password");
    var rememberInput = document.getElementById("remember-me");
    var twoFactorCodeInput = document.getElementById("login-2fa-code");
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

    async function finishLogin(client, session, rememberMe) {
        window.HollowsideAuth.setRememberPreference(rememberMe);
        var setSessionResponse = await client.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token
        });

        if (setSessionResponse.error) {
            throw setSessionResponse.error;
        }

        if (setSessionResponse.data && setSessionResponse.data.user) {
            await window.HollowsideAuth.ensureProfile(client, setSessionResponse.data.user);
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
            var response = await supabase.functions.invoke("start-2fa-login", {
                body: {
                    identifier: identifier,
                    password: password,
                    rememberMe: rememberMe
                }
            });

            if (response.error) {
                throw response.error;
            }

            if (response.data && response.data.error) {
                throw new Error(response.data.error);
            }

            if (response.data && response.data.requires2fa) {
                form.hidden = true;
                twoFactorForm.hidden = false;
                twoFactorForm.setAttribute("data-2fa-challenge-id", response.data.challengeId);
                twoFactorForm.setAttribute("data-remember-me", rememberMe ? "true" : "false");
                window.HollowsideAuth.setStatus(
                    status,
                    "A 6-digit login code was sent to your 2FA email" + (response.data.contactHint ? " (" + response.data.contactHint + ")" : "") + ". It expires in 15 minutes.",
                    "info"
                );
                twoFactorCodeInput.focus();
                return;
            }

            if (response.data && response.data.session) {
                await finishLogin(supabase, response.data.session, rememberMe);
                return;
            }

            throw new Error("The login server did not return a usable session.");
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
        var challengeId = twoFactorForm.getAttribute("data-2fa-challenge-id") || "";
        var rememberMe = twoFactorForm.getAttribute("data-remember-me") !== "false";

        if (!/^[0-9]{6}$/.test(code)) {
            window.HollowsideAuth.setStatus(status, "Enter the 6-digit security code.", "error");
            twoFactorCodeInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(twoFactorForm, true);
            var supabase = window.HollowsideAuth.createClient({ rememberMe: rememberMe });
            var response = await supabase.functions.invoke("verify-2fa-login", {
                body: {
                    challengeId: challengeId,
                    code: code
                }
            });

            if (response.error) {
                throw response.error;
            }

            if (response.data && response.data.error) {
                throw new Error(response.data.error);
            }

            if (!response.data || !response.data.session) {
                throw new Error("The 2FA server did not return a usable session.");
            }

            await finishLogin(supabase, response.data.session, rememberMe);

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
