function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildTwoFactorEmail(code: string) {
  const safeCode = escapeHtml(code);

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#050505;color:#f4f4f4;font-family:Inter,Segoe UI,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;margin:0;padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#111111;border:1px solid #2a2a2a;border-radius:24px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.45);">
          <tr>
            <td style="padding:0;background:#080808;">
              <div style="height:140px;background:linear-gradient(135deg,#111 0%,#1d1d1d 48%,#080808 100%);border-bottom:1px solid #262626;text-align:center;padding-top:34px;">
                <img src="https://hollowsidegames.com/Hollowside%20Games%20logo.png" width="78" height="78" alt="Hollowside Games" style="display:block;width:78px;height:78px;margin:0 auto 14px;border-radius:20px;background:#ffffff;object-fit:cover;">
                <div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#b7b7b7;">Hollowside Games</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 34px 14px;">
              <h1 style="margin:0 0 12px;font-size:30px;line-height:1.12;letter-spacing:-0.03em;color:#ffffff;">Your 2FA security code</h1>
              <p style="margin:0;color:#d7d7d7;font-size:16px;line-height:1.65;">
                A login attempt was started for your Hollowside Games account. Enter this code on the website to finish signing in.
              </p>
              <div style="margin:28px 0 26px;padding:24px 20px;border:1px solid #3a3a3a;border-radius:18px;background:#070707;text-align:center;">
                <div style="font-size:42px;line-height:1;font-weight:900;letter-spacing:0.24em;color:#ffffff;">${safeCode}</div>
                <div style="margin-top:12px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8d8d8d;">Expires in 15 minutes</div>
              </div>
              <p style="margin:0;color:#a8a8a8;font-size:14px;line-height:1.7;">
                A newer login attempt will replace this code. If you did not request this, ignore this email and update your password.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 34px 34px;">
              <div style="border-top:1px solid #242424;padding-top:18px;color:#777;font-size:12px;line-height:1.6;text-align:center;">
                Hollowside Games account security
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendTwoFactorEmail(to: string, code: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("HOLLOWSIDE_2FA_FROM") || "Hollowside Games <security@hollowsidegames.com>";

  if (!resendKey) {
    throw new Error("RESEND_API_KEY is not configured for the 2FA email sender.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your Hollowside Games 2FA code",
      html: buildTwoFactorEmail(code),
      text: `Your Hollowside Games 2FA code is ${code}. It expires in 15 minutes.`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Unable to send 2FA email: ${detail}`);
  }
}
