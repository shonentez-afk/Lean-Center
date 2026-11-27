// LC8.1 QA: server-only policy/projection foundation. Used by the isolated HTTP service.
// All account, grant, policy and date inputs MUST come from trusted server state.
// No client-supplied role, scope, actor, SQL, or resource attributes are accepted.
import {one,rows,isId} from '../../src/core/primitives.js';

import {READ_ACTIONS,PERMISSIONS,DIRECTORY_COMMANDS,LIBRARY_COMMANDS,TRAINING_COMMANDS} from './access-contract.mjs';
import {documentTitle} from '../../src/modules/library/revision-title.js';
export {READ_ACTIONS};
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const activePeriod=(x,day)=>!!x&&validDay(x.valid_from)&&x.valid_from<=day&&(x.valid_to===null||validDay(x.valid_to)&&day<=x.valid_to);
const unique=(items,predicate)=>{if(!Array.isArray(items))return null;const found=items.filter(predicate);return found.length===1?found[0]:null};
const activePerson=(db,id)=>isId(id)&&one(db,'SELECT id,display_name FROM person WHERE id=? AND archived=0',[id]);
function lineage(db,id){
 const found=new Set();
 while(id!==null){
  if(!isId(id)||found.has(id))return null;
  const u=one(db,'SELECT id,parent_id FROM org_unit WHERE id=? AND archived=0',[id]);
  if(!u)return null;
  found.add(id);id=u.parent_id;
 }
 return found.size?found:null;
}
const inside=(db,root,id)=>lineage(db,id)?.has(root)===true;
function unitsFor(db,person,day){
 const a=rows(db,'SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',[person,day,day]);
 return a.length===1&&lineage(db,a[0].unit_id)?[a[0].unit_id]:[];
}
// Fixed SQL, fixed output allowlists. No source JSON, full snapshots, logs,
// credentials, personal assessments, or attachment bytes in these projections.
// Composite resources must include every affected unit and current participant.
// The callers are server-only command handlers, never request-provided attributes.
export function personWorkResource(db,people,day,dates=[],operationIds=[]){
 const units=[];
 for(const id of new Set(people)){
  if(!activePerson(db,id))return null;
  for(const on of new Set([day,...dates])){
   if(!validDay(on))return null;
   const u=unitsFor(db,id,on);if(u.length!==1)return null;units.push(...u);
  }
 }
 for(const id of new Set(operationIds)){
  const o=one(db,'SELECT unit_id FROM operation WHERE id=? AND archived=0',[id]);
  if(!o||!lineage(db,o.unit_id))return null;units.push(o.unit_id);
 }
 return units.length?{data:{},self:null,units:[...new Set(units)],assigned:[]}:null;
}
// Templates are common to the enterprise; only the site-wide catalogue
// permission exposes them. Personal programme data uses all involved units.
export function programResource(db){
 const roots=rows(db,'SELECT id FROM org_unit WHERE parent_id IS NULL AND archived=0');
 return roots.length===1&&lineage(db,roots[0].id)?{data:{},self:null,units:[roots[0].id],assigned:[]}:null;
}
export function enrollmentResource(db,n,day){
 if(!n)return null;
 const tasks=rows(db,'SELECT t.sop_revision_id,d.operation_id FROM training_program_task t LEFT JOIN document_revision r ON r.id=t.sop_revision_id LEFT JOIN document d ON d.id=r.document_id WHERE t.program_id=?',[n.program_id]);
 if(!tasks.length||tasks.some(t=>t.sop_revision_id&&!t.operation_id))return null;
 const ops=tasks.filter(t=>t.sop_revision_id).map(t=>t.operation_id);
 const r=personWorkResource(db,[n.trainee_id,n.mentor_id,n.manager_id],day,[n.start_on],ops);
 return r?{...r,self:n.trainee_id,assigned:n.state==='active'?[n.mentor_id,n.manager_id]:[]}:null;
}
export function preparationResource(db,b,day){
 if(!b)return null;
 const records=[b.adaptation_id,b.safety_id,b.internship_id].map(id=>one(db,'SELECT * FROM training_enrollment WHERE id=?',[id]));
 if(records.some(n=>!n||n.trainee_id!==b.trainee_id))return null;
 const rr=records.map(n=>enrollmentResource(db,n,day)),manager=personWorkResource(db,[b.manager_id],day,[records[0].start_on]);
 if(!manager||rr.some(r=>!r))return null;
 return {data:{},self:b.trainee_id,units:[...new Set([...manager.units,...rr.flatMap(r=>r.units)])],assigned:records.some(n=>n.state==='active')?[b.manager_id]:[]};
}
export function trainingResource(db,operationId,people,day,extraDay=null){
 const op=one(db,'SELECT unit_id FROM operation WHERE id=? AND archived=0',[operationId]);
 if(!op||!lineage(db,op.unit_id)||!Array.isArray(people)||!people.length)return null;
 const units=[op.unit_id];
 for(const person of new Set(people.filter(Boolean))){
  if(!activePerson(db,person))return null;
  const current=unitsFor(db,person,day),historical=extraDay?unitsFor(db,person,extraDay):current;
  if(current.length!==1||historical.length!==1)return null;
  units.push(...current,...historical);
 }
 return {data:{},self:null,units:[...new Set(units)],assigned:[]};
}
export function trainingAssignmentResource(db,id,day,extraPeople=[],extraDay=null){
 const a=one(db,'SELECT * FROM training_assignment WHERE id=?',[id]);
 if(!a||!a.source_sha256)return null;
 const resource=trainingResource(db,a.operation_id,[a.trainee_id,a.mentor_id,a.supervisor_id,...extraPeople],day,extraDay);
 if(!resource)return null;
 const n=a.enrollment_id?enrollmentResource(db,one(db,'SELECT * FROM training_enrollment WHERE id=?',[a.enrollment_id]),day):null;
 if(a.enrollment_id&&!n)return null;
 return {...resource,units:[...new Set([...resource.units,...(n?.units||[])])],self:a.trainee_id,assigned:a.state!=='cancelled'?[a.trainee_id,a.mentor_id,a.supervisor_id].filter(Boolean):[]};
}
export function matrixResource(db,unit,roster,columns,day,baseOn){
 if(!lineage(db,unit)||!Array.isArray(roster)||!roster.length||!Array.isArray(columns)||!columns.length)return null;
 const units=[unit];
 for(const r of roster){
  if(!activePerson(db,r.person_id))return null;
  const current=unitsFor(db,r.person_id,day),historical=unitsFor(db,r.person_id,baseOn);
  if(current.length!==1||historical.length!==1||![...current,...historical].every(x=>inside(db,unit,x)))return null;
  units.push(...current,...historical);
 }
 for(const col of columns){
  const x=one(db,'SELECT s.operation_id,o.unit_id FROM skill s JOIN operation o ON o.id=s.operation_id WHERE s.id=? AND s.archived=0 AND o.archived=0',[col.skill_id]);
  const doc=one(db,"SELECT operation_id FROM document WHERE id=? AND kind='sop'",[col.document_id]);
  if(!x||!doc||doc.operation_id!==x.operation_id||!inside(db,unit,x.unit_id))return null;
  units.push(x.unit_id);
 }
 return {data:{},self:null,units:[...new Set(units)],assigned:[]};
}
function resolve(db,action,id,day){
 if(action==='matrix.read'){
  const m=one(db,'SELECT * FROM competency_matrix WHERE id=?',[id]);if(!m)return null;
  const roster=JSON.parse(m.roster_json),columns=JSON.parse(m.columns_json),resource=matrixResource(db,m.unit_id,roster,columns,day,m.base_on);
  if(!resource)return null;
  return {...resource,data:{id:m.id,code:m.code,title:m.title,version_no:m.version_no,base_on:m.base_on,target_on:m.target_on,state:m.state,rev:m.rev,unit_id:m.unit_id,people:roster.length,skills:columns.length}};
 }
 if(action==='person.read_basic'){
  const p=activePerson(db,id);
  if(!p)return null;
  return {data:{id:p.id,display_name:p.display_name},self:p.id,units:unitsFor(db,p.id,day),assigned:[]};
 }
 if(action==='person.read_directory'){
  const p=one(db,'SELECT id,employee_code,display_name,rev FROM person WHERE id=? AND archived=0',[id]),units=unitsFor(db,id,day);
  if(!p||units.length!==1)return null;
  const a=one(db,"SELECT u.name AS unit,COALESCE(pos.name,prof.name,'') AS position FROM person_assignment a JOIN org_unit u ON u.id=a.unit_id LEFT JOIN position pos ON pos.id=a.position_id LEFT JOIN profession prof ON prof.id=a.profession_id WHERE a.person_id=? AND a.valid_from<=? AND (a.valid_to IS NULL OR a.valid_to>=?)",[id,day,day]);
  return {data:{...p,...a},self:null,units,assigned:[]};
 }
 if(action==='sop.read_effective'){
  const r=one(db,"SELECT r.id AS revision_id,r.version_no,r.state,d.id AS document_id,d.code,d.title,o.id AS operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=? AND r.state='effective' AND d.kind='sop' AND d.archived=0 AND o.archived=0",[id]);
  if(!r||!lineage(db,r.unit_id))return null;
  const {unit_id,...data}=r;
  // Assigned access is not implemented for SOP until per-revision relation
  // resolution is verified. Only a unit-scoped permission can read this metadata.
  data.title=documentTitle(db,r.document_id,r.revision_id);
  return {data,self:null,units:[unit_id],assigned:[]};
 }
 if(action==='training.read'){
  const r=one(db,'SELECT a.id,a.trainee_id,a.mentor_id,a.operation_id,a.sop_revision_id,a.due_on,a.state,a.enrollment_id,o.unit_id FROM training_assignment a JOIN operation o ON o.id=a.operation_id WHERE a.id=? AND o.archived=0',[id]);
  if(!r||!lineage(db,r.unit_id)||!activePerson(db,r.trainee_id))return null;
  const {unit_id,mentor_id,enrollment_id,...data}=r;
  if(enrollment_id){
   const composite=trainingAssignmentResource(db,id,day);if(!composite)return null;
   return {...composite,data};
  }
  return {data,self:r.trainee_id,units:[unit_id],participantUnits:unitsFor(db,r.trainee_id,day),assigned:r.state==='planned'||r.state==='in_progress'?[r.trainee_id,mentor_id].filter(Boolean):[]};
 }
 if(action==='task.read'){
  const r=one(db,'SELECT id,title,due_on,state,owner_id,rev FROM action_item WHERE id=?',[id]);
  if(!r||!activePerson(db,r.owner_id))return null;
  // Owner-based access; standalone tasks also support unit scope. Linked finding/goal scope is not yet verified.
  const {owner_id,...data}=r;
  const standalone=one(db,`SELECT id FROM action_item WHERE id=? AND ${['finding_id','goal_id','subject_id','source_assessment_id','source_self_id','comparison_self_id','source_criterion_id','source_assignment_id','source_evaluation_id','source_weighted_event_id','source_weighted_position','followup_assignment_id','followup_enrollment_id','followup_plan_id'].map(k=>k+' IS NULL').join(' AND ')}`,[id]);
  return {data,self:owner_id,units:standalone?unitsFor(db,owner_id,day):[],assigned:[]};
 }
 if(action==='org.read'){
  const r=one(db,'SELECT id,code,name,kind,parent_id,rev FROM org_unit WHERE id=? AND archived=0',[id]);
  return r&&lineage(db,r.id)?{data:r,self:null,units:[r.id],assigned:[]}:null;
 }
 if(['operation.read','equipment.read','workplace.read'].includes(action)){
  const sql={
   'operation.read':'SELECT id,code,name,criticality,unit_id,equipment_id,workplace_id,rev FROM operation WHERE id=? AND archived=0',
   'equipment.read':'SELECT id,code,name,unit_id,rev FROM equipment WHERE id=? AND archived=0',
   'workplace.read':'SELECT id,code,name,unit_id,rev FROM workplace WHERE id=? AND archived=0'
  }[action];
  const r=one(db,sql,[id]);if(!r||!lineage(db,r.unit_id))return null;
  // Ref labels are limited to the object's own unit. No foreign unit refs.
  if(action==='operation.read'){
   for(const [key,table] of [['equipment_id','equipment'],['workplace_id','workplace']])if(r[key]&&!one(db,'SELECT id FROM '+table+' WHERE id=? AND unit_id=?',[r[key],r.unit_id]))return null;
  }
  return {data:r,self:null,units:[r.unit_id],assigned:[]};
 }
 if(action==='sop.read_history'||action==='sop.read_steps'){
  const r=one(db,"SELECT r.id AS revision_id,r.version_no,r.state,r.created_at,r.effective_at,r.review_due,r.print_format,r.changed_on,d.id AS document_id,d.code,d.rev AS document_rev,d.archived AS document_archived,o.id AS operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=? AND d.kind='sop' AND o.archived=0",[id]);
  if(!r||!lineage(db,r.unit_id)||action==='sop.read_steps'&&(r.state!=='effective'||!one(db,'SELECT id FROM document WHERE id=? AND archived=0',[r.document_id])))return null;
  const {unit_id,...data}=r;
  data.title=documentTitle(db,r.document_id,r.revision_id);
  if(action==='sop.read_steps'){
   // Verified domain projection, never source JSON or entire attachment.
   data.steps=rows(db,'SELECT position,action_text,key_points_json,reason_text,duration_seconds FROM document_step WHERE revision_id=? ORDER BY position',[id]).map(({key_points_json,...step})=>({...step,key_points:JSON.parse(key_points_json)}));
  }
  return {data,self:null,units:[unit_id],assigned:[]};
 }
 if(action==='frv.read'){
  const r=one(db,'SELECT f.id,f.title,f.state,f.observed_at,f.operation_id,f.revision_id,f.rev,o.unit_id FROM frv_study f JOIN operation o ON o.id=f.operation_id WHERE f.id=? AND o.archived=0',[id]);
  if(!r||!lineage(db,r.unit_id))return null;
  if(r.revision_id&&!one(db,'SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.operation_id=?',[r.revision_id,r.operation_id]))return null;
  const {unit_id,...data}=r;return {data,self:null,units:[unit_id],assigned:[]};
 }
 if(action==='program.read'){
  const r=one(db,'SELECT id,code,title,kind,standard_kind,version_no,state,rev FROM training_program WHERE id=?',[id]),resource=programResource(db);
  return r&&resource?{...resource,data:r}:null;
 }
 if(action==='training.enrollment.read'){
  const n=one(db,'SELECT * FROM training_enrollment WHERE id=?',[id]),resource=enrollmentResource(db,n,day);
  if(!resource)return null;
  const p=one(db,'SELECT title,kind,standard_kind,version_no FROM training_program WHERE id=?',[n.program_id]);
  return p?{...resource,data:{id:n.id,trainee_id:n.trainee_id,start_on:n.start_on,due_on:n.due_on,state:n.state,rev:n.rev,...p}}:null;
 }
 if(action==='preparation.read'){
  const b=one(db,'SELECT * FROM twi_preparation WHERE id=?',[id]),resource=preparationResource(db,b,day);
  if(!resource)return null;
  const programs=[b.adaptation_id,b.safety_id,b.internship_id].map(id=>one(db,'SELECT state FROM training_enrollment WHERE id=?',[id]));
  return {...resource,data:{id:b.id,trainee_id:b.trainee_id,category:b.category,created_at:b.created_at,adaptation:programs[0].state,safety:programs[1].state,internship:programs[2].state}};
 }
 if(action==='authorization.read'){
  const r=one(db,'SELECT id,person_id,operation_id,valid_from,valid_to,revoked_at,rev FROM mentor_authorization WHERE id=?',[id]);
  if(!r)return null;
  const resource=personWorkResource(db,[r.person_id],day,[r.valid_from],[r.operation_id]);
  return resource?{...resource,data:r,self:r.person_id}:null;
 }
 if(action==='credential.read'||action==='appointment.read'||action==='development.read'||action==='supplement.read'){
  const sql={
   'credential.read':'SELECT id,person_id,kind,role,issued_on,valid_until,revoked_at,rev FROM mentor_credential WHERE id=?',
   'appointment.read':'SELECT id,person_id,role,order_on,valid_from,valid_to,revoked_at,rev FROM mentor_appointment WHERE id=?',
   'development.read':'SELECT id,person_id,title,start_on,due_on,state FROM development_plan WHERE id=?',
   'supplement.read':'SELECT id,person_id,role,month,state FROM twi_supplement WHERE id=?'
  }[action];
  const r=one(db,sql,[id]);if(!r||!activePerson(db,r.person_id))return null;
  return {data:r,self:r.person_id,units:unitsFor(db,r.person_id,day),assigned:[]};
 }
 if(action==='audit.read'){
  const r=one(db,'SELECT a.id,a.mentor_id,a.auditor_id,a.trainee_id,a.operation_id,a.observed_at,a.state,o.unit_id FROM audit_session a JOIN operation o ON o.id=a.operation_id WHERE a.id=? AND o.archived=0',[id]);
  if(!r||!lineage(db,r.unit_id)||!activePerson(db,r.mentor_id))return null;
  const {unit_id,auditor_id,trainee_id,...data}=r;
  // Scope must contain the operation and all assessed participants; no free
  // text, responses, evidence, or named trainee data is projected.
  const subjectUnits=[...unitsFor(db,r.mentor_id,day),...(trainee_id?unitsFor(db,trainee_id,day):[])];
  const complete=unitsFor(db,r.mentor_id,day).length>0&&(!trainee_id||unitsFor(db,trainee_id,day).length>0);
  return {data,self:r.mentor_id,units:[unit_id],participantUnits:complete?subjectUnits:[],assigned:r.state==='draft'?[auditor_id]:[]};
 }
 if(action==='roi.read'){
  const r=one(db,'SELECT id,title,owner_id,unit_id,study_id,action_id,currency,method,review_due,state FROM economic_effect WHERE id=?',[id]);
  if(!r||!lineage(db,r.unit_id)||!activePerson(db,r.owner_id))return null;
  let sourceUnits=[];
  if(r.study_id){const src=resolve(db,'frv.read',r.study_id,day);if(!src)return null;sourceUnits=src.units}
  else if(r.action_id){const src=resolve(db,'task.read',r.action_id,day);if(!src?.units.length)return null;sourceUnits=src.units}
  else return null;
  const {unit_id,study_id,action_id,...data}=r;
  return {data,self:null,units:[unit_id,...sourceUnits],participantUnits:unitsFor(db,r.owner_id,day),assigned:[]};
 }
 if(action==='calendar.read'){
  const r=one(db,'SELECT id,kind,owner_id,due_on,state FROM schedule_event WHERE id=?',[id]);
  if(!r||!activePerson(db,r.owner_id))return null;
  const {owner_id,...data}=r;
  // Source relations are not yet fully classified. Expose only the owner's
  // generic calendar entry; never the source id or another person's calendar.
  return {data,self:owner_id,units:[],assigned:[]};
 }
 return null;
}
function scopeAllows(db,scope,person,resource){
 if(!scope||typeof scope!=='object')return false;
 if(scope.kind==='self')return Object.keys(scope).length===1&&!!person&&resource.self===person;
 if(scope.kind==='assigned')return Object.keys(scope).length===1&&resource.assigned.includes(person);
 if(scope.kind==='unit_tree'){
  if(Object.keys(scope).length!==2||!isId(scope.unit_id)||!lineage(db,scope.unit_id)||!resource.units.length)return false;
  return resource.units.every(id=>inside(db,scope.unit_id,id))&&
   (!resource.participantUnits||resource.participantUnits.length>0&&resource.participantUnits.every(id=>inside(db,scope.unit_id,id)));
 }
 return false;
}
// Each grant binds ONE existing business_role and role_assignment to ONE scope.
// Policy revision changes fail closed until grants are reconfirmed. The current
// policy per role must be unique. Business roles alone never give permissions.
function decide(db,security,accountId,action,resourceId,day,resourceAction=action,trustedResource=null){
 if(!PERMISSIONS.includes(action)||!isId(accountId)||!isId(resourceId)||!validDay(day))return null;
 const account=unique(security?.accounts,x=>x?.id===accountId);
 if(account?.state!=='active'||!activePerson(db,account.person_id))return null;
 if(security.accounts.filter(x=>x?.person_id===account.person_id&&x.state==='active').length!==1)return null;
 if(!Array.isArray(security.grants)||!Array.isArray(security.policies))return null;
 const resource=trustedResource||resolve(db,resourceAction,resourceId,day);
 if(!resource||action==='task.implement_own'&&resource.self!==account.person_id)return null;
 for(const grant of security.grants){
  if(grant?.account_id!==accountId||grant.state!=='active'||grant.revoked_at!==null||!activePeriod(grant,day)||!isId(grant.id)||!isId(grant.role_id)||!isId(grant.assignment_id))continue;
  const role=one(db,'SELECT id FROM business_role WHERE id=? AND archived=0',[grant.role_id]);
  const assignment=one(db,'SELECT person_id,role_id,valid_from,valid_to FROM role_assignment WHERE id=?',[grant.assignment_id]);
  if(!role||assignment?.person_id!==account.person_id||assignment.role_id!==role.id||!activePeriod(assignment,day))continue;
  const policy=unique(security.policies,x=>x?.role_id===role.id);
  if(!policy||!Number.isSafeInteger(policy.revision)||policy.revision<1||grant.policy_revision!==policy.revision||!Array.isArray(policy.permissions)||!policy.permissions.includes(action))continue;
  if((![...DIRECTORY_COMMANDS,...LIBRARY_COMMANDS,...TRAINING_COMMANDS.filter(x=>!['training.stage','training.enrollment.result'].includes(x)),'matrix.detail'].includes(action)||grant.scope.kind==='unit_tree')&&scopeAllows(db,grant.scope,account.person_id,resource))return {data:resource.data,decision:{grantId:grant.id,roleId:role.id,policyRevision:policy.revision}};
 }
 return null;
}

