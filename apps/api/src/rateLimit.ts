import rateLimit,{type Store,type Options,type IncrementResponse} from 'express-rate-limit';
// In-memory counters are per serverless instance and therefore ineffective on Vercel. When Upstash Redis (or Vercel KV,
// which is Upstash under the hood) is configured, counters are shared across instances over its REST API.
const url=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL||'';
const token=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN||'';
export const sharedLimiterEnabled=Boolean(url.startsWith('https://')&&token);
async function pipeline(commands:(string|number)[][]):Promise<any[]>{
 const r=await fetch(`${url}/pipeline`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(commands),signal:AbortSignal.timeout(2500)});
 if(!r.ok)throw Error('Rate-limit store error '+r.status);
 return r.json() as Promise<any[]>;
}
class UpstashStore implements Store{
 windowMs=60000;prefix='so:rl:';
 constructor(prefix:string){this.prefix=`so:rl:${prefix}:`}
 init(options:Options){this.windowMs=options.windowMs}
 async increment(key:string):Promise<IncrementResponse>{
  const k=this.prefix+key;
  const out=await pipeline([['INCR',k],['PEXPIRE',k,this.windowMs,'NX'],['PTTL',k]]);
  const hits=Number(out[0]?.result),ttl=Number(out[2]?.result);
  if(!Number.isFinite(hits))throw Error('Rate-limit store returned an invalid response');
  return {totalHits:hits,resetTime:new Date(Date.now()+(ttl>0?ttl:this.windowMs))};
 }
 async decrement(key:string){await pipeline([['DECR',this.prefix+key]])}
 async resetKey(key:string){await pipeline([['DEL',this.prefix+key]])}
}
export function apiLimiter(prefix:string,limit:number){
 return rateLimit({windowMs:60000,limit,standardHeaders:'draft-7',legacyHeaders:false,passOnStoreError:true,...(sharedLimiterEnabled?{store:new UpstashStore(prefix)}:{})});
}
