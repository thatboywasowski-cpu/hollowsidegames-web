document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("story-status");
    var story = document.getElementById("team-story");
    var params = new URLSearchParams(window.location.search);
    var biographyId = params.get("id");
    var expertise = document.getElementById("story-expertise");
    var name = document.getElementById("story-name");
    var introduction = document.getElementById("story-introduction");
    var tags = document.getElementById("story-tags");
    var author = document.getElementById("story-author");
    var published = document.getElementById("story-published");
    var edited = document.getElementById("story-edited");
    var linkedProfile = document.getElementById("story-linked-profile");
    var gallery = document.getElementById("story-gallery");
    var biography = document.getElementById("story-biography");
    var ownerTools = document.getElementById("story-owner-tools");
    var editToggle = document.getElementById("story-edit-toggle");
    var deleteButton = document.getElementById("story-delete");
    var editForm = document.getElementById("story-edit-form");
    var editCancel = document.getElementById("story-edit-cancel");
    var editName = document.getElementById("edit-team-name");
    var editExpertise = document.getElementById("edit-team-expertise");
    var editIntroduction = document.getElementById("edit-team-introduction");
    var editBiography = document.getElementById("edit-team-biography");
    var editGames = document.getElementById("edit-team-games");
    var editCategory = document.getElementById("edit-team-category");
    var editAccount = document.getElementById("edit-team-account");
    var editPictures = document.getElementById("edit-team-pictures");
    var removePictures = document.getElementById("edit-team-remove-pictures");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    if (!biographyId) {
        window.HollowsideAuth.setStatus(status, "No biography ID was provided in the URL.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;
    var article = null;
    var canWrite = false;

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
            month: "long",
            day: "numeric"
        });
    }

    function formatDateTime(value) {
        return new Date(value).toLocaleString();
    }

    function hasBeenEdited(item) {
        return !!(
            item.updated_at &&
            item.created_at &&
            new Date(item.updated_at).getTime() > new Date(item.created_at).getTime() + 1000
        );
    }

    function renderTags(item) {
        var result = ['<span class="team-tag is-category">' + escapeHtml(categoryLabel(item.category)) + "</span>"];
        asArray(item.games).forEach(function (game) {
            result.push('<span class="team-tag">' + escapeHtml(game) + "</span>");
        });
        tags.innerHTML = result.join("");
    }

    function renderMarkdown(markdown) {
        if (!window.marked || !window.DOMPurify) {
            biography.textContent = markdown || "";
            return;
        }

        biography.innerHTML = window.DOMPurify.sanitize(window.marked.parse(markdown || "", {
            gfm: true,
            breaks: true
        }));

        biography.querySelectorAll("a").forEach(function (link) {
            if (link.hostname && link.hostname !== window.location.hostname) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }
        });
    }

    function renderGallery(item) {
        var pictures = asArray(item.picture_urls);
        gallery.hidden = !pictures.length;
        gallery.innerHTML = pictures.map(function (url, index) {
            return (
                '<button class="team-story-picture" type="button" data-open-image="' + escapeHtml(url) + '">' +
                    '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(item.name) + " picture " + (index + 1) + '">' +
                "</button>"
            );
        }).join("");
    }

    function canEditArticle() {
        return !!(viewerContext && article && canWrite && viewerContext.id === article.author_id);
    }

    function canDeleteArticle() {
        return !!(
            viewerContext &&
            article &&
            (
                (canWrite && viewerContext.id === article.author_id) ||
                viewerContext.can_moderate_news ||
                ["owner", "co_owner"].indexOf(viewerContext.effective_role_key) !== -1
            )
        );
    }

    function fillEditForm() {
        editName.value = article.name || "";
        editExpertise.value = article.expertise || "";
        editIntroduction.value = article.introduction || "";
        editBiography.value = article.biography_markdown || "";
        editGames.value = asArray(article.games).join(", ");
        editCategory.value = article.category || "employee";
        editAccount.value = article.linked_account_id
            ? window.location.origin + "/profile/?id=" + article.linked_account_id
            : "";
        editPictures.value = "";
        removePictures.checked = false;
    }

    function renderArticle() {
        document.title = article.name + " | Hollowside";
        expertise.textContent = article.expertise;
        name.textContent = article.name;
        introduction.textContent = article.introduction;
        renderTags(article);

        var authorBadge = window.HollowsideAuth.getVerificationBadge({
            is_verified: article.author_is_verified,
            verification_mode: article.author_verification_mode
        }, "Verified Hollowside account");
        author.href = "/profile?id=" + encodeURIComponent(article.author_account_id);
        author.innerHTML = (
            escapeHtml(article.author_display_name) +
            ' <span class="identity-line">@' + escapeHtml(article.author_username) + authorBadge + "</span>"
        );
        published.textContent = "Published " + formatDate(article.created_at);
        edited.hidden = !hasBeenEdited(article);
        edited.textContent = hasBeenEdited(article) ? "Last edited " + formatDateTime(article.updated_at) : "";

        linkedProfile.hidden = !article.linked_account_id;
        if (article.linked_account_id) {
            linkedProfile.href = "/profile?id=" + encodeURIComponent(article.linked_account_id);
            linkedProfile.textContent = "Hollowside account: " + (article.linked_display_name || article.name);
        }

        renderGallery(article);
        renderMarkdown(article.biography_markdown);

        editToggle.hidden = !canEditArticle();
        deleteButton.hidden = !canDeleteArticle();
        ownerTools.hidden = !canEditArticle() && !canDeleteArticle();
        fillEditForm();
        story.hidden = false;
        window.HollowsideAuth.setStatus(status, "", "info");
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
                var path = viewerContext.id + "/biographies/" + article.id + "/" + Date.now() + "-" + index + "-" + Math.random().toString(16).slice(2) + "." + extension;
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

    async function loadArticle() {
        try {
            var response = await supabase.rpc("get_team_biography", {
                p_biography_id: biographyId
            });
            if (response.error) {
                throw response.error;
            }

            article = response.data && response.data[0];
            if (!article) {
                throw new Error("That biography could not be found.");
            }
            renderArticle();
        } catch (error) {
            story.hidden = true;
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading the biography.",
                "error"
            );
        }
    }

    gallery.addEventListener("click", function (event) {
        var button = event.target.closest("[data-open-image]");
        if (button) {
            window.HollowsideAuth.openImageViewer(button.getAttribute("data-open-image"), article.name);
        }
    });

    editToggle.addEventListener("click", function () {
        fillEditForm();
        editForm.hidden = false;
        editToggle.setAttribute("aria-expanded", "true");
        editForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    editCancel.addEventListener("click", function () {
        editForm.hidden = true;
        editToggle.setAttribute("aria-expanded", "false");
    });

    editPictures.addEventListener("change", function () {
        if (editPictures.files && editPictures.files.length) {
            removePictures.checked = false;
        }
    });

    removePictures.addEventListener("change", function () {
        if (removePictures.checked) {
            editPictures.value = "";
        }
    });

    editForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!canEditArticle()) {
            return;
        }

        var files = Array.prototype.slice.call(editPictures.files || []);
        if (files.length > 5) {
            window.HollowsideAuth.setStatus(status, "Choose no more than five pictures.", "error");
            return;
        }

        var oldPaths = asArray(article.picture_paths);
        var nextPictures = {
            urls: removePictures.checked ? [] : asArray(article.picture_urls),
            paths: removePictures.checked ? [] : oldPaths
        };
        var uploaded = { urls: [], paths: [] };

        try {
            var accountId = parseProfileReference(editAccount.value);
            window.HollowsideAuth.setBusy(editForm, true);
            if (files.length) {
                uploaded = await uploadPictures(files);
                nextPictures = uploaded;
            }

            var response = await supabase.rpc("update_team_biography", {
                p_biography_id: article.id,
                p_name: editName.value.trim(),
                p_expertise: editExpertise.value.trim(),
                p_introduction: editIntroduction.value.trim(),
                p_biography_markdown: editBiography.value.trim(),
                p_category: editCategory.value,
                p_games: parseGames(editGames.value),
                p_picture_urls: nextPictures.urls,
                p_picture_paths: nextPictures.paths,
                p_hollowside_account_id: accountId || null
            });
            if (response.error) {
                throw response.error;
            }

            if ((files.length || removePictures.checked) && oldPaths.length) {
                await supabase.storage.from("team-biographies").remove(oldPaths);
            }

            editForm.hidden = true;
            editToggle.setAttribute("aria-expanded", "false");
            window.HollowsideAuth.setStatus(status, "Biography updated.", "success");
            await loadArticle();
        } catch (error) {
            if (uploaded.paths.length) {
                await supabase.storage.from("team-biographies").remove(uploaded.paths);
            }
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating the biography.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(editForm, false);
        }
    });

    deleteButton.addEventListener("click", async function () {
        if (!canDeleteArticle() || !window.confirm("Delete this biography? This cannot be undone.")) {
            return;
        }

        try {
            var response = await supabase.rpc("delete_team_biography", {
                p_biography_id: article.id
            });
            if (response.error) {
                throw response.error;
            }

            var paths = asArray(response.data);
            if (paths.length) {
                await supabase.storage.from("team-biographies").remove(paths);
            }
            window.location.href = "/meet-the-team";
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while deleting the biography.",
                "error"
            );
        }
    });

    async function initialize() {
        try {
            var sessionResult = await supabase.auth.getSession();
            if (sessionResult.data && sessionResult.data.session) {
                var responses = await Promise.all([
                    supabase.rpc("get_my_account_context"),
                    supabase.rpc("can_write_team_biographies")
                ]);
                var realViewerContext = responses[0].data && responses[0].data[0] ? responses[0].data[0] : null;
                viewerContext = window.HollowsideAuth.applyRoleEmulation(realViewerContext);
                canWrite = !responses[1].error && responses[1].data === true;
                if (viewerContext && viewerContext.is_role_emulated) {
                    canWrite = canWrite && viewerContext.can_write_biographies === true;
                }
            }
        } catch (error) {
            viewerContext = null;
            canWrite = false;
        }

        await loadArticle();
    }

    initialize();
});
