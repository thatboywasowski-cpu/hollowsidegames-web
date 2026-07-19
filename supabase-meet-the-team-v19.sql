-- Meet The Team biographies v19
-- Run after v18 in the Supabase SQL Editor. This migration is idempotent.

insert into public.permission_definitions (permission_key, label, description, category)
values (
    'write_biographies',
    'Can Write Biographies',
    'Can publish and edit Meet The Team biographies.',
    'publishing'
)
on conflict (permission_key) do update
set label = excluded.label,
    description = excluded.description,
    category = excluded.category;

insert into public.role_permissions (role_key, permission_key, allowed)
values
    ('owner', 'write_biographies', true),
    ('co_owner', 'write_biographies', true),
    ('developer', 'write_biographies', true)
on conflict (role_key, permission_key) do update
set allowed = excluded.allowed;

create table if not exists public.team_biographies (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null references public.profiles (id) on delete cascade,
    linked_profile_id uuid references public.profiles (id) on delete set null,
    name text not null,
    expertise text not null,
    introduction text not null,
    biography_markdown text not null,
    category text not null,
    games jsonb not null default '[]'::jsonb,
    picture_urls jsonb not null default '[]'::jsonb,
    picture_paths jsonb not null default '[]'::jsonb,
    published boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint team_biographies_category_check
        check (category in ('employee', 'contributor', 'both')),
    constraint team_biographies_games_array_check
        check (jsonb_typeof(games) = 'array' and jsonb_array_length(games) <= 12),
    constraint team_biographies_picture_urls_check
        check (jsonb_typeof(picture_urls) = 'array' and jsonb_array_length(picture_urls) <= 5),
    constraint team_biographies_picture_paths_check
        check (
            jsonb_typeof(picture_paths) = 'array'
            and jsonb_array_length(picture_paths) <= 5
            and jsonb_array_length(picture_paths) = jsonb_array_length(picture_urls)
        )
);

create index if not exists team_biographies_published_created_idx
on public.team_biographies (published, created_at desc);

create index if not exists team_biographies_author_idx
on public.team_biographies (author_id);

alter table public.team_biographies enable row level security;

drop policy if exists "Published team biographies are public" on public.team_biographies;
create policy "Published team biographies are public"
on public.team_biographies
for select
to anon, authenticated
using (published = true);

drop policy if exists "Biography writers manage their own articles" on public.team_biographies;
create policy "Biography writers manage their own articles"
on public.team_biographies
for all
to authenticated
using (
    author_id = auth.uid()
    and public.get_effective_permission_value(auth.uid(), 'write_biographies')
)
with check (
    author_id = auth.uid()
    and public.get_effective_permission_value(auth.uid(), 'write_biographies')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'team-biographies',
    'team-biographies',
    true,
    20971520,
    array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Team biography pictures are public" on storage.objects;
create policy "Team biography pictures are public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'team-biographies');

drop policy if exists "Biography writers upload pictures" on storage.objects;
create policy "Biography writers upload pictures"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'team-biographies'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.get_effective_permission_value(auth.uid(), 'write_biographies')
);

drop policy if exists "Biography writers update pictures" on storage.objects;
create policy "Biography writers update pictures"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'team-biographies'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.get_effective_permission_value(auth.uid(), 'write_biographies')
)
with check (
    bucket_id = 'team-biographies'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.get_effective_permission_value(auth.uid(), 'write_biographies')
);

drop policy if exists "Biography writers delete pictures" on storage.objects;
create policy "Biography writers delete pictures"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'team-biographies'
    and (
        (
            (storage.foldername(name))[1] = auth.uid()::text
            and public.get_effective_permission_value(auth.uid(), 'write_biographies')
        )
        or exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and public.resolve_effective_role_key(p.base_role_key, p.is_trusted) in ('owner', 'co_owner')
        )
    )
);

create or replace function public.can_write_team_biographies()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select auth.uid() is not null
       and public.get_effective_permission_value(auth.uid(), 'write_biographies')
       and coalesce((
            select sanction_type
            from public.get_active_sanction(auth.uid())
            limit 1
       ), '') not in ('suspension', 'ban');
