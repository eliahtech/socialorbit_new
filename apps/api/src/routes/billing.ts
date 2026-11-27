import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,actor,workspace} from '../middleware/auth.ts';
import {currencyAllowed,planMinor,paypalOrderVerified} from '../../../../packages/core/src/pricing.ts';
import {startPesapal,startPaypal,capturePaypalOrder,paymentOptions,pesapalCurrencies} from '../services/payments.ts';
export const billingRoutes=Router({mergeParams:true});
billingRoutes.use(requireAuth,needSpace('admin'));
billingRoutes.get('/subscription',asyncRoute(async(req,res)=>{
 const db=database(),wid=workspace(req).id;
 const [s,w,p]=await Promise.all([
  db.from('subscriptions').select('plan_key,status,current_period_start,current_period_end').eq('workspace_id',wid).single(),
  db.from('credit_wallets').select('kind,monthly_balance,topup_balance,reserved').eq('workspace_id',wid),
  db.from('plans').select('*')
 ]);
 assert(!s.error&&!w.error&&!p.error,503,'Billing information unavailable');res.json({subscription:s.data,wallets:w.data,plans:p.data});
}));
billingRoutes.get('/payments',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('payments').select('id,provider,purpose,currency,amount_minor,status,merchant_reference,created_at,verified_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false}).limit(50);assert(!error,503,'Payment records unavailable');res.json(data);
}));
billingRoutes.get('/credit-packs',asyncRoute(async(_req,res)=>{
 const {data,error}=await database().from('credit_packs').select('id,kind,units,price_kes,price_usd_cents').eq('enabled',true).order('price_kes');
 assert(!error,503,'Credit packs unavailable');res.json(data);
}));
const common={provider:z.enum(['pesapal','paypal']),currency:z.enum(['KES','USD'])};
const checkoutSchema=z.discriminatedUnion('purpose',[
 z.object({...common,purpose:z.literal('subscription'),plan:z.enum(['creator','pro','agency'])}).strict(),
 z.object({...common,purpose:z.literal('topup'),creditPackId:z.string().uuid()}).strict()
]);
billingRoutes.post('/checkout',needSpace('owner'),asyncRoute(async(req,res)=>{
 const p=checkoutSchema.parse(req.body),db=database(),wid=workspace(req).id;
 const options=paymentOptions();
 assert(options[p.provider].enabled,503,`${p.provider==='paypal'?'PayPal':'Pesapal'} is not configured on this server`);
 assert(currencyAllowed(p.provider,p.currency,pesapalCurrencies()),400,'That payment method does not support the chosen currency');
 let minor=0,description='',details:Record<string,unknown>={};
 if(p.purpose==='subscription'){
  const plan=await db.from('plans').select('price_kes,price_usd_cents').eq('key',p.plan).single();
  assert(!plan.error&&plan.data,404,'Plan unavailable');minor=planMinor(plan.data,p.currency);
  description=`SocialOrbit ${p.plan} subscription`;details={plan_key:p.plan};
 }else{
  const pack=await db.from('credit_packs').select('id,kind,units,price_kes,price_usd_cents').eq('id',p.creditPackId).eq('enabled',true).maybeSingle();
  assert(!pack.error&&pack.data,404,'Credit pack unavailable');minor=planMinor(pack.data,p.currency);
  description=`SocialOrbit ${pack.data.units} ${pack.data.kind} credit top-up`;
  details={credit_pack_id:pack.data.id,credit_kind:pack.data.kind,credit_quantity:pack.data.units};
 }
 assert(minor>0,400,'This item is not priced in the chosen currency');
 const reference=`SO-${crypto.randomUUID()}`;
 const row=await db.from('payments').insert({workspace_id:wid,initiated_by:actor(req).id,provider:p.provider,purpose:p.purpose,currency:p.currency,amount_minor:minor,amount_kes:p.currency==='KES'?minor/100:null,merchant_reference:reference,...details}).select('id').single();
 assert(!row.error&&row.data,503,'Unable to start checkout');
 try{
  if(p.provider==='paypal'){
   const o=await startPaypal({minor,reference,workspaceId:wid,description});
   await db.from('payments').update({provider_reference:o.orderId,status:'processing'}).eq('id',row.data.id);
   return res.status(202).json({paymentId:row.data.id,status:'processing',redirectUrl:o.approveUrl});
  }
  const result=await startPesapal({minor,currency:p.currency,reference,email:actor(req).email,description});
  await db.from('payments').update({provider_reference:result.order_tracking_id,status:'processing'}).eq('id',row.data.id);
  return res.status(202).json({paymentId:row.data.id,status:'processing',redirectUrl:result.redirect_url});
 }catch(e){await db.from('payments').update({status:'failed'}).eq('id',row.data.id);throw e;}
}));
// Called by the browser after PayPal redirects back. The capture result is re-checked server-side before any entitlement changes.
billingRoutes.post('/checkout/paypal/capture',needSpace('owner'),asyncRoute(async(req,res)=>{
 const {orderId}=z.object({orderId:z.string().regex(/^[A-Za-z0-9]{10,30}$/)}).strict().parse(req.body);
 const db=database(),wid=workspace(req).id;
 const row=await db.from('payments').select('*').eq('workspace_id',wid).eq('provider','paypal').eq('provider_reference',orderId).maybeSingle();
 assert(!row.error&&row.data,404,'Payment not found');
 if(row.data.status==='verified')return res.json({status:'verified'});
 assert(['pending','processing'].includes(row.data.status),409,'This payment can no longer be completed');
 const order=await capturePaypalOrder(orderId);
 const ok=paypalOrderVerified(order,{reference:row.data.merchant_reference,minor:row.data.amount_minor,currency:row.data.currency});
 if(!ok)return res.status(202).json({status:'processing',message:'PayPal has not confirmed this payment yet. It will be applied automatically once confirmed.'});
 const f=await db.rpc('fulfill_verified_payment',{p_payment:row.data.id,p_provider_reference:orderId});
 assert(!f.error,503,'Payment verified but could not be applied. Contact support with your reference.');
 res.json({status:'verified'});
}));
