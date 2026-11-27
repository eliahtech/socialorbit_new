// Pure helpers for YouTube uploads (unit tested; no I/O).
export type Visibility='private'|'unlisted'|'public';
export const VISIBILITIES:Visibility[]=['private','unlisted','public'];
const strip=(s:string)=>s.replace(/<[^>]*>/g,'').replace(/[<>]/g,'');
const clean=(s:string)=>strip(s).replace(/\s+/g,' ').trim();
/** YouTube forbids < and > in titles, limits titles to 100 characters and descriptions to 5000 bytes. */
export function youtubeMetadata(c:{title:string;body:string;visibility?:string|null;link?:string|null}){
  const title=(clean(c.title||'')||'Untitled').slice(0,100);
  let description=strip(c.body||'').trim();
  if(c.link)description=(description?description+'\n\n':'')+c.link;
  while(new TextEncoder().encode(description).length>4900)description=description.slice(0,-50);
  const privacyStatus:Visibility=(VISIBILITIES as string[]).includes(String(c.visibility))?c.visibility as Visibility:'private';
  return {snippet:{title,description,categoryId:'22'},status:{privacyStatus,selfDeclaredMadeForKids:false}};
}
/** Granted scopes must include the upload permission; the read-only scope is not enough. */
export function hasYoutubeUploadScope(granted:unknown):boolean{
  const list=Array.isArray(granted)?granted:typeof granted==='string'?granted.split(/[ ,]+/):[];
  return list.some(s=>String(s).endsWith('/auth/youtube.upload')||s==='youtube.upload');
}
