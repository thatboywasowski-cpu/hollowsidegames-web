document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("news-status");
    var composerCard = document.getElementById("news-composer-card");
    var postForm = document.getElementById("news-post-form");
    var titleInput = document.getElementById("news-post-title");
    var summaryInput = document.getElementById("news-post-summary");
    var bodyInput = document.getElementById("news-post-body");
    var mediaInput = document.getElementById("news-post-media");
    var feed = document.getElementById("news-feed");
    var feedCopy = document.getElementById("news-feed-copy");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function renderMedia(items) {
        if (!items.length) {
            return "";
        }

        return (
            '<div class="post-media-grid">' +
                items.map(function (item) {
                    if (item.media_type === "video") {
                        return '<div class="post-media-item"><video controls preload="metadata" src="' + escapeHtml(item.media_url) + '"></video></div>';
                    }

                    return '<div class="post-media-item"><img src="' + escapeHtml(item.media_url) + '" alt="Post attachment"></div>';
                }).join("") +
            "</div>"
        );
    }

    function renderComments(items) {
        if (!items.length) {
            return '<p class="post-empty">No comments yet.</p>';
        }

        return (
            '<div class="comment-list">' +
                items.map(function (comment) {
                    var badge = window.HollowsideAuth.getVerificationBadge({
                        is_verified: comment.author_is_verified,
                        verification_mode: comment.author_verification_mode
                    }, "Verified Hollowside account");

                    return (
                        '<article class="comment-card">' +
                            '<div class="comment-meta">' +
                                '<strong>' + escapeHtml(comment.author_display_name) + '</strong>' +
                                '<span class="identity-line">@' + escapeHtml(comment.author_username) + badge + '</span>' +
                                '<span>' + escapeHtml(new Date(comment.created_at).toLocaleString()) + '</span>' +
                            '</div>' +
                            '<p>' + escapeHtml(comment.body) + '</p>' +
                        '</article>'
                    );
                }).join("") +
            "</div>"
        );
    }

    async function uploadPostMediaFiles(postId, files) {
        if (!viewerContext || !viewerContext.id || !files.length) {
            return;
        }

        var uploads = [];

        files.forEach(function (file, index) {
            uploads.push((async function () {
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
            })());
        });

        await Promise.all(uploads);
    }

    async function loadFeed() {
        try {
            var response = await supabase.rpc("get_post_feed", {
                p_post_type: "news",
                p_author_account_id: null,
                p_limit: 20
            });

            if (response.error) {
                throw response.error;
            }

            var posts = response.data || [];
            feedCopy.textContent = posts.length ? posts.length + " official post" + (posts.length === 1 ? "" : "s") : "No official posts yet.";

            if (!posts.length) {
                feed.innerHTML = '<p class="post-empty">No official news has been published yet.</p>';
                return;
            }

            var blocks = await Promise.all(posts.map(async function (post) {
                var mediaResponse = await supabase.rpc("get_post_media", { p_post_id: post.id });
                var commentsResponse = await supabase.rpc("get_post_comments", { p_post_id: post.id, p_limit: 14 });
                var badge = window.HollowsideAuth.getVerificationBadge({
                    is_verified: post.author_is_verified,
                    verification_mode: post.author_verification_mode
                }, "Verified Hollowside account");

                if (mediaResponse.error) {
                    throw mediaResponse.error;
                }

                if (commentsResponse.error) {
                    throw commentsResponse.error;
                }

                return (
                    '<article class="post-card" data-post-id="' + escapeHtml(post.id) + '">' +
                        '<div class="post-header">' +
                            '<div class="post-author">' +
                                (post.author_avatar_url
                                    ? '<span class="account-avatar-preview"><img src="' + escapeHtml(post.author_avatar_url) + '" alt="Profile picture"></span>'
                                    : '<span class="account-avatar-preview">' + window.HollowsideAuth.getInitials({ display_name: post.author_display_name }, null) + "</span>") +
                                '<div class="post-author-copy">' +
                                    '<strong>' + escapeHtml(post.author_display_name) + '</strong>' +
                                    '<span class="identity-line">@' + escapeHtml(post.author_username) + badge + " - " + escapeHtml(post.author_role_label) + '</span>' +
                                '</div>' +
                            '</div>' +
                            '<span class="post-date">' + escapeHtml(new Date(post.created_at).toLocaleString()) + '</span>' +
                        '</div>' +
                        '<h3 class="post-title">' + escapeHtml(post.title) + '</h3>' +
                        (post.summary ? '<p class="post-summary">' + escapeHtml(post.summary) + '</p>' : "") +
                        '<p class="post-body">' + escapeHtml(post.body) + '</p>' +
                        renderMedia(mediaResponse.data || []) +
                        '<div class="post-actions">' +
                            '<button class="post-action' + (post.viewer_reaction === "like" ? " is-active" : "") + '" type="button" data-reaction="like" data-post-id="' + escapeHtml(post.id) + '">Like - ' + window.HollowsideAuth.formatCountLabel(post.like_count, "Like", "Likes") + '</button>' +
                            '<button class="post-action' + (post.viewer_reaction === "dislike" ? " is-active" : "") + '" type="button" data-reaction="dislike" data-post-id="' + escapeHtml(post.id) + '">Dislike - ' + window.HollowsideAuth.formatCountLabel(post.dislike_count, "Dislike", "Dislikes") + '</button>' +
                            '<span class="account-chip">' + window.HollowsideAuth.formatCountLabel(post.comment_count, "Comment", "Comments") + '</span>' +
                        '</div>' +
                        renderComments(commentsResponse.data || []) +
                        (viewerContext && viewerContext.can_comment_posts
                            ? '<form class="comment-form" data-comment-form data-post-id="' + escapeHtml(post.id) + '">' +
                                '<textarea maxlength="1500" placeholder="Write a comment..."></textarea>' +
                                '<div class="account-actions"><button class="account-button primary" type="submit">Comment</button></div>' +
                              '</form>'
                            : (!viewerContext
                                ? '<p class="account-note">Log in to react or comment.</p>'
                                : '<p class="account-note">Comments unlock automatically once an account becomes a Trusted Member or higher.</p>')) +
                    '</article>'
                );
            }));

            feed.innerHTML = blocks.join("");
        } catch (error) {
            feed.innerHTML = "";
            feedCopy.textContent = "Unable to load official posts.";
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading the news feed.",
                "error"
            );
        }
    }

    feed.addEventListener("click", async function (event) {
        var reaction = event.target.getAttribute("data-reaction");
        var postId = event.target.getAttribute("data-post-id");
        if (!reaction || !postId) {
            return;
        }

        try {
            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent("/news");
                return;
            }

            if (event.target.classList.contains("is-active")) {
                var clearResult = await supabase.rpc("clear_post_reaction", { p_post_id: postId });
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

            loadFeed();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while reacting to the post.",
                "error"
            );
        }
    });

    feed.addEventListener("submit", async function (event) {
        var form = event.target;
        if (!form.hasAttribute("data-comment-form")) {
            return;
        }

        event.preventDefault();

        var postId = form.getAttribute("data-post-id");
        var textarea = form.querySelector("textarea");
        var body = textarea.value.trim();

        if (!body) {
            textarea.focus();
            return;
        }

        try {
            var commentResponse = await supabase.rpc("create_post_comment", {
                p_post_id: postId,
                p_body: body,
                p_parent_id: null
            });

            if (commentResponse.error) {
                throw commentResponse.error;
            }

            textarea.value = "";
            loadFeed();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while posting your comment.",
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
                p_summary: summaryInput.value.trim()
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
            loadFeed();
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
