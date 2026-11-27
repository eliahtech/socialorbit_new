import {Router} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {asyncRoute,assert} from '../http.ts';
import {env} from '../config.ts';
import {cleanupExpiredMedia,enforcePeriodExpiry,publishDueDirect} from '../services/maintenance.ts';
export const cronRoutes=Router();
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the CRON_SECRET environment variable is set.
cronRoutes.use((req,_res,next)=>{
 assert(env.CRON_SECRET.length>=16,503,'Cron is not configured (set CRON_SECRET, 16+ characters)','CRON_NOT_CONFIGURED');
 const given=Buffer.from(String(req.headers.authorization||'')),want=Buffer.from(`Bearer ${env.CRON_SECRET}`);
 assert(given.length===want.length&&timingSafeEqual(given,want),401,'Unauthorized','UNAUTHORIZED');next();
});
cronRoutes.get('/maintenance',asyncRoute(async(_req,res)=>{
 await cleanupExpiredMedia();await enforcePeriodExpiry();res.json({ok:true,ran:['cleanupExpiredMedia','enforcePeriodExpiry']});
}));
cronRoutes.get('/publish-due',asyncRoute(async(_req,res)=>{
 assert(env.PUBLISH_VIA_CRON,409,'Set PUBLISH_VIA_CRON=true to publish from cron instead of the worker','CRON_PUBLISH_DISABLED');
 res.json({ok:true,...await publishDueDirect()});
}));
