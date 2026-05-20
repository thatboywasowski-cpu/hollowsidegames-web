-- Moderation delete rules and role-emulation context v14
-- Run after v13. This adds server-side post/comment delete permissions
-- and exposes moderation flags used by the website UI.

drop function if exists public.is_content_moderator(uuid);
create or replace function public.is_content_moderator(p_actor_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce(
        public.resolve_effective_role_key(p.base_role_key, p.is_trusted) in ('owner', 'co_owner', 'head_moderator', 'moderator'),
        false
    )
    from public.profiles p
    where p.id = p_actor_id;
$$;

drop function if exists public.is_news_moderator(uuid);
create or replace function public.is_news_moderator(p_actor_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce(
        public.resolve_effective_role_key(p.base_role_key, p.is_trusted) in ('owner', 'co_owner'),
        false
    )
    from public.profiles p
    where p.id = p_actor_id;
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
    can_moderate_news boolean
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
        (pb.effective_role_key in ('owner', 'co_owner')) as can_moderate_news
    from profile_base pb
    left join lateral public.get_active_sanction(pb.id) s on true;
$$;

drop function if exists public.delete_content_post(uuid);
create or replace function public.delete_content_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid;
    v_target_post public.content_posts;
    v_actor_can_moderate_content boolean;
    v_actor_can_moderate_news boolean;
begin
    v_actor_id := auth.uid();

    if v_actor_id is null then
        raise exception 'You must be logged in to delete posts.';
    end if;

    select *
    into v_target_post
    from public.content_posts
    where id = p_post_id;

    if v_target_post.id is null then
        raise exception 'Target post not found.';
    end if;

    v_actor_can_moderate_content := public.is_content_moderator(v_actor_id);
    v_actor_can_moderate_news := public.is_news_moderator(v_actor_id);

    if v_target_post.post_type = 'news' then
        if v_target_post.author_id <> v_actor_id and not v_actor_can_moderate_news then
            raise exception 'Only Owners and Co-Owners can delete another account''s news posts.';
        end if;

        if v_target_post.author_id = v_actor_id and not public.get_effective_permission_value(v_actor_id, 'publish_news') then
            raise exception 'You do not have permission to delete news posts.';
        end if;
    elsif v_target_post.post_type = 'profile' then
        if v_target_post.author_id <> v_actor_id and not v_actor_can_moderate_content then
            raise exception 'You can only delete your own profile posts.';
        end if;

        if v_target_post.author_id = v_actor_id and not public.get_effective_permission_value(v_actor_id, 'publish_personal_posts') then
            raise exception 'You do not have permission to delete profile posts.';
        end if;
    else
        raise exception 'Unsupported post type.';
    end if;

    delete from public.content_posts
    where id = p_post_id;
end;
$$;

drop function if exists public.delete_post_comment(bigint);
create or replace function public.delete_post_comment(p_comment_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid;
    v_target_comment public.content_post_comments;
    v_post_author_id uuid;
begin
    v_actor_id := auth.uid();

    if v_actor_id is null then
        raise exception 'You must be logged in to delete comments.';
    end if;

    select *
    into v_target_comment
    from public.content_post_comments
    where id = p_comment_id;

    if v_target_comment.id is null then
        raise exception 'Target comment not found.';
    end if;

    select cp.author_id
    into v_post_author_id
    from public.content_posts cp
    where cp.id = v_target_comment.post_id;

    if v_target_comment.author_id <> v_actor_id
       and v_post_author_id <> v_actor_id
       and not public.is_content_moderator(v_actor_id) then
        raise exception 'You can only delete your own comments.';
    end if;

    delete from public.content_post_comments
    where id = p_comment_id;
end;
$$;
