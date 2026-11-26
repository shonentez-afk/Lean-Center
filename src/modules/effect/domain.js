import {twiComparison} from '../training/twi-effectiveness.js';
import {calculateEffect} from './math.js';
import {economicEventDay,economicCommand} from '../../core/business-clock.js';
export {calculateEffect} from './math.js';
// LC6: calculations, event guards, current evidence and period facts.
import {invariant,one,rows,canonical} from '../../core/db.js';
import {actionRows,actionStatus} from '../training/audit-domain.js';
import {frvSummary} from '../library/frv-summary.js';
export const CURRENCIES=['RUB','EUR','USD','KZT','CNY','BYN','GBP'];
export const isLC6Event=e=>['economic_effect','economic_fact'].includes(e.entity_type);
const exact=(p,keys)=>invariant(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'Некорректные поля LC6');
const text=(x,max=2000)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const bounded=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const day=e=>economicEventDay(e);
// Period dates are inclusive. A period closes only on the following business day.
export const periodClosed=(end,asOf)=>end<asOf;
export const lastClosedDay=day=>new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const person=(db,id)=>invariant(one(db,'SELECT id FROM person WHERE id=? AND archived=0',[id]),'Выберите действующего сотрудника');
const due=(e,d)=>invariant(date(d)&&d>=day(e),'Укажите контрольный срок не раньше даты записи');
const insert=(db,t,v)=>{const keys=Object.keys(v);db.run('INSERT INTO '+t+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')',keys.map(k=>v[k]))};
const update=(db,t,id,v)=>{const keys=Object.keys(v);db.run('UPDATE '+t+' SET '+keys.map(k=>k+'=?').join(',')+',rev=rev+1 WHERE id=?',[...keys.map(k=>v[k]),id])};
export function measurementOf(raw){
 const s=frvSummary(raw);invariant(s.comparable&&s.baselineCount>0&&s.improvedCount>0,'Нужно одобренное сравнение полных циклов ФРВ до/после');
 return {before:s.before,after:s.after,baselineCount:s.baselineCount,improvedCount:s.improvedCount};
}
export function verifyEconomicSource(e,result){
 invariant(e.entity_type==='economic_effect'&&e.payload.command==='measure'&&result.source.kind==='frv'&&canonical(e.payload.source)===canonical(result.source),'Неверный исходный файл экономического эффекта');
 invariant(canonical(e.payload.measurement)===canonical(measurementOf(result.raw)),'Расчёт замеров не совпадает с оригиналом ФРВ');
}
export function effectEvidence(db,record,allActions=actionRows(db)){
 return allActions.filter(a=>record.study_id?a.study_id===record.study_id:a.id===record.action_id).filter(a=>actionStatus(db,a)==='verified').map(a=>({id:a.id,verification_id:one(db,"SELECT id FROM action_verification WHERE action_id=? AND outcome='effective' ORDER BY checked_at DESC,id DESC LIMIT 1",[a.id])?.id})).filter(a=>a.verification_id).sort((a,b)=>a.id.localeCompare(b.id));
}
export function twiBasis(db,id){const e=one(db,"SELECT id,payload_json,occurred_at FROM change_event WHERE entity_type='economic_effect' AND entity_id=? AND json_extract(payload_json,'$.command')='twi_basis' ORDER BY expected_revision DESC,id DESC LIMIT 1",[id]);return e?{...e,p:JSON.parse(e.payload_json)}:null}
export function twiBasisCurrent(db,r,id){const b=twiBasis(db,r.id);if(!b||b.id!==id)return false;try{return canonical(twiComparison(db,b.p.scope,b.p.scope.after_to))===canonical(b.p.comparison)}catch{return false}}
export function twiEffectsFor(db,kind,id){return effectRows(db).filter(r=>{const b=twiBasis(db,r.id);if(!b)return false;const p=b.p;return kind==='program'?p.scope.kind==='program'&&p.scope.source_id===id:kind==='assignment'?(p.scope.kind==='assignment'&&p.scope.source_id===id||[...p.comparison.before,...p.comparison.after].some(x=>x.assignmentIds?.includes(id))):kind==='enrollment'?p.scope.kind==='program'&&[...p.comparison.before,...p.comparison.after].some(x=>x.id===id):kind==='revision'?[...p.comparison.before,...p.comparison.after].some(x=>(x.assignmentIds||[]).some(a=>one(db,'SELECT sop_revision_id FROM training_assignment WHERE id=?',[a])?.sop_revision_id===id)):kind==='person'?p.actor_id===id||r.owner_id===id||JSON.parse(r.actual_json||'null')?.reviewer_id===id||[...p.comparison.before,...p.comparison.after].some(x=>x.person===id||p.scope.kind==='program'&&!!one(db,'SELECT id FROM training_enrollment WHERE id=? AND (mentor_id=? OR manager_id=? OR finished_by=?)',[x.id,id,id,id])||(x.assignmentIds||[]).some(a=>!!one(db,'SELECT id FROM training_assignment WHERE id=? AND (mentor_id=? OR supervisor_id=? OR assigned_by=?)',[a,id,id,id])||!!one(db,'SELECT id FROM assessment_session WHERE assignment_id=? AND evaluator_id=?',[a,id])||!!one(db,'SELECT id FROM audit_session WHERE assignment_id=? AND auditor_id=?',[a,id]))):false})}
function snapshotCurrent(db,r,a,allActions){
 if(r.state!=='active'||!a)return false;
 const basis=twiBasis(db,r.id);if(basis&&(!a.twi_basis_id||!twiBasisCurrent(db,r,a.twi_basis_id)))return false;
 if(r.study_id){const f=one(db,'SELECT state,context_json FROM frv_study WHERE id=?',[r.study_id]);if(f?.state!=='final'||JSON.parse(f.context_json).source.sha256!==a.source?.sha256)return false}
 const evidence=effectEvidence(db,r,allActions);return a.actions.length>0&&a.actions.every(x=>evidence.some(y=>y.id===x.id&&y.verification_id===x.verification_id));
}
export function effectCurrent(db,r,actions){return snapshotCurrent(db,r,r.actual_json?JSON.parse(r.actual_json):null,actions)}
export const effectPending=(db,r,actions)=>r.state==='active'&&(!r.reviewed_at||!effectCurrent(db,r,actions));
export function effectStatus(db,r,actions){return r.state==='cancelled'?'Отменено':effectPending(db,r,actions)?r.actual_json?'Требуется повторная проверка':'Ожидает проверки':'Расчёт проверен'}
export function effectRows(db){return rows(db,'SELECT * FROM economic_effect ORDER BY review_due,id')}
export function effectFacts(db,id){return rows(db,'SELECT * FROM economic_fact WHERE effect_id=? ORDER BY period_from,period_to,id',[id])}
export function effectForSource(db,studyId,actionId){
 if(actionId&&!studyId)studyId=one(db,'SELECT f.study_id FROM action_item a LEFT JOIN finding f ON f.id=a.finding_id WHERE a.id=?',[actionId])?.study_id||null;
 return studyId?one(db,'SELECT * FROM economic_effect WHERE study_id=?',[studyId]):actionId?one(db,'SELECT * FROM economic_effect WHERE action_id=?',[actionId]):null;
}
export function factNet(f){return f.gross_minor-f.recurring_minor-f.investment_minor}
export function factCurrent(db,r,f,actions){
 const event=one(db,"SELECT payload_json FROM change_event WHERE id=? AND entity_type='economic_effect' AND entity_id=?",[f.actual_event_id,r.id]);
 const snapshot=event?JSON.parse(event.payload_json):null;return snapshot?.command==='measure'&&snapshotCurrent(db,r,snapshot,actions);
}
export function effectOverview(db,{day,from='',to=day,unitId='',personId=''}){
 const actions=actionRows(db),effects=effectRows(db).filter(r=>(!unitId||r.unit_id===unitId)&&(!personId||r.owner_id===personId)),facts=[],currencies=new Map();
 let pending=0,overdue=0,stale=0,drafts=0;
 const pendingRows=[],overdueRows=[],draftRows=[];
 for(const r of effects){const current=effectCurrent(db,r,actions);if(effectPending(db,r,actions)){pending++;pendingRows.push(r);if(r.review_due<day){overdue++;overdueRows.push(r)}}if(r.state==='active'&&r.actual_json&&!current)stale++;
  for(const f of effectFacts(db,r.id)){if(f.state==='draft'&&r.state==='active'){drafts++;draftRows.push({...f,effect:r})}if(f.state!=='confirmed'||f.period_from<from||f.period_to>to||!periodClosed(f.period_to,day))continue;
   const eligible=factCurrent(db,r,f,actions);facts.push({...f,effect:r,eligible});if(!eligible)continue;
   const v=currencies.get(r.currency)||{currency:r.currency,count:0,gross:0,recurring:0,investment:0,net:0};v.count++;v.gross+=f.gross_minor;v.recurring+=f.recurring_minor;v.investment+=f.investment_minor;v.net+=factNet(f);currencies.set(r.currency,v);
  }
 }
 const allTargets=periodTargetsFor(db,effects,day,actions),targets=allTargets.filter(t=>t.from>=from&&t.to<=to),targetAttention=allTargets.filter(targetNeedsAttention),shortfalls=targets.filter(t=>t.shortfall&&!t.currentReview);
 return {effects,pending,overdue,stale,drafts,pendingRows,overdueRows,draftRows,facts,targets,allTargets,targetAttention,shortfalls,currencies:[...currencies.values()].sort((a,b)=>a.currency.localeCompare(b.currency))};
}
function factValues(db,e,p,r,exclude=null){
 invariant(r.state==='active'&&effectCurrent(db,r)&&r.actual_event_id===p.actual_event_id,'Нужен действующий проверенный расчёт');
 invariant(date(p.period_from)&&date(p.period_to)&&p.period_from<=p.period_to&&periodClosed(p.period_to,day(e)),'Укажите завершённый период факта: последний день должен быть раньше текущей местной даты');
 invariant([p.gross_minor,p.recurring_minor,p.investment_minor].every(Number.isSafeInteger)&&bounded(p.gross_minor,-1e12,1e12)&&bounded(p.recurring_minor,0,1e12)&&bounded(p.investment_minor,0,1e12),'Суммы в сотых долях денежной единицы; проверьте диапазон');
 person(db,p.registered_by);invariant(text(p.evidence),'Укажите первичные документы и основание денежного факта');
 invariant(!one(db,"SELECT id FROM economic_fact WHERE effect_id=? AND state<>'void' AND id<>? AND period_from<=? AND period_to>=? LIMIT 1",[r.id,exclude||'',p.period_to,p.period_from]),'Период пересекается с существующим фактом этой карточки');
 // A recorded fact must not cross a defined target boundary: never allocate money by guesswork.
 invariant(!periodTargets(db,r,day(e)).some(t=>!t.cancel&&t.from<=p.period_to&&t.to>=p.period_from&&(p.period_from<t.from||p.period_to>t.to)),'Денежный факт пересекает границу цели. Укажите отдельные подтверждённые периоды по первичным документам');
 return {actual_event_id:p.actual_event_id,period_from:p.period_from,period_to:p.period_to,gross_minor:p.gross_minor,recurring_minor:p.recurring_minor,investment_minor:p.investment_minor,registered_by:p.registered_by,evidence:p.evidence.trim()};
}
// Period targets and explanations are immutable journal events on the existing
// card. No duplicate register, no schema bump, and no implicit monthly proration.
export const DEVIATION_CAUSES=Object.freeze({volume:'Объём / загрузка',time:'Время операции',realization:'Реализация экономии',rate:'Стоимость / ставка',cost:'Дополнительные затраты',investment:'Инвестиции',delay:'Сроки внедрения',quality:'Качество / повторные потери',other:'Иная причина'});
const nextDay=d=>new Date(Date.parse(d)+86400000).toISOString().slice(0,10);
export function periodTargets(db,r,asOf,actions=actionRows(db)){
 const events=rows(db,"SELECT id,occurred_at,expected_revision,payload_json FROM change_event WHERE entity_type='economic_effect' AND entity_id=? ORDER BY expected_revision,id",[r.id]).map(e=>({...e,p:JSON.parse(e.payload_json)})),targets=events.filter(e=>e.p?.command==='period_target'),facts=effectFacts(db,r.id);
 return targets.map(t=>{
  const p=t.p,cancel=events.find(e=>e.p?.command==='period_target_cancel'&&e.p.target_id===t.id);
  const available=facts.filter(f=>f.period_from>=p.from&&f.period_to<=p.to&&periodClosed(f.period_to,asOf)&&f.state==='confirmed'&&factCurrent(db,r,f,actions));
  let cursor=p.from;for(const f of available){if(f.period_from!==cursor)break;cursor=nextDay(f.period_to)}
  const closed=periodClosed(p.to,asOf),complete=closed&&cursor===nextDay(p.to)&&!cancel&&r.state==='active',actual=available.reduce((s,f)=>s+factNet(f),0),signature=available.map(f=>f.id+':'+f.rev).join('|');
  const reviews=events.filter(e=>e.p?.command==='period_review'&&e.p.target_id===t.id),review=reviews.at(-1)||null;
  const currentReview=complete&&review?.p.signature===signature&&review?.p.actual_minor===actual;
  const delta=complete?actual-p.target_minor:null,shortfall=delta!==null&&delta<0;
  return {id:t.id,record:r,from:p.from,to:p.to,target:p.target_minor,basis:p.basis,actor_id:p.actor_id,created_at:t.occurred_at,late:day(t)>p.from,cancel,closed,complete,actual,delta,signature,factCount:available.length,review,currentReview:!!currentReview,shortfall,status:cancel?'Отменена':r.state!=='active'?'Карточка отменена':!closed?'Период открыт':!complete?'Неполное покрытие фактами':shortfall&&!currentReview?'Требуется разбор отклонения':shortfall?'Отклонение разобрано':'Цель достигнута'}
 })
}
export function periodTargetsFor(db,effects,asOf,actions=actionRows(db)){
 return effects.flatMap(r=>periodTargets(db,r,asOf,actions)).sort((a,b)=>a.to.localeCompare(b.to)||a.id.localeCompare(b.id))
}
export const targetNeedsAttention=t=>t.record.state==='active'&&!t.cancel&&(!t.closed||!t.complete||t.shortfall&&!t.currentReview);
function applyPeriodCommand(db,e,r){
 const p=economicCommand(e.payload),ts=periodTargets(db,r,day(e)),t=ts.find(x=>x.id===p.target_id);
 if(p.command==='period_target'){
  exact(p,['command','from','to','target_minor','basis','actor_id']);
  person(db,p.actor_id);invariant(date(p.from)&&date(p.to)&&p.from<=p.to&&!periodClosed(p.to,day(e)),'Укажите период цели, который ещё не завершён');
  invariant(Number.isSafeInteger(p.target_minor)&&bounded(p.target_minor,-1e12,1e12)&&text(p.basis),'Укажите чистую денежную цель и основание');
  invariant(!ts.some(x=>!x.cancel&&x.from<=p.to&&x.to>=p.from),'Период пересекается с существующей целью');
  invariant(!effectFacts(db,r.id).some(f=>f.state!=='void'&&f.period_from<=p.to&&f.period_to>=p.from),'Цель нельзя назначать задним числом после регистрации факта');
 }else if(p.command==='period_target_cancel'){
  exact(p,['command','target_id','actor_id','reason']);person(db,p.actor_id);
  invariant(t&&!t.cancel&&!t.closed&&text(p.reason),'Отменить можно только открытую цель с указанием причины');
  invariant(!effectFacts(db,r.id).some(f=>f.state!=='void'&&f.period_from<=t.to&&f.period_to>=t.from),'Для цели уже зарегистрированы денежные факты');
 }else{
  exact(p,['command','target_id','actor_id','cause','note','action_id','signature','actual_minor']);person(db,p.actor_id);
  invariant(t&&!t.cancel&&t.complete&&t.shortfall&&p.signature===t.signature&&p.actual_minor===t.actual,'Для разбора требуется завершённая цель с полным актуальным фактом и отрицательным отклонением');
  invariant(Object.hasOwn(DEVIATION_CAUSES,p.cause)&&text(p.note),'Укажите причину отклонения и решение');
  if(p.action_id!==null)invariant(actionRows(db).some(a=>a.id===p.action_id&&a.state!=='cancelled'),'Выберите существующее мероприятие');
 }
 // Revision is advanced by this event; target/review data are projected from
 // the same change_event ledger after atomic application.
 db.run('UPDATE economic_effect SET rev=rev+1 WHERE id=?',[r.id])
}
export function applyEconomicEvent(db,e,old){
 day(e); // validate the persisted offset, even for commands without date guards
 const p=economicCommand(e.payload),id=e.entity_id,t=e.entity_type;
 if(t==='economic_effect'){
  if(!old){
   exact(p,['command','study_id','action_id','owner_id','unit_id','currency','method','title','plan','plan_basis','review_due']);
   invariant(e.operation==='create'&&p.command==='create'&&((!!p.study_id)!=(!!p.action_id))&&text(p.title,500)&&CURRENCIES.includes(p.currency),'Укажите источник, название и валюту');
   person(db,p.owner_id);invariant(one(db,'SELECT id FROM org_unit WHERE id=? AND archived=0',[p.unit_id]),'Выберите подразделение');
   invariant(!effectForSource(db,p.study_id,p.action_id),'Для источника уже существует карточка эффекта');
   if(p.study_id){const f=one(db,'SELECT f.state,o.unit_id FROM frv_study f JOIN operation o ON o.id=f.operation_id WHERE f.id=?',[p.study_id]);invariant(f&&f.state!=='archived'&&f.unit_id===p.unit_id&&p.method==='time','ФРВ требует своего подразделения и расчёта по времени')}
   else{const a=actionRows(db).find(x=>x.id===p.action_id);invariant(a&&a.state!=='cancelled'&&!a.study_id,'Выберите самостоятельное мероприятие; для связанного ФРВ используйте его общую карточку')}
   calculateEffect(p.method,p.plan);invariant(text(p.plan_basis),'Укажите основание планового расчёта');due(e,p.review_due);
   insert(db,t,{id,study_id:p.study_id,action_id:p.action_id,owner_id:p.owner_id,unit_id:p.unit_id,currency:p.currency,method:p.method,title:p.title.trim(),plan_json:canonical(p.plan),plan_basis:p.plan_basis.trim(),review_due:p.review_due,state:'active',created_at:e.occurred_at,rev:1});return
  }
  invariant(e.operation==='update'&&old.state==='active','Карточка недоступна для изменения');
  if(p.command==='twi_basis'){
   exact(p,['command','scope','comparison','actor_id','note']);person(db,p.actor_id);invariant(old.action_id&&!old.study_id&&old.method==='time'&&text(p.note),'Основание TWI связывается с карточкой мероприятия с методом времени');
   const scope=p.scope;exact(scope,['kind','source_id','unit_id','before_from','before_to','after_from','after_to']);const c=twiComparison(db,scope,day(e));invariant(c.comparable&&c.unit_id===old.unit_id&&canonical(c)===canonical(p.comparison),'Требуются сопоставимые завершённые группы TWI того же подразделения');
   invariant(!one(db,"SELECT id FROM economic_fact WHERE effect_id=? AND state='draft'",[id]),'Сначала разрешите черновики денежных фактов');
   invariant(!one(db,"SELECT id FROM economic_fact WHERE effect_id=? AND state='confirmed'",[id]),'Для изменения основания сначала разрешите подтверждённые денежные факты; история сохранится');
   const keys=x=>[...x.flatMap(a=>[...a.facts.map(f=>f[0]),...(a.assignmentIds||[]),a.id])],ids=new Set(keys(c.after));for(const other of effectRows(db).filter(x=>x.id!==id&&x.state==='active')){const b=twiBasis(db,other.id);invariant(!b||!keys(b.p.comparison.after).some(k=>ids.has(k)),'Эти результаты TWI уже учтены в другой активной карточке');}
   update(db,t,id,{reviewed_at:null});return
  }
  if(['period_target','period_target_cancel','period_review'].includes(p.command)){applyPeriodCommand(db,e,old);return}
  if(p.command==='plan'){exact(p,['command','plan','plan_basis']);invariant(!old.actual_json,'Исходный план зафиксирован после проверки расчёта');calculateEffect(old.method,p.plan);invariant(text(p.plan_basis),'Укажите основание планового расчёта');update(db,t,id,{plan_json:canonical(p.plan),plan_basis:p.plan_basis.trim()});return}
  if(p.command==='reschedule'){exact(p,['command','review_due','reason']);due(e,p.review_due);invariant(text(p.reason),'Укажите основание нового срока');update(db,t,id,{review_due:p.review_due,reviewed_at:null});return}
  if(p.command==='cancel'){exact(p,['command','reason']);invariant(text(p.reason)&&!one(db,"SELECT id FROM economic_fact WHERE effect_id=? AND state<>'void'",[id]),'Укажите основание; сначала разрешите все денежные факты');update(db,t,id,{state:'cancelled'});return}
  const basis=twiBasis(db,id);exact(p,['command','inputs','measurement','reviewer_id','evidence','actions','source',...(basis?['twi_basis_id']:[])]);if(basis){invariant(p.twi_basis_id===basis.id&&twiBasisCurrent(db,old,basis.id),'Сравнение TWI утратило актуальность');invariant(p.inputs.deltaSeconds===basis.p.comparison.deltaMinutes*60,'Разница времени должна следовать из зафиксированного сравнения TWI')};invariant(p.command==='measure'&&text(p.evidence),'Укажите основание проверки расчёта');
  person(db,p.reviewer_id);invariant(p.reviewer_id!==old.owner_id,'Проверяющий отличается от ответственного');
  const available=effectEvidence(db,old);invariant(Array.isArray(p.actions)&&p.actions.length>0&&p.actions.length<=1000&&new Set(p.actions.map(x=>x.id)).size===p.actions.length&&p.actions.every(x=>available.some(y=>canonical(x)===canonical(y))),'Нужны связанные мероприятия с действующей проверкой эффективности');
  invariant(!one(db,"SELECT id FROM economic_fact WHERE effect_id=? AND state='draft'",[id]),'Сначала подтвердите или аннулируйте черновики денежных фактов');
  if(old.study_id){
   const f=one(db,'SELECT * FROM frv_study WHERE id=?',[old.study_id]);
   invariant(f?.state==='final'&&p.source&&canonical(JSON.parse(f.context_json).source)===canonical(p.source),'Нужен точный исходник завершённого ФРВ');
   invariant(!rows(db,"SELECT actual_json FROM economic_effect WHERE id<>? AND actual_json IS NOT NULL AND state='active'",[id]).some(x=>JSON.parse(x.actual_json).source?.sha256===p.source.sha256),'Этот файл ФРВ уже используется для другой активной карточки эффекта');
   exact(p.measurement,['before','after','baselineCount','improvedCount']);invariant(bounded(p.measurement.before,0,1e9)&&bounded(p.measurement.after,0,1e9)&&Number.isSafeInteger(p.measurement.baselineCount)&&p.measurement.baselineCount>0&&Number.isSafeInteger(p.measurement.improvedCount)&&p.measurement.improvedCount>0,'Нет сопоставимых полных циклов');
   invariant(p.inputs.deltaSeconds===p.measurement.before-p.measurement.after,'Разница должна следовать из замеров ФРВ');
  }else{invariant(p.source===null&&p.measurement===null,'Для самостоятельного мероприятия используйте документированное ручное основание')}
  calculateEffect(old.method,p.inputs);
  update(db,t,id,{actual_json:canonical({inputs:p.inputs,measurement:p.measurement,reviewer_id:p.reviewer_id,evidence:p.evidence.trim(),actions:p.actions,source:p.source,...(basis?{twi_basis_id:basis.id}:{}),at:e.occurred_at}),actual_event_id:e.id,reviewed_at:e.occurred_at});return
 }
 invariant(t==='economic_fact','Неизвестное событие LC6');
 const fields=['actual_event_id','period_from','period_to','gross_minor','recurring_minor','investment_minor','registered_by','evidence'];
 if(!old){exact(p,['command','effect_id',...fields]);const r=one(db,'SELECT * FROM economic_effect WHERE id=?',[p.effect_id]);invariant(e.operation==='create'&&p.command==='create'&&r,'Выберите карточку эффекта');insert(db,t,{id,effect_id:r.id,...factValues(db,e,p,r),state:'draft',created_at:e.occurred_at,rev:1});return}
 const r=one(db,'SELECT * FROM economic_effect WHERE id=?',[old.effect_id]);
 invariant(e.operation==='update'&&old.state!=='void','Факт аннулирован или недоступен');
 if(p.command==='save'){exact(p,['command',...fields]);invariant(old.state==='draft'&&p.registered_by===old.registered_by,'Редактируется только черновик его регистратора');update(db,t,id,factValues(db,e,p,r,id));return}
 if(p.command==='confirm'){exact(p,['command','verifier_id','note']);person(db,p.verifier_id);invariant(periodClosed(old.period_to,day(e)),'Подтвердить можно только завершённый период факта');invariant(old.state==='draft'&&p.verifier_id!==r.owner_id&&p.verifier_id!==old.registered_by&&text(p.note),'Нужен независимый проверяющий и основание подтверждения');invariant(r.actual_event_id===old.actual_event_id&&effectCurrent(db,r),'Исходное подтверждение расчёта утратило актуальность');update(db,t,id,{state:'confirmed',verifier_id:p.verifier_id,confirmed_at:e.occurred_at,confirmation_note:p.note.trim()});return}
 exact(p,['command','actor_id','reason']);person(db,p.actor_id);invariant(p.command==='void'&&text(p.reason),'Укажите причину аннулирования');if(old.state==='confirmed')invariant(p.actor_id!==old.registered_by&&p.actor_id!==r.owner_id,'Аннулирование подтверждённого факта требует независимого проверяющего');update(db,t,id,{state:'void',void_by:p.actor_id,void_reason:p.reason.trim(),void_at:e.occurred_at});
}
