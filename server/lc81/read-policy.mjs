// LC8.1 QA: server-only policy/projection foundation. Used by the isolated HTTP service.
// All account, grant, policy and date inputs MUST come from trusted server state.
// No client-supplied role, scope, actor, SQL, or resource attributes are accepted.
import {scheduleKind,scheduleScopeDate} from '../../src/modules/training/center-planning.js';
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
 return {data:{},self:b.trainee_id,units:[...new Set([...manager.units,...rr.flatMap(r=>r.units)])],assigned:records.some(n=>n.state==='active')?[b.manager_id,records[2].mentor_id,records[2].manager_id]:[]};
}
export function orderResource(db,o,day){
 const members=rows(db,'SELECT person_id,acknowledged_on FROM mentor_appointment WHERE order_id=?',[o.id]);
 return members.length?personWorkResource(db,[o.approved_by,...members.map(m=>m.person_id)],day,[o.order_on,o.valid_from,...members.map(m=>m.acknowledged_on)]):null;
}
export function supplementResource(db,n,day,tasks=[]){
 const r=personWorkResource(db,[n.person_id,n.manager_id],day,tasks.map(t=>t.done_on));
 return r?{...r,self:n.person_id,assigned:n.state==='draft'?[n.manager_id]:[]}:null;
}
// The calendar never accepts an arbitrary source table. Resolve the
// three LC5 planning types, including linked fact participants.
export function scheduleResource(db,s,day){
 if(!s||!s.owner_id||!s.source_id)return null;
 const type=scheduleKind(s),on=scheduleScopeDate(db,s,day),owner=personWorkResource(db,[s.owner_id],day,[on]);
 if(!owner)return null;
 let r=null,extra=null;
 if(type==='audit'||type==='practical'){
  r=trainingAssignmentResource(db,s.source_id,day,[s.owner_id],on);
  if(type==='audit'&&s.completed_audit_id)extra=auditResource(db,one(db,'SELECT * FROM audit_session WHERE id=?',[s.completed_audit_id]),day);
  if(type==='practical'&&s.completed_assessment_id)extra=assessmentResource(db,one(db,'SELECT * FROM assessment_session WHERE id=?',[s.completed_assessment_id]),day);
  if(s.completed_audit_id&&!extra||s.completed_assessment_id&&!extra)return null;
 }else if(type==='self_eval'&&s.source_id===s.owner_id){
  r=selfResource(db,{person_id:s.owner_id,evaluated_on:on},day);
  if(s.completed_self_id){extra=selfResource(db,one(db,'SELECT * FROM mentor_self_evaluation WHERE id=?',[s.completed_self_id]),day);if(!extra)return null}
 }
 if(!r)return null;
 return {data:{},self:s.owner_id,units:[...new Set([...owner.units,...r.units,...(extra?.units||[])])],assigned:[]};
}
export function skillResource(db,s){
 if(!s||s.archived)return null;
 if(!s.operation_id)return programResource(db);
 const o=one(db,'SELECT unit_id FROM operation WHERE id=? AND archived=0',[s.operation_id]);
 return o&&lineage(db,o.unit_id)?{data:{},self:null,units:[o.unit_id],assigned:[]}:null;
}
export function requirementResource(db,r){
 const site=programResource(db),s=r&&one(db,'SELECT * FROM skill WHERE id=?',[r.skill_id]),resource=skillResource(db,s);
 return site&&resource?{...site,units:[...new Set([...site.units,...resource.units])]}:null;
}
export function coverageResource(db,r){
 if(!r||!lineage(db,r.unit_id))return null;
 const s=one(db,'SELECT * FROM skill WHERE id=? AND archived=0',[r.skill_id]);
 if(!s)return null;
 const o=s.operation_id?one(db,'SELECT unit_id FROM operation WHERE id=? AND archived=0',[s.operation_id]):null;
 if(s.operation_id&&(!o||!lineage(db,o.unit_id)))return null;
 return {data:{},self:null,units:[...new Set([r.unit_id,...(o?[o.unit_id]:[])])],assigned:[]};
}
export function assessmentResource(db,r,day){
 if(!r||r.state!=='confirmed'||!r.assessed_at)return null;
 if(r.assessment_kind==='general_skill'){
  const items=rows(db,'SELECT s.operation_id FROM assessment_item i JOIN skill s ON s.id=i.skill_id WHERE i.session_id=?',[r.id]);
  if(items.length!==1||items[0].operation_id!==null||r.operation_id||r.assignment_id||r.standard_revision_id)return null;
  const x=personWorkResource(db,[r.person_id,r.evaluator_id],day,[r.assessed_at.slice(0,10)]);
  return x?{...x,self:r.person_id}:null;
 }
 return practicalResource(db,r,day);
}
export function auditResource(db,a,day){
 if(!a||!a.operation_id||!a.mentor_id||!a.auditor_id||!a.trainee_id||!a.observed_at)return null;
 const r=personWorkResource(db,[a.mentor_id,a.auditor_id,a.trainee_id],day,[a.observed_at.slice(0,10)],[a.operation_id]);
 if(!r)return null;
 const t=a.assignment_id?trainingAssignmentResource(db,a.assignment_id,day):null;
 if(a.assignment_id&&!t)return null;
 return {...r,units:[...new Set([...r.units,...(t?.units||[])])],self:a.mentor_id,assigned:[]};
}
export function selfResource(db,s,day){
 if(!s)return null;const r=personWorkResource(db,[s.person_id],day,[s.evaluated_on]);
 return r?{...r,self:s.person_id}:null;
}
export function developmentResource(db,p,day,extraSkills=[]){
 if(!p)return null;
 const skills=[...rows(db,'SELECT skill_id FROM development_goal WHERE plan_id=? AND skill_id IS NOT NULL',[p.id??'']).map(g=>g.skill_id),...extraSkills];
 const ops=[];for(const id of new Set(skills)){const s=one(db,'SELECT operation_id FROM skill WHERE id=?',[id]);if(!s)return null;if(s.operation_id)ops.push(s.operation_id)}
 const r=personWorkResource(db,[p.person_id],day,[p.start_on],ops);
 return r?{...r,self:p.person_id}:null;
}
export function practicalResource(db,p,day){
 if(!p||!p.assignment_id||!p.operation_id)return null;
 const r=trainingAssignmentResource(db,p.assignment_id,day,[p.evaluator_id],p.assessed_at.slice(0,10));
 return r?{...r,self:p.person_id}:null;
}
export function sopEvaluationResource(db,kind,id,day){
 if(!isId(id))return null;
 let v;
 if(kind==='sop_evaluation')v=one(db,"SELECT e.actor_id,e.evaluated_on AS on_date,e.revision_id,d.operation_id FROM sop_evaluation e JOIN document_revision r ON r.id=e.revision_id JOIN document d ON d.id=r.document_id WHERE e.id=? AND d.kind='sop'",[id]);
 else if(kind==='weighted_sop')v=one(db,"SELECT json_extract(e.payload_json,'$.actor_id') actor_id,substr(e.occurred_at,1,10) on_date,r.id revision_id,d.operation_id FROM change_event e JOIN sop_stage43_checklist c ON c.id=e.entity_id JOIN document_revision r ON r.id=c.revision_id JOIN document d ON d.id=r.document_id WHERE e.id=? AND e.entity_type='sop_stage43_checklist' AND d.kind='sop'",[id]);
 if(!v||!v.operation_id||!validDay(v.on_date))return null;
 const res=personWorkResource(db,v.actor_id?[v.actor_id]:[],day,[v.on_date],[v.operation_id]);
 return res?{...res,self:null,assigned:[],revision_id:v.revision_id,actor_id:v.actor_id}:null;
}
export function taskResource(db,t,day){
 if(!t)return null;
 const r=personWorkResource(db,[t.owner_id,...(t.subject_id?[t.subject_id]:[])],day,t.created_at?[t.created_at.slice(0,10)]:[]);
 if(!r)return null;
 const rs=[r],add=x=>{if(!x)return false;rs.push(x);return true};
 // Only resolved, supported source types get a detailed composite resource.
 if(t.comparison_self_id&&!add(selfResource(db,one(db,'SELECT * FROM mentor_self_evaluation WHERE id=?',[t.comparison_self_id]),day)))return null;
 if(t.source_self_id&&!add(selfResource(db,one(db,'SELECT * FROM mentor_self_evaluation WHERE id=?',[t.source_self_id]),day)))return null;
 if(t.source_assessment_id&&!add(practicalResource(db,one(db,'SELECT * FROM assessment_session WHERE id=?',[t.source_assessment_id]),day)))return null;
 if(t.source_assignment_id&&!add(trainingAssignmentResource(db,t.source_assignment_id,day)))return null;
 if(t.source_evaluation_id&&!add(sopEvaluationResource(db,'sop_evaluation',t.source_evaluation_id,day)))return null;
 if(t.source_weighted_event_id&&!add(sopEvaluationResource(db,'weighted_sop',t.source_weighted_event_id,day)))return null;
 if(t.source_weighted_position&&!t.source_weighted_event_id)return null;
 if(t.goal_id){
  const p=one(db,'SELECT p.* FROM development_goal g JOIN development_plan p ON p.id=g.plan_id WHERE g.id=?',[t.goal_id]);
  if(!add(developmentResource(db,p,day)))return null;
 }
 if(t.finding_id){
  const finding=one(db,'SELECT * FROM finding WHERE id=?',[t.finding_id]);if(!finding)return null;
  if(finding.audit_response_id){
   const a=one(db,'SELECT a.* FROM audit_response r JOIN audit_session a ON a.id=r.audit_id WHERE r.id=?',[finding.audit_response_id]);
   if(!add(auditResource(db,a,day)))return null;
  }else if(finding.document_revision_id){
   const d=one(db,'SELECT d.operation_id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=?',[finding.document_revision_id]);
   if(!d||!add(personWorkResource(db,[t.owner_id],day,[],[d.operation_id])))return null;
  }else if(finding.study_id){
   const d=one(db,'SELECT operation_id FROM frv_study WHERE id=?',[finding.study_id]);if(!d||!add(personWorkResource(db,[t.owner_id],day,[],[d.operation_id])))return null;
  }else return null;
 }
 if(t.followup_assignment_id&&!add(trainingAssignmentResource(db,t.followup_assignment_id,day)))return null;
 if(t.followup_enrollment_id&&!add(enrollmentResource(db,one(db,'SELECT * FROM training_enrollment WHERE id=?',[t.followup_enrollment_id]),day)))return null;
 if(t.followup_plan_id&&!add(developmentResource(db,one(db,'SELECT * FROM development_plan WHERE id=?',[t.followup_plan_id]),day)))return null;
 return {data:{},self:t.owner_id,units:[...new Set(rs.flatMap(x=>x.units))],assigned:[]};
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
  if(col.document_id===null){if(!one(db,'SELECT s.id FROM skill s JOIN skill_category c ON c.id=s.category_id WHERE s.id=? AND s.archived=0 AND c.archived=0 AND s.operation_id IS NULL',[col.skill_id]))return null;continue}
  const x=one(db,'SELECT s.operation_id,o.unit_id FROM skill s JOIN operation o ON o.id=s.operation_id WHERE s.id=? AND s.archived=0 AND o.archived=0',[col.skill_id]);
  const doc=one(db,"SELECT operation_id FROM document WHERE id=? AND kind='sop'",[col.document_id]);
  if(!x||!doc||doc.operation_id!==x.operation_id||!inside(db,unit,x.unit_id))return null;
  units.push(x.unit_id);
 }
 return {data:{},self:null,units:[...new Set(units)],assigned:[]};
}
const siteCatalogs=Object.freeze({'profession.read':'profession','position.read':'position','shift.read':'work_shift','category.read':'skill_category','scale.read':'rating_scale','role.read':'business_role'});
export function employmentResource(db,x,day){
 if(!x||!activePerson(db,x.person_id)||!lineage(db,x.unit_id))return null;
 const u=unitsFor(db,x.person_id,day);if(u.length!==1)return null;
 return {data:{},self:x.person_id,units:[...new Set([...u,x.unit_id])],assigned:[]};
}
function resolve(db,action,id,day){
 if(Object.hasOwn(siteCatalogs,action)){
  const t=siteCatalogs[action],x=one(db,'SELECT * FROM '+t+' WHERE id=? AND archived=0',[id]),r=programResource(db);
  if(!x||!r)return null;
  const data={id:x.id,name:x.name,rev:x.rev};
  if(['profession','position','work_shift','business_role'].includes(t))data.code=x.code;
  if(t==='rating_scale'){data.version_no=x.version_no;data.levels=rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[id]).map(l=>l.value+': '+l.label).join('\n')}
  return {...r,data};
 }
 if(action==='employment.read'){
  const x=one(db,'SELECT * FROM person_assignment WHERE id=?',[id]),r=employmentResource(db,x,day);
  return r?{...r,data:{id:x.id,person_id:x.person_id,unit_id:x.unit_id,profession_id:x.profession_id,position_id:x.position_id,shift_id:x.shift_id,shift_code:x.shift_code,valid_from:x.valid_from,valid_to:x.valid_to,rev:x.rev}}:null;
 }
 if(action==='role_assignment.read'){
  const x=one(db,'SELECT * FROM role_assignment WHERE id=?',[id]);
  if(!x||!activePerson(db,x.person_id))return null;
  const u=unitsFor(db,x.person_id,day),v=unitsFor(db,x.person_id,x.valid_from);
  if(u.length!==1||v.length!==1)return null;
  return {data:{id:x.id,person_id:x.person_id,role_id:x.role_id,valid_from:x.valid_from,valid_to:x.valid_to,rev:x.rev},self:x.person_id,units:[...new Set([...u,...v])],assigned:[]};
 }
 if(action==='skill.read'){
  const s=one(db,'SELECT * FROM skill WHERE id=?',[id]),r=skillResource(db,s);
  return r?{...r,data:{id:s.id,name:s.name,category_id:s.category_id,operation_id:s.operation_id,rev:s.rev}}:null;
 }
 if(action==='requirement.read'){
  const x=one(db,'SELECT * FROM role_requirement WHERE id=?',[id]),r=requirementResource(db,x);
  return r?{...r,data:x}:null;
 }
 if(action==='coverage.read'){
  const x=one(db,'SELECT * FROM coverage_requirement WHERE id=?',[id]),r=coverageResource(db,x);
  return r?{...r,data:x}:null;
 }
 if(action==='assessment.read'){
  const x=one(db,'SELECT * FROM assessment_session WHERE id=?',[id]),r=assessmentResource(db,x,day);
  return r?{...r,data:{id:x.id,person_id:x.person_id,assessed_on:x.assessed_at.slice(0,10),kind:x.assessment_kind,state:x.state,rev:x.rev}}:null;
 }
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
   return {...composite,data,assigned:r.state==='planned'||r.state==='in_progress'?composite.assigned:[]};
  }
  return {data,self:r.trainee_id,units:[unit_id],participantUnits:unitsFor(db,r.trainee_id,day),assigned:r.state==='planned'||r.state==='in_progress'?[r.trainee_id,mentor_id].filter(Boolean):[]};
 }
 if(action==='task.read'){
  const r=one(db,'SELECT * FROM action_item WHERE id=?',[id]);if(!r||!activePerson(db,r.owner_id))return null;
  const data={id:r.id,title:r.title,due_on:r.due_on,state:r.state,rev:r.rev};
  const resource=taskResource(db,r,day);
  // Keep minimal own-task visibility for legacy unsupported links, but
  // never expose full evidence or allow unit-scope management of them.
  return resource?{...resource,data}:{data,self:r.owner_id,units:[],assigned:[]};
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
 if(action==='order.read'){
  const o=one(db,'SELECT * FROM mentor_order WHERE id=?',[id]),r=o&&orderResource(db,o,day);
  return r?{...r,data:{id:o.id,order_number:o.order_number,order_on:o.order_on,organization:o.organization,valid_from:o.valid_from,valid_to:o.valid_to,members:one(db,'SELECT count(*) n FROM mentor_appointment WHERE order_id=?',[id]).n}}:null;
 }
 if(action==='supplement.read'){
  const n=one(db,'SELECT * FROM twi_supplement WHERE id=?',[id]),r=n&&supplementResource(db,n,day,JSON.parse(n.tasks_json));
  return r?{...r,data:{id:n.id,person_id:n.person_id,role:n.role,month:n.month,state:n.state,rev:n.rev}}:null;
 }
 if(action==='development.read'){
  const p=one(db,'SELECT * FROM development_plan WHERE id=?',[id]),r=developmentResource(db,p,day);
  return r?{...r,data:{id:p.id,person_id:p.person_id,title:p.title,start_on:p.start_on,due_on:p.due_on,state:p.state,rev:p.rev}}:null;
 }
 if(action==='self.read'){
  const s=one(db,'SELECT id,person_id,method_id,evaluated_on,rev FROM mentor_self_evaluation WHERE id=?',[id]),r=selfResource(db,s,day);
  return r?{...r,data:s}:null;
 }
 if(action==='bank.read'){
  const b=one(db,'SELECT id,profession_id,version_no,reviewed_on,rev FROM twi_knowledge_bank WHERE id=?',[id]),r=programResource(db);
  return b&&r?{...r,data:b}:null;
 }
 if(action==='credential.read'||action==='appointment.read'){
  const sql={
   'credential.read':'SELECT id,person_id,kind,role,issued_on,valid_until,revoked_at,rev FROM mentor_credential WHERE id=?',
   'appointment.read':'SELECT id,person_id,role,order_on,valid_from,valid_to,revoked_at,rev FROM mentor_appointment WHERE id=?'
  }[action];
  const r=one(db,sql,[id]);if(!r||!activePerson(db,r.person_id))return null;
  return {data:r,self:r.person_id,units:unitsFor(db,r.person_id,day),assigned:[]};
 }
 if(action==='audit.read'){
  const a=one(db,'SELECT * FROM audit_session WHERE id=?',[id]),r=auditResource(db,a,day);
  if(!a||!activePerson(db,a.mentor_id))return null;
  const data={id:a.id,mentor_id:a.mentor_id,operation_id:a.operation_id,observed_at:a.observed_at,state:a.state,rev:a.rev};
  if(r)return {...r,data};
  // Keep the minimal historic registry where participants are resolved,
  // but no detailed access or native commands for incomplete imported facts.
  const people=[a.mentor_id,a.auditor_id,a.trainee_id].filter(Boolean);
  const historic=a.operation_id&&personWorkResource(db,people,day,[a.observed_at.slice(0,10)],[a.operation_id]);
  return historic?{...historic,self:a.mentor_id,data}:{data,self:a.mentor_id,units:[],assigned:[]};
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
  const s=one(db,'SELECT * FROM schedule_event WHERE id=?',[id]);
  if(!s||!activePerson(db,s.owner_id))return null;
  const data={id:s.id,kind:s.kind,due_on:s.due_on,state:s.state,rev:s.rev},r=scheduleResource(db,s,day);
  // Unresolved historic plans retain minimal own-calendar visibility.
  return r?{...r,data}:{data,self:s.owner_id,units:[],assigned:[]};
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
  if((![...DIRECTORY_COMMANDS,...LIBRARY_COMMANDS,...TRAINING_COMMANDS.filter(x=>!['training.stage','training.enrollment.result','preparation.shift','supplement.create','supplement.revise','supplement.decide','self.create','task.start','calendar.complete'].includes(x)),'matrix.detail','center.read','analytics.read','metrics.read','roi.detail'].includes(action)||grant.scope.kind==='unit_tree')&&scopeAllows(db,grant.scope,account.person_id,resource))return {data:resource.data,decision:{grantId:grant.id,roleId:role.id,policyRevision:policy.revision}};
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
 const allowed=[...READ_ACTIONS,...TRAINING_COMMANDS,'calendar.detail','plan.read','center.read','analytics.read','metrics.read','roi.detail','frv.read_summary','training.detail','training.read_sop','matrix.detail','training.read','matrix.read','credential.read','appointment.read','authorization.read','program.read','program.detail','training.enrollment.read','training.enrollment.detail','preparation.read','preparation.detail','order.read','order.detail','supplement.read','supplement.detail','development.read','development.detail','audit.read','audit.detail','self.read','self.detail','task.read','task.detail','task.implement_own','bank.read','bank.detail','skill.read','requirement.read','coverage.read','assessment.read','assessment.detail','employment.detail','forms.read','forms.export','sop.evaluation.read','assistant.read','assistant.cloud'];
 return !!resource&&allowed.includes(action)&&!!decide(db,security,accountId,action,id,day,action,resource);
}
export function bootstrapTrainingScope(db,site,resource){
 return !!resource&&scopeAllows(db,{kind:'unit_tree',unit_id:site},null,resource);
}
export function canReadPersonCard(db,security,accountId,id,day){
 return !!decide(db,security,accountId,'person.read_card',id,day,'person.read_basic');
}
