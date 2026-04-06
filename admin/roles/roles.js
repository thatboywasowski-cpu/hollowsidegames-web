document.addEventListener("DOMContentLoaded", function () {
    var status = document.getElementById("admin-status");
    var roleAssignmentForm = document.getElementById("role-assignment-form");
    var verificationForm = document.getElementById("verification-form");
    var targetAccountIdInput = document.getElementById("role-target-account-id");
    var targetRoleSelect = document.getElementById("role-target-role");
    var verificationAccountIdInput = document.getElementById("verification-account-id");
    var verificationEnabledInput = document.getElementById("verification-enabled");
    var verificationNoteInput = document.getElementById("verification-note");
    var rolePermissionRole = document.getElementById("role-permission-role");
    var rolePermissionGrid = document.getElementById("role-permission-grid");
    var overrideAccountIdInput = document.getElementById("override-account-id");
    var loadOverridesButton = document.getElementById("load-overrides");
    var accountPermissionGrid = document.getElementById("account-permission-grid");

    if (!window.HollowsideAuth.isConfigured()) {
        window.HollowsideAuth.setStatus(status, "Supabase is not connected yet.", "error");
        return;
    }

    var supabase = window.HollowsideAuth.createClient();
    var adminContext = null;
    var manageableRoles = [];
    var permissions = [];
    var rolePermissions = [];

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function permissionStateForRole(roleKey, permissionKey) {
        var hit = rolePermissions.find(function (item) {
            return item.role_key === roleKey && item.permission_key === permissionKey;
        });

        return hit ? !!hit.allowed : false;
    }

    function fillRoleSelects() {
        var options = manageableRoles.map(function (role) {
            return '<option value="' + escapeHtml(role.role_key) + '">' + escapeHtml(role.label) + "</option>";
        }).join("");

        targetRoleSelect.innerHTML = options;
        rolePermissionRole.innerHTML = options;
    }

    function renderRolePermissionGrid() {
        var roleKey = rolePermissionRole.value;
        rolePermissionGrid.innerHTML = permissions.map(function (permission) {
            var checked = permissionStateForRole(roleKey, permission.permission_key) ? "checked" : "";
            return (
                '<label class="permission-tile">' +
                    '<span>' +
                        '<strong>' + escapeHtml(permission.label) + '</strong>' +
                        '<span>' + escapeHtml(permission.description) + "</span>" +
                    '</span>' +
                    '<input class="permission-toggle" data-role-permission="' + escapeHtml(permission.permission_key) + '" type="checkbox" ' + checked + ">" +
                "</label>"
            );
        }).join("");
    }

    async function loadAccountOverrides() {
        var targetAccountId = overrideAccountIdInput.value.trim();

        if (!targetAccountId) {
            window.HollowsideAuth.setStatus(status, "Enter a target account ID first.", "error");
            return;
        }

        try {
            window.HollowsideAuth.setStatus(status, "Loading account overrides...", "info");
            var response = await supabase.rpc("get_account_permission_overrides", {
                p_account_id: targetAccountId
            });

            if (response.error) {
                throw response.error;
            }

            var overrides = response.data || [];
            accountPermissionGrid.innerHTML = permissions.map(function (permission) {
                var hit = overrides.find(function (item) {
                    return item.permission_key === permission.permission_key;
                });

                var value = hit ? String(hit.allowed) : "inherit";
                return (
                    '<div class="permission-tile">' +
                        '<span>' +
                            '<strong>' + escapeHtml(permission.label) + '</strong>' +
                            '<span>' + escapeHtml(permission.description) + "</span>" +
                        '</span>' +
                        '<select data-account-permission="' + escapeHtml(permission.permission_key) + '">' +
                            '<option value="inherit"' + (value === "inherit" ? " selected" : "") + '>Inherit</option>' +
                            '<option value="true"' + (value === "true" ? " selected" : "") + '>Allow</option>' +
                            '<option value="false"' + (value === "false" ? " selected" : "") + '>Deny</option>' +
                        "</select>" +
                    "</div>"
                );
            }).join("");

            window.HollowsideAuth.setStatus(status, "", "info");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading account overrides.",
                "error"
            );
        }
    }

    roleAssignmentForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var targetAccountId = targetAccountIdInput.value.trim();
        var roleKey = targetRoleSelect.value;

        if (!targetAccountId || !roleKey) {
            window.HollowsideAuth.setStatus(status, "Choose a target account and role first.", "error");
            return;
        }

        try {
            window.HollowsideAuth.setStatus(status, "Updating account role...", "info");
            var response = await supabase.rpc("set_account_role", {
                p_account_id: targetAccountId,
                p_role_key: roleKey
            });

            if (response.error) {
                throw response.error;
            }

            window.HollowsideAuth.setStatus(status, "Role updated successfully.", "success");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating the role.",
                "error"
            );
        }
    });

    verificationForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!adminContext || !adminContext.can_verify_accounts) {
            window.HollowsideAuth.setStatus(status, "You do not have access to manual verification tools.", "error");
            return;
        }

        var targetAccountId = verificationAccountIdInput.value.trim();
        if (!targetAccountId) {
            window.HollowsideAuth.setStatus(status, "Enter a target account ID first.", "error");
            return;
        }

        try {
            window.HollowsideAuth.setStatus(status, "Updating verification...", "info");
            var response = await supabase.rpc("set_account_verification", {
                p_account_id: targetAccountId,
                p_manual_verified: verificationEnabledInput.value === "true",
                p_note: verificationNoteInput.value.trim()
            });

            if (response.error) {
                throw response.error;
            }

            window.HollowsideAuth.setStatus(status, "Verification updated successfully.", "success");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating verification.",
                "error"
            );
        }
    });

    rolePermissionRole.addEventListener("change", function () {
        renderRolePermissionGrid();
    });

    rolePermissionGrid.addEventListener("change", async function (event) {
        var permissionKey = event.target.getAttribute("data-role-permission");
        if (!permissionKey) {
            return;
        }

        try {
            var response = await supabase.rpc("set_role_permission", {
                p_role_key: rolePermissionRole.value,
                p_permission_key: permissionKey,
                p_allowed: event.target.checked
            });

            if (response.error) {
                throw response.error;
            }

            rolePermissions = rolePermissions.filter(function (item) {
                return !(item.role_key === rolePermissionRole.value && item.permission_key === permissionKey);
            });

            rolePermissions.push({
                role_key: rolePermissionRole.value,
                permission_key: permissionKey,
                allowed: event.target.checked
            });

            window.HollowsideAuth.setStatus(status, "Role permission updated.", "success");
        } catch (error) {
            event.target.checked = !event.target.checked;
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating the role permission.",
                "error"
            );
        }
    });

    loadOverridesButton.addEventListener("click", function () {
        loadAccountOverrides();
    });

    accountPermissionGrid.addEventListener("change", async function (event) {
        var permissionKey = event.target.getAttribute("data-account-permission");
        if (!permissionKey) {
            return;
        }

        var targetAccountId = overrideAccountIdInput.value.trim();
        if (!targetAccountId) {
            window.HollowsideAuth.setStatus(status, "Enter a target account ID first.", "error");
            return;
        }

        try {
            if (event.target.value === "inherit") {
                var clearResponse = await supabase.rpc("clear_account_permission", {
                    p_account_id: targetAccountId,
                    p_permission_key: permissionKey
                });

                if (clearResponse.error) {
                    throw clearResponse.error;
                }
            } else {
                var overrideResponse = await supabase.rpc("set_account_permission", {
                    p_account_id: targetAccountId,
                    p_permission_key: permissionKey,
                    p_allowed: event.target.value === "true"
                });

                if (overrideResponse.error) {
                    throw overrideResponse.error;
                }
            }

            window.HollowsideAuth.setStatus(status, "Account permission override updated.", "success");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while updating the account override.",
                "error"
            );
        }
    });

    async function initialize() {
        try {
            window.HollowsideAuth.setStatus(status, "Loading role tools...", "info");

            var accountContextResponse = await supabase.rpc("get_my_account_context");
            if (accountContextResponse.error) {
                throw accountContextResponse.error;
            }

            var roleContextResponse = await supabase.rpc("get_my_role_context");
            if (roleContextResponse.error) {
                throw roleContextResponse.error;
            }

            var accountContext = accountContextResponse.data && accountContextResponse.data[0];
            var roleContext = roleContextResponse.data && roleContextResponse.data[0];

            adminContext = Object.assign({}, roleContext || {}, accountContext || {});
            if (!adminContext || (!adminContext.can_manage_roles && !adminContext.can_manage_role_permissions && !adminContext.can_manage_account_permissions && !adminContext.can_verify_accounts)) {
                window.HollowsideAuth.setStatus(status, "You do not have access to the role tools.", "error");
                return;
            }

            var rolesResponse = await supabase
                .from("role_definitions")
                .select("*")
                .order("rank", { ascending: false });

            if (rolesResponse.error) {
                throw rolesResponse.error;
            }

            manageableRoles = (rolesResponse.data || []).filter(function (role) {
                return role.rank < (
                    adminContext.can_manage_roles
                        ? (adminContext.role_rank || 0)
                        : 0
                );
            });

            var permissionsResponse = await supabase
                .from("permission_definitions")
                .select("*")
                .order("category", { ascending: true })
                .order("permission_key", { ascending: true });

            if (permissionsResponse.error) {
                throw permissionsResponse.error;
            }

            permissions = permissionsResponse.data || [];

            var rolePermissionsResponse = await supabase
                .from("role_permissions")
                .select("*");

            if (rolePermissionsResponse.error) {
                throw rolePermissionsResponse.error;
            }

            rolePermissions = rolePermissionsResponse.data || [];

            fillRoleSelects();
            renderRolePermissionGrid();
            window.HollowsideAuth.setStatus(status, "", "info");
        } catch (error) {
            window.HollowsideAuth.setStatus(
                status,
                error && error.message ? error.message : "Something went wrong while loading the role tools.",
                "error"
            );
        }
    }

    initialize();
});
