export const PLANS = {
  free:{priceKes:0,accounts:2,oldVideos:20,publishingJobs:20,textCredits:20,imageCredits:2,evergreenRules:1,inboxThreads:20,historyDays:7},
  creator:{priceKes:499,accounts:5,oldVideos:200,publishingJobs:300,textCredits:500,imageCredits:20,evergreenRules:5,inboxThreads:200,historyDays:30},
  pro:{priceKes:1499,accounts:15,oldVideos:1000,publishingJobs:1500,textCredits:2000,imageCredits:100,evergreenRules:20,inboxThreads:1000,historyDays:90},
  agency:{priceKes:3999,accounts:50,oldVideos:5000,publishingJobs:6000,textCredits:8000,imageCredits:400,evergreenRules:100,inboxThreads:5000,historyDays:365}
} as const;
export type PlanKey=keyof typeof PLANS;
export type Provider='facebook'|'youtube'|'instagram'|'tiktok'|'x'|'linkedin';
export type MediaKind='text'|'image'|'video';
export type CreditKind='text'|'image'|'publishing'|'old_video';
export type WorkspaceRole='owner'|'admin'|'editor'|'analyst'|'viewer';
export const CREDIT_COLUMN:Record<CreditKind,keyof typeof PLANS['free']>={text:'textCredits',image:'imageCredits',publishing:'publishingJobs',old_video:'oldVideos'};
export const PROVIDERS:Provider[]=['facebook','youtube','instagram','tiktok','x','linkedin'];
// Potential product functionality is NOT equivalent to app authorization.
// The publishing adapters below must also confirm account permissions.
export const CAPABILITIES:Record<Provider,{text:boolean,image:boolean,video:boolean,discover:boolean,inbox:boolean,notes:string}>={
  facebook:{text:true,image:true,video:true,discover:true,inbox:true,notes:'Facebook Pages only; text and link posts (an existing video is shared as a link); Graph API scopes, reviews and Page token required'},
  youtube:{text:false,image:false,video:true,discover:true,inbox:false,notes:'Video upload via the YouTube Data API (needs the youtube.upload scope). Text and image posts are not available through the API.'},
  instagram:{text:false,image:true,video:true,discover:true,inbox:true,notes:'Professional account and Meta permissions required; API support varies'},
  tiktok:{text:false,image:false,video:true,discover:false,inbox:false,notes:'TikTok Content Posting API requires app approval and user permissions'},
  x:{text:true,image:true,video:true,discover:true,inbox:true,notes:'Available features and paid API tiers depend on current X access'},
  linkedin:{text:true,image:true,video:true,discover:true,inbox:false,notes:'Member/organization permissions and appropriate API access required'}
};
export function canUseProvider(provider:string,kind:MediaKind){if(!(provider in CAPABILITIES))return false;return CAPABILITIES[provider as Provider][kind]===true;}
export function validateSchedule(iso:string,now=Date.now()){const ms=Date.parse(iso);return Number.isFinite(ms)&&ms>now;}
export function mediaExpires(createdAt:string|Date){const at=new Date(createdAt).getTime();if(!Number.isFinite(at))throw Error('Invalid media time');return new Date(at+7*86400000).toISOString();}
export function mediaUsableAt(expiresAt:string,scheduledAt:string,bufferMs=0){const expiry=Date.parse(expiresAt),schedule=Date.parse(scheduledAt);return Number.isFinite(expiry)&&Number.isFinite(schedule)&&expiry>schedule+bufferMs;}
export function canConsume(limit:number,used:number,quantity=1){return Number.isInteger(quantity)&&quantity>0&&Number.isInteger(used)&&used>=0&&used+quantity<=limit;}
export function quotaFor(plan:PlanKey,kind:CreditKind){return PLANS[plan][CREDIT_COLUMN[kind]] as number;}
export function requiresMedia(kind:MediaKind){return kind!=='text';}
export const MAX_MEDIA_BYTES=100*1024*1024;
export const MEDIA_RETENTION_DAYS=7;

export type PublishMethod='facebook_text'|'facebook_link'|'facebook_photo'|'youtube_video';
export type PublishSupport={ok:boolean;method?:PublishMethod;reason?:string};
/** The single source of truth for what can actually be published today, and a human reason when it cannot. */
export function publishSupport(provider:string,kind:MediaKind,opts:{link?:string|null;hasMedia?:boolean}={}):PublishSupport{
  if(provider==='facebook'){
    if(kind==='text')return {ok:true,method:opts.link?'facebook_link':'facebook_text'};
    if(kind==='image')return opts.hasMedia?{ok:true,method:'facebook_photo'}:{ok:false,reason:'Attach an uploaded image to post a photo to Facebook.'};
    if(kind==='video')return opts.link?{ok:true,method:'facebook_link'}:{ok:false,reason:'Facebook videos are shared as links. Add the https:// link of a video already on Facebook or YouTube.'};
  }
  if(provider==='youtube'){
    if(kind==='video')return opts.hasMedia?{ok:true,method:'youtube_video'}:{ok:false,reason:'Attach an uploaded video to publish it to YouTube.'};
    return {ok:false,reason:'YouTube does not allow text or image posts through its API. Only video uploads are possible.'};
  }
  return {ok:false,reason:'Publishing to this platform is not available yet.'};
}
export function canActuallyPublish(provider:string,kind:MediaKind,opts:{link?:string|null;hasMedia?:boolean}={}){return publishSupport(provider,kind,opts).ok;}
/** Only absolute https URLs without embedded credentials are accepted as post links. Returns the normalized URL or null. */
export function normalizeLink(input:unknown):string|null{
  if(typeof input!=='string')return null;
  const raw=input.trim();if(!raw||raw.length>2048)return null;
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||!u.hostname.includes('.'))return null;
    return u.toString();
  }catch{return null}
}
/** The link to post: an explicit link wins, otherwise the original URL of an imported video. */
export function resolveLink(content:{link_url?:string|null;source_url?:string|null}):string|null{
  return normalizeLink(content.link_url)||normalizeLink(content.source_url);
}
