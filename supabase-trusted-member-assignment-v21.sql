-- Staff-managed Trusted Member assignments v21.
-- Run after v20. Manual trust is stored separately from verified 2FA so role
-- assignment cannot enable or interfere with the account's login challenge.

begin;

create table if not exists public.account_trust_overrides (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    assigned_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.account_trust_overrides enable row level security;

revoke all on table public.account_trust_overrides from anon, authenticated;

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
    else
        -- A member may edit their profile row, but role changes must go through
        -- the hierarchy-checked set_account_role RPC.
        if auth.uid() = old.id then
            new.base_role_key := old.base_role_key;
        end if;

        if new.username is distinct from old.username then
            if old.username_change_available_at > timezone('utc', now()) then
                raise exception 'Usernames can only be changed once every 14 days.';
            end if;

            new.username_changed_at := timezone('utc', now());
            new.username_change_available_at := timezone('utc', now()) + interval '14 days';
        else
            new.username_changed_at := old.username_changed_at;
            new.username_change_available_at := old.username_change_available_at;
        end if;
    end if;

    new.is_trusted := coalesce(new.trusted_2fa_enabled, false)
        or exists (
            select 1
            from public.account_trust_overrides ato
            where ato.user_id = new.id
        );
    new.role_label := public.resolve_effective_role_label(new.base_role_key, new.is_trusted);
    new.updated_at := timezone('utc', now());
    return new;
end;
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
          and (assignable = true or role_key = 'trusted_member');

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
    where account_id = p_account_id
    for update;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if not public.actor_can_manage_target(auth.uid(), target_profile.id, p_role_key) then
        raise exception 'You do not have permission to assign that role.';
    end if;

    if p_role_key = 'trusted_member' then
        insert into public.account_trust_overrides (user_id, assigned_by)
        values (target_profile.id, auth.uid())
        on conflict (user_id) do update
        set assigned_by = excluded.assigned_by,
            updated_at = timezone('utc', now());

        update public.profiles
        set base_role_key = 'member'
        where id = target_profile.id
        returning * into target_profile;
    else
        delete from public.account_trust_overrides
        where user_id = target_profile.id;

        update public.profiles
        set base_role_key = p_role_key
        where id = target_profile.id
        returning * into target_profile;
    end if;

    return target_profile;
end;
$$;

comment on table public.account_trust_overrides is
    'Manual Trusted Member assignments. This is separate from verified login 2FA.';

commit;
