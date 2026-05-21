-- 2FA-backed Trusted Member rollout and username login v16.
-- Run after v15. This preserves already email-verified accounts as Trusted Members,
-- makes new accounts start as Member, and exposes username-to-email login lookup.

create extension if not exists pgcrypto;

alter table if exists public.profiles
    add column if not exists trusted_2fa_enabled boolean not null default false,
    add column if not exists trusted_2fa_channel text not null default '',
    add column if not exists trusted_2fa_contact text not null default '',
    add column if not exists trusted_2fa_verified_at timestamptz,
    add column if not exists legacy_email_verification_notice_pending boolean not null default false;

create or replace function public.is_virtual_hollowside_email(p_email text)
returns boolean
language sql
immutable
as $$
    select lower(coalesce(p_email, '')) like '%@users.hollowsidegames.local';
$$;

update public.profiles p
set trusted_2fa_enabled = true,
    trusted_2fa_channel = 'email',
    trusted_2fa_contact = au.email,
    trusted_2fa_verified_at = coalesce(au.email_confirmed_at, p.trusted_2fa_verified_at, timezone('utc', now())),
    legacy_email_verification_notice_pending = true
from auth.users au
where au.id = p.id
  and au.email_confirmed_at is not null
  and not public.is_virtual_hollowside_email(au.email)
  and p.trusted_2fa_enabled = false;

create or replace function public.confirm_virtual_hollowside_email_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_virtual_hollowside_email(new.email) then
        new.email_confirmed_at := coalesce(new.email_confirmed_at, timezone('utc', now()));
        new.confirmation_token := '';
        new.confirmation_sent_at := null;
    end if;

    return new;
end;
$$;

drop trigger if exists confirm_virtual_hollowside_email_before_insert on auth.users;
create trigger confirm_virtual_hollowside_email_before_insert
before insert on auth.users
for each row
execute function public.confirm_virtual_hollowside_email_before_insert();

create or replace function public.profile_sync_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.username := lower(trim(both '.' from coalesce(new.username, '')));

    if new.username !~ '^[a-z0-9_\.]+$' then
        raise exception 'Usernames can only use lowercase letters, numbers, underscores, and periods.';
    end if;

    if char_length(new.username) < 3 or char_length(new.username) > 24 then
        raise exception 'Usernames must be between 3 and 24 characters.';
    end if;

    if tg_op = 'INSERT' then
        new.username_changed_at := coalesce(new.username_changed_at, timezone('utc', now()));
        new.username_change_available_at := coalesce(new.username_change_available_at, timezone('utc', now()) + interval '14 days');
        new.last_active_at := coalesce(new.last_active_at, timezone('utc', now()));
    elsif new.username is distinct from old.username then
        if old.username_change_available_at > timezone('utc', now()) then
            raise exception 'Usernames can only be changed once every 14 days.';
        end if;

        new.username_changed_at := timezone('utc', now());
        new.username_change_available_at := timezone('utc', now()) + interval '14 days';
    end if;

    new.is_trusted := coalesce(new.trusted_2fa_enabled, false);
    new.role_label := public.resolve_effective_role_label(new.base_role_key, new.is_trusted);
    new.updated_at := timezone('utc', now());
    return new;
end;
$$;

create or replace function public.handle_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    base_username text;
    final_username text;
    suffix text;
    display_value text;
begin
    base_username := lower(
        regexp_replace(
            coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'member'),
            '[^a-zA-Z0-9_\.]',
            '',
            'g'
        )
    );

    base_username := trim(both '.' from left(base_username, 24));

    if char_length(base_username) < 3 then
        base_username := 'member';
    end if;

    final_username := base_username;

    if exists (select 1 from public.profiles where username = final_username and id <> new.id) then
        suffix := right(replace(new.id::text, '-', ''), 4);
        final_username := left(base_username, greatest(3, 24 - char_length(suffix) - 1)) || '_' || suffix;
    end if;

    display_value := coalesce(
        nullif(new.raw_user_meta_data ->> 'display_name', ''),
        nullif(new.raw_user_meta_data ->> 'username', ''),
        case when public.is_virtual_hollowside_email(new.email) then null else split_part(new.email, '@', 1) end,
        'Hollowside Member'
    );

    insert into public.profiles (
        id,
        username,
        display_name,
        base_role_key,
        is_trusted,
        role_label,
        trusted_2fa_enabled,
        trusted_2fa_channel,
        trusted_2fa_contact,
        trusted_2fa_verified_at
    )
    values (
        new.id,
        final_username,
        display_value,
        'member',
        false,
        public.resolve_effective_role_label('member', false),
        false,
        '',
        '',
        null
    )
    on conflict (id) do update
    set role_label = public.resolve_effective_role_label(public.profiles.base_role_key, public.profiles.trusted_2fa_enabled);

    return new;
end;
$$;

drop trigger if exists on_auth_user_profile_sync on auth.users;
create trigger on_auth_user_profile_sync
after insert or update of email_confirmed_at, raw_user_meta_data, email on auth.users
for each row
execute function public.handle_profile_for_auth_user();

create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
security definer
set search_path = public
stable
as $$
    select au.email
    from public.profiles p
    join auth.users au on au.id = p.id
    where lower(p.username) = lower(trim(coalesce(p_identifier, '')))
    limit 1;
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.acknowledge_legacy_2fa_notice()
returns void
language sql
security definer
set search_path = public
as $$
    update public.profiles
    set legacy_email_verification_notice_pending = false
    where id = auth.uid();
