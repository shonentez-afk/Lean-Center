// Personnel history is immutable. Change employment with two native events in
// the same checkpoint transaction, never with a direct SQL overwrite.
import {one,rows,uuid,isId,applyEvent,recordPayload} from '../../src/core/db.js';
import {employmentResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,message)=>{if(!ok)throw new PilotError(status,message)};
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const previousDay=d=>new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const refs=[['profession_id','profession','profession.read'],['position_id','position','position.read'],['shift_id','work_shift','shift.read']];
const scope=(a,action,id,r)=>!!r&&a.scope(action,id,r);
const label=(a,action,id)=>id?a.read(action,id)?.data.name??null:null;
const personName=(a,id)=>a.read('person.read_directory',id)?.data.display_name??a.read('person.read_basic',id)?.data.display_name??null;
function current(db,id,day){const x=rows(db,'SELECT * FROM person_assignment WHERE person_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',[id,day,day]);return x.length===1?x[0]:null}
function canTransfer(db,a,x){
 if(!a.personId||!x||x.person_id===a.personId||x.valid_to!==null)return false;
 if(one(db,'SELECT id FROM person_assignment WHERE person_id=? AND valid_from>?',[x.person_id,x.valid_from]))return false;
 const r=employmentResource(db,x,a.day);
 return !!a.read('employment.read',x.id)&&!!a.read('person.read_directory',x.person_id)&&scope(a,'employment.detail',x.id,r)&&scope(a,'employment.transfer',x.id,r);
}
export function personnelView(db,a,action,x){
 const p=personName(a,x.person_id);
 const state=x.valid_from>a.day?'Запланировано':x.valid_to&&x.valid_to<a.day?'Завершено':'Действует';
 if(action==='role_assignment.read')return {...x,person_name:p,role:label(a,'role.read',x.role_id),state};
 const r=one(db,'SELECT * FROM person_assignment WHERE id=?',[x.id]);
 return {...x,person_name:p,unit:label(a,'org.read',x.unit_id),profession:label(a,'profession.read',x.profession_id),position:label(a,'position.read',x.position_id),shift:label(a,'shift.read',x.shift_id)??x.shift_code,state,can_transfer:r?.valid_from<=a.day&&canTransfer(db,a,r)};
}
export function employmentDetail(db,a,id){
 const old=isId(id)&&one(db,'SELECT * FROM person_assignment WHERE id=?',[id]),r=employmentResource(db,old,a.day);
 must(old&&a.read('employment.read',id)&&scope(a,'employment.detail',id,r),404,'Назначение недоступно');
 const d=personnelView(db,a,'employment.read',old),can=old.valid_from<=a.day&&canTransfer(db,a,old);
 const result={...d,day:a.day,earliest:old.valid_from>=a.day?new Date(Date.parse(old.valid_from+'T00:00:00Z')+86400000).toISOString().slice(0,10):a.day,can_transfer:can,units:[],references:{}};
 if(!can)return result;
 result.units=rows(db,'SELECT id FROM org_unit WHERE archived=0 ORDER BY name,id').flatMap(({id})=>{
  const v=a.read('org.read',id),joined={...r,units:[...new Set([...r.units,id])]};
  return v&&scope(a,'employment.transfer',old.id,joined)&&scope(a,'employment.read',old.id,joined)&&scope(a,'employment.detail',old.id,joined)?[{id,name:v.data.name}]:[];
 });
 for(const [key,t,action] of refs)result.references[key]=rows(db,'SELECT id FROM '+t+' WHERE archived=0 ORDER BY name,id').flatMap(({id})=>{const v=a.read(action,id);return v?[{id,name:v.data.name}]:[]});
 return result;
}
export function transferEmployment(db,a,f){
 must(exact(f,['id','expected_revision','unit_id','profession_id','position_id','shift_id','valid_from'])&&isId(f.id)&&isId(f.unit_id)&&Number.isSafeInteger(f.expected_revision)&&f.expected_revision>0&&date(f.valid_from)&&f.valid_from>=a.day,400,'Неверные параметры назначения');
 const old=one(db,'SELECT * FROM person_assignment WHERE id=?',[f.id]),r=employmentResource(db,old,a.day);
 must(old&&old.valid_from<=a.day&&canTransfer(db,a,old),403,'Перемещение недоступно');
 must(old.rev===f.expected_revision,409,'Назначение изменилось');
 must(f.valid_from>old.valid_from,422,'Начало нового назначения должно быть позже начала предыдущего');
 must(a.read('org.read',f.unit_id),403,'Подразделение недоступно');
 const joined={...r,units:[...new Set([...r.units,f.unit_id])]};
 must(['employment.transfer','employment.read','employment.detail'].every(k=>scope(a,k,old.id,joined)),403,'Нужно единое полномочие на исходное и целевое подразделения');
 for(const [key,t,action] of refs)must(f[key]===null||isId(f[key])&&a.read(action,f[key]),403,'Кадровый справочник недоступен');
 must(['unit_id','profession_id','position_id','shift_id'].some(k=>old[k]!==f[k])||old.shift_code,422,'Назначение не изменилось');
 // All references are checked before either event. A failing second event
 // rolls back both through store.mutate; the old row is never deleted.
 const id=uuid(),close=uuid(),create=uuid();
 try{
  applyEvent(db,{id:close,entity_type:'person_assignment',entity_id:old.id,operation:'update',expected_revision:old.rev,payload:{...recordPayload('person_assignment',old),valid_to:previousDay(f.valid_from)},occurred_at:a.at});
  applyEvent(db,{id:create,entity_type:'person_assignment',entity_id:id,operation:'create',expected_revision:0,payload:{person_id:old.person_id,unit_id:f.unit_id,profession_id:f.profession_id,position_id:f.position_id,shift_id:f.shift_id,shift_code:null,valid_from:f.valid_from,valid_to:null},occurred_at:a.at});
 }catch(e){throw new PilotError(422,'Перемещение: '+String(e.message||'ошибка').split('\n')[0].slice(0,240))}
 a.audit('employment.transfer.close',close);a.audit('employment.transfer.create',create);
 return {id,rev:1,closed_id:old.id,closed_revision:old.rev+1};
}
