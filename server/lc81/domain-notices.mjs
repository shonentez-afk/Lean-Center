// LC8.2/LC8.3 integration. New domain events are captured atomically with
// their existing transaction. No historic backfill or new task authority.
import {one,rows,isId,uuid} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {recordAccess} from './center-commands.mjs';
import {actionRows,actionStatus,ACTION_STATES} from '../../src/modules/training/audit-domain.js';
import {scheduleKind,scheduleDisplayState,scheduleLabels,scheduleStateLabel} from '../../src/modules/training/center-planning.js';

const table='lc824_domain_notice';
const exists=db=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[table]);
const find=(db,t,id)=>one(db,'SELECT * FROM '+t+' WHERE id=?',[id]);
const schema=[
 "CREATE TABLE IF NOT EXISTS lc824_domain_notice(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES change_event(id),target_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('training_assigned','training_changed','schedule_assigned','schedule_cancelled','audit_result','practical_result','task_assigned','task_result','task_cancelled')),family TEXT NOT NULL CHECK(family IN('training','schedule','audit','assessment','task')),person_id TEXT NOT NULL REFERENCES person(id),employment_id TEXT NOT NULL REFERENCES person_assignment(id),initial_account_id TEXT REFERENCES lc81_account(id),occurred_at TEXT NOT NULL,read_at TEXT,read_account_id TEXT REFERENCES lc81_account(id),UNIQUE(event_id,kind,person_id),CHECK((read_at IS NULL)=(read_account_id IS NULL)));",
 "CREATE INDEX IF NOT EXISTS lc824_notice_person ON lc824_domain_notice(person_id,occurred_at,id);",
 "CREATE INDEX IF NOT EXISTS lc824_notice_target ON lc824_domain_notice(person_id,family,target_id);"
].join('\n');

