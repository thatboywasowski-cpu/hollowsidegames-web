document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("account-status");
    var tabButtons = document.querySelectorAll("[data-account-tab]");
    var panels = document.querySelectorAll("[data-account-panel]");
    var moderationTabButton = document.getElementById("account-moderation-tab");
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
    var accessChip = document.getElementById("account-access-chip");
    var publicId = document.getElementById("account-public-id");
    var email = document.getElementById("account-email");
    var role = document.getElementById("account-role");
    var created = document.getElementById("account-created");
    var usernameChange = document.getElementById("account-username-change");
    var verificationState = document.getElementById("account-verification-state");
    var verified = document.getElementById("account-verified");
    var accessStatus = document.getElementById("account-access-status");
    var restrictionNote = document.getElementById("account-restriction-note");
    var markAllReadButton = document.getElementById("account-mark-all-read");
    var notificationUnreadChip = document.getElementById("notification-unread-chip");
    var warningCountChip = document.getElementById("warning-count-chip");
    var reportCountChip = document.getElementById("report-count-chip");
    var notificationFeed = document.getElementById("notification-feed");
    var blockList = document.getElementById("account-block-list");
    var warningForm = document.getElementById("moderation-warning-form");
    var sanctionForm = document.getElementById("moderation-sanction-form");
    var warningAccountInput = document.getElementById("moderation-warning-account");
    var warningReasonInput = document.getElementById("moderation-warning-reason");
    var sanctionAccountInput = document.getElementById("moderation-sanction-account");
    var sanctionActionInput = document.getElementById("moderation-sanction-action");
    var sanctionUntilInput = document.getElementById("moderation-sanction-until");
    var sanctionReasonInput = document.getElementById("moderation-sanction-reason");
    var moderationReportList = document.getElementById("moderation-report-list");
    var moderationSanctionList = document.getElementById("moderation-sanction-list");
    var moderationRefreshReports = document.getElementById("moderation-refresh-reports");
    var moderationRefreshSanctions = document.getElementById("moderation-refresh-sanctions");

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

    function formatDateTime(value) {
        if (!value) {
            return "Not available yet";
        }

        var parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "Not available yet";
        }

        return parsed.toLocaleString();
    }

    function getRestrictionCopy() {
        if (!accountContext || !accountContext.restriction_label) {
            return {
                chip: "Community Access: Normal",
                detail: "Community access is fully available right now."
            };
        }

        if (accountContext.is_banned) {
            return {
                chip: "Banned",
                detail: "This account is currently banned from community access. Only official news and account notices stay available until the ban is lifted."
            };
        }

        return {
            chip: "Suspended Until: " + formatDateTime(accountContext.restriction_until),
            detail: "This account is suspended from posting and commenting until " + formatDateTime(accountContext.restriction_until) + ". Reactions still remain available."
        };
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

    function selectPanel(name, replaceHash) {
        var resolved = name;

        if (resolved === "moderation" && (!accountContext || !accountContext.can_access_moderation)) {
            resolved = "profile";
        }

        if (resolved !== "notifications" && resolved !== "safety" && resolved !== "moderation") {
            resolved = "profile";
        }

        tabButtons.forEach(function (button) {
            var active = button.getAttribute("data-account-tab") === resolved;
            button.classList.toggle("is-active", active);
        });

        panels.forEach(function (panel) {
            var active = panel.getAttribute("data-account-panel") === resolved;
            panel.hidden = !active;
            panel.classList.toggle("is-active", active);
        });

        if (replaceHash) {
            var nextHash = resolved === "profile" ? "" : "#" + resolved;
            var nextUrl = window.location.pathname + window.location.search + nextHash;
            window.history.replaceState(null, "", nextUrl);
        }
    }

    function syncTabFromHash() {
        var hash = window.location.hash.replace("#", "");
        selectPanel(hash || "profile", false);
    }

    function setReadOnlyMeta(user, profile) {
        var displayName = (profile && profile.display_name) || window.HollowsideAuth.fallbackDisplayName(user);
        var username = (profile && profile.username) ? "@" + profile.username : "@member";
        var roleLabel = (profile && profile.role_label) || "Member";
        var accountId = (profile && profile.account_id) || "Pending";
        var verificationLabel = accountContext && accountContext.is_verified
            ? (accountContext.verification_mode === "automatic" ? "Automatically verified" : "Manually verified")
            : "Not verified";
        var restrictionCopy = getRestrictionCopy();

        previewName.textContent = displayName;
        previewHandle.textContent = username;
        previewBadge.innerHTML = "";
        previewHandleBadge.innerHTML = window.HollowsideAuth.getVerificationBadge(accountContext, "Verified Hollowside account");
        previewRole.textContent = roleLabel;
        previewId.textContent = accountId;
        accessChip.textContent = restrictionCopy.chip;
        publicId.textContent = accountId;
        email.textContent = user.email || "No email found";
        role.textContent = roleLabel;
        created.textContent = formatDate((profile && profile.created_at) || user.created_at);
        usernameChange.textContent = profile && profile.username_change_available_at
            ? "Available " + formatDate(profile.username_change_available_at)
            : "Not available yet";
        verificationState.textContent = verificationLabel;
        verified.textContent = user.email_confirmed_at ? "Confirmed" : "Pending confirmation";
        accessStatus.textContent = restrictionCopy.chip;
        restrictionNote.textContent = restrictionCopy.detail;
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

    function renderNotificationFeed(items) {
        var unreadCount = 0;
        var warningCount = 0;
        var reportCount = 0;

        items.forEach(function (item) {
            if (!item.is_read) {
                unreadCount += 1;
            }

            if (item.kind === "warning") {
                warningCount = Math.max(warningCount, Number(item.rolling_count || 0));
            }

            if (item.kind === "report_received") {
                reportCount = Math.max(reportCount, Number(item.rolling_count || 0));
            }
        });

        notificationUnreadChip.textContent = unreadCount + " unread";
        warningCountChip.textContent = warningCount + " warnings in 30 days";
        reportCountChip.textContent = reportCount + " reports in 30 days";

        if (!items.length) {
            notificationFeed.innerHTML = '<p class="account-note">No notifications yet.</p>';
            return;
        }

        notificationFeed.innerHTML = items.map(function (item) {
            var rolling = Number(item.rolling_count || 0);
            var chips = "";

            if (rolling > 0 && (item.kind === "warning" || item.kind === "report_received" || item.kind === "moderation_report")) {
                chips += '<span class="account-chip">' + rolling + ' in 30 days</span>';
            }

            if (!item.is_read) {
                chips += '<span class="account-chip">Unread</span>';
            }

            return (
                '<article class="account-card notification-card" data-notification-id="' + item.id + '" data-severity="' + window.HollowsideAuth.escapeHtml(item.severity || "info") + '">' +
                    '<div class="section-header">' +
                        '<div>' +
                            '<h3>' + window.HollowsideAuth.escapeHtml(item.title) + '</h3>' +
                            '<p class="account-note">' + window.HollowsideAuth.escapeHtml(formatDateTime(item.created_at)) + '</p>' +
                        '</div>' +
                        '<div class="account-chip-row">' + chips + '</div>' +
                    '</div>' +
                    '<p>' + window.HollowsideAuth.escapeHtml(item.body || "") + '</p>' +
                    '<div class="account-actions">' +
                        (item.link_url ? '<a class="account-button primary" href="' + window.HollowsideAuth.escapeHtml(item.link_url) + '">Open</a>' : "") +
                        (!item.is_read ? '<button class="account-button" type="button" data-notification-read="' + item.id + '">Mark Read</button>' : "") +
                    '</div>' +
                '</article>'
            );
        }).join("");
    }

    function renderBlockList(items) {
        if (!items.length) {
            blockList.innerHTML = '<p class="account-note">You have not blocked anyone yet.</p>';
            return;
        }

        blockList.innerHTML = items.map(function (item) {
            var badge = window.HollowsideAuth.getVerificationBadge(item, "Verified Hollowside account");
            var avatarMarkup = item.avatar_url
                ? '<span class="account-avatar-preview"><img src="' + window.HollowsideAuth.escapeHtml(item.avatar_url) + '" alt="Profile picture"></span>'
                : '<span class="account-avatar-preview">' + window.HollowsideAuth.getInitials(item, null) + "</span>";

            return (
                '<article class="account-card moderation-card" data-block-account-id="' + window.HollowsideAuth.escapeHtml(item.account_id) + '">' +
                    '<div class="profile-mini-card">' +
                        avatarMarkup +
                        '<div class="profile-mini-copy">' +
                            '<strong>' + window.HollowsideAuth.escapeHtml(item.display_name) + '</strong>' +
                            '<span class="identity-line">@' + window.HollowsideAuth.escapeHtml(item.username) + badge + '</span>' +
                            '<p>Blocked ' + window.HollowsideAuth.escapeHtml(formatDateTime(item.blocked_at)) + '</p>' +
                        '</div>' +
                    '</div>' +
                    '<p class="account-note">' + window.HollowsideAuth.escapeHtml(item.block_reason || "No block reason saved.") + '</p>' +
                    '<div class="account-actions">' +
                        '<button class="account-button" type="button" data-unblock-account="' + window.HollowsideAuth.escapeHtml(item.account_id) + '">Unblock</button>' +
                        '<button class="account-button primary" type="button" data-report-account="' + window.HollowsideAuth.escapeHtml(item.account_id) + '">Report</button>' +
                    '</div>' +
                '</article>'
            );
        }).join("");
    }

    function renderModerationReports(items) {
        if (!items.length) {
            moderationReportList.innerHTML = '<p class="account-note">No open reports right now.</p>';
            return;
        }

        moderationReportList.innerHTML = items.map(function (item) {
            var postCopy = item.target_type === "post" && item.target_post_id
                ? '<p class="account-note">Post: ' + window.HollowsideAuth.escapeHtml(item.target_post_title || item.target_post_id) + '</p>'
                : "";

            return (
                '<article class="account-card moderation-card" data-report-id="' + item.id + '">' +
                    '<div class="section-header">' +
                        '<div>' +
                            '<h3>' + window.HollowsideAuth.escapeHtml(item.target_display_name) + ' (@' + window.HollowsideAuth.escapeHtml(item.target_username) + ')</h3>' +
                            '<p class="account-note">Reported by ' + window.HollowsideAuth.escapeHtml(item.reporter_display_name) + ' on ' + window.HollowsideAuth.escapeHtml(formatDateTime(item.created_at)) + '</p>' +
                        '</div>' +
                        '<div class="account-chip-row">' +
                            '<span class="account-chip">' + window.HollowsideAuth.escapeHtml(item.target_type) + '</span>' +
                            '<span class="account-chip">' + Number(item.rolling_count_30d || 0) + ' in 30 days</span>' +
                        '</div>' +
                    '</div>' +
                    '<p><strong>Reason:</strong> ' + window.HollowsideAuth.escapeHtml(item.reason || "No reason supplied.") + '</p>' +
                    '<p class="account-note">' + window.HollowsideAuth.escapeHtml(item.details || "No extra details were included.") + '</p>' +
                    postCopy +
                    '<div class="account-actions">' +
                        '<a class="account-button" href="/profile?id=' + window.HollowsideAuth.escapeHtml(item.target_account_id) + '">View Account</a>' +
                        (item.target_post_id ? '<a class="account-button" href="/news/post?id=' + window.HollowsideAuth.escapeHtml(item.target_post_id) + '">View Post</a>' : "") +
                        '<button class="account-button primary" type="button" data-report-state="reviewed" data-report-id="' + item.id + '">Mark Reviewed</button>' +
                        '<button class="account-button danger" type="button" data-report-state="dismissed" data-report-id="' + item.id + '">Dismiss</button>' +
                    '</div>' +
                '</article>'
            );
        }).join("");
    }

    function renderModerationSanctions(items) {
        if (!items.length) {
            moderationSanctionList.innerHTML = '<p class="account-note">No active sanctions right now.</p>';
            return;
        }

        moderationSanctionList.innerHTML = items.map(function (item) {
            return (
                '<article class="account-card moderation-card" data-sanction-id="' + item.id + '">' +
                    '<div class="section-header">' +
                        '<div>' +
                            '<h3>' + window.HollowsideAuth.escapeHtml(item.target_display_name) + ' (@' + window.HollowsideAuth.escapeHtml(item.target_username) + ')</h3>' +
                            '<p class="account-note">' + window.HollowsideAuth.escapeHtml(item.sanction_type) + ' by ' + window.HollowsideAuth.escapeHtml(item.actor_display_name) + '</p>' +
                        '</div>' +
                        '<div class="account-chip-row">' +
                            '<span class="account-chip">' + window.HollowsideAuth.escapeHtml(formatDateTime(item.created_at)) + '</span>' +
                            '<span class="account-chip">' + window.HollowsideAuth.escapeHtml(item.expires_at ? ("Until " + formatDateTime(item.expires_at)) : "No end date") + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<p class="account-note">' + window.HollowsideAuth.escapeHtml(item.reason || "No reason saved.") + '</p>' +
                    '<div class="account-actions">' +
                        '<button class="account-button" type="button" data-lift-sanction="' + item.sanction_type + '" data-target-account="' + window.HollowsideAuth.escapeHtml(item.target_account_id) + '">Lift ' + window.HollowsideAuth.escapeHtml(item.sanction_type) + '</button>' +
                    '</div>' +
                '</article>'
            );
        }).join("");
    }

    async function loadNotifications() {
        try {
            var response = await supabase.rpc("get_my_notifications", {
                p_limit: 60
            });

            if (response.error) {
                throw response.error;
            }

            renderNotificationFeed(response.data || []);
        } catch (error) {
            notificationFeed.innerHTML = '<p class="account-note">Unable to load notifications right now.</p>';
        }
    }

    async function loadBlockList() {
        try {
            var response = await supabase.rpc("get_block_list");

            if (response.error) {
                throw response.error;
            }

            renderBlockList(response.data || []);
        } catch (error) {
            blockList.innerHTML = '<p class="account-note">Unable to load the block list right now.</p>';
        }
    }

    async function loadModerationData() {
        if (!accountContext || !accountContext.can_access_moderation) {
            return;
        }

        try {
            var reportsResponse = await supabase.rpc("get_moderation_reports", {
                p_state: "open",
                p_limit: 50
            });
            var sanctionsResponse = await supabase.rpc("get_active_sanctions", {
                p_limit: 40
            });

            if (reportsResponse.error) {
                throw reportsResponse.error;
            }

            if (sanctionsResponse.error) {
                throw sanctionsResponse.error;
            }

            renderModerationReports(reportsResponse.data || []);
            renderModerationSanctions(sanctionsResponse.data || []);
        } catch (error) {
            moderationReportList.innerHTML = '<p class="account-note">Unable to load the moderation queue right now.</p>';
            moderationSanctionList.innerHTML = '<p class="account-note">Unable to load active sanctions right now.</p>';
        }
    }

    async function promptReportAccount(targetAccountId) {
        var reason = window.prompt("Report reason:", "Harassment");
        if (reason === null) {
            return;
        }

        var details = window.prompt("Extra details (optional):", "") || "";

        try {
            var response = await supabase.rpc("create_report", {
                p_target_type: "account",
                p_target_account_id: targetAccountId,
                p_target_post_id: null,
                p_reason: reason.trim(),
                p_details: details.trim()
            });

            if (response.error) {
                throw response.error;
            }

            window.HollowsideAuth.setStatus(status, "Report submitted.", "success");
            loadNotifications();
            if (accountContext && accountContext.can_access_moderation) {
                loadModerationData();
            }
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while submitting the report.",
                "error"
            );
        }
    }

    async function refreshAccountContext() {
        try {
            var contextResponse = await supabase.rpc("get_my_account_context");
            if (contextResponse.data && contextResponse.data[0]) {
                accountContext = contextResponse.data[0];
            }
        } catch (error) {
            accountContext = null;
        }
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

        await refreshAccountContext();

        if (accountContext && accountContext.can_access_moderation) {
            moderationTabButton.hidden = false;
        }

        fillForm(currentUser, ensured.data);
        syncTabFromHash();
        loadNotifications();
        loadBlockList();
        loadModerationData();
    }

    avatarInput.addEventListener("change", function () {
        if (!currentUser || !avatarInput.files || !avatarInput.files[0]) {
            return;
        }

        (async function uploadAvatar(file) {
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
                await refreshAccountContext();
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
        })(avatarInput.files[0]);
    });

    tabButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            selectPanel(button.getAttribute("data-account-tab"), true);
        });
    });

    window.addEventListener("hashchange", syncTabFromHash);

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
            await refreshAccountContext();
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

    markAllReadButton.addEventListener("click", async function () {
        try {
            var response = await supabase.rpc("mark_all_notifications_read");
            if (response.error) {
                throw response.error;
            }

            loadNotifications();
        } catch (error) {
            window.HollowsideAuth.setStatus(status, "Unable to mark notifications as read right now.", "error");
        }
    });

    notificationFeed.addEventListener("click", async function (event) {
        var notificationId = event.target.getAttribute("data-notification-read");
        if (!notificationId) {
            return;
        }

        try {
            var response = await supabase.rpc("mark_notification_read", {
                p_notification_id: Number(notificationId)
            });

            if (response.error) {
                throw response.error;
            }

            loadNotifications();
        } catch (error) {
            window.HollowsideAuth.setStatus(status, "Unable to update that notification right now.", "error");
        }
    });

    blockList.addEventListener("click", async function (event) {
        var unblockAccountId = event.target.getAttribute("data-unblock-account");
        var reportAccountId = event.target.getAttribute("data-report-account");

        if (reportAccountId) {
            promptReportAccount(reportAccountId);
            return;
        }

        if (!unblockAccountId) {
            return;
        }

        try {
            var response = await supabase.rpc("set_block_state", {
                p_target_account_id: unblockAccountId,
                p_block: false,
                p_reason: ""
            });

            if (response.error) {
                throw response.error;
            }

            window.HollowsideAuth.setStatus(status, "Account unblocked.", "success");
            loadBlockList();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while unblocking that account.",
                "error"
            );
        }
    });

    warningForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!warningAccountInput.value.trim() || !warningReasonInput.value.trim()) {
            window.HollowsideAuth.setStatus(status, "Add both a target account ID and a warning reason.", "error");
            return;
        }

        try {
            var response = await supabase.rpc("issue_account_warning", {
                p_account_id: warningAccountInput.value.trim(),
                p_reason: warningReasonInput.value.trim()
            });

            if (response.error) {
                throw response.error;
            }

            warningForm.reset();
            window.HollowsideAuth.setStatus(status, "Warning issued.", "success");
            loadModerationData();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while issuing the warning.",
                "error"
            );
        }
    });

    sanctionForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        var accountId = sanctionAccountInput.value.trim();
        var action = sanctionActionInput.value;
        var note = sanctionReasonInput.value.trim();

        if (!accountId) {
            window.HollowsideAuth.setStatus(status, "Enter a target account ID first.", "error");
            return;
        }

        try {
            var response;

            if (action === "clear_suspension" || action === "clear_ban") {
                response = await supabase.rpc("clear_account_sanction", {
                    p_account_id: accountId,
                    p_sanction_type: action === "clear_suspension" ? "suspension" : "ban",
                    p_note: note
                });
            } else {
                response = await supabase.rpc("set_account_sanction", {
                    p_account_id: accountId,
                    p_sanction_type: action,
                    p_reason: note,
                    p_expires_at: action === "suspension" && sanctionUntilInput.value
                        ? new Date(sanctionUntilInput.value).toISOString()
                        : null
                });
            }

            if (response.error) {
                throw response.error;
            }

            sanctionForm.reset();
            window.HollowsideAuth.setStatus(status, "Moderation action saved.", "success");
            loadModerationData();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating the sanction.",
                "error"
            );
        }
    });

    moderationReportList.addEventListener("click", async function (event) {
        var reportId = event.target.getAttribute("data-report-id");
        var reportState = event.target.getAttribute("data-report-state");

        if (!reportId || !reportState) {
            return;
        }

        var note = window.prompt("Resolution note (optional):", "") || "";

        try {
            var response = await supabase.rpc("resolve_report", {
                p_report_id: Number(reportId),
                p_state: reportState,
                p_note: note
            });

            if (response.error) {
                throw response.error;
            }

            window.HollowsideAuth.setStatus(status, "Report updated.", "success");
            loadModerationData();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating that report.",
                "error"
            );
        }
    });

    moderationSanctionList.addEventListener("click", async function (event) {
        var sanctionType = event.target.getAttribute("data-lift-sanction");
        var targetAccount = event.target.getAttribute("data-target-account");

        if (!sanctionType || !targetAccount) {
            return;
        }

        try {
            var response = await supabase.rpc("clear_account_sanction", {
                p_account_id: targetAccount,
                p_sanction_type: sanctionType,
                p_note: "Lifted from the moderation overview."
            });

            if (response.error) {
                throw response.error;
            }

            window.HollowsideAuth.setStatus(status, "Sanction lifted.", "success");
            loadModerationData();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while lifting the sanction.",
                "error"
            );
        }
    });

    moderationRefreshReports.addEventListener("click", function () {
        loadModerationData();
    });

    moderationRefreshSanctions.addEventListener("click", function () {
        loadModerationData();
    });

    signOutButton.addEventListener("click", async function () {
        await supabase.auth.signOut();
        window.location.href = "/";
    });

    loadAccount();
});
