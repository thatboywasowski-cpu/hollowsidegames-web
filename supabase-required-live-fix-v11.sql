-- Required live fix v11
-- Run this in Supabase SQL Editor to restore comments and install Downloads RPCs.

insert into public.permission_definitions (permission_key, label, description, category)
values
    ('publish_downloads', 'Able To Publish Downloads', 'Can publish games, project files, and Obsidian builds in the Downloads section.', 'content')
on conflict (permission_key) do update
set label = excluded.label,
    description = excluded.description,
    category = excluded.category;

insert into public.role_permissions (role_key, permission_key, allowed)
values
    ('owner', 'publish_downloads', true),
    ('co_owner', 'publish_downloads', true),
    ('developer', 'publish_downloads', true)
on conflict (role_key, permission_key) do update
set allowed = excluded.allowed;

insert into storage.buckets (id, name, public, file_size_limit)
values ('downloads', 'downloads', true, 214748364800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create table if not exists public.download_entries (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null references public.profiles (id) on delete cascade,
    category text not null,
    title text not null,
    summary text not null default '',
    version text not null default '',
    download_url text not null,
    storage_path text not null default '',
    file_size_bytes bigint not null default 0,
    published boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint download_entries_category_check check (category in ('games', 'engine')),
    constraint download_entries_size_check check (file_size_bytes >= 0 and file_size_bytes <= 214748364800)
);

alter table public.download_entries enable row level security;

drop policy if exists "Published downloads are public" on public.download_entries;
create policy "Published downloads are public"
on public.download_entries
for select
to anon, authenticated
using (published = true);

drop policy if exists "Download publishers can manage their downloads" on public.download_entries;
create policy "Download publishers can manage their downloads"
on public.download_entries
for all
to authenticated
using (author_id = auth.uid() and public.get_effective_permission_value(auth.uid(), 'publish_downloads'))
with check (author_id = auth.uid() and public.get_effective_permission_value(auth.uid(), 'publish_downloads'));

drop policy if exists "Downloads are public" on storage.objects;
create policy "Downloads are public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'downloads');

drop policy if exists "Download publishers can upload downloads" on storage.objects;
create policy "Download publishers can upload downloads"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'downloads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.get_effective_permission_value(auth.uid(), 'publish_downloads')
);

drop policy if exists "Download publishers can delete downloads" on storage.objects;
create policy "Download publishers can delete downloads"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'downloads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.get_effective_permission_value(auth.uid(), 'publish_downloads')
);

drop function if exists public.create_post_comment(uuid, text, bigint);
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
    v_actor_id uuid;
    v_comment_row public.content_post_comments;
    v_post_author_id uuid;
begin
    v_actor_id := auth.uid();

    if v_actor_id is null then
        raise exception 'You must be logged in to comment.';
    end if;

    if public.is_account_banned(v_actor_id) then
        raise exception 'Banned accounts cannot comment.';
    end if;

    if public.is_account_suspended(v_actor_id) then
        raise exception 'Suspended accounts can react, but they cannot comment until the suspension ends.';
    end if;

    if not public.get_effective_permission_value(v_actor_id, 'comment_posts') then
        raise exception 'You do not have permission to comment yet.';
    end if;

    select cp.author_id
    into v_post_author_id
    from public.content_posts cp
    where cp.id = p_post_id
      and cp.published = true;

    if v_post_author_id is null then
        raise exception 'Target post not found.';
    end if;

    if public.has_block_relation(v_actor_id, v_post_author_id) then
        raise exception 'That post is unavailable because one of you has blocked the other.';
    end if;

    insert into public.content_post_comments (
        post_id,
        author_id,
        parent_id,
        body
    )
    values (
        p_post_id,
        v_actor_id,
        p_parent_id,
        trim(coalesce(p_body, ''))
    )
    returning * into v_comment_row;

    perform public.touch_my_activity();
    return v_comment_row;
end;
$$;

drop function if exists public.create_download_entry(text, text, text, text, text, text, bigint);
create or replace function public.create_download_entry(
    p_category text,
    p_title text,
    p_summary text,
    p_version text,
    p_download_url text,
    p_storage_path text default '',
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
        storage_path,
        file_size_bytes
    )
    values (
        v_actor_id,
        p_category,
        trim(p_title),
        trim(coalesce(p_summary, '')),
        trim(coalesce(p_version, '')),
        trim(p_download_url),
        trim(coalesce(p_storage_path, '')),
        coalesce(p_file_size_bytes, 0)
    )
    returning * into v_entry;

    return v_entry;
