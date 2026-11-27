import {createClient} from '@supabase/supabase-js';
import {env,configured} from './config.ts';
import {ApiError} from './http.ts';
export function database(){if(!configured)throw new ApiError(503,'Supabase credentials are not configured');return createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});}
export function unwrap<T>(response:{data:T;error:{message:string;code?:string}|null}):T{if(response.error){console.error('Database operation failed:',response.error.code||'UNKNOWN');throw new ApiError(503,'Database operation unavailable');}return response.data;}
