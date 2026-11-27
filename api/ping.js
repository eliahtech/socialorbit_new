// Dependency-free health probe for debugging deployments: GET /api/ping
// Tells you (1) the function runtime works at all, (2) which Node version it runs, (3) whether the API bundle can load.
import fs from 'node:fs';
export default async function handler(req,res){
  const out={ok:true,node:process.version,files:[]};
  try{out.files=fs.readdirSync(new URL('.',import.meta.url)).slice(0,30)}catch(e){out.filesError=String(e&&e.message||e).slice(0,200)}
  try{await import('./_app.js');out.app='loads'}
  catch(e){out.app='FAILS TO LOAD';out.error=String(e&&e.message||e).replace(/\/var\/task\//g,'').slice(0,400)}
  res.statusCode=200;res.setHeader('content-type','application/json');res.end(JSON.stringify(out));
}
