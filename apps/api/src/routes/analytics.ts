import {Router} from 'express';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,workspace} from '../middleware/auth.ts';
export const analyticsRoutes=Router({mergeParams:true});
analyticsRoutes.use(requireAuth,needSpace());
analyticsRoutes.get('/',asyncRoute(async(req,res)=>{
 const db=database(),wid=workspace(req).id;
 const [published,metrics,ai]=await Promise.all([
  db.from('publishing_jobs').select('status,scheduled_at,account_id').eq('workspace_id',wid).order('created_at',{ascending:false}).limit(1000),
  db.from('metric_snapshots').select('provider,metrics,observed_at').eq('workspace_id',wid).order('observed_at',{ascending:false}).limit(100),
  db.from('ai_requests').select('kind,status,created_at').eq('workspace_id',wid).order('created_at',{ascending:false}).limit(1000)
 ]);
 for(const item of [published,metrics,ai])assert(!item.error,503,'Analytics unavailable');
 const jobs=published.data||[],a=ai.data||[];
 res.json({publicationCounts:{total:jobs.length,published:jobs.filter(x=>x.status==='published').length,failed:jobs.filter(x=>x.status==='failed').length,scheduled:jobs.filter(x=>x.status==='scheduled').length},aiCounts:{total:a.length,completed:a.filter(x=>x.status==='completed').length},providerMetrics:metrics.data||[],note:'Metrics contain real saved provider snapshots only. Missing metrics are not fabricated.'});
}));
