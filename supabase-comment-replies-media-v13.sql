-- Comment replies, reactions, and image attachments v13
-- Run after v12. This keeps existing comments, adds like/dislike support
-- for comments, and lets comments carry image attachments.

create table if not exists public.content_comment_reactions (
    comment_id bigint not null references public.content_post_comments (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    reaction_type text not null,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (comment_id, user_id),
    constraint content_comment_reactions_type_check check (reaction_type in ('like', 'dislike'))
);

create table if not exists public.content_comment_media (
    id bigint generated always as identity primary key,
    comment_id bigint not null references public.content_post_comments (id) on delete cascade,
    media_type text not null,
    media_url text not null,
    media_path text not null default '',
    sort_order integer not null default 0,
    created_at timestamptz not null default timezone('utc', now()),
    constraint content_comment_media_type_check check (media_type in ('image'))
);

alter table public.content_comment_reactions enable row level security;
alter table public.content_comment_media enable row level security;

drop policy if exists "Comment reactions readable" on public.content_comment_reactions;
create policy "Comment reactions readable"
on public.content_comment_reactions
for select
to public
using (true);

drop policy if exists "Comment media readable" on public.content_comment_media;
create policy "Comment media readable"
on public.content_comment_media
for select
to public
using (true);

drop function if exists public.get_post_comments(uuid, integer);
drop view if exists public.content_comment_cards;
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
    pc.verification_mode as author_verification_mode,
    coalesce(likes.count_value, 0)::bigint as like_count,
    coalesce(dislikes.count_value, 0)::bigint as dislike_count,
    coalesce(media.media_urls, '[]'::jsonb) as media_urls
from public.content_post_comments cpc
join public.profile_cards pc on pc.id = cpc.author_id
left join lateral (
    select count(*)::bigint as count_value
    from public.content_comment_reactions ccr
    where ccr.comment_id = cpc.id
      and ccr.reaction_type = 'like'
) likes on true
left join lateral (
    select count(*)::bigint as count_value
    from public.content_comment_reactions ccr
    where ccr.comment_id = cpc.id
      and ccr.reaction_type = 'dislike'
) dislikes on true
left join lateral (
    select jsonb_agg(ccm.media_url order by ccm.sort_order asc, ccm.id asc) as media_urls
    from public.content_comment_media ccm
    where ccm.comment_id = cpc.id
) media on true;

drop function if exists public.create_post_comment(uuid, text, bigint);
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
    v_actor_id uuid;
    v_comment_row public.content_post_comments;
    v_post_author_id uuid;
    v_parent_post_id uuid;
begin
    v_actor_id := auth.uid();

    if v_actor_id is null then
        raise exception 'You must be logged in to comment.';
    end if;

    if public.is_account_banned(v_actor_id) then
        raise exception 'Banned accounts cannot comment.';
    end if;

    if public.is_account_suspended(v_actor_id) then
        raise exception 'Suspended accounts can react, but they cannot comment until the suspension ends.';
    end if;

    if not public.get_effective_permission_value(v_actor_id, 'comment_posts') then
        raise exception 'You do not have permission to comment yet.';
    end if;

    select cp.author_id
    into v_post_author_id
    from public.content_posts cp
    where cp.id = p_post_id
      and cp.published = true;

    if v_post_author_id is null then
        raise exception 'Target post not found.';
    end if;

    if p_parent_id is not null then
        select parent_comment.post_id
        into v_parent_post_id
        from public.content_post_comments parent_comment
        where parent_comment.id = p_parent_id;

        if v_parent_post_id is null or v_parent_post_id <> p_post_id then
            raise exception 'Target comment not found.';
        end if;
    end if;

    if public.has_block_relation(v_actor_id, v_post_author_id) then
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
        v_actor_id,
        p_parent_id,
        trim(coalesce(p_body, ''))
    )
    returning * into v_comment_row;

    perform public.touch_my_activity();
    return v_comment_row;
end;
$$;

