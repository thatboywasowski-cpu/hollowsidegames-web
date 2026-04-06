document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("news-status");
    var composerCard = document.getElementById("news-composer-card");
    var postForm = document.getElementById("news-post-form");
    var subtitleInput = document.getElementById("news-post-subtitle");
    var titleInput = document.getElementById("news-post-title");
    var summaryInput = document.getElementById("news-post-summary");
    var bodyInput = document.getElementById("news-post-body");
    var mediaInput = document.getElementById("news-post-media");
    var featured = document.getElementById("news-featured");
    var featuredCopy = document.getElementById("news-featured-copy");
    var rail = document.getElementById("news-rail");
    var archiveCopy = document.getElementById("news-archive-copy");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function getPostHref(postId) {
        return "/news/post?id=" + encodeURIComponent(postId);
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

    function getSubtitle(post) {
        return (post && post.subtitle ? post.subtitle : "Official Update").toUpperCase();
    }

    function hasBeenEdited(post) {
        return !!(post && post.updated_at && post.created_at && new Date(post.updated_at).getTime() > new Date(post.created_at).getTime() + 1000);
    }

    function renderEditedStamp(post) {
        if (!hasBeenEdited(post)) {
            return "";
        }

        return '<span class="news-edited-label">Last Edited: ' + escapeHtml(formatDateTime(post.updated_at)) + "</span>";
    }

    function canManageNewsPost(post) {
        return !!(
            viewerContext &&
            post &&
            viewerContext.id === post.author_id &&
            viewerContext.can_publish_news
        );
    }

    function buildAuthorLine(post) {
        var badge = window.HollowsideAuth.getVerificationBadge({
            is_verified: post.author_is_verified,
            verification_mode: post.author_verification_mode
        }, "Verified Hollowside account");

        return (
            '<a class="news-author-line" href="/profile?id=' + encodeURIComponent(post.author_account_id) + '">' +
                '<span>' + escapeHtml(post.author_display_name) + '</span>' +
                '<span class="identity-line">@' + escapeHtml(post.author_username) + badge + "</span>" +
            "</a>"
        );
    }

    function renderMediaPreview(items) {
        if (!items.length) {
            return "";
        }

        var item = items[0];
        if (item.media_type === "video") {
            return '<div class="news-featured-media"><video controls preload="metadata" src="' + escapeHtml(item.media_url) + '"></video></div>';
        }

        return '<div class="news-featured-media"><img src="' + escapeHtml(item.media_url) + '" alt="News attachment"></div>';
    }

    async function uploadPostMediaFiles(postId, files) {
        if (!viewerContext || !viewerContext.id || !files.length) {
            return;
        }

        var uploads = files.map(function (file, index) {
            return (async function () {
                var extension = (file.name.split(".").pop() || "bin").toLowerCase();
                var path = viewerContext.id + "/posts/" + postId + "/" + Date.now() + "-" + index + "." + extension;
                var mediaType = file.type.indexOf("video/") === 0 ? "video" : "image";
                var uploadResult = await supabase.storage
                    .from("post-media")
                    .upload(path, file, {
                        upsert: false,
                        cacheControl: "3600"
                    });

                if (uploadResult.error) {
                    throw uploadResult.error;
                }

                var publicUrlResult = supabase.storage
                    .from("post-media")
                    .getPublicUrl(path);

                var attachResult = await supabase.rpc("attach_post_media", {
                    p_post_id: postId,
                    p_media_type: mediaType,
                    p_media_url: publicUrlResult.data.publicUrl,
                    p_media_path: path,
                    p_sort_order: index
                });

                if (attachResult.error) {
                    throw attachResult.error;
                }
            })();
        });

        await Promise.all(uploads);
    }

    function renderReactionControls(post) {
        return (
            '<div class="post-actions news-card-actions">' +
                '<button class="post-action' + (post.viewer_reaction === "like" ? " is-active" : "") + '" type="button" data-reaction="like" data-post-id="' + escapeHtml(post.id) + '">' + window.HollowsideAuth.formatCountLabel(post.like_count, "Like", "Likes") + "</button>" +
                '<button class="post-action' + (post.viewer_reaction === "dislike" ? " is-active" : "") + '" type="button" data-reaction="dislike" data-post-id="' + escapeHtml(post.id) + '">' + window.HollowsideAuth.formatCountLabel(post.dislike_count, "Dislike", "Dislikes") + "</button>" +
            "</div>"
        );
    }

    function renderOwnerTools(post) {
        if (!canManageNewsPost(post)) {
            return "";
        }

        return (
            '<div class="post-owner-tools">' +
                '<div class="post-owner-actions">' +
                    '<button class="post-action" type="button" data-news-edit-toggle data-post-id="' + escapeHtml(post.id) + '">Edit Post</button>' +
                    '<button class="post-action is-danger" type="button" data-news-delete data-post-id="' + escapeHtml(post.id) + '">Delete Post</button>' +
                "</div>" +
                '<form class="post-edit-form" data-news-edit-form data-post-id="' + escapeHtml(post.id) + '" hidden>' +
                    '<div class="post-edit-grid">' +
                        '<div>' +
                            '<label for="edit-subtitle-' + escapeHtml(post.id) + '">Subtitle</label>' +
                            '<input id="edit-subtitle-' + escapeHtml(post.id) + '" name="subtitle" type="text" maxlength="48" value="' + escapeHtml(post.subtitle || "") + '">' +
                        "</div>" +
                        '<div>' +
                            '<label for="edit-title-' + escapeHtml(post.id) + '">Title</label>' +
                            '<input id="edit-title-' + escapeHtml(post.id) + '" name="title" type="text" maxlength="120" value="' + escapeHtml(post.title || "") + '">' +
                        "</div>" +
                    "</div>" +
                    '<div>' +
                        '<label for="edit-summary-' + escapeHtml(post.id) + '">Short Description</label>' +
                        '<input id="edit-summary-' + escapeHtml(post.id) + '" name="summary" type="text" maxlength="240" value="' + escapeHtml(post.summary || "") + '">' +
                    "</div>" +
                    '<div>' +
                        '<label for="edit-body-' + escapeHtml(post.id) + '">Full Description</label>' +
                        '<textarea id="edit-body-' + escapeHtml(post.id) + '" name="body" maxlength="12000">' + escapeHtml(post.body || "") + '</textarea>' +
                    "</div>" +
                    '<div class="account-actions">' +
                        '<button class="account-button primary" type="submit">Save Changes</button>' +
                        '<button class="account-button" type="button" data-news-edit-cancel data-post-id="' + escapeHtml(post.id) + '">Cancel</button>' +
                    "</div>" +
                "</form>" +
            "</div>"
        );
    }

    function renderPreviewCard(post) {
        return (
            '<article class="news-summary-card" data-post-id="' + escapeHtml(post.id) + '">' +
                '<p class="meta">' + escapeHtml(getSubtitle(post)) + "</p>" +
                '<h3>' + escapeHtml(post.title) + "</h3>" +
                '<p>' + escapeHtml(post.summary || "No short description yet.") + "</p>" +
                '<div class="news-card-footer">' +
                    '<div class="news-card-meta">' +
                        buildAuthorLine(post) +
                        '<span class="news-card-date">' + escapeHtml(formatDate(post.created_at)) + "</span>" +
                        renderEditedStamp(post) +
                    "</div>" +
                    '<div class="news-card-buttons">' +
                        renderReactionControls(post) +
                        '<a class="button-link secondary news-view-link" href="' + getPostHref(post.id) + '">View Full Post</a>' +
                    "</div>" +
                "</div>" +
            "</article>"
        );
    }

    async function renderFeaturedPost(post) {
        var mediaResponse = await supabase.rpc("get_post_media", {
            p_post_id: post.id
        });

        if (mediaResponse.error) {
            throw mediaResponse.error;
        }

        featured.innerHTML =
            '<article class="news-featured-card" data-post-id="' + escapeHtml(post.id) + '">' +
                '<div class="news-featured-copy">' +
                    '<p class="meta">' + escapeHtml(getSubtitle(post)) + "</p>" +
                    '<h3>' + escapeHtml(post.title) + "</h3>" +
                    '<p class="post-summary">' + escapeHtml(post.summary || "No short description yet.") + "</p>" +
                    '<p class="post-body">' + escapeHtml(post.body || "").replace(/\n/g, "<br>") + "</p>" +
                    '<div class="news-card-footer">' +
                        '<div class="news-card-meta">' +
                            buildAuthorLine(post) +
                            '<span class="news-card-date">' + escapeHtml(formatDateTime(post.created_at)) + "</span>" +
                            renderEditedStamp(post) +
                        "</div>" +
                        '<div class="news-card-buttons">' +
                            renderReactionControls(post) +
                            '<a class="button-link primary news-view-link" href="' + getPostHref(post.id) + '">View Full Post</a>' +
                        "</div>" +
                    "</div>" +
                    renderOwnerTools(post) +
                "</div>" +
                renderMediaPreview(mediaResponse.data || []) +
            "</article>";
    }

    async function loadFeed() {
        try {
            var response = await supabase.rpc("get_post_feed", {
                p_post_type: "news",
                p_author_account_id: null,
                p_limit: 24
            });

            if (response.error) {
                throw response.error;
            }

            var posts = response.data || [];

            if (!posts.length) {
                featuredCopy.textContent = "No official posts yet.";
                archiveCopy.textContent = "Once a studio post is published, it will appear here.";
                featured.innerHTML = '<article class="content-card"><h3>No official posts yet</h3><p>The first staff-authored post will land here as soon as it is published.</p></article>';
                rail.innerHTML = "";
                return;
            }

            featuredCopy.textContent = "Newest official post from the studio.";
            archiveCopy.textContent = posts.length + " published post" + (posts.length === 1 ? "" : "s") + " ready to browse.";
            await renderFeaturedPost(posts[0]);
            rail.innerHTML = posts.map(renderPreviewCard).join("");
        } catch (error) {
            featured.innerHTML = "";
            rail.innerHTML = "";
            featuredCopy.textContent = "Unable to load the newest post.";
            archiveCopy.textContent = "The archive could not be loaded.";
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading the news page.",
                "error"
            );
        }
    }

    async function handleReaction(postId, reaction, trigger) {
        try {
            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent("/news");
                return;
            }

            if (trigger.classList.contains("is-active")) {
                var clearResult = await supabase.rpc("clear_post_reaction", {
                    p_post_id: postId
                });

                if (clearResult.error) {
                    throw clearResult.error;
                }
            } else {
                var reactionResult = await supabase.rpc("set_post_reaction", {
                    p_post_id: postId,
                    p_reaction_type: reaction
                });

                if (reactionResult.error) {
                    throw reactionResult.error;
                }
            }

            await loadFeed();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while reacting to the post.",
                "error"
            );
        }
    }

    rail.addEventListener("click", function (event) {
        var reaction = event.target.getAttribute("data-reaction");
        var postId = event.target.getAttribute("data-post-id");

        if (!reaction || !postId) {
            return;
        }

        handleReaction(postId, reaction, event.target);
    });

    featured.addEventListener("click", async function (event) {
        var reaction = event.target.getAttribute("data-reaction");
        var postId = event.target.getAttribute("data-post-id");
        var editToggle = event.target.hasAttribute("data-news-edit-toggle");
        var editCancel = event.target.hasAttribute("data-news-edit-cancel");
        var deletePost = event.target.hasAttribute("data-news-delete");

        if (reaction && postId) {
            await handleReaction(postId, reaction, event.target);
            return;
        }

        if (editToggle || editCancel) {
            var host = event.target.closest("[data-post-id]");
            if (!host) {
                return;
            }

            var form = host.querySelector("[data-news-edit-form]");
            if (form) {
                form.hidden = !form.hidden;
            }
            return;
        }

        if (deletePost && postId) {
            if (!window.confirm("Delete this news post? This also removes its comments, reactions, and attached media records.")) {
                return;
            }

            try {
                var deleteResult = await supabase.rpc("delete_content_post", {
                    p_post_id: postId
                });

                if (deleteResult.error) {
                    throw deleteResult.error;
                }

                window.HollowsideAuth.setStatus(status, "News post deleted.", "success");
                await loadFeed();
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while deleting the news post.",
                    "error"
                );
            }
        }
    });

    featured.addEventListener("submit", async function (event) {
        var form = event.target;
        if (!form.hasAttribute("data-news-edit-form")) {
            return;
        }

        event.preventDefault();

        var postId = form.getAttribute("data-post-id");
        var subtitleValue = form.querySelector('[name="subtitle"]').value.trim();
        var titleValue = form.querySelector('[name="title"]').value.trim();
        var summaryValue = form.querySelector('[name="summary"]').value.trim();
        var bodyValue = form.querySelector('[name="body"]').value.trim();

        if (!titleValue) {
            form.querySelector('[name="title"]').focus();
            return;
        }

        if (!summaryValue) {
            form.querySelector('[name="summary"]').focus();
            return;
        }

        if (!bodyValue) {
            form.querySelector('[name="body"]').focus();
            return;
        }

        try {
            var updateResult = await supabase.rpc("update_content_post", {
                p_post_id: postId,
                p_title: titleValue,
                p_body: bodyValue,
                p_summary: summaryValue,
                p_subtitle: subtitleValue
            });

            if (updateResult.error) {
                throw updateResult.error;
            }

            window.HollowsideAuth.setStatus(status, "News post updated.", "success");
            await loadFeed();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating the news post.",
                "error"
            );
        }
    });

    postForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!viewerContext || !viewerContext.can_publish_news) {
            window.HollowsideAuth.setStatus(status, "You do not have permission to publish official news.", "error");
            return;
        }

        if (!titleInput.value.trim()) {
            titleInput.focus();
            return;
        }

        if (!summaryInput.value.trim()) {
            summaryInput.focus();
            return;
        }

        if (!bodyInput.value.trim()) {
            bodyInput.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(postForm, true);
            var createResponse = await supabase.rpc("create_content_post", {
                p_post_type: "news",
                p_title: titleInput.value.trim(),
                p_body: bodyInput.value.trim(),
                p_summary: summaryInput.value.trim(),
                p_subtitle: subtitleInput.value.trim()
            });

            if (createResponse.error) {
                throw createResponse.error;
            }

            var createdPost = createResponse.data;
            var files = Array.prototype.slice.call(mediaInput.files || []);

            if (files.length) {
                await uploadPostMediaFiles(createdPost.id, files);
            }

            postForm.reset();
            window.HollowsideAuth.setStatus(status, "Official news post published.", "success");
            await loadFeed();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while publishing the news post.",
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(postForm, false);
        }
    });

    async function initialize() {
        try {
            var contextResponse = await supabase.rpc("get_my_account_context");
            viewerContext = contextResponse.data && contextResponse.data[0] ? contextResponse.data[0] : null;

            if (viewerContext && viewerContext.can_publish_news) {
                composerCard.hidden = false;
            }

            await loadFeed();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while starting the news page.",
                "error"
            );
        }
    }

    initialize();
});
