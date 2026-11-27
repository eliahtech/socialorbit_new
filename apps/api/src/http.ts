import type {Request,Response,NextFunction} from 'express';
import {ZodError} from 'zod';
export class ApiError extends Error{status:number;code:string;constructor(status:number,message:string,code='REQUEST_FAILED'){super(message);this.status=status;this.code=code;}}
export function asyncRoute(fn:(req:Request,res:Response,next:NextFunction)=>Promise<unknown>){return (req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res,next)).catch(next);};}
export function errorHandler(err:unknown,req:Request,res:Response,_next:NextFunction){
  if(err instanceof ZodError)return res.status(400).json({error:'Invalid request',code:'VALIDATION_ERROR',issues:err.flatten()});
  if(err instanceof ApiError)return res.status(err.status).json({error:err.message,code:err.code});
  console.error('Unhandled server error',err instanceof Error?err.message:'Unknown error');
  return res.status(500).json({error:'Internal server error',code:'SERVER_ERROR'});
}
export function assert(condition:unknown,status:number,message:string,code='INVALID_OPERATION'):asserts condition{if(!condition)throw new ApiError(status,message,code);}
export function safeRedirectMessage(s:string){return encodeURIComponent(s.slice(0,100));}
