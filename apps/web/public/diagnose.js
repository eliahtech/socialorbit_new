const out=document.getElementById('out');let report=[];
function row(ok,title,detail){
  report.push(`${ok===null?'INFO':ok?'PASS':'FAIL'}  ${title}${detail?' - '+detail:''}`);
  const d=document.createElement('div');d.className='panel';d.style.cssText=`padding:10px 14px;border-left:4px solid ${ok===null?'#5b7aa6':ok?'#1fb97a':'#e0475b'}`;
  const b=document.createElement('b');b.textContent=(ok===null?'ℹ ':ok?'✓ ':'✗ ')+title;d.appendChild(b);
  if(detail){const p=document.createElement('div');p.className='muted';p.style.cssText='font-size:.85rem;margin-top:4px;word-break:break-word';p.textContent=detail;d.appendChild(p)}
  out.appendChild(d);
}
async function get(url,opts){const t=Date.now();try{const r=await fetch(url,{cache:'no-store',...opts});const text=await r.text();return {r,text,ms:Date.now()-t}}catch(e){return {error:e.message||String(e),ms:Date.now()-t}}}
const startup=j=>j&&j.code==='STARTUP_FAILED'?`The API failed to start: ${j.detail}`:null;
async function run(){
  out.textContent='';report=[`SocialOrbit diagnostics ${new Date().toISOString()}`,`origin ${location.origin}`];
  row(null,'Browser',navigator.userAgent.slice(0,140));
  let x=await get('/build-info.json');
  if(!x.error&&x.r.ok){try{const b=JSON.parse(x.text);row(null,'Deployed version',`commit ${b.commit} "${b.message}" on ${b.branch}; built ${b.builtAt} with Node ${b.buildNode}`)}catch{row(null,'Deployed version','unreadable build-info.json')}}
  else row(false,'Deployed version','build-info.json missing: this is an OLD deployment (before v0.4.3). Check that your latest commit was pushed and Vercel deployed it.');
  x=await get('/api/ping');
  if(x.error)row(false,'Function runtime (/api/ping)',x.error);
  else{let j=null;try{j=JSON.parse(x.text)}catch{}
    if(!j)row(false,'Function runtime (/api/ping)',`HTTP ${x.r.status}: ${x.text.slice(0,120)}  (even a tiny function crashes: check the Node.js Version in Vercel Settings, and that api/ping.js was deployed)`);
    else row(j.app==='loads','API bundle loads inside the function',`runtime ${j.node}; ${j.app}${j.error?': '+j.error:''}; files: ${(j.files||[]).join(', ')}`)}
  x=await get('/app.js');
  if(x.error)row(false,'/app.js reachable',x.error);
  else{const ct=x.r.headers.get('content-type')||'';row(x.r.ok&&/javascript/.test(ct),'/app.js is served as JavaScript',`HTTP ${x.r.status}, ${ct||'no content-type'}${/html/.test(ct)?'  (an HTML page is being returned instead of the script)':''}`)}
  x=await get('/vendor/supabase.js');
  if(x.error)row(false,'/vendor/supabase.js reachable',x.error);
  else{const ct=x.r.headers.get('content-type')||'';row(x.r.ok&&/javascript/.test(ct)&&x.text.length>1000,'Supabase browser bundle present',`HTTP ${x.r.status}, ${x.text.length} bytes${x.r.ok?'':'  (the build step "node scripts/build-web.mjs" did not produce it; check the Vercel build log)'}`)}
  x=await get('/api/health');
  if(x.error)row(false,'API function reachable',x.error);
  else{let j=null;try{j=JSON.parse(x.text)}catch{}{if(j&&!startup(j)){row(j.encryptionKeyValid===true,'Server encryption key (ENCRYPTION_KEY_HEX) is valid',j.encryptionKeyValid?'yes':'No: must be exactly 64 hexadecimal characters. Set it in Vercel > Settings > Environment Variables and redeploy. Required to connect social accounts.');row(j.youtubeConfigured===true,'YouTube/Google OAuth variables present',j.youtubeConfigured?'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_SCOPES are set':'Missing one of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_SCOPES');row(/^https:\/\/[^/]+$/.test(j.publicBaseUrl||''),'PUBLIC_BASE_URL',(j.publicBaseUrl||'(not set)')+'  (OAuth redirect URI = this + /api/oauth/callback/youtube)')}}
  row(x.r.ok&&!!j&&!startup(j),'API function reachable',startup(j)||(j?`HTTP ${x.r.status}, version ${j.version}, database configured: ${j.databaseConfigured}`:`HTTP ${x.r.status}, not JSON: ${x.text.slice(0,160)}  (the serverless function is crashing; see Vercel > Logs)`))}
  x=await get('/api/health?deep=1');
  if(!x.error){let j=null;try{j=JSON.parse(x.text)}catch{}row(!!j&&j.database==='ok','Database reachable from the API',startup(j)||(j?`database: ${j.database||'not checked'}`:`HTTP ${x.r.status}: ${x.text.slice(0,160)}`))}
  x=await get('/api/config');
  if(x.error)row(false,'/api/config',x.error);
  else{let j=null;try{j=JSON.parse(x.text)}catch{}
    if(startup(j))row(false,'/api/config',startup(j));else if(!j)row(false,'/api/config returns JSON',`HTTP ${x.r.status}: ${x.text.slice(0,160)}`);
    else{row(!!j.configured,'Supabase configured on the server',j.configured?'yes':'No: set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in Vercel > Settings > Environment Variables, then redeploy');
      if(j.configured){try{const u=new URL(j.supabaseUrl);row(/^https:$/.test(u.protocol),'Supabase URL looks valid',u.host)}catch{row(false,'Supabase URL looks valid','SUPABASE_URL is not a valid URL')}}
      row(null,'Payment methods enabled',JSON.stringify({pesapal:!!j.payments?.pesapal?.enabled,paypal:!!j.payments?.paypal?.enabled}))}}
  if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations();row(null,'Service workers registered',String(regs.length)+(regs.length?'  (an old cached version can cause stale behaviour; use "Clear service worker & caches")':''))}
}
document.getElementById('run').onclick=run;
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(report.join('\n'));document.getElementById('copy').textContent='Copied'}catch{window.prompt('Copy this report:',report.join('\n'))}};
document.getElementById('reset').onclick=async()=>{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const r of regs)await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.reload()};
run();
