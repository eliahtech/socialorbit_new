import {ApiError,assert} from '../http.ts';
import type {Provider} from '../../../../packages/core/src/domain.ts';
export type SupportedOAuth='facebook'|'youtube'|'linkedin';
export function oauthProvider(name:string){
 const clientKey=name==='youtube'?'GOOGLE':name.toUpperCase();
 const clientId=process.env[`${clientKey}_CLIENT_ID`],secret=process.env[`${clientKey}_CLIENT_SECRET`];
 const scopes=process.env[`${clientKey}_SCOPES`]||'';
 const details:Record<SupportedOAuth,{authorize:string;token:string;scopeSeparator:string}>={
  facebook:{authorize:'https://www.facebook.com/v27.0/dialog/oauth',token:'https://graph.facebook.com/v27.0/oauth/access_token',scopeSeparator:','},
  youtube:{authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scopeSeparator:' '},
  linkedin:{authorize:'https://www.linkedin.com/oauth/v2/authorization',token:'https://www.linkedin.com/oauth/v2/accessToken',scopeSeparator:' '}
 };
 assert(name==='facebook'||name==='youtube'||name==='linkedin',501,'Provider OAuth adapter not verified for this platform');
 assert(clientId&&secret&&scopes,503,`Configure approved ${name} OAuth credentials and scopes`);
 return {name:name as SupportedOAuth,clientId,secret,scopes,details:details[name as SupportedOAuth]};
}
async function getJson(url:string,accessToken:string){
 const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),15000);
 try{const r=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:ctl.signal});if(!r.ok)throw new ApiError(502,'Social provider did not authorize account discovery');return await r.json() as any;}finally{clearTimeout(timer)}
}
export type SocialIdentity={id:string;name:string;accessToken:string};
export async function discoverIdentities(provider:SupportedOAuth,accessToken:string):Promise<SocialIdentity[]>{
 if(provider==='facebook'){
  // Page-scoped tokens, not a personal profile publishing permission.
  const data=await getJson('https://graph.facebook.com/v27.0/me/accounts?fields=id,name,access_token&limit=100',accessToken);
  return (data.data||[]).filter((x:any)=>x.id&&x.access_token).map((x:any)=>({id:String(x.id),name:String(x.name||'Facebook Page'),accessToken:String(x.access_token)}));
 }
 if(provider==='youtube'){
  const data=await getJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',accessToken);
  return (data.items||[]).filter((x:any)=>x.id).map((x:any)=>({id:String(x.id),name:String(x.snippet?.title||'YouTube Channel'),accessToken}));
 }
 const data=await getJson('https://api.linkedin.com/v2/userinfo',accessToken);
 return data.sub?[{id:String(data.sub),name:String(data.name||'LinkedIn Member'),accessToken}]:[];
}
export async function exchangeCode(provider:ReturnType<typeof oauthProvider>,code:string,redirectUri:string,verifier?:string){
 const params=new URLSearchParams({client_id:provider.clientId,client_secret:provider.secret,redirect_uri:redirectUri,code,grant_type:'authorization_code'});
 if(verifier)params.set('code_verifier',verifier);
 const response=await fetch(provider.details.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:params.toString(),signal:AbortSignal.timeout(20000)});
 const result=await response.json() as any;
 assert(response.ok&&result.access_token,502,'Provider token exchange failed');
 return {access_token:String(result.access_token),refresh_token:result.refresh_token?String(result.refresh_token):null,expires_in:Number(result.expires_in||0),scope:typeof result.scope==='string'?result.scope:null};
}
