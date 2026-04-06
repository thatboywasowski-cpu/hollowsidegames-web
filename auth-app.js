(function () {
    function readConfig() {
        return {
            url: window.HOLLOWSIDE_SUPABASE_URL || "",
            anonKey: window.HOLLOWSIDE_SUPABASE_ANON_KEY || "",
            storageKey: window.HOLLOWSIDE_SUPABASE_STORAGE_KEY || "hollowside-auth"
        };
    }

    function isConfigured() {
        var config = readConfig();
        return (
            config.url &&
            config.anonKey &&
            !config.url.includes("PASTE_YOUR_SUPABASE_PROJECT_URL_HERE") &&
            !config.anonKey.includes("PASTE_YOUR_SUPABASE_ANON_KEY_HERE")
        );
    }

    function pickStorage(rememberMe) {
        var config = readConfig();
        if (rememberMe === true) {
            return window.localStorage;
        }

        if (rememberMe === false) {
            return window.sessionStorage;
        }

        if (window.localStorage.getItem(config.storageKey)) {
            return window.localStorage;
        }

        if (window.sessionStorage.getItem(config.storageKey)) {
            return window.sessionStorage;
        }

        return window.localStorage;
    }

    function createClient(options) {
        var config = readConfig();
        var rememberMe = options && Object.prototype.hasOwnProperty.call(options, "rememberMe")
            ? options.rememberMe
            : undefined;

        if (!window.supabase || !window.supabase.createClient) {
            throw new Error("Supabase client library is not loaded.");
        }

        if (!isConfigured()) {
            throw new Error("Supabase config is missing. Add your project URL and anon key in /supabase-config.js.");
        }

        return window.supabase.createClient(config.url, config.anonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: config.storageKey,
                storage: pickStorage(rememberMe)
            }
        });
    }

    function clearStoredSession() {
        var config = readConfig();
        window.localStorage.removeItem(config.storageKey);
        window.sessionStorage.removeItem(config.storageKey);
    }

    function setStatus(target, message, state) {
        if (!target) {
            return;
        }

        if (!message) {
            target.hidden = true;
            target.textContent = "";
            target.removeAttribute("data-state");
            return;
        }

        target.hidden = false;
        target.textContent = message;
        target.setAttribute("data-state", state || "info");
    }

    function setBusy(target, busy) {
        if (!target) {
            return;
        }

        if (busy) {
            target.classList.add("is-busy");
        } else {
            target.classList.remove("is-busy");
        }
    }

    function socialComingSoon(statusTarget) {
        setStatus(statusTarget, "Google and Apple sign-in will be connected after those providers are set up in Supabase.", "info");
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function sanitizeUsername(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_.]/g, "")
            .replace(/^\.+|\.+$/g, "")
            .slice(0, 24);
    }

    function fallbackUsername(user) {
        var metadata = (user && user.user_metadata) || {};
        var base = sanitizeUsername(
            metadata.username ||
            metadata.display_name ||
            metadata.name ||
            (user && user.email ? user.email.split("@")[0] : "") ||
            "member"
        );

        if (base.length < 3) {
            base = "member" + String(Date.now()).slice(-4);
        }

        return base;
    }

    function fallbackDisplayName(user) {
        var metadata = (user && user.user_metadata) || {};
        return (
            metadata.display_name ||
            metadata.full_name ||
            metadata.name ||
            metadata.username ||
            (user && user.email ? user.email.split("@")[0] : "") ||
            "Hollowside Member"
        );
    }

    function createAccountId() {
        var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var result = "hsg_";

        if (window.crypto && window.crypto.getRandomValues) {
            var buffer = new Uint8Array(10);
            window.crypto.getRandomValues(buffer);
            for (var index = 0; index < buffer.length; index += 1) {
                result += alphabet[buffer[index] % alphabet.length];
            }
            return result;
        }

        for (var fallbackIndex = 0; fallbackIndex < 10; fallbackIndex += 1) {
            result += alphabet[Math.floor(Math.random() * alphabet.length)];
        }

        return result;
    }

    async function loadProfile(client, userId) {
        if (!client || !userId) {
            return { data: null, error: new Error("Missing client or user id.") };
        }

        return client
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .maybeSingle();
    }

    async function ensureProfile(client, user) {
        if (!client || !user) {
            return { data: null, error: new Error("Missing client or user.") };
        }

        var profileResult = await loadProfile(client, user.id);

        if (profileResult.error && profileResult.error.code !== "PGRST116") {
            return profileResult;
        }

        if (profileResult.data) {
            return profileResult;
        }

        var usernameBase = fallbackUsername(user);
        var displayName = fallbackDisplayName(user);
        var lastError = null;

        for (var attempt = 0; attempt < 5; attempt += 1) {
            var username = attempt === 0 ? usernameBase : (usernameBase + "_" + attempt).slice(0, 24);
            if (username.length < 3) {
                username = ("member_" + attempt + String(Date.now()).slice(-4)).slice(0, 24);
            }

            var insertResult = await client
                .from("profiles")
                .insert({
                    id: user.id,
                username: username,
                display_name: displayName,
                bio: "",
                account_id: createAccountId(),
                role_label: "Member",
                website_url: "",
                location: "",
                avatar_url: "",
                avatar_path: ""
            })
            .select("*")
            .single();

            if (!insertResult.error) {
                return insertResult;
            }

            lastError = insertResult.error;
            if (lastError.code !== "23505") {
                return insertResult;
            }
        }

        return { data: null, error: lastError || new Error("Unable to create profile.") };
    }

    function getInitials(profile, user) {
        var source =
            (profile && (profile.display_name || profile.username)) ||
            ((user && user.email) ? user.email.split("@")[0] : "") ||
            "H";

        var pieces = String(source).trim().split(/\s+/).filter(Boolean);
        if (pieces.length === 0) {
            return "H";
        }

        if (pieces.length === 1) {
            return pieces[0].slice(0, 2).toUpperCase();
        }

        return (pieces[0][0] + pieces[1][0]).toUpperCase();
    }

    function formatCompactCount(value) {
        var count = Number(value || 0);

        if (count >= 1000000) {
            return (Math.floor((count / 100000)) / 10).toFixed(1).replace(/\.0$/, "") + "M+";
        }

        if (count >= 1000) {
            return (Math.floor((count / 100)) / 10).toFixed(1).replace(/\.0$/, "") + "K+";
        }

        return String(count);
    }

    function formatCountLabel(value, singular, plural) {
        var label = Number(value || 0) === 1 ? singular : plural;
        return formatCompactCount(value) + " " + label;
    }

    function getVerificationBadge(record, ariaLabel) {
        if (!record || !record.is_verified) {
            return "";
        }

        var mode = escapeHtml(record.verification_mode || "manual");
        var label = escapeHtml(ariaLabel || "Verified account");

        return (
            '<span class="verification-badge" data-mode="' + mode + '" title="' + label + '" aria-label="' + label + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
                    '<path d="M9.55 16.2 5.7 12.35l1.4-1.4 2.45 2.45 7.35-7.35 1.4 1.4z"></path>' +
                "</svg>" +
            "</span>"
        );
    }

    async function touchActivity(client) {
        if (!client) {
            return;
        }

        try {
            await client.rpc("touch_my_activity");
        } catch (error) {
            return;
        }
    }

    window.HollowsideAuth = {
        readConfig: readConfig,
        isConfigured: isConfigured,
        createClient: createClient,
        clearStoredSession: clearStoredSession,
        setStatus: setStatus,
        setBusy: setBusy,
        socialComingSoon: socialComingSoon,
        sanitizeUsername: sanitizeUsername,
        fallbackUsername: fallbackUsername,
        fallbackDisplayName: fallbackDisplayName,
        loadProfile: loadProfile,
        ensureProfile: ensureProfile,
        getInitials: getInitials,
        escapeHtml: escapeHtml,
        formatCompactCount: formatCompactCount,
        formatCountLabel: formatCountLabel,
        getVerificationBadge: getVerificationBadge,
        touchActivity: touchActivity
    };
})();
