// Typed protected training commands. The LC4/LC6 domain remains authoritative.
import {one,rows,isId,uuid,canonical,applyEvent} from '../../src/core/db.js';
import {activeAuthorizations,practicalMethods,practicalCriteria,admissionStatus,conclusions} from '../../src/modules/training/domain.js';
import {progressFor,currentStandard,latestVerification,latestAssessment,variants} from '../../src/modules/training/training-facts.js';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {matchesRoleKind} from '../../src/modules/master-data/role-matching.js';
import {trainingResource,trainingAssignmentResource} from './read-policy.mjs';
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
 const people=directoryPeople(db,access.day).filter(p=>allowedPerson(db,access,p.id)&&p.roles.some(r=>matchesRoleKind(r,'trainee'))&&access.allows('training.create',operationId,trainingResource(db,operationId,[p.id],access.day))).map(p=>({id:p.id,name:p.display_name}));
 const mentors=activeAuthorizations(db,operationId,access.day).filter(x=>allowedPerson(db,access,x.person_id)&&access.allows('training.create',operationId,trainingResource(db,operationId,[x.person_id],access.day))).map(x=>({id:x.id,person_id:x.person_id,name:label(db,x.person_id)}));
 const revisions=rows(db,"SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='effective' AND d.archived=0 AND d.operation_id=?",[operationId]).flatMap(({id})=>{
  const r=access.read('sop.read_effective',id);
  return r?[{id,title:r.data.title,steps:one(db,'SELECT count(*) n FROM document_step WHERE revision_id=?',[id]).n}]:[];
 });
 const skills=rows(db,'SELECT id,name FROM skill WHERE archived=0 AND operation_id=? ORDER BY name',[operationId]);
 const scales=rows(db,'SELECT id,name FROM rating_scale WHERE archived=0 ORDER BY name').map(x=>({...x,levels:rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[x.id])}));
 return {operations,people,mentors,revisions,skills,scales,variants,day:access.day};
}
export const CREATE_FIELDS=Object.freeze(['operation_id','trainee_id','authorization_id','revision_id','skill_id','scale_id','target_level','assigned_on','due_on','reason','variant','method_config','plan_reviewed']);
export function resolveTrainingCreate(db,input,access){
 must(exact(input,CREATE_FIELDS)&&access.personId&&isId(input.operation_id)&&isId(input.trainee_id)&&isId(input.authorization_id)&&isId(input.revision_id)&&date(input.assigned_on)&&date(input.due_on)&&input.assigned_on>=access.day&&input.plan_reviewed===true,400,'Заполните назначение и подтверждение плана');
 must(access.read('operation.read',input.operation_id)&&access.read('sop.read_effective',input.revision_id)&&allowedPerson(db,access,input.trainee_id),403,'Данные назначения недоступны');
 const auth=one(db,'SELECT * FROM mentor_authorization WHERE id=? AND operation_id=?',[input.authorization_id,input.operation_id]);
 must(auth&&allowedPerson(db,access,auth.person_id),403,'Инструктор недоступен');
 const resource=trainingResource(db,input.operation_id,[input.trainee_id,auth.person_id],access.day,input.assigned_on);
 must(access.allows('training.create',input.operation_id,resource),403,'Назначение выходит за область полномочий');
 const r=sourceRevision(db,input.revision_id);
 must(r.operation_id===input.operation_id,422,'СОП относится к другой операции');
 return {source:r.source,payload:{trainee_id:input.trainee_id,mentor_id:auth.person_id,supervisor_id:null,authorization_id:auth.id,revision_id:r.id,source:r.source,skill_id:input.skill_id,scale_id:input.scale_id,target_level:input.target_level,assigned_by:access.personId,assigned_on:input.assigned_on,due_on:input.due_on,reason:input.reason,variant:input.variant,method_version:'JI-2',method_config:input.method_config,shift_id:null,enrollment_id:null,program_task_id:null,plan_reviewed:true}};
}
export function createTraining(db,resolved,access){
 const id=uuid();emit(db,access,'training_assignment',id,'create',0,resolved.payload,'training.create');
 return {id,rev:1,state:'planned'};
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
 const decisions=pendingApprovals(db,a).filter(v=>approvalValid(db,a,v,access)).map(v=>({kind:v.kind,decided_at:v.decided_at}));
 const verification=['safety','theory'].map(kind=>{const v=latestVerification(db,a.id,kind);return {kind,result:v?.result??null,day:v?.evaluated_on??null}});
 const practical=latestAssessment(db,a.id,'practical'),q=latestAssessment(db,a.id,'qualification'),item=q&&one(db,'SELECT level,observation_state,valid_until FROM assessment_item WHERE session_id=?',[q.id]);
 const method=practicalMethods(db).find(m=>m.state==='active');
 const methods=cap.practical&&method?[{id:method.id,criteria:practicalCriteria(db,method.id).map(x=>({id:x.id,question:x.question,section:x.section_code}))}]:[];
 const witnesses=cap.stage?directoryPeople(db,access.day).filter(p=>allowedPerson(db,access,p.id)&&allowed(db,access,a,'training.stage',[p.id])).map(p=>({id:p.id,name:p.display_name})):[];
 return {id:a.id,rev:a.rev,state:a.state,trainee:label(db,a.trainee_id),mentor:label(db,a.mentor_id),assigned_on:a.assigned_on,due_on:a.due_on,operation:one(db,'SELECT name FROM operation WHERE id=?',[a.operation_id])?.name,method_variant:a.method_variant,method_version:a.method_version,approved:approved(a),pending_approvals:decisions,stages:pr.stages.map(s=>({code:s.code,label:s.label,done:pr.done.has(s.code)})),next:pr.next?.code??null,completed:pr.completed,complete:pr.complete,
 facts:pr.facts.map(f=>({stage_code:f.stage_code,held_at:f.held_at,duration_minutes:f.duration_minutes,result:f.result,notes:f.notes})),
 verification,practical:practical?{id:practical.id,conclusion:practical.conclusion}:null,qualification:item||null,admission:admissionStatus(db,a.trainee_id,a.operation_id,access.day).status,cap,methods,witnesses,conclusions,levels:rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[a.scale_id]),day:access.day};
}
export function trainingSop(db,access,id){
 const a=visible(db,access,id);
 must(allowed(db,access,a,'training.read_sop')&&a.state!=='cancelled',404,'СОП обучения недоступен');
 const r=sourceRevision(db,a.sop_revision_id);
 must(r.operation_id===a.operation_id&&r.source.sha256===a.source_sha256,409,'Редакция назначения изменилась');
 return {title:r.title,code:r.code,version_no:r.version_no,steps:rows(db,'SELECT position,action_text,key_points_json,reason_text,duration_seconds FROM document_step WHERE revision_id=? ORDER BY position',[r.id]).map(({key_points_json,...x})=>({...x,key_points:JSON.parse(key_points_json)}))};
}
