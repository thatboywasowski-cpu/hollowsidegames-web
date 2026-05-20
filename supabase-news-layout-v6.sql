alter table if exists public.content_posts
    add column if not exists subtitle text not null default '';

update public.content_posts
set subtitle = coalesce(subtitle, '');

drop function if exists public.get_post_detail(uuid);
drop function if exists public.get_post_feed(text, text, integer);
drop function if exists public.create_content_post(text, text, text, text);
drop view if exists public.content_post_cards;

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

create view public.content_post_cards as
select
    cp.id,
    cp.post_type,
    cp.subtitle,
    cp.title,
    cp.body,
    cp.summary,
    cp.author_id,
    pc.account_id as author_account_id,
    pc.display_name as author_display_name,
    pc.username as author_username,
    pc.avatar_url as author_avatar_url,
    pc.role_label as author_role_label,
    pc.is_verified as author_is_verified,
    pc.verification_mode as author_verification_mode,
    cp.created_at,
    cp.updated_at,
    coalesce(likes.count_value, 0)::bigint as like_count,
    coalesce(dislikes.count_value, 0)::bigint as dislike_count,
    coalesce(comments.count_value, 0)::bigint as comment_count
from public.content_posts cp
join public.profile_cards pc on pc.id = cp.author_id
left join lateral (
    select count(*) as count_value
    from public.content_post_reactions cpr
    where cpr.post_id = cp.id
      and cpr.reaction_type = 'like'
) likes on true
left join lateral (
    select count(*) as count_value
    from public.content_post_reactions cpr
    where cpr.post_id = cp.id
      and cpr.reaction_type = 'dislike'
) dislikes on true
left join lateral (
    select count(*) as count_value
    from public.content_post_comments cpc
    where cpc.post_id = cp.id
) comments on true
where cp.published = true;

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
begin
    viewer_id := auth.uid();

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
    order by cpc.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

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
begin
    viewer_id := auth.uid();

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
    limit 1;
end;
$$;
