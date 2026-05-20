document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("profile-status");
    var params = new URLSearchParams(window.location.search);
    var accountId = params.get("id");
    var avatar = document.getElementById("profile-avatar");
    var displayName = document.getElementById("profile-display-name");
    var displayBadge = document.getElementById("profile-display-badge");
    var username = document.getElementById("profile-username");
    var usernameBadge = document.getElementById("profile-username-badge");
    var role = document.getElementById("profile-role");
    var memberSince = document.getElementById("profile-member-since");
    var bio = document.getElementById("profile-bio");
    var followerCount = document.getElementById("profile-follower-count");
    var followingCount = document.getElementById("profile-following-count");
    var friendCount = document.getElementById("profile-friend-count");
    var chipRow = document.querySelector(".account-chip-row");
    var actions = document.getElementById("profile-actions");
    var followers = document.getElementById("profile-followers");
    var following = document.getElementById("profile-following");
    var friends = document.getElementById("profile-friends");
    var composerCard = document.getElementById("profile-composer-card");
    var postForm = document.getElementById("profile-post-form");
    var postBody = document.getElementById("profile-post-body");
    var postMedia = document.getElementById("profile-post-media");
    var postCopy = document.getElementById("profile-post-copy");
    var postFeed = document.getElementById("profile-post-feed");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    if (!accountId) {
        window.HollowsideAuth.setStatus(status, "No account ID was provided in the URL.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var viewerContext = null;
    var profileCard = null;
    var replyingByPost = {};

    function escapeHtml(value) {
        return window.HollowsideAuth.escapeHtml(value);
    }

    function setAvatar(card) {
        avatar.innerHTML = "";
        if (card.avatar_url) {
            var image = document.createElement("img");
            image.src = card.avatar_url;
            image.alt = "Profile picture";
            avatar.appendChild(image);
        } else {
            avatar.textContent = window.HollowsideAuth.getInitials(card, null);
        }
    }

    function renderConnectionList(target, items) {
        if (!items.length) {
            target.innerHTML = '<p class="account-note">Nothing to show yet.</p>';
            return;
        }

        target.innerHTML = items.map(function (card) {
            var avatarMarkup = card.avatar_url
                ? '<span class="account-avatar-preview"><img src="' + escapeHtml(card.avatar_url) + '" alt="Profile picture"></span>'
                : '<span class="account-avatar-preview">' + window.HollowsideAuth.getInitials(card, null) + "</span>";
            var badge = window.HollowsideAuth.getVerificationBadge(card, "Verified Hollowside account");

            return (
                '<a class="profile-mini-card" href="/profile?id=' + encodeURIComponent(card.account_id) + '">' +
                    avatarMarkup +
                    '<div class="profile-mini-copy">' +
                        '<strong>' + escapeHtml(card.display_name) + '</strong>' +
                        '<span class="identity-line">@' + escapeHtml(card.username) + badge + '</span>' +
                        '<p>' + escapeHtml(card.role_label) + '</p>' +
                    '</div>' +
                '</a>'
            );
        }).join("");
    }

    async function loadConnections(kind, target) {
        var response = await supabase.rpc("get_profile_connections", {
            p_account_id: accountId,
            p_kind: kind,
            p_limit: 8
        });

        if (response.error) {
            throw response.error;
        }

        renderConnectionList(target, response.data || []);
    }

    function updateStatBlock(element, value) {
        element.textContent = window.HollowsideAuth.formatCompactCount(value);
        element.title = String(value || 0);
    }

    async function submitReport(targetType, targetAccountId, targetPostId) {
        if (!viewerContext) {
            window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
            return;
        }

        var reason = window.prompt("Report reason:", targetType === "post" ? "Spam" : "Harassment");
        if (reason === null) {
            return;
        }

        var details = window.prompt("Extra details (optional):", "") || "";

        try {
            var response = await supabase.rpc("create_report", {
                p_target_type: targetType,
                p_target_account_id: targetAccountId,
                p_target_post_id: targetPostId,
                p_reason: reason.trim(),
                p_details: details.trim()
            });

            if (response.error) {
                throw response.error;
            }

            window.HollowsideAuth.setStatus(status, "Report submitted.", "success");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while submitting the report.",
                "error"
            );
        }
    }

    function setRestrictionChip(card) {
        var existing = document.getElementById("profile-restriction-chip");
        if (existing) {
            existing.remove();
        }

        if (!chipRow || !card.public_restriction_label) {
            return;
        }

        var chip = document.createElement("span");
        chip.className = "account-chip";
        chip.id = "profile-restriction-chip";

        if (viewerContext && viewerContext.account_id === card.account_id && card.public_restriction_label === "Suspended" && card.restriction_until) {
            chip.textContent = "Suspended Until: " + new Date(card.restriction_until).toLocaleString();
        } else {
            chip.textContent = card.public_restriction_label;
        }

        chipRow.appendChild(chip);
    }

    function renderActions(card) {
        actions.innerHTML = "";

        if (viewerContext && viewerContext.account_id === card.account_id) {
            actions.innerHTML = '<a class="account-button primary" href="/account">Open Account Settings</a>';
            return;
        }

        if (!viewerContext) {
            actions.innerHTML = '<a class="account-button primary" href="/login?redirect=' + encodeURIComponent('/profile?id=' + card.account_id) + '">Log in to follow</a>';
            return;
        }

        var followLabel = card.viewer_is_following ? "Unfollow" : "Follow";
        var followButton = document.createElement("button");
        followButton.className = "account-button primary";
        followButton.type = "button";
        followButton.textContent = followLabel;

        followButton.addEventListener("click", async function () {
            try {
                var response = await supabase.rpc("set_follow_state", {
                    p_target_account_id: accountId,
                    p_follow: !card.viewer_is_following
                });

                if (response.error) {
                    throw response.error;
                }

                var next = response.data && response.data[0];
                if (next) {
                    card.viewer_is_following = next.viewer_is_following;
                    card.viewer_is_followed_by = next.viewer_is_followed_by;
                    card.viewer_is_friend = next.viewer_is_friend;
                    card.follower_count = next.follower_count;
                    card.following_count = next.following_count;
                    card.friend_count = next.friend_count;
                    updateStatBlock(followerCount, card.follower_count);
                    updateStatBlock(followingCount, card.following_count);
                    updateStatBlock(friendCount, card.friend_count);
                }

                renderActions(card);
                loadConnections("followers", followers);
                loadConnections("following", following);
                loadConnections("friends", friends);
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while updating the follow state.",
                    "error"
                );
            }
        });

        actions.appendChild(followButton);

        var reportButton = document.createElement("button");
        reportButton.className = "account-button";
        reportButton.type = "button";
        reportButton.textContent = "Report";
        reportButton.addEventListener("click", function () {
            submitReport("account", card.account_id, null);
        });
        actions.appendChild(reportButton);

        var blockButton = document.createElement("button");
        blockButton.className = "account-button";
        blockButton.type = "button";
        blockButton.textContent = "Block";
        blockButton.addEventListener("click", async function () {
            try {
                var response = await supabase.rpc("set_block_state", {
                    p_target_account_id: card.account_id,
                    p_block: true,
                    p_reason: "Blocked from profile view"
                });

                if (response.error) {
                    throw response.error;
                }

                window.HollowsideAuth.setStatus(status, "Account blocked. You can manage blocked accounts in Safety settings.", "success");
                window.setTimeout(function () {
                    window.location.href = "/account#safety";
                }, 650);
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while blocking that account.",
                    "error"
                );
            }
        });
        actions.appendChild(blockButton);

        if (card.viewer_is_friend) {
            var friendChip = document.createElement("span");
            friendChip.className = "account-chip";
            friendChip.textContent = "Friends";
            actions.appendChild(friendChip);
        } else if (card.viewer_is_followed_by) {
            var followsBackChip = document.createElement("span");
            followsBackChip.className = "account-chip";
            followsBackChip.textContent = "Follows You";
            actions.appendChild(followsBackChip);
        }
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

                    return '<button class="post-media-item" type="button" data-open-image="' + escapeHtml(item.media_url) + '"><img src="' + escapeHtml(item.media_url) + '" alt="Post attachment"></button>';
                }).join("") +
            "</div>"
        );
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

    function canDeleteProfilePost(post) {
        return !!(
            viewerContext &&
            post &&
            (
                (viewerContext.id === post.author_id && viewerContext.can_publish_personal_posts) ||
                viewerContext.can_moderate_content
            )
        );
    }

    function canDeleteComment(comment, post) {
        return !!(
            viewerContext &&
            comment &&
            post &&
            (
                viewerContext.id === comment.author_id ||
                viewerContext.id === post.author_id ||
                viewerContext.can_moderate_content
            )
        );
    }

    function renderComment(comment, depth, post) {
        var badge = window.HollowsideAuth.getVerificationBadge({
            is_verified: comment.author_is_verified,
            verification_mode: comment.author_verification_mode
        }, "Verified Hollowside account");
        var hidden = comment.viewer_reaction === "dislike";
        var replyButton = viewerContext && viewerContext.can_comment_posts
            ? '<button class="comment-action" type="button" data-comment-reply data-comment-id="' + escapeHtml(comment.id) + '" data-author-name="' + escapeHtml(comment.author_display_name) + '">Reply</button>'
            : "";
        var deleteButton = canDeleteComment(comment, post)
            ? '<button class="comment-delete-button" type="button" data-comment-delete="' + escapeHtml(comment.id) + '" aria-label="Delete comment"><img src="/trash.png" alt=""></button>'
            : "";
        var reactionButtons = viewerContext
            ? '<button class="comment-action' + (comment.viewer_reaction === "like" ? " is-active" : "") + '" type="button" data-comment-reaction="like" data-comment-id="' + escapeHtml(comment.id) + '">Like - ' + window.HollowsideAuth.formatCountLabel(comment.like_count, "Like", "Likes") + '</button>' +
              '<button class="comment-action' + (comment.viewer_reaction === "dislike" ? " is-active" : "") + '" type="button" data-comment-reaction="dislike" data-comment-id="' + escapeHtml(comment.id) + '">Dislike - ' + window.HollowsideAuth.formatCountLabel(comment.dislike_count, "Dislike", "Dislikes") + '</button>'
            : "";

        return (
            '<article class="comment-card' + (depth ? " is-reply" : "") + (hidden ? " is-hidden-comment" : "") + '" data-comment-id="' + escapeHtml(comment.id) + '">' +
                '<div class="comment-meta">' +
                    '<strong>' + escapeHtml(comment.author_display_name) + '</strong>' +
                    '<span class="identity-line">@' + escapeHtml(comment.author_username) + badge + '</span>' +
                    '<span>' + escapeHtml(new Date(comment.created_at).toLocaleString()) + '</span>' +
                '</div>' +
                (hidden
                    ? '<p class="comment-hidden-copy">This comment will no longer be shown to you.</p>'
                    : '<p>' + escapeHtml(comment.body || "") + '</p>' + renderCommentMedia(comment)) +
                '<div class="comment-actions">' + reactionButtons + replyButton + '</div>' +
                deleteButton +
            '</article>' +
            (comment.replies || []).map(function (reply) {
                return renderComment(reply, depth + 1, post);
            }).join("")
        );
    }

    function renderComments(items, post) {
        if (!items.length) {
            return '<p class="post-empty">No comments yet.</p>';
        }

        return (
            '<div class="comment-list">' +
                buildCommentTree(items).map(function (comment) {
                    return renderComment(comment, 0, post);
                }).join("") +
            "</div>"
        );
    }

    function renderCommentForm(postId) {
        return (
            '<form class="comment-form" data-comment-form data-post-id="' + escapeHtml(postId) + '">' +
                '<div class="comment-input-row">' +
                    '<label class="comment-image-button" title="Add image">' +
                        '<input data-comment-image-input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
                        '<img src="/Hollowside%20Games%20picture%20comment.png" alt="Add image">' +
                    '</label>' +
                    '<textarea maxlength="1500" placeholder="Comment"></textarea>' +
                '</div>' +
                '<span class="comment-file-name" data-comment-file-name></span>' +
                '<div class="account-actions"><button class="account-button primary" type="submit">Comment</button></div>' +
            '</form>'
        );
    }

    function resetReplyState(postId) {
        delete replyingByPost[postId];
        var form = postFeed.querySelector('[data-comment-form][data-post-id="' + postId + '"]');
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
        var input = form.querySelector("[data-comment-image-input]");
        var label = form.querySelector("[data-comment-file-name]");
        if (label) {
            label.textContent = input && input.files && input.files[0] ? input.files[0].name : "";
        }
    }

    function canManageProfilePost(post) {
        return !!(
            viewerContext &&
            post &&
            viewerContext.id === post.author_id &&
            viewerContext.can_publish_personal_posts
        );
    }

    function renderOwnerTools(post) {
        if (!canManageProfilePost(post) && !canDeleteProfilePost(post)) {
            return "";
        }

        return (
            '<div class="post-owner-tools">' +
                '<div class="post-owner-actions">' +
                    (canManageProfilePost(post) ? '<button class="post-action" type="button" data-profile-edit-toggle data-post-id="' + escapeHtml(post.id) + '">Edit Post</button>' : '') +
                    (canDeleteProfilePost(post) ? '<button class="post-action is-danger" type="button" data-profile-delete data-post-id="' + escapeHtml(post.id) + '">Delete Post</button>' : '') +
                "</div>" +
                (canManageProfilePost(post) ? '<form class="post-edit-form" data-profile-edit-form data-post-id="' + escapeHtml(post.id) + '" hidden>' +
                    '<div>' +
                        '<label for="profile-edit-body-' + escapeHtml(post.id) + '">Edit Post</label>' +
                        '<textarea id="profile-edit-body-' + escapeHtml(post.id) + '" name="body" maxlength="5000">' + escapeHtml(post.body || "") + '</textarea>' +
                    "</div>" +
                    '<div class="account-actions">' +
                        '<button class="account-button primary" type="submit">Save Changes</button>' +
                        '<button class="account-button" type="button" data-profile-edit-cancel data-post-id="' + escapeHtml(post.id) + '">Cancel</button>' +
                    "</div>" +
                "</form>" : '') +
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
                var uploadFile = file;
                if (file.type.indexOf("image/") === 0) {
                    if (file.size > 20 * 1024 * 1024) {
                        throw new Error("Item is too large! Compress this file or choose a smaller one.");
                    }

                    var editedFile = await window.HollowsideAuth.editImageFile(file, {
                        shape: "rect",
                        outputWidth: 1280,
                        outputHeight: 800,
                        title: "Transform your post image to your liking."
                    });

                    if (!editedFile) {
                        return;
                    }

                    uploadFile = editedFile;
                }

                var extension = uploadFile.type.indexOf("image/") === 0 ? "png" : (uploadFile.name.split(".").pop() || "bin").toLowerCase();
                var path = viewerContext.id + "/posts/" + postId + "/" + Date.now() + "-" + index + "." + extension;
                var mediaType = uploadFile.type.indexOf("video/") === 0 ? "video" : "image";
                var uploadResult = await supabase.storage
                    .from("post-media")
                    .upload(path, uploadFile, {
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

    async function uploadCommentImage(postId, commentId, file) {
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

    async function loadProfilePosts() {
        try {
            var response = await supabase.rpc("get_post_feed", {
                p_post_type: "profile",
                p_author_account_id: accountId,
                p_limit: 20
            });

            if (response.error) {
                throw response.error;
            }

            var posts = response.data || [];
            postCopy.textContent = posts.length ? posts.length + " post" + (posts.length === 1 ? "" : "s") : "No profile posts yet.";

            if (!posts.length) {
                postFeed.innerHTML = '<p class="post-empty">This account has not posted anything yet.</p>';
                return;
            }

            var htmlBlocks = await Promise.all(posts.map(async function (post) {
                var mediaResponse = await supabase.rpc("get_post_media", { p_post_id: post.id });
                var commentsResponse = await supabase.rpc("get_post_comments", { p_post_id: post.id, p_limit: 12 });
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
                        '<p class="post-body">' + escapeHtml(post.body) + '</p>' +
                        renderMedia(mediaResponse.data || []) +
                        '<div class="post-actions">' +
                            '<button class="post-action' + (post.viewer_reaction === "like" ? " is-active" : "") + '" type="button" data-reaction="like" data-post-id="' + escapeHtml(post.id) + '">Like - ' + window.HollowsideAuth.formatCountLabel(post.like_count, "Like", "Likes") + '</button>' +
                            '<button class="post-action' + (post.viewer_reaction === "dislike" ? " is-active" : "") + '" type="button" data-reaction="dislike" data-post-id="' + escapeHtml(post.id) + '">Dislike - ' + window.HollowsideAuth.formatCountLabel(post.dislike_count, "Dislike", "Dislikes") + '</button>' +
                            '<span class="account-chip">' + window.HollowsideAuth.formatCountLabel(post.comment_count, "Comment", "Comments") + '</span>' +
                            (viewerContext && viewerContext.account_id !== post.author_account_id
                                ? '<button class="post-action" type="button" data-report-post="' + escapeHtml(post.id) + '" data-post-author="' + escapeHtml(post.author_account_id) + '">Report Post</button>'
                                : '') +
                        '</div>' +
                        renderOwnerTools(post) +
                        renderComments(commentsResponse.data || [], post) +
                        (viewerContext && viewerContext.can_comment_posts
                            ? renderCommentForm(post.id)
                            : (!viewerContext
                                ? '<p class="account-note">Log in to react or comment.</p>'
                                : (viewerContext.restriction_label === "Suspended"
                                    ? '<p class="account-note">Suspended accounts can still react, but commenting is paused until the suspension ends.</p>'
                                    : (viewerContext.restriction_label === "Banned"
                                        ? '<p class="account-note">Banned accounts cannot comment on profile posts.</p>'
                                        : '<p class="account-note">Comments unlock automatically once an account becomes a Trusted Member or higher.</p>')))) +
                    '</article>'
                );
            }));

            postFeed.innerHTML = htmlBlocks.join("");
        } catch (error) {
            postFeed.innerHTML = "";
            postCopy.textContent = "Unable to load posts right now.";
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading profile posts.",
                "error"
            );
        }
    }

    postFeed.addEventListener("click", async function (event) {
        var commentReaction = event.target.getAttribute("data-comment-reaction");
        var commentId = event.target.getAttribute("data-comment-id");
        var replyButton = event.target.closest("[data-comment-reply]");
        var deleteCommentButton = event.target.closest("[data-comment-delete]");
        var reaction = event.target.getAttribute("data-reaction");
        var postId = event.target.getAttribute("data-post-id");
        var editToggle = event.target.hasAttribute("data-profile-edit-toggle");
        var editCancel = event.target.hasAttribute("data-profile-edit-cancel");
        var deletePost = event.target.hasAttribute("data-profile-delete");
        var reportPost = event.target.getAttribute("data-report-post");
        var reportAuthor = event.target.getAttribute("data-post-author");
        var imageButton = event.target.closest("[data-open-image]");

        if (imageButton) {
            window.HollowsideAuth.openImageViewer(imageButton.getAttribute("data-open-image"), "Post attachment");
            return;
        }

        if (replyButton) {
            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
                return;
            }

            var postCardElement = replyButton.closest("[data-post-id]");
            var replyPostId = postCardElement ? postCardElement.getAttribute("data-post-id") : "";
            if (!replyPostId) {
                return;
            }

            replyingByPost[replyPostId] = {
                id: replyButton.getAttribute("data-comment-id"),
                name: replyButton.getAttribute("data-author-name") || "this user"
            };

            var form = postCardElement.querySelector("[data-comment-form]");
            if (form) {
                form.setAttribute("data-parent-id", replyingByPost[replyPostId].id);
                var textarea = form.querySelector("textarea");
                if (textarea) {
                    textarea.placeholder = "Reply to " + replyingByPost[replyPostId].name + "'s comment";
                    textarea.focus();
                }
            }
            return;
        }

        if (deleteCommentButton) {
            if (!window.confirm("Delete this comment? This also removes its replies and attached images.")) {
                return;
            }

            try {
                var deleteCommentResult = await supabase.rpc("delete_post_comment", {
                    p_comment_id: Number(deleteCommentButton.getAttribute("data-comment-delete"))
                });

                if (deleteCommentResult.error) {
                    throw deleteCommentResult.error;
                }

                loadProfilePosts();
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while deleting the comment.",
                    "error"
                );
            }
            return;
        }

        if (commentReaction && commentId) {
            try {
                if (!viewerContext) {
                    window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
                    return;
                }

                if (event.target.classList.contains("is-active")) {
                    var clearCommentResult = await supabase.rpc("clear_comment_reaction", {
                        p_comment_id: Number(commentId)
                    });

                    if (clearCommentResult.error) {
                        throw clearCommentResult.error;
                    }
                } else {
                    var commentReactionResult = await supabase.rpc("set_comment_reaction", {
                        p_comment_id: Number(commentId),
                        p_reaction_type: commentReaction
                    });

                    if (commentReactionResult.error) {
                        throw commentReactionResult.error;
                    }
                }

                loadProfilePosts();
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while reacting to the comment.",
                    "error"
                );
            }
            return;
        }

        if (editToggle || editCancel) {
            var host = event.target.closest("[data-post-id]");
            if (!host) {
                return;
            }

            var editForm = host.querySelector("[data-profile-edit-form]");
            if (editForm) {
                editForm.hidden = !editForm.hidden;
            }
            return;
        }

        if (deletePost && postId) {
            if (!window.confirm("Delete this profile post? This also removes its comments, reactions, and attached media records.")) {
                return;
            }

            try {
                var deleteResult = await supabase.rpc("delete_content_post", {
                    p_post_id: postId
                });

                if (deleteResult.error) {
                    throw deleteResult.error;
                }

                window.HollowsideAuth.setStatus(status, "Profile post deleted.", "success");
                loadProfilePosts();
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while deleting the post.",
                    "error"
                );
            }
            return;
        }

        if (reportPost) {
            submitReport("post", reportAuthor || accountId, reportPost);
            return;
        }

        if (!reaction || !postId) {
            return;
        }

        try {
            if (!viewerContext) {
                window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
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

            loadProfilePosts();
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while reacting to the post.",
                "error"
            );
        }
    });

    postFeed.addEventListener("change", function (event) {
        var form = event.target.closest("[data-comment-form]");
        if (form && event.target.hasAttribute("data-comment-image-input")) {
            syncCommentFileName(form);
        }
    });

    postFeed.addEventListener("focusout", function (event) {
        var form = event.target.closest("[data-comment-form]");
        if (!form) {
            return;
        }

        window.setTimeout(function () {
            var postId = form.getAttribute("data-post-id");
            if (postId && replyingByPost[postId] && !form.contains(document.activeElement)) {
                resetReplyState(postId);
            }
        }, 0);
    });

    postFeed.addEventListener("submit", async function (event) {
        var form = event.target;
        if (form.hasAttribute("data-profile-edit-form")) {
            event.preventDefault();

            var editPostId = form.getAttribute("data-post-id");
            var editBody = form.querySelector('[name="body"]').value.trim();

            if (!editBody) {
                form.querySelector('[name="body"]').focus();
                return;
            }

            try {
                var updateResult = await supabase.rpc("update_content_post", {
                    p_post_id: editPostId,
                    p_title: "",
                    p_body: editBody,
                    p_summary: "",
                    p_subtitle: ""
                });

                if (updateResult.error) {
                    throw updateResult.error;
                }

                window.HollowsideAuth.setStatus(status, "Profile post updated.", "success");
                loadProfilePosts();
            } catch (error) {
                window.HollowsideAuth.setStatus(
                    status,
                    error && error.message ? error.message : "Something went wrong while updating the post.",
                    "error"
                );
            }
            return;
        }

        if (!form.hasAttribute("data-comment-form")) {
            return;
        }

        event.preventDefault();

        var postId = form.getAttribute("data-post-id");
        var textarea = form.querySelector("textarea");
        var fileInput = form.querySelector("[data-comment-image-input]");
        var body = textarea.value.trim();
        var imageFile = fileInput && fileInput.files ? fileInput.files[0] : null;

        if (!body && !imageFile) {
            textarea.focus();
            return;
        }

        try {
            var commentResponse = await supabase.rpc("create_post_comment", {
                p_post_id: postId,
                p_body: body,
                p_parent_id: form.getAttribute("data-parent-id") ? Number(form.getAttribute("data-parent-id")) : null
            });

            if (commentResponse.error) {
                throw commentResponse.error;
            }

            if (imageFile) {
                await uploadCommentImage(postId, commentResponse.data.id, imageFile);
            }

            textarea.value = "";
            if (fileInput) {
                fileInput.value = "";
            }
            syncCommentFileName(form);
            resetReplyState(postId);
            loadProfilePosts();
        } catch (error) {
            var commentMessage = error && error.message && /size|large|payload|limit|exceed/i.test(error.message)
                ? "Item is too large! Compress this file or choose a smaller one."
                : (error && error.message ? error.message : "Something went wrong while posting your comment.");
            window.HollowsideAuth.setStatus(
                status,
                commentMessage,
                "error"
            );
        }
    });

    postForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!viewerContext || viewerContext.account_id !== accountId || !viewerContext.can_publish_personal_posts) {
            window.HollowsideAuth.setStatus(status, "You do not have permission to post from this profile.", "error");
            return;
        }

        if (!postBody.value.trim()) {
            postBody.focus();
            return;
        }

        try {
            window.HollowsideAuth.setBusy(postForm, true);
            var createResponse = await supabase.rpc("create_content_post", {
                p_post_type: "profile",
                p_title: "",
                p_body: postBody.value.trim(),
                p_summary: ""
            });

            if (createResponse.error) {
                throw createResponse.error;
            }

            var createdPost = createResponse.data;
            var files = Array.prototype.slice.call(postMedia.files || []);
            if (files.length) {
                await uploadPostMediaFiles(createdPost.id, files);
            }

            postForm.reset();
            window.HollowsideAuth.setStatus(status, "Profile post published.", "success");
            loadProfilePosts();
        } catch (error) {
            var publishMessage = error && error.message && /size|large|payload|limit|exceed/i.test(error.message)
                ? "Item is too large! Compress this file or choose a smaller one."
                : (error && error.message ? error.message : "Something went wrong while publishing your profile post.");
            window.HollowsideAuth.setStatus(
                status,
                publishMessage,
                "error"
            );
        } finally {
            window.HollowsideAuth.setBusy(postForm, false);
        }
    });

    async function loadProfile() {
        try {
            window.HollowsideAuth.setStatus(status, "Loading profile...", "info");

            var viewerContextResponse = await supabase.rpc("get_my_account_context");
            viewerContext = viewerContextResponse.data && viewerContextResponse.data[0]
                ? window.HollowsideAuth.applyRoleEmulation(viewerContextResponse.data[0], null)
                : null;

            var response = await supabase.rpc("get_profile_view", {
                p_account_id: accountId
            });

            if (response.error) {
                throw response.error;
            }

            profileCard = response.data && response.data[0];
            if (!profileCard) {
                window.HollowsideAuth.setStatus(status, "That profile is unavailable right now. If one of you blocked the other, it will stay hidden here.", "error");
                return;
            }
            if (viewerContext && viewerContext.account_id === profileCard.account_id && viewerContext.is_role_emulated) {
                profileCard.role_label = viewerContext.role_label;
                profileCard.role_key = viewerContext.effective_role_key;
            }

            document.title = profileCard.display_name + " | Hollowside Games";
            setAvatar(profileCard);
            displayName.textContent = profileCard.display_name;
            username.textContent = "@" + profileCard.username;
            displayBadge.innerHTML = "";
            usernameBadge.innerHTML = window.HollowsideAuth.getVerificationBadge(profileCard, "Verified Hollowside account");
            role.textContent = profileCard.role_label;
            memberSince.textContent = "Member since " + new Date(profileCard.member_since).toLocaleDateString();
            bio.textContent = profileCard.bio || "No bio yet.";
            setRestrictionChip(profileCard);
            updateStatBlock(followerCount, profileCard.follower_count);
            updateStatBlock(followingCount, profileCard.following_count);
            updateStatBlock(friendCount, profileCard.friend_count);
            renderActions(profileCard);

            if (viewerContext && viewerContext.account_id === profileCard.account_id && viewerContext.can_publish_personal_posts) {
                composerCard.hidden = false;
            }

            await Promise.all([
                loadConnections("followers", followers),
                loadConnections("following", following),
                loadConnections("friends", friends),
                loadProfilePosts()
            ]);

            window.HollowsideAuth.setStatus(status, "", "info");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading this profile.",
                "error"
            );
        }
    }

    loadProfile();
});
