import {one,rows,invariant,isId} from '../../core/db.js';
import {validDate} from '../library/sop-review.js';
import {directoryPeople} from '../master-data/people-directory.js';
export const scheduleKind=s=>s.kind==='audit'?'audit':s.kind==='assessment'&&s.source_type==='practical_assignment'?'practical':s.kind==='assessment'&&s.source_type==='self_person'?'self_eval':'other';
export const scheduleLabels={audit:'Аудит L1',practical:'Практическая оценка',self_eval:'Самооценка',other:'Историческое событие'};
export function scheduleDisplayState(db,s){
 if(scheduleKind(s)==='audit'&&s.completed_audit_id&&one(db,'SELECT state FROM audit_session WHERE id=?',[s.completed_audit_id])?.state!=='final'){
  if(s.state==='done')return 'needs_replan';
  if(s.state==='cancelled')return 'replanned';
 }
 return s.state
}
export const schedulePending=(db,s)=>['planned','needs_replan'].includes(scheduleDisplayState(db,s));
export const scheduleStateLabel=(db,s)=>({planned:'Запланировано',done:'Выполнено',cancelled:'Отменено',needs_replan:'Требует перепланирования',replanned:'Перепланировано'})[scheduleDisplayState(db,s)]||s.state;
// Completed plans belong to the unit at the date of the registered fact.
 // Open plans remain in the current responsibility scope; cancelled plans
 // without a fact use their planned date. No current-unit fallback for history.
export function scheduleScopeDate(db,s,day){
 const fact=s.completed_audit_id?one(db,'SELECT observed_at day FROM audit_session WHERE id=?',[s.completed_audit_id]):s.completed_assessment_id?one(db,'SELECT assessed_at day FROM assessment_session WHERE id=?',[s.completed_assessment_id]):s.completed_self_id?one(db,'SELECT evaluated_on day FROM mentor_self_evaluation WHERE id=?',[s.completed_self_id]):null;
 return fact?.day?fact.day.slice(0,10):s.state==='planned'?day:s.due_on;
}
export function schedulePeople(db,s){
 const a=['audit','practical'].includes(scheduleKind(s))?one(db,'SELECT trainee_id,mentor_id,supervisor_id FROM training_assignment WHERE id=?',[s.source_id]):null;
 return [...new Set([s.owner_id,...(a?[a.trainee_id,a.mentor_id,a.supervisor_id]:[]),...(scheduleKind(s)==='self_eval'?[s.source_id]:[])].filter(Boolean))];
}
export function plannedAuditFacts(db,s,maxDate='9999-12-31'){
 if(scheduleKind(s)!=='audit'||s.state!=='planned'||s.source_type!=='training_assignment')return [];
 return rows(db,"SELECT * FROM audit_session WHERE state='final' AND assignment_id=? AND auditor_id=? AND substr(observed_at,1,10)<=? AND id NOT IN(SELECT completed_audit_id FROM schedule_event WHERE completed_audit_id IS NOT NULL) ORDER BY observed_at DESC,recorded_at DESC,id",[s.source_id,s.owner_id,maxDate]).filter(a=>!s.created_at||a.recorded_at>=s.created_at&&a.observed_at.slice(0,10)>=s.created_at.slice(0,10));
}
export function plannedAssessmentFacts(db,s){
 const type=scheduleKind(s);if(!['practical','self_eval'].includes(type))return [];
 const sql=type==='practical'?`SELECT id,assessed_at date,recorded_at,person_id,evaluator_id FROM assessment_session WHERE assignment_id=? AND evaluator_id=? AND assessment_kind='practical' AND state='confirmed' AND id NOT IN(SELECT completed_assessment_id FROM schedule_event WHERE completed_assessment_id IS NOT NULL)`:`SELECT id,evaluated_on date,recorded_at,person_id FROM mentor_self_evaluation WHERE person_id=? AND id NOT IN(SELECT completed_self_id FROM schedule_event WHERE completed_self_id IS NOT NULL)`;
 return rows(db,sql,type==='practical'?[s.source_id,s.owner_id]:[s.source_id]).filter(x=>!s.created_at||x.recorded_at>=s.created_at&&x.date.slice(0,10)>=s.created_at.slice(0,10)).sort((a,b)=>b.date.localeCompare(a.date)||b.recorded_at.localeCompare(a.recorded_at));
}
export function applyPlannedAssessment(db,e,old,{validateDueDate,day,person,exact,insert,update}){
 const p=e.payload,id=e.entity_id;
 if(!old){
  exact(p,['command','type','source_id','owner_id','due_on']);invariant(e.operation==='create'&&p.command==='plan_assessment'&&['practical','self_eval'].includes(p.type)&&isId(p.source_id),'Некорректный вид плановой оценки');person(db,p.owner_id);validateDueDate(e,p.due_on);
  if(p.type==='practical'){const a=one(db,"SELECT * FROM training_assignment WHERE id=? AND state<>'cancelled' AND source_sha256 IS NOT NULL AND approval_json IS NOT NULL",[p.source_id]);invariant(a&&p.owner_id!==a.trainee_id,'Выберите согласованное назначение и отдельного оценщика')}
  else {invariant(p.source_id===p.owner_id&&directoryPeople(db,p.due_on).some(x=>x.id===p.source_id&&x.roles.some(r=>['instructor','mentor'].includes(r.kind))),'Самооценку планируют самому наставнику с действующей ролью')}
  invariant(!one(db,"SELECT id FROM schedule_event WHERE kind='assessment' AND source_id=? AND due_on=?",[p.source_id,p.due_on]),'Оценка этого источника на выбранную дату уже запланирована');
  insert(db,'schedule_event',{id,kind:'assessment',owner_id:p.owner_id,source_id:p.source_id,due_on:p.due_on,state:'planned',source_type:p.type==='practical'?'practical_assignment':'self_person',created_at:e.occurred_at,rev:1});return
 }
 invariant(e.operation==='update'&&old.state==='planned'&&['practical','self_eval'].includes(scheduleKind(old)),'Событие недоступно для изменения');
 if(p.command==='cancel'){exact(p,['command']);update(db,'schedule_event',id,{state:'cancelled'});return}
 exact(p,['command','fact_id']);invariant(p.command==='complete_assessment'&&plannedAssessmentFacts(db,old).some(x=>x.id===p.fact_id&&x.date.slice(0,10)<=day(e)),'Выберите зарегистрированную после планирования оценку того же назначения/сотрудника и оценщика');
 update(db,'schedule_event',id,{state:'done',[scheduleKind(old)==='practical'?'completed_assessment_id':'completed_self_id']:p.fact_id})
}
