import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,workspace,uuid} from '../middleware/auth.ts';
export const automationRoutes=Router({mergeParams:true});
automationRoutes.use(requireAuth,needSpace());
const ruleSchema=z.object({title:z.string().trim().min(3).max(100),rule_type:z.enum(['new_content','historical_video','evergreen']),source_account_id:uuid.nullable().optional(),require_approval:z.boolean().default(true),config:z.record(z.unknown()).default({})}).strict();
automationRoutes.get('/',asyncRoute(async(req,res)=>{const {data,error}=await database().from('automation_rules').select('*').eq('workspace_id',workspace(req).id);assert(!error,503,'Rules unavailable');res.json(data)}));
automationRoutes.post('/',needSpace('editor'),asyncRoute(async(req,res)=>{
 const p=ruleSchema.parse(req.body),db=database(),wid=workspace(req).id;
 if(p.source_account_id){const r=await db.from('social_accounts').select('id').eq('id',p.source_account_id).eq('workspace_id',wid).maybeSingle();assert(!r.error&&r.data,400,'Invalid source account');}
 const {data,error}=await db.from('automation_rules').insert({...p,workspace_id:wid,is_enabled:false}).select().single();assert(!error,503,'Unable to save rule');res.status(201).json({...data,note:'Rules are saved disabled until background source-sync integration is verified and explicitly enabled.'});
}));
automationRoutes.patch('/:id',needSpace('editor'),asyncRoute(async(req,res)=>{
 const p=z.object({is_enabled:z.boolean().optional(),title:z.string().trim().min(3).max(100).optional(),require_approval:z.boolean().optional()}).strict().parse(req.body);
 // An unverified rule must not be activated through a UI toggle.
 assert(p.is_enabled!==true,409,'Automatic discovery is not yet enabled for this rule; live API verification is required');
 const {data,error}=await database().from('automation_rules').update(p).eq('id',uuid.parse(req.params.id)).eq('workspace_id',workspace(req).id).select().maybeSingle();assert(!error,503,'Rule update unavailable');assert(data,404,'Rule missing');res.json(data);
}));
