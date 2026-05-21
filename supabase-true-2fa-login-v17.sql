-- True 2FA login challenge flow v17.
-- Run after v16. Deploy the Edge Functions in supabase/functions afterward.

create extension if not exists pgcrypto;

create table if not exists public.login_2fa_challenges (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    code_hash text not null,
    code_salt text not null,
    session_access_token text not null,
    session_refresh_token text not null,
    remember_me boolean not null default true,
    used_at timestamptz,
    expires_at timestamptz not null default timezone('utc', now()) + interval '15 minutes',
    created_at timestamptz not null default timezone('utc', now()),
    created_ip text not null default '',
    user_agent text not null default ''
);

create table if not exists public.account_2fa_challenges (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    contact_email text not null,
    code_hash text not null,
    code_salt text not null,
    used_at timestamptz,
    expires_at timestamptz not null default timezone('utc', now()) + interval '15 minutes',
    created_at timestamptz not null default timezone('utc', now())
);

alter table public.login_2fa_challenges enable row level security;
alter table public.account_2fa_challenges enable row level security;

drop policy if exists "No direct challenge reads" on public.login_2fa_challenges;
create policy "No direct challenge reads"
on public.login_2fa_challenges
for select
to public
using (false);

drop policy if exists "No direct challenge inserts" on public.login_2fa_challenges;
create policy "No direct challenge inserts"
on public.login_2fa_challenges
for insert
to public
with check (false);

drop policy if exists "No direct challenge updates" on public.login_2fa_challenges;
create policy "No direct challenge updates"
on public.login_2fa_challenges
for update
to public
using (false)
with check (false);

drop policy if exists "No direct account 2FA challenge reads" on public.account_2fa_challenges;
create policy "No direct account 2FA challenge reads"
on public.account_2fa_challenges
for select
to public
using (false);

drop policy if exists "No direct account 2FA challenge inserts" on public.account_2fa_challenges;
create policy "No direct account 2FA challenge inserts"
on public.account_2fa_challenges
for insert
to public
with check (false);

drop policy if exists "No direct account 2FA challenge updates" on public.account_2fa_challenges;
create policy "No direct account 2FA challenge updates"
on public.account_2fa_challenges
for update
to public
using (false)
with check (false);

create index if not exists login_2fa_challenges_user_active_idx
on public.login_2fa_challenges (user_id, used_at, expires_at);

create index if not exists login_2fa_challenges_expires_idx
on public.login_2fa_challenges (expires_at);

create index if not exists account_2fa_challenges_user_active_idx
on public.account_2fa_challenges (user_id, used_at, expires_at);

create or replace function public.cleanup_expired_login_2fa_challenges()
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.login_2fa_challenges
    where expires_at < timezone('utc', now()) - interval '1 hour'
       or used_at is not null;

    delete from public.account_2fa_challenges
    where expires_at < timezone('utc', now()) - interval '1 hour'
       or used_at is not null;
$$;

revoke all on function public.cleanup_expired_login_2fa_challenges() from public;

create or replace function public.get_account_context_for_user(p_user_id uuid)
returns table (
    id uuid,
    account_id text,
    username text,
    display_name text,
    role_label text,
    is_2fa_enabled boolean,
    two_factor_channel text,
    two_factor_contact text,
    trusted_2fa_verified_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    select
        p.id,
        p.account_id,
        p.username,
        p.display_name,
        public.resolve_effective_role_label(p.base_role_key, p.is_trusted) as role_label,
        p.trusted_2fa_enabled as is_2fa_enabled,
        p.trusted_2fa_channel as two_factor_channel,
        p.trusted_2fa_contact as two_factor_contact,
        p.trusted_2fa_verified_at
    from public.profiles p
    where p.id = p_user_id;
$$;

revoke all on function public.get_account_context_for_user(uuid) from public;
