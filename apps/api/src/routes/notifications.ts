import {Router} from 'express';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,actor,uuid} from '../middleware/auth.ts';
export const notificationsRoutes=Router();
notificationsRoutes.use(requireAuth);
notificationsRoutes.get('/',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('notifications').select('id,title,body,type,read_at,created_at').eq('user_id',actor(req).id).order('created_at',{ascending:false}).limit(50);assert(!error,503,'Notifications unavailable');res.json(data);
}));
notificationsRoutes.post('/:id/read',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('notifications').update({read_at:new Date().toISOString()}).eq('id',uuid.parse(req.params.id)).eq('user_id',actor(req).id).select('id,read_at').maybeSingle();assert(!error,503,'Notification could not be updated');assert(data,404,'Notification not found');res.json(data);
}));
