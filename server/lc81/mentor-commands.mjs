// Register actual mentoring records; reuse the domain and never issue system grants.
import {one,rows,uuid,isId,applyEvent} from '../../src/core/db.js';
import {personWorkResource} from './read-policy.mjs';
import {authorizationValid} from '../../src/modules/training/domain.js';
import {PilotError} from '../lc74-store.mjs';
const must=(v,status,msg)=>{if(!v)throw new PilotError(status,msg)};
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const txt=(s,n=500)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const end=s=>s===null||date(s);
const tables=Object.freeze({credential:'mentor_credential',appointment:'mentor_appointment',authorization:'mentor_authorization'});
const fields=Object.freeze({credential:['person_id','kind','role','number','issuer','issued_on','valid_until','evidence'],appointment:['credential_id','order_number','order_on','approved_by','valid_from','valid_to','acknowledged_on','evidence'],authorization:['appointment_id','operation_id','valid_from','valid_to']});
const who=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
const name=(db,id)=>one(db,'SELECT display_name FROM person WHERE id=?',[id])?.display_name||'';
const row=(db,kind,id)=>isId(id)?one(db,'SELECT * FROM '+tables[kind]+' WHERE id=?',[id]):null;
const allowed=(a,action,id,r)=>!!r&&a.allows(action,id,r);
function revokeResource(db,kind,r,day){
 const ops=kind==='authorization'?[r.operation_id]:rows(db,'SELECT DISTINCT operation_id FROM mentor_authorization WHERE '+(kind==='credential'?'credential_id':'appointment_id')+'=? AND revoked_at IS NULL',[r.id]).map(x=>x.operation_id);
 return personWorkResource(db,[r.person_id],day,[kind==='credential'?r.issued_on:r.valid_from],ops);
}
export function mentorView(db,a,kind,data){
 const r=row(db,kind,data.id);
 return {...data,person_name:who(a,data.person_id)?name(db,data.person_id):null,...(kind==='authorization'?{operation_name:a.read('operation.read',r.operation_id)?.data.name??null,valid_now:authorizationValid(db,r.id,a.day)}:{}),can_revoke:!!a.personId&&a.personId!==r.person_id&&!r.revoked_at&&allowed(a,kind+'.revoke',r.id,revokeResource(db,kind,r,a.day))};
}
export function mentorOptions(db,a,kind){
 must(Object.hasOwn(tables,kind)&&a.personId&&a.permissions.includes(kind+'.register')&&a.permissions.includes(kind+'.read'),403,'Регистрация недоступна');
 const action=kind+'.register';
 const people=rows(db,'SELECT id,display_name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>who(a,p.id)&&allowed(a,action,p.id,personWorkResource(db,[p.id],a.day)));
 const candidates=people.filter(p=>p.id!==a.personId),out={day:a.day,people:candidates,signers:people};
 if(kind==='appointment')out.credentials=rows(db,"SELECT id,person_id,role,number FROM mentor_credential WHERE kind='certificate' AND revoked_at IS NULL ORDER BY issued_on,id").filter(r=>candidates.some(p=>p.id===r.person_id)&&a.read('credential.read',r.id)).map(r=>({id:r.id,label:name(db,r.person_id)+' · '+r.role+' · '+r.number}));
 if(kind==='authorization'){
  out.appointments=rows(db,'SELECT id,person_id,role,order_number FROM mentor_appointment WHERE revoked_at IS NULL ORDER BY order_on,id').filter(r=>candidates.some(p=>p.id===r.person_id)&&a.read('appointment.read',r.id)).map(r=>({id:r.id,label:name(db,r.person_id)+' · '+r.role+' · '+r.order_number}));
  out.operations=rows(db,'SELECT id,name,code,unit_id FROM operation WHERE archived=0 ORDER BY code,id').filter(o=>a.read('operation.read',o.id)&&allowed(a,action,o.id,{data:{},self:null,units:[o.unit_id],assigned:[]})).map(({id,name,code})=>({id,name,code}));
 }
 return out;
}
export function changeMentor(db,a,input){
 must(exact(input,['kind','command','id','expected_revision','fields'])&&Object.hasOwn(tables,input.kind)&&['register','revoke'].includes(input.command)&&a.personId,400,'Неверная команда наставничества');
 const {kind,command,id,expected_revision,fields:f}=input,action=kind+'.'+command,read=kind+'.read';
 must(a.permissions.includes(action)&&a.permissions.includes(read),403,'Команда недоступна');
 let entityId,payload,resource,subject;
 if(command==='revoke'){
  must(isId(id)&&Number.isSafeInteger(expected_revision)&&expected_revision>0&&exact(f,['reason'])&&txt(f.reason),400,'Укажите основание отзыва');
  const r=row(db,kind,id);must(r&&a.read(read,id),404,'Запись недоступна');
  subject=r.person_id;resource=revokeResource(db,kind,r,a.day);
  must(subject!==a.personId&&allowed(a,action,id,resource),403,'Недоступны полномочия на отзыв');
  must(r.rev===expected_revision&&!r.revoked_at,409,'Запись изменена или отозвана');
  entityId=id;payload={command:'revoke',reason:f.reason.trim()};
 }else{
  must(id===null&&expected_revision===0&&exact(f,fields[kind]),400,'Неверные реквизиты регистрации');
  let dates=[],ops=[],participants=[];
  if(kind==='credential'){
   must(isId(f.person_id)&&['certificate','attendance'].includes(f.kind)&&['instructor','mentor','internal_trainer'].includes(f.role)&&txt(f.number,200)&&txt(f.issuer)&&date(f.issued_on)&&f.issued_on<=a.day&&end(f.valid_until)&&txt(f.evidence),400,'Заполните реквизиты фактического документа');
   subject=f.person_id;dates=[f.issued_on];payload={...f,registered_by:a.personId};
  }else if(kind==='appointment'){
   must(isId(f.credential_id)&&isId(f.approved_by)&&txt(f.order_number,200)&&date(f.order_on)&&f.order_on<=a.day&&date(f.valid_from)&&end(f.valid_to)&&date(f.acknowledged_on)&&f.acknowledged_on<=a.day&&txt(f.evidence),400,'Заполните реквизиты подписанного приказа');
   const c=row(db,'credential',f.credential_id);must(c&&a.read('credential.read',c.id)&&who(a,f.approved_by),404,'Сертификат или подписант недоступны');
   subject=c.person_id;dates=[f.order_on,f.valid_from,f.acknowledged_on];participants=[f.approved_by];payload={...f,person_id:subject,role:c.role};
  }else{
   must(isId(f.appointment_id)&&isId(f.operation_id)&&date(f.valid_from)&&f.valid_from>=a.day&&end(f.valid_to),400,'Полномочие оформляется с текущей или будущей даты');
   const r=row(db,'appointment',f.appointment_id);must(r&&a.read('appointment.read',r.id)&&a.read('credential.read',r.credential_id)&&a.read('operation.read',f.operation_id),404,'Приказ, сертификат или операция недоступны');
   subject=r.person_id;dates=[f.valid_from];ops=[f.operation_id];payload={...f,person_id:subject,credential_id:r.credential_id,approved_by:a.personId};
  }
  must(subject!==a.personId&&who(a,subject),403,'Самоназначение или сотрудник недоступны');
  resource=personWorkResource(db,[subject,...participants],a.day,dates,ops);
  must(allowed(a,action,subject,resource)&&allowed(a,read,subject,resource),403,'Запись выходит за область полномочий');
  entityId=uuid();
 }
 const eventId=uuid();
 try{applyEvent(db,{id:eventId,entity_type:tables[kind],entity_id:entityId,operation:command==='register'?'create':'update',expected_revision,payload,occurred_at:a.at})}
 catch(e){throw new PilotError(422,'Проверка наставничества: '+String(e.message||'ошибка').split('\n')[0].slice(0,220))}
 a.audit(action,eventId);
 return {id:entityId,rev:one(db,'SELECT rev FROM '+tables[kind]+' WHERE id=?',[entityId]).rev};
}