end;
$$;

drop function if exists public.get_my_account_context();
create or replace function public.get_my_account_context()
returns table (
    id uuid,
    account_id text,
    username text,
    display_name text,
    avatar_url text,
    role_label text,
    is_verified boolean,
    verification_mode text,
    can_manage_roles boolean,
    can_manage_role_permissions boolean,
    can_manage_account_permissions boolean,
    can_verify_accounts boolean,
    can_publish_news boolean,
    can_publish_personal_posts boolean,
    can_publish_downloads boolean,
    can_comment_posts boolean,
    can_manage_reports boolean,
    can_issue_warnings boolean,
    can_suspend_accounts boolean,
    can_ban_accounts boolean,
    can_access_moderation boolean,
    can_react_to_posts boolean,
    is_suspended boolean,
    is_banned boolean,
    restriction_until timestamptz,
    restriction_label text,
    unread_notification_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
    with profile_base as (
        select p.*,
               public.get_effective_permission_value(p.id, 'manage_roles') as raw_manage_roles,
               public.get_effective_permission_value(p.id, 'manage_role_permissions') as raw_manage_role_permissions,
               public.get_effective_permission_value(p.id, 'manage_account_permissions') as raw_manage_account_permissions,
               public.get_effective_permission_value(p.id, 'verify_accounts') as raw_verify_accounts,
               public.get_effective_permission_value(p.id, 'publish_news') as raw_publish_news,
               public.get_effective_permission_value(p.id, 'publish_personal_posts') as raw_publish_personal_posts,
               public.get_effective_permission_value(p.id, 'publish_downloads') as raw_publish_downloads,
               public.get_effective_permission_value(p.id, 'comment_posts') as raw_comment_posts,
               public.get_effective_permission_value(p.id, 'manage_reports') as raw_manage_reports,
               public.get_effective_permission_value(p.id, 'issue_warnings') as raw_issue_warnings,
               public.get_effective_permission_value(p.id, 'suspend_accounts') as raw_suspend_accounts,
               public.get_effective_permission_value(p.id, 'ban_accounts') as raw_ban_accounts
        from public.profiles p
        where p.id = auth.uid()
    )
    select
        pb.id,
        pb.account_id,
        pb.username,
        pb.display_name,
        pb.avatar_url,
        pb.role_label,
        public.resolve_is_verified(
            pb.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = pb.id),
            pb.created_at,
            pb.last_active_at
        ) as is_verified,
        public.resolve_verification_mode(
            pb.manual_verified,
            (select count(*)::integer from public.account_follows af where af.following_id = pb.id),
            pb.created_at,
            pb.last_active_at
        ) as verification_mode,
        pb.raw_manage_roles as can_manage_roles,
        pb.raw_manage_role_permissions as can_manage_role_permissions,
        pb.raw_manage_account_permissions as can_manage_account_permissions,
        pb.raw_verify_accounts as can_verify_accounts,
        (pb.raw_publish_news and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_publish_news,
        (pb.raw_publish_personal_posts and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_publish_personal_posts,
        (pb.raw_publish_downloads and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_publish_downloads,
        (pb.raw_comment_posts and coalesce(s.sanction_type, '') not in ('suspension', 'ban')) as can_comment_posts,
        pb.raw_manage_reports as can_manage_reports,
        pb.raw_issue_warnings as can_issue_warnings,
        pb.raw_suspend_accounts as can_suspend_accounts,
        pb.raw_ban_accounts as can_ban_accounts,
        (pb.raw_manage_reports or pb.raw_issue_warnings or pb.raw_suspend_accounts or pb.raw_ban_accounts) as can_access_moderation,
        (coalesce(s.sanction_type, '') <> 'ban') as can_react_to_posts,
        (coalesce(s.sanction_type, '') = 'suspension') as is_suspended,
        (coalesce(s.sanction_type, '') = 'ban') as is_banned,
        s.expires_at as restriction_until,
        case
            when s.sanction_type = 'ban' then 'Banned'
            when s.sanction_type = 'suspension' then 'Suspended'
            else ''
        end as restriction_label,
        coalesce((
            select count(*)
            from public.notifications n
            where n.user_id = pb.id
              and n.is_read = false
        ), 0)::bigint as unread_notification_count
    from profile_base pb
    left join lateral public.get_active_sanction(pb.id) s on true;
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
    storage_path text,
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
        de.storage_path,
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
