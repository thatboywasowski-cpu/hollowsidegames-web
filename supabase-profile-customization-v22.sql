-- Public profile appearance and music customization v22.
-- Run after v21.

begin;

alter table public.profiles
    add column if not exists profile_background_url text not null default '',
    add column if not exists profile_background_path text not null default '',
    add column if not exists profile_background_blur smallint not null default 0,
    add column if not exists profile_music_url text not null default '',
    add column if not exists profile_music_path text not null default '',
    add column if not exists profile_theme text not null default 'black';

alter table public.profiles
    drop constraint if exists profiles_background_blur_range,
    drop constraint if exists profiles_theme_allowed;

alter table public.profiles
    add constraint profiles_background_blur_range
        check (profile_background_blur between 0 and 30),
    add constraint profiles_theme_allowed
        check (profile_theme in ('black', 'red', 'purple', 'white', 'yellow', 'green', 'pink', 'blue', 'cyan'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'profile-customization',
    'profile-customization',
    true,
    52428800,
    array[
        'image/png',
        'image/jpeg',
        'image/webp',
        'audio/mpeg',
        'audio/mp3',
        'audio/ogg',
        'audio/wav',
        'audio/x-wav',
        'audio/mp4',
        'audio/x-m4a',
        'audio/aac',
        'audio/webm',
        'audio/flac',
        'audio/x-flac'
    ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Profile customization assets are public" on storage.objects;
create policy "Profile customization assets are public"
on storage.objects
for select
to public
using (bucket_id = 'profile-customization');

drop policy if exists "Users upload their own profile customization" on storage.objects;
create policy "Users upload their own profile customization"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'profile-customization'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update their own profile customization" on storage.objects;
create policy "Users update their own profile customization"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'profile-customization'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'profile-customization'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete their own profile customization" on storage.objects;
create policy "Users delete their own profile customization"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'profile-customization'
    and (storage.foldername(name))[1] = auth.uid()::text
);

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
    public_restriction_label text,
    restriction_until timestamptz,
    viewer_is_following boolean,
    viewer_is_followed_by boolean,
    viewer_is_friend boolean,
    profile_background_url text,
    profile_background_blur smallint,
    profile_music_url text,
    profile_theme text
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
        ) as viewer_is_friend,
        p.profile_background_url,
        p.profile_background_blur,
        p.profile_music_url,
        p.profile_theme
    from public.profile_cards pc
    join public.profiles p on p.id = pc.id
    where pc.account_id = p_account_id
      and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
    limit 1;
end;
$$;

commit;
