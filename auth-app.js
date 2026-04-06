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

    window.HollowsideAuth = {
        readConfig: readConfig,
        isConfigured: isConfigured,
        createClient: createClient,
        clearStoredSession: clearStoredSession,
        setStatus: setStatus,
        setBusy: setBusy,
        socialComingSoon: socialComingSoon
    };
})();
