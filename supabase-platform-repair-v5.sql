-- Run this after:
-- 1. supabase-role-system-v3.sql
-- 2. supabase-social-expansion-v4.sql
--
-- This pass is the signup repair + API polish layer. It re-creates the
-- auth->profile trigger path, backfills any missing profiles, and adds the
-- RPCs the frontend needs for verification, posting, media, reactions, and comments.

create extension if not exists pgcrypto;

create or replace function public.profile_sync_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    auth_confirmed boolean;
begin
    new.username := lower(trim(both '.' from coalesce(new.username, '')));
    new.display_name := left(coalesce(nullif(trim(new.display_name), ''), 'Hollowside Member'), 48);
    new.bio := left(coalesce(new.bio, ''), 240);
    new.website_url := left(coalesce(new.website_url, ''), 160);
    new.location := left(coalesce(new.location, ''), 80);
    new.base_role_key := coalesce(new.base_role_key, 'member');
    new.last_active_at := coalesce(new.last_active_at, timezone('utc', now()));

    if new.username !~ '^[a-z0-9_\.]+$' then
        raise exception 'Usernames can only use lowercase letters, numbers, underscores, and periods.';
    end if;

    if char_length(new.username) < 3 or char_length(new.username) > 24 then
        raise exception 'Usernames must be between 3 and 24 characters.';
    end if;

    if tg_op = 'INSERT' then
        new.username_changed_at := coalesce(new.username_changed_at, timezone('utc', now()));
        new.username_change_available_at := coalesce(new.username_change_available_at, timezone('utc', now()) + interval '14 days');
    elsif new.username is distinct from old.username then
        if old.username_change_available_at > timezone('utc', now()) then
            raise exception 'Usernames can only be changed once every 14 days.';
        end if;

        new.username_changed_at := timezone('utc', now());
        new.username_change_available_at := timezone('utc', now()) + interval '14 days';
    end if;

    select (email_confirmed_at is not null)
    into auth_confirmed
    from auth.users
    where id = new.id;

    new.is_trusted := coalesce(auth_confirmed, new.is_trusted, false);
    new.role_label := public.resolve_effective_role_label(new.base_role_key, new.is_trusted);

    if coalesce(new.manual_verified, false) = false then
        new.verified_at := null;
        new.verified_by := null;
    elsif new.verified_at is null then
        new.verified_at := timezone('utc', now());
    end if;

    new.verification_note := coalesce(new.verification_note, '');
    new.updated_at := timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists profiles_sync_before_write on public.profiles;
create trigger profiles_sync_before_write
before insert or update on public.profiles
for each row
execute function public.profile_sync_before_write();

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
    trusted_value boolean;
begin
    trusted_value := new.email_confirmed_at is not null;

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
        split_part(new.email, '@', 1),
        'Hollowside Member'
    );

    insert into public.profiles (
        id,
        username,
        display_name,
        base_role_key,
        is_trusted,
        role_label,
        last_active_at
    )
    values (
        new.id,
        final_username,
        display_value,
        'member',
        trusted_value,
        public.resolve_effective_role_label('member', trusted_value),
        timezone('utc', now())
    )
    on conflict (id) do update
    set is_trusted = excluded.is_trusted,
        role_label = public.resolve_effective_role_label(public.profiles.base_role_key, excluded.is_trusted);

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
drop trigger if exists on_auth_user_profile_sync on auth.users;
create trigger on_auth_user_profile_sync
after insert or update of email_confirmed_at, raw_user_meta_data, email on auth.users
for each row
execute function public.handle_profile_for_auth_user();

insert into public.profiles (
    id,
    username,
    display_name,
    base_role_key,
    is_trusted,
    role_label,
    last_active_at
)
select
    au.id,
    case
        when char_length(au.base_username) < 3 then 'member_' || right(replace(au.id::text, '-', ''), 4)
        else left(au.base_username, 19) || '_' || right(replace(au.id::text, '-', ''), 4)
    end,
    coalesce(
        nullif(au.raw_user_meta_data ->> 'display_name', ''),
        nullif(au.raw_user_meta_data ->> 'username', ''),
        split_part(au.email, '@', 1),
        'Hollowside Member'
    ),
    'member',
    (au.email_confirmed_at is not null),
    public.resolve_effective_role_label('member', au.email_confirmed_at is not null),
    timezone('utc', now())
