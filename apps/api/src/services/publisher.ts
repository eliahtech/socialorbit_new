import {database} from '../db.ts';
import {assert,ApiError} from '../http.ts';
import {env} from '../config.ts';
import {decryptToken,encryptToken,requireEncryptionKey} from '../../../../packages/core/src/security.ts';
import {preflight,isBlocked} from '../../../../packages/core/src/guardrails.ts';
import {publishSupport,resolveLink} from '../../../../packages/core/src/domain.ts';
import {youtubeMetadata,hasYoutubeUploadScope} from '../../../../packages/core/src/youtube.ts';
export type PublishingJob={id:string;workspace_id:string;content_id:string;account_id:string;media_id:string|null;status:string;scheduled_at:string;idempotency_key:string;attempt_count:number;credit_tx_id:string|null};
// Kept for reuse by social sync (YouTube access tokens expire after about an hour).
export async function refreshGoogleToken(accountId:string,refreshToken:string){
 const clientId=process.env.GOOGLE_CLIENT_ID,secret=process.env.GOOGLE_CLIENT_SECRET;assert(clientId&&secret,503,'YouTube OAuth not configured');
 const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:secret,refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 assert(res.ok,502,'YouTube token refresh failed');const data=await res.json() as any;assert(data.access_token,502,'YouTube token missing');
 const db=database(),key=requireEncryptionKey(env.ENCRYPTION_KEY_HEX);
 await db.from('oauth_credentials').update({access_token_ciphertext:encryptToken(data.access_token,key),expires_at:new Date(Date.now()+Number(data.expires_in||3600)*1000).toISOString()}).eq('account_id',accountId);
 return String(data.access_token);
}
async function publishFacebookPost(pageId:string,token:string,body:string,link:string|null){
 assert(body.trim()||link,400,'A Facebook post needs text or a link');
 const req=new URLSearchParams({access_token:token});
 if(body.trim())req.set('message',body);
 if(link)req.set('link',link);
 const r=await fetch(`https://graph.facebook.com/v27.0/${encodeURIComponent(pageId)}/feed`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:req.toString(),signal:AbortSignal.timeout(45000)});
 const response=await r.json() as any;
 if(!r.ok)throw new ApiError(502,`Facebook rejected publication (${response.error?.code||r.status})`,'PROVIDER_REJECTED');
 assert(response.id,502,'Facebook publication ID missing');return String(response.id);
}
export async function publishFacebookPhoto(pageId:string,token:string,caption:string,imageUrl:string){
 const req=new URLSearchParams({access_token:token,url:imageUrl,published:'true'});
 if(caption.trim())req.set('caption',caption);
 const r=await fetch(`https://graph.facebook.com/v27.0/${encodeURIComponent(pageId)}/photos`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:req.toString(),signal:AbortSignal.timeout(45000)});
 const response=await r.json() as any;
 if(!r.ok)throw new ApiError(502,`Facebook rejected the photo (${response.error?.code||r.status})`,'PROVIDER_REJECTED');
 const id=response.post_id||response.id;assert(id,502,'Facebook publication ID missing');return String(id);
}
async function signedMediaUrl(media:{bucket:string;storage_path:string}){
 const r=await database().storage.from(media.bucket).createSignedUrl(media.storage_path,900);
 assert(!r.error&&r.data?.signedUrl,503,'Could not read the media from private storage');return r.data.signedUrl;
}
/** Streams the stored video straight to YouTube's resumable upload endpoint without buffering it in memory. */
export async function uploadYoutubeVideo(p:{token:string;metadata:ReturnType<typeof youtubeMetadata>;mime:string;bytes:number;sourceUrl:string}){
 const init=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',
  headers:{Authorization:`Bearer ${p.token}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Length':String(p.bytes),'X-Upload-Content-Type':p.mime},
  body:JSON.stringify(p.metadata),signal:AbortSignal.timeout(20000)});
 if(!init.ok){const body=await init.json().catch(()=>null) as any;const reason=body?.error?.errors?.[0]?.reason||body?.error?.status||init.status;
  throw new ApiError(502,`YouTube refused the upload request (${reason}). ${reason==='quotaExceeded'?'The daily YouTube API quota is used up; try again tomorrow.':reason==='youtubeSignupRequired'?'This Google account has no YouTube channel.':'Reconnect YouTube and try again.'}`,'PROVIDER_REJECTED');}
 const location=init.headers.get('location');assert(location&&location.startsWith('https://'),502,'YouTube did not return an upload address');
 const src=await fetch(p.sourceUrl,{signal:AbortSignal.timeout(30000)});assert(src.ok&&src.body,503,'Could not read the stored video');
 let up:Response;
 try{up=await fetch(location,{method:'PUT',headers:{'Content-Type':p.mime,'Content-Length':String(p.bytes)},body:src.body,duplex:'half',signal:AbortSignal.timeout(55000)} as any);}
 catch{throw new ApiError(502,'The upload to YouTube was interrupted. It may or may not have completed; check your YouTube Studio before retrying.','AMBIGUOUS_PROVIDER_RESULT');}
 const out=await up.json().catch(()=>null) as any;
 if(!up.ok||!out?.id){const reason=out?.error?.errors?.[0]?.reason||up.status;throw new ApiError(502,`YouTube rejected the video (${reason})`,'PROVIDER_REJECTED');}
 return {id:String(out.id),privacy:String(out.status?.privacyStatus||'')};
}
export async function executePublishingJob(jobId:string){
 assert(env.ENABLE_PUBLISHING,409,'Publishing is disabled by operator');
 const db=database();const [j]=await Promise.all([db.from('publishing_jobs').select('*').eq('id',jobId).maybeSingle()]);
 assert(!j.error&&j.data,404,'Publishing job not found');const job=j.data as PublishingJob;
 if(job.status==='published'||job.status==='cancelled'||job.status==='needs_reconciliation')return {skipped:true};
 assert(['scheduled','queued'].includes(job.status),409,'Job cannot be started');
 const claim=await db.from('publishing_jobs').update({status:'processing',updated_at:new Date().toISOString(),attempt_count:job.attempt_count+1}).eq('id',job.id).in('status',['scheduled','queued']).select().maybeSingle();
 if(claim.error||!claim.data)return {skipped:true};
 const [c,a,m,paused]=await Promise.all([
  db.from('content_items').select('*').eq('id',job.content_id).eq('workspace_id',job.workspace_id).maybeSingle(),
  db.from('social_accounts').select('*').eq('id',job.account_id).eq('workspace_id',job.workspace_id).maybeSingle(),
  job.media_id?db.from('media_assets').select('*').eq('id',job.media_id).eq('workspace_id',job.workspace_id).maybeSingle():Promise.resolve({data:null,error:null}),
  db.from('feature_flags').select('enabled').eq('key','global_publishing_paused').maybeSingle()
 ]);
 const content=c.data,account=a.data,media=m.data;
 const attemptNo=job.attempt_count+1;
 await db.from('publication_attempts').insert({job_id:job.id,attempt_number:attemptNo});
 try{
  assert(!paused.data?.enabled,409,'Publishing is paused');
  assert(!c.error&&!a.error&&content&&account,404,'Content or social account unavailable');
  const cred=await db.from('oauth_credentials').select('*').eq('account_id',account.id).maybeSingle();
  assert(!cred.error&&cred.data,403,'Social token unavailable');
  const key=requireEncryptionKey(env.ENCRYPTION_KEY_HEX);
  let token=decryptToken(cred.data.access_token_ciphertext,key);
  if(account.provider==='youtube'&&cred.data.refresh_token_ciphertext&&(!cred.data.expires_at||Date.parse(cred.data.expires_at)<Date.now()+120000))token=await refreshGoogleToken(account.id,decryptToken(cred.data.refresh_token_ciphertext,key));
  const findings=preflight({provider:account.provider,kind:content.kind,accountConnected:account.status==='connected',permissionGranted:Boolean(cred.data),caption:content.body,link:resolveLink(content),publishingEnabled:env.ENABLE_PUBLISHING,
   scheduledAt:job.scheduled_at,media:media?{available:media.status==='verified',byteSize:media.bytes,expiresAt:media.expires_at}:undefined});
  assert(!isBlocked(findings),409,findings.map(x=>x.message).join('; '));
  const link=resolveLink(content);
  const support=publishSupport(account.provider,content.kind,{link,hasMedia:Boolean(media)});
  assert(support.ok,501,support.reason||'This destination cannot publish this content','NOT_IMPLEMENTED');
  let externalId:string;
  if(support.method==='youtube_video'){
   assert(hasYoutubeUploadScope(account.granted_scopes),403,'YouTube upload permission was not granted. Reconnect YouTube and approve the upload permission.','MISSING_PERMISSION');
   const up=await uploadYoutubeVideo({token,metadata:youtubeMetadata({title:content.title,body:content.body,visibility:content.visibility,link}),mime:media.mime_type,bytes:Number(media.bytes),sourceUrl:await signedMediaUrl(media)});
   externalId=up.id;
  }else if(support.method==='facebook_photo'){
   externalId=await publishFacebookPhoto(account.provider_account_id,token,content.body,await signedMediaUrl(media));
  }else externalId=await publishFacebookPost(account.provider_account_id,token,content.body,link);
  const saved=await db.from('publishing_jobs').update({status:'published',external_post_id:externalId,error_code:null,error_message:null,updated_at:new Date().toISOString()}).eq('id',job.id);
  if(saved.error)throw new ApiError(502,'External post succeeded but local recording failed; operator reconciliation is required','AMBIGUOUS_PROVIDER_RESULT');
  if(job.credit_tx_id){const settled=await db.rpc('credit_settle',{p_id:job.credit_tx_id});if(settled.error)throw new ApiError(502,'External post succeeded but quota settlement failed; operator reconciliation is required','AMBIGUOUS_PROVIDER_RESULT');}
  await db.from('publication_attempts').update({result:'published',finished_at:new Date().toISOString()}).eq('job_id',job.id).eq('attempt_number',attemptNo);
  return {published:true,id:externalId};
 }catch(e){
  const ambiguous=e instanceof ApiError&&e.code==='AMBIGUOUS_PROVIDER_RESULT';
  const state=ambiguous?'needs_reconciliation':'failed';
  await db.from('publishing_jobs').update({status:state,error_code:e instanceof ApiError?e.code:'PUBLISH_ERROR',error_message:e instanceof Error?e.message:'Publication failed',updated_at:new Date().toISOString()}).eq('id',job.id);
  await db.from('publication_attempts').update({result:state,error_code:e instanceof ApiError?e.code:'ERROR',error_details:e instanceof Error?e.message:'Unknown error',finished_at:new Date().toISOString()}).eq('job_id',job.id).eq('attempt_number',attemptNo);
  if(job.credit_tx_id&&!ambiguous)await db.rpc('credit_release',{p_id:job.credit_tx_id});
  // Ambiguous outcomes are NOT retried to avoid accidental duplicate posts.
  throw e;
 }
}
