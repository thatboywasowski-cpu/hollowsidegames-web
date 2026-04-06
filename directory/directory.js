document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("directory-status");
    var form = document.getElementById("directory-search-form");
    var queryInput = document.getElementById("directory-query");
    var displayFilter = document.getElementById("filter-display");
    var usernameFilter = document.getElementById("filter-username");
    var idFilter = document.getElementById("filter-id");
    var results = document.getElementById("directory-results");
    var resultsCopy = document.getElementById("directory-results-copy");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();

    function avatarMarkup(card) {
        if (card.avatar_url) {
            return '<span class="account-avatar-preview"><img src="' + window.HollowsideAuth.escapeHtml(card.avatar_url) + '" alt="Profile picture"></span>';
        }

        return '<span class="account-avatar-preview">' + window.HollowsideAuth.getInitials(card, null) + "</span>";
    }

    function renderResults(items) {
        if (!items.length) {
            results.innerHTML = "";
            resultsCopy.textContent = "No matching accounts yet.";
            return;
        }

        resultsCopy.textContent = items.length + " account" + (items.length === 1 ? "" : "s") + " found.";
        results.innerHTML = items.map(function (card) {
            var badge = window.HollowsideAuth.getVerificationBadge(card, "Verified Hollowside account");

            return (
                '<article class="account-card">' +
                    '<div class="profile-mini-card">' +
                        avatarMarkup(card) +
                        '<div class="profile-mini-copy">' +
                            '<strong>' + window.HollowsideAuth.escapeHtml(card.display_name) + '</strong>' +
                            '<span class="identity-line">@' + window.HollowsideAuth.escapeHtml(card.username) + badge + '</span>' +
                            '<p>' + window.HollowsideAuth.escapeHtml(card.role_label) + " - Member since " + window.HollowsideAuth.escapeHtml(new Date(card.member_since).toLocaleDateString()) + '</p>' +
                        '</div>' +
                    '</div>' +
                    '<p class="account-note">' + window.HollowsideAuth.escapeHtml(card.bio || "No bio yet.") + '</p>' +
                    '<div class="profile-stats">' +
                        '<div class="profile-stat"><strong>' + window.HollowsideAuth.formatCompactCount(card.follower_count) + '</strong><span>' + window.HollowsideAuth.formatCountLabel(card.follower_count, "Follower", "Followers") + '</span></div>' +
                        '<div class="profile-stat"><strong>' + window.HollowsideAuth.formatCompactCount(card.following_count) + '</strong><span>' + window.HollowsideAuth.formatCountLabel(card.following_count, "Following", "Following") + '</span></div>' +
                        '<div class="profile-stat"><strong>' + window.HollowsideAuth.formatCompactCount(card.friend_count) + '</strong><span>' + window.HollowsideAuth.formatCountLabel(card.friend_count, "Friend", "Friends") + '</span></div>' +
                    '</div>' +
                    '<div class="profile-actions">' +
                        '<a class="account-button primary" href="/profile?id=' + encodeURIComponent(card.account_id) + '">View Profile</a>' +
                    '</div>' +
                '</article>'
            );
        }).join("");
    }

    async function runSearch() {
        if (!displayFilter.checked && !usernameFilter.checked && !idFilter.checked) {
            window.HollowsideAuth.setStatus(status, "Choose at least one filter before searching.", "error");
            return;
        }

        try {
            window.HollowsideAuth.setStatus(status, "Searching accounts...", "info");
            var response = await supabase.rpc("search_profile_cards", {
                p_query: queryInput.value.trim(),
                p_use_display: displayFilter.checked,
                p_use_username: usernameFilter.checked,
                p_use_account_id: idFilter.checked,
                p_limit: 24
            });

            if (response.error) {
                throw response.error;
            }

            renderResults(response.data || []);
            window.HollowsideAuth.setStatus(status, "", "info");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while searching accounts.",
                "error"
            );
        }
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        runSearch();
    });

    runSearch();
});
