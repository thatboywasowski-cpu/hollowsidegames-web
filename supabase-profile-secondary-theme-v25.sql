-- Optional secondary colors for profile and website themes v25.
-- Run after v24.

begin;

alter table public.profiles
    add column if not exists profile_theme_secondary text not null default '';

alter table public.profiles
    drop constraint if exists profiles_secondary_theme_allowed;

alter table public.profiles
    add constraint profiles_secondary_theme_allowed
        check (
            profile_theme_secondary = ''
            or profile_theme_secondary in (
                'black', 'red', 'purple', 'white', 'yellow', 'green', 'pink', 'blue', 'cyan',
                'orange', 'lime', 'teal', 'indigo', 'violet', 'magenta', 'rose', 'coral',
                'maroon', 'navy', 'sky-blue', 'mint', 'lavender', 'peach', 'gold', 'silver',
                'gray', 'brown', 'crimson', 'emerald', 'electric-blue', 'neon-green',
                'hot-pink', 'amber', 'midnight', 'ice'
            )
            or profile_theme_secondary ~ '^custom-[0-9a-f]{6}$'
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
    profile_theme text,
    profile_theme_secondary text
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
        p.profile_theme,
        p.profile_theme_secondary
    from public.profile_cards pc
    join public.profiles p on p.id = pc.id
    where pc.account_id = p_account_id
      and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
    limit 1;
end;
$$;

notify pgrst, 'reload schema';

commit;
