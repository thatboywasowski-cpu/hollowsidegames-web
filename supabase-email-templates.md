# Supabase Email Templates For Hollowside 2FA

The 2FA code email is controlled in Supabase, not in the website JavaScript. If the email says "Follow this link to login", the Supabase Magic Link template is still using its default body.

## Magic Link Template

Use this for login-time 2FA codes.

Subject:

```text
Your Hollowside Games security code
```

Body:

Use the contents of `supabase-email-template-2fa-code.html`.

## Change Email Address Template

Use this for adding or changing the account 2FA email from account settings.

Subject:

```text
Confirm your Hollowside Games 2FA email
```

Body:

Use the contents of `supabase-email-template-email-change-code.html`.

Both templates use `{{ .Token }}`, which Supabase replaces with the 6-digit code the website verifies.
