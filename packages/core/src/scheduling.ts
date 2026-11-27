export type Slot={hour:number;minute:number;weekdays:number[]};
export function nextSlots(from:Date,count:number,slot:Slot,timezone='UTC'){
  if(count<0||count>1000||!Number.isInteger(count))throw Error('Invalid slot count');
  if(!Number.isInteger(slot.hour)||slot.hour<0||slot.hour>23||!Number.isInteger(slot.minute)||slot.minute<0||slot.minute>59)throw Error('Invalid slot');
  if(!slot.weekdays.length||slot.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Invalid weekdays');
  // Timezone input is IANA; Intl ensures DST transitions are calculated using local clock components.
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
  const weekdayIndex:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  const result:Date[]=[];
  let t=Math.floor(from.getTime()/60000)*60000+60000;
  for(let i=0;i<550000&&result.length<count;i++,t+=60000){
    const pieces=Object.fromEntries(formatter.formatToParts(new Date(t)).map(x=>[x.type,x.value]));
    if(Number(pieces.hour)===slot.hour&&Number(pieces.minute)===slot.minute&&slot.weekdays.includes(weekdayIndex[pieces.weekday]))result.push(new Date(t));
  }
  if(result.length!==count)throw Error('Insufficient matching slots within search window');return result;
}
export function idempotencyKey(contentId:string,accountId:string,scheduledAt:string){return `pub:${contentId}:${accountId}:${new Date(scheduledAt).toISOString()}`;}
