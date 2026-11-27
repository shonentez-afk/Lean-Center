// Server-controlled civil calendar. The time zone is persisted once for the
// enterprise; clients cannot supply offsets or business dates for authorization.
import {one} from '../../src/core/primitives.js';
import {businessDay} from '../../src/core/business-clock.js';
export const SITE_ZONE_KEY='site_time_zone';
const formats=new Map();
function formatter(zone){
 if(typeof zone!=='string'||zone.length>80||!(/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/).test(zone))throw Error('Некорректный часовой пояс');
 if(!formats.has(zone)){
  const f=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  if(formats.size>=64)formats.clear();formats.set(zone,f);
 }
 return formats.get(zone)
}
export const normalizeZone=zone=>{try{return formatter(zone).resolvedOptions().timeZone}catch{return null}};
export function zoneOffset(zone,instant=new Date()){
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))throw Error('Некорректное время предприятия');
 const p=Object.fromEntries(formatter(zone).formatToParts(instant).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 const local=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
 const offset=(local-Math.floor(instant.getTime()/1000)*1000)/60000;
 if(!Number.isInteger(offset)||offset< -720||offset>840)throw Error('Неподдерживаемое смещение времени');
 return offset;
}
export function siteClock(db,instant=new Date()){
 const stored=one(db,"SELECT value FROM lc81_meta WHERE key=?",[SITE_ZONE_KEY])?.value??null,zone=stored||'UTC',offset=zoneOffset(zone,instant);
 return {zone,configured:stored!==null,day:businessDay(instant,offset),offset_minutes:offset,at:instant.toISOString()};
}
// Preserve the exact existing versioned event formats. No retroactive date
// conversion on replay, no offset on event kinds that don't accept it.
export function civilPayload(type,p,offset){
 const schedule=type==='schedule_event'&&(p?.command==='plan_assessment'||p?.command==='replan'||!Object.hasOwn(p||{},'command')&&Object.hasOwn(p||{},'assignment_id'));
 const finish=type==='training_enrollment'&&p?.command==='finish';
 return schedule||finish||['economic_effect','economic_fact'].includes(type)||type==='action_item'&&p?.command==='implement'?{...p,business_offset_minutes:offset}:p;
}
