import 'dotenv/config';
import {Queue,Worker} from 'bullmq';
import IORedis from 'ioredis';
import {createClient} from '@supabase/supabase-js';
import {executePublishingJob} from '../../api/src/services/publisher.ts';
import {cleanupExpiredMedia,enforcePeriodExpiry} from '../../api/src/services/maintenance.ts';
import {env,configured} from '../../api/src/config.ts';
import {decryptToken,requireEncryptionKey} from '../../../packages/core/src/security.ts';
if(!configured){console.error('Worker requires Supabase environment.');process.exit(1)}
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const connection=new IORedis(env.REDIS_URL,{maxRetriesPerRequest:null});
const queue=new Queue('socialorbit-publishing',{connection});
const publisher=new Worker('socialorbit-publishing',async(job)=>executePublishingJob(String(job.data.id)),{connection,concurrency:2});
publisher.on('failed',(job,error)=>console.error('Job failed',job?.id,error.message));
publisher.on('completed',job=>console.log('Job completed',job.id));
async function dispatchDue(){
 if(!env.ENABLE_PUBLISHING)return;
 const r=await db.from('publishing_jobs').select('id').eq('status','scheduled').lte('scheduled_at',new Date().toISOString()).limit(100);
 if(r.error){console.error('Could not list due jobs:',r.error.code);return;}
 for(const row of r.data||[]){await queue.add('publish',{id:row.id},{jobId:row.id,attempts:1,removeOnComplete:{age:86400},removeOnFail:{age:604800}});}
}
async function fetchJSON(url:string,token:string){const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Social API sync error '+response.status);return response.json() as Promise<any>}
async function syncSources(){
 if(!env.ENABLE_SOCIAL_SYNC)return;
 const accounts=await db.from('social_accounts').select('*').eq('status','connected').in('provider',['facebook','youtube']).limit(40);
 if(accounts.error)return;
 for(const account of accounts.data||[]){
  try{
   const cred=await db.from('oauth_credentials').select('access_token_ciphertext').eq('account_id',account.id).maybeSingle();if(!cred.data)continue;
   const token=decryptToken(cred.data.access_token_ciphertext,requireEncryptionKey(env.ENCRYPTION_KEY_HEX));
   const last=account.last_synced_at?Date.parse(account.last_synced_at):0;
   const items:{id:string;title:string;body:string;url:string;kind:'image'|'video';created:number}[]=[];
   if(account.provider==='youtube'){
    const channels=await fetchJSON('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',token);
    const playlist=channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if(playlist){const u=new URL('https://www.googleapis.com/youtube/v3/playlistItems');u.searchParams.set('part','snippet,contentDetails');u.searchParams.set('playlistId',playlist);u.searchParams.set('maxResults','50');
     const data=await fetchJSON(u.toString(),token);
     for(const i of data.items||[]){const id=i.contentDetails?.videoId;if(id)items.push({id,title:i.snippet?.title||'Untitled video',body:i.snippet?.description||'',url:`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,kind:'video',created:Date.parse(i.snippet?.publishedAt||'')||Date.now()});}
    }
   }else{
    const u=new URL(`https://graph.facebook.com/v27.0/${encodeURIComponent(account.provider_account_id)}/posts`);u.searchParams.set('fields','id,message,created_time,permalink_url,attachments{media_type,type}');u.searchParams.set('limit','50');u.searchParams.set('access_token',token);
    const data=await fetch(u,{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw Error('Facebook Page sync failed');return r.json()});
    for(const p of data.data||[]){const type=String(p.attachments?.data?.[0]?.media_type||p.attachments?.data?.[0]?.type||'').toLowerCase();const kind=type.includes('video')?'video':type.includes('photo')?'image':null;
     if(kind)items.push({id:String(p.id),title:String(p.message||'Facebook media').slice(0,160),body:String(p.message||''),url:String(p.permalink_url||''),kind,created:Date.parse(p.created_time)||Date.now()});
    }
   }
   let added=0;
   for(const item of items){
    // Historic images deliberately excluded; historic videos are metadata-only.
    if(item.kind==='image'&&(!last||item.created<=last))continue;
    const exists=await db.from('content_items').select('id').eq('workspace_id',account.workspace_id).eq('source_account_id',account.id).eq('source_external_id',item.id).maybeSingle();if(exists.data)continue;
    const saved=await db.from('content_items').insert({workspace_id:account.workspace_id,created_by:(await db.from('workspaces').select('owner_id').eq('id',account.workspace_id).single()).data?.owner_id,title:item.title,body:item.body,kind:item.kind,source_account_id:account.id,source_external_id:item.id,source_url:item.url,is_historical:!last||item.created<=last,status:'draft'});
    if(!saved.error)added++;
   }
   await db.from('social_accounts').update({last_synced_at:new Date().toISOString()}).eq('id',account.id);
   await db.from('sync_runs').insert({workspace_id:account.workspace_id,account_id:account.id,status:'completed',items_seen:items.length,items_added:added,finished_at:new Date().toISOString()});
  }catch(e){console.error('Social sync failed',account.provider,account.id,e instanceof Error?e.message:'unknown');await db.from('sync_runs').insert({workspace_id:account.workspace_id,account_id:account.id,status:'failed',error_message:e instanceof Error?e.message:'Unknown error',finished_at:new Date().toISOString()})}
 }
}
let running=false;let n=0;
async function tick(){if(running)return;running=true;try{await dispatchDue();if(n++%10===0){await cleanupExpiredMedia();await enforcePeriodExpiry();await syncSources();}}catch(e){console.error('Worker tick failed',e instanceof Error?e.message:'unknown')}finally{running=false;}}
console.log('SocialOrbit worker started. Publishing enabled:',env.ENABLE_PUBLISHING,'Sync enabled:',env.ENABLE_SOCIAL_SYNC);
void tick();const interval=setInterval(()=>void tick(),60000);
async function shutdown(){clearInterval(interval);await publisher.close();await queue.close();await connection.quit();process.exit(0);}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
