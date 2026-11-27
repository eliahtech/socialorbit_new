import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,workspace,uuid} from '../middleware/auth.ts';
import {env} from '../config.ts';
import {preflight,isBlocked} from '../../../../packages/core/src/guardrails.ts';
import {executePublishingJob} from '../services/publisher.ts';
import {hasYoutubeUploadScope} from '../../../../packages/core/src/youtube.ts';
import {idempotencyKey} from '../../../../packages/core/src/scheduling.ts';
import {publishSupport,resolveLink} from '../../../../packages/core/src/domain.ts';
export const publishingRoutes=Router({mergeParams:true});
publishingRoutes.use(requireAuth,needSpace());
publishingRoutes.get('/jobs',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('publishing_jobs').select('id,content_id,account_id,status,scheduled_at,error_code,error_message,external_post_id,created_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false}).limit(100);
 assert(!error,503,'Jobs unavailable');res.json(data);
}));
const payload=z.object({contentId:uuid,accountIds:z.array(uuid).min(1).max(20),mediaId:uuid.nullable().optional(),scheduledAt:z.string().datetime({offset:true}).optional()}).strict();
publishingRoutes.post('/jobs',needSpace('editor'),asyncRoute(async(req,res)=>{
 assert(env.ENABLE_PUBLISHING,409,'External publishing is not enabled. Configure provider credentials, approvals and the publishing worker first.');
 const p=payload.parse(req.body),wid=workspace(req).id,db=database();
 const scheduledAt=p.scheduledAt||new Date(Date.now()+10000).toISOString();assert(Date.parse(scheduledAt)>Date.now(),400,'Scheduled time must be in the future');
 const contentRow=await db.from('content_items').select('*').eq('id',p.contentId).eq('workspace_id',wid).maybeSingle();assert(!contentRow.error&&contentRow.data,404,'Content not found');const content=contentRow.data;const link=resolveLink(content);
 let media:any=null;if(p.mediaId){const m=await db.from('media_assets').select('*').eq('id',p.mediaId).eq('workspace_id',wid).maybeSingle();assert(!m.error&&m.data,404,'Media asset not found');media=m.data;}
 const results:{accountId:string;jobId?:string;error?:string}[]=[];
 for(const accountId of [...new Set(p.accountIds)]){
  const r=await db.from('social_accounts').select('*').eq('id',accountId).eq('workspace_id',wid).maybeSingle();
  if(r.error||!r.data){results.push({accountId,error:'Account missing'});continue;}
  const account=r.data;
  const findings=preflight({provider:account.provider,kind:content.kind,permissionGranted:account.status==='connected',accountConnected:account.status==='connected',publishingEnabled:env.ENABLE_PUBLISHING,scheduledAt,caption:content.body,link,media:media?{byteSize:media.bytes,available:media.status==='verified',expiresAt:media.expires_at}:undefined});
  const support=publishSupport(account.provider,content.kind,{link,hasMedia:Boolean(media)});
  const messages=findings.filter(x=>x.severity==='block').map(x=>x.message);
  if(account.provider==='youtube'&&content.kind==='video'&&!hasYoutubeUploadScope(account.granted_scopes))messages.push('This YouTube connection lacks upload permission. Reconnect YouTube and approve the upload permission.');
  if(!support.ok&&!messages.length)messages.push(support.reason||'This destination cannot publish this content');
  if(messages.length){results.push({accountId,error:[...new Set(messages)].join('; ')});continue;}
  const key=idempotencyKey(content.id,account.id,scheduledAt);
  const existing=await db.from('publishing_jobs').select('id').eq('workspace_id',wid).eq('idempotency_key',key).maybeSingle();
  if(existing.data){results.push({accountId,jobId:existing.data.id});continue;}
  const reserved=await db.rpc('credit_reserve',{p_workspace:wid,p_kind:'publishing',p_units:1,p_key:key,p_reason:'Scheduled destination publishing'});
  if(reserved.error||!reserved.data){results.push({accountId,error:'Publishing quota exhausted or unavailable'});continue;}
  const insert=await db.from('publishing_jobs').insert({workspace_id:wid,content_id:content.id,account_id:account.id,media_id:media?.id||null,scheduled_at:scheduledAt,idempotency_key:key,credit_tx_id:reserved.data}).select('id').single();
  if(insert.error||!insert.data){await db.rpc('credit_release',{p_id:reserved.data});results.push({accountId,error:'Could not create job'});continue;}
  results.push({accountId,jobId:insert.data.id});
 }
 res.status(207).json({results,note:'Queued jobs are published by the worker or cron; use run-now to publish a queued job immediately.'});
}));
publishingRoutes.post('/jobs/:id/cancel',needSpace('editor'),asyncRoute(async(req,res)=>{
 const id=uuid.parse(req.params.id),wid=workspace(req).id,db=database();
 const r=await db.from('publishing_jobs').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',wid).in('status',['scheduled','queued']).select('id,credit_tx_id').maybeSingle();assert(!r.error,503,'Cancel unavailable');assert(r.data,409,'Job missing or already processing');
 if(r.data.credit_tx_id)await db.rpc('credit_release',{p_id:r.data.credit_tx_id});res.json({cancelled:true});
}));
// Publishes one queued job right now, inside this request (the job is claimed atomically, so it cannot double-post).
publishingRoutes.post('/jobs/:id/run-now',needSpace('editor'),asyncRoute(async(req,res)=>{
 assert(env.ENABLE_PUBLISHING,409,'External publishing is not enabled on this server (set ENABLE_PUBLISHING=true).');
 const id=uuid.parse(req.params.id),wid=workspace(req).id,db=database();
 const j=await db.from('publishing_jobs').select('id,status').eq('id',id).eq('workspace_id',wid).maybeSingle();
 assert(!j.error&&j.data,404,'Job not found');assert(['scheduled','queued'].includes(j.data.status),409,'This job is not waiting to be published');
 res.json(await executePublishingJob(id));
}));
