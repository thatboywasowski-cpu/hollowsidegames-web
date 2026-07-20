-- OAuth profile onboarding and first username change v20.
-- Run after v19. Automatic profile creation no longer consumes the first
-- intentional username change, and untouched existing accounts are repaired.

update public.profiles
set username_change_available_at = timezone('utc', now())
where username_change_available_at > timezone('utc', now())
  and abs(extract(epoch from (username_changed_at - created_at))) <= 10;

create or replace function public.profile_sync_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
        new.username_change_available_at := timezone('utc', now());
        new.last_active_at := coalesce(new.last_active_at, timezone('utc', now()));
    elsif new.username is distinct from old.username then
        if old.username_change_available_at > timezone('utc', now()) then
            raise exception 'Usernames can only be changed once every 14 days.';
        end if;

        new.username_changed_at := timezone('utc', now());
        new.username_change_available_at := timezone('utc', now()) + interval '14 days';
    else
        new.username_changed_at := old.username_changed_at;
        new.username_change_available_at := old.username_change_available_at;
    end if;

    new.is_trusted := coalesce(new.trusted_2fa_enabled, false);
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
begin
    base_username := lower(
        regexp_replace(
            coalesce(
                nullif(new.raw_user_meta_data ->> 'username', ''),
                nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
                nullif(new.raw_user_meta_data ->> 'user_name', ''),
                nullif(new.raw_user_meta_data ->> 'full_name', ''),
                nullif(new.raw_user_meta_data ->> 'name', ''),
                split_part(new.email, '@', 1),
                'member'
            ),
            '[^a-zA-Z0-9_]',
            '',
            'g'
        )
    );

    base_username := left(base_username, 20);

    if char_length(base_username) < 3 then
        base_username := 'member';
    end if;

    final_username := base_username;

    if exists (select 1 from public.profiles where username = final_username and id <> new.id) then
        suffix := right(replace(new.id::text, '-', ''), 4);
        final_username := left(base_username, greatest(3, 20 - char_length(suffix) - 1)) || '_' || suffix;
    end if;

    display_value := coalesce(
        nullif(new.raw_user_meta_data ->> 'display_name', ''),
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(new.raw_user_meta_data ->> 'name', ''),
        nullif(new.raw_user_meta_data ->> 'user_name', ''),
        nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
        nullif(new.raw_user_meta_data ->> 'username', ''),
        case when public.is_virtual_hollowside_email(new.email) then null else split_part(new.email, '@', 1) end,
        'Hollowside Member'
    );

    insert into public.profiles (
        id,
        username,
        display_name,
        base_role_key,
        is_trusted,
        role_label,
        trusted_2fa_enabled,
        trusted_2fa_channel,
        trusted_2fa_contact,
        trusted_2fa_verified_at
    )
    values (
        new.id,
        final_username,
        display_value,
        'member',
        false,
        public.resolve_effective_role_label('member', false),
        false,
        '',
        '',
        null
    )
    on conflict (id) do update
    set role_label = public.resolve_effective_role_label(public.profiles.base_role_key, public.profiles.trusted_2fa_enabled);

    return new;
end;
$$;
