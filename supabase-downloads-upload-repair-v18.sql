-- Downloads upload repair v18
-- Run after v17 in the Supabase SQL Editor. This is safe to run more than once.

insert into public.permission_definitions (permission_key, label, description, category)
values (
    'publish_downloads',
    'Able To Publish Downloads',
    'Can publish game, engine, and project downloads.',
    'publishing'
)
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

drop policy if exists "Download publishers can update downloads" on storage.objects;
create policy "Download publishers can update downloads"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'downloads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.get_effective_permission_value(auth.uid(), 'publish_downloads')
)
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
