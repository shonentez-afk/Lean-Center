// LC8.3.4: personal acknowledgement of a published, hash-bound SOP.
// Neither reading nor acknowledging a document is training, qualification or admission.
import {one,rows,isId,uuid,canonical} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {personWorkResource,programResource} from './read-policy.mjs';
import {recordAccess} from './center-commands.mjs';

const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const tables=['lc83_sop_familiarization_batch','lc83_sop_familiarization','lc83_sop_familiarization_deadline'];
const exists=(db,t=tables[0])=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[t]);
const schema=[
 "CREATE TABLE IF NOT EXISTS lc83_sop_familiarization_batch(round_id TEXT PRIMARY KEY REFERENCES lc83_sop_round(id),plan_id TEXT NOT NULL UNIQUE REFERENCES lc83_sop_impact_plan(id),source_sha TEXT NOT NULL,registered_at TEXT NOT NULL);",
 "CREATE TABLE IF NOT EXISTS lc83_sop_familiarization(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES lc83_sop_familiarization_batch(round_id),person_id TEXT NOT NULL REFERENCES person(id),employment_id TEXT NOT NULL REFERENCES person_assignment(id),unit_id TEXT NOT NULL REFERENCES org_unit(id),person_name TEXT NOT NULL,rev INTEGER NOT NULL CHECK(rev>0),confirmed_at TEXT,confirmed_account TEXT REFERENCES lc81_account(id),CHECK((confirmed_at IS NULL)=(confirmed_account IS NULL)),UNIQUE(round_id,person_id));",
 "CREATE INDEX IF NOT EXISTS lc83_familiarization_person ON lc83_sop_familiarization(person_id,round_id);",
 "CREATE TABLE IF NOT EXISTS lc83_sop_familiarization_deadline(id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL REFERENCES lc83_sop_familiarization(id),rev INTEGER NOT NULL CHECK(rev>1),due_on TEXT NOT NULL,note TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES lc81_account(id),recorded_at TEXT NOT NULL,UNIQUE(receipt_id,rev));"
].join('\n');

// Optional additive schema. Existing LC8.3.4 checkpoints remain readable.
const extensionSchema="CREATE TABLE IF NOT EXISTS lc834_sop_scope_change(id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL REFERENCES lc83_sop_familiarization(id),rev INTEGER NOT NULL CHECK(rev>0),employment_id TEXT NOT NULL REFERENCES person_assignment(id),unit_id TEXT NOT NULL REFERENCES org_unit(id),skill_id TEXT REFERENCES skill(id),account_id TEXT NOT NULL REFERENCES lc81_account(id),reason TEXT NOT NULL,recorded_at TEXT NOT NULL,recorded_on TEXT NOT NULL,UNIQUE(receipt_id,rev));"+
 "CREATE TABLE IF NOT EXISTS lc834_sop_training_link(assignment_id TEXT PRIMARY KEY REFERENCES training_assignment(id),receipt_id TEXT NOT NULL REFERENCES lc83_sop_familiarization(id),skill_id TEXT NOT NULL REFERENCES skill(id),prior_id TEXT REFERENCES training_assignment(id),created_account TEXT NOT NULL REFERENCES lc81_account(id),created_at TEXT NOT NULL);";
const amendments=(db,id)=>exists(db,'lc834_sop_scope_change')?rows(db,'SELECT * FROM lc834_sop_scope_change WHERE receipt_id=? ORDER BY rev',[id]):[];
function liveScope(db,x){const list=amendments(db,x.id),last=list.at(-1);return {employment_id:last?.employment_id??x.employment_id,unit_id:last?.unit_id??x.unit_id,changes:list,assigned_at:list[0]?.rev===1?list[0].recorded_at:x.registered_at}}
const employee=(db,id,day)=>{const a=rows(db,"SELECT a.id,a.unit_id FROM person_assignment a JOIN person p ON p.id=a.person_id WHERE p.id=? AND p.archived=0 AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=?",[id,day,day]);return a.length===1?a[0]:null};
function roster(plan){
 const map=new Map();
 for(const x of JSON.parse(plan.scope_json)){
  const prior=map.get(x.person_id);
  if(prior)must(prior.employment_id===x.employment_id&&prior.unit_id===x.unit_id,503,'Неоднозначный состав ознакомления');
  else map.set(x.person_id,{person_id:x.person_id,employment_id:x.employment_id,unit_id:x.unit_id,person_name:x.person});
 }
 return [...map.values()].sort((a,b)=>a.person_id.localeCompare(b.person_id));
}
function notice(db,round,event,account,kind,at){
 if(account)db.run('INSERT INTO lc83_sop_notice VALUES(?,?,?,?,?,?)',[uuid(),round,event,account,kind,at]);
}
// Called only within the existing publication transaction, for BOTH manual and
// scheduled activation. Empty rosters are recorded; legacy releases are not backfilled.
export function registerSopFamiliarization(db,a,rr,planId){
 const p=one(db,'SELECT * FROM lc83_sop_impact_plan WHERE id=? AND round_id=?',[planId,rr.id]),b=JSON.parse(rr.binding_json);
 must(p?.activated_at===a.at&&p.binding_sha===rr.binding_sha256,503,'Не подтверждена оценка влияния для ознакомления');
 db.run(schema);
 db.run('INSERT INTO lc83_sop_familiarization_batch VALUES(?,?,?,?)',[rr.id,p.id,b.source.sha256,a.at]);
 for(const x of roster(p)){
  const id=uuid();
  db.run('INSERT INTO lc83_sop_familiarization VALUES(?,?,?,?,?,?,1,NULL,NULL)',[id,rr.id,x.person_id,x.employment_id,x.unit_id,x.person_name]);
  notice(db,rr.id,id,a.accountFor(x.person_id),'familiarization_required',a.at);
 }
}

