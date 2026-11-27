import type {Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {env} from '../config.ts';
export const uuid=z.string().uuid();
export type Actor={id:string;email:string};
export type Space={id:string;role:'owner'|'admin'|'editor'|'analyst'|'viewer'};
declare global{namespace Express{interface Request{actor?:Actor;space?:Space;adminRole?:string;aal?:string}}}
// The token was already verified by Supabase (getUser); we only read the assurance level claim from it.
function assuranceLevel(token:string){try{return String(JSON.parse(Buffer.from(token.split('.')[1]||'','base64url').toString()).aal||'')}catch{return ''}}
export const requireAuth=asyncRoute(async(req:Request,_res:Response,next:NextFunction)=>{
  const header=req.headers.authorization||'';assert(header.startsWith('Bearer '),401,'Sign in required','UNAUTHENTICATED');
  const token=header.slice(7).trim();assert(token.length>30,401,'Invalid session');
  const {data,error}=await database().auth.getUser(token);
  assert(!error&&data.user,401,'Session expired or invalid','INVALID_SESSION');
  const profile=await database().from('profiles').select('status').eq('id',data.user.id).maybeSingle();assert(!profile.error,503,'Account status unavailable');assert(profile.data?.status!=='suspended',403,'Account suspended; contact support','ACCOUNT_SUSPENDED');req.actor={id:data.user.id,email:data.user.email||''};req.aal=assuranceLevel(token);next();
});
const hierarchy:Record<Space['role'],number>={owner:5,admin:4,editor:3,analyst:2,viewer:1};
export function needSpace(minimum:Space['role']='viewer'){
 return asyncRoute(async(req:Request,_res:Response,next:NextFunction)=>{
  assert(req.actor,401,'Sign in required');const id=uuid.parse(req.params.workspaceId||req.headers['x-workspace-id']);
  const {data,error}=await database().from('workspace_members').select('role').eq('workspace_id',id).eq('user_id',req.actor.id).maybeSingle();
  assert(!error,503,'Membership lookup unavailable');
  assert(data,403,'Workspace access denied','WORKSPACE_FORBIDDEN');
  const role=data.role as Space['role'];assert(hierarchy[role]>=hierarchy[minimum],403,'Insufficient workspace privileges','ROLE_FORBIDDEN');
  req.space={id,role};next();
 });
}
const adminRanks:Record<string,number>={super_admin:6,operations:5,billing:4,support:3,moderator:2,analyst:1};
export function needAdmin(allowedRoles:string[]=['super_admin']){
 return asyncRoute(async(req:Request,_res:Response,next:NextFunction)=>{
  assert(req.actor,401,'Sign in required');const {data,error}=await database().from('admin_roles').select('role').eq('user_id',req.actor.id).maybeSingle();
  assert(!error,503,'Admin role lookup unavailable');assert(data&&allowedRoles.includes(data.role),403,'Admin access denied','ADMIN_FORBIDDEN');
  assert(!env.ADMIN_REQUIRE_MFA||req.aal==='aal2',403,'Two-factor authentication is required for administrators','ADMIN_MFA_REQUIRED');
  req.adminRole=data.role;next();
 });
}
export function actor(req:Request){assert(req.actor,401,'Sign in required');return req.actor;}
export function workspace(req:Request){assert(req.space,403,'Workspace access denied');return req.space;}
