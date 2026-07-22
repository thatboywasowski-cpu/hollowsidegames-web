-- Expanded preset colors and validated custom RGB profile themes v23.
-- Run after v22.

begin;

alter table public.profiles
    drop constraint if exists profiles_theme_allowed;

alter table public.profiles
    add constraint profiles_theme_allowed
        check (
            profile_theme in (
                'black', 'red', 'purple', 'white', 'yellow', 'green', 'pink', 'blue', 'cyan',
                'orange', 'lime', 'teal', 'indigo', 'violet', 'magenta', 'rose', 'coral',
                'maroon', 'navy', 'sky-blue', 'mint', 'lavender', 'peach', 'gold', 'silver',
                'gray', 'brown', 'crimson', 'emerald', 'electric-blue', 'neon-green',
                'hot-pink', 'amber', 'midnight', 'ice'
            )
            or profile_theme ~ '^custom-[0-9a-f]{6}$'
        );

commit;
