import 'dotenv/config';
export const APP_VERSION='0.5.0';
export const env={
  PORT:Number(process.env.PORT||3000),
  PUBLIC_BASE_URL:process.env.PUBLIC_BASE_URL||'http://localhost:3000',
  SUPABASE_URL:process.env.SUPABASE_URL||'',
  SUPABASE_ANON_KEY:process.env.SUPABASE_ANON_KEY||'',
  SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY||'',
  SUPABASE_MEDIA_BUCKET:process.env.SUPABASE_MEDIA_BUCKET||'socialorbit-media',
  ENCRYPTION_KEY_HEX:process.env.ENCRYPTION_KEY_HEX||'',
  REDIS_URL:process.env.REDIS_URL||'redis://127.0.0.1:6379',
  ENABLE_PUBLISHING:process.env.ENABLE_PUBLISHING==='true',
  ENABLE_SOCIAL_SYNC:process.env.ENABLE_SOCIAL_SYNC==='true',
  ENABLE_MEDIA_CLEANUP:process.env.ENABLE_MEDIA_CLEANUP!=='false',
  PUBLISH_VIA_CRON:process.env.PUBLISH_VIA_CRON==='true',
  ADMIN_REQUIRE_MFA:process.env.ADMIN_REQUIRE_MFA!=='false',
  CRON_SECRET:process.env.CRON_SECRET||''
};
export const configured=Boolean(env.SUPABASE_URL.startsWith('https://')&&env.SUPABASE_SERVICE_ROLE_KEY&&!env.SUPABASE_SERVICE_ROLE_KEY.includes('YOUR_')&&env.SUPABASE_ANON_KEY&&!env.SUPABASE_ANON_KEY.includes('YOUR_'));
