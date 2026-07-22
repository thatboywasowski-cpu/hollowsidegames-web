-- Universal activity notifications, unread counts, and profile-view tracking v26.
-- Run after v25.

begin;

create index if not exists notifications_user_created_idx
    on public.notifications (user_id, created_at desc, id desc);

create index if not exists notifications_user_unread_idx
    on public.notifications (user_id, id desc)
    where is_read = false;

create or replace function public.enqueue_activity_notification(
    p_user_id uuid,
    p_kind text,
    p_title text,
    p_body text,
    p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_user_id is null then
        return;
    end if;

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
        coalesce(nullif(trim(p_kind), ''), 'info'),
        coalesce(nullif(trim(p_title), ''), 'Notification'),
        coalesce(p_body, ''),
        coalesce(p_metadata ->> 'primary_action_url', ''),
        'info',
        coalesce(p_metadata, '{}'::jsonb)
    );
end;
$$;

revoke all on function public.enqueue_activity_notification(uuid, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.record_profile_view(p_account_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    viewer_id uuid := auth.uid();
    target_profile public.profiles;
    viewer_profile public.profiles;
    latest_notification public.notifications;
    occurrence_count integer;
begin
    if viewer_id is null then
        return;
    end if;

    select *
    into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null or target_profile.id = viewer_id then
        return;
    end if;

    if public.has_block_relation(viewer_id, target_profile.id) then
        return;
    end if;

    select *
    into viewer_profile
    from public.profiles
    where id = viewer_id;

    if viewer_profile.id is null then
        return;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(target_profile.id::text, 0));

    select *
    into latest_notification
    from public.notifications
    where user_id = target_profile.id
    order by created_at desc, id desc
    limit 1
    for update;

    if latest_notification.id is not null
       and latest_notification.kind = 'profile_view'
       and latest_notification.metadata ->> 'actor_id' = viewer_id::text then
        occurrence_count := greatest(1, coalesce((latest_notification.metadata ->> 'occurrence_count')::integer, 1)) + 1;

        update public.notifications
        set title = viewer_profile.display_name || ' viewed your profile ' || occurrence_count || ' times!',
            body = '',
            link_url = '/profile?id=' || viewer_profile.account_id,
            metadata = latest_notification.metadata || jsonb_build_object(
                'occurrence_count', occurrence_count,
                'actor_display_name', viewer_profile.display_name,
                'actor_account_id', viewer_profile.account_id,
                'primary_action_label', 'View their profile',
                'primary_action_url', '/profile?id=' || viewer_profile.account_id
            ),
            is_read = false,
            created_at = timezone('utc', now())
        where id = latest_notification.id;
    else
        perform public.enqueue_activity_notification(
            target_profile.id,
            'profile_view',
            viewer_profile.display_name || ' viewed your profile!',
            '',
            jsonb_build_object(
                'event_key', 'profile_view:' || viewer_id::text,
                'occurrence_count', 1,
                'actor_id', viewer_id,
                'actor_display_name', viewer_profile.display_name,
                'actor_account_id', viewer_profile.account_id,
                'primary_action_label', 'View their profile',
                'primary_action_url', '/profile?id=' || viewer_profile.account_id
            )
        );
    end if;
end;
$$;

revoke all on function public.record_profile_view(text) from public, anon;
grant execute on function public.record_profile_view(text) to authenticated;

create or replace function public.notify_post_reaction_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target_post public.content_posts;
    actor_profile public.profiles;
    owner_profile public.profiles;
    post_caption text;
    post_url text;
    event_key text;
begin
    if new.reaction_type <> 'like' then
        return new;
    end if;

    if tg_op = 'UPDATE' and old.reaction_type = 'like' then
        return new;
    end if;

    select * into target_post from public.content_posts where id = new.post_id and published = true;
    if target_post.id is null or target_post.author_id = new.user_id then
        return new;
    end if;

    select * into actor_profile from public.profiles where id = new.user_id;
    select * into owner_profile from public.profiles where id = target_post.author_id;
    if actor_profile.id is null or owner_profile.id is null then
        return new;
    end if;

    post_caption := left(trim(regexp_replace(
        coalesce(nullif(target_post.title, ''), nullif(target_post.summary, ''), nullif(target_post.body, ''), 'your post'),
        '[[:space:]]+',
        ' ',
        'g'
    )), 100);
    post_url := case
        when target_post.post_type = 'news' then '/news/post?id=' || target_post.id::text
        else '/profile?id=' || owner_profile.account_id || '&post=' || target_post.id::text
    end;
    event_key := 'post_like:' || new.post_id::text || ':' || new.user_id::text;

    if exists (
        select 1
        from public.notifications n
        where n.user_id = owner_profile.id
          and n.kind = 'post_like'
          and n.is_read = false
          and n.metadata ->> 'event_key' = event_key
    ) then
        return new;
    end if;

    perform public.enqueue_activity_notification(
        owner_profile.id,
        'post_like',
        actor_profile.display_name || ' liked your post: ' || post_caption,
        '',
        jsonb_build_object(
            'event_key', event_key,
            'actor_id', actor_profile.id,
            'actor_display_name', actor_profile.display_name,
            'actor_account_id', actor_profile.account_id,
            'target_post_id', target_post.id,
            'primary_action_label', 'View their profile',
            'primary_action_url', '/profile?id=' || actor_profile.account_id,
            'secondary_action_label', 'View post',
            'secondary_action_url', post_url
        )
    );

    return new;
end;
$$;

drop trigger if exists notify_post_reaction_activity_trigger on public.content_post_reactions;
create trigger notify_post_reaction_activity_trigger
after insert or update of reaction_type on public.content_post_reactions
for each row execute function public.notify_post_reaction_activity();

create or replace function public.notify_post_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target_post public.content_posts;
    actor_profile public.profiles;
    owner_profile public.profiles;
    post_caption text;
    post_url text;
begin
    select * into target_post from public.content_posts where id = new.post_id and published = true;
    if target_post.id is null or target_post.author_id = new.author_id then
        return new;
    end if;

    select * into actor_profile from public.profiles where id = new.author_id;
    select * into owner_profile from public.profiles where id = target_post.author_id;
    if actor_profile.id is null or owner_profile.id is null then
        return new;
    end if;

    post_caption := left(trim(regexp_replace(
        coalesce(nullif(target_post.title, ''), nullif(target_post.summary, ''), nullif(target_post.body, ''), 'your post'),
        '[[:space:]]+',
        ' ',
        'g'
    )), 100);
    post_url := case
        when target_post.post_type = 'news' then '/news/post?id=' || target_post.id::text
        else '/profile?id=' || owner_profile.account_id || '&post=' || target_post.id::text
    end;

    perform public.enqueue_activity_notification(
        owner_profile.id,
        'post_comment',
        actor_profile.display_name || ' commented on your post: ' || post_caption,
        left(trim(regexp_replace(coalesce(new.body, ''), '[[:space:]]+', ' ', 'g')), 180),
        jsonb_build_object(
            'event_key', 'post_comment:' || new.id::text,
            'actor_id', actor_profile.id,
            'actor_display_name', actor_profile.display_name,
            'actor_account_id', actor_profile.account_id,
            'target_post_id', target_post.id,
            'primary_action_label', 'View their profile',
            'primary_action_url', '/profile?id=' || actor_profile.account_id,
            'secondary_action_label', 'View post',
            'secondary_action_url', post_url
        )
    );

    return new;
end;
$$;

drop trigger if exists notify_post_comment_activity_trigger on public.content_post_comments;
create trigger notify_post_comment_activity_trigger
after insert on public.content_post_comments
for each row execute function public.notify_post_comment_activity();

create or replace function public.notify_news_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    editor_id uuid;
    editor_profile public.profiles;
    notification_title text;
    notification_kind text;
begin
    if new.post_type <> 'news' or new.published = false then
        return new;
    end if;

    editor_id := coalesce(auth.uid(), new.author_id);
    select * into editor_profile from public.profiles where id = editor_id;

    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.published = false and new.published = true) then
        notification_kind := 'news_posted';
        notification_title := 'The latest news briefing was posted!';
    else
        notification_kind := 'news_edited';
        notification_title := 'A news article was edited by ' || coalesce(editor_profile.display_name, 'Hollowside staff') || '!';
    end if;

    insert into public.notifications (user_id, kind, title, body, link_url, severity, metadata)
    select
        profile.id,
        notification_kind,
        notification_title,
        left(coalesce(nullif(new.title, ''), nullif(new.summary, ''), 'Official Hollowside news'), 180),
        '/news/post?id=' || new.id::text,
        'info',
        jsonb_build_object(
            'event_key', notification_kind || ':' || new.id::text || ':' || extract(epoch from timezone('utc', now()))::bigint::text,
            'actor_id', editor_id,
            'actor_display_name', coalesce(editor_profile.display_name, 'Hollowside staff'),
            'target_post_id', new.id,
            'primary_action_label', 'Take me there',
            'primary_action_url', '/news/post?id=' || new.id::text
        )
    from public.profiles profile
    where profile.id <> editor_id;

    return new;
