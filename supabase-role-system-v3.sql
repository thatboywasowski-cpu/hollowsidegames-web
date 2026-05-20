create extension if not exists pgcrypto;

create table if not exists public.role_definitions (
    role_key text primary key,
    label text not null,
    rank integer not null unique,
    assignable boolean not null default true
);

insert into public.role_definitions (role_key, label, rank, assignable)
values
    ('owner', 'Owner', 700, true),
    ('co_owner', 'Co-Owner', 600, true),
    ('developer', 'Developer', 500, true),
    ('head_moderator', 'Head Moderator', 400, true),
    ('moderator', 'Moderator', 300, true),
    ('trusted_member', 'Trusted Member', 200, false),
    ('member', 'Member', 100, true)
on conflict (role_key) do update
set label = excluded.label,
    rank = excluded.rank,
    assignable = excluded.assignable;

create table if not exists public.permission_definitions (
    permission_key text primary key,
    label text not null,
    description text not null default '',
    category text not null default 'general'
);

insert into public.permission_definitions (permission_key, label, description, category)
values
    ('manage_roles', 'Manage Roles', 'Can assign roles to accounts below the current role.', 'admin'),
    ('manage_role_permissions', 'Manage Role Permissions', 'Can configure the default permissions for roles below the current role.', 'admin'),
    ('manage_account_permissions', 'Manage Account Permissions', 'Can set per-account permission overrides for accounts below the current role.', 'admin'),
    ('post_news', 'Post News', 'Can create official news posts.', 'content'),
    ('edit_news', 'Edit News', 'Can edit official news posts.', 'content'),
    ('moderate_comments', 'Moderate Comments', 'Can moderate website comments and discussion.', 'moderation'),
    ('comment_news', 'Comment On News', 'Can comment on news posts and related discussion.', 'community'),
    ('access_staff_tools', 'Access Staff Tools', 'Can access internal staff-facing tools.', 'staff')
on conflict (permission_key) do update
set label = excluded.label,
    description = excluded.description,
    category = excluded.category;

create table if not exists public.role_permissions (
    role_key text not null references public.role_definitions (role_key) on delete cascade,
    permission_key text not null references public.permission_definitions (permission_key) on delete cascade,
    allowed boolean not null default true,
    primary key (role_key, permission_key)
);

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    account_id text not null unique default ('hsg_' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 10))),
    username text not null unique,
    display_name text not null default 'Hollowside Member',
    bio text not null default '',
    avatar_url text not null default '',
    avatar_path text not null default '',
    website_url text not null default '',
    location text not null default '',
    role_label text not null default 'Member',
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint profiles_username_length check (char_length(username) between 3 and 24),
    constraint profiles_username_format check (username ~ '^[a-z0-9_\.]+$')
);

create table if not exists public.account_permissions (
    user_id uuid not null references public.profiles (id) on delete cascade,
    permission_key text not null references public.permission_definitions (permission_key) on delete cascade,
    allowed boolean not null,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, permission_key)
);

create table if not exists public.account_follows (
    follower_id uuid not null references public.profiles (id) on delete cascade,
    following_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (follower_id, following_id),
    constraint account_follows_no_self_follow check (follower_id <> following_id)
);

create table if not exists public.notifications (
    id bigint generated always as identity primary key,
    user_id uuid not null references public.profiles (id) on delete cascade,
    kind text not null,
    title text not null,
    body text not null default '',
    link_url text not null default '',
    is_read boolean not null default false,
    created_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
    add column if not exists base_role_key text,
    add column if not exists is_trusted boolean not null default false,
    add column if not exists username_changed_at timestamptz,
    add column if not exists username_change_available_at timestamptz;

update public.profiles
set base_role_key = coalesce(base_role_key, 'member');

update public.profiles
set username_changed_at = coalesce(username_changed_at, created_at, timezone('utc', now())),
    username_change_available_at = coalesce(username_change_available_at, coalesce(created_at, timezone('utc', now())) + interval '14 days');

alter table public.profiles
    alter column base_role_key set default 'member',
    alter column base_role_key set not null,
    alter column username_changed_at set default timezone('utc', now()),
    alter column username_changed_at set not null,
    alter column username_change_available_at set default timezone('utc', now()) + interval '14 days',
    alter column username_change_available_at set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'profiles_base_role_key_fkey'
    ) then
        alter table public.profiles
            add constraint profiles_base_role_key_fkey
            foreign key (base_role_key)
            references public.role_definitions (role_key);
    end if;
