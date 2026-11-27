import {createHash,randomBytes} from 'node:crypto';
export function pkcePair(){const verifier=randomBytes(32).toString('base64url');const challenge=createHash('sha256').update(verifier).digest('base64url');return {verifier,challenge};}
export function nonce(){return randomBytes(24).toString('base64url');}
export function buildAuthorizationUrl(endpoint:string,params:Record<string,string>){const url=new URL(endpoint);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);return url.toString();}
