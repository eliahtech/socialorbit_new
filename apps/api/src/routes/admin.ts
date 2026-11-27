import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needAdmin,actor,uuid} from '../middleware/auth.ts';
export const adminRoutes=Router();
adminRoutes.use(requireAuth,needAdmin(['super_admin','operations','billing','support','moderator','analyst']));
adminRoutes.get('/overview',asyncRoute(async(req,res)=>{
 const db=database();const [w,j,p,a,s]=await Promise.all([
  db.from('workspaces').select('id', {count:'exact',head:true}),
  db.from('publishing_jobs').select('id,status').order('created_at',{ascending:false}).limit(300),
  db.from('payments').select('id,status,currency,amount_minor').order('created_at',{ascending:false}).limit(300),
  db.from('ai_requests').select('id,status').order('created_at',{ascending:false}).limit(300),
  db.from('support_tickets').select('id,status').order('created_at',{ascending:false}).limit(300)
 ]);
 for(const r of [w,j,p,a,s])assert(!r.error,503,'Admin overview unavailable');
 res.json({workspaces:w.count,publishing:{published:j.data?.filter(x=>x.status==='published').length,failed:j.data?.filter(x=>x.status==='failed').length,pending:j.data?.filter(x=>x.status==='scheduled').length},revenue:(p.data||[]).filter(x=>x.status==='verified').reduce((t:Record<string,number>,x)=>{t[x.currency]=(t[x.currency]||0)+x.amount_minor/100;return t},{}),aiRequests:a.data?.length,openTickets:s.data?.filter(x=>x.status==='open').length,note:'Counts for job/payment/AI/ticket data are bounded to 300 recent records; revenue shown is a recent-record subtotal, not an all-time total.'});
}));
adminRoutes.get('/tickets',needAdmin(['super_admin','operations','support']),asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('support_tickets').select('id,workspace_id,user_id,subject,category,priority,status,created_at').order('created_at',{ascending:false}).limit(100);
 assert(!error,503,'Admin support unavailable');res.json(data);
}));
adminRoutes.patch('/tickets/:id',needAdmin(['super_admin','operations','support']),asyncRoute(async(req,res)=>{
 const p=z.object({status:z.enum(['open','in_progress','under_review','resolved','closed']).optional(),assigned_to:uuid.nullable().optional()}).strict().parse(req.body);
 assert(Object.keys(p).length>0,400,'Nothing to update');const db=database();
 const {data,error}=await db.from('support_tickets').update({...p,updated_at:new Date().toISOString()}).eq('id',uuid.parse(req.params.id)).select().maybeSingle();assert(!error&&data,404,'Ticket not found');
 await db.from('audit_logs').insert({actor_id:actor(req).id,workspace_id:data.workspace_id,action:'ticket.update',object_id:data.id,details:p});res.json(data);
}));
adminRoutes.get('/plans',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('plans').select('*').order('price_kes');assert(!error,503,'Plans unavailable');res.json(data);
}));
adminRoutes.patch('/plans/:key',needAdmin(['super_admin']),asyncRoute(async(req,res)=>{
 const p=z.object({price_kes:z.number().int().min(0).max(1000000).optional(),price_usd_cents:z.number().int().min(0).max(10000000).optional(),accounts:z.number().int().min(1).max(10000).optional(),text_credits:z.number().int().min(0).max(1000000).optional(),image_credits:z.number().int().min(0).max(100000).optional(),publishing_jobs:z.number().int().min(0).max(1000000).optional(),old_videos:z.number().int().min(0).max(1000000).optional(),evergreen_rules:z.number().int().min(0).max(100000).optional(),inbox_threads:z.number().int().min(0).max(1000000).optional(),analytics_days:z.number().int().min(1).max(3650).optional()}).strict().parse(req.body);
 assert(Object.keys(p).length>0,400,'No changes supplied');const key=z.enum(['free','creator','pro','agency']).parse(req.params.key);
 const db=database();const {data,error}=await db.from('plans').update({...p,updated_at:new Date().toISOString()}).eq('key',key).select().single();assert(!error,503,'Plan update failed');
 await db.from('audit_logs').insert({actor_id:actor(req).id,action:'plan.update',object_id:key,details:p});res.json(data);
}));
adminRoutes.get('/jobs',needAdmin(['super_admin','operations','analyst']),asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('publishing_jobs').select('id,workspace_id,status,scheduled_at,error_code,error_message,created_at').order('created_at',{ascending:false}).limit(100);
 assert(!error,503,'Jobs unavailable');res.json(data);
}));
adminRoutes.post('/publishing-pause',needAdmin(['super_admin']),asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('feature_flags').upsert({key:'global_publishing_paused',enabled:true,description:'Emergency pause'}, {onConflict:'key'}).select().single();
 assert(!error,503,'Pause request failed');await database().from('audit_logs').insert({actor_id:actor(req).id,action:'publishing.emergency_pause'});res.json({paused:true});
}));

