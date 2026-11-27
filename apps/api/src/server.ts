import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {env} from './config.ts';
import app from './app.ts';
// Local development / long-running hosts only. On Vercel the static site is served by the CDN and api/index.ts exports the app.
const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web/public');
app.use(express.static(publicDir,{extensions:['html']}));
app.get('/',(_,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.get('/app',(_,res)=>res.sendFile(path.join(publicDir,'app.html')));
app.get('/admin',(_,res)=>res.sendFile(path.join(publicDir,'admin.html')));
// No SPA wildcard that could conceal missing static assets as HTTP 200.
app.listen(env.PORT,()=>console.log(`SocialOrbit API running on http://localhost:${env.PORT}`));
