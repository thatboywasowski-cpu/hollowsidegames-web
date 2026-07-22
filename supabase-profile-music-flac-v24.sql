-- Add FLAC support to profile music uploads v24.
-- Run after v23.

begin;

update storage.buckets
set allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'audio/mp3',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/webm',
    'audio/flac',
    'audio/x-flac'
]
where id = 'profile-customization';

commit;
