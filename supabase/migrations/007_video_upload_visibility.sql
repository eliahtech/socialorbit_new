-- Video upload is back (for publishing to YouTube) and posts get a YouTube visibility setting.
-- Supersedes 006's images-only bucket rule. Safe to run more than once.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'],
       public = false
 where id = 'socialorbit-media';

alter table public.content_items add column if not exists visibility text;
alter table public.content_items drop constraint if exists content_items_visibility_check;
alter table public.content_items add constraint content_items_visibility_check
 check (visibility is null or visibility in ('private','unlisted','public'));
