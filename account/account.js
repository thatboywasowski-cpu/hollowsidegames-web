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
    var backgroundInput = document.getElementById("account-background-input");
    var backgroundPreview = document.getElementById("account-background-preview");
    var backgroundPreviewCopy = document.getElementById("account-background-preview-copy");
    var backgroundState = document.getElementById("account-background-state");
    var backgroundRemove = document.getElementById("account-background-remove");
    var backgroundBlurInput = document.getElementById("account-background-blur");
    var backgroundBlurValue = document.getElementById("account-background-blur-value");
    var themeInputs = document.querySelectorAll('input[name="profile-theme"]');
    var themeTabs = document.querySelectorAll("[data-theme-panel-target]");
    var themePanels = document.querySelectorAll("[data-theme-panel]");
    var customThemeRadio = document.getElementById("account-custom-theme-radio");
    var customThemeOption = document.getElementById("account-custom-theme-option");
    var customThemeColor = document.getElementById("account-theme-color");
    var customThemeHex = document.getElementById("account-theme-hex");
    var customThemeRed = document.getElementById("account-theme-red");
    var customThemeGreen = document.getElementById("account-theme-green");
    var customThemeBlue = document.getElementById("account-theme-blue");
    var secondaryThemeEnabled = document.getElementById("account-secondary-theme-enabled");
    var secondaryThemeControls = document.getElementById("account-secondary-theme-controls");
    var secondaryThemePresets = document.getElementById("account-secondary-theme-presets");
    var secondaryThemeColor = document.getElementById("account-secondary-theme-color");
    var secondaryThemeHex = document.getElementById("account-secondary-theme-hex");
    var secondaryThemeRed = document.getElementById("account-secondary-theme-red");
    var secondaryThemeGreen = document.getElementById("account-secondary-theme-green");
    var secondaryThemeBlue = document.getElementById("account-secondary-theme-blue");
    var musicInput = document.getElementById("account-music-input");
    var musicState = document.getElementById("account-music-state");
    var musicRemove = document.getElementById("account-music-remove");
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
    var twoFactorStatus = document.getElementById("account-2fa-status");
    var twoFactorRequestForm = document.getElementById("account-2fa-request-form");
    var twoFactorVerifyForm = document.getElementById("account-2fa-verify-form");
    var twoFactorEmailInput = document.getElementById("account-2fa-email");
    var twoFactorCodeInput = document.getElementById("account-2fa-code");

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

    function getLegacyNoticeDismissedKey(userId) {
        return "hollowside-legacy-2fa-notice-dismissed-" + String(userId || "");
    }

    function hasDismissedLegacyNotice(userId) {
        try {
            return window.localStorage.getItem(getLegacyNoticeDismissedKey(userId)) === "true";
        } catch (error) {
            return false;
        }
    }

    function markLegacyNoticeDismissed(userId) {
        try {
            window.localStorage.setItem(getLegacyNoticeDismissedKey(userId), "true");
        } catch (error) {
            return;
        }
    }

    function shouldFinishOAuthSignup(user, profile) {
        var pending = false;
        try {
            pending = window.sessionStorage.getItem("hollowside-oauth-signup-onboarding") === "pending";
            window.sessionStorage.removeItem("hollowside-oauth-signup-onboarding");
        } catch (error) {
            return false;
        }

        if (!pending) {
            return false;
        }

        var createdValue = (profile && profile.created_at) || (user && user.created_at);
        var createdAt = new Date(createdValue || "").getTime();
        return Number.isFinite(createdAt) && Date.now() - createdAt < 30 * 60 * 1000;
    }

    function openAccountDialog(title, body, buttonLabel, onClose) {
        var backdrop = document.createElement("div");
        backdrop.className = "account-dialog-backdrop";
        backdrop.innerHTML =
            '<section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">' +
                '<h2 id="account-dialog-title">' + window.HollowsideAuth.escapeHtml(title) + '</h2>' +
                '<p>' + window.HollowsideAuth.escapeHtml(body) + '</p>' +
                '<div class="account-actions">' +
                    '<button class="account-button primary" type="button" data-account-dialog-close>' + window.HollowsideAuth.escapeHtml(buttonLabel || "Great!") + '</button>' +
                '</div>' +
            '</section>';

        backdrop.addEventListener("click", function (event) {
            if (event.target.hasAttribute("data-account-dialog-close")) {
                backdrop.remove();
                if (typeof onClose === "function") {
                    onClose();
                }
            }
        });

        document.body.appendChild(backdrop);
        var closeButton = backdrop.querySelector("[data-account-dialog-close]");
        if (closeButton) {
            closeButton.focus();
        }
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
        if (window.HollowsideAuth.isVirtualEmail(user.email)) {
            email.textContent = "No email added";
        }
        role.textContent = roleLabel;
        created.textContent = formatDate((profile && profile.created_at) || user.created_at);
        if (profile && profile.username_change_available_at) {
            var usernameAvailableAt = new Date(profile.username_change_available_at).getTime();
            usernameChange.textContent = Number.isFinite(usernameAvailableAt) && usernameAvailableAt <= Date.now()
                ? "Available now"
                : "Available " + formatDate(profile.username_change_available_at);
        } else {
            usernameChange.textContent = "Not available yet";
        }
        verificationState.textContent = verificationLabel;
        verified.textContent = user.email_confirmed_at ? "Confirmed" : "Pending confirmation";
        accessStatus.textContent = restrictionCopy.chip;
        restrictionNote.textContent = restrictionCopy.detail;
        setAvatar(profile, user);
        renderTwoFactorState(user);
    }

    function renderTwoFactorState(user) {
        var enabled = accountContext && accountContext.is_2fa_enabled;
        var contact = accountContext && accountContext.two_factor_contact
            ? accountContext.two_factor_contact
            : (!window.HollowsideAuth.isVirtualEmail(user.email) ? user.email : "");

        twoFactorStatus.textContent = enabled
            ? "2FA active" + (contact ? ": " + contact : "")
            : "2FA not active";

        if (contact && !twoFactorEmailInput.value) {
            twoFactorEmailInput.value = contact;
        }
    }

    function clampColorChannel(value) {
        return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    }

    function normalizeHexColor(value) {
        var normalized = String(value || "").trim().replace(/^#/, "");
        return /^[0-9a-f]{6}$/i.test(normalized) ? "#" + normalized.toUpperCase() : "";
    }

    function rgbToHex(red, green, blue) {
        return "#" + [red, green, blue].map(function (channel) {
            return clampColorChannel(channel).toString(16).padStart(2, "0");
        }).join("").toUpperCase();
    }

    function hexToRgb(hex) {
        var normalized = normalizeHexColor(hex).slice(1);
        return [
            parseInt(normalized.slice(0, 2), 16),
            parseInt(normalized.slice(2, 4), 16),
            parseInt(normalized.slice(4, 6), 16)
        ];
    }

    function setThemePanel(panelName) {
        themeTabs.forEach(function (tab) {
            var isActive = tab.getAttribute("data-theme-panel-target") === panelName;
            tab.classList.toggle("is-active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
            tab.tabIndex = isActive ? 0 : -1;
        });

        themePanels.forEach(function (panel) {
            panel.hidden = panel.getAttribute("data-theme-panel") !== panelName;
        });
    }

    function syncCustomThemeControls(hex) {
        var normalized = normalizeHexColor(hex) || "#EF646F";
        var channels = hexToRgb(normalized);
        customThemeColor.value = normalized.toLowerCase();
        customThemeHex.value = normalized;
        customThemeRed.value = String(channels[0]);
        customThemeGreen.value = String(channels[1]);
        customThemeBlue.value = String(channels[2]);
        customThemeOption.style.setProperty("--swatch", normalized);
        return normalized;
    }

    function getCustomProfileTheme() {
        var color = normalizeHexColor(customThemeHex.value) || normalizeHexColor(customThemeColor.value) || "#EF646F";
        return "custom-" + color.slice(1).toLowerCase();
    }

    function formatThemeName(theme) {
        return theme.split("-").map(function (word) {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(" ");
    }

    function updateSecondaryPresetSelection(hex) {
        var normalized = normalizeHexColor(hex).toLowerCase();
        secondaryThemePresets.querySelectorAll("[data-secondary-theme]").forEach(function (button) {
            var isSelected = button.getAttribute("data-secondary-color") === normalized;
            button.classList.toggle("is-selected", isSelected);
            button.setAttribute("aria-pressed", isSelected ? "true" : "false");
        });
    }

    function syncSecondaryThemeControls(hex) {
        var normalized = normalizeHexColor(hex) || "#FFFFFF";
        var channels = hexToRgb(normalized);
        secondaryThemeColor.value = normalized.toLowerCase();
        secondaryThemeHex.value = normalized;
        secondaryThemeRed.value = String(channels[0]);
        secondaryThemeGreen.value = String(channels[1]);
        secondaryThemeBlue.value = String(channels[2]);
        updateSecondaryPresetSelection(normalized);
        return normalized;
    }

    function getSelectedSecondaryTheme() {
        if (!secondaryThemeEnabled.checked) {
            return "";
        }
        var color = normalizeHexColor(secondaryThemeHex.value) || normalizeHexColor(secondaryThemeColor.value) || "#FFFFFF";
        return "custom-" + color.slice(1).toLowerCase();
    }

    function previewSelectedThemes() {
        window.HollowsideAuth.applySiteTheme(getSelectedProfileTheme(), false, getSelectedSecondaryTheme());
    }

    function renderSecondaryThemePresets() {
        secondaryThemePresets.innerHTML = "";
        Object.keys(window.HollowsideAuth.siteThemeColors).forEach(function (theme) {
            var color = window.HollowsideAuth.siteThemeColors[theme];
            var button = document.createElement("button");
            var label = formatThemeName(theme);
            button.type = "button";
            button.className = "profile-secondary-swatch";
            button.setAttribute("data-secondary-theme", theme);
            button.setAttribute("data-secondary-color", color.toLowerCase());
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-pressed", "false");
            button.title = label;
            button.style.setProperty("--swatch", color);
            button.addEventListener("click", function () {
                secondaryThemeEnabled.checked = true;
                secondaryThemeControls.hidden = false;
                syncSecondaryThemeControls(color);
                previewSelectedThemes();
            });
            secondaryThemePresets.appendChild(button);
        });
    }

    function previewCustomTheme() {
        customThemeRadio.checked = true;
        previewSelectedThemes();
    }

    function getSelectedProfileTheme() {
        var selected = document.querySelector('input[name="profile-theme"]:checked');
        if (selected && selected.value === "custom") {
            return getCustomProfileTheme();
        }
        return selected ? window.HollowsideAuth.normalizeSiteTheme(selected.value) : "black";
    }

    function renderCustomizationSettings(profile) {
        var backgroundUrl = (profile && profile.profile_background_url) || "";
        var blur = Math.max(0, Math.min(30, Number(profile && profile.profile_background_blur) || 0));
        var theme = window.HollowsideAuth.normalizeSiteTheme((profile && profile.profile_theme) || "black");
        var secondaryTheme = window.HollowsideAuth.normalizeSecondarySiteTheme(profile && profile.profile_theme_secondary);
        var musicUrl = (profile && profile.profile_music_url) || "";
        var isCustomTheme = theme.indexOf("custom-") === 0;

        window.HollowsideAuth.applySiteTheme(theme, true, secondaryTheme);

        backgroundBlurInput.value = String(blur);
        backgroundBlurValue.textContent = blur + " px";
        backgroundPreview.style.setProperty("--preview-blur", blur + "px");
        backgroundPreview.classList.toggle("has-image", !!backgroundUrl);
        backgroundPreview.style.setProperty("--preview-image", backgroundUrl ? 'url("' + backgroundUrl.replace(/"/g, "%22") + '")' : "none");
        backgroundPreviewCopy.textContent = backgroundUrl ? "Background preview" : "No background selected";
        backgroundState.textContent = backgroundUrl ? "Background image active." : "PNG, JPEG, or WebP up to 20 MB.";
        backgroundRemove.hidden = !backgroundUrl;
        musicState.textContent = musicUrl ? "Profile music active." : "MP3, OGG, WAV, M4A, AAC, WebM, or FLAC up to 50 MB.";
        musicRemove.hidden = !musicUrl;

        themeInputs.forEach(function (input) {
            input.checked = isCustomTheme ? input.value === "custom" : input.value === theme;
        });

        if (isCustomTheme) {
            syncCustomThemeControls(window.HollowsideAuth.getSiteThemeColor(theme));
            setThemePanel("custom");
        } else {
            var selectedThemeInput = document.querySelector('input[name="profile-theme"]:checked');
            var selectedPanel = selectedThemeInput && selectedThemeInput.closest("[data-theme-panel]");
            setThemePanel(selectedPanel ? selectedPanel.getAttribute("data-theme-panel") : "basic");
        }

        secondaryThemeEnabled.checked = !!secondaryTheme;
        secondaryThemeControls.hidden = !secondaryTheme;
        syncSecondaryThemeControls(secondaryTheme ? window.HollowsideAuth.getSiteThemeColor(secondaryTheme) : "#FFFFFF");
    }

    function fillForm(user, profile) {
        currentProfile = profile;
        displayNameInput.value = (profile && profile.display_name) || window.HollowsideAuth.fallbackDisplayName(user);
        usernameInput.value = (profile && profile.username) || window.HollowsideAuth.fallbackUsername(user);
        bioInput.value = (profile && profile.bio) || "";
        websiteInput.value = (profile && profile.website_url) || "";
        locationInput.value = (profile && profile.location) || "";
        renderCustomizationSettings(profile);
        setReadOnlyMeta(user, profile);
    }

    function emitProfileUpdate(profile) {
        window.dispatchEvent(new CustomEvent("hollowside-profile-updated", {
            detail: {
                profile: profile
            }
        }));
    }

    function parseNotificationMetadata(item) {
        if (!item || !item.metadata) {
            return {};
        }

        if (typeof item.metadata === "object") {
            return item.metadata;
        }

        try {
            return JSON.parse(item.metadata);
        } catch (error) {
            return {};
        }
    }

    function getSafeNotificationUrl(value) {
        var url = String(value || "");
        return /^\/(?!\/)/.test(url) ? url : "";
    }

    function renderNotificationFeed(items, totalUnread) {
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

        if (totalUnread !== null && totalUnread !== undefined && Number.isFinite(Number(totalUnread))) {
            unreadCount = Number(totalUnread);
        }

        notificationUnreadChip.textContent = unreadCount + " unread";
        warningCountChip.textContent = warningCount + " warnings in 30 days";
        reportCountChip.textContent = reportCount + " reports in 30 days";
        window.dispatchEvent(new CustomEvent("hollowside-notifications-updated", {
            detail: { unreadCount: unreadCount }
        }));

        if (!items.length) {
            notificationFeed.innerHTML = '<p class="account-note">No notifications yet.</p>';
            return;
        }

        notificationFeed.innerHTML = items.map(function (item) {
            var rolling = Number(item.rolling_count || 0);
            var chips = "";
            var metadata = parseNotificationMetadata(item);
            var primaryUrl = getSafeNotificationUrl(metadata.primary_action_url || item.link_url);
            var secondaryUrl = getSafeNotificationUrl(metadata.secondary_action_url);
            var primaryLabel = metadata.primary_action_label || (primaryUrl ? "Open" : "");
            var secondaryLabel = metadata.secondary_action_label || (secondaryUrl ? "Open" : "");

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
                    (item.body ? '<p>' + window.HollowsideAuth.escapeHtml(item.body) + '</p>' : "") +
                    '<div class="account-actions">' +
                        (primaryUrl ? '<a class="account-button primary" href="' + window.HollowsideAuth.escapeHtml(primaryUrl) + '">' + window.HollowsideAuth.escapeHtml(primaryLabel) + '</a>' : "") +
                        (secondaryUrl ? '<a class="account-button" href="' + window.HollowsideAuth.escapeHtml(secondaryUrl) + '">' + window.HollowsideAuth.escapeHtml(secondaryLabel) + '</a>' : "") +
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
            var results = await Promise.all([
                supabase.rpc("get_my_notifications", { p_limit: 60 }),
                supabase.rpc("get_unread_notification_count")
            ]);
            var response = results[0];
            var countResponse = results[1];

            if (response.error) {
                throw response.error;
            }

            renderNotificationFeed(
                response.data || [],
                countResponse.error ? null : Number(countResponse.data || 0)
            );
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
                accountContext = window.HollowsideAuth.applyRoleEmulation(contextResponse.data[0], null);
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

        if (shouldFinishOAuthSignup(currentUser, ensured.data)) {
            window.location.replace("/signup/complete/");
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

    async function updateCurrentProfile(patch, successMessage) {
        var updateResult = await supabase
            .from("profiles")
            .update(patch)
            .eq("id", currentUser.id)
            .select("*")
            .single();

        if (updateResult.error) {
            throw updateResult.error;
        }

        currentProfile = updateResult.data;
        window.HollowsideAuth.applySiteTheme(
            currentProfile.profile_theme || "black",
            true,
            currentProfile.profile_theme_secondary || ""
        );
        await refreshAccountContext();
        fillForm(currentUser, currentProfile);
        emitProfileUpdate(currentProfile);
        window.HollowsideAuth.setStatus(status, successMessage, "success");
    }

    async function removeCustomizationAsset(path) {
        if (!path) {
            return;
        }

        var removeResult = await supabase.storage
            .from("profile-customization")
            .remove([path]);

        if (removeResult.error) {
            return false;
        }

        return true;
    }

    avatarInput.addEventListener("change", function () {
        if (!currentUser || !avatarInput.files || !avatarInput.files[0]) {
            return;
        }

        (async function uploadAvatar(file) {
            try {
                if (!file.type || file.type.indexOf("image/") !== 0) {
                    window.HollowsideAuth.setStatus(status, "Please choose an image file for the profile picture.", "error");
                    return;
                }

                if (file.size > 20 * 1024 * 1024) {
                    window.HollowsideAuth.setStatus(status, "Item is too large! Compress this file or choose a smaller one.", "error");
                    return;
                }

                var editedFile = await window.HollowsideAuth.editImageFile(file, {
                    shape: "circle",
                    outputWidth: 512,
                    outputHeight: 512,
                    title: "Transform your profile picture to your liking."
                });

                if (!editedFile) {
                    avatarInput.value = "";
                    return;
                }

                var uploadFile = editedFile;
                var extension = "png";
                var filePath = currentUser.id + "/avatar." + extension;

                window.HollowsideAuth.setStatus(status, "Uploading your new profile picture...", "info");
                var uploadResult = await supabase.storage
                    .from("avatars")
                    .upload(filePath, uploadFile, {
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
                var message = error && error.message && /size|large|payload|limit|exceed/i.test(error.message)
                    ? "Item is too large! Compress this file or choose a smaller one."
                    : (error && error.message ? error.message : "Something went wrong while uploading your profile picture.");
                window.HollowsideAuth.setStatus(
                    status,
                    message,
                    "error"
                );
            }
        })(avatarInput.files[0]);
    });

    backgroundBlurInput.addEventListener("input", function () {
        var blur = Math.max(0, Math.min(30, Number(backgroundBlurInput.value) || 0));
        backgroundBlurValue.textContent = blur + " px";
        backgroundPreview.style.setProperty("--preview-blur", blur + "px");
    });

    themeInputs.forEach(function (input) {
        input.addEventListener("change", function () {
            if (input.checked) {
                previewSelectedThemes();
            }
        });
    });

    themeTabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
            setThemePanel(tab.getAttribute("data-theme-panel-target"));
        });

        tab.addEventListener("keydown", function (event) {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1) {
                return;
            }

            event.preventDefault();
            var currentIndex = Array.prototype.indexOf.call(themeTabs, tab);
            var targetIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                    ? themeTabs.length - 1
                    : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + themeTabs.length) % themeTabs.length;
            var targetTab = themeTabs[targetIndex];
            setThemePanel(targetTab.getAttribute("data-theme-panel-target"));
            targetTab.focus();
        });
    });

    customThemeColor.addEventListener("input", function () {
        syncCustomThemeControls(customThemeColor.value);
        previewCustomTheme();
    });

    customThemeHex.addEventListener("input", function () {
        var normalized = normalizeHexColor(customThemeHex.value);
        if (normalized) {
            syncCustomThemeControls(normalized);
            previewCustomTheme();
        }
    });

    customThemeHex.addEventListener("blur", function () {
        syncCustomThemeControls(customThemeHex.value || customThemeColor.value);
    });

    [customThemeRed, customThemeGreen, customThemeBlue].forEach(function (input) {
        input.addEventListener("input", function () {
            var hex = rgbToHex(customThemeRed.value, customThemeGreen.value, customThemeBlue.value);
            syncCustomThemeControls(hex);
            previewCustomTheme();
        });

        input.addEventListener("blur", function () {
            input.value = String(clampColorChannel(input.value));
        });
    });

    secondaryThemeEnabled.addEventListener("change", function () {
        secondaryThemeControls.hidden = !secondaryThemeEnabled.checked;
        previewSelectedThemes();
    });

    secondaryThemeColor.addEventListener("input", function () {
        secondaryThemeEnabled.checked = true;
        secondaryThemeControls.hidden = false;
        syncSecondaryThemeControls(secondaryThemeColor.value);
        previewSelectedThemes();
    });

    secondaryThemeHex.addEventListener("input", function () {
        var normalized = normalizeHexColor(secondaryThemeHex.value);
        if (normalized) {
            secondaryThemeEnabled.checked = true;
            syncSecondaryThemeControls(normalized);
            previewSelectedThemes();
        }
    });

    secondaryThemeHex.addEventListener("blur", function () {
        syncSecondaryThemeControls(secondaryThemeHex.value || secondaryThemeColor.value);
    });

    [secondaryThemeRed, secondaryThemeGreen, secondaryThemeBlue].forEach(function (input) {
        input.addEventListener("input", function () {
            var hex = rgbToHex(secondaryThemeRed.value, secondaryThemeGreen.value, secondaryThemeBlue.value);
            secondaryThemeEnabled.checked = true;
            syncSecondaryThemeControls(hex);
            previewSelectedThemes();
        });

        input.addEventListener("blur", function () {
            input.value = String(clampColorChannel(input.value));
        });
    });

    backgroundInput.addEventListener("change", function () {
        if (!currentUser || !backgroundInput.files || !backgroundInput.files[0]) {
            return;
        }

        (async function uploadBackground(file) {
            try {
                if (!file.type || ["image/png", "image/jpeg", "image/webp"].indexOf(file.type) === -1) {
                    throw new Error("Choose a PNG, JPEG, or WebP image for your profile background.");
                }

                if (file.size > 20 * 1024 * 1024) {
                    throw new Error("The background image must be 20 MB or smaller.");
                }

                var editedFile = await window.HollowsideAuth.editImageFile(file, {
                    shape: "rect",
                    outputWidth: 1920,
                    outputHeight: 1080,
                    title: "Position your profile background."
                });

                if (!editedFile) {
                    return;
                }

                var filePath = currentUser.id + "/background.png";
                window.HollowsideAuth.setStatus(status, "Uploading your profile background...", "info");
                var uploadResult = await supabase.storage
                    .from("profile-customization")
                    .upload(filePath, editedFile, {
                        upsert: true,
                        cacheControl: "3600",
                        contentType: "image/png"
                    });

                if (uploadResult.error) {
                    throw uploadResult.error;
                }

                var publicUrl = supabase.storage
                    .from("profile-customization")
                    .getPublicUrl(filePath).data.publicUrl + "?v=" + Date.now();

                await updateCurrentProfile({
                    profile_background_url: publicUrl,
                    profile_background_path: filePath
                }, "Profile background updated.");
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while uploading your profile background.",
                    "error"
                );
            } finally {
                backgroundInput.value = "";
            }
        })(backgroundInput.files[0]);
    });

    backgroundRemove.addEventListener("click", async function () {
        if (!currentUser || !currentProfile) {
            return;
        }

        try {
            var previousPath = currentProfile.profile_background_path || "";
            await updateCurrentProfile({
                profile_background_url: "",
                profile_background_path: ""
            }, "Profile background removed.");
            await removeCustomizationAsset(previousPath);
        } catch (error) {
            window.HollowsideAuth.setStatus(status, error && error.message ? error.message : "The profile background could not be removed.", "error");
        }
    });

    musicInput.addEventListener("change", function () {
        if (!currentUser || !musicInput.files || !musicInput.files[0]) {
            return;
        }

        (async function uploadMusic(file) {
            var supportedTypes = {
                "audio/mpeg": "mp3",
                "audio/mp3": "mp3",
                "audio/ogg": "ogg",
                "audio/wav": "wav",
                "audio/x-wav": "wav",
                "audio/mp4": "m4a",
                "audio/x-m4a": "m4a",
                "audio/aac": "aac",
                "audio/webm": "webm",
                "audio/flac": "flac",
                "audio/x-flac": "flac"
            };
            var supportedExtensions = ["mp3", "ogg", "wav", "m4a", "mp4", "aac", "webm", "flac"];
            var mimeByExtension = {
                mp3: "audio/mpeg",
                ogg: "audio/ogg",
                wav: "audio/wav",
                m4a: "audio/mp4",
                mp4: "audio/mp4",
                aac: "audio/aac",
                webm: "audio/webm",
                flac: "audio/flac"
            };

            try {
                var nameExtension = (file.name.split(".").pop() || "").toLowerCase();
                var extension = supportedTypes[file.type] || (supportedExtensions.indexOf(nameExtension) !== -1 ? nameExtension : "");
                if (!extension) {
                    throw new Error("Choose an MP3, OGG, WAV, M4A, AAC, WebM, or FLAC file for profile music.");
                }

                if (file.size > 50 * 1024 * 1024) {
                    throw new Error("Profile music must be 50 MB or smaller.");
                }

                var previousPath = (currentProfile && currentProfile.profile_music_path) || "";
                var filePath = currentUser.id + "/music." + extension;
                window.HollowsideAuth.setStatus(status, "Uploading your profile music...", "info");
                var uploadResult = await supabase.storage
                    .from("profile-customization")
                    .upload(filePath, file, {
                        upsert: true,
                        cacheControl: "3600",
                        contentType: file.type || mimeByExtension[extension]
                    });

                if (uploadResult.error) {
                    throw uploadResult.error;
                }

                var publicUrl = supabase.storage
                    .from("profile-customization")
                    .getPublicUrl(filePath).data.publicUrl + "?v=" + Date.now();

                await updateCurrentProfile({
                    profile_music_url: publicUrl,
                    profile_music_path: filePath
                }, "Profile music updated.");

                if (previousPath && previousPath !== filePath) {
                    await removeCustomizationAsset(previousPath);
                }
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while uploading your profile music.",
                    "error"
                );
            } finally {
                musicInput.value = "";
            }
        })(musicInput.files[0]);
    });

    musicRemove.addEventListener("click", async function () {
        if (!currentUser || !currentProfile) {
            return;
        }

        try {
            var previousPath = currentProfile.profile_music_path || "";
            await updateCurrentProfile({
                profile_music_url: "",
                profile_music_path: ""
            }, "Profile music removed.");
            await removeCustomizationAsset(previousPath);
        } catch (error) {
            window.HollowsideAuth.setStatus(status, error && error.message ? error.message : "The profile music could not be removed.", "error");
        }
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

        var usernameResult = window.HollowsideAuth.validateUsername(usernameInput.value);
        var username = usernameResult.username;
        var displayName = displayNameInput.value.trim() || username || "Hollowside Member";
        var bio = bioInput.value.trim();
        var websiteUrl = websiteInput.value.trim();
        var locationValue = locationInput.value.trim();
        var backgroundBlur = Math.max(0, Math.min(30, Number(backgroundBlurInput.value) || 0));
        var profileTheme = getSelectedProfileTheme();
        var profileThemeSecondary = getSelectedSecondaryTheme();

        if (!usernameResult.ok) {
            window.HollowsideAuth.setStatus(status, usernameResult.message, "error");
            usernameInput.focus();
            return;
        }

        usernameInput.value = username;

        try {
            window.HollowsideAuth.setBusy(profileForm, true);

            var updateResult = await supabase
                .from("profiles")
                .update({
                    username: username,
                    display_name: displayName,
                    bio: bio,
                    website_url: websiteUrl,
                    location: locationValue,
                    profile_background_blur: backgroundBlur,
                    profile_theme: profileTheme,
                    profile_theme_secondary: profileThemeSecondary
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

    twoFactorRequestForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser) {
            return;
        }

        var requestedEmail = twoFactorEmailInput.value.trim();
        if (!requestedEmail) {
            window.HollowsideAuth.setStatus(status, "Enter the email address that should receive security codes.", "error");
            twoFactorEmailInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(twoFactorRequestForm, true);
            var response = await supabase.functions.invoke("start-account-2fa", {
                body: {
                    email: requestedEmail
                }
            });

            if (response.error) {
                throw response.error;
            }

            if (response.data && response.data.error) {
                throw new Error(response.data.error);
            }

            twoFactorVerifyForm.setAttribute("data-2fa-challenge-id", response.data.challengeId);
            window.HollowsideAuth.setStatus(
                status,
                "Check that email" + (response.data.contactHint ? " (" + response.data.contactHint + ")" : "") + " for the 6-digit Hollowside security code. It expires in 15 minutes.",
                "info"
            );
            twoFactorCodeInput.focus();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while sending the security code.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(twoFactorRequestForm, false);
        }
    });

    twoFactorVerifyForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser) {
            return;
        }

        var code = twoFactorCodeInput.value.trim();
        var challengeId = twoFactorVerifyForm.getAttribute("data-2fa-challenge-id") || "";

        if (!/^[0-9]{6}$/.test(code)) {
            window.HollowsideAuth.setStatus(status, "Enter the 6-digit code from your email.", "error");
            twoFactorCodeInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(twoFactorVerifyForm, true);

            var response = await supabase.functions.invoke("verify-account-2fa", {
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

            var profileResult = await window.HollowsideAuth.loadProfile(supabase, currentUser.id);
            if (profileResult.error) {
                throw profileResult.error;
            }

            currentProfile = profileResult.data;
            await refreshAccountContext();
            fillForm(currentUser, currentProfile);
            openAccountDialog(
                "2FA Activated",
                "Activating 2FA was a success. Your account now has Trusted Member security. This browser will follow the device trust choice you selected.",
                "Great!"
            );
            window.HollowsideAuth.setStatus(status, "2FA activated successfully.", "success");
            twoFactorCodeInput.value = "";
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "That code could not be verified.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(twoFactorVerifyForm, false);
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

    renderSecondaryThemePresets();
    loadAccount();
});
