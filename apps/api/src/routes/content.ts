import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,actor,workspace,uuid} from '../middleware/auth.ts';
import {normalizeLink} from '../../../../packages/core/src/domain.ts';
export const contentRoutes=Router({mergeParams:true});
// Empty string clears the link; anything else must be a plain https:// URL (no credentials).
const linkField=z.string().trim().max(2048).transform((v,ctx)=>{if(v==='')return null;const n=normalizeLink(v);if(!n){ctx.addIssue({code:z.ZodIssueCode.custom,message:'Link must be a valid https:// URL'});return z.NEVER}return n}).nullable().optional();
const body=z.object({title:z.string().trim().min(1).max(160),body:z.string().max(20000),kind:z.enum(['text','image','video']).default('text'),link_url:linkField,visibility:z.enum(['private','unlisted','public']).nullable().optional()}).strict();
contentRoutes.use(requireAuth,needSpace());
contentRoutes.get('/',asyncRoute(async(req,res)=>{
 const q=z.object({search:z.string().max(100).optional(),status:z.string().max(40).optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query);
 let builder=database().from('content_items').select('id,title,body,kind,link_url,visibility,source_url,status,is_historical,created_at,updated_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false}).limit(q.limit);
 if(q.status)builder=builder.eq('status',q.status);if(q.search)builder=builder.ilike('title',`%${q.search.replace(/[%_]/g,'')}%`);
 const {data,error}=await builder;assert(!error,503,'Unable to list content');res.json(data);
}));
contentRoutes.post('/',needSpace('editor'),asyncRoute(async(req,res)=>{
 const p=body.parse(req.body);const {data,error}=await database().from('content_items').insert({...p,workspace_id:workspace(req).id,created_by:actor(req).id}).select().single();
 assert(!error,503,'Unable to create content');res.status(201).json(data);
}));
contentRoutes.patch('/:id',needSpace('editor'),asyncRoute(async(req,res)=>{
 const p=body.partial().strict().parse(req.body);assert(Object.keys(p).length>0,400,'No changes supplied');
 const {data,error}=await database().from('content_items').update({...p,updated_at:new Date().toISOString()}).eq('workspace_id',workspace(req).id).eq('id',uuid.parse(req.params.id)).in('status',['draft','awaiting_approval']).select().maybeSingle();
 assert(!error,503,'Unable to update content');assert(data,404,'Content is missing or cannot be edited');res.json(data);
}));
contentRoutes.delete('/:id',needSpace('editor'),asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('content_items').delete().eq('workspace_id',workspace(req).id).eq('id',uuid.parse(req.params.id)).in('status',['draft','awaiting_approval']).select('id').maybeSingle();
 assert(!error,503,'Unable to delete content');assert(data,404,'Content missing or not deletable');res.json({deleted:true});
}));
