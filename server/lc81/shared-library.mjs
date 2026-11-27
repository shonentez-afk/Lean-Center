// Enterprise library floor, separate from all role-granted permissions.
import {one,isId} from '../../src/core/primitives.js';
import {readManagerProjection} from './read-policy.mjs';
export const SHARED_LIBRARY_READS=Object.freeze(['sop.read_effective','sop.read_steps','sop.read_history','frv.read']);
export const SHARED_LIBRARY_WORKSPACES=Object.freeze([...SHARED_LIBRARY_READS,'sop.constructor','sop.read_linked_frv']);
export function sharedLibrary(db,a,site,day){
 // Caller checks current account state and employment on this enterprise.
 const enabled=!!a.person_id&&a.bootstrap!==1&&a.state==='active';
 const siteRead=(action,id)=>enabled&&isId(id)?readManagerProjection(db,site,action,id,day):null;
 // Only the protected server audit of creation proves authorship.
 // Unattributed legacy/imported drafts require explicit existing grants.
 const ownSop=id=>!!one(db,"SELECT 1 FROM lc81_audit a JOIN change_event e ON e.id=a.target_id JOIN document_revision r ON r.id=e.id AND r.document_id=e.entity_id WHERE a.actor_account_id=? AND a.action IN ('sop.create','sop.revise') AND e.entity_type='document' AND r.id=?",[a.id,id]);
 const ownFrv=id=>!!one(db,"SELECT 1 FROM lc81_audit a JOIN change_event e ON e.id=a.target_id WHERE a.actor_account_id=? AND a.action='frv.create' AND e.entity_type='frv_study' AND e.operation='create' AND e.entity_id=?",[a.id,id]);
 function read(action,id){
  if(!enabled)return null;
  if(['operation.read','sop.read_effective','sop.read_steps'].includes(action))return siteRead(action,id);
  if(action==='sop.read_history'){
   const v=siteRead(action,id);if(!v||v.data.document_archived)return null;
   return (v.data.state==='effective'&&siteRead('sop.read_effective',id)||v.data.state==='draft'&&ownSop(id))?v:null;
  }
  if(action==='frv.read'){
   const v=siteRead(action,id);return v&&(v.data.state==='final'||v.data.state==='draft'&&ownFrv(id))?v:null;
  }
  return null;
 }
 function allows(action,anchor,id){
  if(!enabled)return false;
  if(anchor==='operation.read')return ['sop.create','frv.create'].includes(action)&&!!read(anchor,id);
  if(anchor==='sop.read_history'){
   const v=read(anchor,id);if(!v)return false;
   return action==='sop.revise'?v.data.state==='effective':['sop.edit_draft','sop.passport'].includes(action)&&v.data.state==='draft'&&ownSop(id);
  }
  if(anchor==='frv.read'){
   const v=read(anchor,id);if(!v)return false;
   if(action==='frv.read_summary'||action==='sop.from_frv')return true;
   return ['frv.edit_draft','frv.finalize'].includes(action)&&v.data.state==='draft'&&ownFrv(id);
  }
  return anchor==='sop.read_effective'&&action==='sop.read_linked_frv'&&!!read(anchor,id);
 }
 return {enabled,read,allows,readScope:(_kind,id)=>!!siteRead('operation.read',id)};
}
