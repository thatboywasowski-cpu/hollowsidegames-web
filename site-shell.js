document.addEventListener("DOMContentLoaded", function () {
    var nav = document.querySelector(".nav-links");
    if (!nav) {
        return;
    }

    function ensureDownloadsNavLink() {
        if (nav.querySelector('a[href="/downloads"]')) {
            return;
        }

        var link = document.createElement("a");
        link.className = "nav-link";
        link.href = "/downloads";
        link.textContent = "Downloads";

        var aboutLink = nav.querySelector('a[href="/about"]');
        if (aboutLink) {
            nav.insertBefore(link, aboutLink);
        } else {
            nav.appendChild(link);
        }
    }

    function syncActiveNavLink() {
        var currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
        nav.querySelectorAll(".nav-link").forEach(function (link) {
            var href = link.getAttribute("href");
            var normalizedHref = href && href !== "/" ? href.replace(/\/+$/, "") : "/";
            var active = normalizedHref === "/"
                ? currentPath === "/"
                : currentPath === normalizedHref || currentPath.indexOf(normalizedHref + "/") === 0;

            link.classList.toggle("is-current", active);
        });
    }

    function setGuestOnlyVisibility(isGuest) {
        document.querySelectorAll("[data-guest-only]").forEach(function (element) {
            element.hidden = !isGuest;
        });
    }

    ensureDownloadsNavLink();
    syncActiveNavLink();

    if (!window.HollowsideAuth || !window.HollowsideAuth.isConfigured()) {
        return;
    }

    var guestLinks = [
        nav.querySelector('a[href="/login"]'),
        nav.querySelector('a[href="/signup"]')
    ].filter(Boolean);

    var supabase;

    try {
        supabase = window.HollowsideAuth.createClient();
    } catch (error) {
        return;
    }

    var hasTouchedActivity = false;

    function getMenuLink(label, href, kicker) {
        return (
            '<a class="nav-menu-link" href="' + href + '">' +
                '<span>' + window.HollowsideAuth.escapeHtml(label) + '</span>' +
                '<span class="nav-menu-kicker">' + window.HollowsideAuth.escapeHtml(kicker) + '</span>' +
            '</a>'
        );
    }

    function buildAvatarMarkup(profile, user) {
        var avatarUrl = profile && profile.avatar_url ? profile.avatar_url : "";
        var initials = window.HollowsideAuth.getInitials(profile, user);

        if (avatarUrl) {
            return '<span class="nav-avatar"><img src="' + window.HollowsideAuth.escapeHtml(avatarUrl) + '" alt="Profile picture"></span>';
        }

        return '<span class="nav-avatar">' + initials + "</span>";
    }

    function getDisplayName(profile, user) {
        return (
            (profile && profile.display_name) ||
            window.HollowsideAuth.fallbackDisplayName(user)
        );
    }

    function getHandle(profile, user) {
        if (profile && profile.username) {
            return "@" + profile.username;
        }

        return user && user.email ? user.email : "@member";
    }

    function removeAccountShell() {
        var existing = nav.querySelector(".nav-account-shell");
        if (existing) {
            existing.remove();
        }
    }

    function showGuestState() {
        guestLinks.forEach(function (link) {
            link.classList.remove("is-hidden");
        });
        setGuestOnlyVisibility(true);
        removeAccountShell();
        var emulationBar = document.querySelector("[data-disable-role-emulation-bar]");
        if (emulationBar) {
            emulationBar.remove();
        }
    }

    function closeMenu() {
        var button = nav.querySelector("[data-account-menu-button]");
        var menu = nav.querySelector("[data-account-menu]");
        if (!button || !menu) {
            return;
        }

        button.setAttribute("aria-expanded", "false");
        menu.hidden = true;
    }

    function openMenu() {
        var button = nav.querySelector("[data-account-menu-button]");
        var menu = nav.querySelector("[data-account-menu]");
        if (!button || !menu) {
            return;
        }

        button.setAttribute("aria-expanded", "true");
        menu.hidden = false;
    }

    function enforceRestrictedAccess(accountContext) {
        if (!accountContext || !accountContext.is_banned) {
            return;
        }

        var allowedPrefixes = [
            "/news",
            "/downloads",
            "/account",
            "/login",
            "/signup",
            "/reset-password"
        ];
        var currentPath = window.location.pathname;
        var allowed = allowedPrefixes.some(function (prefix) {
            return currentPath === prefix || currentPath.indexOf(prefix + "/") === 0;
        });

        if (!allowed) {
            window.location.href = "/news?access=restricted";
        }
    }

    async function handleSignOut() {
        try {
            await supabase.auth.signOut();
        } finally {
            showGuestState();
            if (window.location.pathname === "/account") {
                window.location.href = "/";
            }
        }
    }

    function wireMenuEvents() {
        var button = nav.querySelector("[data-account-menu-button]");
        var menu = nav.querySelector("[data-account-menu]");
        var signOut = nav.querySelector("[data-nav-signout]");

        if (!button || !menu || !signOut) {
            return;
        }

        button.addEventListener("click", function () {
            if (menu.hidden) {
                openMenu();
            } else {
                closeMenu();
            }
        });

        signOut.addEventListener("click", function () {
            handleSignOut();
        });

        menu.addEventListener("click", function (event) {
            var emulationButton = event.target.closest("[data-role-emulation]");
            var disableButton = event.target.closest("[data-disable-role-emulation]");

            if (emulationButton) {
                window.HollowsideAuth.setRoleEmulation(emulationButton.getAttribute("data-role-emulation"));
                window.location.reload();
                return;
            }

            if (disableButton) {
                window.HollowsideAuth.setRoleEmulation("");
                window.location.reload();
            }
        });
    }

    function renderRoleEmulationPanel(canUseRoleEmulation) {
        var active = window.HollowsideAuth.getRoleEmulation();
        if (!canUseRoleEmulation && !active) {
            return "";
        }

        return (
            '<div class="nav-role-emulation">' +
                '<span class="nav-menu-kicker">Role Emulation</span>' +
                '<div class="nav-role-grid">' +
                    window.HollowsideAuth.emulationRoles.map(function (role) {
                        return (
                            '<button class="nav-role-option' + (active && active.key === role.key ? " is-active" : "") + '" type="button" data-role-emulation="' + role.key + '">' +
                                window.HollowsideAuth.escapeHtml(role.label) +
                            "</button>"
                        );
                    }).join("") +
                "</div>" +
            "</div>"
        );
    }

    function renderEmulationDisableButton(accountContext) {
        if (!accountContext || !accountContext.is_role_emulated) {
            var existing = document.querySelector("[data-disable-role-emulation-bar]");
            if (existing) {
                existing.remove();
            }
            return;
        }

        var bar = document.querySelector("[data-disable-role-emulation-bar]");
        if (!bar) {
            bar = document.createElement("div");
            bar.className = "role-emulation-bar";
            bar.setAttribute("data-disable-role-emulation-bar", "");
            bar.innerHTML = '<button class="account-button primary" type="button" data-disable-role-emulation>Disable Role Emulation</button>';
            document.body.appendChild(bar);
            bar.querySelector("button").addEventListener("click", function () {
                window.HollowsideAuth.setRoleEmulation("");
                window.location.reload();
            });
        }
    }

    async function renderUserState(user, profile, accountContext, realAccountContext) {
        guestLinks.forEach(function (link) {
            link.classList.add("is-hidden");
        });
        setGuestOnlyVisibility(false);

        removeAccountShell();
        enforceRestrictedAccess(accountContext);
        renderEmulationDisableButton(accountContext);

        var canOpenRoleTools = accountContext && (
            accountContext.can_manage_roles ||
            accountContext.can_manage_role_permissions ||
            accountContext.can_manage_account_permissions
        );
        var canUseRoleEmulation = realAccountContext && (
            realAccountContext.can_manage_roles ||
            realAccountContext.can_manage_role_permissions ||
            realAccountContext.effective_role_key === "owner" ||
            realAccountContext.effective_role_key === "co_owner"
        );
        var canOpenModeration = accountContext && accountContext.can_access_moderation;
        var publicProfileHref = profile && profile.account_id
            ? "/profile?id=" + encodeURIComponent(profile.account_id)
            : "/account";
        var notificationKicker = accountContext && Number(accountContext.unread_notification_count || 0) > 0
            ? String(accountContext.unread_notification_count) + " new"
            : "inbox";
        var restrictionCopy = accountContext && accountContext.restriction_label
            ? '<span class="nav-menu-role">' + window.HollowsideAuth.escapeHtml(accountContext.restriction_label) + '</span>'
            : "";
        var banned = accountContext && accountContext.is_banned;

        var shell = document.createElement("div");
        var displayName = window.HollowsideAuth.escapeHtml(getDisplayName(profile, user));
        var handle = window.HollowsideAuth.escapeHtml(getHandle(profile, user));
        var roleLabel = window.HollowsideAuth.escapeHtml((profile && profile.role_label) || "Member");
        var verifiedBadge = window.HollowsideAuth.getVerificationBadge(accountContext || profile, "Verified Hollowside account");
        var menuLinks = [
            getMenuLink("Account settings", "/account", "profile"),
            getMenuLink("Notifications", "/account#notifications", notificationKicker),
            getMenuLink("Safety", "/account#safety", "blocks")
        ];

        if (!banned) {
            menuLinks.unshift(getMenuLink("View full profile", publicProfileHref, "public"));
            menuLinks.splice(1, 0, getMenuLink("Browse members", "/directory", "search"));
            menuLinks.splice(2, 0, getMenuLink("Downloads", "/downloads", window.HollowsideAuth.canPublishDownloads(accountContext) ? "upload" : "browse"));
        }

        if (canOpenModeration) {
            menuLinks.push(getMenuLink("Moderation", "/account#moderation", "staff"));
        }

        if (canOpenRoleTools) {
            menuLinks.push(getMenuLink("Role tools", "/admin/roles", "staff"));
        }

        shell.className = "nav-account-shell";
        shell.innerHTML =
            '<button class="nav-account-button" type="button" data-account-menu-button aria-expanded="false" aria-haspopup="true">' +
                buildAvatarMarkup(profile, user) +
                '<span class="nav-account-copy">' +
                    "<strong>" + displayName + "</strong>" +
                    '<span class="nav-account-handle">' + handle + verifiedBadge + "</span>" +
                "</span>" +
            "</button>" +
            '<div class="nav-account-menu" data-account-menu hidden>' +
                '<div class="nav-menu-profile">' +
                    "<strong>" + displayName + "</strong>" +
                    '<span class="nav-account-handle">' + handle + verifiedBadge + "</span>" +
                    '<span class="nav-menu-role">' + roleLabel + "</span>" +
                    restrictionCopy +
                "</div>" +
                '<div class="nav-menu-actions">' +
                    menuLinks.join("") +
                    renderRoleEmulationPanel(canUseRoleEmulation) +
                    '<button class="nav-menu-button" type="button" data-nav-signout>' +
                        "<span>Sign out</span>" +
                        '<span class="nav-menu-kicker">leave</span>' +
                    "</button>" +
                "</div>" +
            "</div>";

        nav.appendChild(shell);
        wireMenuEvents();
    }

    async function refreshSessionUi() {
        var sessionResult = await supabase.auth.getSession();
        var session = sessionResult && sessionResult.data ? sessionResult.data.session : null;

        if (session) {
            var refreshed = await supabase.auth.refreshSession().catch(function () {
                return null;
            });
            if (refreshed && refreshed.data && refreshed.data.session) {
                session = refreshed.data.session;
            }
        }

        var user = session && session.user ? session.user : null;

        if (!user) {
            var userResult = await supabase.auth.getUser().catch(function () {
                return null;
            });
            user = userResult && userResult.data ? userResult.data.user : null;
        }

        if (!user) {
            showGuestState();
            return;
        }

        var profile = null;
        var accountContext = null;
        var realAccountContext = null;

        try {
            var ensured = await window.HollowsideAuth.ensureProfile(supabase, user);
            if (ensured && !ensured.error) {
                profile = ensured.data;
            }
        } catch (error) {
            profile = null;
        }

        try {
            var contextResponse = await supabase.rpc("get_my_account_context");
            if (contextResponse.data && contextResponse.data[0]) {
                realAccountContext = contextResponse.data[0];
                accountContext = window.HollowsideAuth.applyRoleEmulation(realAccountContext, profile);
            }
        } catch (error) {
            accountContext = null;
        }

        if (!hasTouchedActivity) {
            hasTouchedActivity = true;
            window.HollowsideAuth.touchActivity(supabase);
        }

        await renderUserState(user, profile, accountContext, realAccountContext);
    }

    document.addEventListener("click", function (event) {
        var shell = nav.querySelector(".nav-account-shell");
        if (!shell || shell.contains(event.target)) {
            return;
        }

        closeMenu();
    });

    window.addEventListener("hollowside-profile-updated", function () {
        refreshSessionUi();
    });

    supabase.auth.onAuthStateChange(function () {
        window.setTimeout(refreshSessionUi, 0);
    });

    refreshSessionUi();
});