end;
$$;

drop trigger if exists notify_news_posted_activity_trigger on public.content_posts;
create trigger notify_news_posted_activity_trigger
after insert on public.content_posts
for each row
when (new.post_type = 'news' and new.published = true)
execute function public.notify_news_activity();

drop trigger if exists notify_news_edited_activity_trigger on public.content_posts;
create trigger notify_news_edited_activity_trigger
after update of title, body, summary, subtitle, published on public.content_posts
for each row
when (
    new.post_type = 'news'
    and new.published = true
    and (
        old.title is distinct from new.title
        or old.body is distinct from new.body
        or old.summary is distinct from new.summary
        or old.subtitle is distinct from new.subtitle
        or old.published is distinct from new.published
    )
)
execute function public.notify_news_activity();

create or replace function public.set_account_role(p_account_id text, p_role_key text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    target_profile public.profiles;
    old_effective_role_key text;
    new_effective_role_key text;
    new_role_label text;
begin
    select *
    into target_profile
    from public.profiles
    where account_id = p_account_id
    for update;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if not public.actor_can_manage_target(auth.uid(), target_profile.id, p_role_key) then
        raise exception 'You do not have permission to assign that role.';
    end if;

    old_effective_role_key := case
        when target_profile.base_role_key = 'member' and (
            target_profile.trusted_2fa_enabled
            or exists (select 1 from public.account_trust_overrides ato where ato.user_id = target_profile.id)
        ) then 'trusted_member'
        else target_profile.base_role_key
    end;

    if p_role_key = 'trusted_member' then
        insert into public.account_trust_overrides (user_id, assigned_by)
        values (target_profile.id, auth.uid())
        on conflict (user_id) do update
        set assigned_by = excluded.assigned_by,
            updated_at = timezone('utc', now());

        update public.profiles
        set base_role_key = 'member'
        where id = target_profile.id
        returning * into target_profile;
    else
        delete from public.account_trust_overrides
        where user_id = target_profile.id;

        update public.profiles
        set base_role_key = p_role_key
        where id = target_profile.id
        returning * into target_profile;
    end if;

    new_effective_role_key := case
        when target_profile.base_role_key = 'member' and (
            target_profile.trusted_2fa_enabled
            or exists (select 1 from public.account_trust_overrides ato where ato.user_id = target_profile.id)
        ) then 'trusted_member'
        else target_profile.base_role_key
    end;

    if old_effective_role_key is distinct from new_effective_role_key then
        select label into new_role_label from public.role_definitions where role_key = new_effective_role_key;
        perform public.enqueue_activity_notification(
            target_profile.id,
            'role_updated',
            'Your website role has been updated to: ' || coalesce(new_role_label, target_profile.role_label),
            '',
            jsonb_build_object(
                'event_key', 'role_updated:' || extract(epoch from timezone('utc', now()))::bigint::text,
                'old_role_key', old_effective_role_key,
                'new_role_key', new_effective_role_key
            )
        );
    end if;

    return target_profile;
end;
$$;

drop function if exists public.get_my_notifications(integer);
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
    rolling_count bigint,
    metadata jsonb
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
                select count(*) from public.account_warnings aw
                where aw.target_user_id = auth.uid()
                  and aw.created_at >= timezone('utc', now()) - interval '30 days'
            )::bigint
            when n.kind = 'report_received' then (
                select count(*) from public.account_reports ar
                where ar.target_user_id = auth.uid()
                  and ar.created_at >= timezone('utc', now()) - interval '30 days'
            )::bigint
            when n.kind = 'moderation_report' then (
                select count(*) from public.account_reports ar
                where ar.state = 'open'
                  and ar.created_at >= timezone('utc', now()) - interval '30 days'
            )::bigint
            else null
        end as rolling_count,
        n.metadata
    from public.notifications n
    where n.user_id = auth.uid()
    order by n.created_at desc, n.id desc
    limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

create or replace function public.get_unread_notification_count()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
    select count(*)::bigint
    from public.notifications
    where user_id = auth.uid()
      and is_read = false;
$$;

revoke all on function public.get_unread_notification_count() from public, anon;
grant execute on function public.get_unread_notification_count() to authenticated;

notify pgrst, 'reload schema';

commit;
