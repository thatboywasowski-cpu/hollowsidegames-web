import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { hashCode } from "../_shared/security.ts";

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
      return jsonResponse({ error: "Account 2FA verification is not configured on the server." });
    }

    const body = await request.json().catch(() => ({}));
    const challengeId = String(body.challengeId || "").trim();
    const code = String(body.code || "").trim();

    if (!challengeId || !/^[0-9]{6}$/.test(code)) {
      return jsonResponse({ error: "Enter the 6-digit 2FA code." });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "You must be logged in to verify account 2FA." });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: challenge, error: readError } = await admin
      .from("account_2fa_challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.user.id)
      .is("used_at", null)
      .maybeSingle();

    if (readError || !challenge) {
      return jsonResponse({ error: "That 2FA code is no longer valid." });
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await admin
        .from("account_2fa_challenges")
        .update({ used_at: new Date().toISOString() })
        .eq("id", challengeId);
      return jsonResponse({ error: "That 2FA code expired. Send a new code and try again." });
    }

    const submittedHash = await hashCode(code, challenge.code_salt);
    if (submittedHash !== challenge.code_hash) {
      return jsonResponse({ error: "That 2FA code is incorrect." });
    }

    await admin
      .from("account_2fa_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("id", challengeId);

    const { error: updateError } = await admin
      .from("profiles")
      .update({
        trusted_2fa_enabled: true,
        trusted_2fa_channel: "email",
        trusted_2fa_contact: challenge.contact_email,
        trusted_2fa_verified_at: new Date().toISOString(),
        legacy_email_verification_notice_pending: false,
      })
      .eq("id", userData.user.id);

    if (updateError) {
      return jsonResponse({ error: updateError.message });
    }

    return jsonResponse({
      ok: true,
      contact: challenge.contact_email,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to verify account 2FA." });
  }
});
