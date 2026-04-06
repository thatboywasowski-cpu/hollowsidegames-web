document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("post-status");
    var params = new URLSearchParams(window.location.search);
    var postId = params.get("id");
    var subtitle = document.getElementById("post-subtitle");
    var title = document.getElementById("post-title");
    var summary = document.getElementById("post-summary");
    var authorMeta = document.getElementById("post-author-meta");
    var date = document.getElementById("post-date");
    var media = document.getElementById("post-media");
    var actions = document.getElementById("post-actions");
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

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function formatDateTime(value) {
        return new Date(value).toLocaleString();
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

                    return '<div class="post-media-item"><img src="' + escapeHtml(item.media_url) + '" alt="News attachment"></div>';
                }).join("") +
            "</div>";
    }

    function renderComments(items) {
        commentsCopy.textContent = items.length ? items.length + " comment" + (items.length === 1 ? "" : "s") : "No comments yet.";

        if (!items.length) {
            comments.innerHTML = '<p class="post-empty">No comments yet.</p>';
            return;
        }

        comments.innerHTML =
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
                                '<span>' + escapeHtml(formatDateTime(comment.created_at)) + '</span>' +
                            '</div>' +
                            '<p>' + escapeHtml(comment.body) + '</p>' +
                        '</article>'
                    );
                }).join("") +
            "</div>";
    }

    function renderCommentForm() {
        if (!viewerContext) {
            commentFormSlot.innerHTML = '<p class="account-note">Log in to react or comment on this post.</p>';
            return;
        }

        if (!viewerContext.can_comment_posts) {
            commentFormSlot.innerHTML = '<p class="account-note">Comments unlock automatically once an account becomes a Trusted Member or higher.</p>';
            return;
        }

        commentFormSlot.innerHTML =
            '<form class="comment-form" id="single-post-comment-form" action="#" method="post">' +
                '<textarea maxlength="1500" placeholder="Write a comment..."></textarea>' +
                '<div class="account-actions"><button class="account-button primary" type="submit">Comment</button></div>' +
            "</form>";
    }

    function syncCounts(post) {
        likeCount.textContent = window.HollowsideAuth.formatCountLabel(post.like_count, "Like", "Likes");
        dislikeCount.textContent = window.HollowsideAuth.formatCountLabel(post.dislike_count, "Dislike", "Dislikes");
        commentCount.textContent = window.HollowsideAuth.formatCountLabel(post.comment_count, "Comment", "Comments");
    }

    function renderActions() {
        actions.innerHTML =
            '<button class="post-action' + (postCard.viewer_reaction === "like" ? " is-active" : "") + '" type="button" data-reaction="like">' + window.HollowsideAuth.formatCountLabel(postCard.like_count, "Like", "Likes") + "</button>" +
            '<button class="post-action' + (postCard.viewer_reaction === "dislike" ? " is-active" : "") + '" type="button" data-reaction="dislike">' + window.HollowsideAuth.formatCountLabel(postCard.dislike_count, "Dislike", "Dislikes") + "</button>";
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
            var contextResponse = await supabase.rpc("get_my_account_context");
            viewerContext = contextResponse.data && contextResponse.data[0] ? contextResponse.data[0] : null;

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

            document.title = postCard.title + " | Hollowside Games";
            subtitle.textContent = (postCard.subtitle || "Official Update").toUpperCase();
            title.textContent = postCard.title;
            summary.textContent = postCard.summary || "No short description yet.";
            authorMeta.innerHTML = renderAuthorMeta(postCard);
            date.textContent = formatDateTime(postCard.created_at);
            body.innerHTML = escapeHtml(postCard.body || "").replace(/\n/g, "<br>");
            authorLink.href = "/profile?id=" + encodeURIComponent(postCard.author_account_id);
            syncCounts(postCard);
            renderActions();
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
        if (!reaction || !postCard) {
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

    commentFormSlot.addEventListener("submit", async function (event) {
        if (event.target.id !== "single-post-comment-form") {
            return;
        }

        event.preventDefault();
        var textarea = event.target.querySelector("textarea");
        var value = textarea.value.trim();

        if (!value) {
            textarea.focus();
            return;
        }

        try {
            var commentResponse = await supabase.rpc("create_post_comment", {
                p_post_id: postId,
                p_body: value,
                p_parent_id: null
            });

            if (commentResponse.error) {
                throw commentResponse.error;
            }

            textarea.value = "";
            await loadPost();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while posting your comment.",
                "error"
            );
        }
    });

    loadPost();
});
