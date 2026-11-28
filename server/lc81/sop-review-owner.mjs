// LC8.2 D2: one responsibility record per SOP document, shared by the
// existing calendar, card, inbox and transport. No new task registry.
import {one,rows,isId,uuid} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {personWorkResource} from './read-policy.mjs';
const table='lc825_sop_review_owner';
const exists=(db,t)=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[t]);
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const schema=[
 "CREATE TABLE IF NOT EXISTS lc825_sop_review_owner(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES document(id),rev INTEGER NOT NULL CHECK(rev>0),revision_id TEXT NOT NULL REFERENCES document_revision(id),person_id TEXT NOT NULL REFERENCES person(id),employment_id TEXT NOT NULL REFERENCES person_assignment(id),actor_account_id TEXT NOT NULL REFERENCES lc81_account(id),changed_at TEXT NOT NULL,note TEXT NOT NULL,UNIQUE(document_id,rev));",
 "CREATE INDEX IF NOT EXISTS lc825_review_owner_document ON lc825_sop_review_owner(document_id,rev DESC);"
].join('\n');
export const currentSopReviewRows=db=>rows(db,"SELECT r.id,r.document_id,r.version_no,r.author_id,r.review_due,r.changed_on,d.code,d.operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.state='effective' AND d.kind='sop' AND d.archived=0 AND o.archived=0 AND r.review_due IS NOT NULL ORDER BY r.review_due,r.id");
export const currentSopReviewRow=(db,id)=>isId(id)?one(db,"SELECT r.id,r.document_id,r.version_no,r.author_id,r.review_due,r.changed_on,d.code,d.operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=? AND r.state='effective' AND d.kind='sop' AND d.archived=0 AND o.archived=0 AND r.review_due IS NOT NULL",[id]):null;
const latest=(db,id)=>exists(db,table)?one(db,'SELECT * FROM lc825_sop_review_owner WHERE document_id=? ORDER BY rev DESC LIMIT 1',[id]):null;
function inSite(db,id,site){
 const seen=new Set();while(id&&!seen.has(id)){if(id===site)return true;seen.add(id);const r=one(db,'SELECT parent_id FROM org_unit WHERE id=? AND archived=0',[id]);id=r?.parent_id??null}return false;
}
export function localReviewEmployment(db,id,day){
 if(!isId(id)||!one(db,'SELECT id FROM person WHERE id=? AND archived=0',[id]))return null;
 const site=one(db,"SELECT value FROM lc81_meta WHERE key='site_id'")?.value;
 const es=rows(db,'SELECT id,unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',[id,day,day]);
 return site&&es.length===1&&inSite(db,es[0].unit_id,site)?es[0].id:null;
}
export function sopReviewOwner(db,r,day){
 if(!r)return {rev:0,person_id:null,employment_id:null,origin:'unassigned',note:null};
 const saved=latest(db,r.document_id);
 if(saved){
  const valid=localReviewEmployment(db,saved.person_id,day)===saved.employment_id;
  return {rev:saved.rev,person_id:valid?saved.person_id:null,employment_id:valid?saved.employment_id:null,origin:valid?'assigned':'employment_changed',note:saved.note};
 }
 // The submitted organizer is a proposed default, not an additional
 // approval right. An explicit assignment always supersedes the default.
 const published=exists(db,'lc83_sop_round')?one(db,"SELECT submitted_person_id FROM lc83_sop_round WHERE revision_id=? AND state='effective' ORDER BY round_no DESC LIMIT 1",[r.id]):null;
 const person=published?.submitted_person_id??r.author_id??null,employment=localReviewEmployment(db,person,day);
 return {rev:0,person_id:employment?person:null,employment_id:employment,origin:employment?(published?'organizer':'recorded_author'):'unassigned',note:null};
}
const unitResource=r=>({data:{},self:null,units:[r.unit_id],assigned:[]});
function canManage(db,a,library,r){
 return !!a.personId&&!!library.fullAllows('sop.revise','sop.read_history',r.id)&&!!a.scope('calendar.plan',r.id,unitResource(r));
}
function choice(db,a,r,id){
 const employ=localReviewEmployment(db,id,a.day),p=a.read('person.read_directory',id)||a.read('person.read_basic',id);
 const resource=employ&&personWorkResource(db,[id],a.day,[],[r.operation_id]);
 return p&&resource&&a.scope('calendar.plan',r.id,resource)?{id,name:p.data.display_name,employment_id:employ}:null;
}
const visibleName=(a,id)=>id?(a.read('person.read_directory',id)||a.read('person.read_basic',id))?.data.display_name??null:null;
export function sopReviewOwnerInfo(db,a,library,approval,id){
 const r=currentSopReviewRow(db,id);if(!r)return null;
 const owner=sopReviewOwner(db,r,a.day),manage=canManage(db,a,library,r),mine=owner.person_id===approval.personId&&!!owner.person_id;
 const opts=manage?rows(db,'SELECT id FROM person WHERE archived=0 ORDER BY display_name,id').flatMap(p=>{const c=choice(db,a,r,p.id);return c?[{id:c.id,name:c.name}]:[]}):[];
 return {rev:owner.rev,assigned:!!owner.person_id,origin:owner.origin,person_id:manage||mine?owner.person_id:null,name:mine?approval.name:manage?visibleName(a,owner.person_id):null,can_assign:manage,choices:opts,due_on:r.review_due,overdue:r.review_due<a.day,note:manage?owner.note:null};
}
export function assignSopReviewOwner(db,a,library,f){
 must(exact(f,['revision_id','expected_revision','person_id','note'])&&isId(f.revision_id)&&isId(f.person_id)&&Number.isSafeInteger(f.expected_revision)&&f.expected_revision>=0&&typeof f.note==='string'&&f.note.trim().length>0&&f.note.length<=500,400,'Укажите сотрудника и основание назначения');
 const r=currentSopReviewRow(db,f.revision_id);
 must(r&&canManage(db,a,library,r),403,'Назначение ответственного за актуализацию недоступно');
 const old=sopReviewOwner(db,r,a.day);must(old.rev===f.expected_revision,409,'Ответственный изменён, обновите карточку');
 const c=choice(db,a,r,f.person_id);must(c,403,'Сотрудник выходит за область полномочий');
 const id=uuid();db.run(schema);
 db.run('INSERT INTO lc825_sop_review_owner VALUES(?,?,?,?,?,?,?,?,?)',[id,r.document_id,old.rev+1,r.id,c.id,c.employment_id,a.accountId,a.at,f.note.trim()]);
 a.audit('sop.review_owner.assign',id);return {rev:old.rev+1,person_id:c.id};
}
export function ownSopReviewAvailable(db,approval){
 return !!approval.personId&&currentSopReviewRows(db).some(r=>approval.effective(r.id)&&sopReviewOwner(db,r,approval.day).person_id===approval.personId);
}
export function sopReviewCalendar(db,a,approval,q,personal){
 return currentSopReviewRows(db).flatMap(r=>{
  if(r.review_due>q.to||r.review_due<q.from&&!(q.mode==='plan'&&r.review_due<a.day))return [];
  const owner=sopReviewOwner(db,r,a.day);
  if(q.person_id&&owner.person_id!==q.person_id)return [];
  if(personal){if(!approval.personId||owner.person_id!==approval.personId||!approval.effective(r.id))return []}
  else if(!a.read('sop.read_history',r.id)||!a.scope('calendar.read',r.id,unitResource(r)))return [];
  const v=a.read('sop.read_history',r.id),title=v?.data.title??approval.reviewTitle?.(r.id)??r.code;
  return [{key:'sop:'+r.id,date:r.review_due,type:'Актуализация СОП',title,owner:owner.person_id===approval.personId?approval.name:visibleName(a,owner.person_id),state:owner.person_id?'Действует · требуется пересмотр':'Не назначен ответственный',pending:true,overdue:r.review_due<a.day,route:{type:'sop',id:r.id}}];
 });
}
export function sopReviewStatus(db,day,accessFor){
 const status={total:0,overdue:0,unassigned:0,without_account:0};
 for(const r of currentSopReviewRows(db)){
  status.total++;if(r.review_due<day)status.overdue++;
  const o=sopReviewOwner(db,r,day);
  if(!o.person_id){status.unassigned++;continue}
  const a=one(db,"SELECT id FROM lc81_account WHERE person_id=? AND state='active' AND bootstrap=0",[o.person_id]);
  if(!a||!accessFor(a.id)?.effective(r.id))status.without_account++;
 }
 return status;
}
export function checkSopReviewOwnerIntegrity(db){
 if(!exists(db,table))return;
 for(const r of rows(db,'SELECT o.*,v.document_id actual_document,e.person_id employment_person,a.person_id actor_person FROM lc825_sop_review_owner o JOIN document_revision v ON v.id=o.revision_id JOIN person_assignment e ON e.id=o.employment_id JOIN lc81_account a ON a.id=o.actor_account_id')){
  must(isId(r.id)&&r.actual_document===r.document_id&&r.employment_person===r.person_id&&r.actor_person&&Number.isSafeInteger(r.rev)&&r.rev>=1&&typeof r.note==='string'&&r.note.trim()&&r.note.length<=500&&Number.isFinite(Date.parse(r.changed_at)),503,'Повреждено назначение ответственного за СОП');
 }
}
