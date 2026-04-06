document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("signup-form");
    var status = document.getElementById("signup-status");
    var displayNameInput = document.getElementById("signup-display-name");
    var usernameInput = document.getElementById("signup-username");
    var emailInput = document.getElementById("signup-email");
    var passwordInput = document.getElementById("signup-password");
    var confirmInput = document.getElementById("signup-confirm-password");
    var consentInput = document.getElementById("signup-consent");
    var socialButtons = document.querySelectorAll("[data-social-placeholder]");

    socialButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            window.HollowsideAuth.socialComingSoon(status);
        });
    });

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(
            status,
            "Supabase is not connected yet. Add your project URL and publishable key in /supabase-config.js to enable signup.",
            "error"
        );
        return;
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        window.HollowsideAuth.setStatus(status, "", "info");

        var displayName = displayNameInput.value.trim();
        var username = window.HollowsideAuth.sanitizeUsername(usernameInput.value);
        var email = emailInput.value.trim();
        var password = passwordInput.value;
        var confirmPassword = confirmInput.value;
        var consent = consentInput.checked;

        if (username.length < 3) {
            window.HollowsideAuth.setStatus(status, "Choose a username with at least 3 valid characters.", "error");
            usernameInput.focus();
            return;
        }

        if (!email) {
            window.HollowsideAuth.setStatus(status, "Enter your email address to continue.", "error");
            emailInput.focus();
            return;
        }

        if (password.length < 8) {
            window.HollowsideAuth.setStatus(status, "Use a password that is at least 8 characters long.", "error");
            passwordInput.focus();
            return;
        }

        if (password !== confirmPassword) {
            window.HollowsideAuth.setStatus(status, "Your passwords do not match.", "error");
            confirmInput.focus();
            return;
        }

        if (!consent) {
            window.HollowsideAuth.setStatus(status, "Please agree to the Terms and Privacy Policy to continue.", "error");
            consentInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(form, true);
            var supabase = window.HollowsideAuth.createClient({ rememberMe: true });
            var response = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        username: username,
                        display_name: displayName || username
                    },
                    emailRedirectTo: window.location.origin + "/login"
                }
            });

            if (response.error) {
                throw response.error;
            }

            form.reset();
            window.HollowsideAuth.setStatus(
                status,
                "Account created. Check your email for the confirmation link from Hollowside Games before logging in.",
                "success"
            );
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while creating your account.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(form, false);
        }
    });
});
