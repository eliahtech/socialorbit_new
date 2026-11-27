import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {asyncRoute,assert} from '../http.ts';
import {requireAuth,needSpace,actor,workspace,uuid} from '../middleware/auth.ts';
export const workspacesRoutes=Router();
const newSpace=z.object({name:z.string().trim().min(2).max(100)}).strict();
workspacesRoutes.get('/',requireAuth,asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('workspace_members').select('role,workspace:workspaces(id,name,slug,created_at)').eq('user_id',actor(req).id);
 assert(!error,503,'Unable to load workspaces');res.json(data);
}));
workspacesRoutes.post('/',requireAuth,asyncRoute(async(req,res)=>{
 const {name}=newSpace.parse(req.body);const db=database(),user=actor(req);
 const slugBase=name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,38)||'workspace';
 const {data,error}=await db.from('workspaces').insert({name,owner_id:user.id,slug:`${slugBase}-${crypto.randomUUID().slice(0,8)}`}).select('id,name,slug').single();
 assert(!error,503,'Workspace could not be created');res.status(201).json(data);
}));
workspacesRoutes.get('/:workspaceId/overview',requireAuth,needSpace(),asyncRoute(async(req,res)=>{
 const db=database(),wid=workspace(req).id;
 const [content,accounts,jobs,tickets,wallets,sub]=await Promise.all([
  db.from('content_items').select('id,status').eq('workspace_id',wid),
  db.from('social_accounts').select('id,status').eq('workspace_id',wid),
  db.from('publishing_jobs').select('id,status').eq('workspace_id',wid),
  db.from('support_tickets').select('id,status').eq('workspace_id',wid),
  db.from('credit_wallets').select('kind,monthly_balance,topup_balance,reserved').eq('workspace_id',wid),
  db.from('subscriptions').select('plan_key,status,current_period_end').eq('workspace_id',wid).single()
 ]);
 for(const r of [content,accounts,jobs,tickets,wallets,sub])assert(!r.error,503,'Workspace overview unavailable');
 const count=(items:any[],st:string)=>items.filter(x=>x.status===st).length;
 res.json({contentTotal:content.data!.length,drafts:count(content.data!,'draft'),connectedAccounts:count(accounts.data!,'connected'),jobs:jobs.data!.length,published:count(jobs.data!,'published'),failed:count(jobs.data!,'failed'),openTickets:count(tickets.data!,'open'),credits:wallets.data,subscription:sub.data});
}));
workspacesRoutes.get('/:workspaceId/members',requireAuth,needSpace('viewer'),asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('workspace_members').select('user_id,role,joined_at').eq('workspace_id',workspace(req).id);assert(!error,503,'Members unavailable');res.json(data);
}));
workspacesRoutes.post('/:workspaceId/members',requireAuth,needSpace('admin'),asyncRoute(async(req,res)=>{
 const p=z.object({userId:uuid,role:z.enum(['admin','editor','analyst','viewer'])}).strict().parse(req.body);
 const db=database(),wid=workspace(req).id;
 const current=await db.from('workspace_members').select('role').eq('workspace_id',wid).eq('user_id',p.userId).maybeSingle();
 assert(!current.error,503,'Cannot inspect membership');
 assert(current.data?.role!=='owner',403,'Workspace owner role cannot be changed by member management');
 assert(workspace(req).role==='owner'||p.role!=='admin',403,'Only the workspace owner may grant admin access');
 const {data,error}=await db.from('workspace_members').upsert({workspace_id:wid,user_id:p.userId,role:p.role},{onConflict:'workspace_id,user_id'}).select('user_id,role').single();assert(!error,400,'Unable to assign member');res.status(201).json(data);
}));
