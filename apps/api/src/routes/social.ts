import {Router} from 'express';
import {database} from '../db.ts';
import {assert,asyncRoute,ApiError,safeRedirectMessage} from '../http.ts';
import {requireAuth,needSpace,workspace,uuid,actor} from '../middleware/auth.ts';
import {env} from '../config.ts';
import {oauthProvider,exchangeCode,discoverIdentities} from '../services/social.ts';
import {requireEncryptionKey,encryptToken,decryptToken,signedState,verifyState} from '../../../../packages/core/src/security.ts';
import {pkcePair,nonce,buildAuthorizationUrl} from '../../../../packages/core/src/oauth.ts';
export const socialRoutes=Router({mergeParams:true});
export const oauthCallbackRoutes=Router();
// A plain Error here would surface as an opaque "Internal server error"; report the actual configuration problem instead.
function encryptionKey(){
 try{return requireEncryptionKey(env.ENCRYPTION_KEY_HEX)}
 catch{throw new ApiError(503,'The server encryption key is missing or invalid. Set ENCRYPTION_KEY_HEX to exactly 64 hexadecimal characters in the Vercel environment variables, then redeploy.','ENCRYPTION_KEY_INVALID')}
}
socialRoutes.use(requireAuth,needSpace());
socialRoutes.get('/',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('social_accounts').select('id,provider,display_name,status,granted_scopes,last_synced_at,created_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false});
 assert(!error,503,'Social connections unavailable');res.json(data);
}));
socialRoutes.post('/oauth/:provider/start',needSpace('admin'),asyncRoute(async(req,res)=>{
 const provider=oauthProvider(String(req.params.provider)),db=database(),wid=workspace(req).id,key=encryptionKey();
 const stateNonce=nonce(),pkce=pkcePair(),verifierCipher=encryptToken(pkce.verifier,key);
 const {data,error}=await db.from('oauth_sessions').insert({workspace_id:wid,initiated_by:actor(req).id,provider:provider.name,nonce:stateNonce,verifier_ciphertext:verifierCipher}).select('id').single();assert(!error&&data,503,'OAuth authorization could not start');
 const redirectUri=`${env.PUBLIC_BASE_URL}/api/oauth/callback/${provider.name}`;
 const scopes=provider.name==='facebook'?provider.scopes.replace(/\s+/g,','):provider.scopes.replace(/,/g,' ');
 const params:Record<string,string>={client_id:provider.clientId,redirect_uri:redirectUri,response_type:'code',scope:scopes,state:signedState(data.id,stateNonce,key)};
 if(provider.name==='youtube'){params.access_type='offline';params.prompt='consent';params.code_challenge=pkce.challenge;params.code_challenge_method='S256';}
 if(provider.name==='linkedin'){params.code_challenge=pkce.challenge;params.code_challenge_method='S256';}
 res.json({authorizationUrl:buildAuthorizationUrl(provider.details.authorize,params),expiresInSeconds:600});
}));
socialRoutes.post('/:id/disconnect',needSpace('admin'),asyncRoute(async(req,res)=>{
 const db=database(),wid=workspace(req).id,id=uuid.parse(req.params.id);
 const r=await db.from('social_accounts').update({status:'disconnected'}).eq('id',id).eq('workspace_id',wid).select('id').maybeSingle();assert(!r.error&&r.data,404,'Account not found');
 await db.from('oauth_credentials').delete().eq('account_id',id);
 await db.from('connection_events').insert({workspace_id:wid,account_id:id,event:'disconnected'});
 res.json({disconnected:true,note:'Local token deleted. You may also revoke the app from your social provider account settings.'});
}));
const oauthCallback=asyncRoute(async(req,res)=>{
 const p=oauthProvider(String(req.params.provider)),key=encryptionKey();
 const state=String(req.query.state||''),code=String(req.query.code||'');
 assert(code.length>5&&state.length>30&&verifyState(state,key),400,'OAuth state is invalid');
 const seg=state.split('.');assert(seg.length===3,400,'Invalid OAuth state');
 const [id,n]=seg,db=database();uuid.parse(id);
 const {data:session,error}=await db.from('oauth_sessions').select('*').eq('id',id).eq('provider',p.name).eq('nonce',n).is('consumed_at',null).maybeSingle();
 assert(!error&&session&&Date.parse(session.expires_at)>Date.now(),401,'OAuth session expired');
 // An authorization begun by a now-removed or demoted workspace admin must not connect new accounts.
 const currentMember=await db.from('workspace_members').select('role').eq('workspace_id',session.workspace_id).eq('user_id',session.initiated_by).maybeSingle();
 assert(!currentMember.error&&currentMember.data&&['owner','admin'].includes(currentMember.data.role),403,'OAuth initiator no longer has account-management permission');
 // Atomic consumption prevents callback replay.
 const consumed=await db.from('oauth_sessions').update({consumed_at:new Date().toISOString()}).eq('id',id).is('consumed_at',null).select('id').maybeSingle();assert(!consumed.error&&consumed.data,401,'OAuth callback already consumed');
 const verifier=session.verifier_ciphertext?decryptToken(session.verifier_ciphertext,key):undefined;
 const token=await exchangeCode(p,code,`${env.PUBLIC_BASE_URL}/api/oauth/callback/${p.name}`,verifier);
 const identities=await discoverIdentities(p.name,token.access_token);
 assert(identities.length,403,'No authorized Page, Channel or member identity was returned');
 const sub=await db.from('subscriptions').select('plan_key,status').eq('workspace_id',session.workspace_id).single();
 assert(!sub.error&&sub.data,403,'Workspace subscription unavailable');
 const plans=await db.from('plans').select('accounts').eq('key',sub.data.status==='active'?sub.data.plan_key:'free').single();
 assert(!plans.error&&plans.data,503,'Social account plan limit unavailable');
 const existingAccounts=await db.from('social_accounts').select('provider,provider_account_id').eq('workspace_id',session.workspace_id).eq('status','connected');
 assert(!existingAccounts.error,503,'Account quota lookup unavailable');
 let available=Math.max(0,plans.data.accounts-(existingAccounts.data||[]).length);
 let count=0;
 for(const item of identities){
  const isExisting=(existingAccounts.data||[]).some(x=>x.provider===p.name&&x.provider_account_id===item.id);
  if(!isExisting&&available<=0)continue;
  if(!isExisting)available--;
  const inserted=await db.from('social_accounts').upsert({workspace_id:session.workspace_id,provider:p.name,provider_account_id:item.id,display_name:item.name,status:'connected',granted_scopes:(token.scope||p.scopes).split(/[ ,]+/).filter(Boolean)},{onConflict:'workspace_id,provider,provider_account_id'}).select('id').single();
  if(inserted.error||!inserted.data)continue;
  const creds=await db.from('oauth_credentials').upsert({account_id:inserted.data.id,access_token_ciphertext:encryptToken(item.accessToken,key),refresh_token_ciphertext:token.refresh_token?encryptToken(token.refresh_token,key):null,expires_at:token.expires_in?new Date(Date.now()+token.expires_in*1000).toISOString():null},{onConflict:'account_id'});
  if(!creds.error)count++;
 }
 assert(count>0,502,'Could not save authorized social connections');
 res.redirect(303,`/app.html?oauth=connected&count=${count}#accounts`);
});
oauthCallbackRoutes.get('/:provider',(req,res,next)=>{
 const back=(message:string)=>res.redirect(303,`/app.html?oauth=error&message=${safeRedirectMessage(message)}#accounts`);
 if(req.query.error)return back('The connection was cancelled or denied by the provider.');
 oauthCallback(req,res,(err?:unknown)=>{
  if(!err)return next();
  if(err instanceof ApiError)return back(err.message);
  console.error('OAuth callback failed',err instanceof Error?err.message:'unknown');
  back('The connection could not be completed. Please try again.');
 });
});
