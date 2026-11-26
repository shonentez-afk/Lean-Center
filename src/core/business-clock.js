// Persist the author's local offset with economic events and action implementation. UTC timestamps remain immutable.
export function businessDay(instant=new Date(),offsetMinutes=-instant.getTimezoneOffset()){
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime())||!Number.isInteger(offsetMinutes)||offsetMinutes< -720||offsetMinutes>840)throw new Error('Некорректное время предприятия');
 return new Date(instant.getTime()+offsetMinutes*60000).toISOString().slice(0,10)
}
export function economicEventPayload(type,payload,instant=new Date()){
 return (['economic_effect','economic_fact'].includes(type)||type==='action_item'&&payload?.command==='implement')?{...payload,business_offset_minutes:-instant.getTimezoneOffset()}:payload
}
export function economicEventDay(event){
 const p=event.payload??event.p,instant=new Date(event.occurred_at);
 // Legacy journal events were validated against UTC; never reinterpret on replay.
 return businessDay(instant,Object.hasOwn(p||{},'business_offset_minutes')?p.business_offset_minutes:0)
}
export function economicCommand(payload){
 const {business_offset_minutes,...command}=payload;return command
}

// The offset is recorded in the implementation event, not inferred from the viewer's clock.
// Old events did not record it: use their original UTC date and label that fallback.
export function recordedBusinessDate(occurredAt,offsetMinutes=null){
 if(!occurredAt)return {date:'',timeBasis:'',offsetMinutes:null};
 const explicit=offsetMinutes!==null&&offsetMinutes!==undefined,date=businessDay(new Date(occurredAt),explicit?offsetMinutes:0);
 const sign=offsetMinutes<0?'−':'+',n=Math.abs(offsetMinutes||0);
 return {date,offsetMinutes:explicit?offsetMinutes:null,timeBasis:explicit?'UTC'+sign+String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')+' (при записи)':'UTC (старая запись без смещения)'}
}
