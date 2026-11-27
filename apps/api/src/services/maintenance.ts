import {database} from '../db.ts';
import {env} from '../config.ts';
import {executePublishingJob} from './publisher.ts';
// Shared by the long-running worker and by Vercel Cron endpoints (routes/cron.ts).
export async function cleanupExpiredMedia(){
 const db=database();
 if(!env.ENABLE_MEDIA_CLEANUP)return;
 const r=await db.from('media_assets').select('id,bucket,storage_path').lte('expires_at',new Date().toISOString()).in('status',['pending','uploaded','verified','failed']).limit(100);
 if(r.error){console.error('Cleanup query failed',r.error.code);return;}
 for(const asset of r.data||[]){
  const removed=await db.storage.from(asset.bucket).remove([asset.storage_path]);
  if(removed.error){console.error('Storage cleanup retry needed',asset.id);continue;}
  await db.from('media_assets').update({status:'deleted'}).eq('id',asset.id);
 }
}
export async function enforcePeriodExpiry(){
 const db=database();
 const r=await db.from('subscriptions').select('workspace_id,plan_key,status,current_period_end').lte('current_period_end',new Date().toISOString()).in('status',['active','past_due']).limit(100);
 if(r.error)return;
 for(const item of r.data||[]){
  if(item.plan_key==='free'){
   // Reset from the administrator-controlled plan catalog; do not touch purchased top-ups.
   const plan=await db.from('plans').select('text_credits,image_credits,publishing_jobs,old_videos').eq('key','free').single();
   if(plan.error||!plan.data)continue;
   const limits:Record<string,number>={text:plan.data.text_credits,image:plan.data.image_credits,publishing:plan.data.publishing_jobs,old_video:plan.data.old_videos};
   for(const [kind,n] of Object.entries(limits))await db.from('credit_wallets').update({monthly_balance:n}).eq('workspace_id',item.workspace_id).eq('kind',kind);
   const periodStart=new Date(),periodEnd=new Date(periodStart);periodEnd.setUTCMonth(periodEnd.getUTCMonth()+1);
   await db.from('subscriptions').update({current_period_start:periodStart.toISOString(),current_period_end:periodEnd.toISOString()}).eq('workspace_id',item.workspace_id);
  }else{
   await db.from('subscriptions').update({status:'expired'}).eq('workspace_id',item.workspace_id);
   for(const kind of ['text','image','publishing','old_video'])await db.from('credit_wallets').update({monthly_balance:0}).eq('workspace_id',item.workspace_id).eq('kind',kind);
  }
 }
}

/** Direct (queue-less) dispatch used only when PUBLISH_VIA_CRON=true. executePublishingJob claims each job atomically,
 *  so running this alongside a worker cannot publish the same job twice. */
export async function publishDueDirect(limit=5,budgetMs=45000){
 if(!env.ENABLE_PUBLISHING)return {attempted:0,skipped:'publishing disabled'};
 const db=database();const started=Date.now();
 const r=await db.from('publishing_jobs').select('id').eq('status','scheduled').lte('scheduled_at',new Date().toISOString()).order('scheduled_at').limit(limit);
 if(r.error)return {attempted:0,error:r.error.code||'query_failed'};
 let attempted=0;
 for(const row of r.data||[]){
  if(Date.now()-started>budgetMs)break;
  try{await executePublishingJob(String(row.id));attempted++}catch(e){console.error('Cron publish failed',row.id,e instanceof Error?e.message:'unknown')}
 }
 return {attempted};
}