adminRoutes.get('/users',needAdmin(['super_admin','operations','support']),asyncRoute(async(_req,res)=>{
 const {data,error}=await database().from('profiles').select('id,display_name,username,status,created_at').order('created_at',{ascending:false}).limit(100);
 assert(!error,503,'Users unavailable');res.json(data);
}));
adminRoutes.patch('/users/:id/status',needAdmin(['super_admin']),asyncRoute(async(req,res)=>{
 const target=uuid.parse(req.params.id),p=z.object({status:z.enum(['active','suspended'])}).strict().parse(req.body);
 assert(target!==actor(req).id,409,'You cannot suspend your own administrator account');const db=database();
 const {data,error}=await db.from('profiles').update({status:p.status,updated_at:new Date().toISOString()}).eq('id',target).select('id,status').maybeSingle();
 assert(!error&&data,404,'User not found');
 await db.from('audit_logs').insert({actor_id:actor(req).id,action:'user.status_change',object_id:target,details:{newStatus:p.status}});
 res.json(data);
}));
adminRoutes.get('/workspaces',needAdmin(['super_admin','operations','analyst']),asyncRoute(async(_req,res)=>{
 const {data,error}=await database().from('workspaces').select('id,name,slug,owner_id,created_at').order('created_at',{ascending:false}).limit(100);
 assert(!error,503,'Workspaces unavailable');res.json(data);
}));
adminRoutes.post('/tickets/:id/messages',needAdmin(['super_admin','operations','support']),asyncRoute(async(req,res)=>{
 const p=z.object({body:z.string().trim().min(1).max(5000),internal:z.boolean().default(false)}).strict().parse(req.body);
 const db=database(),id=uuid.parse(req.params.id);const ticket=await db.from('support_tickets').select('id,user_id,workspace_id,status').eq('id',id).maybeSingle();assert(!ticket.error&&ticket.data,404,'Ticket not found');
 const {data,error}=await db.from('ticket_messages').insert({ticket_id:id,sender_id:actor(req).id,body:p.body,internal:p.internal}).select('id,body,internal,created_at').single();assert(!error&&data,503,'Reply failed');
 if(!p.internal)await db.from('notifications').insert({user_id:ticket.data.user_id,workspace_id:ticket.data.workspace_id,title:'Support reply',body:'Your support ticket has a new response',type:'support'});
 await db.from('audit_logs').insert({actor_id:actor(req).id,workspace_id:ticket.data.workspace_id,action:'ticket.reply',object_id:id,details:{internal:p.internal}});
 res.status(201).json(data);
}));
adminRoutes.get('/features',needAdmin(['super_admin','operations','support']),asyncRoute(async(_req,res)=>{
 const {data,error}=await database().from('feature_requests').select('id,title,status,workspace_id,created_at').order('created_at',{ascending:false}).limit(100);
 assert(!error,503,'Feature requests unavailable');res.json(data);
}));
adminRoutes.patch('/features/:id',needAdmin(['super_admin','operations']),asyncRoute(async(req,res)=>{
 const p=z.object({status:z.enum(['under_review','planned','in_development','released','declined'])}).strict().parse(req.body),id=uuid.parse(req.params.id);
 const db=database(),r=await db.from('feature_requests').update(p).eq('id',id).select('id,workspace_id,status').maybeSingle();assert(!r.error&&r.data,404,'Feature not found');
 await db.from('audit_logs').insert({actor_id:actor(req).id,workspace_id:r.data.workspace_id,action:'feature.status_change',object_id:id,details:p});res.json(r.data);
}));
