document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("downloads-status");
    var uploader = document.getElementById("downloads-uploader");
    var form = document.getElementById("download-form");
    var titleInput = document.getElementById("download-title");
    var categoryInput = document.getElementById("download-category");
    var summaryInput = document.getElementById("download-summary");
    var versionInput = document.getElementById("download-version");
    var fileInput = document.getElementById("download-file");
    var urlInput = document.getElementById("download-url");
    var heading = document.getElementById("downloads-heading");
    var copy = document.getElementById("downloads-copy");
    var grid = document.getElementById("downloads-grid");
    var tabs = document.querySelectorAll("[data-download-tab]");
    var activeCategory = "games";
    var maxDownloadBytes = 200 * 1024 * 1024 * 1024;

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
            return (
                '<article class="content-card download-card">' +
                    '<p class="meta">' + escapeHtml((item.category || activeCategory).toUpperCase()) + '</p>' +
                    '<h3>' + escapeHtml(item.title) + '</h3>' +
                    '<p>' + escapeHtml(item.summary || "No description provided.") + '</p>' +
                    '<div class="download-meta">' +
                        '<span class="account-chip">' + escapeHtml(item.version || "Unversioned") + '</span>' +
                        '<span class="account-chip">' + escapeHtml(formatBytes(item.file_size_bytes)) + '</span>' +
                        '<span class="account-chip">By ' + escapeHtml(item.author_display_name || "Hollowside") + '</span>' +
                    '</div>' +
                    '<div class="account-actions">' +
                        '<a class="account-button primary" href="' + escapeHtml(item.download_url) + '" rel="noopener" target="_blank">Download</a>' +
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
            window.HollowsideAuth.setStatus(status, error && error.message ? error.message : "Something went wrong while loading downloads.", "error");
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
        var externalUrl = urlInput.value.trim();
        var file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        var downloadUrl = externalUrl;
        var storagePath = "";
        var fileSize = file ? file.size : 0;

        if (!title) {
            titleInput.focus();
            return;
        }

        if (file && file.size > maxDownloadBytes) {
            window.HollowsideAuth.setStatus(status, "Downloads cannot exceed 200 GB.", "error");
            return;
        }

        if (!file && !downloadUrl) {
            window.HollowsideAuth.setStatus(status, "Upload a file or provide a download URL.", "error");
            return;
        }

        try {
            window.HollowsideAuth.setBusy(form, true);

            if (file) {
                var extension = (file.name.split(".").pop() || "bin").toLowerCase();
                storagePath = viewerContext.id + "/downloads/" + Date.now() + "." + extension;
                var uploadResult = await supabase.storage
                    .from("downloads")
                    .upload(storagePath, file, {
                        upsert: false,
                        cacheControl: "3600"
                    });

                if (uploadResult.error) {
                    throw uploadResult.error;
                }

                downloadUrl = supabase.storage.from("downloads").getPublicUrl(storagePath).data.publicUrl;
            }

            var createResponse = await supabase.rpc("create_download_entry", {
                p_category: category,
                p_title: title,
                p_summary: summary,
                p_version: version,
                p_download_url: downloadUrl,
                p_storage_path: storagePath,
                p_file_size_bytes: fileSize
            });

            if (createResponse.error) {
                throw createResponse.error;
            }

            form.reset();
            categoryInput.value = activeCategory;
            window.HollowsideAuth.setStatus(status, "Download published.", "success");
            loadDownloads();
        } catch (error) {
            window.HollowsideAuth.setStatus(status, error && error.message ? error.message : "Something went wrong while publishing the download.", "error");
        } finally {
            window.HollowsideAuth.setBusy(form, false);
        }
    });

    (async function initialize() {
        try {
            var contextResponse = await supabase.rpc("get_my_account_context");
            viewerContext = !contextResponse.error && contextResponse.data && contextResponse.data[0] ? contextResponse.data[0] : null;
            uploader.hidden = !(viewerContext && viewerContext.can_publish_downloads);
        } catch (error) {
            viewerContext = null;
        }

        loadDownloads();
    })();
});
