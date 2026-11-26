// LC8.1 QA: server-only policy/projection foundation. Used by the isolated HTTP service.
// All account, grant, policy and date inputs MUST come from trusted server state.
// No client-supplied role, scope, actor, SQL, or resource attributes are accepted.
import {one,rows,isId} from '../../src/core/primitives.js';

import {READ_ACTIONS,PERMISSIONS,DIRECTORY_COMMANDS} from './access-contract.mjs';
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
function resolve(db,action,id,day){
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
  const r=one(db,'SELECT a.id,a.trainee_id,a.mentor_id,a.operation_id,a.sop_revision_id,a.due_on,a.state,o.unit_id FROM training_assignment a JOIN operation o ON o.id=a.operation_id WHERE a.id=? AND o.archived=0',[id]);
  if(!r||!lineage(db,r.unit_id)||!activePerson(db,r.trainee_id))return null;
  const {unit_id,mentor_id,...data}=r;
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
  const r=one(db,"SELECT r.id AS revision_id,r.version_no,r.state,r.created_at,r.effective_at,r.review_due,d.id AS document_id,d.code,o.id AS operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=? AND d.kind='sop' AND o.archived=0",[id]);
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
  const r=one(db,'SELECT f.id,f.title,f.state,f.observed_at,f.operation_id,f.revision_id,o.unit_id FROM frv_study f JOIN operation o ON o.id=f.operation_id WHERE f.id=? AND o.archived=0',[id]);
  if(!r||!lineage(db,r.unit_id))return null;
  if(r.revision_id&&!one(db,'SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.operation_id=?',[r.revision_id,r.operation_id]))return null;
  const {unit_id,...data}=r;return {data,self:null,units:[unit_id],assigned:[]};
 }
 if(action==='training.enrollment.read'){
  const r=one(db,'SELECT e.id,e.trainee_id,e.mentor_id,e.manager_id,e.start_on,e.due_on,e.state,p.title,p.kind,p.version_no FROM training_enrollment e JOIN training_program p ON p.id=e.program_id WHERE e.id=?',[id]);
  if(!r||!activePerson(db,r.trainee_id))return null;
  const {mentor_id,manager_id,...data}=r;
  return {data,self:r.trainee_id,units:unitsFor(db,r.trainee_id,day),assigned:r.state==='active'?[mentor_id,manager_id]:[]};
 }
 if(action==='preparation.read'){
  const r=one(db,'SELECT id,trainee_id,manager_id,category,created_at,adaptation_id,safety_id,internship_id FROM twi_preparation WHERE id=?',[id]);
  if(!r||!activePerson(db,r.trainee_id))return null;
  const programs=[r.adaptation_id,r.safety_id,r.internship_id].map(id=>one(db,'SELECT trainee_id,state FROM training_enrollment WHERE id=?',[id]));
  if(programs.some(p=>!p||p.trainee_id!==r.trainee_id))return null;
  const data={id:r.id,trainee_id:r.trainee_id,category:r.category,created_at:r.created_at,adaptation:programs[0].state,safety:programs[1].state,internship:programs[2].state};
  return {data,self:r.trainee_id,units:unitsFor(db,r.trainee_id,day),assigned:programs.some(p=>p.state==='active')?[r.manager_id]:[]};
 }
 if(action==='credential.read'||action==='appointment.read'||action==='development.read'||action==='supplement.read'){
  const sql={
   'credential.read':'SELECT id,person_id,kind,role,issued_on,valid_until,revoked_at FROM mentor_credential WHERE id=?',
   'appointment.read':'SELECT id,person_id,role,order_on,valid_from,valid_to,revoked_at FROM mentor_appointment WHERE id=?',
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
function decide(db,security,accountId,action,resourceId,day,resourceAction=action){
 if(!PERMISSIONS.includes(action)||!isId(accountId)||!isId(resourceId)||!validDay(day))return null;
 const account=unique(security?.accounts,x=>x?.id===accountId);
 if(account?.state!=='active'||!activePerson(db,account.person_id))return null;
 if(security.accounts.filter(x=>x?.person_id===account.person_id&&x.state==='active').length!==1)return null;
 if(!Array.isArray(security.grants)||!Array.isArray(security.policies))return null;
 const resource=resolve(db,resourceAction,resourceId,day);
 if(!resource||action==='task.implement_own'&&resource.self!==account.person_id)return null;
 for(const grant of security.grants){
  if(grant?.account_id!==accountId||grant.state!=='active'||grant.revoked_at!==null||!activePeriod(grant,day)||!isId(grant.id)||!isId(grant.role_id)||!isId(grant.assignment_id))continue;
  const role=one(db,'SELECT id FROM business_role WHERE id=? AND archived=0',[grant.role_id]);
  const assignment=one(db,'SELECT person_id,role_id,valid_from,valid_to FROM role_assignment WHERE id=?',[grant.assignment_id]);
  if(!role||assignment?.person_id!==account.person_id||assignment.role_id!==role.id||!activePeriod(assignment,day))continue;
  const policy=unique(security.policies,x=>x?.role_id===role.id);
  if(!policy||!Number.isSafeInteger(policy.revision)||policy.revision<1||grant.policy_revision!==policy.revision||!Array.isArray(policy.permissions)||!policy.permissions.includes(action))continue;
  if((!DIRECTORY_COMMANDS.includes(action)||grant.scope.kind==='unit_tree')&&scopeAllows(db,grant.scope,account.person_id,resource))return {data:resource.data,decision:{grantId:grant.id,roleId:role.id,policyRevision:policy.revision}};
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