end $$;

create or replace function public.resolve_effective_role_key(p_base_role_key text, p_is_trusted boolean)
returns text
language sql
immutable
as $$
    select case
        when coalesce(p_base_role_key, 'member') = 'member' and coalesce(p_is_trusted, false) then 'trusted_member'
        else coalesce(p_base_role_key, 'member')
    end;
$$;

create or replace function public.resolve_effective_role_label(p_base_role_key text, p_is_trusted boolean)
returns text
language sql
immutable
as $$
    select case public.resolve_effective_role_key(p_base_role_key, p_is_trusted)
        when 'owner' then 'Owner'
        when 'co_owner' then 'Co-Owner'
        when 'developer' then 'Developer'
        when 'head_moderator' then 'Head Moderator'
        when 'moderator' then 'Moderator'
        when 'trusted_member' then 'Trusted Member'
        else 'Member'
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

drop trigger if exists on_auth_user_profile_sync on auth.users;
create trigger on_auth_user_profile_sync
after insert or update of email_confirmed_at on auth.users
for each row
execute function public.handle_profile_for_auth_user();

insert into public.role_permissions (role_key, permission_key, allowed)
values
    ('owner', 'manage_roles', true),
    ('owner', 'manage_role_permissions', true),
    ('owner', 'manage_account_permissions', true),
    ('owner', 'post_news', true),
    ('owner', 'edit_news', true),
    ('owner', 'moderate_comments', true),
    ('owner', 'comment_news', true),
    ('owner', 'access_staff_tools', true),
    ('co_owner', 'manage_roles', true),
    ('co_owner', 'manage_role_permissions', true),
    ('co_owner', 'manage_account_permissions', true),
    ('co_owner', 'post_news', true),
    ('co_owner', 'edit_news', true),
    ('co_owner', 'moderate_comments', true),
    ('co_owner', 'comment_news', true),
    ('co_owner', 'access_staff_tools', true),
    ('developer', 'post_news', true),
    ('developer', 'edit_news', true),
    ('developer', 'comment_news', true),
    ('developer', 'access_staff_tools', true),
    ('head_moderator', 'moderate_comments', true),
    ('head_moderator', 'comment_news', true),
    ('head_moderator', 'access_staff_tools', true),
    ('moderator', 'moderate_comments', true),
    ('moderator', 'comment_news', true),
    ('trusted_member', 'comment_news', true)
on conflict (role_key, permission_key) do update
set allowed = excluded.allowed;

alter table public.profiles enable row level security;
alter table public.role_definitions enable row level security;
alter table public.permission_definitions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.account_permissions enable row level security;
alter table public.account_follows enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Profiles are public to read" on public.profiles;
create policy "Profiles are public to read"
on public.profiles
for select
to public
using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Role definitions readable" on public.role_definitions;
create policy "Role definitions readable"
on public.role_definitions
for select
to public
using (true);

drop policy if exists "Permission definitions readable" on public.permission_definitions;
create policy "Permission definitions readable"
on public.permission_definitions
for select
to public
using (true);

drop policy if exists "Role permissions readable" on public.role_permissions;
create policy "Role permissions readable"
on public.role_permissions
for select
to public
using (true);

drop policy if exists "Account permission overrides readable by owner" on public.account_permissions;
create policy "Account permission overrides readable by owner"
on public.account_permissions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Account follows are readable" on public.account_follows;
create policy "Account follows are readable"
on public.account_follows
for select
to public
using (true);

drop policy if exists "Users can follow from their own account" on public.account_follows;
create policy "Users can follow from their own account"
on public.account_follows
for insert
to authenticated
with check (auth.uid() = follower_id);

drop policy if exists "Users can unfollow from their own account" on public.account_follows;
create policy "Users can unfollow from their own account"
on public.account_follows
for delete
to authenticated
using (auth.uid() = follower_id);

