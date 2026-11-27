-- Videos are no longer uploaded to SocialOrbit. Tighten the private media bucket to images only (defence in depth:
-- the API already rejects video/* uploads, and now Storage rejects them too). Safe to run more than once.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       public = false
 where id = 'socialorbit-media';
