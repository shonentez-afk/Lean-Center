// LC6 economic workflows. Annual scenarios and confirmed period money
// remain separate. Financial detail/write requires a full site grant.
import {createHash} from 'node:crypto';
import {one,rows,uuid,isId,canonical,applyEvent} from '../../src/core/db.js';
import {CURRENCIES,calculateEffect,effectStatus,effectEvidence,effectCurrent,effectFacts,factCurrent,factNet,periodTargets,DEVIATION_CAUSES,measurementOf,twiBasis,twiBasisCurrent,lastClosedDay} from '../../src/modules/effect/domain.js';
import {twiComparison} from '../../src/modules/training/twi-effectiveness.js';
import {actionRows,actionStatus} from '../../src/modules/training/audit-domain.js';
import {personUnit} from '../../src/modules/training/center-overview.js';
import {programResource} from './read-policy.mjs';
import {recordAccess,financialRecordAllowed,financialScope,comparisonAllowed} from './center-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const txt=(s,n=2000)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const who=(a,id)=>id&&(a.read('person.read_directory',id)||a.read('person.read_basic',id));
const name=(a,id)=>who(a,id)?.data.display_name??null;
const find=(db,t,id)=>isId(id)?one(db,'SELECT * FROM '+t+' WHERE id=?',[id]):null;
const site=(db,a,k)=>{const r=programResource(db);return !!r&&a.scope(k,r.units[0],r)};
const cap=(db,a,k)=>!!a.personId&&financialScope(db,a)&&site(db,a,k);
const fail=e=>new PilotError(422,'Экономический эффект: '+String(e.message||'ошибка').split('\n')[0].slice(0,300));
function emit(db,a,t,id,operation,rev,payload,action){
 const event=uuid();
 // LC8.1 business clock is still UTC. Keep the recorded offset explicit,
 // and never accept a timestamp or actor from the browser.
 try{applyEvent(db,{id:event,entity_type:t,entity_id:id,operation,expected_revision:rev,payload:{...payload,business_offset_minutes:0},occurred_at:a.at})}catch(e){throw fail(e)}
 a.audit(action,event);return {id,rev:one(db,'SELECT rev FROM '+t+' WHERE id=?',[id]).rev};
}
function calc(method,inputs){try{return calculateEffect(method,inputs)}catch(e){throw fail(e)}}
function get(db,a,id){
 const r=find(db,'economic_effect',id);
 must(r&&financialRecordAllowed(db,a,id),404,'Карточка эффекта недоступна');
 return r;
}
function commandCard(db,a,f,k){
 must(a.personId&&isId(f.id)&&Number.isSafeInteger(f.expected_revision),400,'Неверная ревизия карточки');
 const r=get(db,a,f.id);must(cap(db,a,k),403,'Нет полномочий на действие');
 must(r.rev===f.expected_revision&&r.state==='active',409,'Карточка изменена или закрыта');return r;
}
const availableActions=(db,a,r)=>effectEvidence(db,r).filter(x=>recordAccess(db,a,'task',x.id));
const summary=(db,a,r,x)=>({id:x.id,rev:x.rev,period_from:x.period_from,period_to:x.period_to,gross_minor:x.gross_minor,recurring_minor:x.recurring_minor,investment_minor:x.investment_minor,net_minor:factNet(x),state:x.state,current:factCurrent(db,r,x),registered_by:name(a,x.registered_by),verifier:name(a,x.verifier_id),evidence:x.evidence,note:x.confirmation_note||x.void_reason||null,cap:{save:x.state==='draft'&&x.registered_by===a.personId&&cap(db,a,'roi.fact.save'),confirm:x.state==='draft'&&a.personId!==x.registered_by&&a.personId!==r.owner_id&&cap(db,a,'roi.fact.confirm'),void:x.state!=='void'&&(x.state!=='confirmed'||a.personId!==x.registered_by&&a.personId!==r.owner_id)&&cap(db,a,'roi.fact.void')}});
export function roiOptions(db,a){
 must(cap(db,a,'roi.create'),403,'Создание карточки эффекта недоступно');
 const units=rows(db,'SELECT id,name FROM org_unit WHERE archived=0 ORDER BY name,id').filter(u=>a.read('org.read',u.id));
 const people=rows(db,'SELECT id,display_name name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>who(a,p.id));
 const frv=rows(db,"SELECT f.id,f.title,o.unit_id FROM frv_study f JOIN operation o ON o.id=f.operation_id WHERE f.state<>'archived' AND NOT EXISTS(SELECT 1 FROM economic_effect e WHERE e.study_id=f.id) ORDER BY f.title,f.id").filter(f=>recordAccess(db,a,'frv',f.id)&&units.some(u=>u.id===f.unit_id)).map(f=>({id:f.id,label:f.title,unit_id:f.unit_id}));
 const actions=actionRows(db).filter(x=>x.state!=='cancelled'&&!x.study_id&&!one(db,'SELECT id FROM economic_effect WHERE action_id=?',[x.id])&&recordAccess(db,a,'task',x.id)).map(x=>({id:x.id,label:x.title,unit_id:personUnit(db,x.owner_id,a.day)})).filter(x=>units.some(u=>u.id===x.unit_id));
 return {day:a.day,units,people,frv,actions,currencies:CURRENCIES};
}
export function createRoi(db,a,f){
 must(exact(f,['study_id','action_id','owner_id','unit_id','currency','method','title','plan','plan_basis','review_due'])&&((f.study_id===null&&isId(f.action_id))||(f.action_id===null&&isId(f.study_id)))&&[f.owner_id,f.unit_id].every(isId)&&CURRENCIES.includes(f.currency)&&['time','direct'].includes(f.method)&&txt(f.title,500)&&txt(f.plan_basis)&&date(f.review_due)&&f.review_due>=a.day,400,'Неверные реквизиты карточки');
 const d=roiOptions(db,a),source=(f.study_id?d.frv:d.actions).find(x=>x.id===(f.study_id||f.action_id));
 must(source&&source.unit_id===f.unit_id&&d.people.some(x=>x.id===f.owner_id)&&d.units.some(x=>x.id===f.unit_id)&&(!f.study_id||f.method==='time'),403,'Источник, подразделение или ответственный недоступны');
 calc(f.method,f.plan);
 return emit(db,a,'economic_effect',uuid(),'create',0,{command:'create',...f},'roi.create');
}
export function roiView(db,a,data){
 const r=find(db,'economic_effect',data.id),ok=r&&financialRecordAllowed(db,a,r.id);
 return {...data,owner:ok?name(a,r.owner_id):null,display_state:ok?effectStatus(db,r):null,can_detail:!!ok};
}
export function roiDetail(db,a,id){
 const r=get(db,a,id),plan=JSON.parse(r.plan_json),actual=JSON.parse(r.actual_json||'null'),current=effectCurrent(db,r),basis=twiBasis(db,r.id),open=r.state==='active',can=k=>open&&cap(db,a,k);
 const facts=effectFacts(db,id).map(x=>summary(db,a,r,x)),targets=periodTargets(db,r,a.day).map(t=>({id:t.id,from:t.from,to:t.to,target_minor:t.target,actual_minor:t.complete?t.actual:null,partial_minor:t.factCount?t.actual:null,delta_minor:t.delta,complete:t.complete,status:t.status,basis:t.basis,signature:t.signature,review:t.review?{current:t.currentReview,cause:DEVIATION_CAUSES[t.review.p.cause],note:t.review.p.note,route:t.review.p.action_id&&recordAccess(db,a,'task',t.review.p.action_id)?{type:'task',id:t.review.p.action_id}:null}:null,cap:{cancel:can('roi.target.cancel')&&!t.cancel&&!t.closed,review:can('roi.target.review')&&t.complete&&t.shortfall&&!t.currentReview}}));
 return {id:r.id,rev:r.rev,title:r.title,owner:name(a,r.owner_id),currency:r.currency,method:r.method,state:r.state,status:effectStatus(db,r),review_due:r.review_due,day:a.day,last_closed:lastClosedDay(a.day),plan:{inputs:plan,result:calc(r.method,plan),basis:r.plan_basis},actual:actual?{inputs:actual.inputs,result:calc(r.method,actual.inputs),measurement:actual.measurement,evidence:actual.evidence,reviewer:name(a,actual.reviewer_id),at:actual.at,current}:null,
 source:{type:r.study_id?'frv':'task',id:r.study_id||r.action_id},actions:availableActions(db,a,r).map(x=>({id:x.id,label:one(db,'SELECT title FROM action_item WHERE id=?',[x.id])?.title||'Мероприятие'})),
 facts,targets,causes:DEVIATION_CAUSES,twi:basis?{current:twiBasisCurrent(db,r,basis.id),scope:basis.p.scope,baseline:basis.p.comparison.baseline,result:basis.p.comparison.result,delta_minutes:basis.p.comparison.deltaMinutes,note:basis.p.note}:null,
 cap:{plan:can('roi.plan')&&!actual,reschedule:can('roi.reschedule'),cancel:can('roi.cancel')&&!facts.some(x=>x.state!=='void'),measure:can('roi.measure')&&a.personId!==r.owner_id&&!facts.some(x=>x.state==='draft'),fact:can('roi.fact.create')&&current,target:can('roi.target'),twi:can('roi.twi_basis')&&r.method==='time'&&!r.study_id&&!facts.some(x=>x.state!=='void')}};
}
export function roiMeasureContext(db,a,f){
 must(exact(f,['id','expected_revision','inputs','evidence','action_ids'])&&txt(f.evidence)&&Array.isArray(f.action_ids)&&f.action_ids.length>=1&&f.action_ids.length<=1000&&f.action_ids.every(isId)&&new Set(f.action_ids).size===f.action_ids.length,400,'Укажите фактические основания и мероприятия');
 const r=commandCard(db,a,f,'roi.measure');
 must(a.personId!==r.owner_id,403,'Проверяющий должен отличаться от ответственного');
 const actions=availableActions(db,a,r);
 must(f.action_ids.every(id=>actions.some(x=>x.id===id)),422,'Требуются доступные мероприятия с действующей проверкой эффективности');
 return {r,actions:f.action_ids.map(id=>actions.find(x=>x.id===id)).sort((a,b)=>a.id.localeCompare(b.id)),basis:twiBasis(db,r.id)};
}
export function measureRoi(db,a,f,verified=null){
 const {r,actions,basis}=roiMeasureContext(db,a,f);
 let source=null,measurement=null,inputs=f.inputs;
 if(r.study_id){
  const row=find(db,'frv_study',r.study_id),desc=row&&JSON.parse(row.context_json).source;
  must(verified&&row?.state==='final'&&canonical(desc)===canonical(verified.source),409,'Финальный исходник ФРВ изменился');
  try{measurement=measurementOf(verified.raw)}catch(e){throw fail(e)}
  source=verified.source;inputs={...inputs,deltaSeconds:measurement.before-measurement.after};
 }
 if(basis){
  must(twiBasisCurrent(db,r,basis.id)&&comparisonAllowed(db,a,basis.p.scope,basis.p.comparison),422,'Сравнение TWI утратило актуальность');
  inputs={...inputs,deltaSeconds:basis.p.comparison.deltaMinutes*60};
 }
 calc(r.method,inputs);
 return emit(db,a,'economic_effect',r.id,'update',r.rev,{command:'measure',inputs,measurement,reviewer_id:a.personId,evidence:f.evidence,actions,source,...(basis?{twi_basis_id:basis.id}:{})},'roi.measure');
}
function comparison(db,a,r,scope){
 must(exact(scope,['kind','source_id','unit_id','before_from','before_to','after_from','after_to'])&&['assignment','program'].includes(scope.kind)&&isId(scope.source_id)&&scope.unit_id===r.unit_id&&[scope.before_from,scope.before_to,scope.after_from,scope.after_to].every(date),400,'Неверный период сравнения TWI');
 must(r.action_id&&r.method==='time'&&!r.study_id,422,'Сравнение доступно для самостоятельного мероприятия по времени');
 let c;try{c=twiComparison(db,scope,a.day)}catch(e){throw fail(e)}
 must(c.unit_id===r.unit_id&&comparisonAllowed(db,a,scope,c),403,'Сравнение выходит за область доступа');
 return {c,stamp:createHash('sha256').update(canonical(c)).digest('hex')};
}
export function roiTwiOptions(db,a,id){
 const r=get(db,a,id);must(cap(db,a,'roi.twi_basis'),403,'Сравнение TWI недоступно');
 return {unit_id:r.unit_id,day:a.day,assignments:rows(db,"SELECT a.id,a.assigned_on,o.name FROM training_assignment a JOIN operation o ON o.id=a.operation_id WHERE o.unit_id=? AND a.state<>'cancelled' AND a.source_sha256 IS NOT NULL ORDER BY a.assigned_on DESC,id",[r.unit_id]).filter(x=>recordAccess(db,a,'training',x.id)).map(x=>({id:x.id,label:x.name+' · '+x.assigned_on})),programs:rows(db,'SELECT id,title,version_no FROM training_program ORDER BY title,version_no').filter(x=>a.read('program.read',x.id)&&site(db,a,'program.detail')).map(x=>({id:x.id,label:x.title+' · v'+x.version_no}))};
}
export function previewRoiTwi(db,a,f){
 must(exact(f,['id','expected_revision','scope']),400,'Неверное сравнение');
 const r=commandCard(db,a,f,'roi.twi_basis'),{c,stamp}=comparison(db,a,r,f.scope);
 return {stamp,baseline:c.baseline,result:c.result,comparable:c.comparable,delta_minutes:c.deltaMinutes};
}
const factKeys=['period_from','period_to','gross_minor','recurring_minor','investment_minor','evidence'];
function factFields(r,a,v){
 must(date(v.period_from)&&date(v.period_to)&&[v.gross_minor,v.recurring_minor,v.investment_minor].every(Number.isSafeInteger)&&txt(v.evidence),400,'Укажите завершённый период, суммы в сотых долях и основание');
 return {actual_event_id:r.actual_event_id,...Object.fromEntries(factKeys.map(k=>[k,v[k]])),registered_by:a.personId};
}
export function changeRoi(db,a,f){
 must(exact(f,['id','expected_revision','command','fields'])&&typeof f.command==='string',400,'Неверная команда');
 const k=f.command,action='roi.'+k,r=commandCard(db,a,f,action),v=f.fields;
 let p;
 if(k==='plan'){
  must(exact(v,['plan','plan_basis'])&&txt(v.plan_basis),400,'Укажите основание плана');calc(r.method,v.plan);p={command:'plan',...v};
 }else if(k==='reschedule'){
  must(exact(v,['review_due','reason'])&&date(v.review_due)&&txt(v.reason),400,'Укажите срок и основание');p={command:'reschedule',...v};
 }else if(k==='cancel'){
  must(exact(v,['reason'])&&txt(v.reason),400,'Укажите основание отмены');p={command:'cancel',...v};
 }else if(k==='twi_basis'){
  must(exact(v,['scope','stamp','note'])&&txt(v.note)&&typeof v.stamp==='string',400,'Укажите проверенное сравнение');
  const {c,stamp}=comparison(db,a,r,v.scope);must(c.comparable&&stamp===v.stamp,409,'Сравнение изменилось или не сопоставимо');
  p={command:'twi_basis',scope:v.scope,comparison:c,actor_id:a.personId,note:v.note};
 }else if(k==='target'){
  must(exact(v,['from','to','target_minor','basis'])&&date(v.from)&&date(v.to)&&Number.isSafeInteger(v.target_minor)&&txt(v.basis),400,'Укажите период и денежную цель');p={command:'period_target',actor_id:a.personId,...v};
 }else if(k==='target.cancel'){
  must(exact(v,['target_id','reason'])&&isId(v.target_id)&&txt(v.reason),400,'Укажите цель и основание');p={command:'period_target_cancel',actor_id:a.personId,...v};
 }else if(k==='target.review'){
  must(exact(v,['target_id','signature','cause','note','action_id'])&&isId(v.target_id)&&typeof v.signature==='string'&&Object.hasOwn(DEVIATION_CAUSES,v.cause)&&txt(v.note)&&(v.action_id===null||isId(v.action_id)),400,'Укажите отклонение и решение');
  must(v.action_id===null||recordAccess(db,a,'task',v.action_id),403,'Мероприятие недоступно');
  const t=periodTargets(db,r,a.day).find(t=>t.id===v.target_id);must(t&&t.signature===v.signature,409,'Основания цели изменились');
  p={command:'period_review',actor_id:a.personId,target_id:t.id,signature:t.signature,actual_minor:t.actual,cause:v.cause,note:v.note,action_id:v.action_id};
 }else if(k==='fact.create'){
  must(exact(v,factKeys),400,'Неверный денежный факт');
  return emit(db,a,'economic_fact',uuid(),'create',0,{command:'create',effect_id:r.id,...factFields(r,a,v)},action);
 }else if(['fact.save','fact.confirm','fact.void'].includes(k)){
  const fields=k==='fact.save'?factKeys:k==='fact.confirm'?['note']:['reason'];
  must(exact(v,['fact_id','fact_rev',...fields])&&isId(v.fact_id)&&Number.isSafeInteger(v.fact_rev),400,'Неверная версия факта');
  const old=find(db,'economic_fact',v.fact_id);must(old?.effect_id===r.id&&old.rev===v.fact_rev,409,'Факт изменился');
  const cmd=k.split('.')[1];
  if(cmd==='save'){must(old.registered_by===a.personId,403,'Черновик изменяет регистратор');p={command:'save',...factFields(r,a,v)}}
  else if(cmd==='confirm'){must(txt(v.note),400,'Укажите основание');p={command:'confirm',verifier_id:a.personId,note:v.note}}
  else{must(txt(v.reason),400,'Укажите основание');p={command:'void',actor_id:a.personId,reason:v.reason}}
  return emit(db,a,'economic_fact',old.id,'update',old.rev,p,action);
 }else throw new PilotError(400,'Неизвестная команда эффекта');
 return emit(db,a,'economic_effect',r.id,'update',r.rev,p,action);
}
