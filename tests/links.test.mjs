import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeLink,resolveLink,canActuallyPublish,PLANS,quotaFor} from '../packages/core/src/domain.ts';
import {preflight,isBlocked} from '../packages/core/src/guardrails.ts';

test('links must be plain https URLs',()=>{
  assert.equal(normalizeLink('https://www.youtube.com/watch?v=abc123'),'https://www.youtube.com/watch?v=abc123');
  assert.equal(normalizeLink('  https://fb.watch/xyz/  '),'https://fb.watch/xyz/');
  for(const bad of ['http://example.com/a','javascript:alert(1)','data:text/html,hi','ftp://example.com','https://user:pw@example.com/','https://localhost/a','not a url','','   ',undefined,null,42,'https://'+'a'.repeat(2100)+'.com'])
    assert.equal(normalizeLink(bad),null,String(bad).slice(0,40));
});
test('explicit link wins over the imported video URL',()=>{
  assert.equal(resolveLink({link_url:'https://a.example.com/x',source_url:'https://www.youtube.com/watch?v=1'}),'https://a.example.com/x');
  assert.equal(resolveLink({link_url:null,source_url:'https://www.youtube.com/watch?v=1'}),'https://www.youtube.com/watch?v=1');
  assert.equal(resolveLink({link_url:'http://insecure.com',source_url:null}),null);
  assert.equal(resolveLink({}),null);
});
test('Facebook publishes text/link/photo; YouTube only videos with an uploaded file',()=>{
  assert.equal(canActuallyPublish('facebook','text'),true);
  assert.equal(canActuallyPublish('facebook','video'),false);
  assert.equal(canActuallyPublish('facebook','video',{link:'https://youtu.be/abc'}),true);
  for(const p of ['instagram','tiktok','x','linkedin'])for(const k of ['text','image','video'])assert.equal(canActuallyPublish(p,k,{link:'https://youtu.be/abc',hasMedia:true}),false,p+k);
  for(const k of ['text','image'])assert.equal(canActuallyPublish('youtube',k,{link:'https://youtu.be/abc',hasMedia:true}),false,'youtube '+k);
  assert.equal(canActuallyPublish('youtube','video',{link:'https://youtu.be/abc'}),false);
});
const base={provider:'facebook',permissionGranted:true,accountConnected:true,scheduledAt:'2026-12-01T12:00:00Z',publishingEnabled:true};
test('preflight: video posts need a link but no uploaded media',()=>{
  const noLink=preflight({...base,kind:'video'});assert.ok(noLink.some(f=>f.code==='LINK_REQUIRED'));assert.equal(isBlocked(noLink),true);
  const ok=preflight({...base,kind:'video',link:'https://www.youtube.com/watch?v=abc'});assert.equal(isBlocked(ok),false);assert.ok(!ok.some(f=>f.code==='MEDIA_UNAVAILABLE'));
});
test('credit plans no longer include clips',()=>{
  for(const plan of Object.values(PLANS))assert.equal('clips' in plan,false);
  assert.equal(quotaFor('creator','publishing'),300);
});
