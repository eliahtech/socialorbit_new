import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,actor,workspace,uuid} from '../middleware/auth.ts';
export const supportRoutes=Router({mergeParams:true});
supportRoutes.use(requireAuth,needSpace());
const ticketSchema=z.object({subject:z.string().trim().min(3).max(160),category:z.enum(['bug','technical','feature','improvement','billing','other']),description:z.string().trim().min(10).max(5000),priority:z.enum(['low','normal','high']).default('normal')});
supportRoutes.get('/tickets',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('support_tickets').select('id,subject,category,description,priority,status,created_at,updated_at').eq('workspace_id',workspace(req).id).eq('user_id',actor(req).id).order('created_at',{ascending:false}).limit(100);
 assert(!error,503,'Tickets unavailable');res.json(data);
}));
supportRoutes.post('/tickets',asyncRoute(async(req,res)=>{
 const p=ticketSchema.parse(req.body),a=actor(req);const {data,error}=await database().from('support_tickets').insert({...p,user_id:a.id,workspace_id:workspace(req).id}).select().single();
 assert(!error,503,'Ticket could not be created');res.status(201).json(data);
}));
supportRoutes.get('/tickets/:id/messages',asyncRoute(async(req,res)=>{
 const db=database(),id=uuid.parse(req.params.id);const ticket=await db.from('support_tickets').select('id').eq('id',id).eq('workspace_id',workspace(req).id).eq('user_id',actor(req).id).maybeSingle();assert(!ticket.error&&ticket.data,404,'Ticket not found');
 const {data,error}=await db.from('ticket_messages').select('id,sender_id,body,created_at').eq('ticket_id',id).eq('internal',false).order('created_at');assert(!error,503,'Ticket replies unavailable');res.json(data);
}));
supportRoutes.post('/tickets/:id/messages',asyncRoute(async(req,res)=>{
 const p=z.object({body:z.string().trim().min(1).max(5000)}).parse(req.body),id=uuid.parse(req.params.id),db=database();
 const ticket=await db.from('support_tickets').select('id,status').eq('id',id).eq('workspace_id',workspace(req).id).eq('user_id',actor(req).id).maybeSingle();assert(!ticket.error&&ticket.data,404,'Ticket not found');assert(ticket.data.status!=='closed',409,'Ticket is closed');
 const {data,error}=await db.from('ticket_messages').insert({ticket_id:id,body:p.body,sender_id:actor(req).id}).select().single();assert(!error,503,'Reply could not be posted');res.status(201).json(data);
}));
supportRoutes.get('/features',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('feature_requests').select('id,title,description,status,created_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false});assert(!error,503,'Feature board unavailable');res.json(data);
}));
supportRoutes.post('/features',asyncRoute(async(req,res)=>{
 const p=z.object({title:z.string().trim().min(4).max(160),description:z.string().trim().min(10).max(5000)}).parse(req.body);
 const {data,error}=await database().from('feature_requests').insert({...p,workspace_id:workspace(req).id,created_by:actor(req).id}).select().single();assert(!error,503,'Feature request could not be submitted');res.status(201).json(data);
}));
supportRoutes.post('/features/:id/vote',asyncRoute(async(req,res)=>{
 const db=database(),id=uuid.parse(req.params.id);const {data:feature,error:e}=await db.from('feature_requests').select('id').eq('id',id).eq('workspace_id',workspace(req).id).maybeSingle();assert(!e&&feature,404,'Feature request not found');
 const {error}=await db.from('feature_votes').upsert({feature_id:id,user_id:actor(req).id},{onConflict:'feature_id,user_id'});assert(!error,503,'Could not register vote');res.json({voted:true});
}));
