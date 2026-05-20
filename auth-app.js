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
            .replace(/[^a-z0-9_]/g, "")
            .slice(0, 20);
    }

    function validateUsername(value) {
        var raw = String(value || "");
        var normalized = raw.trim().toLowerCase();
        var underscoreMatches = normalized.match(/_/g) || [];

        if (/\s/.test(raw)) {
            return {
                ok: false,
                username: normalized,
                message: "Usernames cannot contain spaces."
            };
        }

        if (!/^[a-z0-9_]+$/.test(normalized)) {
            return {
                ok: false,
                username: normalized,
                message: "Usernames can only use letters, numbers, and one underscore."
            };
        }

        if (underscoreMatches.length > 1) {
            return {
                ok: false,
                username: normalized,
                message: "Usernames can only contain one underscore."
            };
        }

        if (normalized.length < 3 || normalized.length > 20) {
            return {
                ok: false,
                username: normalized,
                message: "Usernames must be between 3 and 20 characters."
            };
        }

        if (/^[0-9]+$/.test(normalized)) {
            return {
                ok: false,
                username: normalized,
                message: "Usernames cannot be all numbers."
            };
        }

        return {
            ok: true,
            username: normalized,
            message: ""
        };
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
            var username = attempt === 0 ? usernameBase : (usernameBase.replace(/_/g, "") + "_" + attempt).slice(0, 20);
            if (username.length < 3) {
                username = ("member_" + attempt + String(Date.now()).slice(-4)).slice(0, 20);
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

    var roleEmulationKey = "hollowside-role-emulation";
    var emulationRoles = [
        { key: "owner", label: "Owner" },
        { key: "co_owner", label: "Co-Owner" },
        { key: "developer", label: "Developer" },
        { key: "head_moderator", label: "Head Moderator" },
        { key: "moderator", label: "Moderator" },
        { key: "trusted_member", label: "Trusted Member" },
        { key: "member", label: "Member" }
    ];

    function getRoleByKey(roleKey) {
        return emulationRoles.find(function (role) {
            return role.key === roleKey;
        }) || null;
    }

    function getRoleEmulation() {
        try {
            return getRoleByKey(window.localStorage.getItem(roleEmulationKey) || "");
        } catch (error) {
            return null;
        }
    }

    function setRoleEmulation(roleKey) {
        try {
            if (roleKey && getRoleByKey(roleKey)) {
                window.localStorage.setItem(roleEmulationKey, roleKey);
            } else {
                window.localStorage.removeItem(roleEmulationKey);
            }
        } catch (error) {
            return;
        }
    }

    function applyRoleEmulation(accountContext, profile) {
        var emulatedRole = getRoleEmulation();
        if (!emulatedRole) {
            return accountContext;
        }

        var context = Object.assign({}, accountContext || {});
        var roleKey = emulatedRole.key;
        var isOwner = roleKey === "owner";
        var isCoOwner = roleKey === "co_owner";
        var isDeveloper = roleKey === "developer";
        var isHeadModerator = roleKey === "head_moderator";
        var isModerator = roleKey === "moderator";
        var isTrusted = roleKey === "trusted_member";
        var canModerateContent = isOwner || isCoOwner || isHeadModerator || isModerator;

        context.role_label = emulatedRole.label;
        context.effective_role_key = roleKey;
        context.can_manage_roles = isOwner || isCoOwner;
        context.can_manage_role_permissions = isOwner || isCoOwner;
        context.can_manage_account_permissions = isOwner || isCoOwner;
        context.can_verify_accounts = isOwner || isCoOwner;
        context.can_publish_news = isOwner || isCoOwner || isDeveloper;
        context.can_publish_personal_posts = roleKey !== "member";
        context.can_comment_posts = roleKey !== "member" || isTrusted;
        context.can_manage_reports = canModerateContent;
        context.can_issue_warnings = canModerateContent;
        context.can_suspend_accounts = canModerateContent;
        context.can_ban_accounts = isOwner || isCoOwner || isHeadModerator;
        context.can_access_moderation = canModerateContent;
        context.can_moderate_content = canModerateContent;
        context.can_moderate_news = isOwner || isCoOwner;
        context.can_publish_downloads = isOwner || isCoOwner || isDeveloper;
        context.is_role_emulated = true;
        context.emulated_role_key = roleKey;
        context.emulated_role_label = emulatedRole.label;

        if (profile) {
            profile.role_label = emulatedRole.label;
            profile.role_key = roleKey;
        }

        return context;
    }

    function getVerificationBadge(record, ariaLabel) {
        if (!record || !record.is_verified) {
            return "";
        }

        var mode = escapeHtml(record.verification_mode || "manual");
        var label = escapeHtml(ariaLabel || "Verified account");

        return (
            '<span class="verification-badge" data-mode="' + mode + '" title="' + label + '" aria-label="' + label + '">' +
                '<img src="/Hollowside%20Games%20website%20verification.png" alt="">' +
            "</span>"
        );
    }

    function ensureFavicon() {
        if (document.querySelector('link[rel~="icon"]')) {
            return;
        }

        var link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/png";
        link.href = "/Hollowside%20Games%20logo.png";
        document.head.appendChild(link);
    }

    function getImageDimensions(file) {
        return new Promise(function (resolve, reject) {
            var image = new Image();
            var url = URL.createObjectURL(file);

            image.onload = function () {
                resolve({
                    image: image,
                    url: url,
                    width: image.naturalWidth,
                    height: image.naturalHeight
                });
            };

            image.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error("That image could not be loaded."));
            };

            image.src = url;
        });
    }

    function editImageFile(file, options) {
        var settings = options || {};
        var shape = settings.shape === "circle" ? "circle" : "rect";
        var outputWidth = settings.outputWidth || (shape === "circle" ? 512 : 1280);
        var outputHeight = settings.outputHeight || (shape === "circle" ? 512 : 800);
        var title = settings.title || "Transform your profile picture to your liking.";

        return new Promise(function (resolve, reject) {
            getImageDimensions(file).then(function (loaded) {
                var image = loaded.image;
                var objectUrl = loaded.url;
                var backdrop = document.createElement("div");
                var scale = Math.max(outputWidth / loaded.width, outputHeight / loaded.height);
                var userScale = 1;
                var offsetX = 0;
                var offsetY = 0;
                var dragging = false;
                var lastX = 0;
                var lastY = 0;
                var lastStageRect = null;

                backdrop.className = "media-editor-backdrop";
                backdrop.innerHTML =
                    '<section class="media-editor-card" role="dialog" aria-modal="true">' +
                        "<h3>" + escapeHtml(title) + "</h3>" +
                        "<p>Drag the image to reposition it, then use the slider to resize it.</p>" +
                        '<div class="media-editor-stage" data-shape="' + shape + '">' +
                            '<img alt="Image preview">' +
                        "</div>" +
                        '<div class="media-editor-controls">' +
                            '<label>Resize <input type="range" min="1" max="3" step="0.01" value="1"></label>' +
                            '<div class="account-actions">' +
                                '<button class="account-button" type="button" data-media-cancel>Cancel</button>' +
                                '<button class="account-button primary" type="button" data-media-confirm>Confirm</button>' +
                            "</div>" +
                        "</div>" +
                    "</section>";

                var stage = backdrop.querySelector(".media-editor-stage");
                var preview = backdrop.querySelector("img");
                var range = backdrop.querySelector('input[type="range"]');
                var cancel = backdrop.querySelector("[data-media-cancel]");
                var confirm = backdrop.querySelector("[data-media-confirm]");
                preview.src = objectUrl;

                function drawPreview() {
                    var stageRect = stage.getBoundingClientRect();
                    lastStageRect = stageRect;
                    var previewScale = Math.max(stageRect.width / loaded.width, stageRect.height / loaded.height) * userScale;
                    var previewWidth = loaded.width * previewScale;
                    var previewHeight = loaded.height * previewScale;
                    var maxOffsetX = Math.max(0, (previewWidth - stageRect.width) / 2);
                    var maxOffsetY = Math.max(0, (previewHeight - stageRect.height) / 2);
                    offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, offsetX));
                    offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, offsetY));
                    preview.style.width = previewWidth + "px";
                    preview.style.height = previewHeight + "px";
                    preview.style.transform = "translate(calc(-50% + " + offsetX + "px), calc(-50% + " + offsetY + "px))";
                }

                function cleanup(value) {
                    URL.revokeObjectURL(objectUrl);
                    backdrop.remove();
                    resolve(value);
                }

                stage.addEventListener("pointerdown", function (event) {
                    dragging = true;
                    lastX = event.clientX;
                    lastY = event.clientY;
                    stage.setPointerCapture(event.pointerId);
                });

                stage.addEventListener("pointermove", function (event) {
                    if (!dragging) {
                        return;
                    }

                    offsetX += event.clientX - lastX;
                    offsetY += event.clientY - lastY;
                    lastX = event.clientX;
                    lastY = event.clientY;
                    drawPreview();
                });

                stage.addEventListener("pointerup", function () {
                    dragging = false;
                });

                range.addEventListener("input", function () {
                    userScale = Number(range.value || 1);
                    drawPreview();
                });

                cancel.addEventListener("click", function () {
                    cleanup(null);
                });

                confirm.addEventListener("click", function () {
                    var canvas = document.createElement("canvas");
                    var context = canvas.getContext("2d");
                    canvas.width = outputWidth;
                    canvas.height = outputHeight;

                    context.fillStyle = "#050505";
                    context.fillRect(0, 0, outputWidth, outputHeight);

                    var drawScale = scale * userScale;
                    var drawWidth = loaded.width * drawScale;
                    var drawHeight = loaded.height * drawScale;
                    var stageRect = lastStageRect || stage.getBoundingClientRect();
                    var maxCanvasOffsetX = Math.max(0, (drawWidth - outputWidth) / 2);
                    var maxCanvasOffsetY = Math.max(0, (drawHeight - outputHeight) / 2);
                    var normalizedOffsetX = stageRect.width ? offsetX / stageRect.width : 0;
                    var normalizedOffsetY = stageRect.height ? offsetY / stageRect.height : 0;
                    var canvasOffsetX = Math.max(-maxCanvasOffsetX, Math.min(maxCanvasOffsetX, normalizedOffsetX * outputWidth));
                    var canvasOffsetY = Math.max(-maxCanvasOffsetY, Math.min(maxCanvasOffsetY, normalizedOffsetY * outputHeight));
                    var drawX = (outputWidth - drawWidth) / 2 + canvasOffsetX;
                    var drawY = (outputHeight - drawHeight) / 2 + canvasOffsetY;

                    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
                    canvas.toBlob(function (blob) {
                        if (!blob) {
                            reject(new Error("The edited image could not be created."));
                            return;
                        }

                        cleanup(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", {
                            type: "image/png"
                        }));
                    }, "image/png", 0.92);
                });

                document.body.appendChild(backdrop);
                window.requestAnimationFrame(drawPreview);
            }).catch(reject);
        });
    }

    function openImageViewer(src, altText) {
        if (!src) {
            return;
        }

        var backdrop = document.createElement("div");
        var scale = 1;
        backdrop.className = "image-viewer-backdrop";
        backdrop.innerHTML =
            '<button class="image-viewer-close" type="button" aria-label="Close image">X</button>' +
            '<div class="image-viewer-frame">' +
                '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(altText || "Expanded image") + '">' +
            "</div>";

        var image = backdrop.querySelector("img");
        function syncScale() {
            image.style.transform = "scale(" + scale + ")";
        }

        backdrop.addEventListener("click", function (event) {
            if (event.target === backdrop || event.target.classList.contains("image-viewer-close")) {
                backdrop.remove();
            }
        });

        image.addEventListener("click", function (event) {
            event.stopPropagation();
            scale = scale >= 2.5 ? 1 : scale + 0.5;
            syncScale();
        });

        backdrop.addEventListener("wheel", function (event) {
            event.preventDefault();
            scale = Math.max(1, Math.min(4, scale + (event.deltaY < 0 ? 0.2 : -0.2)));
            syncScale();
        }, { passive: false });

        document.body.appendChild(backdrop);
        syncScale();
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

    function normalizeRedirectPath(path) {
        if (!path || typeof path !== "string") {
            return "/";
        }

        if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) {
            return "/";
        }

        if (path.charAt(0) !== "/") {
            return "/";
        }

        return path;
    }

    async function startOAuthSignIn(provider, options) {
        var statusTarget = options && options.statusTarget;
        var redirectPath = normalizeRedirectPath(options && options.redirectPath ? options.redirectPath : "/");

        try {
            var supabase = createClient({ rememberMe: true });
            var response = await supabase.auth.signInWithOAuth({
                provider: provider,
                options: {
                    redirectTo: window.location.origin + redirectPath
                }
            });

            if (response.error) {
                throw response.error;
            }
        } catch (error) {
            setStatus(
                statusTarget,
                error && error.message
                    ? error.message
                    : "That sign-in provider is not ready yet. Double-check that it is enabled in Supabase.",
                "error"
            );
        }
    }

    window.HollowsideAuth = {
        readConfig: readConfig,
        isConfigured: isConfigured,
        createClient: createClient,
        clearStoredSession: clearStoredSession,
        setStatus: setStatus,
        setBusy: setBusy,
        sanitizeUsername: sanitizeUsername,
        validateUsername: validateUsername,
        fallbackUsername: fallbackUsername,
        fallbackDisplayName: fallbackDisplayName,
        loadProfile: loadProfile,
        ensureProfile: ensureProfile,
        getInitials: getInitials,
        escapeHtml: escapeHtml,
        formatCompactCount: formatCompactCount,
        formatCountLabel: formatCountLabel,
        getRoleEmulation: getRoleEmulation,
        setRoleEmulation: setRoleEmulation,
        applyRoleEmulation: applyRoleEmulation,
        emulationRoles: emulationRoles,
        getVerificationBadge: getVerificationBadge,
        ensureFavicon: ensureFavicon,
        editImageFile: editImageFile,
        openImageViewer: openImageViewer,
        touchActivity: touchActivity,
        normalizeRedirectPath: normalizeRedirectPath,
        startOAuthSignIn: startOAuthSignIn
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureFavicon);
    } else {
        ensureFavicon();
    }
})();
