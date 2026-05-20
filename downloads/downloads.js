document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("downloads-status");
    var uploadInfo = document.getElementById("downloads-upload-info");
    var uploader = document.getElementById("downloads-uploader");
    var form = document.getElementById("download-form");
    var titleInput = document.getElementById("download-title");
    var categoryInput = document.getElementById("download-category");
    var summaryInput = document.getElementById("download-summary");
    var versionInput = document.getElementById("download-version");
    var thumbnailInput = document.getElementById("download-thumbnail");
    var screenshotsInput = document.getElementById("download-screenshots");
    var windowsInput = document.getElementById("download-windows-file");
    var macInput = document.getElementById("download-mac-file");
    var linuxInput = document.getElementById("download-linux-file");
    var heading = document.getElementById("downloads-heading");
    var copy = document.getElementById("downloads-copy");
    var grid = document.getElementById("downloads-grid");
    var tabs = document.querySelectorAll("[data-download-tab]");
    var activeCategory = "games";
    var maxDownloadBytes = 200 * 1024 * 1024 * 1024;
    var maxImageBytes = 20 * 1024 * 1024;
    var tooLargeMessage = "Item is too large! Compress this file or choose a smaller one.";
    var platforms = ["windows", "mac", "linux"];

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function formatBytes(value) {
        var bytes = Number(value || 0);
        if (!bytes) {
            return "Size not listed";
        }

        var units = ["B", "KB", "MB", "GB"];
        var index = 0;
        while (bytes >= 1024 && index < units.length - 1) {
            bytes /= 1024;
            index += 1;
        }

        return bytes.toFixed(bytes >= 10 || index === 0 ? 0 : 1) + " " + units[index];
    }

    function platformIcon(platform) {
        return '<img class="platform-icon" src="/assets/platform-' + platform + '.svg" alt="' + platform + '">';
    }

    function getPlatformUrl(item, platform) {
        return item[platform + "_url"] || "";
    }

    async function uploadFile(file, folder, maxBytes) {
        if (!file) {
            return {
                url: "",
                path: "",
                size: 0
            };
        }

        if (file.size > maxBytes) {
            throw new Error(tooLargeMessage);
        }

        var extension = (file.name.split(".").pop() || "bin").toLowerCase();
        var path = viewerContext.id + "/" + folder + "/" + Date.now() + "-" + Math.random().toString(16).slice(2) + "." + extension;
        var uploadResult = await supabase.storage
            .from("downloads")
            .upload(path, file, {
                upsert: false,
                cacheControl: "3600"
            });

        if (uploadResult.error) {
            throw uploadResult.error;
        }

        return {
            url: supabase.storage.from("downloads").getPublicUrl(path).data.publicUrl,
            path: path,
            size: file.size
        };
    }

    function renderItems(items) {
        heading.textContent = activeCategory === "engine" ? "Engine" : "Games";
        copy.textContent = items.length
            ? items.length + " download" + (items.length === 1 ? "" : "s") + " available."
            : "No downloads have been published in this category yet.";

        if (!items.length) {
            grid.innerHTML = activeCategory === "engine"
                ? '<article class="content-card download-card"><h3>HollowEngine</h3><p class="download-empty">HollowEngine builds will appear here when an approved account publishes one.</p></article>'
                : '<p class="download-empty">No game downloads are available yet.</p>';
            return;
        }

        grid.innerHTML = items.map(function (item) {
            var supported = platforms.filter(function (platform) {
                return !!getPlatformUrl(item, platform);
            });
            var thumbnail = item.thumbnail_url
                ? '<div class="download-thumb"><img src="' + escapeHtml(item.thumbnail_url) + '" alt="' + escapeHtml(item.title) + ' thumbnail"></div>'
                : "";
            return (
                '<article class="content-card download-card">' +
                    thumbnail +
                    '<p class="meta">' + escapeHtml((item.category || activeCategory).toUpperCase()) + '</p>' +
                    '<h3>' + escapeHtml(item.title) + '</h3>' +
                    '<p>' + escapeHtml(item.summary || "No description provided.") + '</p>' +
                    '<div class="platform-row">' + supported.map(platformIcon).join("") + '</div>' +
                    '<div class="download-meta">' +
                        '<span class="account-chip">' + escapeHtml(item.version || "Unversioned") + '</span>' +
                        '<span class="account-chip">' + escapeHtml(formatBytes(item.file_size_bytes)) + '</span>' +
                        '<span class="account-chip">By ' + escapeHtml(item.author_display_name || "Hollowside") + '</span>' +
                    '</div>' +
                    '<div class="account-actions">' +
                        '<a class="account-button" href="/downloads/game?id=' + encodeURIComponent(item.id) + '">View Page</a>' +
                        (viewerContext && supported.length
                            ? '<a class="account-button primary" href="/downloads/game?id=' + encodeURIComponent(item.id) + '">Download</a>'
                            : '<a class="account-button primary" href="/login?redirect=/downloads">Log In To Download</a>') +
                    '</div>' +
                '</article>'
            );
        }).join("");
    }

    async function loadDownloads() {
        try {
            var response = await supabase.rpc("get_download_entries", {
                p_category: activeCategory,
                p_limit: 40
            });

            if (response.error) {
                throw response.error;
            }

            renderItems(response.data || []);
            window.HollowsideAuth.setStatus(status, "", "info");
        } catch (error) {
            grid.innerHTML = "";
            copy.textContent = "Unable to load downloads right now.";
            var message = error && error.message && error.message.indexOf("get_download_entries") !== -1
                ? "Downloads need the latest Supabase database patch before they can load."
                : (error && error.message ? error.message : "Something went wrong while loading downloads.");
            window.HollowsideAuth.setStatus(status, message, "error");
        }
    }

    tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
            activeCategory = tab.getAttribute("data-download-tab");
            tabs.forEach(function (item) {
                item.classList.toggle("is-active", item === tab);
            });
            categoryInput.value = activeCategory;
            loadDownloads();
        });
    });

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!viewerContext || !viewerContext.can_publish_downloads) {
            window.HollowsideAuth.setStatus(status, "You do not have permission to publish downloads.", "error");
            return;
        }

        var title = titleInput.value.trim();
        var category = categoryInput.value;
        var summary = summaryInput.value.trim();
        var version = versionInput.value.trim();
        var thumbnailFile = thumbnailInput.files && thumbnailInput.files[0] ? thumbnailInput.files[0] : null;
        var screenshotFiles = Array.prototype.slice.call(screenshotsInput.files || []).slice(0, 10);
        var windowsFile = windowsInput.files && windowsInput.files[0] ? windowsInput.files[0] : null;
        var macFile = macInput.files && macInput.files[0] ? macInput.files[0] : null;
        var linuxFile = linuxInput.files && linuxInput.files[0] ? linuxInput.files[0] : null;

        if (!title) {
            titleInput.focus();
            return;
        }

        if (!windowsFile && !macFile && !linuxFile) {
            window.HollowsideAuth.setStatus(status, "Upload at least one Windows, Mac, or Linux build.", "error");
            return;
        }

        try {
            window.HollowsideAuth.setBusy(form, true);

            var thumbnailUpload = thumbnailFile ? await uploadFile(thumbnailFile, "thumbnails", maxImageBytes) : { url: "" };
            var screenshotUploads = [];
            for (var screenshotIndex = 0; screenshotIndex < screenshotFiles.length; screenshotIndex += 1) {
                screenshotUploads.push(await uploadFile(screenshotFiles[screenshotIndex], "screenshots", maxImageBytes));
            }

            var windowsUpload = await uploadFile(windowsFile, "windows", maxDownloadBytes);
            var macUpload = await uploadFile(macFile, "mac", maxDownloadBytes);
            var linuxUpload = await uploadFile(linuxFile, "linux", maxDownloadBytes);
            var totalSize = windowsUpload.size + macUpload.size + linuxUpload.size;

            var createResponse = await supabase.rpc("create_download_entry", {
                p_category: category,
                p_title: title,
                p_summary: summary,
                p_version: version,
                p_thumbnail_url: thumbnailUpload.url,
                p_screenshot_urls: screenshotUploads.map(function (item) { return item.url; }),
                p_windows_url: windowsUpload.url,
                p_mac_url: macUpload.url,
                p_linux_url: linuxUpload.url,
                p_file_size_bytes: totalSize
            });

            if (createResponse.error) {
                throw createResponse.error;
            }

            form.reset();
            categoryInput.value = activeCategory;
            window.HollowsideAuth.setStatus(status, "Download published.", "success");
            loadDownloads();
        } catch (error) {
            var uploadMessage = error && error.message && /size|large|payload|limit|exceed/i.test(error.message)
                ? tooLargeMessage
                : (error && error.message ? error.message : "Something went wrong while publishing the download.");
            window.HollowsideAuth.setStatus(status, uploadMessage, "error");
        } finally {
            window.HollowsideAuth.setBusy(form, false);
        }
    });

    (async function initialize() {
        try {
            var contextResponse = await supabase.rpc("get_my_account_context");
            viewerContext = !contextResponse.error && contextResponse.data && contextResponse.data[0]
                ? window.HollowsideAuth.applyRoleEmulation(contextResponse.data[0], null)
                : null;
            var canUpload = !!(viewerContext && viewerContext.can_publish_downloads);
            uploader.hidden = !canUpload;
            uploadInfo.hidden = !canUpload;
        } catch (error) {
            viewerContext = null;
            uploader.hidden = true;
            uploadInfo.hidden = true;
        }

        loadDownloads();
    })();
});
