-- Downloads platform builds v12
-- Run after v11 to support Windows/Mac/Linux builds, thumbnails, screenshots,
-- and full download detail pages.

alter table if exists public.download_entries
    add column if not exists thumbnail_url text not null default '',
    add column if not exists screenshot_urls jsonb not null default '[]'::jsonb,
    add column if not exists windows_url text not null default '',
    add column if not exists mac_url text not null default '',
    add column if not exists linux_url text not null default '';

drop function if exists public.create_download_entry(text, text, text, text, text, text, bigint);
drop function if exists public.create_download_entry(text, text, text, text, text, jsonb, text, text, text, bigint);
create or replace function public.create_download_entry(
    p_category text,
    p_title text,
    p_summary text,
    p_version text,
    p_thumbnail_url text default '',
    p_screenshot_urls jsonb default '[]'::jsonb,
    p_windows_url text default '',
    p_mac_url text default '',
    p_linux_url text default '',
    p_file_size_bytes bigint default 0
)
returns public.download_entries
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid;
    v_entry public.download_entries;
begin
    v_actor_id := auth.uid();

    if v_actor_id is null then
        raise exception 'You must be logged in to publish downloads.';
    end if;

    if not public.get_effective_permission_value(v_actor_id, 'publish_downloads') then
        raise exception 'You do not have permission to publish downloads.';
    end if;

    if p_category not in ('games', 'engine') then
        raise exception 'Unsupported download category.';
    end if;

    if char_length(trim(coalesce(p_title, ''))) = 0 then
        raise exception 'Downloads must have a title.';
    end if;

    if char_length(trim(coalesce(p_windows_url, ''))) = 0
       and char_length(trim(coalesce(p_mac_url, ''))) = 0
       and char_length(trim(coalesce(p_linux_url, ''))) = 0 then
        raise exception 'Downloads must include at least one platform build.';
    end if;

    if jsonb_typeof(coalesce(p_screenshot_urls, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_screenshot_urls, '[]'::jsonb)) > 10 then
        raise exception 'Downloads can include up to 10 screenshots.';
    end if;

    if coalesce(p_file_size_bytes, 0) > 214748364800 then
        raise exception 'Downloads cannot exceed 200 GB.';
    end if;

    insert into public.download_entries (
        author_id,
        category,
        title,
        summary,
        version,
        download_url,
        thumbnail_url,
        screenshot_urls,
        windows_url,
        mac_url,
        linux_url,
        file_size_bytes
    )
    values (
        v_actor_id,
        p_category,
        trim(p_title),
        trim(coalesce(p_summary, '')),
        trim(coalesce(p_version, '')),
        coalesce(nullif(trim(p_windows_url), ''), nullif(trim(p_mac_url), ''), trim(coalesce(p_linux_url, ''))),
        trim(coalesce(p_thumbnail_url, '')),
        coalesce(p_screenshot_urls, '[]'::jsonb),
        trim(coalesce(p_windows_url, '')),
        trim(coalesce(p_mac_url, '')),
        trim(coalesce(p_linux_url, '')),
        coalesce(p_file_size_bytes, 0)
    )
    returning * into v_entry;

    return v_entry;
end;
$$;

drop function if exists public.get_download_entries(text, integer);
create or replace function public.get_download_entries(
    p_category text default null,
    p_limit integer default 40
)
returns table (
    id uuid,
    category text,
    title text,
    summary text,
    version text,
    download_url text,
    thumbnail_url text,
    screenshot_urls jsonb,
    windows_url text,
    mac_url text,
    linux_url text,
    file_size_bytes bigint,
    author_account_id text,
    author_display_name text,
    author_username text,
    created_at timestamptz,
    updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    select
        de.id,
        de.category,
        de.title,
        de.summary,
        de.version,
        de.download_url,
        de.thumbnail_url,
        de.screenshot_urls,
        de.windows_url,
        de.mac_url,
        de.linux_url,
        de.file_size_bytes,
        p.account_id as author_account_id,
        p.display_name as author_display_name,
        p.username as author_username,
        de.created_at,
        de.updated_at
    from public.download_entries de
    join public.profiles p on p.id = de.author_id
    where de.published = true
      and (p_category is null or de.category = p_category)
    order by de.created_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 100));
$$;

drop function if exists public.get_download_entry(uuid);
create or replace function public.get_download_entry(p_download_id uuid)
returns table (
    id uuid,
    category text,
    title text,
    summary text,
    version text,
    download_url text,
    thumbnail_url text,
    screenshot_urls jsonb,
    windows_url text,
    mac_url text,
    linux_url text,
    file_size_bytes bigint,
    author_account_id text,
    author_display_name text,
    author_username text,
    created_at timestamptz,
    updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    select *
    from public.get_download_entries(null, 100)
    where id = p_download_id
    limit 1;
$$;