$$;

create or replace function public.create_team_biography(
    p_name text,
    p_expertise text,
    p_introduction text,
    p_biography_markdown text,
    p_category text,
    p_games jsonb default '[]'::jsonb,
    p_picture_urls jsonb default '[]'::jsonb,
    p_picture_paths jsonb default '[]'::jsonb,
    p_hollowside_account_id text default null
)
returns public.team_biographies
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_linked_profile_id uuid;
    v_row public.team_biographies;
begin
    if not public.can_write_team_biographies() then
        raise exception 'You do not have permission to write biographies.';
    end if;

    if char_length(trim(coalesce(p_name, ''))) = 0 or char_length(trim(p_name)) > 120 then
        raise exception 'A name between 1 and 120 characters is required.';
    end if;

    if char_length(trim(coalesce(p_expertise, ''))) = 0 or char_length(trim(p_expertise)) > 160 then
        raise exception 'Expertise between 1 and 160 characters is required.';
    end if;

    if char_length(trim(coalesce(p_introduction, ''))) = 0 or char_length(trim(p_introduction)) > 600 then
        raise exception 'An introduction between 1 and 600 characters is required.';
    end if;

    if char_length(trim(coalesce(p_biography_markdown, ''))) = 0 or char_length(p_biography_markdown) > 30000 then
        raise exception 'A biography between 1 and 30000 characters is required.';
    end if;

    if p_category not in ('employee', 'contributor', 'both') then
        raise exception 'Unsupported biography category.';
    end if;

    if jsonb_typeof(coalesce(p_games, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_games, '[]'::jsonb)) > 12
       or exists (
            select 1
            from jsonb_array_elements(coalesce(p_games, '[]'::jsonb)) as item(value)
            where jsonb_typeof(item.value) <> 'string'
       ) then
        raise exception 'Games must be an array of up to 12 names.';
    end if;

    if jsonb_typeof(coalesce(p_picture_urls, '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(p_picture_paths, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_picture_urls, '[]'::jsonb)) > 5
       or jsonb_array_length(coalesce(p_picture_urls, '[]'::jsonb)) <> jsonb_array_length(coalesce(p_picture_paths, '[]'::jsonb))
       or exists (
            select 1
            from jsonb_array_elements(coalesce(p_picture_urls, '[]'::jsonb)) as item(value)
            where jsonb_typeof(item.value) <> 'string'
       )
       or exists (
            select 1
            from jsonb_array_elements(coalesce(p_picture_paths, '[]'::jsonb)) as item(value)
            where jsonb_typeof(item.value) <> 'string'
       ) then
        raise exception 'Pictures must contain up to five matching URLs and storage paths.';
    end if;

    if nullif(trim(coalesce(p_hollowside_account_id, '')), '') is not null then
        select id into v_linked_profile_id
        from public.profiles
        where account_id = trim(p_hollowside_account_id)
        limit 1;

        if v_linked_profile_id is null then
            raise exception 'The linked Hollowside account was not found.';
        end if;
    end if;

    insert into public.team_biographies (
        author_id,
        linked_profile_id,
        name,
        expertise,
        introduction,
        biography_markdown,
        category,
        games,
        picture_urls,
        picture_paths
    ) values (
        v_actor_id,
        v_linked_profile_id,
        trim(p_name),
        trim(p_expertise),
        trim(p_introduction),
        trim(p_biography_markdown),
        p_category,
        coalesce(p_games, '[]'::jsonb),
        coalesce(p_picture_urls, '[]'::jsonb),
        coalesce(p_picture_paths, '[]'::jsonb)
    )
    returning * into v_row;

    perform public.touch_my_activity();
    return v_row;
end;
$$;

create or replace function public.update_team_biography(
    p_biography_id uuid,
    p_name text,
    p_expertise text,
    p_introduction text,
    p_biography_markdown text,
    p_category text,
    p_games jsonb default '[]'::jsonb,
    p_picture_urls jsonb default '[]'::jsonb,
    p_picture_paths jsonb default '[]'::jsonb,
    p_hollowside_account_id text default null
)
returns public.team_biographies
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_existing public.team_biographies;
    v_linked_profile_id uuid;
    v_row public.team_biographies;
begin
    if v_actor_id is null then
        raise exception 'You must be signed in to edit a biography.';
    end if;

    select * into v_existing
    from public.team_biographies
    where id = p_biography_id;

    if v_existing.id is null then
        raise exception 'Biography not found.';
    end if;

    if v_existing.author_id <> v_actor_id or not public.can_write_team_biographies() then
        raise exception 'You do not have permission to edit this biography.';
    end if;

    if char_length(trim(coalesce(p_name, ''))) = 0 or char_length(trim(p_name)) > 120
       or char_length(trim(coalesce(p_expertise, ''))) = 0 or char_length(trim(p_expertise)) > 160
       or char_length(trim(coalesce(p_introduction, ''))) = 0 or char_length(trim(p_introduction)) > 600
       or char_length(trim(coalesce(p_biography_markdown, ''))) = 0 or char_length(p_biography_markdown) > 30000 then
        raise exception 'Name, expertise, introduction, and biography are required and must stay within their limits.';
    end if;

    if p_category not in ('employee', 'contributor', 'both') then
        raise exception 'Unsupported biography category.';
    end if;

    if jsonb_typeof(coalesce(p_games, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_games, '[]'::jsonb)) > 12
       or exists (
            select 1
            from jsonb_array_elements(coalesce(p_games, '[]'::jsonb)) as item(value)
            where jsonb_typeof(item.value) <> 'string'
       ) then
        raise exception 'Games must be an array of up to 12 names.';
    end if;

    if jsonb_typeof(coalesce(p_picture_urls, '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(p_picture_paths, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_picture_urls, '[]'::jsonb)) > 5
       or jsonb_array_length(coalesce(p_picture_urls, '[]'::jsonb)) <> jsonb_array_length(coalesce(p_picture_paths, '[]'::jsonb))
       or exists (
            select 1
            from jsonb_array_elements(coalesce(p_picture_urls, '[]'::jsonb)) as item(value)
            where jsonb_typeof(item.value) <> 'string'
       )
       or exists (
            select 1
            from jsonb_array_elements(coalesce(p_picture_paths, '[]'::jsonb)) as item(value)
            where jsonb_typeof(item.value) <> 'string'
       ) then
        raise exception 'Pictures must contain up to five matching URLs and storage paths.';
    end if;

    if nullif(trim(coalesce(p_hollowside_account_id, '')), '') is not null then
        select id into v_linked_profile_id
        from public.profiles
        where account_id = trim(p_hollowside_account_id)
        limit 1;

        if v_linked_profile_id is null then
            raise exception 'The linked Hollowside account was not found.';
        end if;
    end if;

    update public.team_biographies
    set linked_profile_id = v_linked_profile_id,
        name = trim(p_name),
        expertise = trim(p_expertise),
        introduction = trim(p_introduction),
        biography_markdown = trim(p_biography_markdown),
        category = p_category,
        games = coalesce(p_games, '[]'::jsonb),
        picture_urls = coalesce(p_picture_urls, '[]'::jsonb),
        picture_paths = coalesce(p_picture_paths, '[]'::jsonb),
        updated_at = timezone('utc', now())
    where id = p_biography_id
    returning * into v_row;

    perform public.touch_my_activity();
    return v_row;
end;
$$;

create or replace function public.delete_team_biography(p_biography_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_existing public.team_biographies;
    v_actor_role text;
begin
    if v_actor_id is null then
        raise exception 'You must be signed in to delete a biography.';
    end if;

    select * into v_existing
    from public.team_biographies
    where id = p_biography_id;

    if v_existing.id is null then
        raise exception 'Biography not found.';
    end if;

    select public.resolve_effective_role_key(p.base_role_key, p.is_trusted)
    into v_actor_role
    from public.profiles p
    where p.id = v_actor_id;

    if not coalesce(
        (v_existing.author_id = v_actor_id and public.can_write_team_biographies())
        or v_actor_role in ('owner', 'co_owner'),
        false
    ) then
        raise exception 'You do not have permission to delete this biography.';
    end if;

    delete from public.team_biographies
    where id = p_biography_id;

    perform public.touch_my_activity();
    return coalesce(v_existing.picture_paths, '[]'::jsonb);
end;
$$;

drop function if exists public.get_team_biographies(integer, integer);
create or replace function public.get_team_biographies(
    p_limit integer default 30,
    p_offset integer default 0
)
returns table (
    id uuid,
    name text,
    expertise text,
    introduction text,
    biography_markdown text,
    category text,
    games jsonb,
    picture_urls jsonb,
    picture_paths jsonb,
    author_id uuid,
    author_account_id text,
    author_display_name text,
    author_username text,
    author_is_verified boolean,
    author_verification_mode text,
    linked_account_id text,
    linked_display_name text,
    created_at timestamptz,
    updated_at timestamptz,
    total_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
    select
        tb.id,
        tb.name,
        tb.expertise,
        tb.introduction,
        tb.biography_markdown,
        tb.category,
        tb.games,
        tb.picture_urls,
        tb.picture_paths,
        tb.author_id,
        author.account_id,
        author.display_name,
        author.username,
        public.resolve_is_verified(
            author.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = author.id),
            author.created_at,
            author.last_active_at
        ),
        public.resolve_verification_mode(
            author.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = author.id),
            author.created_at,
            author.last_active_at
        ),
        linked.account_id,
        linked.display_name,
        tb.created_at,
        tb.updated_at,
        (select count(*) from public.team_biographies published_rows where published_rows.published = true)::bigint
    from public.team_biographies tb
    join public.profiles author on author.id = tb.author_id
    left join public.profiles linked on linked.id = tb.linked_profile_id
    where tb.published = true
    order by tb.created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
    offset greatest(0, coalesce(p_offset, 0));
$$;

drop function if exists public.get_team_biography(uuid);
create or replace function public.get_team_biography(p_biography_id uuid)
returns table (
    id uuid,
    name text,
    expertise text,
    introduction text,
    biography_markdown text,
    category text,
    games jsonb,
    picture_urls jsonb,
    picture_paths jsonb,
    author_id uuid,
    author_account_id text,
    author_display_name text,
    author_username text,
    author_is_verified boolean,
    author_verification_mode text,
    linked_account_id text,
    linked_display_name text,
    created_at timestamptz,
    updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    select
        tb.id,
        tb.name,
        tb.expertise,
        tb.introduction,
        tb.biography_markdown,
        tb.category,
        tb.games,
        tb.picture_urls,
        tb.picture_paths,
        tb.author_id,
        author.account_id,
        author.display_name,
        author.username,
        public.resolve_is_verified(
            author.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = author.id),
            author.created_at,
            author.last_active_at
        ),
        public.resolve_verification_mode(
            author.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = author.id),
            author.created_at,
            author.last_active_at
        ),
        linked.account_id,
        linked.display_name,
        tb.created_at,
        tb.updated_at
    from public.team_biographies tb
    join public.profiles author on author.id = tb.author_id
    left join public.profiles linked on linked.id = tb.linked_profile_id
    where tb.id = p_biography_id
      and tb.published = true
    limit 1;
$$;

revoke execute on function public.can_write_team_biographies() from public, anon;
revoke execute on function public.create_team_biography(text, text, text, text, text, jsonb, jsonb, jsonb, text) from public, anon;
revoke execute on function public.update_team_biography(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text) from public, anon;
revoke execute on function public.delete_team_biography(uuid) from public, anon;

grant execute on function public.can_write_team_biographies() to authenticated;
grant execute on function public.create_team_biography(text, text, text, text, text, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.update_team_biography(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.delete_team_biography(uuid) to authenticated;
grant execute on function public.get_team_biographies(integer, integer) to anon, authenticated;
grant execute on function public.get_team_biography(uuid) to anon, authenticated;