drop policy if exists "Users read their own notifications" on public.notifications;
create policy "Users read their own notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users update their own notifications" on public.notifications;
create policy "Users update their own notifications"
on public.notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'avatars',
    'avatars',
    true,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are public" on storage.objects;
create policy "Avatar images are public"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.get_role_rank(p_role_key text)
returns integer
language sql
stable
as $$
    select coalesce(
        (select rank from public.role_definitions where role_key = p_role_key),
        0
    );
$$;

create or replace function public.get_effective_permission_value(p_user_id uuid, p_permission_key text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    manual_value boolean;
    effective_role text;
    role_value boolean;
begin
    select ap.allowed
    into manual_value
    from public.account_permissions ap
    where ap.user_id = p_user_id
      and ap.permission_key = p_permission_key;

    if manual_value is not null then
        return manual_value;
    end if;

    select public.resolve_effective_role_key(p.base_role_key, p.is_trusted)
    into effective_role
    from public.profiles p
    where p.id = p_user_id;

    select rp.allowed
    into role_value
    from public.role_permissions rp
    where rp.role_key = effective_role
      and rp.permission_key = p_permission_key;

    return coalesce(role_value, false);
end;
$$;

create or replace function public.get_my_role_context()
returns table (
    id uuid,
    account_id text,
    username text,
    display_name text,
    base_role_key text,
    effective_role_key text,
    effective_role_label text,
    role_rank integer,
    can_manage_roles boolean,
    can_manage_role_permissions boolean,
    can_manage_account_permissions boolean
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
        p.base_role_key,
        public.resolve_effective_role_key(p.base_role_key, p.is_trusted) as effective_role_key,
        public.resolve_effective_role_label(p.base_role_key, p.is_trusted) as effective_role_label,
        public.get_role_rank(public.resolve_effective_role_key(p.base_role_key, p.is_trusted)) as role_rank,
        public.get_effective_permission_value(p.id, 'manage_roles') as can_manage_roles,
        public.get_effective_permission_value(p.id, 'manage_role_permissions') as can_manage_role_permissions,
        public.get_effective_permission_value(p.id, 'manage_account_permissions') as can_manage_account_permissions
    from public.profiles p
    where p.id = auth.uid();
$$;

create or replace function public.actor_can_manage_target(p_actor_id uuid, p_target_id uuid, p_new_role_key text default null)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    actor_rank integer;
    target_rank integer;
    new_role_rank integer;
begin
    if p_actor_id is null or p_target_id is null or p_actor_id = p_target_id then
        return false;
    end if;

    if not public.get_effective_permission_value(p_actor_id, 'manage_roles') then
        return false;
    end if;

    select public.get_role_rank(public.resolve_effective_role_key(base_role_key, is_trusted))
    into actor_rank
    from public.profiles
    where id = p_actor_id;

    select public.get_role_rank(public.resolve_effective_role_key(base_role_key, is_trusted))
    into target_rank
    from public.profiles
    where id = p_target_id;

    if actor_rank is null or target_rank is null or actor_rank <= target_rank then
        return false;
    end if;

    if p_new_role_key is not null then
        select rank
        into new_role_rank
        from public.role_definitions
        where role_key = p_new_role_key
          and assignable = true;

        if new_role_rank is null or actor_rank <= new_role_rank then
            return false;
        end if;
    end if;

    return true;
end;
$$;

create or replace function public.set_account_role(p_account_id text, p_role_key text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    target_profile public.profiles;
begin
    select *
    into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if not public.actor_can_manage_target(auth.uid(), target_profile.id, p_role_key) then
        raise exception 'You do not have permission to assign that role.';
    end if;

    update public.profiles
    set base_role_key = p_role_key
    where id = target_profile.id
    returning * into target_profile;

    return target_profile;
end;
$$;

create or replace function public.set_role_permission(p_role_key text, p_permission_key text, p_allowed boolean)
returns public.role_permissions
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_context record;
    target_rank integer;
    result_row public.role_permissions;
begin
    select *
    into actor_context
    from public.get_my_role_context();

    if actor_context.id is null or not actor_context.can_manage_role_permissions then
        raise exception 'You do not have permission to manage role permissions.';
    end if;

    select rank
    into target_rank
    from public.role_definitions
    where role_key = p_role_key;

    if target_rank is null or actor_context.role_rank <= target_rank then
        raise exception 'You can only configure permissions for roles below your own.';
    end if;

    insert into public.role_permissions (role_key, permission_key, allowed)
    values (p_role_key, p_permission_key, p_allowed)
    on conflict (role_key, permission_key) do update
    set allowed = excluded.allowed
    returning * into result_row;

    return result_row;
end;
$$;

create or replace function public.set_account_permission(p_account_id text, p_permission_key text, p_allowed boolean)
returns public.account_permissions
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_context record;
    target_profile public.profiles;
    result_row public.account_permissions;
begin
    select *
    into actor_context
    from public.get_my_role_context();

    if actor_context.id is null or not actor_context.can_manage_account_permissions then
        raise exception 'You do not have permission to manage account-specific permissions.';
    end if;

    select *
    into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if actor_context.role_rank <= public.get_role_rank(public.resolve_effective_role_key(target_profile.base_role_key, target_profile.is_trusted)) then
        raise exception 'You can only configure accounts below your own role.';
    end if;

    insert into public.account_permissions (user_id, permission_key, allowed)
    values (target_profile.id, p_permission_key, p_allowed)
    on conflict (user_id, permission_key) do update
    set allowed = excluded.allowed,
        updated_at = timezone('utc', now())
    returning * into result_row;

    return result_row;
end;
$$;

create or replace function public.clear_account_permission(p_account_id text, p_permission_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_context record;
    target_profile public.profiles;
begin
    select *
    into actor_context
    from public.get_my_role_context();

    if actor_context.id is null or not actor_context.can_manage_account_permissions then
        raise exception 'You do not have permission to clear account-specific permissions.';
    end if;

    select *
    into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if actor_context.role_rank <= public.get_role_rank(public.resolve_effective_role_key(target_profile.base_role_key, target_profile.is_trusted)) then
        raise exception 'You can only configure accounts below your own role.';
    end if;

    delete from public.account_permissions
    where user_id = target_profile.id
      and permission_key = p_permission_key;
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
    coalesce(friends.count_value, 0)::integer as friend_count
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
begin
    q := lower(trim(coalesce(p_query, '')));

    return query
    select *
    from public.profile_cards pc
    where
        q = ''
        or (
            (p_use_display and lower(pc.display_name) like '%' || q || '%')
            or (p_use_username and lower(pc.username) like '%' || q || '%')
            or (p_use_account_id and lower(pc.account_id) like '%' || q || '%')
        )
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
begin
    select id into target_id
    from public.profiles
    where account_id = p_account_id;

    if target_id is null then
        return;
    end if;

    if p_kind = 'followers' then
        return query
        select pc.*
        from public.account_follows af
        join public.profile_cards pc on pc.id = af.follower_id
        where af.following_id = target_id
        order by pc.member_since desc
        limit greatest(1, least(coalesce(p_limit, 18), 50));
    elsif p_kind = 'following' then
        return query
        select pc.*
        from public.account_follows af
        join public.profile_cards pc on pc.id = af.following_id
        where af.follower_id = target_id
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

create or replace function public.get_account_permission_overrides(p_account_id text)
returns table (
    permission_key text,
    allowed boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    actor_context record;
    target_profile public.profiles;
begin
    select * into actor_context from public.get_my_role_context();

    if actor_context.id is null or not actor_context.can_manage_account_permissions then
        raise exception 'You do not have permission to view account overrides.';
    end if;

    select * into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if actor_context.role_rank <= public.get_role_rank(public.resolve_effective_role_key(target_profile.base_role_key, target_profile.is_trusted)) then
        raise exception 'You can only inspect accounts below your own role.';
    end if;

    return query
    select ap.permission_key, ap.allowed
    from public.account_permissions ap
    where ap.user_id = target_profile.id
    order by ap.permission_key;
end;
$$;

update public.profiles
set role_label = public.resolve_effective_role_label(base_role_key, is_trusted),
    updated_at = timezone('utc', now());

update public.profiles
set base_role_key = 'owner'
where account_id = 'hsg_TU2ENN2DHC';
