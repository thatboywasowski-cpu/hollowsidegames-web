create extension if not exists pgcrypto;

alter table if exists public.profiles
    add column if not exists last_active_at timestamptz not null default timezone('utc', now()),
    add column if not exists manual_verified boolean not null default false,
    add column if not exists verified_at timestamptz,
    add column if not exists verified_by uuid references public.profiles (id),
    add column if not exists verification_note text not null default '';

insert into public.permission_definitions (permission_key, label, description, category)
values
    ('verify_accounts', 'Verify Accounts', 'Can manually verify accounts below the current role.', 'admin'),
    ('publish_news', 'Able To Publish News', 'Can create and publish official news posts.', 'content'),
    ('publish_personal_posts', 'Publish Personal Posts', 'Can publish posts from a personal account profile.', 'community'),
    ('comment_posts', 'Comment On Posts', 'Can comment on public news and profile posts.', 'community')
on conflict (permission_key) do update
set label = excluded.label,
    description = excluded.description,
    category = excluded.category;

insert into public.role_permissions (role_key, permission_key, allowed)
values
    ('owner', 'verify_accounts', true),
    ('owner', 'publish_news', true),
    ('owner', 'publish_personal_posts', true),
    ('owner', 'comment_posts', true),
    ('co_owner', 'verify_accounts', true),
    ('co_owner', 'publish_news', true),
    ('co_owner', 'publish_personal_posts', true),
    ('co_owner', 'comment_posts', true),
    ('developer', 'publish_news', true),
    ('developer', 'publish_personal_posts', true),
    ('developer', 'comment_posts', true),
    ('head_moderator', 'publish_personal_posts', true),
    ('head_moderator', 'comment_posts', true),
    ('moderator', 'publish_personal_posts', true),
    ('moderator', 'comment_posts', true),
    ('trusted_member', 'publish_personal_posts', true),
    ('trusted_member', 'comment_posts', true),
    ('member', 'publish_personal_posts', true)
on conflict (role_key, permission_key) do update
set allowed = excluded.allowed;

create or replace function public.resolve_is_verified(
    p_manual_verified boolean,
    p_follower_count integer,
    p_member_since timestamptz,
    p_last_active_at timestamptz
)
returns boolean
language sql
stable
as $$
    select coalesce(p_manual_verified, false)
        or (
            coalesce(p_follower_count, 0) >= 100000
            and p_member_since <= timezone('utc', now()) - interval '1 year'
            and coalesce(p_last_active_at, timestamp with time zone 'epoch') >= timezone('utc', now()) - interval '30 days'
        );
$$;

create or replace function public.resolve_verification_mode(
    p_manual_verified boolean,
    p_follower_count integer,
    p_member_since timestamptz,
    p_last_active_at timestamptz
)
returns text
language sql
stable
as $$
    select case
        when coalesce(p_manual_verified, false) then 'manual'
        when (
            coalesce(p_follower_count, 0) >= 100000
            and p_member_since <= timezone('utc', now()) - interval '1 year'
            and coalesce(p_last_active_at, timestamp with time zone 'epoch') >= timezone('utc', now()) - interval '30 days'
        ) then 'automatic'
        else 'none'
    end;
$$;

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

create or replace function public.touch_my_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.profiles
    set last_active_at = timezone('utc', now())
    where id = auth.uid();
end;
$$;

create or replace function public.set_account_verification(
    p_account_id text,
    p_manual_verified boolean,
    p_note text default ''
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_context record;
    target_profile public.profiles;
begin
    select * into actor_context
    from public.get_my_role_context();

    if actor_context.id is null or not public.get_effective_permission_value(actor_context.id, 'verify_accounts') then
        raise exception 'You do not have permission to verify accounts.';
    end if;

    select *
    into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if actor_context.role_rank <= public.get_role_rank(public.resolve_effective_role_key(target_profile.base_role_key, target_profile.is_trusted)) then
        raise exception 'You can only verify accounts below your own role.';
    end if;

    update public.profiles
    set manual_verified = p_manual_verified,
        verified_at = case when p_manual_verified then timezone('utc', now()) else null end,
        verified_by = case when p_manual_verified then actor_context.id else null end,
        verification_note = coalesce(p_note, '')
    where id = target_profile.id
    returning * into target_profile;

    return target_profile;
end;
$$;

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
    ) as verification_mode
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
) friends on true;

