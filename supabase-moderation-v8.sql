create extension if not exists pgcrypto;

alter table if exists public.notifications
    add column if not exists metadata jsonb not null default '{}'::jsonb,
    add column if not exists severity text not null default 'info';

insert into public.permission_definitions (permission_key, label, description, category)
values
    ('manage_reports', 'Manage Reports', 'Can review, resolve, and act on incoming reports.', 'moderation'),
    ('issue_warnings', 'Issue Warnings', 'Can issue formal account warnings to lower ranked accounts.', 'moderation'),
    ('suspend_accounts', 'Suspend Accounts', 'Can temporarily suspend lower ranked accounts.', 'moderation'),
    ('ban_accounts', 'Ban Accounts', 'Can ban eligible lower ranked accounts from community access.', 'moderation')
on conflict (permission_key) do update
set label = excluded.label,
    description = excluded.description,
    category = excluded.category;

insert into public.role_permissions (role_key, permission_key, allowed)
values
    ('owner', 'manage_reports', true),
    ('owner', 'issue_warnings', true),
    ('owner', 'suspend_accounts', true),
    ('owner', 'ban_accounts', true),
    ('co_owner', 'manage_reports', true),
    ('co_owner', 'issue_warnings', true),
    ('co_owner', 'suspend_accounts', true),
    ('co_owner', 'ban_accounts', true),
    ('head_moderator', 'manage_reports', true),
    ('head_moderator', 'issue_warnings', true),
    ('head_moderator', 'suspend_accounts', true),
    ('head_moderator', 'ban_accounts', true),
    ('moderator', 'manage_reports', true),
    ('moderator', 'issue_warnings', true),
    ('moderator', 'suspend_accounts', true)
on conflict (role_key, permission_key) do update
set allowed = excluded.allowed;

create table if not exists public.account_blocks (
    blocker_id uuid not null references public.profiles (id) on delete cascade,
    blocked_id uuid not null references public.profiles (id) on delete cascade,
    reason text not null default '',
    created_at timestamptz not null default timezone('utc', now()),
    primary key (blocker_id, blocked_id),
    constraint account_blocks_no_self check (blocker_id <> blocked_id)
);

create table if not exists public.account_reports (
    id bigint generated always as identity primary key,
    reporter_id uuid not null references public.profiles (id) on delete cascade,
    target_user_id uuid not null references public.profiles (id) on delete cascade,
    target_post_id uuid references public.content_posts (id) on delete cascade,
    target_type text not null,
    reason text not null,
    details text not null default '',
    state text not null default 'open',
    created_at timestamptz not null default timezone('utc', now()),
    resolved_at timestamptz,
    resolved_by uuid references public.profiles (id),
    resolution_note text not null default '',
    constraint account_reports_type_check check (target_type in ('account', 'post')),
    constraint account_reports_state_check check (state in ('open', 'reviewed', 'dismissed', 'actioned'))
);

