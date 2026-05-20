-- Hollowside website fixes v9
-- Run this after the v8 moderation script. It tightens username rules and fixes
-- ambiguous post author references that can break comments/reactions.

alter table if exists public.profiles
    drop constraint if exists profiles_username_length,
    drop constraint if exists profiles_username_format,
    add constraint profiles_username_length check (char_length(username) between 3 and 20) not valid,
    add constraint profiles_username_format check (
        username ~ '^[a-z0-9_]+$'
        and username !~ '^[0-9]+$'
        and (char_length(username) - char_length(replace(username, '_', ''))) <= 1
    ) not valid;

create or replace function public.profile_sync_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    auth_confirmed boolean;
begin
    new.username := lower(trim(coalesce(new.username, '')));

    if new.username ~ '\s' then
        raise exception 'Usernames cannot contain spaces.';
    end if;

    if new.username !~ '^[a-z0-9_]+$' then
        raise exception 'Usernames can only use lowercase letters, numbers, and one underscore.';
    end if;

    if (char_length(new.username) - char_length(replace(new.username, '_', ''))) > 1 then
        raise exception 'Usernames can only contain one underscore.';
    end if;

    if char_length(new.username) < 3 or char_length(new.username) > 20 then
        raise exception 'Usernames must be between 3 and 20 characters.';
    end if;

    if new.username ~ '^[0-9]+$' then
        raise exception 'Usernames cannot be all numbers.';
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
    trusted_value boolean;
begin
    trusted_value := new.email_confirmed_at is not null;

    base_username := lower(
        regexp_replace(
            coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'member'),
            '[^a-zA-Z0-9_]',
            '',
            'g'
        )
    );

    base_username := left(base_username, 20);

    if base_username ~ '^[0-9]+$' or char_length(base_username) < 3 then
        base_username := 'member';
    end if;

    if (char_length(base_username) - char_length(replace(base_username, '_', ''))) > 1 then
        base_username := replace(base_username, '_', '');
    end if;

    final_username := base_username;

    if exists (select 1 from public.profiles p where p.username = final_username and p.id <> new.id) then
        suffix := right(replace(new.id::text, '-', ''), 4);
        final_username := left(replace(base_username, '_', ''), greatest(3, 20 - char_length(suffix) - 1)) || '_' || suffix;
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
        role_label
    )
    values (
        new.id,
        final_username,
        display_value,
        'member',
        trusted_value,
        public.resolve_effective_role_label('member', trusted_value)
    )
    on conflict (id) do update
    set is_trusted = excluded.is_trusted,
        role_label = public.resolve_effective_role_label(public.profiles.base_role_key, excluded.is_trusted);

    return new;
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