const selectSQL="SELECT f.*,b.plan_id,b.source_sha,b.registered_at,r.revision_id,r.binding_json,r.binding_sha256,r.state round_state,d.operation_id,d.archived document_archived,o.unit_id operation_unit,o.archived operation_archived,v.state document_state,p.decision FROM lc83_sop_familiarization f JOIN lc83_sop_familiarization_batch b ON b.round_id=f.round_id JOIN lc83_sop_round r ON r.id=f.round_id JOIN lc83_sop_impact_plan p ON p.id=b.plan_id JOIN document_revision v ON v.id=r.revision_id JOIN document d ON d.id=v.document_id JOIN operation o ON o.id=d.operation_id";
const current=x=>x.round_state==='effective'&&x.document_state==='effective'&&!x.document_archived&&!x.operation_archived;
const find=(db,id)=>exists(db)&&isId(id)?one(db,selectSQL+' WHERE f.id=?',[id]):null;
const lastDeadline=(db,id)=>one(db,'SELECT * FROM lc83_sop_familiarization_deadline WHERE receipt_id=? ORDER BY rev DESC LIMIT 1',[id]);
function scopeFor(db,x){
 const base=JSON.parse(one(db,'SELECT scope_json FROM lc83_sop_impact_plan WHERE id=?',[x.plan_id]).scope_json).filter(s=>s.person_id===x.person_id);
 for(const c of amendments(db,x.id))if(c.skill_id&&!base.some(s=>s.skill_id===c.skill_id))base.push({person_id:x.person_id,skill_id:c.skill_id,basis:[{kind:'explicit_scope',id:c.id}]});
 return base;
}
const responsible=t=>!!t?.personId&&t.permissions.includes('training.approve_responsible');
const manager=(db,a)=>{const t=a.personId?a.impactActor(a.accountId):null;return t?.personId&&(responsible(t)||t.permissions.includes('training.approve_head'))?t:null};
const unitScope=(units)=>({data:{},self:null,units:[...new Set(units.filter(Boolean))],assigned:[]});
function managerResource(db,t,x){
 const scope=liveScope(db,x),e=employee(db,x.person_id,t.day);
 // Require the operation and both the recorded and present personnel areas.
 return unitScope([x.operation_unit,x.unit_id,scope.unit_id,e?.unit_id]);
}
const managerRead=(t,x)=>!!t&&!!t.read('sop.read_history',x.revision_id)&&!!t.read('person.read_basic',x.person_id);
const canManage=(db,t,x)=>managerRead(t,x)&&['training.approve_responsible','training.approve_head'].some(k=>t.scope(k,x.operation_id,managerResource(db,t,x)));
const canWrite=(db,t,x)=>managerRead(t,x)&&responsible(t)&&t.scope('training.approve_responsible',x.operation_id,managerResource(db,t,x));
function stateFor(db,a,x){
 return x.confirmed_at?'confirmed':!current(x)?'obsolete':a.employmentFor(x.person_id)!==liveScope(db,x).employment_id?'scope_changed':'pending';
}
const stateLabels={confirmed:'Ознакомлен',pending:'Ожидает ознакомления',obsolete:'Редакция больше не действует',scope_changed:'Изменилось назначение сотрудника'};
const trainingLabels={planned:'Назначено',in_progress:'В работе',completed:'Назначение завершено',needs:'Требуется назначить / проверить',clarify:'Уточнить навык',restricted:'Данные обучения недоступны'};
function skillsFor(db,x){
 const scope=scopeFor(db,x).filter(s=>s.skill_id);
 return scope.filter((s,i)=>scope.findIndex(v=>v.skill_id===s.skill_id)===i);
}
function trainingRows(db,t,x,active){
 if(x.decision==='editorial')return [];
 const resource=managerResource(db,t,x);
 if(!['training.read','training.detail'].every(k=>t.scope(k,x.operation_id,resource)))return [{skill:'Данные обучения',state:'restricted',label:trainingLabels.restricted}];
 const skills=skillsFor(db,x);
 if(!skills.length)return [{skill:'Навык не определён по имеющимся фактам',state:'clarify',label:trainingLabels.clarify}];
 return skills.map(s=>{
  const skill=t.read('skill.read',s.skill_id)?.data;
  if(!skill)return {skill:'Недоступный навык',state:'restricted',label:trainingLabels.restricted};
  const item={skill:skill.name,skill_id:s.skill_id};
  const next=one(db,"SELECT id,state FROM training_assignment WHERE trainee_id=? AND skill_id=? AND sop_revision_id=? AND state<>'cancelled' AND source_sha256=? ORDER BY assigned_on DESC,id DESC LIMIT 1",[x.person_id,s.skill_id,x.revision_id,x.source_sha]);
  if(next){
   if(!recordAccess(db,t,'training',next.id))return {...item,state:'restricted',label:trainingLabels.restricted};
   const linked=exists(db,'lc834_sop_training_link')&&one(db,'SELECT receipt_id FROM lc834_sop_training_link WHERE assignment_id=?',[next.id])?.receipt_id===x.id;
   return {...item,state:next.state,label:trainingLabels[next.state]||next.state,assignment_id:next.id,linked:!!linked};
  }
  const resource=personWorkResource(db,[x.person_id],t.day,[],[x.operation_id]);
  const allowed=active&&canWrite(db,t,x)&&resource&&t.read('sop.read_effective',x.revision_id)&&t.scope('training.create',x.operation_id,resource)&&t.scope('training.read',x.operation_id,resource);
  let create=null;
  if(allowed){
   // Use real historical assignments if available. Otherwise the responsible
   // person explicitly selects the scale, target, instructor and dates.
   const old=s.basis.filter(b=>b.kind==='training').map(b=>one(db,"SELECT a.* FROM training_assignment a JOIN document_revision v ON v.id=a.sop_revision_id JOIN document_revision n ON n.id=? WHERE a.id=? AND v.document_id=n.document_id AND v.id<>n.id AND a.trainee_id=? AND a.skill_id=? AND a.state<>'cancelled'",[x.revision_id,b.id,x.person_id,s.skill_id])).filter(v=>v&&recordAccess(db,t,'training',v.id)&&t.read('sop.read_history',v.sop_revision_id)).sort((a,b)=>b.assigned_on.localeCompare(a.assigned_on)||b.id.localeCompare(a.id))[0];
   create={familiarization_id:x.id,operation_id:x.operation_id,trainee_id:x.person_id,revision_id:x.revision_id,skill_id:s.skill_id,scale_id:old?.scale_id??null,target_level:old?.target_level??null,reason:'Ввод новой редакции СОП · '+JSON.parse(x.binding_json).code,...(old?{retraining_source_id:old.id}:{})};
  }
  return {...item,state:'needs',label:trainingLabels.needs,create};
 });
}
function itemFor(db,a,t,x,training){
 const own=x.person_id===a.personId,managed=canManage(db,t,x),active=current(x),state=stateFor(db,a,x),deadline=lastDeadline(db,x.id),b=JSON.parse(x.binding_json),scope=liveScope(db,x);
 const overdue=state==='pending'&&!!deadline&&deadline.due_on<a.day;
 const allowedTraining=active&&a.employmentFor(x.person_id)===scope.employment_id;
 return {id:x.id,rev:x.rev,revision_id:x.revision_id,round_id:x.round_id,source_sha256:x.source_sha,person_id:x.person_id,person:x.person_name,unit_id:scope.unit_id,code:b.code,title:b.title,version_no:b.version_no,decision:x.decision,state,state_label:stateLabels[state],current:active,assigned_on:scope.assigned_at.slice(0,10),confirmed_at:x.confirmed_at,due_on:deadline?.due_on??null,overdue,scope_history:managed?scope.changes.map(c=>({date:c.recorded_on,reason:c.reason,skill:c.skill_id?t.read('skill.read',c.skill_id)?.data.name??null:null})):[],
 can_ack:own&&state==='pending'&&a.effective(x.revision_id),can_due:canWrite(db,t,x)&&state==='pending',can_open:!!(a.effective(x.revision_id)||a.history(x.revision_id)),training:training&&managed?trainingRows(db,t,x,allowedTraining):null};
}
// Read the original recipient event; don't make a second business record.
export function familiarizationNoticeView(db,a,n){
 if(!a.personId||n.recipient_account_id!==a.accountId||!exists(db))return null;
 let x=null;
 if(['familiarization_required','familiarization_confirmed'].includes(n.kind))x=find(db,n.event_key);
 if(!x&&n.kind==='familiarization_deadline'){const d=one(db,'SELECT receipt_id FROM lc83_sop_familiarization_deadline WHERE id=?',[n.event_key]);if(d)x=find(db,d.receipt_id)}
 if(!x&&['familiarization_required','familiarization_scope_changed'].includes(n.kind)&&exists(db,'lc834_sop_scope_change')){
  const c=one(db,'SELECT receipt_id FROM lc834_sop_scope_change WHERE id=?',[n.event_key]);if(c)x=find(db,c.receipt_id);
 }
 if(!x||x.round_id!==n.round_id||x.document_archived||x.operation_archived)return null;
 const t=manager(db,a),own=x.person_id===a.personId,managed=canManage(db,t,x);
 if(n.kind==='familiarization_confirmed'?!managed:!own)return null;
 const v=itemFor(db,a,t,x,false);
 // Don't disclose a restricted or transferred recipient's former instruction.
 if(!v.can_open||own&&v.state==='scope_changed')return null;
 const label={familiarization_required:'Требуется ознакомление с СОП',familiarization_deadline:'Установлен срок ознакомления',familiarization_scope_changed:'Уточнено назначение ознакомления',familiarization_confirmed:'Сотрудник ознакомился с СОП'}[n.kind];
 if(!label)return null;
 const pending=own&&v.can_ack&&n.kind!=='familiarization_confirmed';
 return {label,title:v.code+' · v'+v.version_no+' · '+v.title,reason:own?'Вам назначено персональное ознакомление':'Вы отвечаете за оценку влияния',due_on:v.due_on,pending,overdue:pending&&v.overdue,state:v.state_label,route:{type:'familiarization',id:v.revision_id,person_id:v.person_id}};
}
export function hasOwnFamiliarization(db,a){
 return !!a.personId&&exists(db)&&rows(db,selectSQL+" WHERE f.person_id=? AND r.state='effective' AND v.state='effective' AND d.archived=0 AND o.archived=0 AND f.confirmed_at IS NULL",[a.personId]).some(x=>stateFor(db,a,x)==='pending'&&a.effective(x.revision_id));
}
export function familiarizationList(db,a,{kind='mine',revision_id=null,person_id=null,offset=0}={},includeTraining=true){
 must(a.personId&&['mine','managed','visible'].includes(kind)&&(revision_id===null||isId(revision_id))&&(person_id===null||isId(person_id))&&Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000,400,'Неверный фильтр ознакомления');
 const t=manager(db,a),result={items:[],total:0,offset,limit:50,day:a.day,can_manage:!!t,registered:false,can_scope:false};
 if(!exists(db)||kind==='managed'&&!t)return result;
 const cond=[],args=[];
 if(revision_id!==null){cond.push('r.revision_id=?');args.push(revision_id)}
 if(person_id!==null){cond.push('f.person_id=?');args.push(person_id)}
 if(kind==='mine'||!t){cond.push('f.person_id=?');args.push(a.personId)}
 const matched=rows(db,selectSQL+(cond.length?' WHERE '+cond.join(' AND '):'')+' ORDER BY b.registered_at DESC,f.person_name,f.id',args).filter(x=>kind==='managed'?canManage(db,t,x):x.person_id===a.personId||canManage(db,t,x));
 // A zero-person batch is visible only with the same responsible scope.
 if(revision_id&&t?.read('sop.read_history',revision_id)){
  const v=one(db,'SELECT o.id operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=?',[revision_id]);
  if(v&&['training.approve_responsible','training.approve_head'].some(k=>t.scope(k,v.operation_id,unitScope([v.unit_id]))))result.registered=!!one(db,'SELECT b.round_id FROM lc83_sop_familiarization_batch b JOIN lc83_sop_round r ON r.id=b.round_id WHERE r.revision_id=?',[revision_id]);
  result.can_scope=!!scopeAnchor(db,t,revision_id);
 }
 result.total=matched.length;result.registered=result.registered||matched.length>0;
 result.items=matched.slice(offset,offset+50).map(x=>itemFor(db,a,t,x,includeTraining));
 return result;
}
export function prepareFamiliarizationAck(db,a,f){
 must(exact(f,['id','expected_revision','source_sha256','confirmed'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&typeof f.source_sha256==='string'&&/^[a-f0-9]{64}$/.test(f.source_sha256)&&f.confirmed===true,400,'Подтвердите личное ознакомление');
 const x=find(db,f.id);
 must(x&&a.personId===x.person_id&&a.effective(x.revision_id),404,'Ознакомление недоступно');
 must(stateFor(db,a,x)==='pending'&&x.rev===f.expected_revision&&x.source_sha===f.source_sha256,409,'Ознакомление или редакция изменились');
 return {id:x.id,binding:JSON.parse(x.binding_json),sha:x.binding_sha256,rev:x.rev};
}
export function confirmFamiliarization(db,a,f,checked){
 const c=prepareFamiliarizationAck(db,a,f);
 must(c.sha===checked.sha&&c.rev===checked.rev&&canonical(c.binding)===canonical(checked.binding),409,'Редакция изменилась');
 const x=find(db,c.id);
 db.run('UPDATE lc83_sop_familiarization SET confirmed_at=?,confirmed_account=?,rev=rev+1 WHERE id=?',[a.at,a.accountId,c.id]);
 a.audit('sop.familiarization.confirm',c.id);
 const p=one(db,'SELECT reviewer_person FROM lc83_sop_impact_plan WHERE id=?',[x.plan_id]);
 notice(db,x.round_id,c.id,a.accountFor(p.reviewer_person),'familiarization_confirmed',a.at);
 return {id:c.id,rev:c.rev+1,state:'confirmed',confirmed_at:a.at};
}
export function setFamiliarizationDeadline(db,a,f){
 must(exact(f,['id','expected_revision','due_on','note'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&date(f.due_on)&&f.due_on>=a.day&&typeof f.note==='string'&&f.note.trim().length>0&&f.note.length<=1200,400,'Укажите срок и основание ознакомления');
 const x=find(db,f.id),t=manager(db,a);
 must(x&&canWrite(db,t,x),404,'Ознакомление недоступно');
 must(x.rev===f.expected_revision&&stateFor(db,a,x)==='pending',409,'Ознакомление или редакция изменились');
 const id=uuid();
 db.run('INSERT INTO lc83_sop_familiarization_deadline VALUES(?,?,?,?,?,?,?)',[id,x.id,x.rev+1,f.due_on,f.note.trim(),a.accountId,a.at]);
 db.run('UPDATE lc83_sop_familiarization SET rev=rev+1 WHERE id=?',[x.id]);
 a.audit('sop.familiarization.deadline',id);
 notice(db,x.round_id,id,a.accountFor(x.person_id),'familiarization_deadline',a.at);
 return {id:x.id,rev:x.rev+1,due_on:f.due_on};
}
// No new training domain, approval, qualification, or admission. The ordinary
// createTraining path checks source, permissions, instructor, dates and method.
function scopeAnchor(db,t,id){
 if(!exists(db)||!responsible(t)||!isId(id)||!t.read('sop.read_history',id)||!t.read('sop.read_effective',id))return null;
 const x=one(db,"SELECT b.round_id,d.operation_id,o.unit_id operation_unit,p.decision FROM lc83_sop_familiarization_batch b JOIN lc83_sop_round r ON r.id=b.round_id JOIN document_revision v ON v.id=r.revision_id JOIN document d ON d.id=v.document_id JOIN operation o ON o.id=d.operation_id JOIN lc83_sop_impact_plan p ON p.id=b.plan_id WHERE r.revision_id=? AND r.state='effective' AND v.state='effective' AND d.archived=0 AND o.archived=0",[id]);
 return x&&t.scope('training.approve_responsible',x.operation_id,unitScope([x.operation_unit]))?x:null;
}
function scopeTarget(db,t,c,id){
 const e=employee(db,id,t.day),p=e&&t.read('person.read_basic',id)?.data;
 if(!p||!t.scope('training.approve_responsible',c.operation_id,unitScope([c.operation_unit,e.unit_id])))return null;
 const prior=one(db,'SELECT id FROM lc83_sop_familiarization WHERE round_id=? AND person_id=?',[c.round_id,id]),x=prior&&find(db,prior.id);
 if(x&&!canWrite(db,t,x))return null;
 return {p,e,x};
}
export function familiarizationScopeOptions(db,a,id){
 const t=manager(db,a),c=scopeAnchor(db,t,id);must(c,404,'Уточнение состава недоступно');
 const people=directoryPeople(db,t.day).flatMap(p=>{const x=scopeTarget(db,t,c,p.id);return x?[{id:p.id,name:p.display_name,unit:p.unit,rev:x.x?.rev??0,registered:!!x.x}]:[]});
 const skills=c.decision==='editorial'?[]:rows(db,'SELECT id,name FROM skill WHERE operation_id=? AND archived=0 ORDER BY name,id',[c.operation_id]).filter(x=>t.read('skill.read',x.id));
 return {revision_id:id,people,skills};
}
export function changeFamiliarizationScope(db,a,f){
 must(exact(f,['revision_id','person_id','expected_revision','skill_id','reason'])&&isId(f.revision_id)&&isId(f.person_id)&&Number.isSafeInteger(f.expected_revision)&&f.expected_revision>=0&&(f.skill_id===null||isId(f.skill_id))&&typeof f.reason==='string'&&f.reason.trim().length>0&&f.reason.length<=1200,400,'Укажите сотрудника и причину уточнения состава');
 const t=manager(db,a),c=scopeAnchor(db,t,f.revision_id);must(c,404,'Уточнение состава недоступно');
 const q=scopeTarget(db,t,c,f.person_id);must(q,404,'Сотрудник недоступен в вашей области');
 const {x,e,p}=q;must((x?.rev??0)===f.expected_revision,409,'Состав или ознакомление изменились');
 if(f.skill_id)must(c.decision!=='editorial'&&t.read('skill.read',f.skill_id)&&one(db,'SELECT id FROM skill WHERE id=? AND operation_id=? AND archived=0',[f.skill_id,c.operation_id]),422,'Навык не относится к операции');
 const changedEmployment=!!x&&liveScope(db,x).employment_id!==e.id,newSkill=!!f.skill_id&&(!x||!skillsFor(db,x).some(v=>v.skill_id===f.skill_id));
 must(!x||changedEmployment||newSkill,409,'Сотрудник уже включён в состав; нет нового основания');
 db.run(extensionSchema);
 const id=x?.id??uuid(),rev=(x?.rev??0)+1,event=uuid();
 if(!x)db.run('INSERT INTO lc83_sop_familiarization VALUES(?,?,?,?,?,?,1,NULL,NULL)',[id,c.round_id,f.person_id,e.id,e.unit_id,p.display_name]);
 else db.run('UPDATE lc83_sop_familiarization SET rev=? WHERE id=?',[rev,id]);
 db.run('INSERT INTO lc834_sop_scope_change VALUES(?,?,?,?,?,?,?,?,?,?)',[event,id,rev,e.id,e.unit_id,newSkill?f.skill_id:null,a.accountId,f.reason.trim(),a.at,a.day]);
 a.audit('sop.familiarization.scope',event);
 notice(db,c.round_id,event,a.accountFor(f.person_id),x?'familiarization_scope_changed':'familiarization_required',a.at);
 return {id,rev,added:!x};
}
// Explicit link for new assignments only; earlier valid assignments remain
// discoverable by matching evidence and are not rewritten retroactively.
export function linkFamiliarizationTraining(db,t,f,id){
 const x=find(db,f.familiarization_id),v=one(db,'SELECT * FROM training_assignment WHERE id=?',[id]);
 must(x&&v&&v.trainee_id===x.person_id&&v.sop_revision_id===x.revision_id&&v.source_sha256===x.source_sha&&v.skill_id===f.skill_id,503,'Назначение не соответствует ознакомлению');
 db.run(extensionSchema);
 db.run('INSERT INTO lc834_sop_training_link VALUES(?,?,?,?,?,?)',[id,x.id,f.skill_id,f.retraining_source_id??null,t.accountId,t.at]);
 t.audit('sop.familiarization.training_link',id);
}
export function assertFamiliarizationTraining(db,t,f){
 const x=find(db,f.familiarization_id);
 must(x&&canWrite(db,t,x)&&current(x)&&x.decision!=='editorial'&&x.person_id===f.trainee_id&&x.revision_id===f.revision_id&&x.operation_id===f.operation_id,404,'Основание адресного обучения недоступно');
 const em=employee(db,x.person_id,t.day);
 must(em?.id===liveScope(db,x).employment_id,409,'Состав затронутых сотрудников изменился');
 const skill=skillsFor(db,x).find(s=>s.skill_id===f.skill_id);
 must(skill&&(!Object.hasOwn(f,'retraining_source_id')||skill.basis.some(b=>b.kind==='training'&&b.id===f.retraining_source_id))&&f.scenario==='changed_operation',422,'Навык или основание не соответствуют оценке влияния');
 must(!one(db,"SELECT id FROM training_assignment WHERE trainee_id=? AND skill_id=? AND sop_revision_id=? AND state<>'cancelled'",[x.person_id,f.skill_id,x.revision_id]),409,'Адресное обучение по этой редакции уже назначено');
}
export function checkFamiliarizationIntegrity(db){
 const present=tables.filter(t=>exists(db,t));
 if(!present.length){must(!exists(db,'lc834_sop_scope_change')&&!exists(db,'lc834_sop_training_link'),503,'Уточнения без реестра ознакомлений');return}
 must(present.length===tables.length,503,'Неполная схема ознакомлений СОП');
 for(const b of rows(db,'SELECT * FROM lc83_sop_familiarization_batch')){
  const p=one(db,'SELECT * FROM lc83_sop_impact_plan WHERE id=?',[b.plan_id]),r=one(db,'SELECT * FROM lc83_sop_round WHERE id=?',[b.round_id]);
  must(p?.round_id===b.round_id&&p.activated_at===b.registered_at&&r&&['effective','withdrawn'].includes(r.state)&&p.binding_sha===r.binding_sha256&&JSON.parse(r.binding_json).source.sha256===b.source_sha,503,'Ознакомление не соответствует введённой редакции');
  const actual=rows(db,'SELECT * FROM lc83_sop_familiarization WHERE round_id=? ORDER BY person_id',[b.round_id]),expected=roster(p),base=actual.filter(x=>amendments(db,x.id)[0]?.rev!==1);
  must(base.length===expected.length&&canonical(base.map(x=>({person_id:x.person_id,employment_id:x.employment_id,unit_id:x.unit_id,person_name:x.person_name})))===canonical(expected),503,'Состав ознакомления не соответствует зафиксированной оценке');
  for(const x of actual){
   const employment=one(db,'SELECT person_id FROM person_assignment WHERE id=?',[x.employment_id]),actor=x.confirmed_account&&one(db,'SELECT person_id FROM lc81_account WHERE id=?',[x.confirmed_account]);
   const deadlines=rows(db,'SELECT * FROM lc83_sop_familiarization_deadline WHERE receipt_id=? ORDER BY rev',[x.id]),changes=amendments(db,x.id),first=changes[0]?.rev===1?changes[0]:null;
   const start=first?.recorded_at??b.registered_at,events=[...deadlines,...changes.filter(c=>c.rev>1)].sort((a,b)=>a.rev-b.rev),revs=new Set(events.map(c=>c.rev));
   const missing=[];for(let i=2;i<=x.rev;i++)if(!revs.has(i))missing.push(i);
   const ackRev=missing[0];
   must(employment?.person_id===x.person_id&&(!first||first.employment_id===x.employment_id&&first.unit_id===x.unit_id)&&(!x.confirmed_at||actor?.person_id===x.person_id&&x.confirmed_at>=start)&&x.rev===1+events.length+(x.confirmed_at?1:0)&&revs.size===events.length&&missing.length===(x.confirmed_at?1:0)&&events.every((e,i)=>e.rev>1&&e.rev<=x.rev&&e.recorded_at>=start&&(!i||e.recorded_at>=events[i-1].recorded_at)&&(!x.confirmed_at||(e.rev<ackRev?e.recorded_at<=x.confirmed_at:e.recorded_at>=x.confirmed_at)))&&deadlines.every(d=>date(d.due_on)&&d.note.trim()&&(!x.confirmed_at||d.rev<ackRev)),503,'Нарушена история ознакомления');
   for(const c of changes){
    const emp=one(db,'SELECT person_id,unit_id,valid_from,valid_to FROM person_assignment WHERE id=?',[c.employment_id]),actor=one(db,'SELECT person_id FROM lc81_account WHERE id=?',[c.account_id]);
    must(emp?.person_id===x.person_id&&emp.unit_id===c.unit_id&&actor?.person_id&&date(c.recorded_on)&&c.recorded_at>=b.registered_at&&c.reason.trim()&&(!c.skill_id||p.decision!=='editorial'&&one(db,'SELECT id FROM skill WHERE id=? AND operation_id=?',[c.skill_id,JSON.parse(r.binding_json).operation_id])),503,'Нарушено основание уточнения состава');
   }
  }
 }
 const extensions=['lc834_sop_scope_change','lc834_sop_training_link'].filter(t=>exists(db,t));
 must(!extensions.length||extensions.length===2,503,'Неполная схема уточнения состава');
 if(extensions.length)for(const l of rows(db,'SELECT * FROM lc834_sop_training_link')){
  const x=find(db,l.receipt_id),v=one(db,'SELECT * FROM training_assignment WHERE id=?',[l.assignment_id]),p=l.prior_id&&one(db,'SELECT * FROM training_assignment WHERE id=?',[l.prior_id]),actor=one(db,'SELECT person_id FROM lc81_account WHERE id=?',[l.created_account]);
  must(x&&v&&v.trainee_id===x.person_id&&v.sop_revision_id===x.revision_id&&v.source_sha256===x.source_sha&&v.skill_id===l.skill_id&&actor?.person_id&&skillsFor(db,x).some(s=>s.skill_id===l.skill_id)&&l.created_at>=liveScope(db,x).assigned_at&&(!l.prior_id||p?.trainee_id===v.trainee_id&&p.skill_id===v.skill_id&&p.sop_revision_id!==v.sop_revision_id),503,'Нарушена целостность связи адресного обучения');
 }
}

export function familiarizationCalendar(db,a,t,{mode,from,to,person_id=null},personal){
 if(!a.personId||!exists(db))return [];
 const managed=manager(db,a),items=[];
 for(const x of rows(db,selectSQL+" WHERE r.state='effective' AND v.state='effective' AND d.archived=0 AND o.archived=0 ORDER BY f.id")){
  if(person_id&&x.person_id!==person_id)continue;
  if(personal){if(x.person_id!==a.personId)continue}
  else if(x.person_id===a.personId&&t.scope('calendar.read',x.person_id,{...managerResource(db,t,x),self:x.person_id})){} 
  else if(!canManage(db,managed,x)||!t.scope('calendar.read',x.operation_id,managerResource(db,t,x)))continue;
  const v=itemFor(db,a,managed,x,false),pending=['pending','scope_changed'].includes(v.state),date=v.due_on||(!pending?v.confirmed_at?.slice(0,10):null);
  if(!date&&(!pending||mode!=='plan')||date&&(date>to||date<from&&!(mode==='plan'&&pending)))continue;
  items.push({key:'familiarization:'+v.id,date:date??null,type:'Ознакомление с СОП',title:v.code+' · v'+v.version_no+' · '+v.title,owner:v.person,state:v.state_label,pending,overdue:v.overdue,route:{type:'familiarization',id:v.revision_id,person_id:v.person_id}});
 }
 return items;
}

const metricDefs=[
 ['lc83_familiarization_coverage','Ознакомление с действующими редакциями','Подтверждённые ознакомления / все зарегистрированные персональные ознакомления с действующими редакциями.',true,x=>x.state==='confirmed'],
 ['lc83_familiarization_pending','Ожидают ознакомления','Назначенные, но не подтверждённые ознакомления с неизменившимся рабочим назначением.',false,x=>x.state==='pending'],
 ['lc83_familiarization_overdue','Просрочены ознакомления','Ожидающие ознакомления с явно назначенным сроком до даты среза.',false,x=>x.overdue],
 ['lc83_familiarization_scope_changed','Требует уточнения состав ознакомления','Не подтверждённые ознакомления, где исходное назначение сотрудника изменилось.',false,x=>x.state==='scope_changed']
];
export const familiarizationMetricId=id=>metricDefs.some(d=>d[0]===id);
export function familiarizationMetrics(db,a,scope){
 if(!exists(db))return [];
 const t=manager(db,a);if(!t)return [];
 const root=programResource(db),unit=scope.unit_id||root?.units[0];
 if(!unit||!['training.approve_responsible','training.approve_head'].some(k=>t.scope(k,unit,unitScope([unit]))))return [];
 const data=rows(db,selectSQL+" WHERE r.state='effective' AND v.state='effective' AND d.archived=0 AND o.archived=0 ORDER BY b.registered_at,f.person_name,f.id").filter(x=>!scope.unit_id||liveScope(db,x).unit_id===scope.unit_id);
 // A partial denominator is never shown as a whole-enterprise result.
 if(!data.every(x=>canManage(db,t,x)))return [];
 const items=data.map(x=>itemFor(db,a,t,x,false));
 return metricDefs.map(([id,label,definition,ratio,include])=>{
  const evidence=items.filter(x=>ratio||include(x)).map(x=>({date:x.confirmed_at?.slice(0,10)||x.assigned_on,label:x.code+' · v'+x.version_no+' · '+x.title,person:x.person,state:x.state_label,included:include(x),reason:x.overdue?'Срок '+x.due_on:x.current?'Действующая редакция':'История',route:{type:'familiarization',id:x.revision_id,person_id:x.person_id}}));
  return {id,label,definition,group:'Внедрение СОП',basis:'current',rules:'Срез на сегодня по зафиксированной оценке влияния и явным уточнениям состава; не гарантирует полный перечень исполнителей. Период не ограничивает текущий остаток. Сроки только явно назначенные. Ознакомление не означает обучение или допуск.',source:'Реестр персонального ознакомления LC8.3.4',value:evidence.filter(x=>x.included).length,denominator:ratio?evidence.length:null,availability:'available',dimensions:[],evidence};
 });
}
