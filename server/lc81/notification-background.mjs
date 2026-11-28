import {memoRead} from './read-memo.mjs';
// LC8.2.2: local, durable, bounded reconciliation and reminder work.
// No outbound network, no second workflow, no client-triggered worker.
// Every completed reminder is still projected from LIVE domain evidence.
import {one,rows,isId,uuid} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {approvalReminderTargets,approvalReminderView} from './sop-approval.mjs';
import {familiarizationBackgroundTargets,familiarizationBackgroundView,familiarizationMissingAccounts} from './sop-familiarization.mjs';
import {recordAccess} from './center-commands.mjs';
import {EXTRA_CATEGORIES,EXTRA_SOURCES,EXTRA_KIND_CATEGORY,extraReminderTargets,extraReminderView,extraReminderEvidence} from './extra-reminders.mjs';

const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const time=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const exists=(db,t)=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[t]);
const table='lc822_notification_job',prefTable='lc822_notification_preference',policyTable='lc822_notification_policy';
const legacyKinds=['approval_due','familiarization_due','training_due','familiarization_catchup'];
const kinds=[...legacyKinds,...Object.keys(EXTRA_SOURCES)];
const legacyCategories=['approval','familiarization','training'],legacyPushCategories=[...legacyCategories,'audit','task','information'];
const categories=[...legacyCategories,...EXTRA_CATEGORIES];
const pushCategories=[...categories,'information'];
const category=j=>EXTRA_KIND_CATEGORY[j.kind]??(j.kind==='approval_due'?'approval':j.kind==='training_due'?'training':'familiarization');
const schema=[
 "CREATE TABLE IF NOT EXISTS lc822_notification_policy(id INTEGER PRIMARY KEY CHECK(id=1),rev INTEGER NOT NULL CHECK(rev>0),settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),updated_by TEXT NOT NULL REFERENCES lc81_account(id),updated_at TEXT NOT NULL);",
 "CREATE TABLE IF NOT EXISTS lc822_notification_preference(account_id TEXT PRIMARY KEY REFERENCES lc81_account(id),rev INTEGER NOT NULL CHECK(rev>0),settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),updated_at TEXT NOT NULL);",
 "CREATE TABLE IF NOT EXISTS lc822_notification_job(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('approval_due','familiarization_due','training_due','familiarization_catchup','sop_review_due','schedule_due','task_due','credential_due','appointment_due','authorization_due','admission_due')),target_id TEXT NOT NULL,stage TEXT NOT NULL,basis TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES person(id),account_id TEXT NOT NULL REFERENCES lc81_account(id),state TEXT NOT NULL CHECK(state IN('pending','retry','completed','cancelled','failed')),attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 4),created_at TEXT NOT NULL,next_attempt_at TEXT NOT NULL,finished_at TEXT,last_code TEXT,read_at TEXT,notice_ordinal INTEGER UNIQUE,CHECK((state='completed' AND kind<>'familiarization_catchup')=(notice_ordinal IS NOT NULL)),UNIQUE(kind,target_id,stage,basis,account_id),CHECK((state IN('completed','cancelled','failed'))=(finished_at IS NOT NULL)),CHECK(read_at IS NULL OR (state='completed' AND kind<>'familiarization_catchup')));",
 "CREATE INDEX IF NOT EXISTS lc822_job_ready ON lc822_notification_job(state,next_attempt_at,id);",
 "CREATE INDEX IF NOT EXISTS lc822_job_account ON lc822_notification_job(account_id,state,finished_at);"
].join('\n');
function ensureSchema(db){
 const old=exists(db,table)&&one(db,"SELECT sql FROM sqlite_master WHERE type='table' AND name=?",[table]);
 if(old&&!old.sql.includes("'sop_review_due'")){
  db.run('ALTER TABLE lc822_notification_job RENAME TO lc822_notification_job_legacy');
  db.run(schema);
  db.run('INSERT INTO lc822_notification_job SELECT * FROM lc822_notification_job_legacy');
  db.run('DROP TABLE lc822_notification_job_legacy');
 }
 db.run(schema);
}

