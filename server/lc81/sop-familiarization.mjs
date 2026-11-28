// LC8.3.4: personal acknowledgement of a published, hash-bound SOP.
// Neither reading nor acknowledging a document is training, qualification or admission.
import {one,rows,isId,uuid,canonical} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {canReadRetraining} from './training-registers.mjs';
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
const scopeFor=(db,x)=>JSON.parse(one(db,'SELECT scope_json FROM lc83_sop_impact_plan WHERE id=?',[x.plan_id]).scope_json).filter(s=>s.person_id===x.person_id);
const responsible=(db,t)=>{
 const r=programResource(db);
 return !!t?.personId&&!!r&&canReadRetraining(db,t)&&t.scope('training.approve_responsible',r.units[0],r);
};
const manager=(db,a)=>{const t=a.personId?a.impactActor(a.accountId):null;return responsible(db,t)?t:null};
const canManage=(t,x)=>!!t&&!!t.read('sop.read_history',x.revision_id)&&!!t.read('person.read_basic',x.person_id)&&t.scope('training.approve_responsible',x.operation_id,{data:{},self:null,units:[x.operation_unit],assigned:[]});
function stateFor(a,x){
 return x.confirmed_at?'confirmed':!current(x)?'obsolete':a.employmentFor(x.person_id)!==x.employment_id?'scope_changed':'pending';
}
const stateLabels={confirmed:'Ознакомлен',pending:'Ожидает ознакомления',obsolete:'Редакция больше не действует',scope_changed:'Изменилось назначение сотрудника'};
const trainingLabels={planned:'Назначено',in_progress:'В работе',completed:'Назначение завершено',needs:'Требуется назначить / проверить',clarify:'Уточнить навык',restricted:'Данные обучения недоступны'};
function skillsFor(db,x){
 const scope=scopeFor(db,x).filter(s=>s.skill_id);
 return scope.filter((s,i)=>scope.findIndex(v=>v.skill_id===s.skill_id)===i);
}
function trainingRows(db,t,x,active){
 if(x.decision==='editorial')return [];
 const skills=skillsFor(db,x);
 if(!skills.length)return [{skill:'Навык не определён по имеющимся фактам',state:'clarify',label:trainingLabels.clarify}];
 return skills.map(s=>{
  const skill=t.read('skill.read',s.skill_id)?.data;
  if(!skill)return {skill:'Недоступный навык',state:'restricted',label:trainingLabels.restricted};
  const item={skill:skill.name,skill_id:s.skill_id};
  const next=one(db,"SELECT id,state FROM training_assignment WHERE trainee_id=? AND skill_id=? AND sop_revision_id=? AND state<>'cancelled' ORDER BY assigned_on DESC,id DESC LIMIT 1",[x.person_id,s.skill_id,x.revision_id]);
  if(next){
   if(!recordAccess(db,t,'training',next.id))return {...item,state:'restricted',label:trainingLabels.restricted};
   return {...item,state:next.state,label:trainingLabels[next.state]||next.state,assignment_id:next.id};
  }
  const resource=personWorkResource(db,[x.person_id],t.day,[],[x.operation_id]);
  const allowed=active&&resource&&t.read('sop.read_effective',x.revision_id)&&t.scope('training.create',x.operation_id,resource)&&t.scope('training.read',x.operation_id,resource);
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
 const own=x.person_id===a.personId,managed=canManage(t,x),active=current(x),state=stateFor(a,x),deadline=lastDeadline(db,x.id),b=JSON.parse(x.binding_json);
 const overdue=state==='pending'&&!!deadline&&deadline.due_on<a.day;
 const allowedTraining=active&&a.employmentFor(x.person_id)===x.employment_id;
 return {id:x.id,rev:x.rev,revision_id:x.revision_id,round_id:x.round_id,source_sha256:x.source_sha,person_id:x.person_id,person:x.person_name,unit_id:x.unit_id,code:b.code,title:b.title,version_no:b.version_no,decision:x.decision,state,state_label:stateLabels[state],current:active,assigned_on:x.registered_at.slice(0,10),confirmed_at:x.confirmed_at,due_on:deadline?.due_on??null,overdue,
 can_ack:own&&state==='pending'&&a.effective(x.revision_id),can_due:managed&&state==='pending',can_open:!!(a.effective(x.revision_id)||a.history(x.revision_id)),training:training&&managed?trainingRows(db,t,x,allowedTraining):null};
}
export function familiarizationList(db,a,{kind='mine',revision_id=null,person_id=null,offset=0}={},includeTraining=true){
 must(a.personId&&['mine','managed','visible'].includes(kind)&&(revision_id===null||isId(revision_id))&&(person_id===null||isId(person_id))&&Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000,400,'Неверный фильтр ознакомления');
 const t=manager(db,a),result={items:[],total:0,offset,limit:50,day:a.day,can_manage:!!t,registered:false};
 if(!exists(db)||kind==='managed'&&!t)return result;
 const cond=[],args=[];
 if(revision_id!==null){cond.push('r.revision_id=?');args.push(revision_id)}
 if(person_id!==null){cond.push('f.person_id=?');args.push(person_id)}
 if(kind==='mine'||!t){cond.push('f.person_id=?');args.push(a.personId)}
 const matched=rows(db,selectSQL+(cond.length?' WHERE '+cond.join(' AND '):'')+' ORDER BY b.registered_at DESC,f.person_name,f.id',args).filter(x=>kind==='managed'?canManage(t,x):x.person_id===a.personId||canManage(t,x));
 // A zero-person batch is visible only with the same responsible scope.
 if(revision_id&&t?.read('sop.read_history',revision_id)){
  const v=one(db,'SELECT o.id operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=?',[revision_id]);
  if(v&&t.scope('training.approve_responsible',v.operation_id,{data:{},self:null,units:[v.unit_id],assigned:[]}))result.registered=!!one(db,'SELECT b.round_id FROM lc83_sop_familiarization_batch b JOIN lc83_sop_round r ON r.id=b.round_id WHERE r.revision_id=?',[revision_id]);
 }
 result.total=matched.length;result.registered=result.registered||matched.length>0;
 result.items=matched.slice(offset,offset+50).map(x=>itemFor(db,a,t,x,includeTraining));
 return result;
}
export function prepareFamiliarizationAck(db,a,f){
 must(exact(f,['id','expected_revision','source_sha256','confirmed'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&typeof f.source_sha256==='string'&&/^[a-f0-9]{64}$/.test(f.source_sha256)&&f.confirmed===true,400,'Подтвердите личное ознакомление');
 const x=find(db,f.id);
 must(x&&a.personId===x.person_id&&a.effective(x.revision_id),404,'Ознакомление недоступно');
 must(stateFor(a,x)==='pending'&&x.rev===f.expected_revision&&x.source_sha===f.source_sha256,409,'Ознакомление или редакция изменились');
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
 must(x&&canManage(t,x),404,'Ознакомление недоступно');
 must(x.rev===f.expected_revision&&stateFor(a,x)==='pending',409,'Ознакомление или редакция изменились');
 const id=uuid();
 db.run('INSERT INTO lc83_sop_familiarization_deadline VALUES(?,?,?,?,?,?,?)',[id,x.id,x.rev+1,f.due_on,f.note.trim(),a.accountId,a.at]);
 db.run('UPDATE lc83_sop_familiarization SET rev=rev+1 WHERE id=?',[x.id]);
 a.audit('sop.familiarization.deadline',id);
 notice(db,x.round_id,id,a.accountFor(x.person_id),'familiarization_deadline',a.at);
 return {id:x.id,rev:x.rev+1,due_on:f.due_on};
}
// No new training domain, approval, qualification, or admission. The ordinary
// createTraining path checks source, permissions, instructor, dates and method.
export function assertFamiliarizationTraining(db,t,f){
 const x=find(db,f.familiarization_id);
 must(x&&responsible(db,t)&&canManage(t,x)&&current(x)&&x.decision!=='editorial'&&x.person_id===f.trainee_id&&x.revision_id===f.revision_id&&x.operation_id===f.operation_id,404,'Основание адресного обучения недоступно');
 const em=rows(db,"SELECT a.id FROM person_assignment a JOIN person p ON p.id=a.person_id WHERE p.id=? AND p.archived=0 AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=?",[x.person_id,t.day,t.day]);
 must(em.length===1&&em[0].id===x.employment_id,409,'Состав затронутых сотрудников изменился');
 const skill=skillsFor(db,x).find(s=>s.skill_id===f.skill_id);
 must(skill&&(!Object.hasOwn(f,'retraining_source_id')||skill.basis.some(b=>b.kind==='training'&&b.id===f.retraining_source_id))&&f.scenario==='changed_operation',422,'Навык или основание не соответствуют оценке влияния');
 must(!one(db,"SELECT id FROM training_assignment WHERE trainee_id=? AND skill_id=? AND sop_revision_id=? AND state<>'cancelled'",[x.person_id,f.skill_id,x.revision_id]),409,'Адресное обучение по этой редакции уже назначено');
}
export function checkFamiliarizationIntegrity(db){
 const present=tables.filter(t=>exists(db,t));
 if(!present.length)return;
 must(present.length===tables.length,503,'Неполная схема ознакомлений СОП');
 for(const b of rows(db,'SELECT * FROM lc83_sop_familiarization_batch')){
  const p=one(db,'SELECT * FROM lc83_sop_impact_plan WHERE id=?',[b.plan_id]),r=one(db,'SELECT * FROM lc83_sop_round WHERE id=?',[b.round_id]);
  must(p?.round_id===b.round_id&&p.activated_at===b.registered_at&&r&&['effective','withdrawn'].includes(r.state)&&p.binding_sha===r.binding_sha256&&JSON.parse(r.binding_json).source.sha256===b.source_sha,503,'Ознакомление не соответствует введённой редакции');
  const actual=rows(db,'SELECT * FROM lc83_sop_familiarization WHERE round_id=? ORDER BY person_id',[b.round_id]),expected=roster(p);
  must(actual.length===expected.length&&canonical(actual.map(x=>({person_id:x.person_id,employment_id:x.employment_id,unit_id:x.unit_id,person_name:x.person_name})))===canonical(expected),503,'Состав ознакомления не соответствует зафиксированной оценке');
  for(const x of actual){
   const employment=one(db,'SELECT person_id FROM person_assignment WHERE id=?',[x.employment_id]),actor=x.confirmed_account&&one(db,'SELECT person_id FROM lc81_account WHERE id=?',[x.confirmed_account]);
   const deadlines=rows(db,'SELECT * FROM lc83_sop_familiarization_deadline WHERE receipt_id=? ORDER BY rev',[x.id]);
   must(employment?.person_id===x.person_id&&(!x.confirmed_at||actor?.person_id===x.person_id&&x.confirmed_at>=b.registered_at)&&x.rev===1+deadlines.length+(x.confirmed_at?1:0)&&deadlines.every((d,i)=>d.rev===i+2&&date(d.due_on)&&d.recorded_at>=b.registered_at&&(!x.confirmed_at||d.recorded_at<=x.confirmed_at)&&d.note.trim()),503,'Нарушена история ознакомления');
  }
 }
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
 const data=rows(db,selectSQL+" WHERE r.state='effective' AND v.state='effective' AND d.archived=0 AND o.archived=0 AND (?='' OR f.unit_id=?) ORDER BY b.registered_at,f.person_name,f.id",[scope.unit_id,scope.unit_id]);
 // A partial denominator is never shown as a whole-enterprise result.
 if(!data.every(x=>canManage(t,x)))return [];
 const items=data.map(x=>itemFor(db,a,t,x,false));
 return metricDefs.map(([id,label,definition,ratio,include])=>{
  const evidence=items.filter(x=>ratio||include(x)).map(x=>({date:x.confirmed_at?.slice(0,10)||x.assigned_on,label:x.code+' · v'+x.version_no+' · '+x.title,person:x.person,state:x.state_label,included:include(x),reason:x.overdue?'Срок '+x.due_on:x.current?'Действующая редакция':'История',route:{type:'sop',id:x.revision_id}}));
  return {id,label,definition,group:'Внедрение СОП',basis:'current',rules:'Срез на сегодня по зафиксированному составу оценки влияния; не полный перечень исполнителей. Период не ограничивает текущий остаток. Сроки только явно назначенные. Ознакомление не означает обучение или допуск.',source:'Реестр персонального ознакомления LC8.3.4',value:evidence.filter(x=>x.included).length,denominator:ratio?evidence.length:null,availability:'available',dimensions:[],evidence};
 });
}
