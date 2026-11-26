// LC5: one audit, explicit decisions and independently verified corrective actions.
import {rows,one,invariant,isId} from '../../core/db.js';
import {matchedComparison} from './mentor-comparison.js';
import {applyPlannedAssessment,scheduleKind} from './center-planning.js';
import {validDate} from '../library/sop-review.js';
export const ACTION_KINDS={corrective:'Корректирующее мероприятие',instructor_training:'Переобучение инструктора TWI',trainee_training:'Повторное производственное обучение',development:'Индивидуальное развитие'};
export const ACTION_STATES={open:'Открыто',in_progress:'В работе',implemented:'Ожидает проверки',verified:'Эффект подтверждён',ineffective:'Эффект не подтверждён',cancelled:'Отменено'};
export const RESPONSE_LABELS={yes:'Да',no:'Нет',not_observed:'Не наблюдалось',not_applicable:'Не применимо',legacy:'Историческая доля'};
export const LC5_TYPES={action_item:'Задача / мероприятие',schedule_event:'Календарное событие',rc1_archive:'Архив RC1'};
export const isLC5Event=e=>['import_rc1','import_rc1_method','mobile_lc5','observe_lc5'].includes(e.payload?.command)||Object.hasOwn(LC5_TYPES,e.entity_type)||(e.entity_type==='audit_session'&&e.payload?.responses?.some(r=>typeof r.value==='string'));
export const isLC52Event=e=>(e.entity_type==='schedule_event'&&['plan_assessment','complete_assessment'].includes(e.payload?.command))||(e.entity_type==='action_item'&&(Object.hasOwn(e.payload||{},'comparison_self_id')||e.payload?.source_link?.kind==='weighted_sop'||(e.payload?.source_link?.kind==='sop_evaluation'&&Object.hasOwn(e.payload.source_link,'criterion_id'))||Object.hasOwn(e.payload||{},'sop_evaluation_id')||Object.hasOwn(e.payload||{},'weighted_event_id')));
export const isLC51Event=e=>e.entity_type==='action_item'&&!!e.payload?.source_link&&(e.payload.source_link.kind==='self_eval'||Object.hasOwn(e.payload.source_link,'criterion_id'));
const required=(v,n=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const exact=(p,k)=>invariant(p&&Object.keys(p).length===k.length&&k.every(x=>Object.hasOwn(p,x)),'Некорректные поля LC5');
const insert=(db,t,p)=>db.run('INSERT INTO '+t+'('+Object.keys(p).join(',')+') VALUES('+Object.keys(p).map(()=>'?').join(',')+')',Object.values(p));
const update=(db,t,id,p)=>db.run('UPDATE '+t+' SET '+Object.keys(p).map(k=>k+'=?').join(',')+',rev=rev+1 WHERE id=?',[...Object.values(p),id]);
const person=(db,id)=>invariant(isId(id)&&one(db,'SELECT id FROM person WHERE id=? AND archived=0',[id]),'Выберите действующего сотрудника');
// Event timestamps are UTC. The latest civil day is appropriate for an upper
// bound on observations, never as the earliest due date. Replay is timezone-independent.
const civilDay=(e,offset)=>new Date(Date.parse(e.occurred_at)+offset*3600000).toISOString().slice(0,10);
const day=e=>civilDay(e,14);
const earliestDay=e=>civilDay(e,-12);
function validateDueDate(e,value){
 invariant(validDate(value),'Укажите корректный срок');
 invariant(value>=earliestDay(e),'Срок не может предшествовать дате создания');
}
export function auditDetails(db,id){
 const a=one(db,'SELECT a.*,v.version_no,v.methodology_json,c.code method_code FROM audit_session a JOIN checklist_version v ON v.id=a.version_id JOIN checklist c ON c.id=v.checklist_id WHERE a.id=?',[id]);if(!a)return null;
 let method={};try{method=JSON.parse(a.methodology_json)}catch{}
 const questions=rows(db,'SELECT c.*,r.id response_id,r.response,r.legacy_score,r.note FROM checklist_criterion c LEFT JOIN audit_response r ON r.criterion_id=c.id AND r.audit_id=? WHERE c.version_id=? ORDER BY c.position',[id,a.version_id]).map(q=>({...q,recommendation:(Array.isArray(method.criteria)?method.criteria.find(x=>String(x.code)===q.code)?.recommendation:'')||''}));
 return {...a,questions,stats:scoreQuestions(questions)};
}
export function scoreQuestions(qs){
 const counts={yes:0,no:0,not_observed:0,not_applicable:0,legacy:0,missing:0,critical:0};let legacySum=0;
 for(const q of qs){if(q.response==='legacy'&&typeof q.legacy_score==='number'&&q.legacy_score>=0&&q.legacy_score<=1){counts.legacy++;legacySum+=q.legacy_score}else if(['yes','no','not_observed','not_applicable'].includes(q.response)){counts[q.response]++;if(q.response==='no'&&q.critical===1)counts.critical++}else counts.missing++}
 const observed=counts.yes+counts.no;return {...counts,observed,expected:qs.length,recorded:qs.length-counts.missing,pct:observed?100*counts.yes/observed:null,legacySum};
}
export function actionSource(db,kind,id,criterionId=null){
 if(kind==='practical'||kind==='self_eval'){
  const practical=kind==='practical',p=practical?one(db,"SELECT * FROM assessment_session WHERE id=? AND assessment_kind='practical' AND state='confirmed'",[id]):one(db,'SELECT * FROM mentor_self_evaluation WHERE id=?',[id]);if(!p)return null;
  const q=criterionId?one(db,'SELECT * FROM checklist_criterion WHERE id=? AND version_id=?',[criterionId,p.method_id]):null,answer=q?JSON.parse(p.responses_json).find(x=>x.criterion_id===q.id):null;
  if(criterionId&&(!q||!answer||(practical&&answer.value!==0)))return null;
  return {kind,id,label:(practical?'Практическая оценка · '+p.assessed_at:'Самооценка · '+p.evaluated_on)+(q?' · '+q.question:''),question:q?.question||'',criterion_id:q?.id||null,subject_id:p.person_id,assignment_id:p.assignment_id||null,revision_id:p.standard_revision_id||null,assessment_id:practical?id:null,self_id:practical?null:id,conclusion:p.conclusion||null,answer:answer?.value??null}
 }
 if(criterionId)return null;
 if(kind==='assignment'){const a=one(db,"SELECT * FROM training_assignment WHERE id=? AND state<>'cancelled' AND source_sha256 IS NOT NULL",[id]);return a?{kind,id,label:'Назначение обучения · '+a.assigned_on,subject_id:a.trainee_id,assignment_id:id,revision_id:a.sop_revision_id}:null}
 if(kind==='sop_evaluation'){const x=one(db,'SELECT e.*,d.code,d.title FROM sop_evaluation e JOIN document_revision r ON r.id=e.revision_id JOIN document d ON d.id=r.document_id WHERE e.id=?',[id]);return x?{kind,id,label:'Оценка СОП · '+x.code+' · '+x.evaluated_on,revision_id:x.revision_id,evaluation_id:id}:null}
 if(kind==='document_revision'){const x=one(db,'SELECT r.id,r.version_no,d.code,d.title FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=?',[id]);return x?{kind,id,label:'СОП · '+x.code+' · '+x.title+' · v'+x.version_no,revision_id:id}:null}
 if(kind==='frv_study'){const x=one(db,'SELECT id,title,state FROM frv_study WHERE id=?',[id]);return x?{kind,id,label:'ФРВ · '+x.title,study_id:id}:null}
 if(kind==='development_goal'){const x=one(db,'SELECT g.*,p.person_id FROM development_goal g JOIN development_plan p ON p.id=g.plan_id WHERE g.id=?',[id]);return x?{kind,id,label:'Цель развития · '+x.title,subject_id:x.person_id,goal_id:id}:null}
 return null
}
export function actionSourceOf(db,a){
 if(a.audit_id)return {kind:'audit',id:a.audit_id,label:a.question||'Аудит L1'};
 for(const [k,id] of [['practical',a.source_assessment_id],['self_eval',a.source_self_id],['sop_evaluation',a.source_evaluation_id],['assignment',a.source_assignment_id],['development_goal',a.goal_id],['frv_study',a.study_id],['document_revision',a.document_revision_id]])if(id){const x=actionSource(db,k,id,a.source_criterion_id||null);if(x)return x}
 return null
}
export function practicalEvidenceForAction(db,a){
 if(!a.source_assessment_id||!a.implemented_at)return [];
 const s=one(db,"SELECT * FROM assessment_session WHERE id=? AND state='confirmed' AND assessment_kind='practical'",[a.source_assessment_id]);if(!s)return [];
 return rows(db,"SELECT id,assessed_at,conclusion,assignment_id,responses_json FROM assessment_session WHERE state='confirmed' AND assessment_kind='practical' AND person_id=? AND operation_id=? AND standard_revision_id=? AND method_id=? AND substr(assessed_at,1,10)>? ORDER BY assessed_at,id",[s.person_id,s.operation_id,s.standard_revision_id,s.method_id,a.implemented_at.slice(0,10)])
}
function practicalEffect(db,a,id){const e=practicalEvidenceForAction(db,a),value=x=>a.source_criterion_id?JSON.parse(x.responses_json).find(r=>r.criterion_id===a.source_criterion_id)?.value:null;return e.some(x=>x.id===id&&['basic','exceeds'].includes(x.conclusion)&&(!a.source_criterion_id||value(x)===1))&&!e.some(x=>x.conclusion==='not_meet'||(a.source_criterion_id&&value(x)===0))}
export function actionRows(db){
 return rows(db,`SELECT a.*,f.audit_response_id,f.study_id,f.document_revision_id,f.state finding_state,r.criterion_id,r.response,c.question,c.section_code,s.id audit_id,s.state audit_state,s.mentor_id,s.auditor_id,s.trainee_id,s.operation_id,s.standard_revision_id,s.version_id,s.observed_at,ps.person_id assessed_person_id,ps.evaluator_id assessment_evaluator_id,ms.person_id self_person_id,ta.mentor_id assessment_mentor_id FROM action_item a LEFT JOIN finding f ON f.id=a.finding_id LEFT JOIN audit_response r ON r.id=f.audit_response_id LEFT JOIN checklist_criterion c ON c.id=r.criterion_id LEFT JOIN audit_session s ON s.id=r.audit_id LEFT JOIN assessment_session ps ON ps.id=a.source_assessment_id LEFT JOIN mentor_self_evaluation ms ON ms.id=a.source_self_id LEFT JOIN training_assignment ta ON ta.id=a.source_assignment_id ORDER BY a.due_on,a.id`);
}
export const actionPeople=a=>[...new Set([a.owner_id,a.subject_id,a.mentor_id,a.auditor_id,a.trainee_id,a.assessed_person_id,a.assessment_evaluator_id,a.self_person_id,a.assessment_mentor_id].filter(Boolean))];
export function evidenceForAction(db,a){
 if(!a.audit_id||!a.implemented_at||!a.operation_id||!a.standard_revision_id||a.audit_state!=='final')return [];
 // Day precision: a same-day record cannot prove it was after implementation.
 return rows(db,`SELECT s.id,s.observed_at,r.response,r.note FROM audit_session s JOIN training_session t ON t.id=s.training_session_id LEFT JOIN audit_response r ON r.audit_id=s.id AND r.criterion_id=? WHERE s.state='final' AND s.mentor_id=? AND s.operation_id=? AND s.standard_revision_id=? AND s.version_id=? AND substr(s.observed_at,1,10)>? AND substr(t.held_at,1,10)>? ORDER BY s.observed_at,s.id`,[a.criterion_id,a.mentor_id,a.operation_id,a.standard_revision_id,a.version_id,a.implemented_at.slice(0,10),a.implemented_at.slice(0,10)]);
}
export function effectiveEvidence(db,a,auditId){
 const evidence=evidenceForAction(db,a),selected=evidence.find(x=>x.id===auditId);
 return !!selected&&selected.response==='yes'&&!evidence.some(x=>x.response==='no');
}
export function actionStatus(db,a){
 if(a.state==='verified'&&a.audit_id){const v=one(db,"SELECT audit_id FROM action_verification WHERE action_id=? AND outcome='effective' ORDER BY checked_at DESC,id DESC LIMIT 1",[a.id]);if(!v||!effectiveEvidence(db,a,v.audit_id))return 'ineffective'}
 if(a.state==='verified'&&a.source_assessment_id&&(a.kind==='trainee_training'||a.source_criterion_id)){const v=one(db,"SELECT assessment_session_id FROM action_verification WHERE action_id=? AND outcome='effective' ORDER BY checked_at DESC,id DESC LIMIT 1",[a.id]);if(!v||!practicalEffect(db,a,v.assessment_session_id))return 'ineffective'}
 return a.state;
}
export function applyLC5Event(db,e,old){
 const p=e.payload,id=e.entity_id,t=e.entity_type;
 if(t==='action_item'){
  if(!old){
   invariant(e.operation==='create','Требуется создание мероприятия');exact(p,['response_id','title','owner_id','subject_id','due_on','kind','priority',...(Object.hasOwn(p,'source_link')?['source_link']:[]),...(Object.hasOwn(p,'comparison_self_id')?['comparison_self_id']:[])]);
   person(db,p.owner_id);if(p.subject_id!==null)person(db,p.subject_id);
   invariant(required(p.title,500),'Укажите название мероприятия');validateDueDate(e,p.due_on);invariant(Object.hasOwn(ACTION_KINDS,p.kind)&&['normal','major','critical'].includes(p.priority),'Выберите тип и приоритет мероприятия');
   let finding=null,generic=null;
   if(p.comparison_self_id)invariant(p.response_id&&p.subject_id&&matchedComparison(db,p.comparison_self_id,p.response_id)&&one(db,'SELECT person_id FROM mentor_self_evaluation WHERE id=?',[p.comparison_self_id])?.person_id===p.subject_id,'Сопоставление не подтверждено исходными критериями и сотрудником');
   if(p.source_link){exact(p.source_link,['kind','id',...(Object.hasOwn(p.source_link,'criterion_id')?['criterion_id']:[])]);invariant(p.response_id===null,'Выберите один источник');generic=actionSource(db,p.source_link.kind,p.source_link.id,p.source_link.criterion_id||null);invariant(generic,'Источник мероприятия недоступен');if(p.kind==='trainee_training')invariant(generic.kind==='practical'&&generic.conclusion==='not_meet'&&p.subject_id===generic.subject_id,'Переобучение обучаемого требует отрицательного заключения практической оценки');else invariant(['corrective','development'].includes(p.kind),'Недопустимый тип для этого источника');if(generic.kind==='self_eval'||generic.kind==='practical'){invariant(p.subject_id===generic.subject_id,'Субъект мероприятия должен совпадать с сотрудником исходной оценки');invariant(!actionRows(db).some(a=>((generic.self_id&&a.source_self_id===generic.self_id)||(generic.assessment_id&&a.source_assessment_id===generic.assessment_id))&&(a.source_criterion_id||null)===(generic.criterion_id||null)&&a.kind===p.kind&&!['verified','cancelled'].includes(actionStatus(db,a))),'По этой оценке и критерию уже есть незавершённое мероприятие')}if(generic.revision_id||generic.study_id){finding=id;insert(db,'finding',{id:finding,document_revision_id:generic.revision_id||null,study_id:generic.study_id||null,title:generic.label,severity:p.priority,created_at:e.occurred_at,state:'open'})}}
   if(p.response_id!==null){
    const r=one(db,"SELECT r.*,a.state,c.question FROM audit_response r JOIN audit_session a ON a.id=r.audit_id JOIN checklist_criterion c ON c.id=r.criterion_id WHERE r.id=?",[p.response_id]);
    invariant(r?.state==='final'&&r.response==='no','Источник — подтверждённое отклонение действующего аудита');
    const a=one(db,'SELECT mentor_id,trainee_id FROM audit_session WHERE id=?',[r.audit_id]);
    if(p.kind==='instructor_training')invariant(p.subject_id===a.mentor_id,'Переобучение относится к инструктору');
    if(p.kind==='trainee_training')throw Error('Аудит инструктора не подтверждает дефицит навыка обучаемого; используйте практическую оценку');
    finding=one(db,'SELECT id FROM finding WHERE audit_response_id=? AND state<>\'void\' ORDER BY id LIMIT 1',[r.id])?.id;
    if(!finding){finding=id;insert(db,'finding',{id:finding,audit_response_id:r.id,title:r.question,severity:p.priority,created_at:e.occurred_at,state:'open'})}
    invariant(!one(db,"SELECT id FROM action_item WHERE finding_id=? AND kind=? AND state NOT IN('cancelled','verified')",[finding,p.kind]),'Для замечания уже есть незавершённое мероприятие этого типа');
    db.run("UPDATE finding SET state='open' WHERE id=?",[finding]);
   }else if(!generic)invariant(p.kind==='corrective','Для обучения или развития требуется подтверждённое основание');
   insert(db,t,{id,finding_id:finding||null,goal_id:generic?.goal_id||null,source_assessment_id:generic?.assessment_id||null,source_self_id:generic?.self_id||null,comparison_self_id:p.comparison_self_id||null,source_criterion_id:generic?.criterion_id||null,source_assignment_id:generic?.assignment_id||null,source_evaluation_id:generic?.evaluation_id||null,owner_id:p.owner_id,title:p.title.trim(),due_on:p.due_on,state:'open',rev:1,kind:p.kind,subject_id:p.subject_id,priority:p.priority,created_at:e.occurred_at});return
  }
  invariant(e.operation==='update','Недопустимая операция');const a=actionRows(db).find(x=>x.id===id);
  if(p.command==='link_followup'){exact(p,['command','type','id']);invariant(['open','in_progress','ineffective'].includes(actionStatus(db,a))&&a.subject_id,'Связь добавляется до выполнения и только для определённого сотрудника');let x=null,column=null;if(p.type==='assignment'&&a.kind==='trainee_training'){x=one(db,"SELECT * FROM training_assignment WHERE id=? AND trainee_id=? AND state<>'cancelled'",[p.id,a.subject_id]);const src=a.source_assessment_id?one(db,'SELECT operation_id FROM assessment_session WHERE id=?',[a.source_assessment_id]):null;invariant(x&&x.id!==a.source_assignment_id&&x.operation_id===src?.operation_id,'Выберите новое обучение того же сотрудника по операции');column='followup_assignment_id'}else if(p.type==='enrollment'&&a.kind==='instructor_training'){x=one(db,"SELECT * FROM training_enrollment WHERE id=? AND trainee_id=? AND state<>'cancelled'",[p.id,a.subject_id]);column='followup_enrollment_id'}else if(p.type==='plan'&&a.kind==='development'){x=one(db,"SELECT * FROM development_plan WHERE id=? AND person_id=? AND state<>'cancelled'",[p.id,a.subject_id]);column='followup_plan_id'}invariant(x&&column,'Связанная программа / план недоступны');update(db,t,id,{[column]:p.id});return}
  if(p.command==='start'){exact(p,['command']);invariant(['open','ineffective'].includes(actionStatus(db,a)),'Мероприятие уже в работе или закрыто');update(db,t,id,{state:'in_progress',result_note:null,implemented_at:null});if(a.finding_id)db.run("UPDATE finding SET state='open' WHERE id=?",[a.finding_id]);return}
  if(p.command==='implement'){exact(p,['command','result']);invariant(['open','in_progress','ineffective'].includes(actionStatus(db,a))&&required(p.result),'Укажите фактический результат выполнения');for(const [table,id] of [['training_assignment',a.followup_assignment_id],['training_enrollment',a.followup_enrollment_id],['development_plan',a.followup_plan_id]])if(id)invariant(one(db,'SELECT state FROM '+table+' WHERE id=?',[id])?.state==='completed','Связанное обучение / план ещё не завершены');update(db,t,id,{state:'implemented',result_note:p.result,implemented_at:e.occurred_at});return}
  if(p.command==='cancel'){exact(p,['command','reason']);invariant(['open','in_progress','ineffective','implemented'].includes(actionStatus(db,a))&&required(p.reason),'Укажите основание отмены');update(db,t,id,{state:'cancelled',result_note:p.reason});return}
  exact(p,['command','verifier_id','audit_id','outcome','evidence',...(Object.hasOwn(p,'assessment_id')?['assessment_id']:[])]);invariant(p.command==='verify'&&old.state==='implemented'&&['effective','ineffective','insufficient'].includes(p.outcome)&&required(p.evidence),'Требуется выполненное мероприятие и результат проверки');
  person(db,p.verifier_id);invariant(p.verifier_id!==old.owner_id,'Проверяющий должен отличаться от исполнителя');
  if(p.audit_id!==null)invariant(evidenceForAction(db,a).some(x=>x.id===p.audit_id&&x.observed_at.slice(0,10)<=day(e)),'Нужен последующий аудит того же инструктора, операции, СОП и версии методики');
  if(p.outcome==='effective'&&a.audit_id)invariant(effectiveEvidence(db,a,p.audit_id),'Эффект не подтверждён: нет положительного повторного аудита или нарушение повторилось');
  if(p.assessment_id)invariant(a.source_assessment_id&&practicalEvidenceForAction(db,a).some(x=>x.id===p.assessment_id&&x.assessed_at.slice(0,10)<=day(e)),'Требуется последующая практическая оценка того же сотрудника и операции');
  if(p.outcome==='effective'&&a.source_assessment_id&&(a.kind==='trainee_training'||a.source_criterion_id))invariant(practicalEffect(db,a,p.assessment_id),'Эффект переобучения не подтверждён последующей практической оценкой');
  insert(db,'action_verification',{id:e.id,action_id:id,verifier_id:p.verifier_id,checked_at:e.occurred_at,outcome:p.outcome,audit_id:p.audit_id,assessment_session_id:p.assessment_id||null,evidence_note:p.evidence});
  update(db,t,id,{state:p.outcome==='effective'?'verified':p.outcome==='ineffective'?'ineffective':'implemented'});
  if(a.finding_id){const unresolved=one(db,"SELECT id FROM action_item WHERE finding_id=? AND state<>'verified' AND state<>'cancelled'",[a.finding_id]);if(!unresolved&&p.outcome==='effective')db.run("UPDATE finding SET state='resolved' WHERE id=?",[a.finding_id])}return
 }
 if(t==='schedule_event'){
  if(p.command==='plan_assessment'||old&&['practical','self_eval'].includes(scheduleKind(old)))return applyPlannedAssessment(db,e,old,{validateDueDate,day,person,exact,insert,update});
  if(!old){exact(p,['assignment_id','owner_id','due_on']);person(db,p.owner_id);validateDueDate(e,p.due_on);invariant(e.operation==='create'&&one(db,"SELECT id FROM training_assignment WHERE id=? AND state<>'cancelled' AND source_sha256 IS NOT NULL",[p.assignment_id]),'Укажите назначение, ответственного и дату аудита');invariant(!one(db,"SELECT id FROM schedule_event WHERE kind='audit' AND source_id=? AND due_on=?",[p.assignment_id,p.due_on]),'Аудит этого назначения на выбранную дату уже запланирован');insert(db,t,{id,kind:'audit',owner_id:p.owner_id,source_id:p.assignment_id,due_on:p.due_on,state:'planned',source_type:'training_assignment',created_at:e.occurred_at,rev:1});return}
  invariant(e.operation==='update'&&old.state==='planned'&&old.kind==='audit'&&old.source_type==='training_assignment','Событие не доступно для изменения');
  if(p.command==='cancel'){exact(p,['command']);update(db,t,id,{state:'cancelled'});return}
  exact(p,['command','audit_id']);const a=one(db,"SELECT * FROM audit_session WHERE id=? AND state='final' AND assignment_id=?",[p.audit_id,old.source_id]);invariant(p.command==='complete'&&a&&a.auditor_id===old.owner_id&&a.observed_at.slice(0,10)<=day(e)&&(!old.created_at||a.recorded_at>=old.created_at&&a.observed_at.slice(0,10)>=old.created_at.slice(0,10))&&!one(db,'SELECT id FROM schedule_event WHERE completed_audit_id=?',[a.id]),'Выберите фактически проведённый аудит этого назначения и ответственного');update(db,t,id,{state:'done',completed_audit_id:a.id});return
 }
 throw Error('Неизвестное событие LC5')
}