create table if not exists public.account_warnings (
    id bigint generated always as identity primary key,
    target_user_id uuid not null references public.profiles (id) on delete cascade,
    actor_id uuid not null references public.profiles (id) on delete cascade,
    reason text not null,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.account_sanctions (
    id bigint generated always as identity primary key,
    target_user_id uuid not null references public.profiles (id) on delete cascade,
    actor_id uuid not null references public.profiles (id) on delete cascade,
    sanction_type text not null,
    reason text not null default '',
    created_at timestamptz not null default timezone('utc', now()),
    expires_at timestamptz,
    lifted_at timestamptz,
    lifted_by uuid references public.profiles (id),
    lift_note text not null default '',
    constraint account_sanctions_type_check check (sanction_type in ('suspension', 'ban'))
);

alter table public.account_blocks enable row level security;
alter table public.account_reports enable row level security;
alter table public.account_warnings enable row level security;
alter table public.account_sanctions enable row level security;

drop policy if exists "Users read their own blocks" on public.account_blocks;
create policy "Users read their own blocks"
on public.account_blocks
for select
to authenticated
using (auth.uid() = blocker_id);

drop policy if exists "Users manage their own blocks" on public.account_blocks;
create policy "Users manage their own blocks"
on public.account_blocks
for all
to authenticated
using (auth.uid() = blocker_id)
with check (auth.uid() = blocker_id);

create or replace function public.create_notification(
    p_user_id uuid,
    p_kind text,
    p_title text,
    p_body text default '',
    p_link_url text default '',
    p_severity text default 'info',
    p_metadata jsonb default '{}'::jsonb
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
    notification_row public.notifications;
begin
    insert into public.notifications (
        user_id,
        kind,
        title,
        body,
        link_url,
        severity,
        metadata
    )
    values (
        p_user_id,
        coalesce(p_kind, 'info'),
        coalesce(p_title, 'Notification'),
        coalesce(p_body, ''),
        coalesce(p_link_url, ''),
        coalesce(p_severity, 'info'),
        coalesce(p_metadata, '{}'::jsonb)
    )
    returning * into notification_row;

    return notification_row;
end;
$$;

create or replace function public.has_block_relation(p_left uuid, p_right uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select case
        when p_left is null or p_right is null or p_left = p_right then false
        else exists (
            select 1
            from public.account_blocks ab
            where (ab.blocker_id = p_left and ab.blocked_id = p_right)
               or (ab.blocker_id = p_right and ab.blocked_id = p_left)
        )
    end;
$$;

create or replace function public.get_active_sanction(p_user_id uuid)
returns table (
    id bigint,
    sanction_type text,
    reason text,
    created_at timestamptz,
    expires_at timestamptz,
    actor_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
    select
        s.id,
        s.sanction_type,
        s.reason,
        s.created_at,
        s.expires_at,
        s.actor_id
    from public.account_sanctions s
    where s.target_user_id = p_user_id
      and s.lifted_at is null
      and (s.expires_at is null or s.expires_at > timezone('utc', now()))
    order by case when s.sanction_type = 'ban' then 2 else 1 end desc,
             s.created_at desc
    limit 1;
$$;

create or replace function public.is_account_banned(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.account_sanctions s
        where s.target_user_id = p_user_id
          and s.sanction_type = 'ban'
          and s.lifted_at is null
          and (s.expires_at is null or s.expires_at > timezone('utc', now()))
    );
$$;

create or replace function public.is_account_suspended(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.account_sanctions s
        where s.target_user_id = p_user_id
          and s.sanction_type = 'suspension'
          and s.lifted_at is null
          and (s.expires_at is null or s.expires_at > timezone('utc', now()))
    );
$$;

create or replace function public.actor_can_moderate_target(p_actor_id uuid, p_target_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    actor_rank integer;
    target_rank integer;
    actor_role text;
    target_role text;
begin
    if p_actor_id is null or p_target_id is null or p_actor_id = p_target_id then
        return false;
    end if;

    select public.resolve_effective_role_key(base_role_key, is_trusted),
           public.get_role_rank(public.resolve_effective_role_key(base_role_key, is_trusted))
    into actor_role, actor_rank
    from public.profiles
    where id = p_actor_id;

    select public.resolve_effective_role_key(base_role_key, is_trusted),
           public.get_role_rank(public.resolve_effective_role_key(base_role_key, is_trusted))
    into target_role, target_rank
    from public.profiles
    where id = p_target_id;

    if actor_rank is null or target_rank is null or actor_rank <= target_rank then
        return false;
    end if;

    if p_action = 'warning' then
        return public.get_effective_permission_value(p_actor_id, 'issue_warnings');
    elsif p_action = 'suspend' then
        return public.get_effective_permission_value(p_actor_id, 'suspend_accounts');
    elsif p_action = 'ban' then
        if not public.get_effective_permission_value(p_actor_id, 'ban_accounts') then
            return false;
        end if;

        if actor_role = 'head_moderator' and target_role not in ('member', 'trusted_member', 'moderator') then
            return false;
        end if;

        return true;
    elsif p_action = 'report' then
        return public.get_effective_permission_value(p_actor_id, 'manage_reports');
    end if;

    return false;
end;
$$;

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
    unread_notification_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
    with profile_base as (
        select p.*,
               public.get_effective_permission_value(p.id, 'manage_roles') as raw_manage_roles,
               public.get_effective_permission_value(p.id, 'manage_role_permissions') as raw_manage_role_permissions,
               public.get_effective_permission_value(p.id, 'manage_account_permissions') as raw_manage_account_permissions,
               public.get_effective_permission_value(p.id, 'verify_accounts') as raw_verify_accounts,
               public.get_effective_permission_value(p.id, 'publish_news') as raw_publish_news,
               public.get_effective_permission_value(p.id, 'publish_personal_posts') as raw_publish_personal_posts,
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
        pb.role_label,
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
        (pb.raw_comment_posts and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_comment_posts,
        pb.raw_manage_reports as can_manage_reports,
        pb.raw_issue_warnings as can_issue_warnings,
        pb.raw_suspend_accounts as can_suspend_accounts,
        pb.raw_ban_accounts as can_ban_accounts,
        (pb.raw_manage_reports or pb.raw_issue_warnings or pb.raw_suspend_accounts or pb.raw_ban_accounts) as can_access_moderation,
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
        ), 0)::bigint as unread_notification_count
    from profile_base pb
    left join lateral public.get_active_sanction(pb.id) s on true;
$$;

drop function if exists public.get_profile_view(text);
drop function if exists public.search_profile_cards(text, boolean, boolean, boolean, integer);
drop function if exists public.get_profile_connections(text, text, integer);
create or replace view public.profile_cards as
select
    p.id,
    p.account_id,
    p.username,
    p.display_name,
    p.bio,
    p.avatar_url,
    public.resolve_effective_role_key(p.base_role_key, p.is_trusted) as role_key,
    public.resolve_effective_role_label(p.base_role_key, p.is_trusted) as role_label,
    p.created_at as member_since,
    coalesce(followers.count_value, 0)::integer as follower_count,
    coalesce(following.count_value, 0)::integer as following_count,
    coalesce(friends.count_value, 0)::integer as friend_count,
    public.resolve_is_verified(
        p.manual_verified,
        coalesce(followers.count_value, 0)::integer,
        p.created_at,
        p.last_active_at
    ) as is_verified,
    public.resolve_verification_mode(
        p.manual_verified,
        coalesce(followers.count_value, 0)::integer,
        p.created_at,
        p.last_active_at
    ) as verification_mode,
    case
        when sanctions.sanction_type = 'ban' then 'Banned'
        when sanctions.sanction_type = 'suspension' then 'Suspended'
        else ''
    end as public_restriction_label,
    sanctions.expires_at as restriction_until,
    (coalesce(sanctions.sanction_type, '') = 'suspension') as is_suspended,
    (coalesce(sanctions.sanction_type, '') = 'ban') as is_banned
from public.profiles p
left join lateral (
    select count(*) as count_value
    from public.account_follows af
    where af.following_id = p.id
) followers on true
left join lateral (
    select count(*) as count_value
    from public.account_follows af
    where af.follower_id = p.id
) following on true
left join lateral (
    select count(*) as count_value
    from public.account_follows af
    where af.follower_id = p.id
      and exists (
          select 1
          from public.account_follows back
          where back.follower_id = af.following_id
            and back.following_id = p.id
      )
) friends on true
left join lateral public.get_active_sanction(p.id) sanctions on true;

create or replace function public.search_profile_cards(
    p_query text default '',
    p_use_display boolean default true,
    p_use_username boolean default true,
    p_use_account_id boolean default false,
    p_limit integer default 24
)
returns setof public.profile_cards
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    q text;
    viewer_id uuid;
begin
    q := lower(trim(coalesce(p_query, '')));
    viewer_id := auth.uid();

    return query
    select *
    from public.profile_cards pc
    where (
            q = ''
            or (
                (p_use_display and lower(pc.display_name) like '%' || q || '%')
                or (p_use_username and lower(pc.username) like '%' || q || '%')
                or (p_use_account_id and lower(pc.account_id) like '%' || q || '%')
            )
        )
      and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
    order by pc.member_since desc
    limit greatest(1, least(coalesce(p_limit, 24), 60));
end;
$$;

create or replace function public.get_profile_view(p_account_id text)
returns table (
    id uuid,
    account_id text,
    username text,
    display_name text,
    bio text,
    avatar_url text,
    role_key text,
    role_label text,
    member_since timestamptz,
    follower_count integer,
    following_count integer,
    friend_count integer,
    is_verified boolean,
    verification_mode text,
    public_restriction_label text,
    restriction_until timestamptz,
    viewer_is_following boolean,
    viewer_is_followed_by boolean,
    viewer_is_friend boolean
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
        pc.id,
        pc.account_id,
        pc.username,
        pc.display_name,
        pc.bio,
        pc.avatar_url,
        pc.role_key,
        pc.role_label,
        pc.member_since,
        pc.follower_count,
        pc.following_count,
        pc.friend_count,
        pc.is_verified,
        pc.verification_mode,
        pc.public_restriction_label,
        pc.restriction_until,
        exists (
            select 1
            from public.account_follows af
            where af.follower_id = viewer_id
              and af.following_id = pc.id
        ) as viewer_is_following,
        exists (
            select 1
            from public.account_follows af
            where af.follower_id = pc.id
              and af.following_id = viewer_id
        ) as viewer_is_followed_by,
        exists (
            select 1
            from public.account_follows af
            where af.follower_id = viewer_id
              and af.following_id = pc.id
        )
        and exists (
            select 1
            from public.account_follows af
            where af.follower_id = pc.id
              and af.following_id = viewer_id
        ) as viewer_is_friend
    from public.profile_cards pc
    where pc.account_id = p_account_id
      and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
    limit 1;
end;
$$;

create or replace function public.get_profile_connections(
    p_account_id text,
    p_kind text,
    p_limit integer default 18
)
returns setof public.profile_cards
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    target_id uuid;
    viewer_id uuid;
begin
    viewer_id := auth.uid();

    select id into target_id
    from public.profiles
    where account_id = p_account_id;

    if target_id is null then
        return;
    end if;

    if viewer_id is not null and public.has_block_relation(viewer_id, target_id) then
        return;
    end if;

    if p_kind = 'followers' then
        return query
        select pc.*
        from public.account_follows af
        join public.profile_cards pc on pc.id = af.follower_id
        where af.following_id = target_id
          and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
        order by pc.member_since desc
        limit greatest(1, least(coalesce(p_limit, 18), 50));
    elsif p_kind = 'following' then
        return query
        select pc.*
        from public.account_follows af
        join public.profile_cards pc on pc.id = af.following_id
        where af.follower_id = target_id
          and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
        order by pc.member_since desc
        limit greatest(1, least(coalesce(p_limit, 18), 50));
    elsif p_kind = 'friends' then
        return query
        select pc.*
        from public.account_follows af
        join public.profile_cards pc on pc.id = af.following_id
        where af.follower_id = target_id
          and exists (
              select 1
              from public.account_follows back
              where back.follower_id = af.following_id
                and back.following_id = target_id
          )
          and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
        order by pc.member_since desc
        limit greatest(1, least(coalesce(p_limit, 18), 50));
    end if;
end;
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

    if public.is_account_banned(viewer_id) then
        raise exception 'Banned accounts cannot follow anyone.';
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

    if public.has_block_relation(viewer_id, target_id) then
        raise exception 'That account is unavailable because one of you has blocked the other.';
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

create or replace function public.create_content_post(
    p_post_type text,
    p_title text,
    p_body text,
    p_summary text default '',
    p_subtitle text default ''
)
returns public.content_posts
language plpgsql
security definer
set search_path = public
as $$
declare
    author_id uuid;
    created_post public.content_posts;
begin
    author_id := auth.uid();

    if author_id is null then
        raise exception 'You must be logged in to create posts.';
    end if;

    if public.is_account_banned(author_id) then
        raise exception 'Banned accounts can only read official news and account notices.';
    end if;

    if public.is_account_suspended(author_id) then
        raise exception 'Suspended accounts cannot publish posts until the suspension ends.';
    end if;

    if p_post_type = 'news' then
        if not public.get_effective_permission_value(author_id, 'publish_news') then
            raise exception 'You do not have permission to publish news.';
        end if;
    elsif p_post_type = 'profile' then
        if not public.get_effective_permission_value(author_id, 'publish_personal_posts') then
            raise exception 'You do not have permission to publish profile posts.';
        end if;
    else
        raise exception 'Unsupported post type.';
    end if;

    insert into public.content_posts (
        author_id,
        post_type,
        subtitle,
        title,
        body,
        summary
    )
    values (
        author_id,
        p_post_type,
        left(coalesce(p_subtitle, ''), 48),
        coalesce(p_title, ''),
        coalesce(p_body, ''),
        coalesce(p_summary, '')
    )
    returning * into created_post;

    return created_post;
end;
$$;

create or replace function public.update_content_post(
    p_post_id uuid,
    p_title text,
    p_body text,
    p_summary text default '',
    p_subtitle text default ''
)
returns public.content_posts
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    target_post public.content_posts;
    updated_post public.content_posts;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to edit posts.';
    end if;

    if public.is_account_banned(actor_id) then
        raise exception 'Banned accounts cannot edit posts.';
    end if;

    if public.is_account_suspended(actor_id) then
        raise exception 'Suspended accounts cannot edit posts until the suspension ends.';
    end if;

    select *
    into target_post
    from public.content_posts
    where id = p_post_id;

    if target_post.id is null then
        raise exception 'Target post not found.';
    end if;

    if target_post.author_id <> actor_id then
        raise exception 'You can only edit your own posts.';
    end if;

    if target_post.post_type = 'news' then
        if not public.get_effective_permission_value(actor_id, 'publish_news') then
            raise exception 'You do not have permission to edit news posts.';
        end if;

        if char_length(trim(coalesce(p_title, ''))) = 0 then
            raise exception 'News posts must have a title.';
        end if;
    elsif target_post.post_type = 'profile' then
        if not public.get_effective_permission_value(actor_id, 'publish_personal_posts') then
            raise exception 'You do not have permission to edit profile posts.';
        end if;
    else
        raise exception 'Unsupported post type.';
    end if;

    update public.content_posts
    set subtitle = case
            when target_post.post_type = 'news' then left(coalesce(p_subtitle, ''), 48)
            else coalesce(subtitle, '')
        end,
        title = case
            when target_post.post_type = 'news' then coalesce(p_title, '')
            else ''
        end,
        body = coalesce(p_body, ''),
        summary = case
            when target_post.post_type = 'news' then coalesce(p_summary, '')
            else ''
        end,
        updated_at = timezone('utc', now())
    where id = p_post_id
    returning * into updated_post;

    return updated_post;
end;
$$;

create or replace function public.delete_content_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    target_post public.content_posts;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to delete posts.';
    end if;

    select *
    into target_post
    from public.content_posts
    where id = p_post_id;

    if target_post.id is null then
        raise exception 'Target post not found.';
    end if;

    if target_post.author_id <> actor_id then
        raise exception 'You can only delete your own posts.';
    end if;

    delete from public.content_posts
    where id = p_post_id;
end;
$$;

create or replace function public.create_post_comment(
    p_post_id uuid,
    p_body text,
    p_parent_id bigint default null
)
returns public.content_post_comments
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    comment_row public.content_post_comments;
    post_author_id uuid;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to comment.';
    end if;

    if public.is_account_banned(actor_id) then
        raise exception 'Banned accounts cannot comment.';
    end if;

    if public.is_account_suspended(actor_id) then
        raise exception 'Suspended accounts can react, but they cannot comment until the suspension ends.';
    end if;

    if not public.get_effective_permission_value(actor_id, 'comment_posts') then
        raise exception 'You do not have permission to comment yet.';
    end if;

    select cp.author_id
    into post_author_id
    from public.content_posts cp
    where cp.id = p_post_id
      and cp.published = true;

    if post_author_id is null then
        raise exception 'Target post not found.';
    end if;

    if public.has_block_relation(actor_id, post_author_id) then
        raise exception 'That post is unavailable because one of you has blocked the other.';
    end if;

    insert into public.content_post_comments (
        post_id,
        author_id,
        parent_id,
        body
    )
    values (
        p_post_id,
        actor_id,
        p_parent_id,
        trim(coalesce(p_body, ''))
    )
    returning * into comment_row;

    perform public.touch_my_activity();

    return comment_row;
end;
$$;

create or replace function public.set_post_reaction(
    p_post_id uuid,
    p_reaction_type text
)
returns public.content_post_reactions
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    reaction_row public.content_post_reactions;
    post_author_id uuid;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to react to posts.';
    end if;

    if public.is_account_banned(actor_id) then
        raise exception 'Banned accounts cannot react to posts.';
    end if;

    select cp.author_id
    into post_author_id
    from public.content_posts cp
    where cp.id = p_post_id
      and cp.published = true;

    if post_author_id is null then
        raise exception 'Target post not found.';
    end if;

    if public.has_block_relation(actor_id, post_author_id) then
        raise exception 'That post is unavailable because one of you has blocked the other.';
    end if;

    insert into public.content_post_reactions (
        post_id,
        user_id,
        reaction_type
    )
    values (
        p_post_id,
        actor_id,
        p_reaction_type
    )
    on conflict (post_id, user_id) do update
    set reaction_type = excluded.reaction_type,
        created_at = timezone('utc', now())
    returning * into reaction_row;

    return reaction_row;
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

drop function if exists public.get_post_feed(text, text, integer);
create or replace function public.get_post_feed(
    p_post_type text default null,
    p_author_account_id text default null,
    p_limit integer default 20
)
returns table (
    id uuid,
    post_type text,
    subtitle text,
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
    viewer_banned boolean;
begin
    viewer_id := auth.uid();
    viewer_banned := coalesce(public.is_account_banned(viewer_id), false);

    return query
    select
        cpc.id,
        cpc.post_type,
        cpc.subtitle,
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
      and (viewer_id is null or not public.has_block_relation(viewer_id, cpc.author_id))
      and (not viewer_banned or cpc.post_type = 'news')
    order by cpc.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

drop function if exists public.get_post_detail(uuid);
create or replace function public.get_post_detail(p_post_id uuid)
returns table (
    id uuid,
    post_type text,
    subtitle text,
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
    viewer_banned boolean;
begin
    viewer_id := auth.uid();
    viewer_banned := coalesce(public.is_account_banned(viewer_id), false);

    return query
    select
        cpc.id,
        cpc.post_type,
        cpc.subtitle,
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
    where cpc.id = p_post_id
      and (viewer_id is null or not public.has_block_relation(viewer_id, cpc.author_id))
      and (not viewer_banned or cpc.post_type = 'news')
    limit 1;
end;
$$;

create or replace function public.get_post_comments(p_post_id uuid, p_limit integer default 60)
returns setof public.content_comment_cards
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    viewer_id uuid;
    viewer_banned boolean;
    target_post record;
begin
    viewer_id := auth.uid();
    viewer_banned := coalesce(public.is_account_banned(viewer_id), false);

    select cp.id, cp.author_id, cp.post_type
    into target_post
    from public.content_posts cp
    where cp.id = p_post_id
      and cp.published = true;

    if target_post.id is null then
        return;
    end if;

    if viewer_id is not null and public.has_block_relation(viewer_id, target_post.author_id) then
        return;
    end if;

    if viewer_banned and target_post.post_type <> 'news' then
        return;
    end if;

    return query
    select *
    from public.content_comment_cards ccc
    where ccc.post_id = p_post_id
      and (viewer_id is null or not public.has_block_relation(viewer_id, ccc.author_id))
    order by ccc.created_at asc
    limit greatest(1, least(coalesce(p_limit, 60), 200));
end;
$$;

create or replace function public.set_block_state(
    p_target_account_id text,
    p_block boolean,
    p_reason text default ''
)
returns table (
    blocked boolean,
    target_account_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    target_id uuid;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to update your block list.';
    end if;

    select id
    into target_id
    from public.profiles
    where account_id = p_target_account_id;

    if target_id is null then
        raise exception 'Target account not found.';
    end if;

    if actor_id = target_id then
        raise exception 'You cannot block yourself.';
    end if;

    if p_block then
        insert into public.account_blocks (blocker_id, blocked_id, reason)
        values (actor_id, target_id, left(coalesce(p_reason, ''), 240))
        on conflict (blocker_id, blocked_id) do update
        set reason = excluded.reason,
            created_at = timezone('utc', now());

        delete from public.account_follows
        where (follower_id = actor_id and following_id = target_id)
           or (follower_id = target_id and following_id = actor_id);
    else
        delete from public.account_blocks
        where blocker_id = actor_id
          and blocked_id = target_id;
    end if;

    return query
    select p_block, p_target_account_id;
end;
$$;

create or replace function public.get_block_list()
returns table (
    account_id text,
    username text,
    display_name text,
    avatar_url text,
    role_label text,
    is_verified boolean,
    verification_mode text,
    blocked_at timestamptz,
    block_reason text
)
language sql
security definer
set search_path = public
stable
as $$
    select
        pc.account_id,
        pc.username,
        pc.display_name,
        pc.avatar_url,
        pc.role_label,
        pc.is_verified,
        pc.verification_mode,
        ab.created_at as blocked_at,
        ab.reason as block_reason
    from public.account_blocks ab
    join public.profile_cards pc on pc.id = ab.blocked_id
    where ab.blocker_id = auth.uid()
    order by ab.created_at desc;
$$;

create or replace function public.create_report(
    p_target_type text,
    p_target_account_id text default null,
    p_target_post_id uuid default null,
    p_reason text default '',
    p_details text default ''
)
returns public.account_reports
language plpgsql
security definer
set search_path = public
as $$
declare
    reporter_id uuid;
    target_user_id uuid;
    target_post public.content_posts;
    report_row public.account_reports;
    target_profile record;
    official record;
    report_title text;
    report_link text;
begin
    reporter_id := auth.uid();

    if reporter_id is null then
        raise exception 'You must be logged in to submit a report.';
    end if;

    if public.is_account_banned(reporter_id) then
        raise exception 'Banned accounts cannot submit reports.';
    end if;

    if p_target_type = 'account' then
        select p.id, p.account_id, p.display_name, p.username
        into target_profile
        from public.profiles p
        where p.account_id = p_target_account_id;

        if target_profile.id is null then
            raise exception 'Target account not found.';
        end if;

        target_user_id := target_profile.id;
        report_link := '/profile?id=' || target_profile.account_id;
        report_title := 'Account report';
    elsif p_target_type = 'post' then
        select cp.*
        into target_post
        from public.content_posts cp
        where cp.id = p_target_post_id
          and cp.published = true;

        if target_post.id is null then
            raise exception 'Target post not found.';
        end if;

        target_user_id := target_post.author_id;
        select p.id, p.account_id, p.display_name, p.username
        into target_profile
        from public.profiles p
        where p.id = target_user_id;

        report_link := case
            when target_post.post_type = 'news' then '/news/post?id=' || target_post.id::text
            else '/profile?id=' || target_profile.account_id
        end;
        report_title := 'Post report';
    else
        raise exception 'Unsupported report type.';
    end if;

    if reporter_id = target_user_id then
        raise exception 'You cannot report yourself.';
    end if;

    insert into public.account_reports (
        reporter_id,
        target_user_id,
        target_post_id,
        target_type,
        reason,
        details
    )
    values (
        reporter_id,
        target_user_id,
        p_target_post_id,
        p_target_type,
        left(trim(coalesce(p_reason, '')), 120),
        left(trim(coalesce(p_details, '')), 800)
    )
    returning * into report_row;

    perform public.create_notification(
        target_user_id,
        'report_received',
        case when p_target_type = 'post' then 'One of your posts was reported.' else 'Your account was reported.' end,
        'Reason: ' || coalesce(nullif(report_row.reason, ''), 'No reason supplied.'),
        report_link,
        'warning',
        jsonb_build_object(
            'report_id', report_row.id,
            'target_type', report_row.target_type,
            'target_user_id', target_user_id,
            'target_post_id', report_row.target_post_id
        )
    );

    for official in
        select p.id
        from public.profiles p
        where public.get_effective_permission_value(p.id, 'manage_reports')
          and not public.is_account_banned(p.id)
    loop
        perform public.create_notification(
            official.id,
            'moderation_report',
            report_title || ' submitted.',
            coalesce(target_profile.display_name, 'Unknown account') || ' was reported for "' || coalesce(nullif(report_row.reason, ''), 'No reason supplied.') || '".',
            '/account#moderation',
            'warning',
            jsonb_build_object(
                'report_id', report_row.id,
                'target_type', report_row.target_type,
                'target_user_id', target_user_id,
                'target_post_id', report_row.target_post_id
            )
        );
    end loop;

    return report_row;
end;
$$;

create or replace function public.get_moderation_reports(
    p_state text default 'open',
    p_limit integer default 50
)
returns table (
    id bigint,
    target_type text,
    target_account_id text,
    target_display_name text,
    target_username text,
    target_role_label text,
    target_restriction_label text,
    reporter_account_id text,
    reporter_display_name text,
    reporter_username text,
    target_post_id uuid,
    target_post_title text,
    reason text,
    details text,
    state text,
    created_at timestamptz,
    resolved_at timestamptz,
    resolution_note text,
    rolling_count_30d bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
    if auth.uid() is null or not public.get_effective_permission_value(auth.uid(), 'manage_reports') then
        raise exception 'You do not have access to the moderation queue.';
    end if;

    return query
    select
        ar.id,
        ar.target_type,
        target_profile.account_id,
        target_profile.display_name,
        target_profile.username,
        target_profile.role_label,
        target_profile.public_restriction_label,
        reporter_profile.account_id,
        reporter_profile.display_name,
        reporter_profile.username,
        ar.target_post_id,
        coalesce(cp.title, '') as target_post_title,
        ar.reason,
        ar.details,
        ar.state,
        ar.created_at,
        ar.resolved_at,
        ar.resolution_note,
        (
            select count(*)
            from public.account_reports recent
            where recent.target_user_id = ar.target_user_id
              and recent.created_at >= timezone('utc', now()) - interval '30 days'
        )::bigint as rolling_count_30d
    from public.account_reports ar
    join public.profile_cards target_profile on target_profile.id = ar.target_user_id
    join public.profile_cards reporter_profile on reporter_profile.id = ar.reporter_id
    left join public.content_posts cp on cp.id = ar.target_post_id
    where (p_state is null or ar.state = p_state)
    order by ar.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.resolve_report(
    p_report_id bigint,
    p_state text,
    p_note text default ''
)
returns public.account_reports
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    report_row public.account_reports;
begin
    actor_id := auth.uid();

    if actor_id is null or not public.get_effective_permission_value(actor_id, 'manage_reports') then
        raise exception 'You do not have permission to resolve reports.';
    end if;

    if p_state not in ('reviewed', 'dismissed', 'actioned') then
        raise exception 'Invalid report state.';
    end if;

    update public.account_reports
    set state = p_state,
        resolved_at = timezone('utc', now()),
        resolved_by = actor_id,
        resolution_note = left(coalesce(p_note, ''), 400)
    where id = p_report_id
    returning * into report_row;

    if report_row.id is null then
        raise exception 'Report not found.';
    end if;

    return report_row;
end;
$$;

create or replace function public.issue_account_warning(
    p_account_id text,
    p_reason text
)
returns public.account_warnings
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    target_profile public.profiles;
    warning_row public.account_warnings;
    actor_profile public.profiles;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to issue warnings.';
    end if;

    select * into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if not public.actor_can_moderate_target(actor_id, target_profile.id, 'warning') then
        raise exception 'You do not have permission to warn that account.';
    end if;

    insert into public.account_warnings (
        target_user_id,
        actor_id,
        reason
    )
    values (
        target_profile.id,
        actor_id,
        left(trim(coalesce(p_reason, '')), 400)
    )
    returning * into warning_row;

    select * into actor_profile
    from public.profiles
    where id = actor_id;

    perform public.create_notification(
        target_profile.id,
        'warning',
        'A formal warning was added to your account.',
        coalesce(actor_profile.display_name, 'A Hollowside official') || ' issued a warning: ' || coalesce(nullif(warning_row.reason, ''), 'No reason supplied.'),
        '/account#notifications',
        'warning',
        jsonb_build_object(
            'warning_id', warning_row.id,
            'actor_id', actor_id,
            'target_user_id', target_profile.id
        )
    );

    return warning_row;
end;
$$;

create or replace function public.set_account_sanction(
    p_account_id text,
    p_sanction_type text,
    p_reason text default '',
    p_expires_at timestamptz default null
)
returns public.account_sanctions
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    target_profile public.profiles;
    sanction_row public.account_sanctions;
    actor_profile public.profiles;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to apply sanctions.';
    end if;

    select * into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if p_sanction_type = 'suspension' then
        if not public.actor_can_moderate_target(actor_id, target_profile.id, 'suspend') then
            raise exception 'You do not have permission to suspend that account.';
        end if;

        if p_expires_at is null or p_expires_at <= timezone('utc', now()) then
            raise exception 'Suspensions need an end date in the future.';
        end if;
    elsif p_sanction_type = 'ban' then
        if not public.actor_can_moderate_target(actor_id, target_profile.id, 'ban') then
            raise exception 'You do not have permission to ban that account.';
        end if;
    else
        raise exception 'Unsupported sanction type.';
    end if;

    update public.account_sanctions
    set lifted_at = timezone('utc', now()),
        lifted_by = actor_id,
        lift_note = 'Superseded by a newer sanction.'
    where target_user_id = target_profile.id
      and sanction_type = p_sanction_type
      and lifted_at is null
      and (expires_at is null or expires_at > timezone('utc', now()));

    insert into public.account_sanctions (
        target_user_id,
        actor_id,
        sanction_type,
        reason,
        expires_at
    )
    values (
        target_profile.id,
        actor_id,
        p_sanction_type,
        left(coalesce(p_reason, ''), 400),
        p_expires_at
    )
    returning * into sanction_row;

    select * into actor_profile
    from public.profiles
    where id = actor_id;

    perform public.create_notification(
        target_profile.id,
        case when p_sanction_type = 'ban' then 'ban' else 'suspension' end,
        case when p_sanction_type = 'ban' then 'Your account was banned from community access.' else 'Your account was suspended.' end,
        coalesce(actor_profile.display_name, 'A Hollowside official') || ' added a ' || p_sanction_type || '. ' || coalesce(nullif(sanction_row.reason, ''), 'No reason supplied.'),
        '/account#notifications',
        'warning',
        jsonb_build_object(
            'sanction_id', sanction_row.id,
            'sanction_type', sanction_row.sanction_type,
            'target_user_id', target_profile.id
        )
    );

    return sanction_row;
end;
$$;

create or replace function public.clear_account_sanction(
    p_account_id text,
    p_sanction_type text,
    p_note text default ''
)
returns public.account_sanctions
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_id uuid;
    target_profile public.profiles;
    sanction_row public.account_sanctions;
    actor_profile public.profiles;
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to lift sanctions.';
    end if;

    select * into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if p_sanction_type = 'suspension' then
        if not public.actor_can_moderate_target(actor_id, target_profile.id, 'suspend') then
            raise exception 'You do not have permission to lift that suspension.';
        end if;
    elsif p_sanction_type = 'ban' then
        if not public.actor_can_moderate_target(actor_id, target_profile.id, 'ban') then
            raise exception 'You do not have permission to lift that ban.';
        end if;
    else
        raise exception 'Unsupported sanction type.';
    end if;

    update public.account_sanctions
    set lifted_at = timezone('utc', now()),
        lifted_by = actor_id,
        lift_note = left(coalesce(p_note, ''), 400)
    where id = (
        select s.id
        from public.account_sanctions s
        where s.target_user_id = target_profile.id
          and s.sanction_type = p_sanction_type
          and s.lifted_at is null
          and (s.expires_at is null or s.expires_at > timezone('utc', now()))
        order by s.created_at desc
        limit 1
    )
    returning * into sanction_row;

    if sanction_row.id is null then
        raise exception 'No active % found for that account.', p_sanction_type;
    end if;

    select * into actor_profile
    from public.profiles
    where id = actor_id;

    perform public.create_notification(
        target_profile.id,
        'sanction_cleared',
        'A moderation restriction on your account was lifted.',
        coalesce(actor_profile.display_name, 'A Hollowside official') || ' lifted your ' || p_sanction_type || '.',
        '/account#notifications',
        'success',
        jsonb_build_object(
            'sanction_id', sanction_row.id,
            'sanction_type', sanction_row.sanction_type,
            'target_user_id', target_profile.id
        )
    );

    return sanction_row;
end;
$$;

create or replace function public.get_active_sanctions(p_limit integer default 40)
returns table (
    id bigint,
    sanction_type text,
    target_account_id text,
    target_display_name text,
    target_username text,
    actor_display_name text,
    reason text,
    created_at timestamptz,
    expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
    if auth.uid() is null or not (
        public.get_effective_permission_value(auth.uid(), 'suspend_accounts')
        or public.get_effective_permission_value(auth.uid(), 'ban_accounts')
        or public.get_effective_permission_value(auth.uid(), 'manage_reports')
    ) then
        raise exception 'You do not have access to moderation sanctions.';
    end if;

    return query
    select
        s.id,
        s.sanction_type,
        target_profile.account_id,
        target_profile.display_name,
        target_profile.username,
        actor_profile.display_name,
        s.reason,
        s.created_at,
        s.expires_at
    from public.account_sanctions s
    join public.profile_cards target_profile on target_profile.id = s.target_user_id
    join public.profile_cards actor_profile on actor_profile.id = s.actor_id
    where s.lifted_at is null
      and (s.expires_at is null or s.expires_at > timezone('utc', now()))
    order by s.created_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 100));
end;
$$;

create or replace function public.get_my_notifications(p_limit integer default 60)
returns table (
    id bigint,
    kind text,
    title text,
    body text,
    link_url text,
    is_read boolean,
    created_at timestamptz,
    severity text,
    rolling_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
    select
        n.id,
        n.kind,
        n.title,
        n.body,
        n.link_url,
        n.is_read,
        n.created_at,
        n.severity,
        case
            when n.kind = 'warning' then (
                select count(*)
                from public.account_warnings aw
                where aw.target_user_id = auth.uid()
                  and aw.created_at >= timezone('utc', now()) - interval '30 days'
            )::bigint
            when n.kind = 'report_received' then (
                select count(*)
                from public.account_reports ar
                where ar.target_user_id = auth.uid()
                  and ar.created_at >= timezone('utc', now()) - interval '30 days'
            )::bigint
            when n.kind = 'moderation_report' then (
                select count(*)
                from public.account_reports ar
                where ar.state = 'open'
                  and ar.created_at >= timezone('utc', now()) - interval '30 days'
            )::bigint
            else null
        end as rolling_count
    from public.notifications n
    where n.user_id = auth.uid()
    order by n.created_at desc
    limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

create or replace function public.mark_notification_read(p_notification_id bigint)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
    notification_row public.notifications;
begin
    update public.notifications
    set is_read = true
    where id = p_notification_id
      and user_id = auth.uid()
    returning * into notification_row;

    return notification_row;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.notifications
    set is_read = true
    where user_id = auth.uid()
      and is_read = false;
end;
$$;
