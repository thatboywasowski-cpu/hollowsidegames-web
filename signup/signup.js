document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("signup-form");
    var status = document.getElementById("signup-status");
    var displayNameInput = document.getElementById("signup-display-name");
    var usernameInput = document.getElementById("signup-username");
    var emailInput = document.getElementById("signup-email");
    var passwordInput = document.getElementById("signup-password");
    var confirmInput = document.getElementById("signup-confirm-password");
    var consentInput = document.getElementById("signup-consent");
    var socialButtons = document.querySelectorAll("[data-social-provider]");

    socialButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            try {
                window.sessionStorage.setItem("hollowside-oauth-signup-onboarding", "pending");
            } catch (error) {
                window.HollowsideAuth.setStatus(status, "Profile setup will remain available from account settings.", "info");
            }

            window.HollowsideAuth.startOAuthSignIn(button.getAttribute("data-social-provider"), {
                statusTarget: status,
                redirectPath: "/account"
            });
        });
    });

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(
            status,
            "Supabase is not connected yet. Add your project URL and anon key in /supabase-config.js to enable signup.",
            "error"
        );
        return;
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        window.HollowsideAuth.setStatus(status, "", "info");

        try {
            window.sessionStorage.removeItem("hollowside-oauth-signup-onboarding");
        } catch (error) {
            // Signup still works when browser storage is unavailable.
        }

        var displayName = displayNameInput.value.trim();
        var usernameResult = window.HollowsideAuth.validateUsername(usernameInput.value);
        var username = usernameResult.username;
        var email = emailInput.value.trim();
        var password = passwordInput.value;
        var confirmPassword = confirmInput.value;
        var consent = consentInput.checked;

        if (!usernameResult.ok) {
            window.HollowsideAuth.setStatus(status, usernameResult.message, "error");
            usernameInput.focus();
            return;
        }

        usernameInput.value = username;

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
            window.HollowsideAuth.setRememberPreference(true);
            var supabase = window.HollowsideAuth.createClient({ rememberMe: true });
            var usernameCheck = await supabase
                .from("profiles")
                .select("id")
                .eq("username", username)
                .maybeSingle();

            if (usernameCheck.error && usernameCheck.error.code !== "PGRST116") {
                throw usernameCheck.error;
            }

            if (usernameCheck.data) {
                window.HollowsideAuth.setStatus(status, "That username is already taken. Try another one.", "error");
                usernameInput.focus();
                return;
            }

            var loginEmail = email || window.HollowsideAuth.getVirtualEmailForUsername(username);
            var response = await supabase.auth.signUp({
                email: loginEmail,
                password: password,
                options: {
                    data: {
                        username: username,
                        display_name: displayName || username,
                        account_email_provided: Boolean(email)
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
                email
                    ? "Account created as a Member. Check your email for the Hollowside Games code or confirmation message, then enable 2FA in account settings to become Trusted Member."
                    : "Account created as a Member. You can log in with your username and add email 2FA later from account settings.",
                "success"
            );
        } catch (error) {
            var message = error && error.message === "Database error saving new user"
                ? "The account database is still being repaired on the Supabase side. Run the latest repair SQL, wait a few seconds, and try sign-up again."
                : (error && error.message ? error.message : "Something went wrong while creating your account.");

            window.HollowsideAuth.setStatus(status, message, "error");
        } finally {
            window.HollowsideAuth.setBusy(form, false);
        }
    });
});
