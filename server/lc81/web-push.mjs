// LC8.2.3: device-scoped transport queue over the authoritative inbox.
// A provider acceptance is NOT proof of read/receipt/qualification.
// No payload text, credential secrets or endpoint URLs in public projections.
import {one,rows,isId,uuid} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {pushNoticeWatermarks,pushNoticeCandidates} from './notifications.mjs';
import {notificationPreferences} from './notification-background.mjs';
import {validatePushSubscription,pushEndpoint} from './web-push-transport.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const exists=(db,t)=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[t]);
const deviceTable='lc823_push_device',jobTable='lc823_push_job',policyTable='lc823_push_policy';
const schema=[
 "CREATE TABLE IF NOT EXISTS lc823_push_policy(id INTEGER PRIMARY KEY CHECK(id=1),rev INTEGER NOT NULL CHECK(rev>0),enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),binding TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES lc81_account(id));",
 "CREATE TABLE IF NOT EXISTS lc823_push_device(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES lc81_account(id),person_id TEXT NOT NULL REFERENCES person(id),credential_revision INTEGER NOT NULL CHECK(credential_revision>0),binding TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,expiration_time INTEGER,label TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('active','revoked','expired')),created_at TEXT NOT NULL,original_after INTEGER NOT NULL,background_after INTEGER NOT NULL,revoked_at TEXT,last_test_at TEXT,CHECK((state='active')=(revoked_at IS NULL)));",
 "CREATE INDEX IF NOT EXISTS lc823_device_account ON lc823_push_device(account_id,state);",
 "CREATE TABLE IF NOT EXISTS lc823_push_job(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES lc823_push_device(id),notice_id TEXT,kind TEXT NOT NULL CHECK(kind IN('notice','test')),dedup TEXT NOT NULL,category TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,next_attempt_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','retry','sending','accepted','cancelled','expired','failed','uncertain')),attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 4),claim_id TEXT,finished_at TEXT,last_code TEXT,UNIQUE(device_id,dedup),CHECK((kind='test')=(notice_id IS NULL)),CHECK((state='sending')=(claim_id IS NOT NULL)),CHECK((state IN('accepted','cancelled','expired','failed','uncertain'))=(finished_at IS NOT NULL)));",
 "CREATE INDEX IF NOT EXISTS lc823_job_ready ON lc823_push_job(state,next_attempt_at,device_id);"
].join('\n');
const MAX_DEVICES=5,MAX_GLOBAL=2000,MAX_JOBS=128,MAX_PER_SEND=32,MAX_AGE=86400000;
const states=['pending','retry','sending','accepted','cancelled','expired','failed','uncertain'];
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const plus=(at,ms)=>new Date(Date.parse(at)+ms).toISOString();
const device=(db,id)=>exists(db,deviceTable)&&isId(id)?one(db,'SELECT * FROM lc823_push_device WHERE id=?',[id]):null;
const policy=(db,config)=>{
 const p=exists(db,policyTable)&&one(db,'SELECT * FROM lc823_push_policy WHERE id=1');
 return {rev:p?.rev??0,enabled:!!config&&p?.enabled===1&&p.binding===config.binding,configured:!!config};
};
const publicDevice=(d,a,config)=>({id:d.id,label:d.label,state:d.state==='active'&&(!config||d.binding!==config.binding||d.credential_revision!==a.credentialRevision)?'reconnect':d.state,created_at:d.created_at,last_test_at:d.last_test_at,revoked_at:d.revoked_at});
function requireUser(a){must(a?.personId&&process.env.LC82_INBOX_ENABLED!=='0',404,'Устройства уведомлений недоступны')}
function requireEnabled(db,config){must(config&&policy(db,config).enabled,409,'Web Push не включён администратором')}
function cancelDeviceJobs(db,id,at,code){
 db.run("UPDATE lc823_push_job SET state='cancelled',finished_at=?,last_code=? WHERE device_id=? AND state IN('pending','retry')",[at,code,id]);
}
function retire(db,d,at,state='revoked',code='device_revoked'){
 if(d.state==='active'){
  db.run('UPDATE lc823_push_device SET state=?,revoked_at=? WHERE id=?',[state,at,d.id]);
  cancelDeviceJobs(db,d.id,at,code);
 }
}
export function pushDevices(db,a,config){
 requireUser(a);const p=policy(db,config);
 return {configured:p.configured,enabled:p.enabled&&a.clockConfigured,public_key:p.enabled&&a.clockConfigured?config.public_key:null,clock_configured:a.clockConfigured,max_devices:MAX_DEVICES,devices:exists(db,deviceTable)?rows(db,'SELECT * FROM lc823_push_device WHERE account_id=? ORDER BY created_at DESC,id',[a.accountId]).slice(0,50).map(d=>({...publicDevice(d,a,config),last_test_state:one(db,"SELECT state FROM lc823_push_job WHERE device_id=? AND kind='test' ORDER BY created_at DESC,id DESC LIMIT 1",[d.id])?.state??null})):[]};
}
export function registerPushDevice(db,a,config,f){
 requireUser(a);requireEnabled(db,config);
 must(a.clockConfigured,409,'Сначала настройте часовой пояс предприятия');
 must(exact(f,['label','subscription','confirmed'])&&f.confirmed===true&&typeof f.label==='string'&&f.label.trim().length>0&&f.label.length<=80&&!/[\x00-\x1f\x7f]/.test(f.label),400,'Укажите имя устройства и подтвердите включение');
 let s;try{s=validatePushSubscription(f.subscription)}catch{throw new PilotError(400,'Недопустимая подписка или неподдерживаемый сервис браузера')}
 must(s.expiration_time===null||s.expiration_time>Date.parse(a.at),409,'Подписка истекла');
 const old=exists(db,deviceTable)&&one(db,'SELECT * FROM lc823_push_device WHERE endpoint=?',[s.endpoint]);
 // An endpoint is a browser capability, never transfer its ownership
 // between accounts. A switched browser must unsubscribe and subscribe anew.
 must(!old||old.account_id===a.accountId,409,'Подписка другого аккаунта. Отключите её в браузере и подключите заново');
 if(old?.state==='active'&&old.binding===config.binding&&old.credential_revision===a.credentialRevision&&old.p256dh===s.p256dh&&old.auth===s.auth)return publicDevice(old,a,config);
 db.run(schema);
 // Incompatible subscriptions are retired, never silently reused to replay.
 for(const d of rows(db,"SELECT * FROM lc823_push_device WHERE account_id=? AND state='active'",[a.accountId])){
  if(d.id===old?.id||d.binding!==config.binding||d.credential_revision!==a.credentialRevision||d.expiration_time!==null&&d.expiration_time<=Date.parse(a.at))retire(db,d,a.at);
 }
 must(one(db,"SELECT count(*) n FROM lc823_push_device WHERE account_id=? AND state='active'",[a.accountId]).n<MAX_DEVICES&&one(db,"SELECT count(*) n FROM lc823_push_device WHERE state='active'").n<MAX_GLOBAL,409,'Достигнут лимит устройств');
 const mark=pushNoticeWatermarks(db),id=old?.id??uuid();
 if(old){
  cancelDeviceJobs(db,id,a.at,'device_reconnected');
  db.run("UPDATE lc823_push_device SET credential_revision=?,binding=?,p256dh=?,auth=?,expiration_time=?,label=?,state='active',created_at=?,original_after=?,background_after=?,revoked_at=NULL WHERE id=?",[a.credentialRevision,config.binding,s.p256dh,s.auth,s.expiration_time,f.label.trim(),a.at,mark.original,mark.background,id]);
 }else db.run("INSERT INTO lc823_push_device VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,?,?,NULL,NULL)",[id,a.accountId,a.personId,a.credentialRevision,config.binding,s.endpoint,s.p256dh,s.auth,s.expiration_time,f.label.trim(),a.at,mark.original,mark.background]);
 a.audit('notification.push.register',id);return publicDevice(device(db,id),a,config);
}
export function revokePushDevice(db,a,config,f){
 requireUser(a);must(exact(f,['id'])&&isId(f.id),400,'Неверное устройство');
 const d=device(db,f.id);must(d&&d.account_id===a.accountId&&d.person_id===a.personId,404,'Устройство недоступно');
 if(d.state==='active'){retire(db,d,a.at);a.audit('notification.push.revoke',d.id)}
 return {id:d.id,revoked:true};
}
export function setPushPolicy(db,actor,clock,config,f,audit){
 must(exact(f,['expected_revision','enabled'])&&Number.isSafeInteger(f.expected_revision)&&f.expected_revision>=0&&typeof f.enabled==='boolean',400,'Неверные поля Web Push');
 const p=policy(db,config);
 must(p.rev===f.expected_revision,409,'Настройка изменилась');
 must(!f.enabled||config&&clock.configured,409,'Нужны настроенный HTTPS/VAPID и часовой пояс');
 db.run(schema);
 const binding=config?.binding??one(db,'SELECT binding FROM lc823_push_policy WHERE id=1')?.binding??'0'.repeat(64);
 db.run("INSERT INTO lc823_push_policy VALUES(1,?,?,?, ?,?) ON CONFLICT(id) DO UPDATE SET rev=excluded.rev,enabled=excluded.enabled,binding=excluded.binding,updated_at=excluded.updated_at,updated_by=excluded.updated_by",[p.rev+1,f.enabled?1:0,binding,clock.at,actor]);
 if(!f.enabled||!p.enabled){
  // No replay of earlier history after centrally toggling transport.
  const mark=pushNoticeWatermarks(db);
  db.run("UPDATE lc823_push_job SET state='cancelled',finished_at=?,last_code='transport_policy' WHERE state IN('pending','retry')",[clock.at]);
  db.run("UPDATE lc823_push_device SET original_after=?,background_after=? WHERE state='active' AND binding=?",[mark.original,mark.background,binding]);
 }
 audit('notification.push.policy',actor);return policy(db,config);
}
const category=n=>n.kind.startsWith('familiarization_')?'familiarization':n.kind==='training_due'?'training':n.pending?'approval':'information';
const actionable=n=>n.pending||['effective','withdrawn','publication_blocked','publication_cancelled','familiarization_confirmed','returned'].includes(n.kind);
function eligibleNotice(db,a,d,n,at){
 if(!n||!actionable(n)||!instant(n.occurred_at)||Date.parse(n.occurred_at)>Date.parse(at)||Date.parse(at)-Date.parse(n.occurred_at)>=MAX_AGE)return false;
 return notificationPreferences(db,a).push_types[category(n)]===true;
}
// An overnight window belongs to the day on which it starts. Return the
// remaining allowed seconds, capped at 300, so provider TTL cannot straddle
// the quiet-hour boundary. No inferred shift or client clock.
export function deliverySeconds(window,clock){
 if(!clock.configured)return 0;
 if(!window)return 300;
 const local=new Date(Date.parse(clock.at)+clock.offset_minutes*60000),day=local.getUTCDay()||7,prev=day===1?7:day-1;
 const mins=(v)=>Number(v.slice(0,2))*60+Number(v.slice(3)),start=mins(window.start),end=mins(window.end);
 const second=local.getUTCHours()*3600+local.getUTCMinutes()*60+local.getUTCSeconds()+local.getUTCMilliseconds()/1000,from=start*60,to=end*60;
 let remaining=0;
 if(start<end&&window.days.includes(day)&&second>=from&&second<to)remaining=to-second;
 if(start>end){if(window.days.includes(day)&&second>=from)remaining=86400+to-second;else if(window.days.includes(prev)&&second<to)remaining=to-second}
 return Math.min(300,Math.max(0,Math.floor(remaining)));
}
function accessDevice(db,d,clock,config,accessFor){
 if(!d||d.state!=='active'||d.binding!==config?.binding||d.expiration_time!==null&&d.expiration_time<=Date.parse(clock.at))return null;
 const a=accessFor(d.account_id);
 return a?.personId===d.person_id&&a.credentialRevision===d.credential_revision?a:null;
}
export function queuePushTest(db,a,config,f){
 requireUser(a);requireEnabled(db,config);must(a.clockConfigured,409,'Календарь предприятия не настроен');
 must(exact(f,['id'])&&isId(f.id),400,'Неверное устройство');
 const d=device(db,f.id);must(d?.account_id===a.accountId&&d.person_id===a.personId&&d.state==='active'&&d.binding===config.binding&&d.credential_revision===a.credentialRevision&&(d.expiration_time===null||d.expiration_time>Date.parse(a.at)),404,'Устройство недоступно');
 must(!d.last_test_at||Date.parse(a.at)-Date.parse(d.last_test_at)>=60000,429,'Проверку можно выполнять не чаще одного раза в минуту');
 const id=uuid();db.run("INSERT INTO lc823_push_job VALUES(?,?,NULL,'test',?,'test',?,?,?,'pending',0,NULL,NULL,NULL)",[id,d.id,'test:'+id,a.at,plus(a.at,900000),a.at]);
 db.run('UPDATE lc823_push_device SET last_test_at=? WHERE id=?',[a.at,d.id]);a.audit('notification.push.test',d.id);
 return {id,state:'pending',expires_at:plus(a.at,900000)};
}
export function pushAdminStatus(db,config){
 const p=policy(db,config),counts=Object.fromEntries(states.map(s=>[s,0]));
 if(exists(db,jobTable))for(const r of rows(db,'SELECT state,count(*) n FROM lc823_push_job GROUP BY state'))counts[r.state]=r.n;
 return {...p,counts,active_devices:exists(db,deviceTable)&&config?one(db,"SELECT count(*) n FROM lc823_push_device WHERE state='active' AND binding=?",[config.binding]).n:0,provider_acceptance_is_not_receipt:true};
}
function ready(db,clock){
 return exists(db,jobTable)?rows(db,"SELECT * FROM lc823_push_job WHERE state IN('pending','retry') AND next_attempt_at<=? AND NOT EXISTS(SELECT 1 FROM lc823_push_job s WHERE s.device_id=lc823_push_job.device_id AND s.state='sending') ORDER BY next_attempt_at,created_at,id LIMIT ?",[clock.at,MAX_JOBS]):[];
}
export function pushNeedsRecovery(db){return exists(db,jobTable)&&!!one(db,"SELECT id FROM lc823_push_job WHERE state='sending' LIMIT 1")}
export function recoverPush(db,clock){
 // A crash between provider accept and checkpoint commit is ambiguous.
 // Do not resend a claimed job. The inbox remains authoritative.
 if(exists(db,jobTable))db.run("UPDATE lc823_push_job SET state='uncertain',claim_id=NULL,finished_at=?,last_code='interrupted' WHERE state='sending'",[clock.at]);
}
export function discoverPush(db,clock,config,accessFor){
 if(!policy(db,config).enabled||!clock.configured||!exists(db,deviceTable))return [];
 const candidates=[];
 for(const d of rows(db,"SELECT * FROM lc823_push_device WHERE state='active' AND binding=? ORDER BY created_at,id",[config.binding])){
  const a=accessDevice(db,d,clock,config,accessFor);if(!a)continue;
  const known=new Set(rows(db,'SELECT dedup FROM lc823_push_job WHERE device_id=?',[d.id]).map(x=>x.dedup));
  for(const n of pushNoticeCandidates(db,a,d)){
   if(known.has(n.id)||!eligibleNotice(db,a,d,n,clock.at))continue;
   candidates.push({device_id:d.id,notice_id:n.id});
   if(candidates.length>=MAX_JOBS)return candidates;
  }
 }
 return candidates;
}
export function enqueuePush(db,clock,config,accessFor,candidates){
 if(!policy(db,config).enabled||!clock.configured)return 0;
 let count=0;const cache=new Map();
 for(const x of candidates.slice(0,MAX_JOBS)){
  const d=device(db,x.device_id),a=accessDevice(db,d,clock,config,accessFor);if(!a)continue;
  if(!cache.has(d.id))cache.set(d.id,pushNoticeCandidates(db,a,d));
  const n=cache.get(d.id).find(n=>n.id===x.notice_id);
  if(!eligibleNotice(db,a,d,n,clock.at)||one(db,'SELECT id FROM lc823_push_job WHERE device_id=? AND dedup=?',[d.id,n.id]))continue;
  db.run("INSERT INTO lc823_push_job VALUES(?,?,?,'notice',?,?,?,?,?,'pending',0,NULL,NULL,NULL)",[uuid(),d.id,n.id,n.id,category(n),clock.at,plus(n.occurred_at,MAX_AGE),clock.at]);count++;
 }
 return count;
}
function jobContext(db,clock,config,accessFor,j){
 if(j.expires_at<=clock.at)return {terminal:'expired',code:'ttl'};
 const d=device(db,j.device_id),a=accessDevice(db,d,clock,config,accessFor);
 if(!policy(db,config).enabled||!a)return {terminal:'cancelled',code:'access_or_policy'};
 if(j.kind==='notice'){
  const n=pushNoticeCandidates(db,a,d).find(n=>n.id===j.notice_id);
  if(!eligibleNotice(db,a,d,n,clock.at)||category(n)!==j.category)return {terminal:'cancelled',code:'notice_not_current'};
 }
 const ttl=Math.min(deliverySeconds(notificationPreferences(db,a).delivery_window,clock),Math.floor((Date.parse(j.expires_at)-Date.parse(clock.at))/1000));
 return ttl>=1?{d,a,ttl}:{wait:true};
}
export function pushReady(db,clock,config){
 return !!config&&exists(db,jobTable)&&ready(db,clock).length>0;
}
function endJob(db,j,at,state,code){
 db.run('UPDATE lc823_push_job SET state=?,finished_at=?,last_code=?,claim_id=NULL WHERE id=?',[state,at,code,j.id]);
}
// Claim at most one device group per transaction. Unavailable quiet-window
// jobs are deferred without consuming an attempt. A later recheck precedes
// the network call. No DB mutation is held open across network I/O.
export function claimPush(db,clock,config,accessFor){
 if(!exists(db,jobTable))return null;
 const candidates=ready(db,clock),chosen=[];let d=null,ttl=300;
 for(const j of candidates){
  const c=jobContext(db,clock,config,accessFor,j);
  if(c.terminal){endJob(db,j,clock.at,c.terminal,c.code);continue}
  if(c.wait){db.run("UPDATE lc823_push_job SET next_attempt_at=? WHERE id=?",[plus(clock.at,60000),j.id]);continue}
  if(d&&d.id!==c.d.id||chosen.length>=MAX_PER_SEND)continue;
  if(j.attempts>=4){endJob(db,j,clock.at,'failed','attempt_limit');continue}
  d=c.d;ttl=Math.min(ttl,c.ttl);chosen.push(j);
 }
 if(!chosen.length)return null;
 const id=uuid();
 for(const j of chosen)db.run("UPDATE lc823_push_job SET state='sending',claim_id=?,attempts=attempts+1 WHERE id=?",[id,j.id]);
 return {id,device_id:d.id,ttl};
}
export function recheckPush(db,clock,config,accessFor,claim){
 const jobs=rows(db,"SELECT * FROM lc823_push_job WHERE claim_id=? AND state='sending' ORDER BY created_at,id",[claim.id]);
 if(!jobs.length)return null;
 const contexts=jobs.map(j=>({j,c:jobContext(db,clock,config,accessFor,j)})),valid=contexts.filter(x=>x.c.d);
 // If anything changed, do not send stale claims. A fresh claim for the
 // still-valid jobs is created in the next pass without an extra attempt.
 if(valid.length!==jobs.length)return {changed:true};
 const newest=[...valid].reverse().find(x=>x.j.notice_id);
 return {device:valid[0].c.d,notice_id:newest?.j.notice_id??null,ttl:Math.min(...valid.map(x=>x.c.ttl))};
}
export function releaseChangedPush(db,clock,config,accessFor,claim){
 for(const j of rows(db,"SELECT * FROM lc823_push_job WHERE claim_id=? AND state='sending'",[claim.id])){
  const c=jobContext(db,clock,config,accessFor,j);
  if(c.terminal)endJob(db,j,clock.at,c.terminal,c.code);
  else db.run("UPDATE lc823_push_job SET state='pending',claim_id=NULL,attempts=attempts-1,next_attempt_at=?,last_code='rechecked' WHERE id=?",[plus(clock.at,c.wait?60000:0),j.id]);
 }
}
export function finishPush(db,clock,claim,result){
 const jobs=rows(db,"SELECT * FROM lc823_push_job WHERE claim_id=? AND state='sending'",[claim.id]),status=result?.status;
 const d=device(db,claim.device_id);
 if(d&&[404,410].includes(status))retire(db,d,clock.at,'expired','provider_gone');
 for(const j of jobs){
  if(Number.isInteger(status)&&status>=200&&status<300)endJob(db,j,clock.at,'accepted','provider_accepted');
  else if(!Number.isInteger(status))endJob(db,j,clock.at,'uncertain','network_outcome_unknown');
  else if([404,410].includes(status))endJob(db,j,clock.at,'cancelled','provider_gone');
  else if(status===429||status===503){
   const seconds=Math.max([60,300,900,900][j.attempts-1],Math.min(3600,result.retry_after??0));
   const next=plus(clock.at,seconds*1000);
   if(j.attempts>=4||next>=j.expires_at)endJob(db,j,clock.at,'failed','retry_limit');
   else db.run("UPDATE lc823_push_job SET state='retry',claim_id=NULL,next_attempt_at=?,last_code='provider_retry' WHERE id=?",[next,j.id]);
  }else endJob(db,j,clock.at,'failed','provider_rejected');
 }
 return jobs.length;
}
export function checkPushIntegrity(db){
 const ts=[deviceTable,jobTable,policyTable].filter(t=>exists(db,t));if(!ts.length)return;
 must(ts.length===3,503,'Неполная схема Web Push');
 const p=one(db,'SELECT * FROM lc823_push_policy WHERE id=1');
 must(!p||hex(p.binding)&&instant(p.updated_at),503,'Повреждена политика Web Push');
 for(const d of rows(db,'SELECT d.*,a.person_id owner FROM lc823_push_device d JOIN lc81_account a ON a.id=d.account_id')){
  let valid=false;try{validatePushSubscription({endpoint:d.endpoint,expirationTime:d.expiration_time,keys:{p256dh:d.p256dh,auth:d.auth}});valid=true}catch{}
  must(valid&&d.owner===d.person_id&&isId(d.id)&&hex(d.binding)&&instant(d.created_at)&&(!d.revoked_at||instant(d.revoked_at))&&(!d.last_test_at||instant(d.last_test_at))&&Number.isSafeInteger(d.original_after)&&d.original_after>=0&&Number.isSafeInteger(d.background_after)&&d.background_after>=0&&typeof d.label==='string'&&d.label.length<=80,503,'Повреждено устройство Web Push');
 }
 for(const j of rows(db,'SELECT * FROM lc823_push_job')){
  const d=device(db,j.device_id);must(d,503,'Нет устройства для доставки');
  if(j.kind==='notice'){
   const n=exists(db,'lc83_sop_notice')&&one(db,'SELECT recipient_account_id account_id FROM lc83_sop_notice WHERE id=?',[j.notice_id]),b=exists(db,'lc822_notification_job')&&one(db,"SELECT account_id FROM lc822_notification_job WHERE id=? AND state='completed' AND kind<>'familiarization_catchup'",[j.notice_id]);
   must((n||b)?.account_id===d.account_id,503,'Неверный получатель доставки');
  }
  must(isId(j.id)&&instant(j.created_at)&&instant(j.expires_at)&&j.expires_at>j.created_at&&instant(j.next_attempt_at)&&(!j.finished_at||instant(j.finished_at))&&(!j.claim_id||isId(j.claim_id))&&(j.kind==='test'?j.category==='test'&&j.dedup==='test:'+j.id:isId(j.notice_id)&&j.dedup===j.notice_id&&['approval','training','familiarization','information'].includes(j.category)),503,'Повреждено задание Web Push');
 }
}
