document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("team-status");
    var composer = document.getElementById("team-composer");
    var form = document.getElementById("team-form");
    var nameInput = document.getElementById("team-name");
    var expertiseInput = document.getElementById("team-expertise");
    var introductionInput = document.getElementById("team-introduction");
    var biographyInput = document.getElementById("team-biography");
    var gamesInput = document.getElementById("team-games");
    var categoryInput = document.getElementById("team-category");
    var accountInput = document.getElementById("team-account");
    var picturesInput = document.getElementById("team-pictures");
    var count = document.getElementById("team-count");
    var list = document.getElementById("team-list");
    var loadMore = document.getElementById("team-load-more");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;
    var pageSize = 12;
    var loadedArticles = [];
    var isLoadingArticles = false;

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function asArray(value) {
        if (Array.isArray(value)) {
            return value;
        }

        if (!value) {
            return [];
        }

        try {
            var parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function parseGames(value) {
        var seen = {};
        return String(value || "")
            .split(",")
            .map(function (item) { return item.trim(); })
            .filter(function (item) {
                var key = item.toLowerCase();
                if (!item || seen[key]) {
                    return false;
                }
                seen[key] = true;
                return true;
            })
            .slice(0, 12);
    }

    function parseProfileReference(value) {
        var raw = String(value || "").trim();
        if (!raw) {
            return "";
        }

        if (/^hsg_[a-z0-9]+$/i.test(raw)) {
            return raw;
        }

        try {
            var url = new URL(raw, window.location.origin);
            var allowedHost = url.hostname === window.location.hostname
                || url.hostname === "hollowsidegames.com"
                || url.hostname === "www.hollowsidegames.com";
            var profileId = url.searchParams.get("id") || "";
            if (allowedHost && /^\/profile\/?$/i.test(url.pathname) && /^hsg_[a-z0-9]+$/i.test(profileId)) {
                return profileId;
            }
        } catch (error) {
            throw new Error("Enter a valid Hollowside profile link or account ID.");
        }

        throw new Error("Enter a valid Hollowside profile link or account ID.");
    }

    function categoryLabel(category) {
        if (category === "employee") {
            return "Hollowside Employee";
        }
        if (category === "contributor") {
            return "Contributor";
        }
        return "Hollowside Employee & Contributor";
    }

    function formatDate(value) {
        return new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function hasBeenEdited(article) {
        return !!(
            article.updated_at &&
            article.created_at &&
            new Date(article.updated_at).getTime() > new Date(article.created_at).getTime() + 1000
        );
    }

    function renderTags(article) {
        var tags = ['<span class="team-tag is-category">' + escapeHtml(categoryLabel(article.category)) + "</span>"];
        asArray(article.games).forEach(function (game) {
            tags.push('<span class="team-tag">' + escapeHtml(game) + "</span>");
        });
        return tags.join("");
    }

    function renderMedia(article) {
        var pictures = asArray(article.picture_urls);
        var href = "/meet-the-team/story?id=" + encodeURIComponent(article.id);
        if (!pictures.length) {
            return (
                '<a class="team-entry-media" href="' + href + '">' +
                    '<span class="team-entry-placeholder">' +
                        '<img src="/Hollowside Games logo.png" alt="Hollowside Games">' +
                    "</span>" +
                "</a>"
            );
        }

        return (
            '<a class="team-entry-media" href="' + href + '">' +
                '<img src="' + escapeHtml(pictures[0]) + '" alt="' + escapeHtml(article.name) + '">' +
                (pictures.length > 1 ? '<span class="team-picture-count">' + pictures.length + " pictures</span>" : "") +
            "</a>"
        );
    }

    function renderArticle(article, index) {
        var href = "/meet-the-team/story?id=" + encodeURIComponent(article.id);
        var authorBadge = window.HollowsideAuth.getVerificationBadge({
            is_verified: article.author_is_verified,
            verification_mode: article.author_verification_mode
        }, "Verified Hollowside account");
        var edited = hasBeenEdited(article)
            ? "<span>Edited " + escapeHtml(formatDate(article.updated_at)) + "</span>"
            : "";
        var linkedProfile = article.linked_account_id
            ? '<a href="/profile?id=' + encodeURIComponent(article.linked_account_id) + '">' + escapeHtml(article.linked_display_name || article.name) + "'s profile</a>"
            : "";

        return (
            '<article class="team-entry">' +
                '<div class="team-entry-index">' + String(index + 1).padStart(2, "0") + "</div>" +
                renderMedia(article) +
                '<div class="team-entry-copy">' +
                    "<div>" +
                        '<p class="team-entry-expertise">' + escapeHtml(article.expertise) + "</p>" +
                        "<h2>" + escapeHtml(article.name) + "</h2>" +
                        '<p class="team-entry-introduction">' + escapeHtml(article.introduction) + "</p>" +
                        '<div class="team-tag-row">' + renderTags(article) + "</div>" +
                    "</div>" +
                    '<div class="team-entry-footer">' +
                        '<div class="team-entry-meta">' +
                            '<span>Written by <a href="/profile?id=' + encodeURIComponent(article.author_account_id) + '">' +
                                escapeHtml(article.author_display_name) +
                                ' <span class="identity-line">@' + escapeHtml(article.author_username) + authorBadge + "</span>" +
                            "</a></span>" +
                            "<span>" + escapeHtml(formatDate(article.created_at)) + "</span>" +
                            edited + linkedProfile +
                        "</div>" +
                        '<a class="team-read-more" href="' + href + '">Read More</a>' +
                    "</div>" +
                "</div>" +
            "</article>"
        );
    }

    async function uploadPictures(files) {
        if (!files.length) {
            return { urls: [], paths: [] };
        }

        if (!viewerContext || !viewerContext.id) {
            throw new Error("Your account session could not be loaded.");
        }

        var urls = [];
        var paths = [];

        try {
            for (var index = 0; index < files.length; index += 1) {
                var file = files[index];
                if (file.size > 20 * 1024 * 1024) {
                    throw new Error("Pictures must be 20 MB or smaller.");
                }
                if (["image/png", "image/jpeg", "image/webp"].indexOf(file.type) === -1) {
                    throw new Error("Pictures must be PNG, JPEG, or WebP files.");
                }

                var extension = file.type === "image/png" ? "png" : (file.type === "image/webp" ? "webp" : "jpg");
                var path = viewerContext.id + "/biographies/" + Date.now() + "-" + index + "-" + Math.random().toString(16).slice(2) + "." + extension;
                var uploadResult = await supabase.storage.from("team-biographies").upload(path, file, {
                    upsert: false,
                    cacheControl: "3600",
                    contentType: file.type
                });

                if (uploadResult.error) {
                    throw uploadResult.error;
                }

                paths.push(path);
                urls.push(supabase.storage.from("team-biographies").getPublicUrl(path).data.publicUrl);
            }
        } catch (error) {
            if (paths.length) {
                await supabase.storage.from("team-biographies").remove(paths);
            }
            throw error;
        }

        return { urls: urls, paths: paths };
    }

    async function loadArticles(reset) {
        if (isLoadingArticles) {
            return;
        }

        isLoadingArticles = true;
        loadMore.disabled = true;
        try {
            if (reset) {
                loadedArticles = [];
            }

            var response = await supabase.rpc("get_team_biographies", {
                p_limit: pageSize,
                p_offset: loadedArticles.length
            });

            if (response.error) {
                throw response.error;
            }

            var articles = response.data || [];
            loadedArticles = loadedArticles.concat(articles);
            var totalCount = articles.length
                ? Number(articles[0].total_count || loadedArticles.length)
                : loadedArticles.length;
            count.textContent = totalCount
                ? totalCount + " published " + (totalCount === 1 ? "story" : "stories")
                : "No published stories yet";
            list.innerHTML = loadedArticles.length
                ? loadedArticles.map(renderArticle).join("")
                : '<div class="content-card"><h3>No biographies yet</h3><p>The first story from the Hollowside team will appear here.</p></div>';
            loadMore.hidden = loadedArticles.length >= totalCount;
        } catch (error) {
            if (!loadedArticles.length) {
                list.innerHTML = "";
            }
            loadMore.hidden = true;
            if (!loadedArticles.length) {
                count.textContent = "Stories unavailable";
            }
            var message = error && error.message && /get_team_biographies/i.test(error.message)
                ? "Meet The Team needs the latest Supabase database migration before stories can load."
                : (error && error.message ? error.message : "Something went wrong while loading biographies.");
            window.HollowsideAuth.setStatus(status, message, "error");
        } finally {
            isLoadingArticles = false;
            loadMore.disabled = false;
        }
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        var files = Array.prototype.slice.call(picturesInput.files || []);
        if (files.length > 5) {
            window.HollowsideAuth.setStatus(status, "Choose no more than five pictures.", "error");
            return;
        }

        var uploaded = { urls: [], paths: [] };
        try {
            var accountId = parseProfileReference(accountInput.value);
            window.HollowsideAuth.setBusy(form, true);
            uploaded = await uploadPictures(files);

            var response = await supabase.rpc("create_team_biography", {
                p_name: nameInput.value.trim(),
                p_expertise: expertiseInput.value.trim(),
                p_introduction: introductionInput.value.trim(),
                p_biography_markdown: biographyInput.value.trim(),
                p_category: categoryInput.value,
                p_games: parseGames(gamesInput.value),
                p_picture_urls: uploaded.urls,
                p_picture_paths: uploaded.paths,
                p_hollowside_account_id: accountId || null
            });

            if (response.error) {
                throw response.error;
            }

            form.reset();
            window.HollowsideAuth.setStatus(status, "Biography published.", "success");
            await loadArticles(true);
        } catch (error) {
            if (uploaded.paths.length) {
                await supabase.storage.from("team-biographies").remove(uploaded.paths);
            }
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while publishing the biography.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(form, false);
        }
    });

    loadMore.addEventListener("click", function () {
        loadArticles(false);
    });

    async function initialize() {
        await loadArticles(true);

        try {
            var sessionResult = await supabase.auth.getSession();
            if (!sessionResult.data || !sessionResult.data.session) {
                return;
            }

            var responses = await Promise.all([
                supabase.rpc("get_my_account_context"),
                supabase.rpc("can_write_team_biographies")
            ]);
            var realViewerContext = responses[0].data && responses[0].data[0] ? responses[0].data[0] : null;
            viewerContext = window.HollowsideAuth.applyRoleEmulation(realViewerContext);
            var canWrite = !responses[1].error && responses[1].data === true;
            if (viewerContext && viewerContext.is_role_emulated) {
                canWrite = canWrite && viewerContext.can_write_biographies === true;
            }
            composer.hidden = !canWrite;
        } catch (error) {
            composer.hidden = true;
        }
    }

    initialize();
});
