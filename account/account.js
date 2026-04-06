document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("account-status");
    var profileForm = document.getElementById("account-profile-form");
    var passwordForm = document.getElementById("account-password-form");
    var signOutButton = document.getElementById("account-signout");
    var avatarInput = document.getElementById("account-avatar-input");
    var avatarPreview = document.getElementById("account-avatar-preview");
    var displayNameInput = document.getElementById("account-display-name");
    var usernameInput = document.getElementById("account-username");
    var bioInput = document.getElementById("account-bio");
    var websiteInput = document.getElementById("account-website");
    var locationInput = document.getElementById("account-location");
    var passwordInput = document.getElementById("account-new-password");
    var confirmPasswordInput = document.getElementById("account-confirm-password");
    var previewName = document.getElementById("account-preview-name");
    var previewBadge = document.getElementById("account-preview-badge");
    var previewHandle = document.getElementById("account-preview-handle");
    var previewHandleBadge = document.getElementById("account-preview-handle-badge");
    var previewRole = document.getElementById("account-preview-role");
    var previewId = document.getElementById("account-preview-id");
    var publicId = document.getElementById("account-public-id");
    var email = document.getElementById("account-email");
    var role = document.getElementById("account-role");
    var created = document.getElementById("account-created");
    var usernameChange = document.getElementById("account-username-change");
    var verificationState = document.getElementById("account-verification-state");
    var verified = document.getElementById("account-verified");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(
            status,
            "Supabase is not connected yet. Add your project URL and publishable key in /supabase-config.js to enable account settings.",
            "error"
        );
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var currentUser = null;
    var currentProfile = null;
    var accountContext = null;

    function formatDate(value) {
        if (!value) {
            return "Not available yet";
        }

        var parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "Not available yet";
        }

        return parsed.toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    function setAvatar(profile, user) {
        var avatarUrl = profile && profile.avatar_url ? profile.avatar_url : "";
        var initials = window.HollowsideAuth.getInitials(profile, user);
        avatarPreview.innerHTML = "";

        if (avatarUrl) {
            var image = document.createElement("img");
            image.src = avatarUrl;
            image.alt = "Profile picture";
            avatarPreview.appendChild(image);
        } else {
            avatarPreview.textContent = initials;
        }
    }

    function setReadOnlyMeta(user, profile) {
        var displayName = (profile && profile.display_name) || window.HollowsideAuth.fallbackDisplayName(user);
        var username = (profile && profile.username) ? "@" + profile.username : "@member";
        var roleLabel = (profile && profile.role_label) || "Member";
        var accountId = (profile && profile.account_id) || "Pending";
        var verificationLabel = accountContext && accountContext.is_verified
            ? (accountContext.verification_mode === "automatic" ? "Automatically verified" : "Manually verified")
            : "Not verified";

        previewName.textContent = displayName;
        previewHandle.textContent = username;
        previewBadge.innerHTML = "";
        previewHandleBadge.innerHTML = window.HollowsideAuth.getVerificationBadge(accountContext, "Verified Hollowside account");
        previewRole.textContent = roleLabel;
        previewId.textContent = accountId;
        publicId.textContent = accountId;
        email.textContent = user.email || "No email found";
        role.textContent = roleLabel;
        created.textContent = formatDate((profile && profile.created_at) || user.created_at);
        usernameChange.textContent = profile && profile.username_change_available_at
            ? "Available " + formatDate(profile.username_change_available_at)
            : "Not available yet";
        verificationState.textContent = verificationLabel;
        verified.textContent = user.email_confirmed_at ? "Confirmed" : "Pending confirmation";
        setAvatar(profile, user);
    }

    function fillForm(user, profile) {
        currentProfile = profile;
        displayNameInput.value = (profile && profile.display_name) || window.HollowsideAuth.fallbackDisplayName(user);
        usernameInput.value = (profile && profile.username) || window.HollowsideAuth.fallbackUsername(user);
        bioInput.value = (profile && profile.bio) || "";
        websiteInput.value = (profile && profile.website_url) || "";
        locationInput.value = (profile && profile.location) || "";
        setReadOnlyMeta(user, profile);
    }

    function emitProfileUpdate(profile) {
        window.dispatchEvent(new CustomEvent("hollowside-profile-updated", {
            detail: {
                profile: profile
            }
        }));
    }

    async function loadAccount() {
        var userResult = await supabase.auth.getUser();
        currentUser = userResult && userResult.data ? userResult.data.user : null;

        if (!currentUser) {
            window.HollowsideAuth.setStatus(
                status,
                "You need to log in before you can open account settings. Redirecting...",
                "info"
            );
            window.setTimeout(function () {
                window.location.href = "/login?redirect=/account";
            }, 950);
            return;
        }

        var ensured = await window.HollowsideAuth.ensureProfile(supabase, currentUser);
        if (ensured.error) {
            window.HollowsideAuth.setStatus(
                status,
                ensured.error.message || "Your profile table is not ready yet. Run the profile SQL in Supabase first.",
                "error"
            );
            return;
        }

        try {
            var contextResponse = await supabase.rpc("get_my_account_context");
            if (contextResponse.data && contextResponse.data[0]) {
                accountContext = contextResponse.data[0];
            }
        } catch (error) {
            accountContext = null;
        }

        fillForm(currentUser, ensured.data);
    }

    async function uploadAvatar(file) {
        if (!currentUser || !file) {
            return;
        }

        if (!file.type || file.type.indexOf("image/") !== 0) {
            window.HollowsideAuth.setStatus(status, "Please choose an image file for the profile picture.", "error");
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            window.HollowsideAuth.setStatus(status, "Please keep avatar uploads under 5 MB.", "error");
            return;
        }

        var extension = (file.name.split(".").pop() || "png").toLowerCase();
        var filePath = currentUser.id + "/avatar." + extension;

        try {
            window.HollowsideAuth.setStatus(status, "Uploading your new profile picture...", "info");
            var uploadResult = await supabase.storage
                .from("avatars")
                .upload(filePath, file, {
                    upsert: true,
                    cacheControl: "3600"
                });

            if (uploadResult.error) {
                throw uploadResult.error;
            }

            var publicUrlResult = supabase.storage
                .from("avatars")
                .getPublicUrl(filePath);

            var avatarUrl = publicUrlResult.data.publicUrl + "?v=" + Date.now();
            var updateResult = await supabase
                .from("profiles")
                .update({
                    avatar_url: avatarUrl,
                    avatar_path: filePath
                })
                .eq("id", currentUser.id)
                .select("*")
                .single();

            if (updateResult.error) {
                throw updateResult.error;
            }

            currentProfile = updateResult.data;
            try {
                var contextResponse = await supabase.rpc("get_my_account_context");
                if (contextResponse.data && contextResponse.data[0]) {
                    accountContext = contextResponse.data[0];
                }
            } catch (error) {}
            fillForm(currentUser, currentProfile);
            emitProfileUpdate(currentProfile);
            window.HollowsideAuth.setStatus(status, "Profile picture updated.", "success");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while uploading your profile picture.",
                "error"
            );
        }
    }

    avatarInput.addEventListener("change", function () {
        if (avatarInput.files && avatarInput.files[0]) {
            uploadAvatar(avatarInput.files[0]);
        }
    });

    profileForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser) {
            return;
        }

        var username = window.HollowsideAuth.sanitizeUsername(usernameInput.value);
        var displayName = displayNameInput.value.trim() || username || "Hollowside Member";
        var bio = bioInput.value.trim();
        var websiteUrl = websiteInput.value.trim();
        var locationValue = locationInput.value.trim();

        if (username.length < 3) {
            window.HollowsideAuth.setStatus(status, "Usernames need to be at least 3 characters long and can only use letters, numbers, underscores, or periods.", "error");
            usernameInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(profileForm, true);

            var updateResult = await supabase
                .from("profiles")
                .update({
                    username: username,
                    display_name: displayName,
                    bio: bio,
                    website_url: websiteUrl,
                    location: locationValue
                })
                .eq("id", currentUser.id)
                .select("*")
                .single();

            if (updateResult.error) {
                throw updateResult.error;
            }

            currentProfile = updateResult.data;
            try {
                var latestContext = await supabase.rpc("get_my_account_context");
                if (latestContext.data && latestContext.data[0]) {
                    accountContext = latestContext.data[0];
                }
            } catch (error) {}
            fillForm(currentUser, currentProfile);
            emitProfileUpdate(currentProfile);
            window.HollowsideAuth.setStatus(status, "Account profile saved.", "success");
        } catch (error) {
            var message = error && error.code === "23505"
                ? "That username is already taken. Try another one."
                : (error && error.message ? error.message : "Something went wrong while saving your profile.");

            window.HollowsideAuth.setStatus(status, message, "error");
        } finally {
            window.HollowsideAuth.setBusy(profileForm, false);
        }
    });

    passwordForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        var newPassword = passwordInput.value;
        var confirmPassword = confirmPasswordInput.value;

        if (newPassword.length < 8) {
            window.HollowsideAuth.setStatus(status, "Use a password that is at least 8 characters long.", "error");
            passwordInput.focus();
            return;
        }

        if (newPassword !== confirmPassword) {
            window.HollowsideAuth.setStatus(status, "Your new passwords do not match.", "error");
            confirmPasswordInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(passwordForm, true);
            var result = await supabase.auth.updateUser({
                password: newPassword
            });

            if (result.error) {
                throw result.error;
            }

            passwordForm.reset();
            window.HollowsideAuth.setStatus(status, "Password updated successfully.", "success");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating your password.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(passwordForm, false);
        }
    });

    signOutButton.addEventListener("click", async function () {
        await supabase.auth.signOut();
        window.location.href = "/";
    });

    loadAccount();
});