// Only called for the explicit server bootstrap manager profile. No request
// can supply this identity or its scope. Unimplemented linked tasks stay denied.
export function readManagerProjection(db,site,action,id,day){
 if(!READ_ACTIONS.includes(action)||!isId(site)||!isId(id)||!validDay(day))return null;
 const resource=resolve(db,action,id,day);
 return resource&&scopeAllows(db,{kind:'unit_tree',unit_id:site},null,resource)?{data:resource.data}:null;
}

export function readAuthorized(db,security,accountId,action,resourceId,day){
 return READ_ACTIONS.includes(action)?decide(db,security,accountId,action,resourceId,day):null;
}
export function canImplementOwnTask(db,security,accountId,id,day){
 return !!decide(db,security,accountId,'task.implement_own',id,day,'task.read');
}

// Directory changes are never self/assigned privileges. The caller chooses
// the fixed action and resource anchor from the closed directory contract.
export function canChangeDirectory(db,security,accountId,action,anchorAction,id,day){
 return DIRECTORY_COMMANDS.includes(action)&&!!decide(db,security,accountId,action,id,day,anchorAction);
}

export function canReadSopPhoto(db,security,accountId,id,day){return !!decide(db,security,accountId,'sop.read_photo',id,day,'sop.read_steps')}

// Closed command/detail actions with a trusted resource anchor. No client
// selects the anchor type: library-commands.mjs fixes it for each operation.
export function canUseLibrary(db,security,accountId,action,anchorAction,id,day){
 const allowed=['sop.create','sop.edit_draft','sop.revise','sop.passport','sop.from_frv','frv.create','frv.edit_draft','frv.finalize','sop.read_twi','sop.read_linked_frv','frv.read_summary'];
 return allowed.includes(action)&&!!decide(db,security,accountId,action,id,day,anchorAction);
}

export function canReadLibraryAtOperation(db,security,accountId,kind,id,day){
 const action=kind==='sop'?'sop.read_history':kind==='frv'?'frv.read':null;
 return !!action&&!!decide(db,security,accountId,action,id,day,'operation.read');
}

export function canUseTrainingResource(db,security,accountId,action,id,day,resource){
 const allowed=[...TRAINING_COMMANDS,'training.detail','training.read_sop','matrix.detail','training.read','matrix.read','credential.read','appointment.read','authorization.read','program.read','program.detail','training.enrollment.read','training.enrollment.detail','preparation.read','preparation.detail'];
 return !!resource&&allowed.includes(action)&&!!decide(db,security,accountId,action,id,day,action,resource);
}
export function bootstrapTrainingScope(db,site,resource){
 return !!resource&&scopeAllows(db,{kind:'unit_tree',unit_id:site},null,resource);
}
export function canReadPersonCard(db,security,accountId,id,day){
 return !!decide(db,security,accountId,'person.read_card',id,day,'person.read_basic');
}
