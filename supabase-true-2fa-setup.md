# Hollowside True 2FA Setup

This replaces the unsafe client-side 2FA attempt. The browser no longer receives a Supabase session until the 6-digit code is verified.

## 1. Run SQL

Run this in the Supabase SQL editor:

```text
supabase-true-2fa-login-v17.sql
```

This creates the `login_2fa_challenges` table and a server-only lookup function.

## 2. Configure Email Sender

The Edge Function sends the graphical email directly. Configure these Supabase secrets:

```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
supabase secrets set HOLLOWSIDE_2FA_FROM="Hollowside Games <security@hollowsidegames.com>"
```

The sender domain should be verified in Resend. A verified domain is what helps the email look trusted instead of suspicious.

## 3. Deploy Functions

Deploy both functions:

```bash
supabase functions deploy start-2fa-login
supabase functions deploy verify-2fa-login
supabase functions deploy start-account-2fa
supabase functions deploy verify-account-2fa
```

## Security Behavior

- Password verification happens inside `start-2fa-login`, not in browser storage.
- A 6-digit code is generated server-side.
- The code expires after 15 minutes.
- Starting a new login marks previous unused codes for that account as used.
- The Supabase session is returned only from `verify-2fa-login` after the correct code is submitted.
