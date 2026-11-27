import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {env} from '../config.ts';
import {requireAuth,needSpace,actor,workspace,uuid} from '../middleware/auth.ts';
import {MAX_MEDIA_BYTES,mediaExpires} from '../../../../packages/core/src/domain.ts';
export const mediaRoutes=Router({mergeParams:true});
mediaRoutes.use(requireAuth,needSpace());
const allowed:Record<string,'image'|'video'>={'image/jpeg':'image','image/png':'image','image/webp':'image','video/mp4':'video','video/quicktime':'video','video/webm':'video'};
mediaRoutes.get('/',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('media_assets').select('id,kind,mime_type,bytes,status,expires_at,created_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false}).limit(100);assert(!error,503,'Media unavailable');res.json(data);
}));
mediaRoutes.post('/request-upload',needSpace('editor'),asyncRoute(async(req,res)=>{
 const p=z.object({mimeType:z.string(),bytes:z.number().int().positive().max(MAX_MEDIA_BYTES),filename:z.string().trim().min(1).max(140)}).strict().parse(req.body);
 const kind=allowed[p.mimeType];assert(kind,400,'Unsupported media type. Allowed: JPEG, PNG, WebP images and MP4, MOV, WebM videos.','UNSUPPORTED_MEDIA_TYPE');
 const db=database(),wid=workspace(req).id,ext=p.mimeType.split('/')[1].replace('jpeg','jpg').replace('quicktime','mov');
 const id=crypto.randomUUID(),path=`${wid}/${id}.${ext}`,expiresAt=mediaExpires(new Date());
 const result=await db.storage.from(env.SUPABASE_MEDIA_BUCKET).createSignedUploadUrl(path,{upsert:false});
 assert(!result.error&&result.data,503,'Storage is unavailable; check private bucket settings');
 const {error}=await db.from('media_assets').insert({id,workspace_id:wid,owner_id:actor(req).id,storage_path:path,bucket:env.SUPABASE_MEDIA_BUCKET,kind,mime_type:p.mimeType,bytes:p.bytes,expires_at:expiresAt});
 if(error){await db.storage.from(env.SUPABASE_MEDIA_BUCKET).remove([path]);throw new Error('Could not register media');}
 res.status(201).json({id,uploadToken:result.data.token,path,expiresAt,expectedBytes:p.bytes});
}));
mediaRoutes.post('/:id/complete',needSpace('editor'),asyncRoute(async(req,res)=>{
 const db=database(),wid=workspace(req).id,id=uuid.parse(req.params.id);
 const {data:asset,error}=await db.from('media_assets').select('id,storage_path,bucket,bytes,mime_type,status,expires_at').eq('id',id).eq('workspace_id',wid).maybeSingle();assert(!error&&asset,404,'Media record missing');
 assert(asset.status==='pending',409,'Media already finalized');assert(Date.parse(asset.expires_at)>Date.now(),410,'Media expired');
 // List storage object metadata server-side: never trust the client-reported upload result.
 const dir=asset.storage_path.slice(0,asset.storage_path.lastIndexOf('/'));
 const listing=await db.storage.from(asset.bucket).list(dir,{search:asset.storage_path.split('/').at(-1),limit:5});
 assert(!listing.error&&listing.data,503,'Cannot verify media');
 const object=listing.data.find((x:any)=>x.name===asset.storage_path.split('/').at(-1));
 assert(object,409,'Upload not found in private storage');
 const realSize=Number(object.metadata?.size||0);assert(realSize>0&&realSize<=104857600&&realSize===asset.bytes,400,'Uploaded size does not match authorized size');
 const {data:updated,error:e2}=await db.from('media_assets').update({status:'verified'}).eq('id',id).eq('workspace_id',wid).eq('status','pending').select('id,expires_at,status').maybeSingle();
 assert(!e2&&updated,503,'Unable to finalize media');res.json(updated);
}));
