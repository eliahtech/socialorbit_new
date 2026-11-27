// Builds browser assets. Runs locally (predev/prestart) and on Vercel (buildCommand).
// 1) Bundles @supabase/supabase-js into apps/web/public/vendor/supabase.js so the browser never loads
//    executable code from a third-party CDN (keeps CSP script-src to 'self').
// 2) Generates sitemap.xml / robots.txt for the real production origin when one is known.
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
await build({
  stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:process.cwd(),loader:'js'},
  bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,
  outfile:'apps/web/public/vendor/supabase.js',legalComments:'none',logLevel:'warning'
});
console.log('Bundled vendor/supabase.js');
const origin=process.env.PUBLIC_BASE_URL||(process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:'');
if(/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(origin)&&!origin.includes('.example')){
  const r=spawnSync(process.execPath,['scripts/generate-sitemap.mjs',origin],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);
}else console.log('Skipping sitemap generation (set PUBLIC_BASE_URL to your https production origin).');

// Lets /diagnose.html show exactly which commit is deployed.
writeFileSync('apps/web/public/build-info.json',JSON.stringify({
  commit:(process.env.VERCEL_GIT_COMMIT_SHA||'local').slice(0,7),
  message:(process.env.VERCEL_GIT_COMMIT_MESSAGE||'').slice(0,120),
  branch:process.env.VERCEL_GIT_COMMIT_REF||'',
  buildNode:process.version,builtAt:new Date().toISOString()
}));