from (
    select
        id,
        email,
        raw_user_meta_data,
        email_confirmed_at,
        trim(both '.' from left(
            lower(
                regexp_replace(
                    coalesce(raw_user_meta_data ->> 'username', split_part(email, '@', 1), 'member'),
                    '[^a-zA-Z0-9_\.]',
                    '',
                    'g'
                )
            ),
            24
        )) as base_username
    from auth.users
) au
where not exists (
    select 1
    from public.profiles p
    where p.id = au.id
)
on conflict (id) do nothing;

alter table if exists public.content_post_media
    add column if not exists sort_order integer not null default 0;

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
    can_comment_posts boolean
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
        p.avatar_url,
        p.role_label,
        public.resolve_is_verified(
            p.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = p.id),
            p.created_at,
            p.last_active_at
        ) as is_verified,
        public.resolve_verification_mode(
            p.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = p.id),
            p.created_at,
            p.last_active_at
        ) as verification_mode,
        public.get_effective_permission_value(p.id, 'manage_roles') as can_manage_roles,
        public.get_effective_permission_value(p.id, 'manage_role_permissions') as can_manage_role_permissions,
        public.get_effective_permission_value(p.id, 'manage_account_permissions') as can_manage_account_permissions,
        public.get_effective_permission_value(p.id, 'verify_accounts') as can_verify_accounts,
        public.get_effective_permission_value(p.id, 'publish_news') as can_publish_news,
        public.get_effective_permission_value(p.id, 'publish_personal_posts') as can_publish_personal_posts,
        public.get_effective_permission_value(p.id, 'comment_posts') as can_comment_posts
    from public.profiles p
    where p.id = auth.uid();
$$;

