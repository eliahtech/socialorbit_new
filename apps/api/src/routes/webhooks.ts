import {Router} from 'express';
import {database} from '../db.ts';
import {asyncRoute,assert} from '../http.ts';
import {verifyPesapal,getPaypalOrder,verifyPaypalWebhook} from '../services/payments.ts';
import {pesapalVerified,paypalOrderVerified} from '../../../../packages/core/src/pricing.ts';
export const webhookRoutes=Router();
// Event bodies are untrusted hints. Never fulfill from webhook input alone.
webhookRoutes.all('/pesapal',asyncRoute(async(req,res)=>{
 const tracking=String(req.body?.OrderTrackingId||req.query?.OrderTrackingId||'');
 assert(/^[a-zA-Z0-9-]{10,120}$/.test(tracking),400,'Invalid tracking ID');
 const db=database();const r=await db.from('payments').select('*').eq('provider','pesapal').eq('provider_reference',tracking).maybeSingle();
 if(!r.error&&r.data&&['pending','processing'].includes(r.data.status)){
  try{
   const verified=await verifyPesapal(tracking);
   if(pesapalVerified(verified,{reference:r.data.merchant_reference,minor:r.data.amount_minor,currency:r.data.currency})){
    const f=await db.rpc('fulfill_verified_payment',{p_payment:r.data.id,p_provider_reference:tracking});
    if(f.error)console.error('Pesapal fulfillment failed',f.error.message);
   }
  }catch(e){console.error('Pesapal reconciliation pending',e instanceof Error?e.message:'unknown')}
 }
 res.status(200).json({status:200,message:'Notification received; reconciliation is processed independently'});
}));
// PayPal: the signature is verified with PayPal, then the order is fetched from PayPal and re-verified before fulfilling.
webhookRoutes.post('/paypal',asyncRoute(async(req,res)=>{
 const valid=await verifyPaypalWebhook(req.headers,req.body);
 assert(valid,400,'Invalid webhook signature');
 const event=req.body||{};
 if(event.event_type==='PAYMENT.CAPTURE.COMPLETED'){
  const orderId=String(event.resource?.supplementary_data?.related_ids?.order_id||'');
  if(/^[A-Za-z0-9]{10,30}$/.test(orderId)){
   const db=database();
   await db.from('payment_events').upsert({provider:'paypal',external_id:String(event.id||orderId),payload:{event_type:event.event_type,order_id:orderId}},{onConflict:'provider,external_id',ignoreDuplicates:true});
   const r=await db.from('payments').select('*').eq('provider','paypal').eq('provider_reference',orderId).maybeSingle();
   if(!r.error&&r.data&&['pending','processing'].includes(r.data.status)){
    try{
     const order=await getPaypalOrder(orderId);
     if(paypalOrderVerified(order,{reference:r.data.merchant_reference,minor:r.data.amount_minor,currency:r.data.currency})){
      const f=await db.rpc('fulfill_verified_payment',{p_payment:r.data.id,p_provider_reference:orderId});
      if(f.error)console.error('PayPal fulfillment failed',f.error.message);
     }
    }catch(e){console.error('PayPal reconciliation pending',e instanceof Error?e.message:'unknown')}
   }
  }
 }
 res.status(200).json({received:true});
}));
