import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,actor,workspace} from '../middleware/auth.ts';
import {generateAI} from '../services/ai.ts';
export const aiRoutes=Router({mergeParams:true});
aiRoutes.use(requireAuth,needSpace());
const task=z.object({task:z.enum(['caption','rewrite','hashtags','translate']),prompt:z.string().trim().min(10).max(5000),platform:z.enum(['facebook','instagram','youtube','tiktok','x','linkedin']).optional(),language:z.enum(['en','sw']).optional()}).strict();
aiRoutes.post('/text',needSpace('editor'),asyncRoute(async(req,res)=>{
 const input=task.parse(req.body),db=database(),wid=workspace(req).id,user=actor(req);
 const idempotency=`ai:text:${user.id}:${crypto.randomUUID()}`;
 const reserved=await db.rpc('credit_reserve',{p_workspace:wid,p_kind:'text',p_units:1,p_key:idempotency,p_reason:input.task});
 assert(!reserved.error&&reserved.data,402,'Text AI credits exhausted or unavailable','CREDITS_REQUIRED');
 const tx=reserved.data;
 const reqRow=await db.from('ai_requests').insert({workspace_id:wid,user_id:user.id,kind:input.task,status:'processing',credit_tx_id:tx}).select('id').single();
 if(reqRow.error){await db.rpc('credit_release',{p_id:tx});throw Error('Could not record AI request');}
 try{
  const result=await generateAI(input);
  const charge=await db.rpc('credit_settle',{p_id:tx});assert(!charge.error,503,'Unable to settle AI credit');
  await db.from('ai_requests').update({status:'completed',provider:result.provider,model:result.model,tokens_in:result.tokensIn,tokens_out:result.tokensOut}).eq('id',reqRow.data.id);
  res.json({id:reqRow.data.id,text:result.text,model:result.model,provider:result.provider,creditsCharged:1});
 }catch(e){await db.rpc('credit_release',{p_id:tx});await db.from('ai_requests').update({status:'failed',error_message:e instanceof Error?e.message:'provider unavailable'}).eq('id',reqRow.data.id);throw e;}
}));
