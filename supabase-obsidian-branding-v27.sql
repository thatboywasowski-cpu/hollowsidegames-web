-- Apply the Obsidian product name to live permission copy.
-- Run after v26.

begin;

update public.permission_definitions
set description = 'Can publish game, Obsidian, and project downloads.'
where permission_key = 'publish_downloads';

notify pgrst, 'reload schema';

commit;
