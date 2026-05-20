-- Owner downloads permission repair v15
-- Run after v14 if Owner/Co-Owner/Developer cannot see the Downloads uploader.

insert into public.permission_definitions (permission_key, label, description, category)
values
    ('publish_downloads', 'Able To Publish Downloads', 'Can publish game, engine, and project downloads.', 'publishing')
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

drop function if exists public.repair_download_publish_permissions();
create or replace function public.repair_download_publish_permissions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.role_permissions (role_key, permission_key, allowed)
    values
        ('owner', 'publish_downloads', true),
        ('co_owner', 'publish_downloads', true),
        ('developer', 'publish_downloads', true)
    on conflict (role_key, permission_key) do update
    set allowed = excluded.allowed;
end;
$$;

select public.repair_download_publish_permissions();
