import {ApiError,assert} from '../http.ts';
import {env} from '../config.ts';
import {CURRENCIES,minorToMajorString,type Currency} from '../../../../packages/core/src/pricing.ts';

export async function jsonFetch(url:string,init:RequestInit){
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),20000);
  try{
    const r=await fetch(url,{...init,signal:ctl.signal});const txt=await r.text();
    let data:any;try{data=JSON.parse(txt)}catch{throw new ApiError(502,'Invalid response from payment provider')}
    if(!r.ok)throw new ApiError(502,'Payment provider unavailable');
    return data;
  }finally{clearTimeout(timer)}
}

/* ---------- Which payment methods are configured (exposed via /api/config) ---------- */
export function pesapalCurrencies():Currency[]{
  const list=(process.env.PESAPAL_CURRENCIES||'KES').split(',').map(x=>x.trim().toUpperCase()).filter((x):x is Currency=>(CURRENCIES as string[]).includes(x));
  return list.length?list:['KES'];
}
export function paymentOptions(){
  const pesapal=Boolean(process.env.PESAPAL_CONSUMER_KEY&&process.env.PESAPAL_CONSUMER_SECRET&&process.env.PESAPAL_IPN_ID);
  const paypal=Boolean(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET);
  return {pesapal:{enabled:pesapal,currencies:pesapalCurrencies()},paypal:{enabled:paypal,currencies:['USD'] as Currency[]}};
}

/* ---------- Pesapal (cards, M-Pesa, Airtel Money and bank options on the hosted page) ---------- */
function pesapalBase(){return process.env.PESAPAL_ENV==='live'?'https://pay.pesapal.com/v3':'https://cybqa.pesapal.com/pesapalv3';}
export async function pesapalToken(){
  const key=process.env.PESAPAL_CONSUMER_KEY,secret=process.env.PESAPAL_CONSUMER_SECRET;
  assert(key&&secret,503,'Pesapal credentials are not configured');
  const r=await jsonFetch(`${pesapalBase()}/api/Auth/RequestToken`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({consumer_key:key,consumer_secret:secret})});
  assert(r.token,502,'Pesapal authentication failed');return String(r.token);
}
export async function startPesapal(p:{minor:number;currency:Currency;reference:string;email:string;description:string}){
  assert(process.env.PESAPAL_IPN_ID,503,'Pesapal IPN has not been configured');const token=await pesapalToken();
  const r=await jsonFetch(`${pesapalBase()}/api/Transactions/SubmitOrderRequest`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id:p.reference,currency:p.currency,amount:Number(minorToMajorString(p.minor)),description:p.description,callback_url:`${env.PUBLIC_BASE_URL}/billing-return`,notification_id:process.env.PESAPAL_IPN_ID,billing_address:{email_address:p.email}})});
  assert(r.order_tracking_id&&r.redirect_url,502,'Pesapal did not return a valid checkout');return r as {order_tracking_id:string;redirect_url:string};
}
export async function verifyPesapal(trackingId:string){
  const token=await pesapalToken(),u=new URL(`${pesapalBase()}/api/Transactions/GetTransactionStatus`);u.searchParams.set('orderTrackingId',trackingId);
  return jsonFetch(u.toString(),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
}

/* ---------- PayPal (USD) ---------- */
function paypalBase(){return process.env.PAYPAL_ENV==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';}
let paypalCache:{token:string;expires:number}|null=null;
export async function paypalToken(){
  if(paypalCache&&paypalCache.expires>Date.now()+30000)return paypalCache.token;
  const id=process.env.PAYPAL_CLIENT_ID,secret=process.env.PAYPAL_CLIENT_SECRET;assert(id&&secret,503,'PayPal credentials are not configured');
  const r=await jsonFetch(`${paypalBase()}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  assert(r.access_token,502,'PayPal authentication failed');
  paypalCache={token:String(r.access_token),expires:Date.now()+Number(r.expires_in||300)*1000};return paypalCache.token;
}
async function paypalFetch(path:string,init:RequestInit={}){
  const token=await paypalToken();
  return jsonFetch(`${paypalBase()}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json',...(init.headers||{})}});
}
export async function startPaypal(p:{minor:number;reference:string;workspaceId:string;description:string}){
  const base=env.PUBLIC_BASE_URL;
  const r=await paypalFetch('/v2/checkout/orders',{method:'POST',headers:{'PayPal-Request-Id':p.reference},body:JSON.stringify({
    intent:'CAPTURE',
    purchase_units:[{reference_id:p.reference,custom_id:p.reference,description:p.description.slice(0,120),amount:{currency_code:'USD',value:minorToMajorString(p.minor)}}],
    payment_source:{paypal:{experience_context:{brand_name:'SocialOrbit',user_action:'PAY_NOW',shipping_preference:'NO_SHIPPING',
      return_url:`${base}/billing-return?provider=paypal&w=${encodeURIComponent(p.workspaceId)}`,
      cancel_url:`${base}/billing-return?provider=paypal&cancelled=1`}}}
  })});
  const link=(r.links||[]).find((l:any)=>l.rel==='payer-action'||l.rel==='approve');
  assert(r.id&&link?.href&&String(link.href).startsWith('https://'),502,'PayPal did not return a valid checkout');
  return {orderId:String(r.id),approveUrl:String(link.href)};
}
export async function getPaypalOrder(orderId:string){return paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);}
/** Capture an approved order. If capture fails (already captured, not approved) fall back to reading the order. */
export async function capturePaypalOrder(orderId:string){
  try{return await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST',headers:{'PayPal-Request-Id':`capture-${orderId}`},body:'{}'});}
  catch{return getPaypalOrder(orderId);}
}
export async function verifyPaypalWebhook(headers:Record<string,string|string[]|undefined>,event:unknown){
  const webhookId=process.env.PAYPAL_WEBHOOK_ID;if(!webhookId)return false;
  const h=(k:string)=>String(headers[k]||'');
  const r=await paypalFetch('/v1/notifications/verify-webhook-signature',{method:'POST',body:JSON.stringify({
    auth_algo:h('paypal-auth-algo'),cert_url:h('paypal-cert-url'),transmission_id:h('paypal-transmission-id'),
    transmission_sig:h('paypal-transmission-sig'),transmission_time:h('paypal-transmission-time'),webhook_id:webhookId,webhook_event:event})});
  return r.verification_status==='SUCCESS';
}
