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
    const authorization = request.headers.get("Authorization") || "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Account 2FA is not configured on the server." });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "You must be logged in to activate 2FA." });
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith("@users.hollowsidegames.local")) {
      return jsonResponse({ error: "Enter a valid email address for 2FA." });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const code = getRandomCode();
    const salt = getRandomToken(18);
    const codeHash = await hashCode(code, salt);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await admin
      .from("account_2fa_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", userData.user.id)
      .is("used_at", null);

    const { data: challenge, error: insertError } = await admin
      .from("account_2fa_challenges")
      .insert({
        user_id: userData.user.id,
        contact_email: email,
        code_hash: codeHash,
        code_salt: salt,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();

    if (insertError || !challenge) {
      return jsonResponse({ error: insertError?.message || "Unable to start account 2FA verification." });
    }

    await sendTwoFactorEmail(email, code);

    return jsonResponse({
      challengeId: challenge.id,
      expiresAt: challenge.expires_at,
      contactHint: email.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to start account 2FA verification." });
  }
});
