import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import {apiLimiter} from './rateLimit.ts';
import {env} from './config.ts';
import {cronRoutes} from './routes/cron.ts';
import {errorHandler} from './http.ts';
import {publicRoutes} from './routes/public.ts';
import {workspacesRoutes} from './routes/workspaces.ts';
import {contentRoutes} from './routes/content.ts';
import {supportRoutes} from './routes/support.ts';
import {analyticsRoutes} from './routes/analytics.ts';
import {notificationsRoutes} from './routes/notifications.ts';
import {automationRoutes} from './routes/automations.ts';
import {mediaRoutes} from './routes/media.ts';
import {designsRoutes} from './routes/designs.ts';
import {aiRoutes} from './routes/ai.ts';
import {billingRoutes} from './routes/billing.ts';
import {socialRoutes,oauthCallbackRoutes} from './routes/social.ts';
import {publishingRoutes} from './routes/publishing.ts';
import {webhookRoutes} from './routes/webhooks.ts';
import {adminRoutes} from './routes/admin.ts';
// Only Supabase (REST + realtime) needs to be reachable from the browser besides this origin.
function supabaseConnectSources(){
  const list=['https://*.supabase.co','wss://*.supabase.co'];
  try{const u=new URL(env.SUPABASE_URL);if(!u.hostname.endsWith('.supabase.co')){list.push(`https://${u.host}`,`wss://${u.host}`)}}catch{}
  return list;
}
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'",'https://cdn.jsdelivr.net','https://fonts.googleapis.com',"'unsafe-inline'"],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'",...supabaseConnectSources()],objectSrc:["'none'"],baseUri:["'self'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'1mb'}));
app.use('/api',apiLimiter('api',90));
app.use('/api',publicRoutes);
app.use('/api/workspaces',workspacesRoutes);
app.use('/api/w/:workspaceId/content',contentRoutes);
app.use('/api/w/:workspaceId/support',supportRoutes);
app.use('/api/w/:workspaceId/analytics',analyticsRoutes);
app.use('/api/w/:workspaceId/automation',automationRoutes);
app.use('/api/w/:workspaceId/media',mediaRoutes);
app.use('/api/w/:workspaceId/designs',designsRoutes);
app.use('/api/w/:workspaceId/ai',aiRoutes);
app.use('/api/w/:workspaceId/billing',billingRoutes);
app.use('/api/w/:workspaceId/social',socialRoutes);
app.use('/api/w/:workspaceId/publishing',publishingRoutes);
app.use('/api/notifications',notificationsRoutes);
app.use('/api/oauth/callback',oauthCallbackRoutes);
app.use('/api/webhooks',webhookRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/cron',cronRoutes);
// Payment providers return the customer here. PayPal appends ?token=<orderId>; the browser then confirms the capture.
app.get('/billing-return',(req,res)=>{
  const token=String(req.query.token||''),w=String(req.query.w||'');
  if(req.query.provider==='paypal'&&/^[A-Za-z0-9]{10,30}$/.test(token)&&/^[0-9a-fA-F-]{36}$/.test(w))
    return res.redirect(303,`/app.html?paypal_order=${encodeURIComponent(token)}&w=${encodeURIComponent(w)}#billing`);
  res.redirect(303,'/app.html#billing');
});
app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found'}));
app.use(errorHandler);
export default app;