export function domainEventWatermark(db){return one(db,'SELECT coalesce(max(rowid),0) n FROM change_event').n}
export function domainNoticeWatermark(db){return exists(db)?one(db,'SELECT coalesce(max(rowid),0) n FROM lc824_domain_notice').n:0}
const evidence=(db,e)=>{
 const p=JSON.parse(e.payload_json),t=e.entity_type,create=e.operation==='create',update=e.operation==='update';
 if(t==='training_assignment'){
  const r=find(db,t,e.entity_id);if(!r?.source_sha256)return null;
  if(update&&p.command==='approve')return {kind:'training_assigned',family:'training',target:r,person:r.trainee_id};
  if(update&&['reschedule','cancel'].includes(p.command))return {kind:'training_changed',family:'training',target:r,person:r.trainee_id};
  // Draft plans are not instructions to start work. The native approve
  // event (including mass plan approval) is the authoritative trigger.
  return null;
 }
 if(t==='schedule_event'){
  const r=find(db,t,update&&p.command==='replan'?e.id:e.entity_id);
  if(!r||!['audit','practical','self_eval'].includes(scheduleKind(r)))return null;
  if(create||update&&p.command==='replan')return {kind:'schedule_assigned',family:'schedule',target:r,person:r.owner_id};
  if(update&&p.command==='cancel')return {kind:'schedule_cancelled',family:'schedule',target:r,person:r.owner_id};
 }
 if(t==='audit_session'&&create){
  const r=find(db,t,e.entity_id);if(r?.assignment_id&&r.training_session_id)return {kind:'audit_result',family:'audit',target:r,person:r.mentor_id};
 }
 if(t==='assessment_session'&&create&&p.command==='practical'){
  const r=find(db,t,e.entity_id);if(r?.assessment_kind==='practical')return {kind:'practical_result',family:'assessment',target:r,person:r.person_id};
 }
 if(t==='action_item'){
  const r=find(db,t,e.entity_id);if(!r)return null;
  if(create)return {kind:'task_assigned',family:'task',target:r,person:r.owner_id};
  if(update&&p.command==='verify')return {kind:'task_result',family:'task',target:r,person:r.owner_id};
  if(update&&p.command==='cancel')return {kind:'task_cancelled',family:'task',target:r,person:r.owner_id};
 }
 return null;
};
function employment(db,person,day){
 const p=one(db,'SELECT id FROM person WHERE id=? AND archived=0',[person]);if(!p)return null;
 const matches=rows(db,'SELECT id FROM person_assignment WHERE person_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',[person,day,day]);
 return matches.length===1?matches[0].id:null;
}
export function captureDomainNotices(db,after,clock){
 let initialized=exists(db),count=0;
 for(const e of rows(db,"SELECT * FROM change_event WHERE rowid>? AND entity_type IN('training_assignment','schedule_event','audit_session','assessment_session','action_item') ORDER BY rowid",[after])){
  const v=evidence(db,e);if(!v||!isId(v.person))continue;
  const employment_id=employment(db,v.person,clock.day);if(!employment_id)continue;
  const account=one(db,"SELECT id FROM lc81_account WHERE person_id=? AND state='active' AND bootstrap=0",[v.person]);
  if(!initialized){db.run(schema);initialized=true}
  if(one(db,'SELECT id FROM lc824_domain_notice WHERE event_id=? AND kind=? AND person_id=?',[e.id,v.kind,v.person]))continue;
  db.run('INSERT INTO lc824_domain_notice VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL)',[uuid(),e.id,v.target.id,v.kind,v.family,v.person,employment_id,account?.id??null,clock.at]);count++;
 }
 return count;
}
export function domainNoticeRows(db,a){
 if(!exists(db)||!a.personId)return [];
 return rows(db,"SELECT *,rowid ordinal,'domain' source FROM lc824_domain_notice WHERE person_id=? ORDER BY occurred_at DESC,id DESC",[a.personId]);
}
export function domainNoticeAnchor(db,a,id){
 return exists(db)&&a.personId?one(db,'SELECT rowid ordinal FROM lc824_domain_notice WHERE id=? AND person_id=?',[id,a.personId]):null;
}
export function markDomainRead(db,a,id){
 db.run('UPDATE lc824_domain_notice SET read_at=coalesce(read_at,?),read_account_id=coalesce(read_account_id,?) WHERE id=? AND person_id=?',[a.at,a.accountId,id,a.personId]);
}
export function domainNoticeOwner(db,id){
 return exists(db)?one(db,'SELECT person_id FROM lc824_domain_notice WHERE id=?',[id]):null;
}
function currentTraining(db,r){
 return !!r&&r.state!=='cancelled'&&!!r.source_sha256&&!!one(db,"SELECT v.id FROM document_revision v JOIN document d ON d.id=v.document_id JOIN operation o ON o.id=d.operation_id WHERE v.id=? AND v.state='effective' AND json_extract(v.payload_json,'$.source.sha256')=? AND d.archived=0 AND o.archived=0",[r.sop_revision_id,r.source_sha256]);
}
const assignmentPending=r=>['planned','in_progress'].includes(r.state);
export function domainNoticeView(db,a,n){
 if(!a.personId||n.person_id!==a.personId||a.employmentFor(a.personId)!==n.employment_id)return null;
 const e=find(db,'change_event',n.event_id),v=e&&evidence(db,e);
 if(!v||v.person!==n.person_id||v.target.id!==n.target_id||v.kind!==n.kind||v.family!==n.family)return null;
 const t=a.impactActor(a.accountId),link=t&&recordAccess(db,t,n.family,n.target_id);if(!link)return null;
 const r=v.target,p=JSON.parse(e.payload_json),latest=!one(db,'SELECT id FROM lc824_domain_notice WHERE person_id=? AND family=? AND target_id=? AND rowid>? LIMIT 1',[n.person_id,n.family,n.target_id,n.ordinal]);
 let label,title,reason,due=null,pending=false,state,category;
 if(n.family==='training'){
  category='training';title=t.read('operation.read',r.operation_id)?.data.name||'Производственное обучение';
  label=n.kind==='training_assigned'?'Назначено согласованное обучение TWI':p.command==='cancel'?'Обучение отменено':'Срок обучения изменён';
  due=r.due_on;reason='Вы назначены обучаемым';
  pending=latest&&n.kind==='training_assigned'&&currentTraining(db,r)&&!!r.approval_json&&assignmentPending(r);
  state=r.state==='cancelled'?'Отменено':!currentTraining(db,r)?'Редакция больше не действует':r.state==='completed'?'Завершено':!r.approval_json?'Ожидает согласования':r.state==='in_progress'?'В работе':'Назначено';
 }else if(n.family==='schedule'){
  category='audit';const k=scheduleKind(r),s=scheduleDisplayState(db,r),source=k==='self_eval'?null:find(db,'training_assignment',r.source_id);
  label=n.kind==='schedule_cancelled'?scheduleLabels[k]+': отмена':scheduleLabels[k]+': назначено';
  title=source&&recordAccess(db,t,'training',source.id)?t.read('operation.read',source.operation_id)?.data.name||scheduleLabels[k]:scheduleLabels[k];
  reason='Вы назначены ответственным за плановое событие';due=r.due_on;state=scheduleStateLabel(db,r);
  pending=latest&&n.kind==='schedule_assigned'&&['planned','needs_replan'].includes(s)&&(k==='self_eval'||currentTraining(db,source));
 }else if(n.family==='audit'){
  if(r.state!=='final')return null;
  category='audit';label='Зарегистрирован результат аудита L1';title=t.read('operation.read',r.operation_id)?.data.name||'Аудит L1';reason='Аудит вашей работы наставника';state='Результат зарегистрирован';
 }else if(n.family==='assessment'){
  if(r.state!=='confirmed')return null;
  category='audit';label='Зарегистрирована практическая оценка';title=t.read('operation.read',r.operation_id)?.data.name||'Практическая оценка';reason='Вы оценённый сотрудник';state='Результат зарегистрирован';
 }else if(n.family==='task'){
  category='task';const full=actionRows(db,r.id)[0];if(!full)return null;
  const s=actionStatus(db,full);
  label=n.kind==='task_assigned'?'Назначено мероприятие':n.kind==='task_cancelled'?'Мероприятие отменено':p.outcome==='ineffective'?'Мероприятие требует доработки':'Зарегистрирована проверка мероприятия';
  title=r.title;reason='Вы назначены исполнителем';due=r.due_on;state=ACTION_STATES[s]||s;
  pending=latest&&n.kind!=='task_cancelled'&&['open','in_progress','ineffective'].includes(s);
 }else return null;
 // An account created after the event sees only a still-live obligation,
 // not earlier historical results. Existing recipients keep authorized
 // history, with stale actionable status cleared.
 if(!pending&&n.initial_account_id!==a.accountId)return null;
 return {label,title,reason,due_on:due,pending,overdue:!!(pending&&due&&due<a.day),state,category,deliverable:latest&&(pending||['training_changed','schedule_cancelled','audit_result','practical_result','task_result','task_cancelled'].includes(n.kind)),route:{type:link.type,id:link.id}};
}
export function checkDomainNoticeIntegrity(db){
 if(!exists(db))return;
 for(const n of rows(db,'SELECT * FROM lc824_domain_notice')){
  const e=find(db,'change_event',n.event_id),v=e&&evidence(db,e),owner=n.initial_account_id&&find(db,'lc81_account',n.initial_account_id),reader=n.read_account_id&&find(db,'lc81_account',n.read_account_id),employment=find(db,'person_assignment',n.employment_id);
  if(!isId(n.id)||!v||v.person!==n.person_id||v.kind!==n.kind||v.family!==n.family||v.target.id!==n.target_id||employment?.person_id!==n.person_id||n.initial_account_id&&owner?.person_id!==n.person_id||n.read_account_id&&reader?.person_id!==n.person_id||!Number.isFinite(Date.parse(n.occurred_at))||n.read_at&&(!Number.isFinite(Date.parse(n.read_at))||n.read_at<n.occurred_at))throw new PilotError(503,'Нарушена целостность адресного события');
 }
}