drop function if exists public.get_profile_view(text);
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
    limit 1;
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
    else
        delete from public.account_follows
        where follower_id = viewer_id
          and following_id = target_id;
    end if;

    return query
    select
        exists (
            select 1 from public.account_follows
            where follower_id = viewer_id and following_id = target_id
        ) as viewer_is_following,
        exists (
            select 1 from public.account_follows
            where follower_id = target_id and following_id = viewer_id
        ) as viewer_is_followed_by,
        exists (
            select 1 from public.account_follows
            where follower_id = viewer_id and following_id = target_id
        )
        and exists (
            select 1 from public.account_follows
            where follower_id = target_id and following_id = viewer_id
        ) as viewer_is_friend,
        (select count(*)::integer from public.account_follows where following_id = target_id) as follower_count,
        (select count(*)::integer from public.account_follows where follower_id = target_id) as following_count,
        (
            select count(*)::integer
            from public.account_follows af
            where af.follower_id = target_id
              and exists (
                  select 1 from public.account_follows back
                  where back.follower_id = af.following_id
                    and back.following_id = target_id
              )
        ) as friend_count;
end;
$$;

create table if not exists public.content_posts (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null references public.profiles (id) on delete cascade,
    post_type text not null,
    title text not null default '',
    body text not null default '',
    summary text not null default '',
    published boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint content_posts_type_check check (post_type in ('news', 'profile')),
    constraint news_posts_require_title check (
        (post_type = 'news' and char_length(trim(title)) > 0)
        or post_type = 'profile'
    )
);

create table if not exists public.content_post_media (
    id bigint generated always as identity primary key,
    post_id uuid not null references public.content_posts (id) on delete cascade,
    media_type text not null,
    media_url text not null,
    media_path text not null default '',
    created_at timestamptz not null default timezone('utc', now()),
    constraint content_post_media_type_check check (media_type in ('image', 'video'))
);

create table if not exists public.content_post_comments (
    id bigint generated always as identity primary key,
    post_id uuid not null references public.content_posts (id) on delete cascade,
    author_id uuid not null references public.profiles (id) on delete cascade,
    parent_id bigint references public.content_post_comments (id) on delete cascade,
    body text not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.content_post_reactions (
    post_id uuid not null references public.content_posts (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    reaction_type text not null,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (post_id, user_id),
    constraint content_post_reactions_type_check check (reaction_type in ('like', 'dislike'))
);

alter table public.content_posts enable row level security;
alter table public.content_post_media enable row level security;
alter table public.content_post_comments enable row level security;
alter table public.content_post_reactions enable row level security;

drop policy if exists "Content posts readable" on public.content_posts;
create policy "Content posts readable"
on public.content_posts
for select
to public
using (published = true);

drop policy if exists "Media readable" on public.content_post_media;
create policy "Media readable"
on public.content_post_media
for select
to public
using (true);

drop policy if exists "Comments readable" on public.content_post_comments;
create policy "Comments readable"
on public.content_post_comments
for select
to public
using (true);

drop policy if exists "Reactions readable" on public.content_post_reactions;
create policy "Reactions readable"
on public.content_post_reactions
for select
to public
using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'post-media',
    'post-media',
    true,
    104857600,
    array[
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/webm',
        'video/quicktime'
    ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Post media readable" on storage.objects;
create policy "Post media readable"
on storage.objects
for select
to public
using (bucket_id = 'post-media');

drop policy if exists "Users can upload their own post media" on storage.objects;
create policy "Users can upload their own post media"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their own post media" on storage.objects;
create policy "Users can update their own post media"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their own post media" on storage.objects;
create policy "Users can delete their own post media"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.create_content_post(
    p_post_type text,
    p_title text,
    p_body text,
    p_summary text default ''
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
        title,
        body,
        summary
    )
    values (
        author_id,
        p_post_type,
        coalesce(p_title, ''),
        coalesce(p_body, ''),
        coalesce(p_summary, '')
    )
    returning * into created_post;

    return created_post;
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
    author_id uuid;
    comment_row public.content_post_comments;
begin
    author_id := auth.uid();

    if author_id is null then
        raise exception 'You must be logged in to comment.';
    end if;

    if not public.get_effective_permission_value(author_id, 'comment_posts') then
        raise exception 'You do not have permission to comment yet.';
    end if;

    insert into public.content_post_comments (
        post_id,
        author_id,
        parent_id,
        body
    )
    values (
        p_post_id,
        author_id,
        p_parent_id,
        trim(coalesce(p_body, ''))
    )
    returning * into comment_row;

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
begin
    actor_id := auth.uid();

    if actor_id is null then
        raise exception 'You must be logged in to react to posts.';
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

create or replace view public.content_post_cards as
select
    cp.id,
    cp.post_type,
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

update public.profiles
set role_label = public.resolve_effective_role_label(base_role_key, is_trusted),
    updated_at = timezone('utc', now());