export const backgroundEnabled=()=>process.env.LC82_INBOX_ENABLED!=='0'&&process.env.LC82_BACKGROUND_ENABLED!=='0';
const defaultPolicy=db=>Object.fromEntries(categories.map(k=>[k,k==='sop_review'&&exists(db,'lc81_meta')&&one(db,"SELECT value FROM lc81_meta WHERE key='site_time_zone'")?.value?30:null]));
const defaultPreferences=()=>({reminders:Object.fromEntries(categories.map(k=>[k,true])),push_types:Object.fromEntries(pushCategories.map(k=>[k,false])),delivery_window:null});
const validPolicy=p=>(exact(p,categories)||exact(p,legacyCategories))&&Object.keys(p).every(k=>p[k]===null||Number.isSafeInteger(p[k])&&p[k]>=0&&p[k]<=(legacyCategories.includes(k)?30:90));
const bools=(v,ks)=>exact(v,ks)&&ks.every(k=>typeof v[k]==='boolean');
const validWindow=w=>w===null||exact(w,['days','start','end'])&&Array.isArray(w.days)&&w.days.length>=1&&w.days.length<=7&&new Set(w.days).size===w.days.length&&w.days.every(d=>Number.isSafeInteger(d)&&d>=1&&d<=7)&&time(w.start)&&time(w.end)&&w.start!==w.end;
const validPrefs=p=>exact(p,['reminders','push_types','delivery_window'])&&(bools(p.reminders,categories)||bools(p.reminders,legacyCategories))&&(bools(p.push_types,pushCategories)||bools(p.push_types,legacyPushCategories))&&validWindow(p.delivery_window);
const requireUser=a=>must(a.personId&&process.env.LC82_INBOX_ENABLED!=='0',404,'Настройки уведомлений недоступны');
function policy(db){return memoRead(db,'notification.policy',[],()=>loadPolicy(db))}
function loadPolicy(db){
 const p=exists(db,policyTable)&&one(db,'SELECT * FROM lc822_notification_policy WHERE id=1');
 return p?{rev:p.rev,...defaultPolicy(db),...JSON.parse(p.settings_json)}:{rev:0,...defaultPolicy(db)};
}
function preferences(db,id){return memoRead(db,'notification.preferences',[id],()=>loadPreferences(db,id))}
function loadPreferences(db,id){
 const p=exists(db,prefTable)&&one(db,'SELECT * FROM lc822_notification_preference WHERE account_id=?',[id]);
 const base=defaultPreferences(),saved=p&&JSON.parse(p.settings_json);
 return saved?{rev:p.rev,reminders:{...base.reminders,...saved.reminders},push_types:{...base.push_types,...saved.push_types},delivery_window:saved.delivery_window}:{rev:0,...base};
}
export function notificationPreferences(db,a){
 requireUser(a);return {...preferences(db,a.accountId),zone:a.zone,internal_inbox:true,push_available:false,email_available:false,policy:policy(db)};
}
export function saveNotificationPreferences(db,a,f){
 requireUser(a);
 must(exact(f,['expected_revision','reminders','push_types','delivery_window'])&&Number.isSafeInteger(f.expected_revision)&&f.expected_revision>=0,400,'Неверные поля настроек');
 const {expected_revision,...input}=f;
 must(validPrefs(input),400,'Проверьте типы уведомлений и окно доставки');
 const old=preferences(db,a.accountId);
 must(old.rev===expected_revision,409,'Настройки изменились; обновите форму');
 const p={reminders:{...old.reminders,...input.reminders},push_types:{...old.push_types,...input.push_types},delivery_window:input.delivery_window};
 ensureSchema(db);
 db.run("INSERT INTO lc822_notification_preference VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET rev=excluded.rev,settings_json=excluded.settings_json,updated_at=excluded.updated_at",[a.accountId,old.rev+1,JSON.stringify(p),a.at]);
 a.audit('notification.preferences',a.accountId);
 return notificationPreferences(db,a);
}
export function saveReminderPolicy(db,actor,clock,f,audit){
 must(f&&Number.isSafeInteger(f.expected_revision)&&f.expected_revision>=0,400,'Неверные поля политики напоминаний');
 const {expected_revision,...input}=f;
 must(validPolicy(input),400,'Укажите от 0 до 30 дней для согласований/обучения или до 90 дней для новых категорий либо отключите напоминания');
 const old=policy(db);
 must(old.rev===expected_revision,409,'Политика изменилась; обновите форму');
 const p={...defaultPolicy(db),...Object.fromEntries(categories.map(k=>[k,old[k]])),...input};
 must(clock.configured||categories.every(k=>p[k]===null),409,'Сначала закрепите часовой пояс предприятия');
 ensureSchema(db);
 db.run("INSERT INTO lc822_notification_policy VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rev=excluded.rev,settings_json=excluded.settings_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",[old.rev+1,JSON.stringify(p),actor,clock.at]);
 audit('notification.policy',actor);
 return policy(db);
}
const plusDays=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
function horizon(clock,p,k){return !clock.configured||p[k]===null?null:plusDays(clock.day,p[k])}
const key=j=>JSON.stringify([j.kind,j.target_id,j.stage,j.basis,j.account_id]);
function trainingTargets(db,until){
 if(!until)return [];
 return rows(db,"SELECT t.id target_id,t.trainee_id person_id,t.due_on basis,a.id account_id FROM training_assignment t JOIN lc81_account a ON a.person_id=t.trainee_id AND a.state='active' JOIN document_revision v ON v.id=t.sop_revision_id JOIN document d ON d.id=v.document_id JOIN operation o ON o.id=t.operation_id WHERE t.state IN('planned','in_progress') AND t.source_sha256 IS NOT NULL AND t.source_sha256=json_extract(v.payload_json,'$.source.sha256') AND v.state='effective' AND d.archived=0 AND o.archived=0 AND t.due_on<=? ORDER BY t.id",[until]).map(x=>({...x,kind:'training_due',stage:''}));
}
function trainingView(db,a,j){
 const x=one(db,"SELECT t.*,v.state revision_state,json_extract(v.payload_json,'$.source.sha256') revision_sha,d.archived document_archived,o.archived operation_archived FROM training_assignment t JOIN document_revision v ON v.id=t.sop_revision_id JOIN document d ON d.id=v.document_id JOIN operation o ON o.id=t.operation_id WHERE t.id=?",[j.target_id]);
 if(!x||!a.personId||x.trainee_id!==a.personId||j.person_id!==a.personId||j.account_id!==a.accountId||x.due_on!==j.basis||!['planned','in_progress'].includes(x.state)||x.revision_state!=='effective'||!x.source_sha256||x.revision_sha!==x.source_sha256||x.document_archived||x.operation_archived)return null;
 const t=a.impactActor(a.accountId);
 if(!t||!recordAccess(db,t,'training',x.id))return null;
 const overdue=x.due_on<a.day;
 return {label:overdue?'Просрочено обучение TWI':'Приближается срок обучения TWI',title:t.read('operation.read',x.operation_id)?.data.name||'Назначение производственного обучения',reason:'Вы назначены обучаемым',due_on:x.due_on,pending:true,overdue,state:overdue?'Просрочено':x.state==='planned'?'Назначено':'В работе',route:{type:'training',id:x.id}};
}
function liveView(db,a,j,p,clock){
 if(!a?.personId||a.personId!==j.person_id||a.accountId!==j.account_id)return null;
 if(j.kind==='familiarization_catchup')return familiarizationBackgroundView(db,a,j);
 const k=category(j),until=horizon(clock,p,k);
 if(!until||j.basis>until||!preferences(db,j.account_id).reminders[k])return null;
 if(j.kind==='approval_due')return approvalReminderView(db,a,j);
 if(j.kind==='familiarization_due')return familiarizationBackgroundView(db,a,j);
 if(j.kind==='training_due')return trainingView(db,a,j);
 if(Object.hasOwn(EXTRA_SOURCES,j.kind))return extraReminderView(db,a,j);
 return null;
}
export function backgroundNoticeRows(db,a,id=null){
 if(!exists(db,table))return [];
 return rows(db,"SELECT *,notice_ordinal ordinal,finished_at occurred_at,'background' source FROM lc822_notification_job WHERE account_id=? AND state='completed' AND kind<>'familiarization_catchup'"+(id?' AND id=?':'')+' ORDER BY finished_at DESC,id DESC',[a.accountId,...(id?[id]:[])]);
}
export function backgroundNoticeView(db,a,j){
 // Disabling or superseding a reminder removes it from the actionable inbox,
 // not from the durable history. Do not copy confidential labels into jobs.
 return liveView(db,a,j,policy(db),{day:a.day,configured:a.clockConfigured});
}
export function markBackgroundRead(db,a,id){
 db.run("UPDATE lc822_notification_job SET read_at=coalesce(read_at,?) WHERE id=? AND account_id=? AND state='completed' AND kind<>'familiarization_catchup'",[a.at,id,a.accountId]);
}
export function backgroundAnchor(db,a,id){
 return exists(db,table)?one(db,"SELECT notice_ordinal ordinal FROM lc822_notification_job WHERE id=? AND account_id=? AND state='completed' AND kind<>'familiarization_catchup'",[id,a.accountId]):null;
}
export const BACKGROUND_BATCH=64;
function accessMemo(accessFor){const m=new Map();return id=>{if(!m.has(id))m.set(id,accessFor(id));return m.get(id)}}
// Discover from real rows, then revalidate inside the checkpoint transaction.
// The cap applies to NEW jobs, not just first N raw rows; inaccessible or
// previously processed rows cannot starve the rest of the roster.
export function discoverBackground(db,clock,accessFor,limit=BACKGROUND_BATCH){
 if(!backgroundEnabled())return [];
 const p=policy(db),a=accessMemo(accessFor);
 const approvalUntil=horizon(clock,p,'approval');
 const candidates=[...familiarizationBackgroundTargets(db,horizon(clock,p,'familiarization')),...(approvalUntil?approvalReminderTargets(db,approvalUntil):[]),...trainingTargets(db,horizon(clock,p,'training')),...extraReminderTargets(db,clock,Object.fromEntries(EXTRA_CATEGORIES.map(k=>[k,horizon(clock,p,k)])))];
 candidates.sort((a,b)=>Number(b.kind==='familiarization_catchup')-Number(a.kind==='familiarization_catchup')||a.basis.localeCompare(b.basis)||key(a).localeCompare(key(b)));
 const known=exists(db,table)?new Set(rows(db,"SELECT kind,target_id,stage,basis,account_id FROM lc822_notification_job WHERE state<>'cancelled'").map(key)):new Set();
 const jobs=[];
 for(const j of candidates){
  if(known.has(key(j)))continue;
  if(!liveView(db,a(j.account_id),j,p,clock))continue;
  jobs.push(j);if(jobs.length>=limit)break;
 }
 return jobs;
}
export function enqueueBackground(db,clock,accessFor,candidates){
 if(!backgroundEnabled()||!candidates.length)return 0;
 const p=policy(db),a=accessMemo(accessFor);let count=0,initialized=false;
 for(const j of candidates.slice(0,BACKGROUND_BATCH)){
  if(!liveView(db,a(j.account_id),j,p,clock))continue;
  if(!initialized){ensureSchema(db);initialized=true}
  const prior=one(db,'SELECT id,state FROM lc822_notification_job WHERE kind=? AND target_id=? AND stage=? AND basis=? AND account_id=?',[j.kind,j.target_id,j.stage,j.basis,j.account_id]);
  if(prior){
   // A never-delivered cancelled job may become valid again (e.g. the
   // same date is reinstated). Reuse its identity; never duplicate a
   // completed notice or reset a terminal failure automatically.
   if(prior.state!=='cancelled')continue;
   db.run("UPDATE lc822_notification_job SET state='pending',next_attempt_at=?,finished_at=NULL,last_code='reactivated' WHERE id=?",[clock.at,prior.id]);count++;continue;
  }
  db.run("INSERT INTO lc822_notification_job VALUES(?,?,?,?,?,?,?,'pending',0,?,?,NULL,NULL,NULL,NULL)",[uuid(),j.kind,j.target_id,j.stage,j.basis,j.person_id,j.account_id,clock.at,clock.at]);count++;
 }
 return count;
}
export function readyBackground(db,clock,limit=BACKGROUND_BATCH){
 return backgroundEnabled()&&exists(db,table)?rows(db,"SELECT id FROM lc822_notification_job WHERE state IN('pending','retry') AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT ?",[clock.at,limit]).map(x=>x.id):[];
}
// Each job and its notice are atomic in the *same* checkpoint. If a
// process crashes before commit, the pending job can safely be retried.
// External delivery is intentionally NOT performed by this worker.
export function drainBackground(db,clock,accessFor,ids,{beforeJob=null}={}){
 const result={completed:0,cancelled:0,retried:0,failed:0};
 if(!backgroundEnabled()||!exists(db,table))return result;
 const p=policy(db),a=accessMemo(accessFor);
 for(const id of ids.slice(0,BACKGROUND_BATCH)){
  const j=one(db,"SELECT * FROM lc822_notification_job WHERE id=? AND state IN('pending','retry') AND next_attempt_at<=?",[id,clock.at]);if(!j)continue;
  db.run('SAVEPOINT lc822_job');
  try{
   beforeJob?.(j);
   const v=liveView(db,a(j.account_id),j,p,clock);
   if(!v){db.run("UPDATE lc822_notification_job SET state='cancelled',finished_at=?,last_code='not_current' WHERE id=?",[clock.at,id]);result.cancelled++}
   else{
    if(j.kind==='familiarization_catchup')db.run("INSERT OR IGNORE INTO lc83_sop_notice VALUES(?,?,?,?,'familiarization_required',?)",[uuid(),v.round_id,v.event_key,j.account_id,clock.at]);
    const ordinal=j.kind==='familiarization_catchup'?null:one(db,'SELECT coalesce(max(notice_ordinal),0)+1 n FROM lc822_notification_job').n;
    db.run("UPDATE lc822_notification_job SET state='completed',attempts=attempts+1,finished_at=?,last_code='ok',notice_ordinal=? WHERE id=?",[clock.at,ordinal,id]);result.completed++;
   }
   db.run('RELEASE lc822_job');
  }catch{
   db.run('ROLLBACK TO lc822_job');db.run('RELEASE lc822_job');
   const attempts=j.attempts+1,failed=attempts>=4,next=new Date(Date.parse(clock.at)+[60000,300000,900000,900000][attempts-1]).toISOString();
   db.run('UPDATE lc822_notification_job SET state=?,attempts=?,next_attempt_at=?,finished_at=?,last_code=? WHERE id=?',[failed?'failed':'retry',attempts,next,failed?clock.at:null,'projection_error',id]);
   result[failed?'failed':'retried']++;
  }
 }
 return result;
}
export function backgroundStatus(db,clock,accessFor){
 const counts={pending:0,retry:0,completed:0,cancelled:0,failed:0};
 if(exists(db,table))for(const r of rows(db,'SELECT state,count(*) n FROM lc822_notification_job GROUP BY state'))counts[r.state]=r.n;
 return {enabled:backgroundEnabled(),worker_disabled:process.env.LC81_SCHEDULER_DISABLED==='1',clock_configured:clock.configured,zone:clock.zone,policy:policy(db),counts,ready:exists(db,table)?one(db,"SELECT count(*) n FROM lc822_notification_job WHERE state IN('pending','retry') AND next_attempt_at<=?",[clock.at]).n:0,last_finished:exists(db,table)?one(db,'SELECT max(finished_at) at FROM lc822_notification_job').at:null,missing_accounts:familiarizationMissingAccounts(db,accessFor,clock.day),outbound_enabled:false,batch_limit:BACKGROUND_BATCH};
}
export function checkBackgroundIntegrity(db){
 const ts=[table,prefTable,policyTable].filter(t=>exists(db,t));
 if(!ts.length)return;
 must(ts.length===3,503,'Неполная схема фоновых уведомлений');
 const p=one(db,'SELECT * FROM lc822_notification_policy WHERE id=1');
 must(!p||validPolicy(JSON.parse(p.settings_json))&&instant(p.updated_at),503,'Повреждена политика напоминаний');
 for(const q of rows(db,'SELECT * FROM lc822_notification_preference'))must(validPrefs(JSON.parse(q.settings_json))&&instant(q.updated_at),503,'Повреждены настройки уведомлений');
 for(const j of rows(db,'SELECT j.*,a.person_id account_person FROM lc822_notification_job j JOIN lc81_account a ON a.id=j.account_id')){
  must(isId(j.id)&&isId(j.target_id)&&j.account_person===j.person_id&&kinds.includes(j.kind)&&instant(j.created_at)&&instant(j.next_attempt_at)&&j.next_attempt_at>=j.created_at&&(!j.finished_at||instant(j.finished_at)&&j.finished_at>=j.created_at)&&(!j.read_at||instant(j.read_at)&&j.read_at>=j.finished_at),503,'Повреждено фоновое задание');
  must(Object.hasOwn(EXTRA_SOURCES,j.kind)?isId(j.stage)&&date(j.basis):j.kind==='approval_due'?['safety','engineering','twi','director','publish'].includes(j.stage)&&date(j.basis):j.stage===''&&(j.kind==='familiarization_catchup'?j.basis==='required':date(j.basis)),503,'Повреждено основание фонового задания');
  const source=EXTRA_SOURCES[j.kind]??(j.kind==='approval_due'?'lc83_sop_round':j.kind==='training_due'?'training_assignment':'lc83_sop_familiarization');
  const evidence=exists(db,source)&&one(db,'SELECT * FROM '+source+' WHERE id=?',[j.target_id]);
  must(evidence,503,'Нет источника фонового задания');
  if(Object.hasOwn(EXTRA_SOURCES,j.kind))must(extraReminderEvidence(db,j,evidence),503,'Неверный адресат или источник напоминания');
  else if(j.kind==='approval_due')must(JSON.parse(evidence.route_json).participants.some(x=>x.stage===j.stage&&x.person_id===j.person_id&&x.account_id===j.account_id&&x.due_on===j.basis),503,'Неверный адресат поручения СОП');
  else must((j.kind==='training_due'?evidence.trainee_id:evidence.person_id)===j.person_id,503,'Неверный адресат фонового задания');
  must(j.notice_ordinal===null||Number.isSafeInteger(j.notice_ordinal)&&j.notice_ordinal>0,503,'Неверный порядок уведомлений');
 }
}
