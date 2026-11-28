// Typed protected training commands. The LC4/LC6 domain remains authoritative.
import {one,rows,isId,uuid,canonical,applyEvent} from '../../src/core/db.js';
import {activeEmployment,activeAuthorizations,practicalMethods,practicalCriteria,admissionStatus,conclusions} from '../../src/modules/training/domain.js';
import {progressFor,currentStandard,latestVerification,latestAssessment,variants,sharedTrainingTask,latestTaskAssignment} from '../../src/modules/training/training-facts.js';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {trainingResource,trainingAssignmentResource,enrollmentResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,message)=>{if(!ok)throw new PilotError(status,message)};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(s,n=2000)=>typeof s==='string'&&s.length<=n;
const required=s=>text(s)&&s.trim().length>0;
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const approvalSchema=`CREATE TABLE IF NOT EXISTS lc81_training_approval(
 assignment_id TEXT NOT NULL REFERENCES training_assignment(id),
 assignment_rev INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN('responsible','head')),
 account_id TEXT NOT NULL REFERENCES lc81_account(id),person_id TEXT NOT NULL REFERENCES person(id),
 credential_revision INTEGER NOT NULL, note TEXT NOT NULL, decided_at TEXT NOT NULL,
 PRIMARY KEY(assignment_id,assignment_rev,kind));`;
const kinds={stage:'training.stage',verify:'training.verify',practical:'training.practical',qualify:'training.qualify',admit:'training.admit',reschedule:'training.reschedule',cancel:'training.cancel',approve_responsible:'training.approve_responsible',approve_head:'training.approve_head'};
const approved=a=>!!a.approval_json;
export const TWI_SCENARIOS=Object.freeze({
 onboarding:'Новичок / перевод на другую профессию',
 development:'Повышение компетенции / разряда',
 changed_operation:'Новая операция / изменение технологии или СОП',
 rapid:'Быстрое обучение при отклонении'
});
const hasTable=(db,name)=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);
const scenarioFor=(db,id)=>hasTable(db,'lc81_training_context')?one(db,'SELECT scenario FROM lc81_training_context WHERE assignment_id=?',[id])?.scenario??null:null;
const contextSchema=`CREATE TABLE IF NOT EXISTS lc81_training_context(
 assignment_id TEXT PRIMARY KEY REFERENCES training_assignment(id),
 scenario TEXT NOT NULL CHECK(scenario IN('onboarding','development','changed_operation','rapid')));`;
const planSchema=`CREATE TABLE IF NOT EXISTS lc81_production_plan(
 id TEXT PRIMARY KEY,title TEXT NOT NULL,from_on TEXT NOT NULL,to_on TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES person(id),created_at TEXT NOT NULL,
 responsible_vote TEXT,head_vote TEXT,approved_at TEXT);
CREATE TABLE IF NOT EXISTS lc81_production_plan_row(
 plan_id TEXT NOT NULL REFERENCES lc81_production_plan(id),
 assignment_id TEXT NOT NULL REFERENCES training_assignment(id),
 expected_rev INTEGER NOT NULL,assigned_on TEXT NOT NULL,due_on TEXT NOT NULL,
 PRIMARY KEY(plan_id,assignment_id));`;
