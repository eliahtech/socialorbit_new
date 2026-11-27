import test from 'node:test';import assert from 'node:assert/strict';
import {publishSupport} from '../packages/core/src/domain.ts';
import {preflight,isBlocked} from '../packages/core/src/guardrails.ts';
import {youtubeMetadata,hasYoutubeUploadScope} from '../packages/core/src/youtube.ts';

test('publishSupport explains every refusal and names the method when allowed',()=>{
  assert.deepEqual(publishSupport('facebook','text'),{ok:true,method:'facebook_text'});
  assert.equal(publishSupport('facebook','text',{link:'https://a.example.com/x'}).method,'facebook_link');
  assert.equal(publishSupport('facebook','image',{hasMedia:true}).method,'facebook_photo');
  assert.equal(publishSupport('youtube','video',{hasMedia:true}).method,'youtube_video');
  for(const bad of [publishSupport('facebook','image'),publishSupport('facebook','video'),publishSupport('youtube','video'),publishSupport('youtube','text'),publishSupport('youtube','image',{hasMedia:true}),publishSupport('tiktok','video',{hasMedia:true})]){
    assert.equal(bad.ok,false);assert.ok(bad.reason&&bad.reason.length>10);
  }
});
const base={permissionGranted:true,accountConnected:true,scheduledAt:'2026-12-01T12:00:00Z',publishingEnabled:true};
const media={available:true,byteSize:5e6,expiresAt:'2026-12-05T12:00:00Z'};
test('preflight: YouTube video needs an available, unexpired upload',()=>{
  assert.equal(isBlocked(preflight({...base,provider:'youtube',kind:'video',media})),false);
  assert.ok(preflight({...base,provider:'youtube',kind:'video'}).some(f=>f.code==='MEDIA_UNAVAILABLE'));
  assert.ok(preflight({...base,provider:'youtube',kind:'video',media:{...media,expiresAt:'2026-11-30T00:00:00Z'}}).some(f=>f.code==='MEDIA_EXPIRED'));
  assert.ok(preflight({...base,provider:'youtube',kind:'video',media:{...media,available:false}}).some(f=>f.code==='MEDIA_UNAVAILABLE'));
  const text=preflight({...base,provider:'youtube',kind:'text'});assert.ok(text.some(f=>f.code==='UNSUPPORTED_FORMAT'&&/YouTube/.test(f.message)));
});
test('preflight: Facebook photo needs an uploaded image',()=>{
  assert.equal(isBlocked(preflight({...base,provider:'facebook',kind:'image',media})),false);
  assert.ok(preflight({...base,provider:'facebook',kind:'image'}).some(f=>f.code==='MEDIA_UNAVAILABLE'));
});
test('YouTube metadata respects platform limits and defaults to private',()=>{
  const m=youtubeMetadata({title:'  Hello <b>World</b>  ',body:'Body <script>',visibility:null});
  assert.equal(m.snippet.title,'Hello World');assert.ok(!/[<>]/.test(m.snippet.description));assert.equal(m.status.privacyStatus,'private');assert.equal(m.status.selfDeclaredMadeForKids,false);
  assert.equal(youtubeMetadata({title:'x'.repeat(300),body:''}).snippet.title.length,100);
  assert.equal(youtubeMetadata({title:'',body:''}).snippet.title,'Untitled');
  assert.equal(youtubeMetadata({title:'t',body:'',visibility:'public'}).status.privacyStatus,'public');
  assert.equal(youtubeMetadata({title:'t',body:'',visibility:'hacked'}).status.privacyStatus,'private');
  const long=youtubeMetadata({title:'t',body:'é'.repeat(5000)});assert.ok(new TextEncoder().encode(long.snippet.description).length<=5000);
  assert.match(youtubeMetadata({title:'t',body:'hi',link:'https://a.example.com'}).snippet.description,/hi\n\nhttps:\/\/a\.example\.com/);
});
test('upload scope detection needs youtube.upload, not just read access',()=>{
  assert.equal(hasYoutubeUploadScope(['https://www.googleapis.com/auth/youtube.readonly']),false);
  assert.equal(hasYoutubeUploadScope(['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/youtube.upload']),true);
  assert.equal(hasYoutubeUploadScope('https://www.googleapis.com/auth/youtube.upload openid'),true);
  assert.equal(hasYoutubeUploadScope(null),false);assert.equal(hasYoutubeUploadScope([]),false);
});
