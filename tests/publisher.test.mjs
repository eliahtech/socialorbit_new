import test from 'node:test';import assert from 'node:assert/strict';
import {uploadYoutubeVideo,publishFacebookPhoto} from '../apps/api/src/services/publisher.ts';
import {youtubeMetadata} from '../packages/core/src/youtube.ts';

// The publisher talks to real provider APIs, so these tests replace global fetch and check the exact requests it makes.
const realFetch=globalThis.fetch;
const metadata=youtubeMetadata({title:'My video',body:'Hello',visibility:'unlisted'});
const arg={token:'tok',metadata,mime:'video/mp4',bytes:5,sourceUrl:'https://storage.example.com/signed'};
const json=(status,body,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
test.afterEach(()=>{globalThis.fetch=realFetch});

test('YouTube upload: opens a resumable session, then streams the stored file to it',async()=>{
  const calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),method:init.method||'GET'});
    if(String(url).startsWith('https://www.googleapis.com/upload/youtube/v3/videos')){
      assert.match(String(url),/uploadType=resumable/);assert.match(String(url),/part=snippet,status/);
      assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer tok');
      assert.equal(init.headers['X-Upload-Content-Length'],'5');assert.equal(init.headers['X-Upload-Content-Type'],'video/mp4');
      const sent=JSON.parse(init.body);assert.equal(sent.snippet.title,'My video');assert.equal(sent.status.privacyStatus,'unlisted');assert.equal(sent.status.selfDeclaredMadeForKids,false);
      return new Response(null,{status:200,headers:{location:'https://upload.example.com/session1'}});
    }
    if(String(url)==='https://storage.example.com/signed')return new Response('hello',{status:200});
    if(String(url)==='https://upload.example.com/session1'){
      assert.equal(init.method,'PUT');assert.equal(init.headers['Content-Length'],'5');assert.equal(init.headers['Content-Type'],'video/mp4');assert.equal(init.duplex,'half');
      assert.equal(await new Response(init.body).text(),'hello');          // the bytes arrive intact, via a stream
      return json(200,{id:'vid123',status:{privacyStatus:'private'}});
    }
    throw Error('unexpected request '+url);
  };
  const out=await uploadYoutubeVideo(arg);
  assert.deepEqual(out,{id:'vid123',privacy:'private'});
  assert.equal(calls.length,3);
});

test('YouTube upload: a quota error is reported clearly and nothing is uploaded',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return json(403,{error:{errors:[{reason:'quotaExceeded'}]}})};
  await assert.rejects(()=>uploadYoutubeVideo(arg),e=>e.code==='PROVIDER_REJECTED'&&/quota/i.test(e.message));
  assert.equal(calls,1);
});

test('YouTube upload: a rejected file is a normal failure (safe to retry)',async()=>{
  globalThis.fetch=async(url)=>{
    if(String(url).includes('googleapis'))return new Response(null,{status:200,headers:{location:'https://upload.example.com/s'}});
    if(String(url).includes('storage'))return new Response('hello');
    return json(400,{error:{errors:[{reason:'invalidVideo'}]}});
  };
  await assert.rejects(()=>uploadYoutubeVideo(arg),e=>e.code==='PROVIDER_REJECTED'&&/invalidVideo/.test(e.message));
});

test('YouTube upload: a dropped connection mid-upload is ambiguous, so it is never auto-retried',async()=>{
  globalThis.fetch=async(url)=>{
    if(String(url).includes('googleapis'))return new Response(null,{status:200,headers:{location:'https://upload.example.com/s'}});
    if(String(url).includes('storage'))return new Response('hello');
    throw new TypeError('fetch failed');
  };
  await assert.rejects(()=>uploadYoutubeVideo(arg),e=>e.code==='AMBIGUOUS_PROVIDER_RESULT');
});

test('YouTube upload: refuses an upload address that is not https',async()=>{
  globalThis.fetch=async()=>new Response(null,{status:200,headers:{location:'http://evil.example.com/x'}});
  await assert.rejects(()=>uploadYoutubeVideo(arg),/upload address/);
});

test('Facebook photo: posts the signed image URL and caption to the Page photos edge',async()=>{
  globalThis.fetch=async(url,init)=>{
    assert.equal(String(url),'https://graph.facebook.com/v27.0/PAGE1/photos');
    const p=new URLSearchParams(init.body);assert.equal(p.get('url'),'https://storage.example.com/img');assert.equal(p.get('caption'),'Nice');assert.equal(p.get('published'),'true');assert.equal(p.get('access_token'),'tok');
    return json(200,{id:'photo9',post_id:'PAGE1_post9'});
  };
  assert.equal(await publishFacebookPhoto('PAGE1','tok','Nice','https://storage.example.com/img'),'PAGE1_post9');
});

test('Facebook photo: a Graph API error becomes a clear provider rejection',async()=>{
  globalThis.fetch=async()=>json(400,{error:{code:200}});
  await assert.rejects(()=>publishFacebookPhoto('P','tok','c','https://x.example.com/i'),e=>e.code==='PROVIDER_REJECTED'&&/200/.test(e.message));
});
