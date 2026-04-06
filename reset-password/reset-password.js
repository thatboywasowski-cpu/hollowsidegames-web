document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("reset-status");
    var requestSection = document.getElementById("reset-request-section");
    var updateSection = document.getElementById("reset-update-section");
    var requestForm = document.getElementById("reset-request-form");
    var updateForm = document.getElementById("reset-update-form");
    var emailInput = document.getElementById("reset-email");
    var passwordInput = document.getElementById("reset-new-password");
    var confirmInput = document.getElementById("reset-confirm-password");

    function showRequestSection() {
        requestSection.hidden = false;
        updateSection.hidden = true;
    }

    function showUpdateSection() {
        requestSection.hidden = true;
        updateSection.hidden = false;
    }

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(
            status,
            "Supabase is not connected yet. Add your project URL and anon key in /supabase-config.js to enable password reset.",
            "error"
        );
        return;
    }

    var supabase = window.HollowsideAuth.createClient();

    if (window.location.hash.indexOf("type=recovery") !== -1 || window.location.hash.indexOf("access_token=") !== -1) {
        showUpdateSection();
        window.HollowsideAuth.setStatus(status, "Recovery confirmed. Enter your new password below.", "info");
    } else {
        showRequestSection();
    }

    supabase.auth.onAuthStateChange(function (event) {
        if (event === "PASSWORD_RECOVERY") {
            showUpdateSection();
            window.HollowsideAuth.setStatus(status, "Recovery confirmed. Enter your new password below.", "info");
        }
    });

    requestForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        window.HollowsideAuth.setStatus(status, "", "info");

        var email = emailInput.value.trim();
        if (!email) {
            window.HollowsideAuth.setStatus(status, "Enter your email address to receive a reset link.", "error");
            emailInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(requestForm, true);

            var response = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + "/reset-password"
            });

            if (response.error) {
                throw response.error;
            }

            requestForm.reset();
            window.HollowsideAuth.setStatus(status, "Password reset email sent. Check your inbox for the Hollowside Games message.", "success");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while requesting the reset email.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(requestForm, false);
        }
    });

    updateForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        window.HollowsideAuth.setStatus(status, "", "info");

        var password = passwordInput.value;
        var confirmPassword = confirmInput.value;

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

        try {
            window.HollowsideAuth.setBusy(updateForm, true);

            var response = await supabase.auth.updateUser({
                password: password
            });

            if (response.error) {
                throw response.error;
            }

            updateForm.reset();
            window.HollowsideAuth.setStatus(status, "Password updated. Redirecting you back to login...", "success");
            window.setTimeout(function () {
                window.location.href = "/login";
            }, 1000);
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating your password.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(updateForm, false);
        }
    });
});
