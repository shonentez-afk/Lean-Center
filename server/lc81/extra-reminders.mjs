// Deadline reminders are live projections of native records. A queue
// entry never creates an obligation, renews a certificate or grants access.
import {one,rows,isId} from '../../src/core/db.js';
import {recordAccess} from './center-commands.mjs';
import {actionRows,actionStatus,ACTION_STATES} from '../../src/modules/training/audit-domain.js';
import {scheduleKind,scheduleLabels,scheduleDisplayState,scheduleStateLabel} from '../../src/modules/training/center-planning.js';
import {admissionStatus,isCurrentStandard} from '../../src/modules/training/domain.js';
import {currentSopReviewRows,currentSopReviewRow,sopReviewOwner,localReviewEmployment} from './sop-review-owner.mjs';

export const EXTRA_CATEGORIES=['sop_review','audit','task','credential','admission'];
export const EXTRA_SOURCES=Object.freeze({
 sop_review_due:'document_revision',schedule_due:'schedule_event',task_due:'action_item',
 credential_due:'mentor_credential',appointment_due:'mentor_appointment',authorization_due:'mentor_authorization',admission_due:'admission_decision'
});
export const EXTRA_KIND_CATEGORY=Object.freeze({sop_review_due:'sop_review',schedule_due:'audit',task_due:'task',credential_due:'credential',appointment_due:'credential',authorization_due:'credential',admission_due:'admission'});
const find=(db,t,id)=>one(db,'SELECT * FROM '+t+' WHERE id=?',[id]);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const ownerOf=(kind,r)=>kind==='schedule_due'||kind==='task_due'?r.owner_id:r.person_id;
const dateOf=(kind,r)=>['schedule_due','task_due'].includes(kind)?r.due_on:['credential_due','admission_due'].includes(kind)?r.valid_until:r.valid_to;
const pendingTask=(db,r)=>['open','in_progress','ineffective'].includes(actionStatus(db,r));
const hasOpenPlan=(db,r)=>['audit','practical','self_eval'].includes(scheduleKind(r))&&['planned','needs_replan'].includes(scheduleDisplayState(db,r));
function usablePlan(db,r){
 if(!hasOpenPlan(db,r))return false;
 if(scheduleKind(r)==='self_eval')return r.source_id===r.owner_id;
 const a=find(db,'training_assignment',r.source_id);
 return !!a&&a.state!=='cancelled'&&!!a.approval_json&&!!a.source_sha256&&isCurrentStandard(db,a.sop_revision_id);
}
const currentAdmission=(db,r,day)=>{
 if(r.decision!=='granted'||r.revoked_at||r.decided_on>day||!isCurrentStandard(db,r.revision_id))return false;
 const a=admissionStatus(db,r.person_id,r.operation_id,day);
 return a.record?.id===r.id&&(a.current||a.status==='Срок истёк');
};
export function extraReminderTargets(db,clock,horizons){
 const out=[],add=(kind,id,person,basis,stage=null)=>{
  if(!date(basis)||!horizons[EXTRA_KIND_CATEGORY[kind]]||basis>horizons[EXTRA_KIND_CATEGORY[kind]])return;
  const employment=stage??localReviewEmployment(db,person,clock.day);if(!employment)return;
  const a=one(db,"SELECT id FROM lc81_account WHERE person_id=? AND state='active' AND bootstrap=0",[person]);if(a)out.push({kind,target_id:id,person_id:person,account_id:a.id,basis,stage:employment});
 };
 if(horizons.sop_review)for(const r of currentSopReviewRows(db)){const owner=sopReviewOwner(db,r,clock.day);if(owner.person_id)add('sop_review_due',r.id,owner.person_id,r.review_due,owner.employment_id)}
 if(horizons.audit)for(const r of rows(db,"SELECT * FROM schedule_event WHERE state IN('planned','done') AND due_on<=?",[horizons.audit]))if(usablePlan(db,r))add('schedule_due',r.id,r.owner_id,r.due_on);
 if(horizons.task)for(const r of actionRows(db))if(r.due_on<=horizons.task&&pendingTask(db,r))add('task_due',r.id,r.owner_id,r.due_on);
 if(horizons.credential){
  for(const r of rows(db,"SELECT * FROM mentor_credential WHERE kind='certificate' AND revoked_at IS NULL AND issued_on<=? AND valid_until IS NOT NULL AND valid_until<=?",[clock.day,horizons.credential]))add('credential_due',r.id,r.person_id,r.valid_until);
  for(const r of rows(db,"SELECT * FROM mentor_appointment WHERE revoked_at IS NULL AND valid_from<=? AND valid_to IS NOT NULL AND valid_to<=?",[clock.day,horizons.credential]))add('appointment_due',r.id,r.person_id,r.valid_to);
  for(const r of rows(db,"SELECT * FROM mentor_authorization WHERE revoked_at IS NULL AND valid_from<=? AND valid_to IS NOT NULL AND valid_to<=?",[clock.day,horizons.credential]))add('authorization_due',r.id,r.person_id,r.valid_to);
 }
 if(horizons.admission)for(const r of rows(db,"SELECT * FROM admission_decision WHERE decision='granted' AND revoked_at IS NULL AND decided_on<=? AND valid_until IS NOT NULL AND valid_until<=?",[clock.day,horizons.admission]))if(currentAdmission(db,r,clock.day))add('admission_due',r.id,r.person_id,r.valid_until);
 return out;
}
export function extraReminderView(db,a,j){
 if(!a?.personId||j.person_id!==a.personId||j.account_id!==a.accountId||a.employmentFor(a.personId)!==j.stage)return null;
 const kind=j.kind,category=EXTRA_KIND_CATEGORY[kind],overdue=j.basis<a.day;
 const make=(what,title,reason,route,state=null)=>({label:(overdue?'Просрочено: ':'Приближается срок: ')+what,title,reason,due_on:j.basis,pending:true,overdue,state:state??(overdue?'Срок истёк':'Ожидает'),category,deliverable:true,route});
 if(kind==='sop_review_due'){
  const r=currentSopReviewRow(db,j.target_id),owner=sopReviewOwner(db,r,a.day);
  if(!r||!a.effective(r.id)||r.review_due!==j.basis||owner.person_id!==a.personId||owner.employment_id!==j.stage)return null;
  return make('актуализация СОП',a.reviewTitle?.(r.id)??r.code,'Вы ответственный за актуализацию действующей редакции'+(r.review_basis==='legacy_passport'?' · срок из старого паспорта, дата согласования не подтверждена':''),{type:'sop',id:r.id},overdue?'Пересмотр просрочен; СОП продолжает действовать':'Требуется пересмотр');
 }
 const source=EXTRA_SOURCES[kind],r=source&&find(db,source,j.target_id);
 if(!r||ownerOf(kind,r)!==a.personId||dateOf(kind,r)!==j.basis)return null;
 const t=a.impactActor(a.accountId);if(!t)return null;
 if(kind==='schedule_due'){
  if(!usablePlan(db,r)||!recordAccess(db,t,'schedule',r.id))return null;
  const k=scheduleKind(r),s=k==='self_eval'?null:find(db,'training_assignment',r.source_id);
  return make(scheduleLabels[k],s&&recordAccess(db,t,'training',s.id)?t.read('operation.read',s.operation_id)?.data.name??scheduleLabels[k]:scheduleLabels[k],'Вы назначены ответственным за плановое событие',{type:'schedule',id:r.id},scheduleStateLabel(db,r));
 }
 if(kind==='task_due'){
  const full=actionRows(db,r.id)[0];if(!full||!pendingTask(db,full)||!recordAccess(db,t,'task',r.id))return null;
  return make('выполнение мероприятия',r.title,'Вы назначены исполнителем',{type:'task',id:r.id},ACTION_STATES[actionStatus(db,full)]);
 }
 if(kind==='admission_due'){
  if(!currentAdmission(db,r,a.day)||!recordAccess(db,t,'training',r.assignment_id))return null;
  return make('срок допуска к работе',t.read('operation.read',r.operation_id)?.data.name??'Допуск к операции','Требуется проверка и отдельное решение о допуске',{type:'training',id:r.assignment_id});
 }
 if(r.revoked_at)return null;
 const target={credential_due:'credential',appointment_due:'appointment',authorization_due:'authorization'}[kind],read=target&&t.read(target+'.read',r.id);
 if(!read)return null;
 if(kind==='credential_due'&&(r.kind!=='certificate'||r.issued_on>a.day))return null;
 if(kind==='appointment_due'||kind==='authorization_due'){
  if(r.valid_from>a.day)return null;
  // Do not suggest renewing an order/right that has already lost its
  // certificate or underlying appointment through revocation.
  const cert=find(db,'mentor_credential',r.credential_id);
  if(!cert||cert.revoked_at||cert.person_id!==r.person_id)return null;
  if(kind==='authorization_due'){
   const app=find(db,'mentor_appointment',r.appointment_id);
   if(!app||app.revoked_at||app.person_id!==r.person_id)return null;
  }
 }
 const what={credential_due:'срок сертификата',appointment_due:'срок назначения наставника',authorization_due:'срок полномочий наставника'}[kind];
 return make(what,kind==='authorization_due'?t.read('operation.read',r.operation_id)?.data.name??'Полномочия по операции':kind==='credential_due'?'Документ о подготовке':'Приказ о назначении','Ваша зарегистрированная запись с конечным сроком',{type:target,id:r.id});
}
// Historical integrity is deliberately independent of current permission,
// deadline, replacement or employment status. Old records stay auditable.
export function extraReminderEvidence(db,j,r){
 if(!isId(j.stage)||!date(j.basis)||!r||!one(db,'SELECT id FROM person_assignment WHERE id=? AND person_id=?',[j.stage,j.person_id]))return false;
 if(j.kind==='sop_review_due'){
  // Revision responsibility can be changed explicitly without altering old
  // queue evidence; a historic assignment or recorded organizer is enough.
  if(r.author_id===j.person_id)return true;
  if(one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc83_sop_round'")&&one(db,'SELECT id FROM lc83_sop_round WHERE revision_id=? AND submitted_person_id=?',[r.id,j.person_id]))return true;
  return !!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc825_sop_review_owner'")&&!!one(db,'SELECT id FROM lc825_sop_review_owner WHERE document_id=? AND person_id=? AND employment_id=?',[r.document_id,j.person_id,j.stage]);
 }
 return ownerOf(j.kind,r)===j.person_id;
}
