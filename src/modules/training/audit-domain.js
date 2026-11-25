// LC5: one audit, explicit decisions and independently verified corrective actions.
import {rows,one,invariant,isId} from '../../core/db.js';
import {validDate} from '../library/sop-review.js';
export const ACTION_KINDS={corrective:'Корректирующее мероприятие',instructor_training:'Переобучение инструктора TWI',trainee_training:'Повторное производственное обучение',development:'Индивидуальное развитие'};
export const ACTION_STATES={open:'Открыто',in_progress:'В работе',implemented:'Ожидает проверки',verified:'Эффект подтверждён',ineffective:'Эффект не подтверждён',cancelled:'Отменено'};
export const RESPONSE_LABELS={yes:'Да',no:'Нет',not_observed:'Не наблюдалось',not_applicable:'Не применимо',legacy:'Историческая доля'};
export const LC5_TYPES={action_item:'Задача / мероприятие',schedule_event:'Календарное событие'};
export const isLC5Event=e=>Object.hasOwn(LC5_TYPES,e.entity_type)||(e.entity_type==='audit_session'&&e.payload?.responses?.some(r=>typeof r.value==='string'));
const required=(v,n=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const exact=(p,k)=>invariant(p&&Object.keys(p).length===k.length&&k.every(x=>Object.hasOwn(p,x)),'Некорректные поля LC5');
const insert=(db,t,p)=>db.run('INSERT INTO '+t+'('+Object.keys(p).join(',')+') VALUES('+Object.keys(p).map(()=>'?').join(',')+')',Object.values(p));
const update=(db,t,id,p)=>db.run('UPDATE '+t+' SET '+Object.keys(p).map(k=>k+'=?').join(',')+',rev=rev+1 WHERE id=?',[...Object.values(p),id]);
const person=(db,id)=>invariant(isId(id)&&one(db,'SELECT id FROM person WHERE id=? AND archived=0',[id]),'Выберите действующего сотрудника');
const day=e=>new Date(Date.parse(e.occurred_at)+14*3600000).toISOString().slice(0,10);
export function auditDetails(db,id){
 const a=one(db,'SELECT a.*,v.version_no,v.methodology_json,c.code method_code FROM audit_session a JOIN checklist_version v ON v.id=a.version_id JOIN checklist c ON c.id=v.checklist_id WHERE a.id=?',[id]);if(!a)return null;
 let method={};try{method=JSON.parse(a.methodology_json)}catch{}
 const questions=rows(db,'SELECT c.*,r.id response_id,r.response,r.legacy_score,r.note FROM checklist_criterion c LEFT JOIN audit_response r ON r.criterion_id=c.id AND r.audit_id=? WHERE c.version_id=? ORDER BY c.position',[id,a.version_id]).map(q=>({...q,recommendation:method.criteria?.find(x=>String(x.code)===q.code)?.recommendation||''}));
 return {...a,questions,stats:scoreQuestions(questions)};
}
export function scoreQuestions(qs){
 const counts={yes:0,no:0,not_observed:0,not_applicable:0,legacy:0,missing:0,critical:0};let legacySum=0;
 for(const q of qs){if(q.response==='legacy'&&typeof q.legacy_score==='number'&&q.legacy_score>=0&&q.legacy_score<=1){counts.legacy++;legacySum+=q.legacy_score}else if(['yes','no','not_observed','not_applicable'].includes(q.response)){counts[q.response]++;if(q.response==='no'&&q.critical===1)counts.critical++}else counts.missing++}
 const observed=counts.yes+counts.no;return {...counts,observed,expected:qs.length,recorded:qs.length-counts.missing,pct:observed?100*counts.yes/observed:null,legacySum};
}
export function actionRows(db){
 return rows(db,`SELECT a.*,f.audit_response_id,f.state finding_state,r.criterion_id,r.response,c.question,c.section_code,s.id audit_id,s.state audit_state,s.mentor_id,s.auditor_id,s.trainee_id,s.operation_id,s.standard_revision_id,s.version_id,s.observed_at FROM action_item a LEFT JOIN finding f ON f.id=a.finding_id LEFT JOIN audit_response r ON r.id=f.audit_response_id LEFT JOIN checklist_criterion c ON c.id=r.criterion_id LEFT JOIN audit_session s ON s.id=r.audit_id ORDER BY a.due_on,a.id`);
}
export function evidenceForAction(db,a){
 if(!a.audit_id||!a.implemented_at||!a.operation_id||!a.standard_revision_id||a.audit_state!=='final')return [];
 // Day precision: a same-day record cannot prove it was after implementation.
 return rows(db,`SELECT s.id,s.observed_at,r.response,r.note FROM audit_session s LEFT JOIN audit_response r ON r.audit_id=s.id AND r.criterion_id=? WHERE s.state='final' AND s.mentor_id=? AND s.operation_id=? AND s.standard_revision_id=? AND s.version_id=? AND substr(s.observed_at,1,10)>? ORDER BY s.observed_at,s.id`,[a.criterion_id,a.mentor_id,a.operation_id,a.standard_revision_id,a.version_id,a.implemented_at.slice(0,10)]);
}
export function effectiveEvidence(db,a,auditId){
 const evidence=evidenceForAction(db,a),selected=evidence.find(x=>x.id===auditId);
 return !!selected&&selected.response==='yes'&&!evidence.some(x=>x.response==='no');
}
export function actionStatus(db,a){
 if(a.state==='verified'&&a.audit_id){const v=one(db,"SELECT audit_id FROM action_verification WHERE action_id=? AND outcome='effective' ORDER BY checked_at DESC,id DESC LIMIT 1",[a.id]);if(!v||!effectiveEvidence(db,a,v.audit_id))return 'ineffective'}
 return a.state;
}
export function applyLC5Event(db,e,old){
 const p=e.payload,id=e.entity_id,t=e.entity_type;
 if(t==='action_item'){
  if(!old){
   invariant(e.operation==='create','Требуется создание мероприятия');exact(p,['response_id','title','owner_id','subject_id','due_on','kind','priority']);
   person(db,p.owner_id);if(p.subject_id!==null)person(db,p.subject_id);
   invariant(required(p.title,500)&&validDate(p.due_on)&&p.due_on>=day(e)&&Object.hasOwn(ACTION_KINDS,p.kind)&&['normal','major','critical'].includes(p.priority),'Укажите задачу, срок и приоритет');
   let finding=null;
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
   }else invariant(p.kind==='corrective','Для обучения или развития требуется подтверждённое основание');
   insert(db,t,{id,finding_id:finding||null,goal_id:null,owner_id:p.owner_id,title:p.title.trim(),due_on:p.due_on,state:'open',rev:1,kind:p.kind,subject_id:p.subject_id,priority:p.priority,created_at:e.occurred_at});return
  }
  invariant(e.operation==='update','Недопустимая операция');const a=actionRows(db).find(x=>x.id===id);
  if(p.command==='start'){exact(p,['command']);invariant(['open','ineffective'].includes(actionStatus(db,a)),'Мероприятие уже в работе или закрыто');update(db,t,id,{state:'in_progress',result_note:null,implemented_at:null});if(a.finding_id)db.run("UPDATE finding SET state='open' WHERE id=?",[a.finding_id]);return}
  if(p.command==='implement'){exact(p,['command','result']);invariant(['open','in_progress','ineffective'].includes(actionStatus(db,a))&&required(p.result),'Укажите фактический результат выполнения');update(db,t,id,{state:'implemented',result_note:p.result,implemented_at:e.occurred_at});return}
  if(p.command==='cancel'){exact(p,['command','reason']);invariant(['open','in_progress','ineffective','implemented'].includes(actionStatus(db,a))&&required(p.reason),'Укажите основание отмены');update(db,t,id,{state:'cancelled',result_note:p.reason});return}
  exact(p,['command','verifier_id','audit_id','outcome','evidence']);invariant(p.command==='verify'&&old.state==='implemented'&&['effective','ineffective','insufficient'].includes(p.outcome)&&required(p.evidence),'Требуется выполненное мероприятие и результат проверки');
  person(db,p.verifier_id);invariant(p.verifier_id!==old.owner_id,'Проверяющий должен отличаться от исполнителя');
  if(p.audit_id!==null)invariant(evidenceForAction(db,a).some(x=>x.id===p.audit_id&&x.observed_at.slice(0,10)<=day(e)),'Нужен последующий аудит того же инструктора, операции, СОП и версии методики');
  if(p.outcome==='effective'&&a.audit_id)invariant(effectiveEvidence(db,a,p.audit_id),'Эффект не подтверждён: нет положительного повторного аудита или нарушение повторилось');
  insert(db,'action_verification',{id:e.id,action_id:id,verifier_id:p.verifier_id,checked_at:e.occurred_at,outcome:p.outcome,audit_id:p.audit_id,evidence_note:p.evidence});
  update(db,t,id,{state:p.outcome==='effective'?'verified':p.outcome==='ineffective'?'ineffective':'implemented'});
  if(a.finding_id){const unresolved=one(db,"SELECT id FROM action_item WHERE finding_id=? AND state<>'verified' AND state<>'cancelled'",[a.finding_id]);if(!unresolved&&p.outcome==='effective')db.run("UPDATE finding SET state='resolved' WHERE id=?",[a.finding_id])}return
 }
 if(t==='schedule_event'){
  if(!old){exact(p,['assignment_id','owner_id','due_on']);person(db,p.owner_id);invariant(e.operation==='create'&&validDate(p.due_on)&&p.due_on>=day(e)&&one(db,"SELECT id FROM training_assignment WHERE id=? AND state<>'cancelled' AND source_sha256 IS NOT NULL",[p.assignment_id]),'Укажите назначение, ответственного и дату аудита');insert(db,t,{id,kind:'audit',owner_id:p.owner_id,source_id:p.assignment_id,due_on:p.due_on,state:'planned',source_type:'training_assignment',rev:1});return}
  invariant(e.operation==='update'&&old.state==='planned'&&old.kind==='audit'&&old.source_type==='training_assignment','Событие не доступно для изменения');
  if(p.command==='cancel'){exact(p,['command']);update(db,t,id,{state:'cancelled'});return}
  exact(p,['command','audit_id']);const a=one(db,"SELECT * FROM audit_session WHERE id=? AND state='final' AND assignment_id=?",[p.audit_id,old.source_id]);invariant(p.command==='complete'&&a&&a.auditor_id===old.owner_id&&a.observed_at.slice(0,10)<=day(e)&&!one(db,'SELECT id FROM schedule_event WHERE completed_audit_id=?',[a.id]),'Выберите фактически проведённый аудит этого назначения и ответственного');update(db,t,id,{state:'done',completed_audit_id:a.id});return
 }
 throw Error('Неизвестное событие LC5')
}
