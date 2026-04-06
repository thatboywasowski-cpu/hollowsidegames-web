create extension if not exists pgcrypto;

create or replace function public.make_account_id()
returns text
language sql
as $$
    select 'hsg_' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 10));
$$;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    account_id text not null unique default public.make_account_id(),
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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user_profile()
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
begin
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

    if exists (select 1 from public.profiles where username = final_username) then
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
        display_name
    )
    values (
        new.id,
        final_username,
        display_value
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

alter table public.profiles enable row level security;

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

create table if not exists public.account_follows (
    follower_id uuid not null references public.profiles (id) on delete cascade,
    following_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (follower_id, following_id),
    constraint account_follows_no_self_follow check (follower_id <> following_id)
);

alter table public.account_follows enable row level security;

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

alter table public.notifications enable row level security;

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
