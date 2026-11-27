import {Router} from 'express';
import {database} from '../db.ts';
import {configured,env,APP_VERSION} from '../config.ts';
import {paymentOptions} from '../services/payments.ts';
import {requireEncryptionKey} from '../../../../packages/core/src/security.ts';
import {asyncRoute,assert} from '../http.ts';
import {requireAuth,actor} from '../middleware/auth.ts';
export const publicRoutes=Router();
publicRoutes.get('/health',asyncRoute(async(req,res)=>{
 const out:Record<string,unknown>={status:'ok',service:'SocialOrbit API',version:APP_VERSION,databaseConfigured:configured,publishingEnabled:env.ENABLE_PUBLISHING,
  // Booleans only: never expose values.
  encryptionKeyValid:(()=>{try{requireEncryptionKey(env.ENCRYPTION_KEY_HEX);return true}catch{return false}})(),
  youtubeConfigured:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_SCOPES),
  publicBaseUrl:env.PUBLIC_BASE_URL};
 if(req.query.deep==='1'){
  let ok=false;try{const r=await database().from('plans').select('key').limit(1);ok=!r.error}catch{}
  out.database=ok?'ok':'unreachable';if(!ok){out.status='degraded';return res.status(503).json(out)}
 }
 res.json(out);
}));
publicRoutes.get('/config',(_req,res)=>res.json({supabaseUrl:configured?env.SUPABASE_URL:'',supabaseAnonKey:configured?env.SUPABASE_ANON_KEY:'',mediaBucket:env.SUPABASE_MEDIA_BUCKET,configured,mediaMaxBytes:104857600,payments:paymentOptions()}));
publicRoutes.get('/plans',asyncRoute(async(_req,res)=>{const db=database();const {data,error}=await db.from('plans').select('*').order('price_kes');assert(!error,503,'Plan catalog unavailable');res.json(data)}));
publicRoutes.get('/me',requireAuth,asyncRoute(async(req,res)=>{const a=actor(req),db=database();const {data,error}=await db.from('profiles').select('id,display_name,username,avatar_url,phone,country,timezone,language').eq('id',a.id).maybeSingle();assert(!error,503,'Profile unavailable');res.json({user:a,profile:data});}));
publicRoutes.patch('/me',requireAuth,asyncRoute(async(req,res)=>{
 const a=actor(req);const {z}=await import('zod');const p=z.object({display_name:z.string().trim().max(100).optional(),phone:z.string().max(40).nullable().optional(),country:z.string().max(80).nullable().optional(),timezone:z.string().max(60).optional(),language:z.enum(['en','sw']).optional()}).strict().parse(req.body);
 assert(Object.keys(p).length>0,400,'No changes supplied');
 const {data,error}=await database().from('profiles').update({...p,updated_at:new Date().toISOString()}).eq('id',a.id).select('id,display_name,phone,country,timezone,language').single();assert(!error,503,'Could not update profile');res.json(data);
}));
