// Persist the author's local offset with new economic events. UTC timestamps remain immutable.
export function businessDay(instant=new Date(),offsetMinutes=-instant.getTimezoneOffset()){
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime())||!Number.isInteger(offsetMinutes)||offsetMinutes< -720||offsetMinutes>840)throw new Error('Некорректное время предприятия');
 return new Date(instant.getTime()+offsetMinutes*60000).toISOString().slice(0,10)
}
export function economicEventPayload(type,payload,instant=new Date()){
 return ['economic_effect','economic_fact'].includes(type)?{...payload,business_offset_minutes:-instant.getTimezoneOffset()}:payload
}
export function economicEventDay(event){
 const p=event.payload??event.p,instant=new Date(event.occurred_at);
 // Legacy journal events were validated against UTC; never reinterpret on replay.
 return businessDay(instant,Object.hasOwn(p||{},'business_offset_minutes')?p.business_offset_minutes:0)
}
export function economicCommand(payload){
 const {business_offset_minutes,...command}=payload;return command
}