create or replace function public.set_follow_state(p_target_account_id text, p_follow boolean)
returns table (
    viewer_is_following boolean,
    viewer_is_followed_by boolean,
    viewer_is_friend boolean,
    follower_count integer,
    following_count integer,
    friend_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    viewer_id uuid;
    target_id uuid;
    current_following_count integer;
    already_following boolean;
begin
    viewer_id := auth.uid();

    if viewer_id is null then
        raise exception 'You must be logged in to follow accounts.';
    end if;

    select id
    into target_id
    from public.profiles
    where account_id = p_target_account_id;

    if target_id is null then
        raise exception 'Target account not found.';
    end if;

    if viewer_id = target_id then
        raise exception 'You cannot follow yourself.';
    end if;

    if p_follow then
        select exists (
            select 1
            from public.account_follows
            where follower_id = viewer_id
              and following_id = target_id
        )
        into already_following;

        if not already_following then
            select count(*)::integer
            into current_following_count
            from public.account_follows
            where follower_id = viewer_id;

            if current_following_count >= 10000 then
                raise exception 'Accounts can only follow up to 10,000 people right now.';
            end if;

            insert into public.account_follows (follower_id, following_id)
            values (viewer_id, target_id)
            on conflict do nothing;
        end if;
    else
        delete from public.account_follows
        where follower_id = viewer_id
          and following_id = target_id;
    end if;

    perform public.touch_my_activity();

    return query
    select
        exists (select 1 from public.account_follows where follower_id = viewer_id and following_id = target_id),
        exists (select 1 from public.account_follows where follower_id = target_id and following_id = viewer_id),
        exists (select 1 from public.account_follows where follower_id = viewer_id and following_id = target_id)
        and exists (select 1 from public.account_follows where follower_id = target_id and following_id = viewer_id),
        (select count(*)::integer from public.account_follows where following_id = target_id),
        (select count(*)::integer from public.account_follows where follower_id = target_id),
        (
            select count(*)::integer
            from public.account_follows af
            where af.follower_id = target_id
              and exists (
                  select 1 from public.account_follows back
                  where back.follower_id = af.following_id
                    and back.following_id = target_id
              )
        );
end;
$$;

create or replace view public.content_comment_cards as
select
    cpc.id,
    cpc.post_id,
    cpc.author_id,
    cpc.parent_id,
    cpc.body,
    cpc.created_at,
    cpc.updated_at,
    pc.account_id as author_account_id,
    pc.display_name as author_display_name,
    pc.username as author_username,
    pc.avatar_url as author_avatar_url,
    pc.role_label as author_role_label,
    pc.is_verified as author_is_verified,
    pc.verification_mode as author_verification_mode
from public.content_post_comments cpc
join public.profile_cards pc on pc.id = cpc.author_id;

create or replace function public.attach_post_media(
    p_post_id uuid,
    p_media_type text,
    p_media_url text,
    p_media_path text default '',
    p_sort_order integer default 0
)
returns public.content_post_media
language plpgsql
security definer
set search_path = public
as $$
declare
    target_post public.content_posts;
    media_row public.content_post_media;
begin
    select *
    into target_post
    from public.content_posts
    where id = p_post_id;

    if target_post.id is null then
        raise exception 'Target post not found.';
    end if;

    if target_post.author_id <> auth.uid() then
        raise exception 'You can only attach media to your own posts.';
    end if;

    insert into public.content_post_media (post_id, media_type, media_url, media_path, sort_order)
    values (p_post_id, p_media_type, p_media_url, coalesce(p_media_path, ''), coalesce(p_sort_order, 0))
    returning * into media_row;

    return media_row;
end;
$$;

create or replace function public.clear_post_reaction(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.content_post_reactions
    where post_id = p_post_id
      and user_id = auth.uid();
end;
$$;

create or replace function public.get_post_feed(
    p_post_type text default null,
    p_author_account_id text default null,
    p_limit integer default 20
)
returns table (
    id uuid,
    post_type text,
    title text,
    body text,
    summary text,
    author_id uuid,
    author_account_id text,
    author_display_name text,
    author_username text,
    author_avatar_url text,
    author_role_label text,
    author_is_verified boolean,
    author_verification_mode text,
    created_at timestamptz,
    updated_at timestamptz,
    like_count bigint,
    dislike_count bigint,
    comment_count bigint,
    viewer_reaction text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    viewer_id uuid;
begin
    viewer_id := auth.uid();

    return query
    select
        cpc.id,
        cpc.post_type,
        cpc.title,
        cpc.body,
        cpc.summary,
        cpc.author_id,
        cpc.author_account_id,
        cpc.author_display_name,
        cpc.author_username,
        cpc.author_avatar_url,
        cpc.author_role_label,
        cpc.author_is_verified,
        cpc.author_verification_mode,
        cpc.created_at,
        cpc.updated_at,
        cpc.like_count,
        cpc.dislike_count,
        cpc.comment_count,
        (
            select reaction_type
            from public.content_post_reactions cpr
            where cpr.post_id = cpc.id
              and cpr.user_id = viewer_id
            limit 1
        ) as viewer_reaction
    from public.content_post_cards cpc
    where (p_post_type is null or cpc.post_type = p_post_type)
      and (p_author_account_id is null or cpc.author_account_id = p_author_account_id)
    order by cpc.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

create or replace function public.get_post_media(p_post_id uuid)
returns setof public.content_post_media
language sql
security definer
set search_path = public
stable
as $$
    select *
    from public.content_post_media
    where post_id = p_post_id
    order by sort_order asc, id asc;
$$;

create or replace function public.get_post_comments(p_post_id uuid, p_limit integer default 60)
returns setof public.content_comment_cards
language sql
security definer
set search_path = public
stable
as $$
    select *
    from public.content_comment_cards
    where post_id = p_post_id
    order by created_at asc
    limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

update public.profiles
set base_role_key = 'owner'
where account_id = 'hsg_TU2ENN2DHC';
