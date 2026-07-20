document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("oauth-complete-status");
    var form = document.getElementById("oauth-complete-form");
    var displayNameInput = document.getElementById("oauth-display-name");
    var usernameInput = document.getElementById("oauth-username");
    var skipButton = document.getElementById("oauth-skip");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient({ rememberMe: true });
    var currentUser = null;
    var currentProfile = null;

    function continueToAccount() {
        window.location.href = "/account";
    }

    function isRecentAccount(user, profile) {
        var createdValue = (profile && profile.created_at) || (user && user.created_at);
        var createdAt = new Date(createdValue || "").getTime();
        return Number.isFinite(createdAt) && Date.now() - createdAt < 30 * 60 * 1000;
    }

    async function initialize() {
        try {
            await supabase.auth.getSession();
            var userResult = await supabase.auth.getUser();
            currentUser = userResult && userResult.data ? userResult.data.user : null;

            if (!currentUser) {
                window.HollowsideAuth.setStatus(status, "Your provider sign-in could not be completed. Returning to signup...", "error");
                window.setTimeout(function () {
                    window.location.href = "/signup";
                }, 1100);
                return;
            }

            var ensured = await window.HollowsideAuth.ensureProfile(supabase, currentUser);
            if (ensured.error) {
                throw ensured.error;
            }

            currentProfile = ensured.data;
            if (!isRecentAccount(currentUser, currentProfile)) {
                continueToAccount();
                return;
            }

            displayNameInput.value = currentProfile.display_name || window.HollowsideAuth.fallbackDisplayName(currentUser);
            usernameInput.value = currentProfile.username || window.HollowsideAuth.fallbackUsername(currentUser);
            form.hidden = false;
            window.HollowsideAuth.setStatus(status, "Your provider account is connected. Choose your Hollowside identity or skip this step.", "success");
            usernameInput.focus();
            usernameInput.select();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while preparing your account.",
                "error"
            );
        }
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!currentUser || !currentProfile) {
            return;
        }

        var usernameResult = window.HollowsideAuth.validateUsername(usernameInput.value);
        var username = usernameResult.username;
        var displayName = displayNameInput.value.trim() || username;

        if (!usernameResult.ok) {
            window.HollowsideAuth.setStatus(status, usernameResult.message, "error");
            usernameInput.focus();
            return;
        }

        usernameInput.value = username;

        try {
            window.HollowsideAuth.setBusy(form, true);
            var response = await supabase
                .from("profiles")
                .update({
                    username: username,
                    display_name: displayName
                })
                .eq("id", currentUser.id)
                .select("*")
                .single();

            if (response.error) {
                throw response.error;
            }

            currentProfile = response.data;
            window.HollowsideAuth.setStatus(status, "Your Hollowside identity is ready.", "success");
            window.setTimeout(continueToAccount, 550);
        } catch (error) {
            var message = error && error.code === "23505"
                ? "That username is already taken. Try another one."
                : (error && error.message ? error.message : "Something went wrong while saving your profile.");
            window.HollowsideAuth.setStatus(status, message, "error");
        } finally {
            window.HollowsideAuth.setBusy(form, false);
        }
    });

    skipButton.addEventListener("click", continueToAccount);
    initialize();
});
