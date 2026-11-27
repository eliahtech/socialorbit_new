import {publishSupport,mediaUsableAt, MAX_MEDIA_BYTES, type MediaKind} from './domain.ts';
export type PreflightInput={
  provider:string;kind:MediaKind;permissionGranted:boolean;accountConnected:boolean;
  caption?:string;media?:{byteSize:number;expiresAt:string;available:boolean}; scheduledAt:string;
  alreadyPublished?:boolean;publishingEnabled:boolean;link?:string|null;
};
export type Finding={code:string;severity:'block'|'warning';message:string};
export function preflight(input:PreflightInput):Finding[]{
  const findings:Finding[]=[];
  const block=(code:string,message:string)=>findings.push({code,severity:'block',message});
  if(!input.publishingEnabled)block('PUBLISHING_DISABLED','External publishing is disabled by the operator');
  if(!input.accountConnected)block('ACCOUNT_DISCONNECTED','Reconnect your social account');
  if(!input.permissionGranted)block('MISSING_PERMISSION','Missing required provider permission');
  if(!Number.isFinite(Date.parse(input.scheduledAt)))block('INVALID_SCHEDULE','Invalid scheduled time');
  if(input.alreadyPublished)block('DUPLICATE','Content was already published to this destination');
  const support=publishSupport(input.provider,input.kind,{link:input.link,hasMedia:Boolean(input.media)});
  if(!support.ok){
    const code=input.provider==='facebook'&&input.kind==='video'?'LINK_REQUIRED':(input.kind==='image'||(input.provider==='youtube'&&input.kind==='video'))&&!input.media&&(input.provider==='facebook'||input.provider==='youtube')?'MEDIA_UNAVAILABLE':'UNSUPPORTED_FORMAT';
    block(code,support.reason||'This destination cannot publish this content');
  }
  if((support.method==='facebook_photo'||support.method==='youtube_video')&&input.media){
    if(!input.media.available)block('MEDIA_UNAVAILABLE','Original authorized media is unavailable');
    if(input.media.byteSize>MAX_MEDIA_BYTES)block('MEDIA_TOO_LARGE','File exceeds the 100 MB SocialOrbit upload limit');
    if(!mediaUsableAt(input.media.expiresAt,input.scheduledAt))block('MEDIA_EXPIRED','Media will expire before its scheduled time');
  }
  return findings;
}
export function isBlocked(findings:Finding[]){return findings.some(x=>x.severity==='block');}
