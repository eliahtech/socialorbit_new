import test from 'node:test';import assert from 'node:assert/strict';
import {currencyAllowed,planMinor,minorToMajorString,amountsMatch,paypalOrderVerified,pesapalVerified,formatMinor} from '../packages/core/src/pricing.ts';

test('PayPal only settles USD; Pesapal follows the configured currency list',()=>{
  assert.equal(currencyAllowed('paypal','USD'),true);assert.equal(currencyAllowed('paypal','KES'),false);
  assert.equal(currencyAllowed('pesapal','KES'),true);assert.equal(currencyAllowed('pesapal','USD'),false);
  assert.equal(currencyAllowed('pesapal','USD',['KES','USD']),true);
});
test('plan minor units per currency',()=>{
  const plan={price_kes:499,price_usd_cents:399};
  assert.equal(planMinor(plan,'KES'),49900);assert.equal(planMinor(plan,'USD'),399);
  assert.throws(()=>planMinor({price_kes:-1,price_usd_cents:1},'KES'));
});
test('minor to major string is exact',()=>{
  assert.equal(minorToMajorString(399),'3.99');assert.equal(minorToMajorString(500),'5.00');assert.equal(minorToMajorString(5),'0.05');
  assert.throws(()=>minorToMajorString(1.5));
});
test('amount matching rejects lookalikes',()=>{
  assert.equal(amountsMatch(399,'3.99'),true);assert.equal(amountsMatch(49900,499),true);
  assert.equal(amountsMatch(399,'3.98'),false);assert.equal(amountsMatch(399,'abc'),false);assert.equal(amountsMatch(399,0),false);assert.equal(amountsMatch(399,undefined),false);
});
const exp={reference:'SO-1',minor:399,currency:'USD'};
const goodOrder=()=>({status:'COMPLETED',purchase_units:[{custom_id:'SO-1',payments:{captures:[{status:'COMPLETED',amount:{currency_code:'USD',value:'3.99'}}]}}]});
test('PayPal order verification',()=>{
  assert.equal(paypalOrderVerified(goodOrder(),exp),true);
  let o=goodOrder();o.purchase_units[0].payments.captures[0].amount.value='1.00';assert.equal(paypalOrderVerified(o,exp),false);
  o=goodOrder();o.purchase_units[0].payments.captures[0].amount.currency_code='EUR';assert.equal(paypalOrderVerified(o,exp),false);
  o=goodOrder();o.purchase_units[0].custom_id='SO-2';assert.equal(paypalOrderVerified(o,exp),false);
  o=goodOrder();o.purchase_units[0].payments.captures[0].status='PENDING';assert.equal(paypalOrderVerified(o,exp),false);
  o=goodOrder();o.status='APPROVED';assert.equal(paypalOrderVerified(o,exp),false);
  assert.equal(paypalOrderVerified(null,exp),false);assert.equal(paypalOrderVerified({status:'COMPLETED'},exp),false);
});
test('Pesapal status verification',()=>{
  const e={reference:'SO-1',minor:49900,currency:'KES'};
  const ok={status_code:1,currency:'KES',amount:499,merchant_reference:'SO-1'};
  assert.equal(pesapalVerified(ok,e),true);
  assert.equal(pesapalVerified({...ok,status_code:2,payment_status_description:'Failed'},e),false);
  assert.equal(pesapalVerified({...ok,currency:'USD'},e),false);assert.equal(pesapalVerified({...ok,amount:1},e),false);
  assert.equal(pesapalVerified({...ok,merchant_reference:'SO-9'},e),false);assert.equal(pesapalVerified(undefined,e),false);
});
test('money formatting',()=>{assert.match(formatMinor(399,'USD'),/3\.99/);assert.match(formatMinor(49900,'KES'),/499/)});