$$;

grant execute on function public.acknowledge_legacy_2fa_notice() to authenticated;

drop function if exists public.get_my_account_context();
create or replace function public.get_my_account_context()
returns table (
    id uuid,
    account_id text,
    username text,
    display_name text,
    avatar_url text,
    role_label text,
    is_verified boolean,
    verification_mode text,
    can_manage_roles boolean,
    can_manage_role_permissions boolean,
    can_manage_account_permissions boolean,
    can_verify_accounts boolean,
    can_publish_news boolean,
    can_publish_personal_posts boolean,
    can_publish_downloads boolean,
    can_comment_posts boolean,
    can_manage_reports boolean,
    can_issue_warnings boolean,
    can_suspend_accounts boolean,
    can_ban_accounts boolean,
    can_access_moderation boolean,
    can_react_to_posts boolean,
    is_suspended boolean,
    is_banned boolean,
    restriction_until timestamptz,
    restriction_label text,
    unread_notification_count bigint,
    effective_role_key text,
    can_moderate_content boolean,
    can_moderate_news boolean,
    is_2fa_enabled boolean,
    two_factor_channel text,
    two_factor_contact text,
    trusted_2fa_verified_at timestamptz,
    should_show_legacy_2fa_notice boolean
)
language sql
security definer
set search_path = public
stable
as $$
    with profile_base as (
        select p.*,
               public.resolve_effective_role_key(p.base_role_key, p.is_trusted) as effective_role_key,
               public.get_effective_permission_value(p.id, 'manage_roles') as raw_manage_roles,
               public.get_effective_permission_value(p.id, 'manage_role_permissions') as raw_manage_role_permissions,
               public.get_effective_permission_value(p.id, 'manage_account_permissions') as raw_manage_account_permissions,
               public.get_effective_permission_value(p.id, 'verify_accounts') as raw_verify_accounts,
               public.get_effective_permission_value(p.id, 'publish_news') as raw_publish_news,
               public.get_effective_permission_value(p.id, 'publish_personal_posts') as raw_publish_personal_posts,
               public.get_effective_permission_value(p.id, 'publish_downloads') as raw_publish_downloads,
               public.get_effective_permission_value(p.id, 'comment_posts') as raw_comment_posts,
               public.get_effective_permission_value(p.id, 'manage_reports') as raw_manage_reports,
               public.get_effective_permission_value(p.id, 'issue_warnings') as raw_issue_warnings,
               public.get_effective_permission_value(p.id, 'suspend_accounts') as raw_suspend_accounts,
               public.get_effective_permission_value(p.id, 'ban_accounts') as raw_ban_accounts
        from public.profiles p
        where p.id = auth.uid()
    )
    select
        pb.id,
        pb.account_id,
        pb.username,
        pb.display_name,
        pb.avatar_url,
        public.resolve_effective_role_label(pb.base_role_key, pb.is_trusted) as role_label,
        public.resolve_is_verified(
            pb.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = pb.id),
            pb.created_at,
            pb.last_active_at
        ) as is_verified,
        public.resolve_verification_mode(
            pb.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = pb.id),
            pb.created_at,
            pb.last_active_at
        ) as verification_mode,
        pb.raw_manage_roles as can_manage_roles,
        pb.raw_manage_role_permissions as can_manage_role_permissions,
        pb.raw_manage_account_permissions as can_manage_account_permissions,
        pb.raw_verify_accounts as can_verify_accounts,
        (pb.raw_publish_news and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_publish_news,
        (pb.raw_publish_personal_posts and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_publish_personal_posts,
        (pb.raw_publish_downloads and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_publish_downloads,
        (pb.raw_comment_posts and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_comment_posts,
        pb.raw_manage_reports as can_manage_reports,
        pb.raw_issue_warnings as can_issue_warnings,
        pb.raw_suspend_accounts as can_suspend_accounts,
        pb.raw_ban_accounts as can_ban_accounts,
        (
            pb.raw_manage_reports
            or pb.raw_issue_warnings
            or pb.raw_suspend_accounts
            or pb.raw_ban_accounts
            or pb.effective_role_key in ('owner', 'co_owner', 'head_moderator', 'moderator')
        ) as can_access_moderation,
        (coalesce(s.sanction_type, '') <> 'ban') as can_react_to_posts,
        (coalesce(s.sanction_type, '') = 'suspension') as is_suspended,
        (coalesce(s.sanction_type, '') = 'ban') as is_banned,
        s.expires_at as restriction_until,
        case
            when s.sanction_type = 'ban' then 'Banned'
            when s.sanction_type = 'suspension' then 'Suspended'
            else ''
        end as restriction_label,
        coalesce((
            select count(*)
            from public.notifications n
            where n.user_id = pb.id
              and n.is_read = false
        ), 0)::bigint as unread_notification_count,
        pb.effective_role_key,
        (pb.effective_role_key in ('owner', 'co_owner', 'head_moderator', 'moderator')) as can_moderate_content,
        (pb.effective_role_key in ('owner', 'co_owner')) as can_moderate_news,
        pb.trusted_2fa_enabled as is_2fa_enabled,
        pb.trusted_2fa_channel as two_factor_channel,
        pb.trusted_2fa_contact as two_factor_contact,
        pb.trusted_2fa_verified_at,
        pb.legacy_email_verification_notice_pending as should_show_legacy_2fa_notice
    from profile_base pb
    left join lateral public.get_active_sanction(pb.id) s on true;
$$;