function visible(db,access,id){
 must(isId(id)&&access.read('training.read',id),404,'Назначение недоступно');
 const a=one(db,'SELECT * FROM training_assignment WHERE id=?',[id]);must(a?.source_sha256,404,'Назначение недоступно');
 return a;
}
function allowed(db,access,a,action,extra=[],on=null){
 const r=trainingAssignmentResource(db,a.id,access.day,extra,on);
 return !!r&&access.allows(action,a.id,r);
}
const allowedPerson=(db,access,id)=>!!access.read('person.read_basic',id)||!!access.read('person.read_directory',id);
const label=(db,id)=>one(db,'SELECT display_name FROM person WHERE id=?',[id])?.display_name||'';
function emit(db,access,entity_type,entity_id,operation,expected_revision,payload,action){
 const id=uuid();
 try{applyEvent(db,{id,entity_type,entity_id,operation,expected_revision,payload,occurred_at:access.at})}
 catch(e){throw new PilotError(422,'Операция не прошла проверку обучения: '+String(e.message||'ошибка').split('\n')[0].slice(0,260))}
 access.audit(action,id);return {id,entity_id};
}
function sourceRevision(db,id){
 const r=currentStandard(db,id);
 must(r?.state==='effective'&&!r.archived&&r.operation_id,422,'Нужен действующий СОП');
 return r;
}
export function trainingOptions(db,access,operationId=null){
 must(access.personId&&access.permissions.includes('training.create'),403,'Назначение обучения недоступно');
 const operations=rows(db,'SELECT id,code,name FROM operation WHERE archived=0 ORDER BY code').filter(o=>{
  const r=trainingResource(db,o.id,[access.personId],access.day);
  // Allow central managers with a different home unit via their full scope.
  return !!access.read('operation.read',o.id)&&!!r&&access.allows('training.create',o.id,{...r,units:[one(db,'SELECT unit_id FROM operation WHERE id=?',[o.id]).unit_id]});
 });
 if(operationId===null)return {operations};
 must(operations.some(o=>o.id===operationId),403,'Операция недоступна');
 const people=directoryPeople(db,access.day).filter(p=>allowedPerson(db,access,p.id)&&activeEmployment(db,p.id,access.day)&&access.allows('training.create',operationId,trainingResource(db,operationId,[p.id],access.day))).map(p=>({id:p.id,name:p.display_name}));
 const mentors=activeAuthorizations(db,operationId,access.day).filter(x=>allowedPerson(db,access,x.person_id)&&access.allows('training.create',operationId,trainingResource(db,operationId,[x.person_id],access.day))).map(x=>({id:x.id,person_id:x.person_id,name:label(db,x.person_id)}));
 const revisions=rows(db,"SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='effective' AND d.archived=0 AND d.operation_id=?",[operationId]).flatMap(({id})=>{
  const r=access.read('sop.read_effective',id);
  return r?[{id,title:r.data.title,steps:one(db,'SELECT count(*) n FROM document_step WHERE revision_id=?',[id]).n}]:[];
 });
 const skills=rows(db,'SELECT id,name FROM skill WHERE archived=0 AND operation_id=? ORDER BY name',[operationId]);
 const scales=rows(db,'SELECT id,name FROM rating_scale WHERE archived=0 ORDER BY name').map(x=>({...x,levels:rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[x.id])}));
 return {operations,people,mentors,revisions,skills,scales,variants,scenarios:TWI_SCENARIOS,day:access.day};
}
export const CREATE_FIELDS=Object.freeze(['operation_id','trainee_id','authorization_id','revision_id','skill_id','scale_id','target_level','assigned_on','due_on','reason','variant','method_config','plan_reviewed']);
export function resolveTrainingCreate(db,input,access){
 const fields=[...CREATE_FIELDS,...(Object.hasOwn(input||{},'scenario')?['scenario']:[])];
 const linked=exact(input,[...fields,'enrollment_id','program_task_id','enrollment_rev']),repeat=exact(input,[...fields,'retraining_source_id']);
 must((exact(input,fields)||linked||repeat)&&access.personId&&isId(input.operation_id)&&isId(input.trainee_id)&&isId(input.authorization_id)&&isId(input.revision_id)&&date(input.assigned_on)&&date(input.due_on)&&input.assigned_on>=access.day&&input.plan_reviewed===true,400,'Заполните назначение и подтверждение плана');
 must(access.read('operation.read',input.operation_id)&&access.read('sop.read_effective',input.revision_id)&&allowedPerson(db,access,input.trainee_id),403,'Данные назначения недоступны');
 must(activeEmployment(db,input.trainee_id,input.assigned_on),422,'У обучаемого нет действующего назначения на работу');
 must(!Object.hasOwn(input,'scenario')||Object.hasOwn(TWI_SCENARIOS,input.scenario),400,'Укажите основание обучения по TWI 03');
 const auth=one(db,'SELECT * FROM mentor_authorization WHERE id=? AND operation_id=?',[input.authorization_id,input.operation_id]);
 must(auth&&allowedPerson(db,access,auth.person_id),403,'Инструктор недоступен');
 let resource=trainingResource(db,input.operation_id,[input.trainee_id,auth.person_id],access.day,input.assigned_on);
 let n=null,task=null;
 if(linked){
  must(isId(input.enrollment_id)&&typeof input.program_task_id==='string'&&input.program_task_id.length<=100&&Number.isSafeInteger(input.enrollment_rev),400,'Неверная связь с программой');
  n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[input.enrollment_id]);
  const er=enrollmentResource(db,n,access.day);
  must(n&&er&&access.read('training.enrollment.read',n.id)&&access.allows('training.enrollment.detail',n.id,er),403,'Персональная программа недоступна');
  must(n.rev===input.enrollment_rev&&n.state==='active',409,'Персональная программа изменилась');
  task=one(db,'SELECT * FROM training_program_task WHERE id=? AND program_id=?',[input.program_task_id,n.program_id]);
  must(task&&task.sop_revision_id===input.revision_id&&task.skill_id===input.skill_id&&task.scale_id===input.scale_id&&task.target_level===input.target_level&&n.trainee_id===input.trainee_id&&input.assigned_on>=n.start_on&&input.due_on<=n.due_on&&!sharedTrainingTask(db,n.id,task.id)&&!latestTaskAssignment(db,n.id,task.id),422,'Назначение не соответствует заданию персональной программы');
  if(resource)resource={...resource,units:[...new Set([...resource.units,...er.units])]};
 }

 must(access.allows('training.create',input.operation_id,resource)&&access.allows('training.read',input.operation_id,resource),403,'Назначение выходит за область полномочий');
 const r=sourceRevision(db,input.revision_id);
 must(r.operation_id===input.operation_id,422,'СОП относится к другой операции');
 if(repeat){
  const old=isId(input.retraining_source_id)&&one(db,'SELECT * FROM training_assignment WHERE id=?',[input.retraining_source_id]);
  must(old&&old.state!=='cancelled'&&access.read('training.read',old.id)&&allowed(db,access,old,'training.detail')&&access.read('sop.read_history',old.sop_revision_id),404,'Прежнее обучение недоступно');
  const prior=currentStandard(db,old.sop_revision_id);
  must(prior&&prior.document_id===r.document_id&&prior.id!==r.id&&old.trainee_id===input.trainee_id&&old.operation_id===input.operation_id&&old.skill_id===input.skill_id&&old.scale_id===input.scale_id&&old.target_level===input.target_level,409,'Основание переобучения изменилось');
  must(!one(db,"SELECT id FROM training_assignment WHERE trainee_id=? AND skill_id=? AND sop_revision_id=? AND state<>'cancelled'",[old.trainee_id,old.skill_id,r.id]),409,'Переобучение по новой редакции уже назначено');
 }
 const program=n&&one(db,'SELECT standard_kind FROM training_program WHERE id=?',[n.program_id]);
 const inferred=repeat?'changed_operation':program&&['adaptation','internship','safety'].includes(program.standard_kind)?'onboarding':program?'development':null;
 const scenario=input.scenario??inferred;
 must(!inferred||!input.scenario||input.scenario===inferred,422,'Основание не соответствует связанной программе или переобучению');
 return {source:r.source,scenario,payload:{trainee_id:input.trainee_id,mentor_id:auth.person_id,supervisor_id:null,authorization_id:auth.id,revision_id:r.id,source:r.source,skill_id:input.skill_id,scale_id:input.scale_id,target_level:input.target_level,assigned_by:access.personId,assigned_on:input.assigned_on,due_on:input.due_on,reason:input.reason,variant:input.variant,method_version:'JI-2',method_config:input.method_config,shift_id:null,enrollment_id:n?.id??null,program_task_id:task?.id??null,plan_reviewed:true}};
}
export function createTraining(db,resolved,access){
 const id=uuid();emit(db,access,'training_assignment',id,'create',0,resolved.payload,'training.create');
 if(resolved.scenario){db.run(contextSchema);db.run('INSERT INTO lc81_training_context VALUES(?,?)',[id,resolved.scenario])}
 return {id,rev:1,state:'planned',scenario:resolved.scenario};
}
function pendingApprovals(db,a){
 if(!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc81_training_approval'"))return [];
 return rows(db,'SELECT * FROM lc81_training_approval WHERE assignment_id=? AND assignment_rev=? ORDER BY kind',[a.id,a.rev]);
}
function approvalValid(db,a,v,access){
 const other=access.actorAccess(v.account_id,v.credential_revision);
 return !!other&&other.personId===v.person_id&&v.person_id!==a.trainee_id&&other.read('training.read',a.id)&&allowed(db,other,a,'training.approve_'+v.kind);
}
function vote(db,a,kind,note,access){
 must(!approved(a)&&['planned','in_progress'].includes(a.state)&&text(note,900),422,'План уже согласован или недоступен');
 db.run(approvalSchema);
 // A stale or revoked vote never grants authority.
 for(const v of pendingApprovals(db,a))if(!approvalValid(db,a,v,access))db.run('DELETE FROM lc81_training_approval WHERE assignment_id=? AND assignment_rev=? AND kind=?',[a.id,a.rev,v.kind]);
 const votes=pendingApprovals(db,a),own=votes.find(v=>v.kind===kind),other=votes.find(v=>v.kind!==kind);
 must(!other||other.person_id!==access.personId,403,'Два согласующих должны быть разными сотрудниками');
 must(!own||own.account_id===access.accountId,409,'Это согласование уже зарегистрировано другим сотрудником');
 if(!own){
  db.run('INSERT INTO lc81_training_approval VALUES(?,?,?,?,?,?,?,?)',[a.id,a.rev,kind,access.accountId,access.personId,access.credentialRevision,note,access.at]);
  access.audit('training.approve_'+kind,a.id);
 }
 const v=pendingApprovals(db,a);
 if(v.length<2)return {id:a.id,rev:a.rev,state:a.state,approval_pending:true};
 const responsible=v.find(x=>x.kind==='responsible'),head=v.find(x=>x.kind==='head');
 must(responsible&&head&&v.every(x=>approvalValid(db,a,x,access)),403,'Согласование больше не действует');
 emit(db,access,'training_assignment',a.id,'update',a.rev,{command:'approve',responsible_id:responsible.person_id,head_id:head.person_id,approved_on:access.day,note:v.map(x=>x.note).filter(Boolean).join('\n')},'training.approval_committed');
 return {id:a.id,rev:a.rev+1,state:a.state,approval_pending:false};
}
const planItems=(db,id)=>rows(db,'SELECT * FROM lc81_production_plan_row WHERE plan_id=? ORDER BY assignment_id',[id]);
function planState(db,p,items,access){
 if(p.approved_at)return 'approved';
 const current=items.map(x=>one(db,'SELECT * FROM training_assignment WHERE id=?',[x.assignment_id]));
 if(!items.length||current.some((a,i)=>!a||a.rev!==items[i].expected_rev||approved(a)||!['planned','in_progress'].includes(a.state)||!currentStandard(db,a.sop_revision_id)||currentStandard(db,a.sop_revision_id).state!=='effective'))return 'stale';
 for(const key of ['responsible_vote','head_vote'])if(p[key]){
  const v=JSON.parse(p[key]);
  if(current.some(a=>!approvalValid(db,a,v,access)))return 'stale';
 }
 return 'draft';
}
function livePlan(db,assignment,access){
 if(!hasTable(db,'lc81_production_plan'))return null;
 return rows(db,'SELECT p.* FROM lc81_production_plan p JOIN lc81_production_plan_row r ON r.plan_id=p.id WHERE r.assignment_id=? AND r.expected_rev=? AND p.approved_at IS NULL',[assignment.id,assignment.rev]).find(p=>planState(db,p,planItems(db,p.id),access)==='draft')||null;
}
function planAccess(db,a,id){
 const t=one(db,'SELECT * FROM training_assignment WHERE id=?',[id]);
 return t?.source_sha256&&a.read('training.read',id)&&allowed(db,a,t,'training.detail')?t:null;
}
function planEligible(db,a,t){
 const s=currentStandard(db,t.sop_revision_id);
 return !!a.personId&&a.personId!==t.trainee_id&&['planned','in_progress'].includes(t.state)&&!approved(t)&&s?.state==='effective'&&!s.archived&&allowed(db,a,t,'training.create')&&
 !pendingApprovals(db,t).some(v=>approvalValid(db,t,v,a))&&!livePlan(db,t,a);
}
const planRow=(db,t)=>({id:t.id,rev:t.rev,assigned_on:t.assigned_on,due_on:t.due_on,trainee:label(db,t.trainee_id),instructor:label(db,t.mentor_id),operation:one(db,'SELECT name FROM operation WHERE id=?',[t.operation_id])?.name??'',scenario:scenarioFor(db,t.id)});
function projectPlan(db,a,p){
 const items=planItems(db,p.id),current=items.map(x=>planAccess(db,a,x.assignment_id));
 if(!items.length||current.some(x=>!x))return null;
 const status=planState(db,p,items,a);
 const votes=Object.fromEntries(['responsible','head'].map(kind=>{
  const v=p[kind+'_vote']?JSON.parse(p[kind+'_vote']):null;
  return [kind,{done:!!v,day:v?.decided_at.slice(0,10)??null,can:status==='draft'&&!v&&!!a.personId&&current.every(t=>a.personId!==t.trainee_id&&allowed(db,a,t,'training.approve_'+kind))}];
 }));
 return {id:p.id,title:p.title,from:p.from_on,to:p.to_on,status,rows:current.map((t,i)=>({...planRow(db,t),rev:items[i].expected_rev,assigned_on:items[i].assigned_on,due_on:items[i].due_on})),votes};
}
export function productionPlans(db,a){
 must(a.personId&&a.permissions.includes('training.read')&&a.permissions.includes('training.detail'),403,'План обучения недоступен');
 const plans=hasTable(db,'lc81_production_plan')?rows(db,'SELECT * FROM lc81_production_plan ORDER BY created_at DESC,id').map(p=>projectPlan(db,a,p)).filter(Boolean).slice(0,100):[];
 const can_create=a.permissions.includes('training.create');
 const candidates=can_create?rows(db,"SELECT id FROM training_assignment WHERE state IN('planned','in_progress') AND approval_json IS NULL ORDER BY assigned_on,id").map(x=>planAccess(db,a,x.id)).filter(t=>t&&planEligible(db,a,t)).slice(0,200).map(t=>planRow(db,t)):[];
 return {day:a.day,plans,candidates,can_create,scenarios:TWI_SCENARIOS};
}
export function createProductionPlan(db,a,f){
 must(a.personId&&a.permissions.includes('training.create')&&exact(f,['title','from','to','rows'])&&required(f.title)&&f.title.length<=200&&date(f.from)&&date(f.to)&&f.from<=f.to&&Date.parse(f.to)-Date.parse(f.from)<=366*86400000&&Array.isArray(f.rows)&&f.rows.length>=1&&f.rows.length<=200&&new Set(f.rows.map(x=>x?.id)).size===f.rows.length&&f.rows.every(x=>exact(x,['id','rev'])&&isId(x.id)&&Number.isSafeInteger(x.rev)),400,'Укажите период, название и состав плана (до 200 строк)');
 const items=f.rows.map(x=>planAccess(db,a,x.id));
 must(items.every((t,i)=>t&&t.rev===f.rows[i].rev&&planEligible(db,a,t)&&t.assigned_on>=f.from&&t.assigned_on<=f.to),409,'Строка недоступна, изменена, уже согласуется или начало выходит за период плана');
 db.run(planSchema);const id=uuid();
 db.run('INSERT INTO lc81_production_plan(id,title,from_on,to_on,created_by,created_at) VALUES(?,?,?,?,?,?)',[id,f.title.trim(),f.from,f.to,a.personId,a.at]);
 for(const t of items)db.run('INSERT INTO lc81_production_plan_row VALUES(?,?,?,?,?)',[id,t.id,t.rev,t.assigned_on,t.due_on]);
 a.audit('training.plan_create',id);return {id,status:'draft'};
}
export function approveProductionPlan(db,a,f){
 must(a.personId&&exact(f,['id','kind','note'])&&isId(f.id)&&['responsible','head'].includes(f.kind)&&text(f.note,900),400,'Неверное согласование плана');
 const p=hasTable(db,'lc81_production_plan')&&one(db,'SELECT * FROM lc81_production_plan WHERE id=?',[f.id]),view=p&&projectPlan(db,a,p);
 must(view,404,'План недоступен');must(view.status==='draft',409,'Состав или полномочия плана изменились; сформируйте новый план');
 const key=f.kind+'_vote',otherKey=(f.kind==='head'?'responsible':'head')+'_vote',other=p[otherKey]&&JSON.parse(p[otherKey]);
 must(!other||other.person_id!==a.personId,403,'Два согласующих должны быть разными сотрудниками');
 must(view.votes[f.kind].can,403,'Согласование недоступно или уже зарегистрировано');
 const v={kind:f.kind,account_id:a.accountId,person_id:a.personId,credential_revision:a.credentialRevision,note:f.note,decided_at:a.at};
 db.run('UPDATE lc81_production_plan SET '+key+'=? WHERE id=?',[canonical(v),p.id]);a.audit('training.plan_approve_'+f.kind,p.id);
 if(!other)return {id:p.id,status:'draft'};
 const items=planItems(db,p.id),responsible=f.kind==='responsible'?v:other,head=f.kind==='head'?v:other;
 for(const x of items){
  const t=planAccess(db,a,x.assignment_id);
  must(t&&t.rev===x.expected_rev&&[responsible,head].every(z=>approvalValid(db,t,z,a)),403,'Согласование строки больше не действует');
  emit(db,a,'training_assignment',t.id,'update',t.rev,{command:'approve',responsible_id:responsible.person_id,head_id:head.person_id,approved_on:a.day,note:('План '+p.id+' · '+[responsible.note,head.note].filter(Boolean).join('\n')).slice(0,1950)},'training.approval_committed');
 }
 db.run('UPDATE lc81_production_plan SET approved_at=? WHERE id=?',[a.at,p.id]);
 return {id:p.id,status:'approved'};
}
// Atomic multi-fact operations. Each fact uses exactly the same date, witness,
// scope, sequence and actor checks as the original single-event command.
export function recordInstructionProtocol(db,a,f){
 must(exact(f,['id','expected_revision','facts'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&Array.isArray(f.facts)&&f.facts.length>=1&&f.facts.length<=40,400,'Укажите от 1 до 40 фактических этапов');
 let rev=f.expected_revision,result;
 for(const fact of f.facts){result=changeTraining(db,{id:f.id,expected_revision:rev,command:'stage',fields:fact},a);rev=result.rev}
 return {...result,recorded:f.facts.length};
}
export function recordAssessmentResult(db,a,f){
 must(exact(f,['id','expected_revision','practical','qualification'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&exact(f.practical,['assessed_on','method_id','responses','conclusion','feedback'])&&exact(f.qualification,['observation_state','level','valid_until','evidence']),400,'Неверный протокол оценки');
 const p=changeTraining(db,{id:f.id,expected_revision:f.expected_revision,command:'practical',fields:f.practical},a);
 const q=changeTraining(db,{id:f.id,expected_revision:p.rev,command:'qualify',fields:{...f.qualification,assessed_on:f.practical.assessed_on,practical_id:p.event_entity_id,feedback:f.practical.feedback}},a);
 return {...q,practical_id:p.event_entity_id,qualification_id:q.event_entity_id};
}
export function changeTraining(db,input,access){
 must(exact(input,['id','expected_revision','command','fields'])&&Object.hasOwn(kinds,input.command)&&Number.isSafeInteger(input.expected_revision)&&access.personId,400,'Неверная команда обучения');
 const a=visible(db,access,input.id),p=input.fields,command=input.command,action=kinds[command];
 must(a.rev===input.expected_revision,409,'Назначение изменилось. Откройте актуальную карточку');
 must(access.personId!==a.trainee_id,403,'Нельзя подтверждать собственное обучение');
 must(command!=='stage'||access.personId===a.mentor_id,403,'Факт регистрирует назначенный инструктор');
 const factDay=command==='stage'?String(p?.held_at||'').slice(0,10):command==='verify'?p?.evaluated_on:['practical','qualify'].includes(command)?p?.assessed_on:command==='admit'?p?.decided_on:null;
 const witness=command==='stage'?p?.witness_id:null;
 if(factDay!==null)must(date(factDay)&&factDay<=access.day,422,'Фактическая дата не может быть в будущем');
 if(witness)must(isId(witness)&&allowedPerson(db,access,witness),403,'Демонстратор недоступен');
 must(allowed(db,access,a,action,witness?[witness]:[],factDay),403,'Нет полномочий для этого назначения');
 if(command.startsWith('approve_')){
  must(exact(p,['note']),400,'Неверные поля согласования');
  must(!livePlan(db,a,access),409,'Назначение входит в общий план. Согласуйте план целиком.');
  return vote(db,a,command.slice(8),p.note,access);
 }
 let type='training_assignment',id=a.id,operation='update',expected=a.rev,payload;
 const common={assignment_id:a.id,assignment_rev:a.rev};
 if(command==='reschedule'){must(exact(p,['due_on','reason']),400,'Неверные поля');payload={command,...p}}
 else if(command==='cancel'){must(exact(p,['reason']),400,'Неверные поля');payload={command,...p}}
 else{
  id=uuid();operation='create';expected=0;
  if(command==='stage'){
   must(exact(p,['stage_code','held_at','duration_minutes','result','notes','witness_id','mentor_ack','trainee_ack']),400,'Неверные поля факта');
   type='training_session';payload={...common,...p};
  }else if(command==='verify'){
   must(exact(p,['kind','evaluated_on','result','evidence','feedback']),400,'Неверные поля проверки');
   type='training_verification';payload={...common,...p,evaluator_id:access.personId};
  }else if(command==='practical'){
   must(exact(p,['assessed_on','method_id','responses','conclusion','feedback']),400,'Неверные поля оценки');
   type='assessment_session';payload={command:'practical',...common,...p,evaluator_id:access.personId};
  }else if(command==='qualify'){
   must(exact(p,['assessed_on','practical_id','observation_state','level','valid_until','evidence','feedback']),400,'Неверные поля квалификации');
   type='assessment_session';payload={command:'qualification',...common,...p,evaluator_id:access.personId};
  }else if(command==='admit'){
   must(exact(p,['decided_on','valid_until','decision','evidence','feedback']),400,'Неверные поля допуска');
   type='admission_decision';payload={...common,...p,actor_id:access.personId};
  }
 }
 emit(db,access,type,id,operation,expected,payload,action);
 const result=one(db,'SELECT id,rev,state FROM training_assignment WHERE id=?',[a.id]);
 return {...result,event_entity_id:id};
}
export function trainingDetail(db,access,id){
 const a=visible(db,access,id);
 must(allowed(db,access,a,'training.detail'),404,'Карточка обучения недоступна');
 const pr=progressFor(db,a),cap=Object.fromEntries(Object.entries(kinds).map(([cmd,action])=>[cmd,!!access.personId&&access.personId!==a.trainee_id&&(cmd!=='stage'||access.personId===a.mentor_id)&&allowed(db,access,a,action)]));
 const plan=livePlan(db,a,access);
 if(plan){cap.approve_responsible=false;cap.approve_head=false}
 const decisions=pendingApprovals(db,a).filter(v=>approvalValid(db,a,v,access)).map(v=>({kind:v.kind,decided_at:v.decided_at}));
 const verification=['safety','theory'].map(kind=>{const v=latestVerification(db,a.id,kind);return {kind,result:v?.result??null,day:v?.evaluated_on??null}});
 const practical=latestAssessment(db,a.id,'practical'),q=latestAssessment(db,a.id,'qualification'),item=q&&one(db,'SELECT level,observation_state,valid_until FROM assessment_item WHERE session_id=?',[q.id]);
 const method=practicalMethods(db).find(m=>m.state==='active');
 const admission=admissionStatus(db,a.trainee_id,a.operation_id,access.day);
 const methods=cap.practical&&method?[{id:method.id,criteria:practicalCriteria(db,method.id).map(x=>({id:x.id,question:x.question,section:x.section_code}))}]:[];
 const witnesses=cap.stage?directoryPeople(db,access.day).filter(p=>allowedPerson(db,access,p.id)&&allowed(db,access,a,'training.stage',[p.id])).map(p=>({id:p.id,name:p.display_name})):[];
 return {id:a.id,rev:a.rev,state:a.state,scenario:scenarioFor(db,a.id),scenario_label:TWI_SCENARIOS[scenarioFor(db,a.id)]??null,plan_pending:!!plan,safety_required:a.method_variant==='hazardous'||!!JSON.parse(a.method_config_json||'null')?.hazardous,trainee:label(db,a.trainee_id),mentor:label(db,a.mentor_id),assigned_on:a.assigned_on,due_on:a.due_on,operation:one(db,'SELECT name FROM operation WHERE id=?',[a.operation_id])?.name,method_variant:a.method_variant,method_version:a.method_version,approved:approved(a),pending_approvals:decisions,stages:pr.stages.map(s=>({code:s.code,label:s.label,done:pr.done.has(s.code)})),next:pr.next?.code??null,completed:pr.completed,complete:pr.complete,
 facts:pr.facts.map(f=>({stage_code:f.stage_code,held_at:f.held_at,duration_minutes:f.duration_minutes,result:f.result,notes:f.notes})),
 verification,practical:practical?{id:practical.id,conclusion:practical.conclusion,can_task:!!access.personId&&allowed(db,access,a,'task.create'),negative:JSON.parse(practical.responses_json||'[]').filter(x=>x.value===0).map(x=>({id:x.criterion_id,question:one(db,'SELECT question FROM checklist_criterion WHERE id=?',[x.criterion_id])?.question??''}))}:null,qualification:item||null,admission:!admission.record||admission.record.assignment_id===a.id?admission.status:'По этому назначению нет текущего решения',cap,methods,witnesses,conclusions,levels:rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[a.scale_id]),day:access.day};
}
export function trainingSop(db,access,id){
 const a=visible(db,access,id);
 must(allowed(db,access,a,'training.read_sop')&&a.state!=='cancelled',404,'СОП обучения недоступен');
 const r=sourceRevision(db,a.sop_revision_id);
 must(r.operation_id===a.operation_id&&r.source.sha256===a.source_sha256,409,'Редакция назначения изменилась');
 return {title:r.title,code:r.code,version_no:r.version_no,steps:rows(db,'SELECT position,action_text,key_points_json,reason_text,duration_seconds FROM document_step WHERE revision_id=? ORDER BY position',[r.id]).map(({key_points_json,...x})=>({...x,key_points:JSON.parse(key_points_json)}))};
}
