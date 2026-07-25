document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("post-status");
    var params = new URLSearchParams(window.location.search);
    var postId = params.get("id");
    var subtitle = document.getElementById("post-subtitle");
    var title = document.getElementById("post-title");
    var summary = document.getElementById("post-summary");
    var authorMeta = document.getElementById("post-author-meta");
    var date = document.getElementById("post-date");
    var edited = document.getElementById("post-edited");
    var media = document.getElementById("post-media");
    var actions = document.getElementById("post-actions");
    var ownerTools = document.getElementById("post-owner-tools");
    var body = document.getElementById("post-body");
    var likeCount = document.getElementById("post-like-count");
    var dislikeCount = document.getElementById("post-dislike-count");
    var commentCount = document.getElementById("post-comment-count");
    var authorLink = document.getElementById("post-author-link");
    var commentsCopy = document.getElementById("post-comments-copy");
    var commentFormSlot = document.getElementById("post-comment-form-slot");
    var comments = document.getElementById("post-comments");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    if (!postId) {
        window.HollowsideAuth.setStatus(status, "No post ID was provided in the URL.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;
    var postCard = null;
    var replyingTo = null;

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function formatDateTime(value) {
        return new Date(value).toLocaleString();
    }

    function hasBeenEdited(post) {
        return !!(post && post.updated_at && post.created_at && new Date(post.updated_at).getTime() > new Date(post.created_at).getTime() + 1000);
    }

    function canManageNewsPost(post) {
        return !!(
            viewerContext &&
            post &&
            viewerContext.id === post.author_id &&
            viewerContext.can_publish_news
        );
    }

    function canDeleteNewsPost(post) {
        return !!(
            viewerContext &&
            post &&
            (
                (viewerContext.id === post.author_id && viewerContext.can_publish_news) ||
                viewerContext.can_moderate_news
            )
        );
    }

    function canDeleteComment(comment) {
        return !!(
            viewerContext &&
            comment &&
            (
                viewerContext.id === comment.author_id ||
                (postCard && viewerContext.id === postCard.author_id) ||
                viewerContext.can_moderate_content
            )
        );
    }

    function renderAuthorMeta(post) {
        var badge = window.HollowsideAuth.getVerificationBadge({
            is_verified: post.author_is_verified,
            verification_mode: post.author_verification_mode
        }, "Verified Hollowside account");

        return (
            '<a class="news-author-line" href="/profile?id=' + encodeURIComponent(post.author_account_id) + '">' +
                '<span>' + escapeHtml(post.author_display_name) + "</span>" +
                '<span class="identity-line">@' + escapeHtml(post.author_username) + badge + "</span>" +
            "</a>"
        );
    }

    function renderMedia(items) {
        if (!items.length) {
            media.innerHTML = "";
            return;
        }

        media.innerHTML =
            '<div class="post-media-grid">' +
                items.map(function (item) {
                    if (item.media_type === "video") {
                        return '<div class="post-media-item"><video controls preload="metadata" src="' + escapeHtml(item.media_url) + '"></video></div>';
                    }

                    return '<button class="post-media-item" type="button" data-open-image="' + escapeHtml(item.media_url) + '"><img src="' + escapeHtml(item.media_url) + '" alt="News attachment"></button>';
                }).join("") +
            "</div>";
    }

    function getCommentMedia(comment) {
        if (!comment || !comment.media_urls) {
            return [];
        }

        if (Array.isArray(comment.media_urls)) {
            return comment.media_urls;
        }

        try {
            var parsed = JSON.parse(comment.media_urls);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function renderCommentMedia(comment) {
        var urls = getCommentMedia(comment);
        if (!urls.length || comment.viewer_reaction === "dislike") {
            return "";
        }

        return (
            '<div class="comment-media-grid">' +
                urls.map(function (url) {
                    return '<button class="comment-media-item" type="button" data-open-image="' + escapeHtml(url) + '"><img src="' + escapeHtml(url) + '" alt="Comment attachment"></button>';
                }).join("") +
            "</div>"
        );
    }

    function buildCommentTree(items) {
        var lookup = {};
        var roots = [];

        items.forEach(function (comment) {
            comment.replies = [];
            lookup[String(comment.id)] = comment;
        });

        items.forEach(function (comment) {
            if (comment.parent_id && lookup[String(comment.parent_id)]) {
                lookup[String(comment.parent_id)].replies.push(comment);
            } else {
                roots.push(comment);
            }
        });

        return roots;
    }

    function renderComment(comment, depth) {
        var badge = window.HollowsideAuth.getVerificationBadge({
            is_verified: comment.author_is_verified,
            verification_mode: comment.author_verification_mode
        }, "Verified Hollowside account");
        var hidden = comment.viewer_reaction === "dislike";
        var replyButton = viewerContext && viewerContext.can_comment_posts
            ? '<button class="comment-action" type="button" data-comment-reply data-comment-id="' + escapeHtml(comment.id) + '" data-author-name="' + escapeHtml(comment.author_display_name) + '">Reply</button>'
            : "";
        var deleteButton = canDeleteComment(comment)
            ? '<button class="comment-delete-button" type="button" data-comment-delete="' + escapeHtml(comment.id) + '" aria-label="Delete comment"><img src="/trash.png" alt=""></button>'
            : "";
        var reactionButtons = viewerContext
            ? '<button class="comment-action' + (comment.viewer_reaction === "like" ? " is-active" : "") + '" type="button" data-comment-reaction="like" data-comment-id="' + escapeHtml(comment.id) + '">Like - ' + window.HollowsideAuth.formatCountLabel(comment.like_count, "Like", "Likes") + '</button>' +
              '<button class="comment-action' + (comment.viewer_reaction === "dislike" ? " is-active" : "") + '" type="button" data-comment-reaction="dislike" data-comment-id="' + escapeHtml(comment.id) + '">Dislike - ' + window.HollowsideAuth.formatCountLabel(comment.dislike_count, "Dislike", "Dislikes") + '</button>'
            : "";
        var profileHref = "/profile?id=" + encodeURIComponent(comment.author_account_id);
        var avatarMarkup = comment.author_avatar_url
            ? '<img src="' + escapeHtml(comment.author_avatar_url) + '" alt="' + escapeHtml(comment.author_display_name) + ' profile picture">'
            : escapeHtml(window.HollowsideAuth.getInitials({ display_name: comment.author_display_name }, null));

        return (
            '<article class="comment-card' + (depth ? " is-reply" : "") + (hidden ? " is-hidden-comment" : "") + '" data-comment-id="' + escapeHtml(comment.id) + '">' +
                '<div class="comment-meta">' +
                    '<a class="comment-author-avatar" href="' + profileHref + '" aria-label="View ' + escapeHtml(comment.author_display_name) + ' profile">' + avatarMarkup + '</a>' +
                    '<span class="comment-author-copy">' +
                        '<strong>' + escapeHtml(comment.author_display_name) + '</strong>' +
                        '<a class="comment-author-link identity-line" href="' + profileHref + '">@' + escapeHtml(comment.author_username) + badge + '</a>' +
                    '</span>' +
                    '<span class="comment-date">' + escapeHtml(formatDateTime(comment.created_at)) + '</span>' +
                '</div>' +
                (hidden
                    ? '<p class="comment-hidden-copy">This comment will no longer be shown to you.</p>'
                    : '<p>' + escapeHtml(comment.body || "") + '</p>' + renderCommentMedia(comment)) +
                '<div class="comment-actions">' + reactionButtons + replyButton + '</div>' +
                deleteButton +
            '</article>' +
            (comment.replies || []).map(function (reply) {
                return renderComment(reply, depth + 1);
            }).join("")
        );
    }

    function renderComments(items) {
        commentsCopy.textContent = items.length ? items.length + " comment" + (items.length === 1 ? "" : "s") : "No comments yet.";

        if (!items.length) {
            comments.innerHTML = '<p class="post-empty">No comments yet.</p>';
            return;
        }

        comments.innerHTML =
            '<div class="comment-list">' +
                buildCommentTree(items).map(function (comment) {
                    return renderComment(comment, 0);
                }).join("") +
            "</div>";
    }

    function resetReplyState() {
        replyingTo = null;
        var form = document.getElementById("single-post-comment-form");
        if (!form) {
            return;
        }

        form.removeAttribute("data-parent-id");
        var textarea = form.querySelector("textarea");
        if (textarea) {
            textarea.placeholder = "Comment";
        }
    }

    function syncCommentFileName(form) {
        var input = form.querySelector('[data-comment-image-input]');
        var label = form.querySelector("[data-comment-file-name]");
        if (label) {
            label.textContent = input && input.files && input.files[0] ? input.files[0].name : "";
        }
    }

    function renderCommentForm() {
        if (!viewerContext) {
            commentFormSlot.innerHTML = '<p class="account-note">Log in to react or comment on this post.</p>';
            return;
        }

        if (!viewerContext.can_comment_posts) {
            if (viewerContext.restriction_label === "Suspended") {
                commentFormSlot.innerHTML = '<p class="account-note">Suspended accounts can still react, but commenting is paused until the suspension ends.</p>';
            } else if (viewerContext.restriction_label === "Banned") {
                commentFormSlot.innerHTML = '<p class="account-note">Banned accounts cannot comment. News reading stays available, but community actions are locked.</p>';
            } else {
                commentFormSlot.innerHTML = '<p class="account-note">Comments unlock automatically once an account becomes a Trusted Member or higher.</p>';
            }
            return;
        }

        commentFormSlot.innerHTML =
            '<form class="comment-form" id="single-post-comment-form" action="#" method="post">' +
                '<div class="comment-input-row">' +
                    '<label class="comment-image-button" title="Add image">' +
                        '<input data-comment-image-input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
                        '<img src="/Hollowside%20Games%20picture%20comment.png" alt="Add image">' +
                    '</label>' +
                    '<textarea maxlength="1500" placeholder="Comment"></textarea>' +
                '</div>' +
                '<span class="comment-file-name" data-comment-file-name></span>' +
                '<div class="account-actions"><button class="account-button primary" type="submit">Comment</button></div>' +
            "</form>";
    }

    async function uploadCommentImage(commentId, file) {
        if (!file) {
            return;
        }

        if (!file.type || file.type.indexOf("image/") !== 0) {
            throw new Error("Please choose an image file for the comment.");
        }

        if (file.size > 20 * 1024 * 1024) {
            throw new Error("Item is too large! Compress this file or choose a smaller one.");
        }

        var extension = (file.name.split(".").pop() || "png").toLowerCase();
        var path = viewerContext.id + "/comments/" + postId + "/" + commentId + "-" + Date.now() + "." + extension;
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

        var attachResult = await supabase.rpc("attach_comment_media", {
            p_comment_id: commentId,
            p_media_type: "image",
            p_media_url: publicUrlResult.data.publicUrl,
            p_media_path: path,
            p_sort_order: 0
        });

        if (attachResult.error) {
            throw attachResult.error;
        }
    }


    function syncCounts(post) {
        likeCount.textContent = window.HollowsideAuth.formatCountLabel(post.like_count, "Like", "Likes");
        dislikeCount.textContent = window.HollowsideAuth.formatCountLabel(post.dislike_count, "Dislike", "Dislikes");
        commentCount.textContent = window.HollowsideAuth.formatCountLabel(post.comment_count, "Comment", "Comments");
    }

    function renderActions() {
        actions.innerHTML =
            '<button class="post-action' + (postCard.viewer_reaction === "like" ? " is-active" : "") + '" type="button" data-reaction="like">' + window.HollowsideAuth.formatCountLabel(postCard.like_count, "Like", "Likes") + "</button>" +
            '<button class="post-action' + (postCard.viewer_reaction === "dislike" ? " is-active" : "") + '" type="button" data-reaction="dislike">' + window.HollowsideAuth.formatCountLabel(postCard.dislike_count, "Dislike", "Dislikes") + "</button>" +
            (viewerContext && viewerContext.account_id !== postCard.author_account_id
                ? '<button class="post-action" type="button" data-report-post>Report Post</button>'
                : "");
    }


    function renderOwnerTools(post) {
        if (!canManageNewsPost(post) && !canDeleteNewsPost(post)) {
            ownerTools.innerHTML = "";
            return;
        }

        ownerTools.innerHTML =
            '<div class="post-owner-tools">' +
                '<div class="post-owner-actions">' +
                    (canManageNewsPost(post) ? '<button class="post-action" type="button" data-news-edit-toggle>Edit Post</button>' : '') +
                    (canDeleteNewsPost(post) ? '<button class="post-action is-danger" type="button" data-news-delete>Delete Post</button>' : '') +
                "</div>" +
                (canManageNewsPost(post) ? '<form class="post-edit-form" id="full-news-edit-form" hidden>' +
                    '<div class="post-edit-grid">' +
                        '<div>' +
                            '<label for="full-edit-subtitle">Subtitle</label>' +
                            '<input id="full-edit-subtitle" name="subtitle" type="text" maxlength="48" value="' + escapeHtml(post.subtitle || "") + '">' +
                        "</div>" +
                        '<div>' +
                            '<label for="full-edit-title">Title</label>' +
                            '<input id="full-edit-title" name="title" type="text" maxlength="120" value="' + escapeHtml(post.title || "") + '">' +
                        "</div>" +
                    "</div>" +
                    '<div>' +
                        '<label for="full-edit-summary">Short Description</label>' +
                        '<input id="full-edit-summary" name="summary" type="text" maxlength="240" value="' + escapeHtml(post.summary || "") + '">' +
                    "</div>" +
                    '<div>' +
                        '<label for="full-edit-body">Full Description</label>' +
                        '<textarea id="full-edit-body" name="body" maxlength="12000">' + escapeHtml(post.body || "") + '</textarea>' +
                    "</div>" +
                    '<div class="account-actions">' +
                        '<button class="account-button primary" type="submit">Save Changes</button>' +
                        '<button class="account-button" type="button" data-news-edit-cancel>Cancel</button>' +
                    "</div>" +
                "</form>" : '') +
            '</div>';
    }

    async function fetchDetail() {
        var detailResponse = await supabase.rpc("get_post_detail", {
            p_post_id: postId
        });

        if (!detailResponse.error && detailResponse.data && detailResponse.data[0]) {
            return detailResponse.data[0];
        }

        var fallbackResponse = await supabase.rpc("get_post_feed", {
            p_post_type: "news",
            p_author_account_id: null,
            p_limit: 50
        });

        if (fallbackResponse.error) {
            throw detailResponse.error || fallbackResponse.error;
        }

        var fallback = (fallbackResponse.data || []).find(function (item) {
            return item.id === postId;
        });

        if (!fallback) {
            return null;
        }

        if (!fallback.subtitle) {
            fallback.subtitle = "Official Update";
        }

        return fallback;
    }

    async function loadPost() {
        try {
            try {
                var contextResponse = await supabase.rpc("get_my_account_context");
                viewerContext = !contextResponse.error && contextResponse.data && contextResponse.data[0]
                    ? window.HollowsideAuth.applyRoleEmulation(contextResponse.data[0], null)
                    : null;
            } catch (contextError) {
                viewerContext = null;
            }

            postCard = await fetchDetail();

            if (!postCard) {
                window.HollowsideAuth.setStatus(status, "That post could not be found.", "error");
                return;
            }

            var mediaResponse = await supabase.rpc("get_post_media", {
                p_post_id: postId
            });
            var commentsResponse = await supabase.rpc("get_post_comments", {
                p_post_id: postId,
                p_limit: 80
            });

            if (mediaResponse.error) {
                throw mediaResponse.error;
            }

            if (commentsResponse.error) {
                throw commentsResponse.error;
            }

            document.title = postCard.title + " | Hollowside LLC";
            subtitle.textContent = (postCard.subtitle || "Official Update").toUpperCase();
            title.textContent = postCard.title;
            summary.textContent = postCard.summary || "No short description yet.";
            authorMeta.innerHTML = renderAuthorMeta(postCard);
            date.textContent = formatDateTime(postCard.created_at);
            edited.hidden = !hasBeenEdited(postCard);
            edited.textContent = hasBeenEdited(postCard) ? "Last Edited: " + formatDateTime(postCard.updated_at) : "";
            body.innerHTML = escapeHtml(postCard.body || "").replace(/\n/g, "<br>");
            authorLink.href = "/profile?id=" + encodeURIComponent(postCard.author_account_id);
            syncCounts(postCard);
            renderActions();
            renderOwnerTools(postCard);
            renderMedia(mediaResponse.data || []);
            renderCommentForm();
            renderComments(commentsResponse.data || []);

            window.HollowsideAuth.setStatus(status, "", "info");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading this post.",
                "error"
            );
        }
    }

    actions.addEventListener("click", async function (event) {
        var reaction = event.target.getAttribute("data-reaction");
        var reportPost = event.target.hasAttribute("data-report-post");
        if (!reaction || !postCard) {
            if (!reportPost || !postCard) {
                return;
            }

            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
                return;
            }

            var reason = window.prompt("Report reason:", "Spam");
            if (reason === null) {
                return;
            }

            var details = window.prompt("Extra details (optional):", "") || "";

            try {
                var reportResponse = await supabase.rpc("create_report", {
                    p_target_type: "post",
                    p_target_account_id: postCard.author_account_id,
                    p_target_post_id: postId,
                    p_reason: reason.trim(),
                    p_details: details.trim()
                });

                if (reportResponse.error) {
                    throw reportResponse.error;
                }

                window.HollowsideAuth.setStatus(status, "Report submitted.", "success");
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while submitting the report.",
                    "error"
                );
            }
            return;
        }

        try {
            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
                return;
            }

            if (event.target.classList.contains("is-active")) {
                var clearResult = await supabase.rpc("clear_post_reaction", {
                    p_post_id: postId
                });

                if (clearResult.error) {
                    throw clearResult.error;
                }

                postCard.viewer_reaction = null;
            } else {
                var reactionResult = await supabase.rpc("set_post_reaction", {
                    p_post_id: postId,
                    p_reaction_type: reaction
                });

                if (reactionResult.error) {
                    throw reactionResult.error;
                }

                postCard.viewer_reaction = reaction;
            }

            await loadPost();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while reacting to the post.",
                "error"
            );
        }
    });

    media.addEventListener("click", function (event) {
        var imageButton = event.target.closest("[data-open-image]");
        if (!imageButton) {
            return;
        }

        window.HollowsideAuth.openImageViewer(imageButton.getAttribute("data-open-image"), "News attachment");
    });

    ownerTools.addEventListener("click", async function (event) {
        if (event.target.hasAttribute("data-news-edit-toggle")) {
            var form = document.getElementById("full-news-edit-form");
            if (form) {
                form.hidden = !form.hidden;
            }
            return;
        }

        if (event.target.hasAttribute("data-news-edit-cancel")) {
            var cancelForm = document.getElementById("full-news-edit-form");
            if (cancelForm) {
                cancelForm.hidden = true;
            }
            return;
        }

        if (event.target.hasAttribute("data-news-delete")) {
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

                window.location.href = "/news";
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while deleting the news post.",
                    "error"
                );
            }
        }
    });

    ownerTools.addEventListener("submit", async function (event) {
        if (event.target.id !== "full-news-edit-form") {
            return;
        }

        event.preventDefault();

        var form = event.target;
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
            await loadPost();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating this post.",
                "error"
            );
        }
    });

    comments.addEventListener("click", async function (event) {
        var imageButton = event.target.closest("[data-open-image]");
        var reaction = event.target.getAttribute("data-comment-reaction");
        var commentId = event.target.getAttribute("data-comment-id");
        var replyButton = event.target.closest("[data-comment-reply]");
        var deleteCommentId = event.target.closest("[data-comment-delete]");

        if (imageButton) {
            window.HollowsideAuth.openImageViewer(imageButton.getAttribute("data-open-image"), "Comment attachment");
            return;
        }

        if (replyButton) {
            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
                return;
            }

            replyingTo = {
                id: replyButton.getAttribute("data-comment-id"),
                name: replyButton.getAttribute("data-author-name") || "this user"
            };

            var form = document.getElementById("single-post-comment-form");
            if (form) {
                form.setAttribute("data-parent-id", replyingTo.id);
                var textarea = form.querySelector("textarea");
                if (textarea) {
                    textarea.placeholder = "Reply to " + replyingTo.name + "'s comment";
                    textarea.focus();
                }
            }
            return;
        }

        if (deleteCommentId) {
            if (!window.confirm("Delete this comment? This also removes its replies and attached images.")) {
                return;
            }

            try {
                var deleteResult = await supabase.rpc("delete_post_comment", {
                    p_comment_id: Number(deleteCommentId.getAttribute("data-comment-delete"))
                });

                if (deleteResult.error) {
                    throw deleteResult.error;
                }

                await loadPost();
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while deleting the comment.",
                    "error"
                );
            }
            return;
        }

        if (!reaction || !commentId) {
            return;
        }

        try {
            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
                return;
            }

            if (event.target.classList.contains("is-active")) {
                var clearResult = await supabase.rpc("clear_comment_reaction", {
                    p_comment_id: Number(commentId)
                });

                if (clearResult.error) {
                    throw clearResult.error;
                }
            } else {
                var reactionResult = await supabase.rpc("set_comment_reaction", {
                    p_comment_id: Number(commentId),
                    p_reaction_type: reaction
                });

                if (reactionResult.error) {
                    throw reactionResult.error;
                }
            }

            await loadPost();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while reacting to the comment.",
                "error"
            );
        }
    });

    commentFormSlot.addEventListener("change", function (event) {
        var form = event.target.closest("#single-post-comment-form");
        if (form && event.target.hasAttribute("data-comment-image-input")) {
            syncCommentFileName(form);
        }
    });

    commentFormSlot.addEventListener("focusout", function (event) {
        var form = event.target.closest("#single-post-comment-form");
        if (!form) {
            return;
        }

        window.setTimeout(function () {
            if (replyingTo && !form.contains(document.activeElement)) {
                resetReplyState();
            }
        }, 0);
    });

    commentFormSlot.addEventListener("submit", async function (event) {
        if (event.target.id !== "single-post-comment-form") {
            return;
        }

        event.preventDefault();
        var form = event.target;
        var textarea = form.querySelector("textarea");
        var fileInput = form.querySelector("[data-comment-image-input]");
        var value = textarea.value.trim();
        var imageFile = fileInput && fileInput.files ? fileInput.files[0] : null;

        if (!value && !imageFile) {
            textarea.focus();
            return;
        }

        try {
            var commentResponse = await supabase.rpc("create_post_comment", {
                p_post_id: postId,
                p_body: value,
                p_parent_id: form.getAttribute("data-parent-id") ? Number(form.getAttribute("data-parent-id")) : null
            });

            if (commentResponse.error) {
                throw commentResponse.error;
            }

            if (imageFile) {
                await uploadCommentImage(commentResponse.data.id, imageFile);
            }

            textarea.value = "";
            if (fileInput) {
                fileInput.value = "";
            }
            syncCommentFileName(form);
            resetReplyState();
            await loadPost();
        } catch (error) {
            var message = error && error.message && /size|large|payload|limit|exceed/i.test(error.message)
                ? "Item is too large! Compress this file or choose a smaller one."
                : (error && error.message ? error.message : "Something went wrong while posting your comment.");
            window.HollowsideAuth.setStatus(
                status,
                message,
                "error"
            );
        }
    });

    loadPost();
});
