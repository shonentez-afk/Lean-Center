// LC4: explicit facts, reviewed qualifications and separately recorded admission.
import {invariant,one,rows,canonical,isId,foldKey} from '../../core/db.js';
import {directoryPeople,personKey} from '../master-data/people-directory.js';
import {linkedTwi} from '../library/linked-materials.js';
import {validDate} from '../library/sop-review.js';
export const TRAINING_TYPES=Object.freeze({
 competency_matrix:'Матрица компетенций',audit_session:'Аудит инструктора',mentor_self_evaluation:'Самооценка наставника',mentor_order:'Групповой приказ',mentor_credential:'Документы о подготовке',mentor_appointment:'Приказы о назначении',mentor_authorization:'Полномочия наставника',
 training_program:'Программа обучения',training_enrollment:'Персональная программа',training_task_result:'Результат задания программы',
 training_assignment:'Назначение обучения',training_session:'Факт инструктажа',training_verification:'Проверка знаний',
 assessment_session:'Практическая оценка / квалификация',admission_decision:'Решение о допуске',
 role_requirement:'Требование к компетенции',coverage_requirement:'Потребность в покрытии',development_plan:'План развития',development_goal:'Цель развития'
});
export const isLC41Event=e=>e.entity_type==='mentor_order'||(e.entity_type==='training_enrollment'&&Object.hasOwn(e.payload||{},'internship_start'));
export const PRACTICAL_CODE='PRACTICAL_APP8';
export const AUDIT_CODE='TWI_L1_RC1',SELF_CODE='TWI_SELF_APP12';
const extraFormats=['lean-practical-checklist-v2','lean-audit-checklist-v1','lean-self-checklist-v1'];
export const isLC43Event=e=>e.entity_type==='competency_matrix';
export const isLC42Event=e=>['audit_session','mentor_self_evaluation'].includes(e.entity_type)||(e.entity_type==='checklist_version'&&[...extraFormats,'lean-sop-checklist-v2'].includes(e.payload?.format));
export const isTrainingEvent=e=>Object.hasOwn(TRAINING_TYPES,e.entity_type)||(e.entity_type==='checklist_version'&&['lean-practical-checklist-v1',...extraFormats].includes(e.payload?.format));
const exact=(p,keys)=>invariant(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'Некорректные поля LC4');
const text=(x,n=2000)=>typeof x==='string'&&x.length<=n;
const required=(x,n=500)=>text(x,n)&&x.trim().length>0;
const integer=(x,min=0,max=100000)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const date=x=>validDate(x);
const period=(a,b)=>date(a)&&(b===null||date(b)&&b>=a);
const plusDays=(day,n)=>{const v=new Date(day+'T00:00:00Z');v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10)};
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
function roleMatches(db,id,day,allowed){
 return directoryPeople(db,day).find(x=>x.id===id)?.roles.some(x=>{
  const vt=[x.code,x.name].some(v=>['internal_trainer','internal trainer','внутренний тренер','вт'].includes(personKey(v).replaceAll('-','_')));
  return allowed.includes(x.kind)||(allowed.includes('internal_trainer')&&vt)
 })
}
function hasRole(db,id,day,allowed){person(db,id);invariant(roleMatches(db,id,day,allowed),'У сотрудника нет действующего назначения нужной роли')}
function roleForCredential(role){return role==='internal_trainer'?['internal_trainer']:role==='mentor'?['mentor']:['instructor']}
function level(db,scale,levelValue){active(db,'rating_scale',scale);invariant(integer(levelValue,0,1000)&&one(db,'SELECT value FROM rating_level WHERE scale_id=? AND value=?',[scale,levelValue]),'Уровень отсутствует в выбранной шкале')}
export function currentStandard(db,revisionId){
 const r=one(db,'SELECT r.*,d.operation_id,d.code,d.title,d.archived FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.kind=?',[revisionId,'sop']);
 if(!r)return null;return {...r,source:JSON.parse(r.payload_json).source}
}
export function isCurrentStandard(db,revisionId){const r=currentStandard(db,revisionId);return !!(r&&r.state==='effective'&&!r.archived)}
function effective(db,revisionId){const r=currentStandard(db,revisionId);invariant(r&&r.state==='effective'&&!r.archived&&r.operation_id&&r.source?.kind==='sop','Выберите действующую редакцию СОП, привязанную к операции');active(db,'operation',r.operation_id);return r}
function names(db,ids){return Object.fromEntries(Object.entries(ids).map(([k,id])=>[k,id?person(db,id).display_name:'']))}
// An official order must use the assigned position, not a profession fallback.
export function orderPosition(db,id,day){
 return one(db,"SELECT pos.name FROM person_assignment a JOIN position pos ON pos.id=a.position_id WHERE a.person_id=? AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=? ORDER BY a.valid_from DESC,a.id LIMIT 1",[id,day,day])?.name||''
}
export function certificateValid(db,id,day){const x=one(db,'SELECT * FROM mentor_credential WHERE id=?',[id]);return x&&x.kind==='certificate'&&within(day,x.issued_on,x.valid_until)&&beforeRevocation(x.revoked_at,day)?x:null}
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
export function trainingMethods(db,code){return rows(db,'SELECT v.* FROM checklist_version v JOIN checklist c ON c.id=v.checklist_id WHERE c.code=? ORDER BY v.version_no DESC',[code])}
export function practicalMethods(db){return trainingMethods(db,PRACTICAL_CODE)}
export function practicalCriteria(db,id){return rows(db,'SELECT * FROM checklist_criterion WHERE version_id=? ORDER BY position',[id])}
export function practicalResult(responses,total=11){const rated=responses.filter(x=>x.value===0||x.value===1),yes=rated.filter(x=>x.value===1).length;return {rated:rated.length,yes,total,fraction:total>0&&responses.length===total&&rated.length===total?yes/total:null}}
export function validatePracticalMethod(p){
 exact(p,['format','title','source_sha256','criteria']);invariant(['lean-practical-checklist-v1','lean-practical-checklist-v2'].includes(p.format)&&required(p.title,200)&&sha(p.source_sha256)&&Array.isArray(p.criteria)&&(p.format==='lean-practical-checklist-v1'?p.criteria.length===11:p.criteria.length>=1&&p.criteria.length<=100),'Нужна методика практики: 11 критериев v1 либо 1–100 критериев v2');
 p.criteria.forEach((x,i)=>{exact(x,['code','section','question']);invariant(x.code===i+1&&required(x.section,100)&&required(x.question,2500),'Неверный критерий '+(i+1))});return p
}
export function verifyTrainingSource(e,source,raw){
 invariant(e.entity_type==='training_assignment'&&e.operation==='create'&&source.kind==='sop'&&canonical(source)===canonical(e.payload.source),'Некорректный исходник назначения');
 const t=linkedTwi(raw.constructor);
 invariant(t.exists&&!t.outdated&&e.payload.plan_reviewed===true,'Сформируйте и проверьте актуальный план TWI в редакции СОП')
}
export function validateMentorMethod(p,format){
 exact(p,['format','title','source_sha256','criteria']);
 invariant(['lean-audit-checklist-v1','lean-self-checklist-v1'].includes(format)&&p.format===format&&required(p.title,200)&&sha(p.source_sha256)&&Array.isArray(p.criteria)&&p.criteria.length>0&&p.criteria.length<=100,'Некорректная методика наставника');
 p.criteria.forEach((x,i)=>{exact(x,['code','section','question',...(Object.hasOwn(x,'recommendation')?['recommendation']:[])]);invariant(x.code===i+1&&required(x.section,100)&&required(x.question,2500)&&(!Object.hasOwn(x,'recommendation')||text(x.recommendation,2500)),'Некорректный критерий '+(i+1))});return p
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
function admissionRecordStatus(db,a,day){
 if(!a)return {record:null,status:'Нет решения',current:false};
 if(a.decision==='denied')return {record:a,status:'Не допущен',current:false};
 if(!beforeRevocation(a.revoked_at,day))return {record:a,status:'Отозван',current:false};
 if(a.valid_until&&a.valid_until<day)return {record:a,status:'Срок истёк',current:false};
 const current=isCurrentStandard(db,a.revision_id);
 if(!current)return {record:a,status:'Допуск по прежней версии · требуется анализ',current:false};
 const item=one(db,'SELECT * FROM assessment_item WHERE session_id=?',[a.qualification_id]);
 if(item?.valid_until&&item.valid_until<day)return {record:a,status:'Срок квалификации истёк · требуется анализ',current:false};
 const q=latestAssessment(db,a.assignment_id,'qualification'),p=latestAssessment(db,a.assignment_id,'practical'),s=latestVerification(db,a.assignment_id,'safety'),t=latestVerification(db,a.assignment_id,'theory');
 if(q?.id!==a.qualification_id||p?.id!==a.practical_id||s?.id!==a.safety_id||t?.id!==a.theory_id)return {record:a,status:'Подтверждения изменились · требуется решение',current:false};
 return {record:a,status:'Допуск зарегистрирован',current:true}
}
export function admissionStatus(db,personId,operationId,day){return admissionRecordStatus(db,latest(db,'admission_decision','person_id=? AND operation_id=? AND decided_on<=?',[personId,operationId,day],'decided_on'),day)}
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
  createOnly(e,old);const mentor=p.format==='lean-audit-checklist-v1'||p.format==='lean-self-checklist-v1';if(mentor)validateMentorMethod(p,p.format);else validatePracticalMethod(p);const code=p.format==='lean-audit-checklist-v1'?AUDIT_CODE:p.format==='lean-self-checklist-v1'?SELF_CODE:PRACTICAL_CODE,methods=trainingMethods(db,code);
  invariant(!methods.some(m=>canonical(JSON.parse(m.methodology_json))===canonical(p)),'Такая методика уже зарегистрирована');
  let c=one(db,'SELECT * FROM checklist WHERE code=?',[code]);if(!c){c={id:e.id};store(db,'checklist',{id:c.id,code,name:code===AUDIT_CODE?'Аудит 1-го уровня':code===SELF_CODE?'Самооценка наставника':'Практическая оценка'})}
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
 if(t==='competency_matrix'){
  if(old){changeOnly(e,old);exact(p,['command','reason']);invariant(old.state==='active'&&p.command==='retire'&&required(p.reason),'Укажите основание закрытия матрицы');update(db,t,id,{state:'retired'});return}
  createOnly(e,old);exact(p,['code','title','author_id','unit_id','shift_id','scale_id','base_on','target_on','roster','columns','baseline','previous_id','previous_rev']);
  invariant(required(p.code,80)&&required(p.title,200)&&period(p.base_on,p.target_on)&&p.target_on&&p.base_on<=eventDay(e),'Укажите код, название, дату среза и целевую дату');
  person(db,p.author_id);if(p.unit_id)active(db,'org_unit',p.unit_id);if(p.shift_id)active(db,'work_shift',p.shift_id);
  const scale=active(db,'rating_scale',p.scale_id),levels=rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[p.scale_id]);
  invariant(scale.name==='Производственная компетенция (1–4)'&&canonical(levels.map(x=>[x.value,x.label]))===canonical([[1,'Обучен'],[2,'Выполняет работу самостоятельно'],[3,'Выполняет работу мастерски'],[4,'Инструктор-наставник']]),'Для матрицы нужна точная корпоративская шкала 1–4');
  invariant(Array.isArray(p.roster)&&p.roster.length>0&&p.roster.length<=300&&Array.isArray(p.columns)&&p.columns.length>0&&p.columns.length<=150&&p.roster.length*p.columns.length<=12000,'Выберите 1–300 сотрудников и 1–150 навыков; до 12000 ячеек');
  const people=new Set(),skills=new Set();
  const allowedUnits=new Set(p.unit_id?rows(db,'WITH RECURSIVE scope(id) AS (SELECT ? UNION SELECT u.id FROM org_unit u JOIN scope s ON u.parent_id=s.id) SELECT id FROM scope',[p.unit_id]).map(x=>x.id):[]);
  for(const r of p.roster){exact(r,['person_id','name','position','instructor']);const who=person(db,r.person_id);
   invariant(!people.has(r.person_id)&&r.name===who.display_name&&text(r.position,500)&&typeof r.instructor==='boolean','Некорректный или повторный сотрудник');people.add(r.person_id);
   const a=one(db,'SELECT * FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,\'9999-12-31\')>=? ORDER BY valid_from DESC,id LIMIT 1',[r.person_id,p.base_on,p.base_on]);
   invariant(a&&(!p.unit_id||allowedUnits.has(a.unit_id))&&(!p.shift_id||a.shift_id===p.shift_id),'Сотрудник не входит в выбранный состав на дату матрицы');
   const expected=one(db,'SELECT name FROM position WHERE id=?',[a.position_id])?.name||one(db,'SELECT name FROM profession WHERE id=?',[a.profession_id])?.name||'';
   invariant(r.position===expected&&r.instructor===roleMatches(db,r.person_id,p.base_on,['instructor','mentor','internal_trainer']),'Должность или роль сотрудника изменилась');
  }
  for(const c of p.columns){exact(c,['skill_id','document_id','title']);const s=active(db,'skill',c.skill_id);invariant(!skills.has(c.skill_id)&&required(c.title,500),'Повтор навыка или пустой заголовок');skills.add(c.skill_id);
   if(c.document_id){const doc=active(db,'document',c.document_id);invariant(doc.kind==='sop'&&doc.operation_id===s.operation_id&&one(db,"SELECT id FROM document_revision WHERE document_id=? AND state='effective'",[doc.id])&&c.title===doc.code+' · '+doc.title,'СОП не соответствует навыку или не введён в действие')}
   else invariant(!s.operation_id&&c.title===s.name,'Операционный навык должен быть связан с действующим СОП');
  }
  // Baseline stores evidence-backed values as they were displayed, never future
  // or manually fabricated qualification. Later assessments do not alter it.
  const m=matrixData(db,p.base_on),n=p.roster.length*p.columns.length;
  invariant(Array.isArray(p.baseline)&&p.baseline.length===n,'Неполный исходный срез матрицы');
  let i=0;for(const r of p.roster)for(const c of p.columns){
   const b=p.baseline[i++],x=m.cells.get(r.person_id+':'+c.skill_id),fact=x?.fact,doc=fact?.standard_revision_id?one(db,'SELECT document_id FROM document_revision WHERE id=?',[fact.standard_revision_id]):null;
   const actual=x?.valid&&x.revisionCurrent&&fact.scale_id===p.scale_id&&(!c.document_id||doc?.document_id===c.document_id)&&[1,2,3,4].includes(fact.level)?fact.level:null;
   exact(b,['person_id','skill_id','value','assessment_id']);
   invariant(b.person_id===r.person_id&&b.skill_id===c.skill_id&&b.value===actual&&b.assessment_id===(actual===null?null:fact.session_id),'Исходный срез изменился. Обновите предпросмотр');
  }
  const current=one(db,"SELECT id,rev FROM competency_matrix WHERE code=? AND state='active'",[p.code]);
  invariant(p.previous_id===(current?.id||null)&&p.previous_rev===(current?.rev||0),'Матрица уже изменена другим пользователем. Обновите данные перед сохранением');
  const prev=one(db,'SELECT MAX(version_no) n FROM competency_matrix WHERE code=?',[p.code])?.n||0;
  db.run("UPDATE competency_matrix SET state='retired',rev=rev+1 WHERE code=? AND state='active'",[p.code]);
  store(db,t,{id,code:p.code,title:p.title,author_id:p.author_id,unit_id:p.unit_id,shift_id:p.shift_id,scale_id:p.scale_id,base_on:p.base_on,target_on:p.target_on,roster_json:canonical(p.roster),columns_json:canonical(p.columns),baseline_json:canonical(p.baseline),created_at:e.occurred_at,state:'active',version_no:prev+1,rev:1});return
 }
 if(t==='mentor_self_evaluation'){
  createOnly(e,old);exact(p,['person_id','method_id','evaluated_on','place','responses','feedback']);noFuture(p.evaluated_on,e);
  const who=person(db,p.person_id);hasRole(db,p.person_id,p.evaluated_on,['mentor','instructor','internal_trainer']);
  invariant(trainingMethods(db,SELF_CODE).some(x=>x.id===p.method_id&&x.state==='active')&&required(p.place)&&text(p.feedback),'Выберите действующую методику самооценки и место');
  const criteria=practicalCriteria(db,p.method_id);invariant(Array.isArray(p.responses)&&criteria.length>0&&p.responses.length===criteria.length,'Оцените все критерии самооценки');
  p.responses.forEach((x,i)=>{exact(x,['criterion_id','value','note']);invariant(x.criterion_id===criteria[i].id&&integer(x.value,1,5)&&text(x.note),'Самооценка: уровень 1–5, незаполненное не равно нулю')});
  store(db,t,{id,person_id:p.person_id,method_id:p.method_id,evaluated_on:p.evaluated_on,place:p.place,person_name:who.display_name,responses_json:canonical(p.responses),feedback:p.feedback,recorded_at:e.occurred_at,rev:1});return
 }
 if(t==='audit_session'){
  if(old){changeOnly(e,old);exact(p,['command','reason']);invariant(old.assignment_id&&old.state==='final'&&p.command==='void'&&required(p.reason),'Укажите основание аннулирования');update(db,t,id,{state:'void',void_reason:p.reason});return}
  createOnly(e,old);exact(p,['assignment_id','assignment_rev','method_id','auditor_id','session_id','observed_on','responses','feedback']);
  const a=freshAssignment(db,p);noFuture(p.observed_on,e);person(db,p.auditor_id);
  hasRole(db,p.auditor_id,p.observed_on,['internal_trainer']);invariant(p.auditor_id!==a.mentor_id&&p.auditor_id!==a.trainee_id,'Внутренний тренер должен отличаться от инструктора и обучаемого');
  const fact=one(db,'SELECT * FROM training_session WHERE id=? AND assignment_id=? AND stage_code IS NOT NULL',[p.session_id,a.id]);
  invariant(a.state!=='cancelled'&&a.approval_json&&fact&&fact.held_at.slice(0,10)<=p.observed_on&&p.observed_on>=a.assigned_on&&required(p.feedback),'Выберите факт этого инструктажа, дату наблюдения и обратную связь');
  invariant(trainingMethods(db,AUDIT_CODE).some(x=>x.id===p.method_id&&x.state==='active'),'Выберите действующую методику аудита L1');
  const criteria=practicalCriteria(db,p.method_id);invariant(Array.isArray(p.responses)&&criteria.length>0&&p.responses.length===criteria.length,'Заполните все критерии аудита');
  p.responses.forEach((x,i)=>{exact(x,['criterion_id','value','note']);invariant(x.criterion_id===criteria[i].id&&(x.value===0||x.value===1)&&text(x.note),'Некорректный ответ аудита')});
  store(db,t,{id,version_id:p.method_id,mentor_id:a.mentor_id,auditor_id:p.auditor_id,trainee_id:a.trainee_id,operation_id:a.operation_id,standard_revision_id:a.sop_revision_id,training_session_id:fact.id,observed_at:p.observed_on,state:'draft',recorded_names_json:canonical(names(db,{mentor:a.mentor_id,auditor:p.auditor_id,trainee:a.trainee_id})),assignment_id:a.id,summary:p.feedback,recorded_at:e.occurred_at,rev:1});
  p.responses.forEach(x=>store(db,'audit_response',{id:id+':'+x.criterion_id,audit_id:id,version_id:p.method_id,criterion_id:x.criterion_id,response:x.value?'yes':'no',note:x.note}));db.run("UPDATE audit_session SET state='final' WHERE id=?",[id]);return
 }
 if(t==='mentor_order'){
  createOnly(e,old);exact(p,['order_number','order_on','organization','city','approved_by','valid_from','valid_to','supplement_from','instructor_amount','trainer_amount','evidence','members']);
  const approver=person(db,p.approved_by);noFuture(p.order_on,e);
  invariant(required(p.order_number,200)&&required(p.organization,300)&&required(p.city,150)&&required(p.evidence)&&period(p.valid_from,p.valid_to)&&p.order_on<=p.valid_from&&Array.isArray(p.members)&&p.members.length>0&&p.members.length<=200,'Заполните реквизиты подписанного группового приказа');
  invariant([p.instructor_amount,p.trainer_amount].every(v=>v===null||integer(v,0,10000000)),'Доплата: целая сумма рублей или не установлена');
  invariant((p.instructor_amount===null&&p.trainer_amount===null)?p.supplement_from===null:date(p.supplement_from)&&p.supplement_from>=p.order_on,'Укажите дату начала доплаты');
  invariant(!one(db,'SELECT id FROM mentor_order WHERE organization=? AND order_number=? AND order_on=?',[p.organization,p.order_number,p.order_on]),'Такой групповой приказ уже зарегистрирован');
  const seen=new Set(),ids=new Set();
  const members=p.members.map(m=>{
   exact(m,['id','credential_id','acknowledged_on']);invariant(isId(m.id)&&!ids.has(m.id),'Повтор идентификатора назначения');ids.add(m.id);
   noFuture(m.acknowledged_on,e);invariant(m.acknowledged_on>=p.order_on,'Ознакомление не может предшествовать приказу');
   const c=certificateValid(db,m.credential_id,p.valid_from);invariant(c&&roles.includes(c.role),'Нужен действующий сертификат, а не свидетельство');
   const who=person(db,c.person_id),position=orderPosition(db,who.id,p.valid_from);
   invariant(position.trim(),'Укажите действующую должность сотрудника в справочнике: '+who.display_name);
   const key=who.id+':'+(c.role==='internal_trainer'?'internal_trainer':'instructor');invariant(!seen.has(key),'Сотрудник повторяется в одной группе приказа');seen.add(key);
   return {id:m.id,person_id:who.id,credential_id:c.id,role:c.role,order_number:p.order_number,order_on:p.order_on,approved_by:p.approved_by,valid_from:p.valid_from,valid_to:p.valid_to,acknowledged_on:m.acknowledged_on,evidence:p.evidence,order_id:id,person_name:who.display_name,position_name:position,rev:1}
  });
  const {members:ignored,...header}=p;store(db,t,{id,...header,approved_name:approver.display_name,recorded_at:e.occurred_at,rev:1});
  for(const m of members)store(db,'mentor_appointment',m);return
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
  invariant(previous.every(x=>x.kind===p.kind),'Код уже принадлежит другому виду программы');
  const version=Math.max(0,...previous.map(x=>x.version_no))+1,code=previous[0]?.code||p.code.trim();
  for(const x of previous.filter(x=>x.state==='active'))update(db,t,x.id,{state:'retired'});
  store(db,t,{id,code,version_no:version,kind:p.kind,title:p.title.trim(),profession_id:p.profession_id,position_id:p.position_id,created_by:p.created_by,created_at:e.occurred_at,state:'active',rev:1});
  p.tasks.forEach((x,i)=>store(db,'training_program_task',{id:id+':'+(i+1),program_id:id,position:i+1,...x}));return
 }
 if(t==='training_enrollment'){
  if(!old){
   createOnly(e,old);
   const hasPeriods=Object.hasOwn(p,'internship_start'),baseKeys=['program_id','trainee_id','mentor_id','manager_id','start_on','due_on','reason'];
   exact(p,hasPeriods?[...baseKeys,'internship_start','internship_end','entry_start','entry_end']:baseKeys);
   const program=one(db,'SELECT * FROM training_program WHERE id=? AND state=?',[p.program_id,'active']);invariant(program&&period(p.start_on,p.due_on)&&p.due_on&&required(p.reason),'Выберите активную программу, сроки и причину');
   if(hasPeriods){
    for(const [a,b] of [[p.internship_start,p.internship_end],[p.entry_start,p.entry_end]])invariant(a===null&&b===null||date(a)&&date(b)&&a<=b&&a>=p.start_on&&b<=p.due_on,'Периоды стажировки и ввода должны быть указаны полностью и входить в общий срок');
    if(program.kind==='internship')invariant(p.internship_start&&p.internship_end&&p.entry_start&&p.entry_end,'Укажите оба периода из формы стажировки');
   }
   invariant(rows(db,'SELECT day_offset FROM training_program_task WHERE program_id=?',[program.id]).every(x=>plusDays(p.start_on,x.day_offset)<=p.due_on),'Срок персональной программы должен включать все задания');
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
   invariant(r.effective_at&&p.assigned_on>=r.effective_at.slice(0,10),'Начало обучения не может предшествовать вступлению СОП в действие');
   hasRole(db,p.trainee_id,p.assigned_on,['trainee']);person(db,p.assigned_by);invariant(p.trainee_id!==p.mentor_id,'Инструктор и обучаемый должны различаться');
   const auth=one(db,'SELECT * FROM mentor_authorization WHERE id=?',[p.authorization_id]);invariant(auth?.person_id===p.mentor_id&&auth.operation_id===r.operation_id&&authorizationValid(db,auth.id,p.assigned_on),'Выберите инструктора с действующим правом обучать этой операции');
   if(p.supervisor_id){hasRole(db,p.supervisor_id,p.assigned_on,['mentor','instructor']);invariant(p.supervisor_id!==p.trainee_id,'Наставник и обучаемый должны различаться')}
   optional(db,'work_shift',p.shift_id);exactAssignmentTarget(db,p,r);
   if(p.enrollment_id!==null||p.program_task_id!==null){
    const n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[p.enrollment_id]),task=one(db,'SELECT * FROM training_program_task WHERE id=?',[p.program_task_id]);
    invariant(n?.state==='active'&&n.trainee_id===p.trainee_id&&task?.program_id===n.program_id&&task.sop_revision_id===r.id&&task.skill_id===p.skill_id&&task.scale_id===p.scale_id&&task.target_level===p.target_level&&p.assigned_on>=n.start_on&&p.due_on<=n.due_on&&!latestTaskAssignment(db,n.id,task.id),'Назначение не соответствует заданию персональной программы')
   }
   invariant(!one(db,"SELECT id FROM training_assignment WHERE trainee_id=? AND sop_revision_id=? AND skill_id=? AND state IN('planned','in_progress')",[p.trainee_id,r.id,p.skill_id]),'У сотрудника уже есть открытое назначение по этому навыку и редакции');
   store(db,t,{id,trainee_id:p.trainee_id,mentor_id:p.mentor_id,supervisor_id:p.supervisor_id,operation_id:r.operation_id,sop_revision_id:r.id,twi_revision_id:r.id,due_on:p.due_on,state:'planned',rev:1,source_sha256:r.source.sha256,skill_id:p.skill_id,scale_id:p.scale_id,target_level:p.target_level,assigned_by:p.assigned_by,assigned_on:p.assigned_on,reason:p.reason,method_variant:p.variant,method_version:'JI-1',authorization_id:p.authorization_id,shift_id:p.shift_id,enrollment_id:p.enrollment_id,program_task_id:p.program_task_id,recorded_names_json:canonical(names(db,{trainee:p.trainee_id,instructor:p.mentor_id,supervisor:p.supervisor_id,assignedBy:p.assigned_by}))});
   return
  }
  changeOnly(e,old);invariant(old.source_sha256&&['planned','in_progress'].includes(old.state),'Назначение закрыто или относится к legacy');
  if(p.command==='approve'){
   exact(p,['command','responsible_id','head_id','approved_on','note']);person(db,p.responsible_id);person(db,p.head_id);noFuture(p.approved_on,e);
   const r=effective(db,old.sop_revision_id);invariant(r.effective_at&&p.approved_on>=r.effective_at.slice(0,10)&&text(p.note)&&!old.approval_json,'План должен быть актуальным и ещё не согласован. Согласование допускается до планового начала обучения.');
   update(db,t,id,{approval_json:canonical({...p,names:names(db,{responsible:p.responsible_id,head:p.head_id})})});return
  }
  if(p.command==='reschedule'){
   exact(p,['command','due_on','reason']);invariant(date(p.due_on)&&p.due_on>=old.assigned_on&&required(p.reason),'Укажите новый срок и причину');
   if(old.enrollment_id){const n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[old.enrollment_id]);invariant(n?.state==='active'&&p.due_on<=n.due_on,'Срок назначения не может выходить за пределы персональной программы')}
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
  if(a.method_variant==='hazardous'&&stage.phase==='practice'){const safety=latestVerification(db,a.id,'safety');invariant(safety?.result==='pass'&&safety.evaluated_on<=day,'Сначала зарегистрируйте подтверждение обязательной проверки безопасности')}
  store(db,t,{id,assignment_id:a.id,mentor_id:a.mentor_id,held_at:p.held_at,notes:p.notes,result:p.result,steps_json:canonical({version:a.method_version,variant:a.method_variant,stage:stage.code,label:stage.label,repeat:pr.done.has(stage.code)}),rev:1,stage_code:stage.code,duration_minutes:p.duration_minutes,witness_id:p.witness_id,witness_name:witness?.display_name||null,mentor_ack:1,trainee_ack:1,recorded_at:e.occurred_at});
  const done=progressFor(db,a);update(db,'training_assignment',a.id,{state:done.complete?'completed':'in_progress'});
  if(a.enrollment_id){const n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[a.enrollment_id]);if(n?.state==='active')update(db,'training_enrollment',n.id,{state:n.state})}return
 }
 if(t==='training_verification'){
  createOnly(e,old);exact(p,['assignment_id','assignment_rev','kind','evaluator_id','evaluated_on','result','evidence','feedback']);
  const a=freshAssignment(db,p);person(db,p.evaluator_id);noFuture(p.evaluated_on,e);
  invariant(a.state!=='cancelled'&&a.approval_json&&isCurrentStandard(db,a.sop_revision_id)&&p.evaluator_id!==a.trainee_id&&p.evaluated_on>=a.assigned_on&&p.evaluated_on>=JSON.parse(a.approval_json).approved_on&&['safety','theory'].includes(p.kind)&&['pass','fail'].includes(p.result)&&required(p.evidence)&&required(p.feedback),'Проверка требует согласованного назначения, отдельного оценщика, даты, результата и основания');
  const prev=latestVerification(db,a.id,p.kind);invariant(!prev||p.evaluated_on>=prev.evaluated_on,'Нельзя подменить историю более ранней проверкой');
  const {assignment_rev,...data}=p;store(db,t,{id,...data,recorded_at:e.occurred_at,rev:1});update(db,'training_assignment',a.id,{state:a.state});return
 }
 if(t==='assessment_session'){
  createOnly(e,old);
  const a=freshAssignment(db,p);person(db,p.evaluator_id);noFuture(p.assessed_on,e);
  invariant(a.state!=='cancelled'&&a.approval_json&&isCurrentStandard(db,a.sop_revision_id)&&p.evaluator_id!==a.trainee_id&&p.assessed_on>=a.assigned_on&&p.assessed_on>=JSON.parse(a.approval_json).approved_on&&required(p.feedback),'Нужна актуальная согласованная запись, отдельный оценщик и обратная связь');
  const prev=latestAssessment(db,a.id,p.command);invariant(!prev||p.assessed_on>=prev.assessed_at.slice(0,10),'Нельзя подменить историю более ранней оценкой');
  const pr=progressFor(db,a),latestTrial=pr.facts.filter(x=>x.stage_code.startsWith('try')&&x.result==='completed').at(-1);
  invariant(pr.intro&&latestTrial&&p.assessed_on>=latestTrial.held_at.slice(0,10),'Сначала завершите вводную часть инструктажа и практические пробы');
  const common={id,person_id:a.trainee_id,evaluator_id:p.evaluator_id,training_session_id:latestTrial.id,operation_id:a.operation_id,standard_revision_id:a.sop_revision_id,assessed_at:p.assessed_on,state:'draft',assignment_id:a.id,assessment_kind:p.command,feedback:p.feedback,recorded_at:e.occurred_at,recorded_names_json:canonical(names(db,{trainee:a.trainee_id,evaluator:p.evaluator_id})),rev:1};
  if(p.command==='practical'){
   exact(p,['command','assignment_id','assignment_rev','evaluator_id','assessed_on','method_id','responses','conclusion','feedback']);
   invariant(practicalMethods(db).some(x=>x.id===p.method_id&&x.state==='active')&&Object.hasOwn(conclusions,p.conclusion),'Выберите действующую методику практики и фактическое заключение');
   const c=practicalCriteria(db,p.method_id);invariant(c.length>0&&Array.isArray(p.responses)&&p.responses.length===c.length,'Необходимо ответить на все '+c.length+' критериев');
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
  invariant(a.state!=='cancelled'&&a.approval_json&&isCurrentStandard(db,a.sop_revision_id)&&p.actor_id!==a.trainee_id&&p.decided_on>=a.assigned_on&&p.decided_on>=JSON.parse(a.approval_json).approved_on&&period(p.decided_on,p.valid_until)&&['granted','denied'].includes(p.decision)&&required(p.evidence)&&required(p.feedback),'Допуск требует явного решения ответственного, даты, основания и обратной связи');
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
 const req=new Map(requirements.map(x=>[x.profession_id+':'+x.skill_id,x]));
 const facts=rows(db,`SELECT * FROM (SELECT i.*,s.person_id,s.assessed_at,s.standard_revision_id,s.evaluator_id,s.assignment_id,s.recorded_at,
 ROW_NUMBER() OVER(PARTITION BY s.person_id,i.skill_id ORDER BY s.assessed_at DESC,coalesce(s.recorded_at,'') DESC,s.id DESC) rn
 FROM assessment_item i JOIN assessment_session s ON s.id=i.session_id WHERE s.state='confirmed' AND substr(s.assessed_at,1,10)<=?) WHERE rn=1`,[day]);
 const observed=new Map(facts.map(x=>[x.person_id+':'+x.skill_id,x]));
 const records=rows(db,`SELECT * FROM (SELECT a.*,ROW_NUMBER() OVER(PARTITION BY person_id,operation_id ORDER BY decided_on DESC,recorded_at DESC,id DESC) rn FROM admission_decision a WHERE decided_on<=?) WHERE rn=1`,[day]);
 const admissions=new Map(records.map(a=>[a.person_id+':'+a.operation_id,admissionRecordStatus(db,a,day)]));
 const current=new Set(rows(db,"SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='effective' AND d.archived=0").map(x=>x.id));
 const cells=new Map();for(const p of people)for(const s of skills){
  const goal=req.get(p.profession_id+':'+s.id)||null,fact=observed.get(p.id+':'+s.id)||null,same=!goal||fact?.scale_id===goal.scale_id;
  const valid=!!(fact?.observation_state==='rated'&&(!fact.valid_until||fact.valid_until>=day)),revisionCurrent=!s.operation_id||!!(fact?.standard_revision_id&&current.has(fact.standard_revision_id));
  const adm=s.operation_id?(admissions.get(p.id+':'+s.operation_id)||{record:null,status:'Нет решения',current:false}):null;
  cells.set(p.id+':'+s.id,{goal,fact,same,valid,revisionCurrent,admission:adm,gap:!!(goal&&(!valid||!same||!revisionCurrent||fact.level<goal.required_level)),qualified:!!(valid&&same&&revisionCurrent&&(!goal||fact.level>=goal.required_level)&&(!adm||adm.current&&adm.record.revision_id===fact.standard_revision_id))})
 }return {people,skills,cells}
}
export function coverageData(db,day,matrix=matrixData(db,day)){
 return rows(db,'SELECT * FROM coverage_requirement ORDER BY unit_id,skill_id,shift_code').map(r=>{
  const skill=matrix.skills.find(s=>s.id===r.skill_id),scope=matrix.people.filter(p=>p.unit_id===r.unit_id&&(!r.shift_code||p.shift_code===r.shift_code||one(db,'SELECT code FROM work_shift WHERE id=?',[p.shift_id])?.code===r.shift_code));
  const actual=scope.filter(p=>{const c=matrix.cells.get(p.id+':'+r.skill_id);return c?.valid&&c.revisionCurrent&&c.fact.scale_id===r.scale_id&&c.fact.level>=r.required_level&&(!skill?.operation_id||c.admission?.current&&c.admission.record.revision_id===c.fact.standard_revision_id)}).length;
  return {...r,actual,deficit:Math.max(0,r.min_people-actual),fraction:r.min_people?actual/r.min_people:null,scope:scope.length}
 })
}
