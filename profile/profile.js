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

    async function uploadPostMediaFiles(postId, files) {
        if (!viewerContext || !viewerContext.id || !files.length) {
            return;
        }

        var uploads = [];

        files.forEach(function (file, index) {
            uploads.push((async function () {
                var extension = (file.name.split(".").pop() || "bin").toLowerCase();
                var path = viewerContext.id + "/posts/" + postId + "/" + Date.now() + "-" + index + "." + extension;
                var mediaType = file.type.indexOf("video/") === 
