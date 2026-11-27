// LC8.1: actual observations, self-evaluation and corrective work.
// All scoring, duplicate detection and effectiveness rules are from LC4/LC5.
import {one,rows,isId,uuid,canonical,applyEvent} from '../../src/core/db.js';
import {auditMethods,trainingMethods,practicalCriteria,selfLevelsForMethod,AUDIT_CODE,AUDIT_STANDARD_CODE,SELF_CODE,methodLabel} from '../../src/modules/training/domain.js';
import {RC1_CRITERIA} from '../../src/modules/training/builtin-forms.js';
import {AUDIT_V03,SELF_V03} from '../../src/modules/training/standard-v03.js';
import {auditDetails,actionRows,actionStatus,actionSource,actionSourceOf,evidenceForAction,practicalEvidenceForAction,ACTION_KINDS,ACTION_STATES,RESPONSE_LABELS} from '../../src/modules/training/audit-domain.js';
import {ACTION_VERIFY_DATE_BASIS} from '../../src/modules/training/action-calendar.js';
import {auditResource,selfResource,developmentResource,practicalResource,taskResource,trainingAssignmentResource,enrollmentResource,personWorkResource,programResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const txt=(s,n=2000)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const string=(s,n=2000)=>typeof s==='string'&&s.length<=n;
const who=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
const name=(a,id)=>who(a,id)?.data.display_name??null;
const allowed=(a,k,id,r)=>!!r&&a.allows(k,id,r);
const site=(db,a,k)=>{const r=programResource(db);return !!r&&allowed(a,k,r.units[0],r)};
const find=(db,t,id)=>isId(id)?one(db,'SELECT * FROM '+t+' WHERE id=?',[id]):null;
const join=(r,extra)=>r&&extra?{...r,units:[...new Set([...r.units,...extra.units])]}:null;
const METHODS=Object.freeze({rc1:{code:AUDIT_CODE,payload:{format:'lean-audit-checklist-v1',title:'Аудит 1-го уровня · RC1',source_sha256:'0'.repeat(64),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)}},corporate:{code:AUDIT_STANDARD_CODE,payload:AUDIT_V03},self:{code:SELF_CODE,payload:SELF_V03}});
function emit(db,a,t,id,operation,rev,payload,action){
 const e=uuid();try{applyEvent(db,{id:e,entity_type:t,entity_id:id,operation,expected_revision:rev,payload,occurred_at:a.at})}
 catch(err){throw new PilotError(422,'Проверка: '+String(err.message||'ошибка').split('\n')[0].slice(0,300))}
 a.audit(action,e);return {id,rev:one(db,'SELECT rev FROM '+t+' WHERE id=?',[id]).rev};
}
const activeMethods=(db,kind)=>(kind==='audit'?auditMethods(db):trainingMethods(db,SELF_CODE)).filter(m=>m.state==='active');
const methodView=(db,m)=>({id:m.id,label:methodLabel(m),method_code:m.method_code,criteria:practicalCriteria(db,m.id).map(q=>({id:q.id,position:q.position,section:q.section_code,question:q.question})),...(m.method_code===SELF_CODE?{levels:selfLevelsForMethod(db,m.id)}:{})});
export function installMentorMethod(db,a,f){
 must(a.personId&&site(db,a,'mentor.method.install')&&exact(f,['kind'])&&Object.hasOwn(METHODS,f.kind),403,'Установка методики недоступна');
 const m=METHODS[f.kind];must(!trainingMethods(db,m.code).some(x=>x.state==='active'),409,'Действующая методика уже зарегистрирована; замена отдельно');
 return emit(db,a,'checklist_version',uuid(),'create',0,m.payload,'mentor.method.install');
}
function auditCreateResource(db,a,t,on){
 if(!t||!a.personId||a.personId===t.mentor_id||a.personId===t.trainee_id)return null;
 return trainingAssignmentResource(db,t.id,a.day,[a.personId],on);
}
export function qualityOptions(db,a,kind){
 must(['audit','self'].includes(kind),400,'Неизвестный раздел');
 const methods=activeMethods(db,kind).map(m=>methodView(db,m)),missing=Object.entries(METHODS).filter(([k,m])=>(kind==='self'?k==='self':k!=='self')&&!trainingMethods(db,m.code).some(x=>x.state==='active')).map(([k])=>k);
 const out={day:a.day,methods,installable:a.personId&&site(db,a,'mentor.method.install')?missing:[]};
 if(kind==='audit'){
  must(a.permissions.includes('audit.read'),403,'Аудиты недоступны');
  out.assignments=a.personId&&a.permissions.includes('audit.create')?rows(db,"SELECT * FROM training_assignment WHERE state<>'cancelled' AND approval_json IS NOT NULL ORDER BY assigned_on DESC,id").filter(t=>a.read('training.read',t.id)&&allowed(a,'audit.create',t.id,auditCreateResource(db,a,t,a.day))).flatMap(t=>{
   const sessions=rows(db,'SELECT id,stage_code,held_at FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL ORDER BY held_at,id',[t.id]);return sessions.length?[{id:t.id,rev:t.rev,label:(name(a,t.mentor_id)||'Инструктор')+' · '+(a.read('operation.read',t.operation_id)?.data.name||'Операция')+' · '+t.assigned_on,sessions}]:[];
  }):[];
 }else{
  must(a.permissions.includes('self.read'),403,'Самооценка недоступна');
  out.can_create=!!a.personId&&allowed(a,'self.create',a.personId,selfResource(db,{person_id:a.personId,evaluated_on:a.day},a.day));
 }
 return out;
}
export function createAudit(db,a,f){
 must(a.personId&&exact(f,['assignment_id','assignment_rev','method_id','session_id','observed_on','responses','feedback'])&&[f.assignment_id,f.method_id,f.session_id].every(isId)&&Number.isSafeInteger(f.assignment_rev)&&date(f.observed_on)&&f.observed_on<=a.day&&Array.isArray(f.responses)&&f.responses.length<=100&&txt(f.feedback),400,'Неверный аудит');
 const t=find(db,'training_assignment',f.assignment_id),r=auditCreateResource(db,a,t,f.observed_on);
 must(t&&a.read('training.read',t.id)&&allowed(a,'audit.create',t.id,r)&&allowed(a,'audit.read',t.id,r),403,'Аудит выходит за область полномочий');
 must(t.rev===f.assignment_rev,409,'Назначение изменилось');
 must(activeMethods(db,'audit').some(x=>x.id===f.method_id),422,'Методика недоступна');
 // Native event preserves exact ordered responses and deduplicates an observation.
 return emit(db,a,'audit_session',uuid(),'create',0,{...f,command:'observe_lc5',auditor_id:a.personId},'audit.create');
}
export function createSelf(db,a,f){
 must(a.personId&&exact(f,['method_id','evaluated_on','place','responses','feedback'])&&isId(f.method_id)&&date(f.evaluated_on)&&f.evaluated_on<=a.day&&txt(f.place)&&string(f.feedback)&&Array.isArray(f.responses)&&f.responses.length<=100,400,'Неверная самооценка');
 const r=selfResource(db,{person_id:a.personId,evaluated_on:f.evaluated_on},a.day);
 must(allowed(a,'self.create',a.personId,r)&&allowed(a,'self.read',a.personId,r),403,'Самооценка недоступна');
 return emit(db,a,'mentor_self_evaluation',uuid(),'create',0,{...f,person_id:a.personId},'self.create');
}
export function voidAudit(db,a,f){
 must(a.personId&&exact(f,['id','expected_revision','reason'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&txt(f.reason),400,'Укажите основание аннулирования');
 const t=find(db,'audit_session',f.id),r=auditResource(db,t,a.day);
 must(t&&a.read('audit.read',t.id)&&a.personId!==t.mentor_id&&a.personId!==t.trainee_id&&allowed(a,'audit.void',t.id,r),403,'Аудит недоступен');
 must(t.rev===f.expected_revision&&t.state==='final',409,'Аудит изменён');
 return emit(db,a,'audit_session',t.id,'update',t.rev,{command:'void',reason:f.reason},'audit.void');
}
export function qualityDetail(db,a,kind,id){
 if(kind==='audit'){
  const t=find(db,'audit_session',id),r=auditResource(db,t,a.day);
  must(t&&a.read('audit.read',id)&&allowed(a,'audit.detail',id,r),404,'Аудит недоступен');
  const d=auditDetails(db,id);
  return {id,rev:t.rev,state:t.state,date:t.observed_at,mentor:name(a,t.mentor_id),auditor:name(a,t.auditor_id),operation:a.read('operation.read',t.operation_id)?.data.name??null,method:d.method_code,version:d.version_no,summary:t.summary,void_reason:t.void_reason,stats:d.stats,questions:d.questions.map(q=>({id:q.id,position:q.position,section:q.section_code,question:q.question,response:q.response,note:q.note,recommendation:q.recommendation,response_id:q.response_id})),labels:RESPONSE_LABELS,can_void:!!a.personId&&t.state==='final'&&a.personId!==t.mentor_id&&a.personId!==t.trainee_id&&allowed(a,'audit.void',id,r),can_task:!!a.personId&&t.state==='final'&&allowed(a,'task.create',id,r)};
 }
 must(kind==='self',400,'Неизвестный вид');
 const s=find(db,'mentor_self_evaluation',id),r=selfResource(db,s,a.day);
 must(s&&a.read('self.read',id)&&allowed(a,'self.detail',id,r),404,'Самооценка недоступна');
 const answers=JSON.parse(s.responses_json),method=one(db,'SELECT version_no FROM checklist_version WHERE id=?',[s.method_id]);
 return {id,date:s.evaluated_on,person_name:name(a,s.person_id),place:s.place,feedback:s.feedback,version:method.version_no,levels:selfLevelsForMethod(db,s.method_id),questions:practicalCriteria(db,s.method_id).map(q=>({id:q.id,position:q.position,section:q.section_code,question:q.question,value:answers.find(x=>x.criterion_id===q.id)?.value??null,note:answers.find(x=>x.criterion_id===q.id)?.note??''})),can_task:!!a.personId&&allowed(a,'task.create',id,r)};
}
// Source references are resolved server-side, not accepted as display labels,
// person identities or permission attributes from the browser.
function sourceFor(db,a,s){
 if(s===null)return {resource:null,subject_id:null,response_id:null,link:null,label:'Самостоятельная задача',kinds:['corrective']};
 must(exact(s,['kind','id','criterion_id'])&&isId(s.id)&&(s.criterion_id===null||string(s.criterion_id,150)),400,'Неверный источник');
 if(s.kind==='audit'){
  const t=find(db,'audit_session',s.id),r=auditResource(db,t,a.day);
  must(t&&t.state==='final'&&a.read('audit.read',t.id)&&allowed(a,'audit.detail',t.id,r),404,'Аудит недоступен');
  const q=one(db,"SELECT r.id,c.question FROM audit_response r JOIN checklist_criterion c ON c.id=r.criterion_id WHERE r.audit_id=? AND r.criterion_id=? AND r.response='no'",[t.id,s.criterion_id]);
  must(q,422,'Выберите подтверждённое отклонение');
  return {resource:r,subject_id:t.mentor_id,response_id:q.id,link:null,label:q.question,kinds:['corrective','instructor_training','development']};
 }
 let r=null,kinds=['corrective','development'],subject=null;
 if(s.kind==='self_eval'){
  const x=find(db,'mentor_self_evaluation',s.id);r=selfResource(db,x,a.day);
  must(x&&a.read('self.read',x.id)&&allowed(a,'self.detail',x.id,r),404,'Самооценка недоступна');subject=x.person_id;
 }else if(s.kind==='practical'){
  const x=find(db,'assessment_session',s.id);r=practicalResource(db,x,a.day);
  must(x&&x.assessment_kind==='practical'&&a.read('training.read',x.assignment_id)&&allowed(a,'training.detail',x.assignment_id,r),404,'Практическая оценка недоступна');
  subject=x.person_id;if(x.conclusion==='not_meet')kinds.push('trainee_training');
 }else if(s.kind==='development_goal'){
  const g=find(db,'development_goal',s.id),p=g&&find(db,'development_plan',g.plan_id);r=developmentResource(db,p,a.day);
  must(p&&g.state==='open'&&a.read('development.read',p.id)&&allowed(a,'development.detail',p.id,r),404,'Цель недоступна');subject=p.person_id;
 }else throw new PilotError(400,'Источник не подключён');
 const x=actionSource(db,s.kind,s.id,s.criterion_id);
 must(x,422,'Критерий источника недоступен');
 return {resource:r,subject_id:subject,response_id:null,link:{kind:s.kind,id:s.id,...(s.criterion_id===null?{}:{criterion_id:s.criterion_id})},label:x.label,kinds};
}
function taskCreateResource(db,a,s,owner){
 const r=personWorkResource(db,[owner,...(s.subject_id?[s.subject_id]:[])],a.day);
 return s.resource?join(r,s.resource):r;
}
export function taskOptions(db,a,source){
 must(a.personId&&a.permissions.includes('task.create')&&a.permissions.includes('task.read'),403,'Создание задач недоступно');
 const s=sourceFor(db,a,source);
 const owners=rows(db,'SELECT id,display_name name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>who(a,p.id)&&allowed(a,'task.create',p.id,taskCreateResource(db,a,s,p.id))&&allowed(a,'task.read',p.id,taskCreateResource(db,a,s,p.id)));
 return {day:a.day,owners,label:s.label,kinds:s.kinds.map(k=>[k,ACTION_KINDS[k]])};
}
export function createTask(db,a,f){
 must(a.personId&&exact(f,['source','title','owner_id','due_on','kind','priority'])&&txt(f.title,500)&&isId(f.owner_id)&&date(f.due_on)&&f.due_on>=a.day&&Object.hasOwn(ACTION_KINDS,f.kind)&&['normal','major','critical'].includes(f.priority),400,'Неверная задача');
 const s=sourceFor(db,a,f.source),r=taskCreateResource(db,a,s,f.owner_id);
 must(s.kinds.includes(f.kind)&&who(a,f.owner_id)&&allowed(a,'task.create',f.owner_id,r)&&allowed(a,'task.read',f.owner_id,r),403,'Задача выходит за область полномочий');
 return emit(db,a,'action_item',uuid(),'create',0,{response_id:s.response_id,title:f.title,owner_id:f.owner_id,subject_id:s.subject_id,due_on:f.due_on,kind:f.kind,priority:f.priority,...(s.link?{source_link:s.link}:{})},'task.create');
}
function linkedCandidates(db,a,t,r){
 const typ={trainee_training:'assignment',instructor_training:'enrollment',development:'plan'}[t.kind];if(!typ||!t.subject_id)return {type:null,items:[]};
 let items=[];
 if(typ==='assignment'){
  const p=find(db,'assessment_session',t.source_assessment_id);
  if(p)items=rows(db,"SELECT * FROM training_assignment WHERE trainee_id=? AND operation_id=? AND id<>? AND state<>'cancelled' ORDER BY assigned_on DESC,id",[t.subject_id,p.operation_id,t.source_assignment_id]).filter(x=>a.read('training.read',x.id)&&allowed(a,'task.link',t.id,join(r,trainingAssignmentResource(db,x.id,a.day)))).map(x=>({id:x.id,label:'Обучение · '+x.assigned_on+' · '+x.state}));
 }else if(typ==='enrollment'){
  items=rows(db,"SELECT n.*,p.title FROM training_enrollment n JOIN training_program p ON p.id=n.program_id WHERE n.trainee_id=? AND n.state<>'cancelled' ORDER BY n.start_on DESC,n.id",[t.subject_id]).filter(x=>a.read('training.enrollment.read',x.id)&&allowed(a,'task.link',t.id,join(r,enrollmentResource(db,x,a.day)))).map(x=>({id:x.id,label:x.title+' · '+x.start_on+' · '+x.state}));
 }else items=rows(db,"SELECT * FROM development_plan WHERE person_id=? AND state<>'cancelled' ORDER BY due_on,id",[t.subject_id]).filter(x=>a.read('development.read',x.id)&&allowed(a,'task.link',t.id,join(r,developmentResource(db,x,a.day)))).map(x=>({id:x.id,label:x.title+' · '+x.state}));
 return {type:typ,items};
}
function taskEvidence(db,a,t,r){
 const audits=evidenceForAction(db,t,ACTION_VERIFY_DATE_BASIS).filter(x=>x.observed_at.slice(0,10)<=a.day&&a.read('audit.read',x.id)&&allowed(a,'audit.detail',x.id,auditResource(db,find(db,'audit_session',x.id),a.day))&&allowed(a,'task.verify',t.id,join(r,auditResource(db,find(db,'audit_session',x.id),a.day)))).map(x=>({id:x.id,label:x.observed_at+' · '+(RESPONSE_LABELS[x.response]||x.response)}));
 const practical=practicalEvidenceForAction(db,t,ACTION_VERIFY_DATE_BASIS).filter(x=>{
  const p=find(db,'assessment_session',x.id),v=practicalResource(db,p,a.day);return x.assessed_at.slice(0,10)<=a.day&&a.read('training.read',x.assignment_id)&&allowed(a,'training.detail',x.assignment_id,v)&&allowed(a,'task.verify',t.id,join(r,v))
 }).map(x=>({id:x.id,label:x.assessed_at+' · '+x.conclusion}));
 return {audits,practical};
}
function taskSourceLabel(db,a,t){
 const x=actionSourceOf(db,t);if(!x)return 'Самостоятельная задача';
 if(x.kind==='audit')return a.read('audit.read',x.id)?x.label:'Связанное отклонение';
 if(x.kind==='self_eval')return a.read('self.read',x.id)?x.label:'Связанная самооценка';
 if(x.kind==='practical'||x.kind==='assignment')return x.assignment_id&&a.read('training.read',x.assignment_id)?x.label:'Связанное обучение';
 if(x.kind==='development_goal'){const g=find(db,'development_goal',x.id);return g&&a.read('development.read',g.plan_id)?x.label:'Связанная цель'}
 return 'Связанный документ';
}
export function taskDetail(db,a,id){
 const t=actionRows(db).find(x=>x.id===id),r=taskResource(db,t,a.day);
 must(t&&a.read('task.read',id)&&allowed(a,'task.detail',id,r),404,'Карточка задачи недоступна');
 const status=actionStatus(db,t),open=['open','in_progress','ineffective'].includes(status),cap=k=>!!a.personId&&allowed(a,k,id,r);
 const follow=t.followup_assignment_id||t.followup_enrollment_id||t.followup_plan_id||null;
 const canVerify=cap('task.verify')&&a.personId!==t.owner_id&&status==='implemented';
 return {id,rev:t.rev,title:t.title,owner:name(a,t.owner_id),subject:name(a,t.subject_id),kind:t.kind,kind_label:ACTION_KINDS[t.kind],state:status,state_label:ACTION_STATES[status],priority:t.priority,due_on:t.due_on,result:t.result_note,source:taskSourceLabel(db,a,t),followup:follow?'Связь зарегистрирована':null,
  cap:{start:cap('task.start')&&a.personId===t.owner_id&&['open','ineffective'].includes(status),implement:a.personId===t.owner_id&&open&&a.permissions.includes('task.implement_own')&&(!['trainee_training','instructor_training'].includes(t.kind)||!!follow),link:cap('task.link')&&open,cancel:cap('task.cancel')&&[...['open','in_progress','ineffective'],'implemented'].includes(status),verify:canVerify},
  candidates:cap('task.link')&&open?linkedCandidates(db,a,t,r):{type:null,items:[]},evidence:canVerify?taskEvidence(db,a,t,r):{audits:[],practical:[]},
  verification:rows(db,'SELECT checked_at,outcome,evidence_note FROM action_verification WHERE action_id=? ORDER BY checked_at,id',[id])};
}
export function changeTask(db,a,f){
 must(a.personId&&exact(f,['id','expected_revision','command','fields'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&['start','link','cancel','verify'].includes(f.command),400,'Неверная команда задачи');
 const t=actionRows(db).find(x=>x.id===f.id),r=taskResource(db,t,a.day),action='task.'+f.command;
 must(t&&a.read('task.read',t.id)&&allowed(a,action,t.id,r),403,'Задача недоступна');
 must(t.rev===f.expected_revision,409,'Задача изменилась');
 let p;
 if(f.command==='start'){must(a.personId===t.owner_id&&exact(f.fields,[]),403,'Начало работы регистрирует исполнитель');p={command:'start'}}
 else if(f.command==='link'){
  const c=linkedCandidates(db,a,t,r);must(exact(f.fields,['type','id'])&&f.fields.type===c.type&&c.items.some(x=>x.id===f.fields.id),422,'Связанная программа недоступна');p={command:'link_followup',...f.fields};
 }else if(f.command==='cancel'){must(exact(f.fields,['reason'])&&txt(f.fields.reason),400,'Укажите причину');p={command:'cancel',...f.fields}}
 else{
  const v=f.fields;must(a.personId!==t.owner_id&&exact(v,['outcome','evidence','audit_id','assessment_id'])&&['effective','ineffective','insufficient'].includes(v.outcome)&&txt(v.evidence)&&(v.audit_id===null||isId(v.audit_id))&&(v.assessment_id===null||isId(v.assessment_id)),403,'Нужна независимая проверка');
  const e=taskEvidence(db,a,t,r);
  must((v.audit_id===null||e.audits.some(x=>x.id===v.audit_id))&&(v.assessment_id===null||e.practical.some(x=>x.id===v.assessment_id)),403,'Доказательство недоступно');
  p={command:'verify',verifier_id:a.personId,...v,verification_date_basis:ACTION_VERIFY_DATE_BASIS};
 }
 return emit(db,a,'action_item',t.id,'update',t.rev,p,action);
}
export function qualityView(db,a,action,data){
 if(action==='task.read'){
  const t=find(db,'action_item',data.id),r=taskResource(db,t,a.day);
  return {...data,kind:t.kind,owner:name(a,t.owner_id),subject:name(a,t.subject_id),can_detail:allowed(a,'task.detail',data.id,r)};
 }
 if(action==='audit.read'){const t=find(db,'audit_session',data.id);return {...data,mentor_name:name(a,t.mentor_id),operation_name:a.read('operation.read',t.operation_id)?.data.name??null,can_detail:allowed(a,'audit.detail',t.id,auditResource(db,t,a.day))}}
 const s=find(db,'mentor_self_evaluation',data.id);return {...data,person_name:name(a,s.person_id),can_detail:allowed(a,'self.detail',s.id,selfResource(db,s,a.day))};
}
