import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendTwoFactorEmail } from "../_shared/hollowside-email.ts";
import { getRandomCode, getRandomToken, hashCode } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "2FA login is not configured on the server." });
    }

    const body = await request.json().catch(() => ({}));
    const identifier = String(body.identifier || "").trim();
    const password = String(body.password || "");
    const rememberMe = body.rememberMe !== false;

    if (!identifier || !password) {
      return jsonResponse({ error: "Enter your username or email and password." });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let email = identifier;
    if (!identifier.includes("@")) {
      const { data, error } = await admin.rpc("resolve_login_email", {
        p_identifier: identifier,
      });

      if (error || !data) {
        return jsonResponse({ error: "No account was found for that username." });
      }

      email = data;
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.session || !signInData.user) {
      return jsonResponse({ error: signInError?.message || "Login failed." });
    }

    const { data: contextRows, error: contextError } = await admin.rpc("get_account_context_for_user", {
      p_user_id: signInData.user.id,
    });

    if (contextError) {
      return jsonResponse({ error: contextError.message });
    }

    const context = Array.isArray(contextRows) ? contextRows[0] : contextRows;
    if (!context?.is_2fa_enabled) {
      return jsonResponse({
        requires2fa: false,
        session: {
          access_token: signInData.session.access_token,
          refresh_token: signInData.session.refresh_token,
        },
      });
    }

    const contact = String(context.two_factor_contact || email || "");
    if (!contact || contact.endsWith("@users.hollowsidegames.local")) {
      return jsonResponse({ error: "This account has 2FA enabled but no usable email contact." });
    }

    const code = getRandomCode();
    const salt = getRandomToken(18);
    const codeHash = await hashCode(code, salt);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await admin
      .from("login_2fa_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", signInData.user.id)
      .is("used_at", null);

    const { data: challenge, error: insertError } = await admin
      .from("login_2fa_challenges")
      .insert({
        user_id: signInData.user.id,
        code_hash: codeHash,
        code_salt: salt,
        session_access_token: signInData.session.access_token,
        session_refresh_token: signInData.session.refresh_token,
        remember_me: rememberMe,
        expires_at: expiresAt,
        created_ip: request.headers.get("x-forwarded-for") || "",
        user_agent: request.headers.get("user-agent") || "",
      })
      .select("id, expires_at")
      .single();

    if (insertError || !challenge) {
      return jsonResponse({ error: insertError?.message || "Unable to start 2FA login." });
    }

    await sendTwoFactorEmail(contact, code);

    return jsonResponse({
      requires2fa: true,
      challengeId: challenge.id,
      expiresAt: challenge.expires_at,
      contactHint: contact.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to start 2FA login." });
  }
});