drop function if exists public.attach_comment_media(bigint, text, text, text, integer);
create or replace function public.attach_comment_media(
    p_comment_id bigint,
    p_media_type text,
    p_media_url text,
    p_media_path text default '',
    p_sort_order integer default 0
)
returns public.content_comment_media
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid;
    v_target_comment public.content_post_comments;
    v_media_row public.content_comment_media;
begin
    v_actor_id := auth.uid();

    if v_actor_id is null then
        raise exception 'You must be logged in to attach comment media.';
    end if;

    select *
    into v_target_comment
    from public.content_post_comments
    where id = p_comment_id;

    if v_target_comment.id is null then
        raise exception 'Target comment not found.';
    end if;

    if v_target_comment.author_id <> v_actor_id then
        raise exception 'You can only attach media to your own comments.';
    end if;

    if p_media_type <> 'image' then
        raise exception 'Comments only support image attachments.';
    end if;

    insert into public.content_comment_media (comment_id, media_type, media_url, media_path, sort_order)
    values (p_comment_id, p_media_type, trim(coalesce(p_media_url, '')), coalesce(p_media_path, ''), coalesce(p_sort_order, 0))
    returning * into v_media_row;

    return v_media_row;
end;
$$;

drop function if exists public.set_comment_reaction(bigint, text);
create or replace function public.set_comment_reaction(
    p_comment_id bigint,
    p_reaction_type text
)
returns public.content_comment_reactions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid;
    v_reaction_row public.content_comment_reactions;
begin
    v_actor_id := auth.uid();

    if v_actor_id is null then
        raise exception 'You must be logged in to react to comments.';
    end if;

    if p_reaction_type not in ('like', 'dislike') then
        raise exception 'Unsupported reaction type.';
    end if;

    insert into public.content_comment_reactions (
        comment_id,
        user_id,
        reaction_type
    )
    values (
        p_comment_id,
        v_actor_id,
        p_reaction_type
    )
    on conflict (comment_id, user_id) do update
    set reaction_type = excluded.reaction_type,
        created_at = timezone('utc', now())
    returning * into v_reaction_row;

    perform public.touch_my_activity();
    return v_reaction_row;
end;
$$;

drop function if exists public.clear_comment_reaction(bigint);
create or replace function public.clear_comment_reaction(p_comment_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.content_comment_reactions
    where comment_id = p_comment_id
      and user_id = auth.uid();

    perform public.touch_my_activity();
end;
$$;

drop function if exists public.get_post_comments(uuid, integer);
create or replace function public.get_post_comments(p_post_id uuid, p_limit integer default 60)
returns table (
    id bigint,
    post_id uuid,
    author_id uuid,
    parent_id bigint,
    body text,
    created_at timestamptz,
    updated_at timestamptz,
    author_account_id text,
    author_display_name text,
    author_username text,
    author_avatar_url text,
    author_role_label text,
    author_is_verified boolean,
    author_verification_mode text,
    like_count bigint,
    dislike_count bigint,
    viewer_reaction text,
    media_urls jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    v_viewer_id uuid;
begin
    v_viewer_id := auth.uid();

    return query
    select
        ccc.id,
        ccc.post_id,
        ccc.author_id,
        ccc.parent_id,
        ccc.body,
        ccc.created_at,
        ccc.updated_at,
        ccc.author_account_id,
        ccc.author_display_name,
        ccc.author_username,
        ccc.author_avatar_url,
        ccc.author_role_label,
        ccc.author_is_verified,
        ccc.author_verification_mode,
        ccc.like_count,
        ccc.dislike_count,
        (
            select ccr.reaction_type
            from public.content_comment_reactions ccr
            where ccr.comment_id = ccc.id
              and ccr.user_id = v_viewer_id
            limit 1
        ) as viewer_reaction,
        ccc.media_urls
    from public.content_comment_cards ccc
    where ccc.post_id = p_post_id
    order by ccc.created_at asc
    limit greatest(1, least(coalesce(p_limit, 60), 200));
end;
$$;
