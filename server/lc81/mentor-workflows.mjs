// Existing corporate group-order and monthly supplement domain workflows.
import {one,rows,uuid,isId,applyEvent} from '../../src/core/db.js';
import {personWorkResource,orderResource,supplementResource} from './read-policy.mjs';
import {SUPPLEMENT_TASKS,supplementStatus} from '../../src/modules/training/standard-workflows.js';
import {certificateValid} from '../../src/modules/training/training-facts.js';
import {orderPosition} from '../../src/modules/training/domain.js';
import {PilotError} from '../lc74-store.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const month=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const txt=(s,n=500)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const nullableDate=s=>s===null||date(s);
const who=(a,id)=>a.read('person.read_basic',id)||a.read('person.read_directory',id);
const name=(a,id)=>who(a,id)?.data.display_name??null;
const allowed=(a,k,id,r)=>!!r&&a.allows(k,id,r);
function emit(db,a,t,id,operation,rev,payload,action){
 const event=uuid();
 try{applyEvent(db,{id:event,entity_type:t,entity_id:id,operation,expected_revision:rev,payload,occurred_at:a.at})}
 catch(e){throw new PilotError(422,'Проверка наставничества: '+String(e.message||'ошибка').split('\n')[0].slice(0,250))}
 a.audit(action,event);return {id,rev:one(db,'SELECT rev FROM '+t+' WHERE id=?',[id]).rev};
}
export function orderOptions(db,a){
 must(a.personId&&a.permissions.includes('order.register')&&a.permissions.includes('order.read'),403,'Групповой приказ недоступен');
 const people=rows(db,'SELECT id,display_name name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>who(a,p.id)&&allowed(a,'order.register',p.id,personWorkResource(db,[p.id],a.day)));
 const certs=rows(db,"SELECT id,person_id,role,number FROM mentor_credential WHERE kind='certificate' AND revoked_at IS NULL ORDER BY issued_on,id").filter(c=>c.person_id!==a.personId&&people.some(p=>p.id===c.person_id)&&a.read('credential.read',c.id)&&orderPosition(db,c.person_id,a.day)).map(c=>({id:c.id,label:name(a,c.person_id)+' · '+c.role+' · '+c.number}));
 return {day:a.day,people,certs};
}
export function registerOrder(db,a,f){
 must(a.personId&&exact(f,['order_number','order_on','organization','city','approved_by','valid_from','valid_to','supplement_from','instructor_amount','trainer_amount','evidence','members'])&&txt(f.order_number,200)&&txt(f.organization,300)&&txt(f.city,150)&&txt(f.evidence)&&isId(f.approved_by)&&date(f.order_on)&&f.order_on<=a.day&&date(f.valid_from)&&nullableDate(f.valid_to)&&nullableDate(f.supplement_from)&&[f.instructor_amount,f.trainer_amount].every(v=>v===null||Number.isSafeInteger(v)&&v>=0&&v<=10000000)&&Array.isArray(f.members)&&f.members.length>0&&f.members.length<=200,400,'Неверные реквизиты приказа');
 must(who(a,f.approved_by),403,'Подписант недоступен');
 const subjects=[],dates=[f.order_on,f.valid_from],members=[];
 for(const m of f.members){
  must(exact(m,['credential_id','acknowledged_on'])&&isId(m.credential_id)&&date(m.acknowledged_on)&&m.acknowledged_on<=a.day,400,'Укажите сертификат и фактическое ознакомление');
  const c=certificateValid(db,m.credential_id,f.valid_from);
  must(c&&c.person_id!==a.personId&&who(a,c.person_id)&&a.read('credential.read',c.id),403,'Сертификат недоступен или самоназначение');
  subjects.push(c.person_id);dates.push(m.acknowledged_on);members.push({...m,id:uuid()});
 }
 const r=personWorkResource(db,[f.approved_by,...subjects],a.day,dates);
 must(allowed(a,'order.register',f.approved_by,r)&&allowed(a,'order.read',f.approved_by,r),403,'Не все участники входят в единую область полномочий');
 return emit(db,a,'mentor_order',uuid(),'create',0,{...f,members},'order.register');
}
export function orderDetail(db,a,id){
 const v=isId(id)&&a.read('order.read',id),o=v&&one(db,'SELECT * FROM mentor_order WHERE id=?',[id]);
 must(o&&allowed(a,'order.detail',id,orderResource(db,o,a.day)),404,'Приказ недоступен');
 const members=rows(db,'SELECT id,person_id,person_name,position_name,role,acknowledged_on,revoked_at FROM mentor_appointment WHERE order_id=? ORDER BY person_name,id',[id]);
 return {id:o.id,order_number:o.order_number,order_on:o.order_on,organization:o.organization,city:o.city,approved_name:o.approved_name,valid_from:o.valid_from,valid_to:o.valid_to,supplement_from:o.supplement_from,instructor_amount:o.instructor_amount,trainer_amount:o.trainer_amount,evidence:o.evidence,members:members.map(({person_id,...m})=>m)};
}
export function workflowView(db,a,action,data){
 if(action==='order.read'){
  const o=one(db,'SELECT * FROM mentor_order WHERE id=?',[data.id]);return {...data,can_detail:allowed(a,'order.detail',o.id,orderResource(db,o,a.day))};
 }
 const n=one(db,'SELECT * FROM twi_supplement WHERE id=?',[data.id]);
 return {...data,person_name:name(a,n.person_id),can_detail:allowed(a,'supplement.detail',n.id,supplementResource(db,n,a.day,JSON.parse(n.tasks_json)))};
}
export function supplementOptions(db,a){
 must(a.personId&&a.permissions.includes('supplement.create')&&a.permissions.includes('supplement.read'),403,'Ходатайства недоступны');
 // Form is deliberately scoped: an employee submits their own facts. A
 // manager can register another employee's actual request only with unit scope.
 const people=rows(db,'SELECT id,display_name name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>who(a,p.id));
 const subjects=people.filter(p=>{const r=personWorkResource(db,[p.id],a.day);return r&&allowed(a,'supplement.create',p.id,{...r,self:p.id})&&one(db,"SELECT id FROM mentor_credential WHERE person_id=? AND kind='certificate' AND role IN('instructor','internal_trainer')",[p.id])});
 return {day:a.day,subjects,people,tasks:SUPPLEMENT_TASKS};
}
const taskFields=t=>Array.isArray(t)&&t.length<=12&&t.every(x=>exact(x,['code','done_on','evidence'])&&typeof x.code==='string'&&date(x.done_on)&&txt(x.evidence,2000));
export function createSupplement(db,a,f){
 must(a.personId&&exact(f,['person_id','manager_id','role','month','tasks'])&&isId(f.person_id)&&isId(f.manager_id)&&f.person_id!==f.manager_id&&Object.hasOwn(SUPPLEMENT_TASKS,f.role)&&month(f.month)&&f.month<=a.day.slice(0,7)&&taskFields(f.tasks)&&f.tasks.every(t=>t.done_on<=a.day),400,'Неверное ходатайство');
 must(who(a,f.person_id)&&who(a,f.manager_id),403,'Участники недоступны');
 const r=supplementResource(db,{...f,state:'draft'},a.day,f.tasks);
 must(allowed(a,'supplement.create',f.person_id,r)&&allowed(a,'supplement.read',f.person_id,r),403,'Ходатайство выходит за область полномочий');
 return emit(db,a,'twi_supplement',uuid(),'create',0,f,'supplement.create');
}
export function supplementDetail(db,a,id){
 const n=isId(id)&&a.read('supplement.read',id)&&one(db,'SELECT * FROM twi_supplement WHERE id=?',[id]);
 const tasks=n&&JSON.parse(n.tasks_json),r=n&&supplementResource(db,n,a.day,tasks);
 must(n&&allowed(a,'supplement.detail',id,r),404,'Ходатайство недоступно');
 return {id:n.id,rev:n.rev,person_name:name(a,n.person_id),manager_name:name(a,n.manager_id),role:n.role,month:n.month,state:n.state,decision_note:n.decision_note,tasks,status:supplementStatus(n.role,tasks),catalog:SUPPLEMENT_TASKS[n.role],day:a.day,can_revise:!!a.personId&&n.state==='draft'&&allowed(a,'supplement.revise',id,r),can_decide:!!a.personId&&a.personId===n.manager_id&&n.state==='draft'&&allowed(a,'supplement.decide',id,r)};
}
export function changeSupplement(db,a,f){
 must(a.personId&&exact(f,['id','expected_revision','command','fields'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&['revise','approve','decline'].includes(f.command),400,'Неверная команда');
 const n=a.read('supplement.read',f.id)&&one(db,'SELECT * FROM twi_supplement WHERE id=?',[f.id]);
 must(n,404,'Ходатайство недоступно');
 const oldTasks=JSON.parse(n.tasks_json),action=f.command==='revise'?'supplement.revise':'supplement.decide';
 const old=supplementResource(db,n,a.day,oldTasks);
 must(allowed(a,action,n.id,old)&&(f.command==='revise'||a.personId===n.manager_id),403,'Решение принимает назначенный руководитель');
 must(n.rev===f.expected_revision&&n.state==='draft',409,'Ходатайство изменено или рассмотрено');
 let p;
 if(f.command==='revise'){
  must(exact(f.fields,['tasks'])&&taskFields(f.fields.tasks)&&f.fields.tasks.every(t=>t.done_on<=a.day),400,'Неверные выполненные задачи');
  must(allowed(a,action,n.id,supplementResource(db,n,a.day,f.fields.tasks)),403,'Задачи выходят за область полномочий');
  p={command:'revise',tasks:f.fields.tasks};
 }else{
  must(exact(f.fields,['note'])&&txt(f.fields.note,2000),400,'Укажите основание решения');
  p={command:f.command,actor_id:a.personId,note:f.fields.note};
 }
 return emit(db,a,'twi_supplement',n.id,'update',n.rev,p,action);
}
