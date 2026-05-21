import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { hashCode } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "2FA verification is not configured on the server." });
    }

    const body = await request.json().catch(() => ({}));
    const challengeId = String(body.challengeId || "").trim();
    const code = String(body.code || "").trim();

    if (!challengeId || !/^[0-9]{6}$/.test(code)) {
      return jsonResponse({ error: "Enter the 6-digit 2FA code." });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: challenge, error: readError } = await admin
      .from("login_2fa_challenges")
      .select("*")
      .eq("id", challengeId)
      .is("used_at", null)
      .maybeSingle();

    if (readError || !challenge) {
      return jsonResponse({ error: "That 2FA code is no longer valid." });
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await admin
        .from("login_2fa_challenges")
        .update({ used_at: new Date().toISOString() })
        .eq("id", challengeId);
      return jsonResponse({ error: "That 2FA code expired. Start login again for a new code." });
    }

    const submittedHash = await hashCode(code, challenge.code_salt);
    if (submittedHash !== challenge.code_hash) {
      return jsonResponse({ error: "That 2FA code is incorrect." });
    }

    await admin
      .from("login_2fa_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("id", challengeId);

    return jsonResponse({
      session: {
        access_token: challenge.session_access_token,
        refresh_token: challenge.session_refresh_token,
      },
      rememberMe: challenge.remember_me,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to verify 2FA login." });
  }
});
