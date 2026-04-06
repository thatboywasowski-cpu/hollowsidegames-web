document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("login-form");
    var status = document.getElementById("login-status");
    var emailInput = document.getElementById("login-email");
    var passwordInput = document.getElementById("login-password");
    var rememberInput = document.getElementById("remember-me");
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

    var existingClient = window.HollowsideAuth.createClient();
    existingClient.auth.getSession().then(function (result) {
        if (result.data && result.data.session) {
            window.HollowsideAuth.setStatus(status, "You're already logged in. Redirecting...", "info");
            window.setTimeout(function () {
                window.location.href = redirectUrl;
            }, 900);
        }
    });

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        window.HollowsideAuth.setStatus(status, "", "info");

        var email = emailInput.value.trim();
        var password = passwordInput.value;
        var rememberMe = rememberInput.checked;

        if (!email) {
            window.HollowsideAuth.setStatus(status, "Enter your email address to continue.", "error");
            emailInput.focus();
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

            var supabase = window.HollowsideAuth.createClient({ rememberMe: rememberMe });
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

            window.HollowsideAuth.setStatus(status, "Login successful. Redirecting...", "success");
            window.setTimeout(function () {
                window.location.href = redirectUrl;
            }, 900);
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
});
