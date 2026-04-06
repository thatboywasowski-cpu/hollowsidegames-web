document.addEventListener("DOMContentLoaded", function () {
    if (!window.HollowsideAuth || !window.HollowsideAuth.isConfigured()) {
        return;
    }

    var nav = document.querySelector(".nav-links");
    if (!nav) {
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

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getMenuLink(label, href, kicker) {
        return (
            '<a class="nav-menu-link" href="' + href + '">' +
                '<span>' + escapeHtml(label) + '</span>' +
                '<span class="nav-menu-kicker">' + escapeHtml(kicker) + '</span>' +
            '</a>'
        );
    }

    function buildAvatarMarkup(profile, user) {
        var avatarUrl = profile && profile.avatar_url ? profile.avatar_url : "";
        var initials = window.HollowsideAuth.getInitials(profile, user);

        if (avatarUrl) {
            return '<span class="nav-avatar"><img src="' + escapeHtml(avatarUrl) + '" alt="Profile picture"></span>';
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
        removeAccountShell();
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
    }

    async function renderUserState(user, profile, adminContext) {
        guestLinks.forEach(function (link) {
            link.classList.add("is-hidden");
        });

        removeAccountShell();

        var canOpenRoleTools = adminContext && (
            adminContext.can_manage_roles ||
            adminContext.can_manage_role_permissions ||
            adminContext.can_manage_account_permissions
        );

        var shell = document.createElement("div");
        var displayName = escapeHtml(getDisplayName(profile, user));
        var handle = escapeHtml(getHandle(profile, user));
        var roleLabel = escapeHtml((profile && profile.role_label) || "Member");

        shell.className = "nav-account-shell";
        shell.innerHTML =
            '<button class="nav-account-button" type="button" data-account-menu-button aria-expanded="false" aria-haspopup="true">' +
                buildAvatarMarkup(profile, user) +
                '<span class="nav-account-copy">' +
                    "<strong>" + displayName + "</strong>" +
                    "<span>" + handle + "</span>" +
                "</span>" +
            "</button>" +
            '<div class="nav-account-menu" data-account-menu hidden>' +
                '<div class="nav-menu-profile">' +
                    "<strong>" + displayName + "</strong>" +
                    "<span>" + handle + "</span>" +
                    '<span class="nav-menu-role">' + roleLabel + "</span>" +
                "</div>" +
                '<div class="nav-menu-actions">' +
                    getMenuLink("Browse members", "/directory", "search") +
                    getMenuLink("Account settings", "/account", "profile") +
                    getMenuLink("Notifications", "/account#future", "soon") +
                    getMenuLink("Following", "/account#future", "soon") +
                    (canOpenRoleTools ? getMenuLink("Role tools", "/admin/roles", "staff") : "") +
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
        var userResult = await supabase.auth.getUser();
        var user = userResult && userResult.data ? userResult.data.user : null;

        if (!user) {
            showGuestState();
            return;
        }

        var profile = null;

        try {
            var ensured = await window.HollowsideAuth.ensureProfile(supabase, user);
            if (ensured && !ensured.error) {
                profile = ensured.data;
            }
        } catch (error) {
            profile = null;
        }

        var adminContext = null;

        try {
            var contextResponse = await supabase.rpc("get_my_role_context");
            if (contextResponse.data && contextResponse.data[0]) {
                adminContext = contextResponse.data[0];
            }
        } catch (error) {
            adminContext = null;
        }

        await renderUserState(user, profile, adminContext);
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
