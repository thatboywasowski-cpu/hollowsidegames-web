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

    if target_post.post_type = 'news' then
        if not public.get_effective_permission_value(actor_id, 'publish_news') then
            raise exception 'You do not have permission to delete news posts.';
        end if;
    elsif target_post.post_type = 'profile' then
        if not public.get_effective_permission_value(actor_id, 'publish_personal_posts') then
            raise exception 'You do not have permission to delete profile posts.';
        end if;
    else
        raise exception 'Unsupported post type.';
    end if;

    delete from public.content_posts
    where id = p_post_id;
end;
$$;
