export type WalletState={monthly:number;topup:number;reserved:number};
export type ChargeResult={monthlySpent:number;topupSpent:number;remaining:WalletState};
export function available(wallet:WalletState){return Math.max(0,wallet.monthly+wallet.topup-wallet.reserved);}
export function mayReserve(wallet:WalletState,quantity:number){return Number.isSafeInteger(quantity)&&quantity>0&&available(wallet)>=quantity;}
export function reserve(wallet:WalletState,quantity:number):WalletState{if(!mayReserve(wallet,quantity))throw Error('Insufficient credits');return {...wallet,reserved:wallet.reserved+quantity};}
export function settleReserved(wallet:WalletState,quantity:number):ChargeResult{
  if(!Number.isSafeInteger(quantity)||quantity<=0||wallet.reserved<quantity)throw Error('Invalid reservation');
  const monthlySpent=Math.min(wallet.monthly,quantity);const topupSpent=quantity-monthlySpent;
  if(topupSpent>wallet.topup)throw Error('Insufficient balance');
  return {monthlySpent,topupSpent,remaining:{monthly:wallet.monthly-monthlySpent,topup:wallet.topup-topupSpent,reserved:wallet.reserved-quantity}};
}
export function release(wallet:WalletState,quantity:number):WalletState{if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>wallet.reserved)throw Error('Invalid release');return {...wallet,reserved:wallet.reserved-quantity};}
