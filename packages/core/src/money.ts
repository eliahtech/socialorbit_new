export function kes(amount:number){if(!Number.isSafeInteger(amount)||amount<0)throw Error('Invalid amount');return `KES ${new Intl.NumberFormat('en-KE').format(amount)}`;}
export function validKenyanPhone(phone:string){return /^254[17]\d{8}$/.test(phone);}
export function normalizeKenyanPhone(s:string){let p=s.replace(/[\s\-()]/g,'');if(p.startsWith('+'))p=p.slice(1);if(/^0[17]\d{8}$/.test(p))p='254'+p.slice(1);if(/^7\d{8}$/.test(p)||/^1\d{8}$/.test(p))p='254'+p;return validKenyanPhone(p)?p:null;}
