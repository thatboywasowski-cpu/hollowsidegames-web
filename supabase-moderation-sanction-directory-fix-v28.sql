begin;

create or replace function public.issue_account_warning(
    p_account_id text,
    p_reason text
)
returns public.account_warnings
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    target_profile public.profiles;
    warning_row public.account_warnings;
    actor_profile public.profiles;
begin
    if v_actor_id is null then
        raise exception 'You must be logged in to issue warnings.';
    end if;

    select * into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if not public.actor_can_moderate_target(v_actor_id, target_profile.id, 'warning') then
        raise exception 'You do not have permission to warn that account.';
    end if;

    insert into public.account_warnings (
        target_user_id,
        actor_id,
        reason
    )
    values (
        target_profile.id,
        v_actor_id,
        left(trim(coalesce(p_reason, '')), 400)
    )
    returning * into warning_row;

    select * into actor_profile
    from public.profiles
    where id = v_actor_id;

    perform public.create_notification(
        target_profile.id,
        'warning',
        'A formal warning was added to your account.',
        coalesce(actor_profile.display_name, 'A Hollowside official') || ' issued a warning: ' || coalesce(nullif(warning_row.reason, ''), 'No reason supplied.'),
        '/account#notifications',
        'warning',
        jsonb_build_object(
            'warning_id', warning_row.id,
            'actor_id', v_actor_id,
            'target_user_id', target_profile.id
        )
    );

    return warning_row;
end;
$$;

create or replace function public.set_account_sanction(
    p_account_id text,
    p_sanction_type text,
    p_reason text default '',
    p_expires_at timestamptz default null
)
returns public.account_sanctions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    target_profile public.profiles;
    sanction_row public.account_sanctions;
    actor_profile public.profiles;
begin
    if v_actor_id is null then
        raise exception 'You must be logged in to apply sanctions.';
    end if;

    select * into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if p_sanction_type = 'suspension' then
        if not public.actor_can_moderate_target(v_actor_id, target_profile.id, 'suspend') then
            raise exception 'You do not have permission to suspend that account.';
        end if;

        if p_expires_at is null or p_expires_at <= timezone('utc', now()) then
            raise exception 'Suspensions need an end date in the future.';
        end if;
    elsif p_sanction_type = 'ban' then
        if not public.actor_can_moderate_target(v_actor_id, target_profile.id, 'ban') then
            raise exception 'You do not have permission to ban that account.';
        end if;
    else
        raise exception 'Unsupported sanction type.';
    end if;

    update public.account_sanctions
    set lifted_at = timezone('utc', now()),
        lifted_by = v_actor_id,
        lift_note = 'Superseded by a newer sanction.'
    where target_user_id = target_profile.id
      and sanction_type = p_sanction_type
      and lifted_at is null
      and (expires_at is null or expires_at > timezone('utc', now()));

    insert into public.account_sanctions (
        target_user_id,
        actor_id,
        sanction_type,
        reason,
        expires_at
    )
    values (
        target_profile.id,
        v_actor_id,
        p_sanction_type,
        left(coalesce(p_reason, ''), 400),
        p_expires_at
    )
    returning * into sanction_row;

    select * into actor_profile
    from public.profiles
    where id = v_actor_id;

    perform public.create_notification(
        target_profile.id,
        case when p_sanction_type = 'ban' then 'ban' else 'suspension' end,
        case when p_sanction_type = 'ban' then 'Your account was banned from community access.' else 'Your account was suspended.' end,
        coalesce(actor_profile.display_name, 'A Hollowside official') || ' added a ' || p_sanction_type || '. ' || coalesce(nullif(sanction_row.reason, ''), 'No reason supplied.'),
        '/account#notifications',
        'warning',
        jsonb_build_object(
            'sanction_id', sanction_row.id,
            'sanction_type', sanction_row.sanction_type,
            'target_user_id', target_profile.id
        )
    );

    return sanction_row;
end;
$$;

create or replace function public.clear_account_sanction(
    p_account_id text,
    p_sanction_type text,
    p_note text default ''
)
returns public.account_sanctions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    target_profile public.profiles;
    sanction_row public.account_sanctions;
    actor_profile public.profiles;
begin
    if v_actor_id is null then
        raise exception 'You must be logged in to lift sanctions.';
    end if;

    select * into target_profile
    from public.profiles
    where account_id = p_account_id;

    if target_profile.id is null then
        raise exception 'Target account not found.';
    end if;

    if p_sanction_type = 'suspension' then
        if not public.actor_can_moderate_target(v_actor_id, target_profile.id, 'suspend') then
            raise exception 'You do not have permission to lift that suspension.';
        end if;
    elsif p_sanction_type = 'ban' then
        if not public.actor_can_moderate_target(v_actor_id, target_profile.id, 'ban') then
            raise exception 'You do not have permission to lift that ban.';
        end if;
    else
        raise exception 'Unsupported sanction type.';
    end if;

    update public.account_sanctions
    set lifted_at = timezone('utc', now()),
        lifted_by = v_actor_id,
        lift_note = left(coalesce(p_note, ''), 400)
    where id = (
        select s.id
        from public.account_sanctions s
        where s.target_user_id = target_profile.id
          and s.sanction_type = p_sanction_type
          and s.lifted_at is null
          and (s.expires_at is null or s.expires_at > timezone('utc', now()))
        order by s.created_at desc
        limit 1
    )
    returning * into sanction_row;

    if sanction_row.id is null then
        raise exception 'No active % found for that account.', p_sanction_type;
    end if;

    select * into actor_profile
    from public.profiles
    where id = v_actor_id;

    perform public.create_notification(
        target_profile.id,
        'sanction_cleared',
        'A moderation restriction on your account was lifted.',
        coalesce(actor_profile.display_name, 'A Hollowside official') || ' lifted your ' || p_sanction_type || '.',
        '/account#notifications',
        'success',
        jsonb_build_object(
            'sanction_id', sanction_row.id,
            'sanction_type', sanction_row.sanction_type,
            'target_user_id', target_profile.id
        )
    );

    return sanction_row;
end;
$$;

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
    viewer_id uuid;
begin
    q := lower(trim(coalesce(p_query, '')));
    viewer_id := auth.uid();

    return query
    select *
    from public.profile_cards pc
    where not public.is_account_banned(pc.id)
      and (
            q = ''
            or (
                (p_use_display and lower(pc.display_name) like '%' || q || '%')
                or (p_use_username and lower(pc.username) like '%' || q || '%')
                or (p_use_account_id and lower(pc.account_id) like '%' || q || '%')
            )
        )
      and (viewer_id is null or not public.has_block_relation(viewer_id, pc.id))
    order by pc.member_since desc
    limit greatest(1, least(coalesce(p_limit, 24), 60));
end;
$$;

commit;
