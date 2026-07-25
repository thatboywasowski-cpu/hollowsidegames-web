document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("game-status");
    var title = document.getElementById("game-title");
    var summary = document.getElementById("game-summary");
    var platforms = document.getElementById("game-platforms");
    var actions = document.getElementById("game-actions");
    var thumbnail = document.getElementById("game-thumbnail");
    var screenshots = document.getElementById("game-screenshots");
    var params = new URLSearchParams(window.location.search);
    var gameId = params.get("id");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;
    var platformOrder = ["windows", "mac", "linux"];

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function detectPlatform() {
        var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "";
        platform = platform.toLowerCase();
        if (platform.indexOf("win") !== -1) {
            return "windows";
        }
        if (platform.indexOf("mac") !== -1) {
            return "mac";
        }
        if (platform.indexOf("linux") !== -1 || platform.indexOf("x11") !== -1) {
            return "linux";
        }
        return "";
    }

    function icon(platform) {
        return '<img class="platform-icon" src="/assets/platform-' + platform + '.svg" alt="' + platform + '">';
    }

    function platformUrl(item, platform) {
        return item[platform + "_url"] || "";
    }

    function render(item) {
        var supported = platformOrder.filter(function (platform) {
            return !!platformUrl(item, platform);
        });
        var detected = detectPlatform();
        var preferred = supported.indexOf(detected) !== -1 ? detected : supported[0];
        var shotList = Array.isArray(item.screenshot_urls) ? item.screenshot_urls : [];

        document.title = item.title + " | Hollowside LLC";
        title.textContent = item.title;
        summary.textContent = item.summary || "No description provided.";
        platforms.innerHTML = supported.map(icon).join("");
        thumbnail.innerHTML = item.thumbnail_url
            ? '<img src="' + escapeHtml(item.thumbnail_url) + '" alt="' + escapeHtml(item.title) + ' thumbnail">'
            : '<p class="download-empty">No thumbnail uploaded.</p>';

        if (!viewerContext) {
            actions.innerHTML = '<a class="button-link primary" href="/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search) + '">Log In To Download</a>';
        } else if (preferred) {
            actions.innerHTML = '<a class="button-link primary" href="' + escapeHtml(platformUrl(item, preferred)) + '" rel="noopener">Download For ' + escapeHtml(preferred) + '</a>';
            actions.innerHTML += supported.filter(function (platform) { return platform !== preferred; }).map(function (platform) {
                return '<a class="button-link secondary" href="' + escapeHtml(platformUrl(item, platform)) + '" rel="noopener">' + escapeHtml(platform) + '</a>';
            }).join("");
        } else {
            actions.innerHTML = '<p class="download-empty">No platform builds are available yet.</p>';
        }

        screenshots.innerHTML = shotList.length
            ? shotList.slice(0, 10).map(function (src) {
                return '<button type="button" data-open-image="' + escapeHtml(src) + '"><img src="' + escapeHtml(src) + '" alt="Screenshot"></button>';
            }).join("")
            : '<p class="download-empty">No screenshots uploaded.</p>';
    }

    screenshots.addEventListener("click", function (event) {
        var button = event.target.closest("[data-open-image]");
        if (!button) {
            return;
        }

        window.HollowsideAuth.openImageViewer(button.getAttribute("data-open-image"), "Download screenshot");
    });

    (async function initialize() {
        try {
            var contextResponse = await supabase.rpc("get_my_account_context");
            viewerContext = !contextResponse.error && contextResponse.data && contextResponse.data[0] ? contextResponse.data[0] : null;

            var response = await supabase.rpc("get_download_entry", {
                p_download_id: gameId
            });

            if (response.error) {
                throw response.error;
            }

            var item = response.data && response.data[0] ? response.data[0] : null;
            if (!item) {
                window.HollowsideAuth.setStatus(status, "That download could not be found.", "error");
                return;
            }

            render(item);
        } catch (error) {
            window.HollowsideAuth.setStatus(status, error && error.message ? error.message : "Something went wrong while loading this download.", "error");
        }
    })();
});
