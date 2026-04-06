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

    function canManageProfilePost(post) {
    return !!(
        viewerContext &&
        post &&
        viewerContext.id === post.author_id &&
        viewerContext.can_publish_personal_posts
    );
}

function renderOwnerTools(post) {
    if (!canManageProfilePost(post)) {
        return "";
    }

    return (
        '<div class="post-owner-tools">' +
            '<div class="post-owner-actions">' +
                '<button class="post-action" type="button" data-profile-edit-toggle data-post-id="' + escapeHtml(post.id) + '">Edit Post</button>' +
                '<button class="post-action is-danger" type="button" data-profile-delete data-post-id="' + escapeHtml(post.id) + '">Delete Post</button>' +
            "</div>" +
            '<form class="post-edit-form" data-profile-edit-form data-post-id="' + escapeHtml(post.id) + '" hidden>' +
                '<div>' +
                    '<label for="profile-edit-body-' + escapeHtml(post.id) + '">Edit Post</label>' +
                    '<textarea id="profile-edit-body-' + escapeHtml(post.id) + '" name="body" maxlength="5000">' + escapeHtml(post.body || "") + '</textarea>' +
                "</div>" +
                '<div class="account-actions">' +
                    '<button class="account-button primary" type="submit">Save Changes</button>' +
                    '<button class="account-button" type="button" data-profile-edit-cancel data-post-id="' + escapeHtml(post.id) + '">Cancel</button>' +
                "</div>" +
            "</form>" +
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
                         renderOwnerTools(post) +
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
    var reaction = event.target.getAttribute("data-reaction");
    var postId = event.target.getAttribute("data-post-id");
    var editToggle = event.target.hasAttribute("data-profile-edit-toggle");
    var editCancel = event.target.hasAttribute("data-profile-edit-cancel");
    var deletePost = event.target.hasAttribute("data-profile-delete");

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
        loadProfilePosts();
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
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while publishing your profile post.",
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
            viewerContext = viewerContextResponse.data && viewerContextResponse.data[0] ? viewerContextResponse.data[0] : null;

            var response = await supabase.rpc("get_profile_view", {
                p_account_id: accountId
            });

            if (response.error) {
                throw response.error;
            }

            profileCard = response.data && response.data[0];
            if (!profileCard) {
                window.HollowsideAuth.setStatus(status, "That account could not be found.", "error");
                return;
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
