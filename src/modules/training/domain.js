// LC4: explicit facts, reviewed qualifications and separately recorded admission.
import {invariant,one,rows,canonical,isId,foldKey} from '../../core/db.js';
import {directoryPeople,roleKind} from '../master-data/people-directory.js';
import {linkedTwi} from '../library/linked-materials.js';
import {validDate} from '../library/sop-review.js';
export const TRAINING_TYPES=Object.freeze({
 mentor_credential:'Документы о подготовке',mentor_appointment:'Приказы о назначении',mentor_authorization:'Полномочия наставника',
 training_program:'Программа обучения',training_enrollment:'Персональная программа',training_task_result:'Результат задания программы',
 training_assignment:'Назначение обучения',training_session:'Факт инструктажа',training_verification:'Проверка знаний',
 assessment_session:'Практическая оценка / квалификация',admission_decision:'Решение о допуске',
 role_requirement:'Требование к компетенции',coverage_requirement:'Потребность в покрытии',development_plan:'План развития',development_goal:'Цель развития'
});
export const PRACTICAL_CODE='PRACTICAL_APP8';
export const isTrainingEvent=e=>Object.hasOwn(TRAINING_TYPES,e.entity_type)||(e.entity_type==='checklist_version'&&e.payload?.format==='lean-practical-checklist-v1');
const exact=(p,keys)=>invariant(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'Некорректные поля LC4');
const text=(x,n=2000)=>typeof x==='string'&&x.length<=n;
const required=(x,n=500)=>text(x,n)&&x.trim().length>0;
const integer=(x,min=0,max=100000)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const date=x=>validDate(x);
const period=(a,b)=>date(a)&&(b===null||date(b)&&b>=a);
const within=(x,a,b)=>a<=x&&(!b||b>=x);
const beforeRevocation=(x,d)=>!x||x.slice(0,10)>d;
const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const roles=['instructor','mentor','internal_trainer'];
export const programKinds={entry:'Ввод в профессию',internship:'Стажировка',production:'Производственное обучение'};
export const parts={general:'Общая часть',individual:'Индивидуальная часть',practice:'Практические навыки',knowledge:'Проверка знаний'};
export const variants={classic:'Классический',special:'Специальные навыки',smed:'Сложность повтора / SMED',hazardous:'Особые условия безопасности'};
export const conclusions={not_meet:'Не соответствует',basic:'Соответствует базовому уровню',exceeds:'Превосходит базовый уровень'};
const prepare=[['prepare','Подготовка']];
const show=[['show1','Показ: действия'],['show2','Показ: действия и ключевые моменты'],['show3','Показ: действия, ключевые моменты и причины']];
const practice=[['try1','Проба: выполнение'],['try2','Проба: объяснение действий'],['try3','Проба: действия и ключевые моменты'],['try4','Проба: действия, ключевые моменты и причины']];
const support=[['support','Самостоятельное задание и последующая поддержка'],...Array.from({length:5},(_,i)=>['follow'+(i+1),'Контрольная проверка '+(i+1)])];
export function jiStages(variant){
 invariant(Object.hasOwn(variants,variant),'Выберите вид инструктажа');
 let middle;
 if(variant==='classic')middle=[...show,...practice];
 if(variant==='special')middle=[...show.map(([k,v])=>[k,v+' · демонстратор и инструктор']),...practice];
 if(variant==='smed')middle=[...Array.from({length:3},(_,i)=>['show_sim'+(i+1),'Показ: имитация '+(i+1)]),['show_real','Показ: реальное выполнение'],...Array.from({length:3},(_,i)=>['try_sim'+(i+1),'Проба: имитация '+(i+1)]),['try_real','Проба: реальное выполнение']];
 if(variant==='hazardous')middle=[['show_explanation','Показ / видеоматериал с объяснением'],['try_preparatory','Подготовительные работы / тренажёр'],['try_individual','Практика: самостоятельное выполнение по разрешённым условиям'],['try_team','Практика в команде']];
 return [...prepare,...middle,...support].map(([code,label])=>({code,label,phase:code.startsWith('follow')?'followup':code==='support'?'support':code.startsWith('try')?'practice':code.startsWith('show')?'presentation':'prepare'}))
}
export function progressFor(db,a){
 const stages=jiStages(a.method_variant),facts=rows(db,'SELECT * FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL ORDER BY held_at,recorded_at,id',[a.id]);
 const done=new Set(facts.filter(x=>x.result==='completed').map(x=>x.stage_code)),next=stages.find(x=>!done.has(x.code))||null;
 const intro=stages.filter(x=>!['support','followup'].includes(x.phase)).every(x=>done.has(x.code));
 const followup=stages.filter(x=>x.phase==='followup'&&done.has(x.code)).length;
 const supportOn=facts.find(x=>x.stage_code==='support'&&x.result==='completed')?.held_at.slice(0,10)||null;
 let followupDue=null;if(supportOn){const [y,m,d]=supportOn.split('-').map(Number);const end=new Date(Date.UTC(y,m,Math.min(d,new Date(Date.UTC(y,m+1,0)).getUTCDate())));followupDue=end.toISOString().slice(0,10)}
 return {stages,facts,done,next,intro,followup,followupDue,complete:!next,completed:stages.filter(x=>done.has(x.code)).length}
}
const active=(db,table,id)=>{invariant(isId(id),'Выберите запись: '+table);const x=one(db,'SELECT * FROM '+table+' WHERE id=?',[id]);invariant(x&&!x.archived,'Запись недоступна: '+table);return x};
const person=(db,id)=>active(db,'person',id);
const optional=(db,table,id)=>id===null?null:active(db,table,id);
const eventDay=e=>new Date(Date.parse(e.occurred_at)+14*3600000).toISOString().slice(0,10);
function roleMatches(db,id,day,allowed){return directoryPeople(db,day).find(x=>x.id===id)?.roles.some(x=>allowed.includes(x.kind))}
function hasRole(db,id,day,allowed){person(db,id);invariant(roleMatches(db,id,day,allowed),'У сотрудника нет действующего назначения нужной роли')}
function roleForCredential(role){return role==='mentor'?['mentor']:['instructor']}
function level(db,scale,levelValue){active(db,'rating_scale',scale);invariant(integer(levelValue,0,1000)&&one(db,'SELECT value FROM rating_level WHERE scale_id=? AND value=?',[scale,levelValue]),'Уровень отсутствует в выбранной шкале')}
export function currentStandard(db,revisionId){
 const r=one(db,'SELECT r.*,d.operation_id,d.code,d.title,d.archived FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.kind=?',[revisionId,'sop']);
 if(!r)return null;return {...r,source:JSON.parse(r.payload_json).source}
}
export function isCurrentStandard(db,revisionId){const r=currentStandard(db,revisionId);return !!(r&&r.state==='effective'&&!r.archived)}
function effective(db,revisionId){const r=currentStandard(db,revisionId);invariant(r&&r.state==='effective'&&!r.archived&&r.operation_id&&r.source?.kind==='sop','Выберите действующую редакцию СОП, привязанную к операции');active(db,'operation',r.operation_id);return r}
function names(db,ids){return Object.fromEntries(Object.entries(ids).map(([k,id])=>[k,id?person(db,id).display_name:'']))}
function certificateValid(db,id,day){const x=one(db,'SELECT * FROM mentor_credential WHERE id=?',[id]);return x&&x.kind==='certificate'&&within(day,x.issued_on,x.valid_until)&&beforeRevocation(x.revoked_at,day)?x:null}
function appointmentValid(db,id,day){
 const x=one(db,'SELECT * FROM mentor_appointment WHERE id=?',[id]);if(!x||!within(day,x.valid_from,x.valid_to)||x.acknowledged_on>day||!beforeRevocation(x.revoked_at,day))return null;
 const c=certificateValid(db,x.credential_id,day);return c&&c.person_id===x.person_id&&c.role===x.role?x:null
}
export function authorizationValid(db,id,day){
 const a=one(db,'SELECT * FROM mentor_authorization WHERE id=?',[id]);if(!a||!a.credential_id||!a.appointment_id||!within(day,a.valid_from,a.valid_to)||!beforeRevocation(a.revoked_at,day))return false;
 const o=appointmentValid(db,a.appointment_id,day),c=certificateValid(db,a.credential_id,day);
 return !!(o&&c&&o.person_id===a.person_id&&c.person_id===a.person_id&&o.credential_id===c.id&&roleMatches(db,a.person_id,day,roleForCredential(c.role))&&one(db,'SELECT id FROM operation WHERE id=? AND archived=0',[a.operation_id]))
}
export function activeAuthorizations(db,operationId,day){return rows(db,'SELECT * FROM mentor_authorization WHERE operation_id=? ORDER BY valid_from DESC,id',[operationId]).filter(x=>authorizationValid(db,x.id,day))}
export function practicalMethods(db){return rows(db,'SELECT v.* FROM checklist_version v JOIN checklist c ON c.id=v.checklist_id WHERE c.code=? ORDER BY v.version_no DESC',[PRACTICAL_CODE])}
export function practicalCriteria(db,id){return rows(db,'SELECT * FROM checklist_criterion WHERE version_id=? ORDER BY position',[id])}
export function practicalResult(responses){const rated=responses.filter(x=>x.value===0||x.value===1),yes=rated.filter(x=>x.value===1).length;return {rated:rated.length,yes,total:11,fraction:rated.length===11?yes/11:null}}
export function validatePracticalMethod(p){
 exact(p,['format','title','source_sha256','criteria']);invariant(p.format==='lean-practical-checklist-v1'&&required(p.title,200)&&sha(p.source_sha256)&&Array.isArray(p.criteria)&&p.criteria.length===11,'Нужна отдельная практическая методика из 11 критериев');
 p.criteria.forEach((x,i)=>{exact(x,['code','section','question']);invariant(x.code===i+1&&required(x.section,100)&&required(x.question,2500),'Неверный критерий '+(i+1))});return p
}
export function verifyTrainingSource(e,source,raw){
 invariant(e.entity_type==='training_assignment'&&e.operation==='create'&&source.kind==='sop'&&canonical(source)===canonical(e.payload.source),'Некорректный исходник назначения');
 const t=linkedTwi(raw.constructor);
 invariant(t.exists&&!t.outdated&&e.payload.plan_reviewed===true,'Сформируйте и проверьте актуальный план TWI в редакции СОП')
}
function createOnly(e,old){invariant(e.operation==='create'&&!old,'Историческая запись неизменяема; создайте новое событие')}
function changeOnly(e,old){invariant(e.operation==='update'&&old,'Недопустимая операция с записью')}
function assignment(db,id){const a=one(db,'SELECT * FROM training_assignment WHERE id=? AND source_sha256 IS NOT NULL',[id]);invariant(a,'Назначение обучения не найдено');return a}
function freshAssignment(db,p){const a=assignment(db,p.assignment_id);invariant(integer(p.assignment_rev,1)&&p.assignment_rev===a.rev,'Назначение изменилось. Откройте актуальную карточку.');return a}
function latest(db,table,where,args,dayColumn){
 return one(db,'SELECT * FROM '+table+' WHERE '+where+' ORDER BY '+dayColumn+' DESC,recorded_at DESC,id DESC LIMIT 1',args)
}
export function latestVerification(db,id,kind){return latest(db,'training_verification','assignment_id=? AND kind=?',[id,kind],'evaluated_on')}
export function latestAssessment(db,id,kind){return latest(db,'assessment_session',"assignment_id=? AND assessment_kind=? AND state='confirmed'",[id,kind],'assessed_at')}
export function latestQualification(db,personId,skillId,day='9999-12-31'){
 return one(db,`SELECT i.*,s.person_id,s.assessed_at,s.standard_revision_id,s.evaluator_id,s.assignment_id,s.recorded_at
 FROM assessment_item i JOIN assessment_session s ON s.id=i.session_id
 WHERE s.person_id=? AND i.skill_id=? AND s.state='confirmed' AND substr(s.assessed_at,1,10)<=? ORDER BY s.assessed_at DESC,coalesce(s.recorded_at,'') DESC,s.id DESC LIMIT 1`,[personId,skillId,day])
}
export function admissionStatus(db,personId,operationId,day){
 const a=latest(db,'admission_decision','person_id=? AND operation_id=? AND decided_on<=?',[personId,operationId,day],'decided_on');
 if(!a)return {record:null,status:'Нет решения',current:false};
 if(a.decision==='denied')return {record:a,status:'Не допущен',current:false};
 if(!beforeRevocation(a.revoked_at,day))return {record:a,status:'Отозван',current:false};
 if(a.valid_until&&a.valid_until<day)return {record:a,status:'Срок истёк',current:false};
 const current=isCurrentStandard(db,a.revision_id);
 return {record:a,status:current?'Допуск зарегистрирован':'Допуск по прежней версии · требуется анализ',current}
}
export function enrollmentTasks(db,enrollment){
 return rows(db,'SELECT * FROM training_program_task WHERE program_id=? ORDER BY position',[enrollment.program_id]).map(task=>{
  const a=latestTaskAssignment(db,enrollment.id,task.id),result=latest(db,'training_task_result','enrollment_id=? AND task_id=?',[enrollment.id,task.id],'held_on');
  return {...task,assignment:a,result,done:task.sop_revision_id?a?.state==='completed':result?.result==='completed'}
 })
}
function latestTaskAssignment(db,enrollmentId,taskId){return one(db,"SELECT * FROM training_assignment WHERE enrollment_id=? AND program_task_id=? AND state<>'cancelled' ORDER BY assigned_on DESC,id DESC LIMIT 1",[enrollmentId,taskId])}
function store(db,table,data){const ks=Object.keys(data);db.run('INSERT INTO '+table+'('+ks.join(',')+') VALUES('+ks.map(()=>'?').join(',')+')',ks.map(k=>data[k]))}
function update(db,table,id,data){const ks=Object.keys(data);db.run('UPDATE '+table+' SET '+ks.map(k=>k+'=?').join(',')+',rev=rev+1 WHERE id=?',[...ks.map(k=>data[k]),id])}
function revoke(db,table,e,old){
 changeOnly(e,old);exact(e.payload,['command','reason']);invariant(e.payload.command==='revoke'&&required(e.payload.reason)&&!old.revoked_at,'Укажите основание отзыва');
 update(db,table,old.id,{revoked_at:e.occurred_at})
}
function noFuture(day,e){invariant(date(day)&&day<=eventDay(e),'Дата события не может быть в будущем')}
function validClock(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)&&date(s.slice(0,10))}
function exactAssignmentTarget(db,p,r){const skill=active(db,'skill',p.skill_id);invariant(skill.operation_id===r.operation_id,'Навык должен относиться к операции выбранного СОП');level(db,p.scale_id,p.target_level)}
export function applyTrainingEvent(db,e,old){
 const p=e.payload,id=e.entity_id,t=e.entity_type;
 if(t==='checklist_version'){
  createOnly(e,old);validatePracticalMethod(p);const methods=practicalMethods(db);
  invariant(!methods.some(m=>canonical(JSON.parse(m.methodology_json))===canonical(p)),'Такая методика уже зарегистрирована');
  let c=one(db,'SELECT * FROM checklist WHERE code=?',[PRACTICAL_CODE]);if(!c){c={id:e.id};store(db,'checklist',{id:c.id,code:PRACTICAL_CODE,name:'Практическая оценка'})}
  store(db,t,{id,checklist_id:c.id,version_no:(methods[0]?.version_no||0)+1,state:'draft',methodology_json:canonical(p),rev:1});
  p.criteria.forEach(q=>store(db,'checklist_criterion',{id:id+':'+q.code,version_id:id,code:String(q.code),section_code:q.section,position:q.code,question:q.question}));
  db.run("UPDATE checklist_version SET state='retired',rev=rev+1 WHERE checklist_id=? AND state='active'",[c.id]);db.run("UPDATE checklist_version SET state='active' WHERE id=?",[id]);return
 }
 if(t==='mentor_credential'){
  if(old)return revoke(db,t,e,old);
  createOnly(e,old);exact(p,['person_id','kind','role','number','issuer','issued_on','valid_until','evidence','registered_by']);
  person(db,p.person_id);person(db,p.registered_by);noFuture(p.issued_on,e);
  invariant(['certificate','attendance'].includes(p.kind)&&roles.includes(p.role)&&required(p.number,200)&&required(p.issuer)&&required(p.evidence)&&period(p.issued_on,p.valid_until),'Заполните реквизиты фактического документа о подготовке');
  store(db,t,{id,...p,rev:1});return
 }
 if(t==='mentor_appointment'){
  if(old)return revoke(db,t,e,old);
  createOnly(e,old);exact(p,['person_id','credential_id','role','order_number','order_on','approved_by','valid_from','valid_to','acknowledged_on','evidence']);
  person(db,p.person_id);person(db,p.approved_by);noFuture(p.order_on,e);noFuture(p.acknowledged_on,e);
  invariant(roles.includes(p.role)&&period(p.valid_from,p.valid_to)&&p.order_on<=p.valid_from&&p.acknowledged_on>=p.order_on&&required(p.order_number,200)&&required(p.evidence),'Заполните действительный приказ и ознакомление');
  const c=certificateValid(db,p.credential_id,p.valid_from);invariant(c&&c.person_id===p.person_id&&c.role===p.role,'Нужен действующий сертификат этой роли, не свидетельство о прослушивании');
  store(db,t,{id,...p,rev:1});return
 }
 if(t==='mentor_authorization'){
  if(old)return revoke(db,t,e,old);
  createOnly(e,old);exact(p,['person_id','operation_id','approved_by','valid_from','valid_to','credential_id','appointment_id']);
  person(db,p.approved_by);active(db,'operation',p.operation_id);invariant(period(p.valid_from,p.valid_to),'Укажите период права обучать');
  const o=appointmentValid(db,p.appointment_id,p.valid_from),c=certificateValid(db,p.credential_id,p.valid_from);
  invariant(o&&c&&o.person_id===p.person_id&&o.credential_id===c.id,'Право обучать требует действующего сертификата и приказа');hasRole(db,p.person_id,p.valid_from,roleForCredential(c.role));
  invariant(!rows(db,'SELECT * FROM mentor_authorization WHERE person_id=? AND operation_id=?',[p.person_id,p.operation_id]).some(a=>!a.revoked_at&&a.valid_from<=(p.valid_to||'9999-12-31')&&(!a.valid_to||a.valid_to>=p.valid_from)),'Есть пересекающееся полномочие по операции');
  store(db,t,{id,...p,rev:1});return
 }
 if(t==='training_program'){
  if(old){changeOnly(e,old);exact(p,['command','reason']);invariant(p.command==='retire'&&required(p.reason)&&old.state==='active','Версия программы уже завершена');update(db,t,id,{state:'retired'});return}
  createOnly(e,old);exact(p,['code','kind','title','profession_id','position_id','created_by','tasks']);
  invariant(required(p.code,100)&&required(p.title)&&Object.hasOwn(programKinds,p.kind)&&Array.isArray(p.tasks)&&p.tasks.length>0&&p.tasks.length<=100,'Заполните программу и задания');
  optional(db,'profession',p.profession_id);optional(db,'position',p.position_id);person(db,p.created_by);
  if(p.kind==='internship')invariant(Object.keys(parts).every(k=>p.tasks.some(x=>x.part===k)),'Программа стажировки должна содержать все четыре части');
  p.tasks.forEach(x=>{
   exact(x,['part','title','hours','day_offset','sop_revision_id','skill_id','scale_id','target_level']);
   invariant(Object.hasOwn(parts,x.part)&&required(x.title)&&typeof x.hours==='number'&&Number.isFinite(x.hours)&&x.hours>=0&&x.hours<=1000&&integer(x.day_offset,0,3660),'Некорректное задание программы');
   if(x.sop_revision_id){const r=effective(db,x.sop_revision_id);exactAssignmentTarget(db,x,r)}
   else invariant(x.skill_id===null&&x.scale_id===null&&x.target_level===null,'Для задания с целевой компетенцией выберите СОП')
  });
  const previous=rows(db,'SELECT * FROM training_program').filter(x=>foldKey(x.code)===foldKey(p.code));
  const version=Math.max(0,...previous.map(x=>x.version_no))+1,code=previous[0]?.code||p.code.trim();
  for(const x of previous.filter(x=>x.state==='active'))update(db,t,x.id,{state:'retired'});
  store(db,t,{id,code,version_no:version,kind:p.kind,title:p.title.trim(),profession_id:p.profession_id,position_id:p.position_id,created_by:p.created_by,created_at:e.occurred_at,state:'active',rev:1});
  p.tasks.forEach((x,i)=>store(db,'training_program_task',{id:id+':'+(i+1),program_id:id,position:i+1,...x}));return
 }
 if(t==='training_enrollment'){
  if(!old){
   createOnly(e,old);exact(p,['program_id','trainee_id','mentor_id','manager_id','start_on','due_on','reason']);
   const program=one(db,'SELECT * FROM training_program WHERE id=? AND state=?',[p.program_id,'active']);invariant(program&&period(p.start_on,p.due_on)&&p.due_on&&required(p.reason),'Выберите активную программу, сроки и причину');
   hasRole(db,p.trainee_id,p.start_on,['trainee']);hasRole(db,p.mentor_id,p.start_on,['mentor','instructor']);person(db,p.manager_id);invariant(p.trainee_id!==p.mentor_id,'Сотрудник не может обучать себя');
   const a=one(db,"SELECT * FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC LIMIT 1",[p.trainee_id,p.start_on,p.start_on]);
   invariant((!program.profession_id||a?.profession_id===program.profession_id)&&(!program.position_id||a?.position_id===program.position_id),'Программа не соответствует действующему назначению сотрудника');
   invariant(!one(db,"SELECT id FROM training_enrollment WHERE program_id=? AND trainee_id=? AND state='active'",[p.program_id,p.trainee_id]),'Такая персональная программа уже активна');
   store(db,t,{id,...p,state:'active',rev:1});return
  }
  changeOnly(e,old);exact(p,['command','actor_id','conclusion','feedback']);person(db,p.actor_id);
  invariant(old.state==='active'&&['finish','cancel'].includes(p.command)&&required(p.feedback),'Укажите итог и обратную связь');
  if(p.command==='finish')invariant(Object.hasOwn(conclusions,p.conclusion)&&enrollmentTasks(db,old).every(x=>x.done),'Сначала завершите задания программы и укажите заключение');
  else invariant(p.conclusion===null,'Отмена не является квалификационным заключением');
  if(p.command==='cancel')invariant(!one(db,"SELECT id FROM training_assignment WHERE enrollment_id=? AND state IN('planned','in_progress')",[id]),'Сначала отмените незавершённые назначения программы');
  update(db,t,id,{state:p.command==='finish'?'completed':'cancelled',conclusion:p.conclusion,feedback:p.feedback,finished_by:p.actor_id,finished_at:e.occurred_at});return
 }
 if(t==='training_task_result'){
  createOnly(e,old);exact(p,['enrollment_id','task_id','actor_id','held_on','result','minutes','evidence','enrollment_rev']);person(db,p.actor_id);noFuture(p.held_on,e);
  const n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[p.enrollment_id]),task=one(db,'SELECT * FROM training_program_task WHERE id=?',[p.task_id]);
  invariant(n?.state==='active'&&n.rev===p.enrollment_rev&&task?.program_id===n.program_id&&!task.sop_revision_id&&p.held_on>=n.start_on&&['completed','incomplete'].includes(p.result)&&integer(p.minutes,0,1440)&&required(p.evidence),'Недопустимое задание / результат. Задания по СОП закрываются фактом инструктажа.');
  const {enrollment_rev,...data}=p;store(db,t,{id,...data,recorded_at:e.occurred_at,rev:1});update(db,'training_enrollment',n.id,{state:n.state});return
 }
 if(t==='training_assignment'){
  if(!old){
   createOnly(e,old);exact(p,['trainee_id','mentor_id','supervisor_id','authorization_id','revision_id','source','skill_id','scale_id','target_level','assigned_by','assigned_on','due_on','reason','variant','shift_id','enrollment_id','program_task_id','plan_reviewed']);
   const r=effective(db,p.revision_id);invariant(canonical(r.source)===canonical(p.source)&&p.plan_reviewed===true,'Исходник назначения должен соответствовать действующей редакции и проверенному TWI');
   invariant(period(p.assigned_on,p.due_on)&&p.due_on&&required(p.reason)&&Object.hasOwn(variants,p.variant),'Укажите даты, вид и основание обучения');
   hasRole(db,p.trainee_id,p.assigned_on,['trainee']);person(db,p.assigned_by);invariant(p.trainee_id!==p.mentor_id,'Инструктор и обучаемый должны различаться');
   const auth=one(db,'SELECT * FROM mentor_authorization WHERE id=?',[p.authorization_id]);invariant(auth?.person_id===p.mentor_id&&auth.operation_id===r.operation_id&&authorizationValid(db,auth.id,p.assigned_on),'Выберите инструктора с действующим правом обучать этой операции');
   if(p.supervisor_id){hasRole(db,p.supervisor_id,p.assigned_on,['mentor','instructor']);invariant(p.supervisor_id!==p.trainee_id,'Наставник и обучаемый должны различаться')}
   optional(db,'work_shift',p.shift_id);exactAssignmentTarget(db,p,r);
   if(p.enrollment_id!==null||p.program_task_id!==null){
    const n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[p.enrollment_id]),task=one(db,'SELECT * FROM training_program_task WHERE id=?',[p.program_task_id]);
    invariant(n?.state==='active'&&n.trainee_id===p.trainee_id&&task?.program_id===n.program_id&&task.sop_revision_id===r.id&&task.skill_id===p.skill_id&&task.scale_id===p.scale_id&&task.target_level===p.target_level&&p.assigned_on>=n.start_on&&!latestTaskAssignment(db,n.id,task.id),'Назначение не соответствует заданию персональной программы')
   }
   invariant(!one(db,"SELECT id FROM training_assignment WHERE trainee_id=? AND sop_revision_id=? AND skill_id=? AND state IN('planned','in_progress')",[p.trainee_id,r.id,p.skill_id]),'У сотрудника уже есть открытое назначение по этому навыку и редакции');
   store(db,t,{id,trainee_id:p.trainee_id,mentor_id:p.mentor_id,supervisor_id:p.supervisor_id,operation_id:r.operation_id,sop_revision_id:r.id,twi_revision_id:r.id,due_on:p.due_on,state:'planned',rev:1,source_sha256:r.source.sha256,skill_id:p.skill_id,scale_id:p.scale_id,target_level:p.target_level,assigned_by:p.assigned_by,assigned_on:p.assigned_on,reason:p.reason,method_variant:p.variant,method_version:'JI-1',authorization_id:p.authorization_id,shift_id:p.shift_id,enrollment_id:p.enrollment_id,program_task_id:p.program_task_id,recorded_names_json:canonical(names(db,{trainee:p.trainee_id,instructor:p.mentor_id,supervisor:p.supervisor_id,assignedBy:p.assigned_by}))});
   return
  }
  changeOnly(e,old);invariant(old.source_sha256&&['planned','in_progress'].includes(old.state),'Назначение закрыто или относится к legacy');
  if(p.command==='approve'){
   exact(p,['command','responsible_id','head_id','approved_on','note']);person(db,p.responsible_id);person(db,p.head_id);noFuture(p.approved_on,e);
   invariant(p.approved_on>=old.assigned_on&&text(p.note)&&!old.approval_json&&isCurrentStandard(db,old.sop_revision_id),'План должен быть актуальным и ещё не согласован');
   update(db,t,id,{approval_json:canonical({...p,names:names(db,{responsible:p.responsible_id,head:p.head_id})})});return
  }
  if(p.command==='reschedule'){
   exact(p,['command','due_on','reason']);invariant(date(p.due_on)&&p.due_on>=old.assigned_on&&required(p.reason),'Укажите новый срок и причину');
   update(db,t,id,{due_on:p.due_on,change_reason:p.reason,approval_json:null});return
  }
  exact(p,['command','reason']);invariant(p.command==='cancel'&&required(p.reason),'Укажите причину отмены');update(db,t,id,{state:'cancelled',change_reason:p.reason});return
 }
 if(t==='training_session'){
  createOnly(e,old);exact(p,['assignment_id','assignment_rev','stage_code','held_at','duration_minutes','result','notes','witness_id','mentor_ack','trainee_ack']);
  const a=freshAssignment(db,p),day=String(p.held_at).slice(0,10),pr=progressFor(db,a),stage=pr.stages.find(x=>x.code===p.stage_code);
  invariant(a.state!=='cancelled'&&a.approval_json&&isCurrentStandard(db,a.sop_revision_id),'Сначала согласуйте актуальное назначение. Для изменённого СОП требуется пересмотр.');
  invariant(stage&&validClock(p.held_at)&&day>=a.assigned_on&&day>=JSON.parse(a.approval_json).approved_on&&day<=eventDay(e)&&integer(p.duration_minutes,1,1440)&&['completed','incomplete'].includes(p.result)&&required(p.notes),'Укажите этап, фактическую дату/время, длительность и результат');
  invariant(!pr.facts.some(f=>f.held_at>p.held_at),'Факты должны регистрироваться в хронологическом порядке');
  invariant(pr.done.has(stage.code)||stage.code===pr.next?.code,'Сначала завершите предыдущий этап; повторения разрешены');
  invariant(authorizationValid(db,a.authorization_id,day),'Право инструктора обучать операции недействительно на дату факта');
  invariant(p.mentor_ack===true&&p.trainee_ack===true,'Нужны отметки подтверждения обеих сторон (не электронная подпись)');
  const witness=optional(db,'person',p.witness_id);
  if(a.method_variant==='special'&&stage.phase==='presentation')invariant(witness&&witness.id!==a.trainee_id,'Укажите демонстратора');
  if(a.method_variant==='hazardous'&&stage.phase==='practice')invariant(latestVerification(db,a.id,'safety')?.result==='pass','Сначала зарегистрируйте подтверждение обязательной проверки безопасности');
  store(db,t,{id,assignment_id:a.id,mentor_id:a.mentor_id,held_at:p.held_at,notes:p.notes,result:p.result,steps_json:canonical({version:a.method_version,variant:a.method_variant,stage:stage.code,label:stage.label,repeat:pr.done.has(stage.code)}),rev:1,stage_code:stage.code,duration_minutes:p.duration_minutes,witness_id:p.witness_id,witness_name:witness?.display_name||null,mentor_ack:1,trainee_ack:1,recorded_at:e.occurred_at});
  const done=progressFor(db,a);update(db,'training_assignment',a.id,{state:done.complete?'completed':'in_progress'});
  if(a.enrollment_id){const n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[a.enrollment_id]);if(n?.state==='active')update(db,'training_enrollment',n.id,{state:n.state})}return
 }
 if(t==='training_verification'){
  createOnly(e,old);exact(p,['assignment_id','assignment_rev','kind','evaluator_id','evaluated_on','result','evidence','feedback']);
  const a=freshAssignment(db,p);person(db,p.evaluator_id);noFuture(p.evaluated_on,e);
  invariant(a.state!=='cancelled'&&a.approval_json&&isCurrentStandard(db,a.sop_revision_id)&&p.evaluator_id!==a.trainee_id&&p.evaluated_on>=a.assigned_on&&['safety','theory'].includes(p.kind)&&['pass','fail'].includes(p.result)&&required(p.evidence)&&required(p.feedback),'Проверка требует согласованного назначения, отдельного оценщика, даты, результата и основания');
  const prev=latestVerification(db,a.id,p.kind);invariant(!prev||p.evaluated_on>=prev.evaluated_on,'Нельзя подменить историю более ранней проверкой');
  const {assignment_rev,...data}=p;store(db,t,{id,...data,recorded_at:e.occurred_at,rev:1});update(db,'training_assignment',a.id,{state:a.state});return
 }
 if(t==='assessment_session'){
  createOnly(e,old);
  const a=freshAssignment(db,p);person(db,p.evaluator_id);noFuture(p.assessed_on,e);
  invariant(a.state!=='cancelled'&&a.approval_json&&isCurrentStandard(db,a.sop_revision_id)&&p.evaluator_id!==a.trainee_id&&p.assessed_on>=a.assigned_on&&required(p.feedback),'Нужна актуальная согласованная запись, отдельный оценщик и обратная связь');
  const prev=latestAssessment(db,a.id,p.command);invariant(!prev||p.assessed_on>=prev.assessed_at.slice(0,10),'Нельзя подменить историю более ранней оценкой');
  const pr=progressFor(db,a),latestTrial=pr.facts.filter(x=>x.stage_code.startsWith('try')&&x.result==='completed').at(-1);
  invariant(pr.intro&&latestTrial&&p.assessed_on>=latestTrial.held_at.slice(0,10),'Сначала завершите вводную часть инструктажа и практические пробы');
  const common={id,person_id:a.trainee_id,evaluator_id:p.evaluator_id,training_session_id:latestTrial.id,operation_id:a.operation_id,standard_revision_id:a.sop_revision_id,assessed_at:p.assessed_on,state:'draft',assignment_id:a.id,assessment_kind:p.command,feedback:p.feedback,recorded_at:e.occurred_at,recorded_names_json:canonical(names(db,{trainee:a.trainee_id,evaluator:p.evaluator_id})),rev:1};
  if(p.command==='practical'){
   exact(p,['command','assignment_id','assignment_rev','evaluator_id','assessed_on','method_id','responses','conclusion','feedback']);
   invariant(practicalMethods(db).some(x=>x.id===p.method_id&&x.state==='active')&&Object.hasOwn(conclusions,p.conclusion),'Выберите действующую методику практики и фактическое заключение');
   const c=practicalCriteria(db,p.method_id);invariant(c.length===11&&Array.isArray(p.responses)&&p.responses.length===11,'Необходимо ответить на все 11 критериев');
   p.responses.forEach((x,i)=>{exact(x,['criterion_id','value','note']);invariant(x.criterion_id===c[i].id&&(x.value===0||x.value===1)&&text(x.note),'Неверный ответ практической оценки')});
   store(db,t,{...common,method_id:p.method_id,responses_json:canonical(p.responses),conclusion:p.conclusion})
  }else{
   exact(p,['command','assignment_id','assignment_rev','evaluator_id','assessed_on','practical_id','observation_state','level','valid_until','evidence','feedback']);
   invariant(p.command==='qualification'&&['rated','not_observed','not_applicable'].includes(p.observation_state)&&required(p.evidence),'Укажите отдельное решение об уровне навыка');
   const practical=latestAssessment(db,a.id,'practical');invariant(practical&&practical.id===p.practical_id&&p.assessed_on>=practical.assessed_at.slice(0,10),'Выберите последнюю практическую оценку этого назначения');
   invariant(p.valid_until===null||period(p.assessed_on,p.valid_until),'Некорректный срок уровня');
   if(p.observation_state==='rated')level(db,a.scale_id,p.level);else invariant(p.level===null&&p.valid_until===null,'Не наблюдалось / неприменимо — не числовая оценка');
   store(db,t,{...common,practical_id:practical.id,notes:p.evidence});
   store(db,'assessment_item',{id:e.id,session_id:id,skill_id:a.skill_id,scale_id:a.scale_id,level:p.level,observation_state:p.observation_state,valid_until:p.valid_until,evidence_note:p.evidence})
  }
  db.run("UPDATE assessment_session SET state='confirmed' WHERE id=?",[id]);update(db,'training_assignment',a.id,{state:a.state});return
 }
 if(t==='admission_decision'){
  if(old){changeOnly(e,old);exact(p,['command','reason']);invariant(p.command==='revoke'&&old.decision==='granted'&&!old.revoked_at&&required(p.reason),'Укажите основание отзыва допуска');update(db,t,id,{revoked_at:e.occurred_at,revoke_reason:p.reason});return}
  createOnly(e,old);exact(p,['assignment_id','assignment_rev','actor_id','decided_on','valid_until','decision','evidence','feedback']);
  const a=freshAssignment(db,p);person(db,p.actor_id);noFuture(p.decided_on,e);
  invariant(a.state!=='cancelled'&&a.approval_json&&isCurrentStandard(db,a.sop_revision_id)&&p.actor_id!==a.trainee_id&&p.decided_on>=a.assigned_on&&period(p.decided_on,p.valid_until)&&['granted','denied'].includes(p.decision)&&required(p.evidence)&&required(p.feedback),'Допуск требует явного решения ответственного, даты, основания и обратной связи');
  const q=latestAssessment(db,a.id,'qualification'),pr=latestAssessment(db,a.id,'practical'),s=latestVerification(db,a.id,'safety'),th=latestVerification(db,a.id,'theory');
  const previous=latest(db,'admission_decision','person_id=? AND operation_id=?',[a.trainee_id,a.operation_id],'decided_on');
  invariant(!previous||p.decided_on>=previous.decided_on,'Нельзя подменить историю более ранним решением');
  if(p.decision==='granted'){
   const item=q&&one(db,'SELECT * FROM assessment_item WHERE session_id=?',[q.id]);
   invariant(pr&&q&&q.practical_id===pr.id&&pr.conclusion!=='not_meet'&&item?.observation_state==='rated'&&(!item.valid_until||item.valid_until>=p.decided_on)&&s?.result==='pass'&&th?.result==='pass'&&[q.assessed_at,pr.assessed_at,s.evaluated_on,th.evaluated_on].every(x=>x.slice(0,10)<=p.decided_on),'Нужны последняя практическая оценка, подтверждённый уровень, положительные проверки ОТ и теории. Процент сам по себе не выдаёт допуск.');
  }else invariant(p.valid_until===null,'Отказ не имеет срока действия');
  const {assignment_rev,...data}=p;store(db,t,{id,...data,person_id:a.trainee_id,operation_id:a.operation_id,revision_id:a.sop_revision_id,qualification_id:q?.id||null,practical_id:pr?.id||null,safety_id:s?.id||null,theory_id:th?.id||null,recorded_at:e.occurred_at,rev:1});update(db,'training_assignment',a.id,{state:a.state});return
 }
 if(t==='role_requirement'){
  if(old){changeOnly(e,old);exact(p,['command','valid_to']);invariant(p.command==='close'&&!old.valid_to&&period(old.valid_from,p.valid_to)&&p.valid_to,'Закройте действие требования датой');update(db,t,id,{valid_to:p.valid_to});return}
  createOnly(e,old);exact(p,['profession_id','skill_id','scale_id','required_level','criticality','valid_from','valid_to']);
  active(db,'profession',p.profession_id);active(db,'skill',p.skill_id);level(db,p.scale_id,p.required_level);
  invariant(period(p.valid_from,p.valid_to)&&['normal','important','critical'].includes(p.criticality)&&!one(db,"SELECT id FROM role_requirement WHERE profession_id=? AND skill_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=?",[p.profession_id,p.skill_id,p.valid_to||'9999-12-31',p.valid_from]),'Некорректное или пересекающееся требование');
  store(db,t,{id,...p,rev:1});return
 }
 if(t==='coverage_requirement'){
  exact(p,['unit_id','skill_id','shift_code','min_people','scale_id','required_level']);active(db,'org_unit',p.unit_id);active(db,'skill',p.skill_id);level(db,p.scale_id,p.required_level);
  invariant(text(p.shift_code,100)&&(!p.shift_code||one(db,'SELECT id FROM work_shift WHERE code=? AND archived=0',[p.shift_code]))&&integer(p.min_people,0,100000),'Некорректная потребность покрытия');
  if(old){changeOnly(e,old);invariant(old.unit_id===p.unit_id&&old.skill_id===p.skill_id&&old.shift_code===p.shift_code,'Область требования неизменяема');update(db,t,id,p)}else{createOnly(e,old);store(db,t,{id,...p,rev:1})}return
 }
 if(t==='development_plan'){
  if(!old){createOnly(e,old);exact(p,['person_id','title','start_on','due_on']);person(db,p.person_id);invariant(required(p.title)&&period(p.start_on,p.due_on)&&p.due_on,'Укажите цель и период развития');store(db,t,{id,...p,state:'active',rev:1});return}
  changeOnly(e,old);exact(p,['command','reason']);invariant(old.state==='active'&&['finish','cancel'].includes(p.command)&&required(p.reason),'Укажите решение по плану');
  if(p.command==='finish')invariant(!!one(db,'SELECT id FROM development_goal WHERE plan_id=?',[id])&&!one(db,"SELECT id FROM development_goal WHERE plan_id=? AND state='open'",[id]),'Сначала завершите цели плана');
  if(p.command==='cancel')db.run("UPDATE development_goal SET state='cancelled',rev=rev+1 WHERE plan_id=? AND state='open'",[id]);
  update(db,t,id,{state:p.command==='finish'?'completed':'cancelled'});return
 }
 if(t==='development_goal'){
  if(!old){
   createOnly(e,old);exact(p,['plan_id','skill_id','scale_id','target_level','title','due_on']);
   const plan=one(db,'SELECT * FROM development_plan WHERE id=? AND state=?',[p.plan_id,'active']);invariant(plan&&required(p.title)&&period(plan.start_on,p.due_on)&&p.due_on&&p.due_on<=plan.due_on,'Выберите активный план и срок цели');
   if(p.skill_id){active(db,'skill',p.skill_id);level(db,p.scale_id,p.target_level)}else invariant(p.scale_id===null&&p.target_level===null,'Без навыка не выбирается уровень');
   store(db,t,{id,plan_id:p.plan_id,skill_id:p.skill_id,title:p.title,target_json:canonical({scale_id:p.scale_id,target_level:p.target_level}),due_on:p.due_on,state:'open',rev:1});return
  }
  changeOnly(e,old);exact(p,['command','reason']);invariant(old.state==='open'&&['finish','cancel'].includes(p.command)&&required(p.reason),'Укажите результат цели');update(db,t,id,{state:p.command==='finish'?'completed':'cancelled'});return
 }
 invariant(false,'Неизвестное событие LC4')
}
export function matrixData(db,day){
 const people=rows(db,`SELECT p.id,p.display_name,p.employee_code,a.profession_id,a.position_id,a.unit_id,a.shift_id,a.shift_code FROM person p LEFT JOIN person_assignment a ON a.id=(SELECT id FROM person_assignment a2 WHERE a2.person_id=p.id AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1) WHERE p.archived=0 ORDER BY p.display_name,p.employee_code`,[day,day]);
 const skills=rows(db,'SELECT s.*,c.name category FROM skill s JOIN skill_category c ON c.id=s.category_id WHERE s.archived=0 AND c.archived=0 ORDER BY c.name,s.name');
 const requirements=rows(db,"SELECT * FROM role_requirement WHERE valid_from<=? AND coalesce(valid_to,'9999-12-31')>=?",[day,day]);
 const cells=new Map();for(const p of people)for(const s of skills){
  const goal=requirements.find(x=>x.profession_id===p.profession_id&&x.skill_id===s.id)||null;
  const fact=latestQualification(db,p.id,s.id,day),same=!goal||fact?.scale_id===goal.scale_id;
  const valid=!!(fact?.observation_state==='rated'&&(!fact.valid_until||fact.valid_until>=day));
  const adm=s.operation_id?admissionStatus(db,p.id,s.operation_id,day):null;
  cells.set(p.id+':'+s.id,{goal,fact,same,valid,admission:adm,gap:!!(goal&&(!valid||!same||fact.level<goal.required_level)),qualified:!!(valid&&same&&(!goal||fact.level>=goal.required_level)&&(!adm||adm.current))})
 }return {people,skills,cells}
}
export function coverageData(db,day,matrix=matrixData(db,day)){
 return rows(db,'SELECT * FROM coverage_requirement ORDER BY unit_id,skill_id,shift_code').map(r=>{
  const skill=matrix.skills.find(s=>s.id===r.skill_id),scope=matrix.people.filter(p=>p.unit_id===r.unit_id&&(!r.shift_code||p.shift_code===r.shift_code||one(db,'SELECT code FROM work_shift WHERE id=?',[p.shift_id])?.code===r.shift_code));
  const actual=scope.filter(p=>{const c=matrix.cells.get(p.id+':'+r.skill_id);return c?.valid&&c.fact.scale_id===r.scale_id&&c.fact.level>=r.required_level&&(!skill?.operation_id||c.admission?.current)}).length;
  return {...r,actual,deficit:Math.max(0,r.min_people-actual),fraction:r.min_people?actual/r.min_people:null,scope:scope.length}
 })
}
