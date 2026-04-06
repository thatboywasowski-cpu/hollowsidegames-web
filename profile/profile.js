document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("profile-status");
    var params = new URLSearchParams(window.location.search);
    var accountId = params.get("id");
    var avatar = document.getElementById("profile-avatar");
    var displayName = document.getElementById("profile-display-name");
    var username = document.getElementById("profile-username");
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

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    if (!accountId) {
        window.HollowsideAuth.setStatus(status, "No account ID was provided in the URL.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
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

            return (
                '<a class="profile-mini-card" href="/profile?id=' + encodeURIComponent(card.account_id) + '">' +
                    avatarMarkup +
                    '<div class="profile-mini-copy">' +
                        '<strong>' + escapeHtml(card.display_name) + '</strong>' +
                        '<span>@' + escapeHtml(card.username) + '</span>' +
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

    function renderActions(card, viewerAccountId) {
        actions.innerHTML = "";

        if (viewerAccountId && viewerAccountId === card.account_id) {
            actions.innerHTML = '<a class="account-button primary" href="/account">Open Account Settings</a>';
            return;
        }

        if (!viewerAccountId) {
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
                    followerCount.textContent = card.follower_count;
                    followingCount.textContent = card.following_count;
                    friendCount.textContent = card.friend_count;
                }

                renderActions(card, viewerAccountId);
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

    async function loadProfile() {
        try {
            window.HollowsideAuth.setStatus(status, "Loading profile...", "info");

            var viewerContextResponse = await supabase.rpc("get_my_role_context");
            var viewerContext = viewerContextResponse.data && viewerContextResponse.data[0] ? viewerContextResponse.data[0] : null;

            var response = await supabase.rpc("get_profile_view", {
                p_account_id: accountId
            });

            if (response.error) {
                throw response.error;
            }

            var card = response.data && response.data[0];
            if (!card) {
                window.HollowsideAuth.setStatus(status, "That account could not be found.", "error");
                return;
            }

            document.title = card.display_name + " | Hollowside Games";
            setAvatar(card);
            displayName.textContent = card.display_name;
            username.textContent = "@" + card.username;
            role.textContent = card.role_label;
            memberSince.textContent = "Member since " + new Date(card.member_since).toLocaleDateString();
            bio.textContent = card.bio || "No bio yet.";
            followerCount.textContent = card.follower_count;
            followingCount.textContent = card.following_count;
            friendCount.textContent = card.friend_count;
            renderActions(card, viewerContext && viewerContext.account_id);

            await Promise.all([
                loadConnections("followers", followers),
                loadConnections("following", following),
                loadConnections("friends", friends)
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
