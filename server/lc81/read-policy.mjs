// LC8.1A: server-only policy/projection foundation. NOT connected to HTTP.
// All account, grant, policy and date inputs MUST come from trusted server state.
// No client-supplied role, scope, actor, SQL, or resource attributes are accepted.
import {one,rows,isId} from '../../src/core/primitives.js';

export const READ_ACTIONS=Object.freeze(['person.read_basic','sop.read_effective','training.read','task.read']);
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
 return rows(db,'SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',[person,day,day]).map(x=>x.unit_id).filter(id=>lineage(db,id));
}
// Fixed SQL, fixed output allowlists. No source JSON, full snapshots, logs,
// credentials, personal assessments, or attachment bytes in these projections.
function resolve(db,action,id,day){
 if(action==='person.read_basic'){
  const p=activePerson(db,id);
  if(!p)return null;
  return {data:{id:p.id,display_name:p.display_name},self:p.id,units:unitsFor(db,p.id,day),assigned:[]};
 }
 if(action==='sop.read_effective'){
  const r=one(db,"SELECT r.id AS revision_id,r.version_no,r.state,d.id AS document_id,d.code,d.title,o.id AS operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=? AND r.state='effective' AND d.kind='sop' AND d.archived=0 AND o.archived=0",[id]);
  if(!r||!lineage(db,r.unit_id))return null;
  const {unit_id,...data}=r;
  // Assigned access is not implemented for SOP until per-revision relation
  // resolution is verified. Only a unit-scoped permission can read this metadata.
  return {data,self:null,units:[unit_id],assigned:[]};
 }
 if(action==='training.read'){
  const r=one(db,'SELECT a.id,a.trainee_id,a.mentor_id,a.operation_id,a.sop_revision_id,a.due_on,a.state,o.unit_id FROM training_assignment a JOIN operation o ON o.id=a.operation_id WHERE a.id=? AND o.archived=0',[id]);
  if(!r||!lineage(db,r.unit_id)||!activePerson(db,r.trainee_id))return null;
  const {unit_id,mentor_id,...data}=r;
  return {data,self:r.trainee_id,units:[unit_id],participantUnits:unitsFor(db,r.trainee_id,day),assigned:r.state==='planned'||r.state==='in_progress'?[r.trainee_id,mentor_id].filter(Boolean):[]};
 }
 if(action==='task.read'){
  const r=one(db,'SELECT id,title,due_on,state,owner_id FROM action_item WHERE id=?',[id]);
  if(!r||!activePerson(db,r.owner_id))return null;
  // Owner-based access only: linked finding/goal can have a different scope.
  const {owner_id,...data}=r;
  const standalone=one(db,'SELECT id FROM action_item WHERE id=? AND finding_id IS NULL AND goal_id IS NULL',[id]);
  return {data,self:owner_id,units:standalone?unitsFor(db,owner_id,day):[],assigned:[]};
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
export function readAuthorized(db,security,accountId,action,resourceId,day){
 if(!READ_ACTIONS.includes(action)||!isId(accountId)||!isId(resourceId)||!validDay(day))return null;
 const account=unique(security?.accounts,x=>x?.id===accountId);
 if(account?.state!=='active'||!activePerson(db,account.person_id))return null;
 if(security.accounts.filter(x=>x?.person_id===account.person_id&&x.state==='active').length!==1)return null;
 if(!Array.isArray(security.grants)||!Array.isArray(security.policies))return null;
 const resource=resolve(db,action,resourceId,day);
 if(!resource)return null;
 for(const grant of security.grants){
  if(grant?.account_id!==accountId||grant.state!=='active'||grant.revoked_at!==null||!activePeriod(grant,day)||!isId(grant.id)||!isId(grant.role_id)||!isId(grant.assignment_id))continue;
  const role=one(db,'SELECT id FROM business_role WHERE id=? AND archived=0',[grant.role_id]);
  const assignment=one(db,'SELECT person_id,role_id,valid_from,valid_to FROM role_assignment WHERE id=?',[grant.assignment_id]);
  if(!role||assignment?.person_id!==account.person_id||assignment.role_id!==role.id||!activePeriod(assignment,day))continue;
  const policy=unique(security.policies,x=>x?.role_id===role.id);
  if(!policy||!Number.isSafeInteger(policy.revision)||policy.revision<1||grant.policy_revision!==policy.revision||!Array.isArray(policy.permissions)||!policy.permissions.includes(action))continue;
  if(scopeAllows(db,grant.scope,account.person_id,resource))return {data:resource.data,decision:{grantId:grant.id,roleId:role.id,policyRevision:policy.revision}};
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
