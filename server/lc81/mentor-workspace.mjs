// A dedicated view of mentors and internal trainers, derived exclusively
// from existing permissions. No second register or duplicated person record.
import {rows} from '../../src/core/db.js';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {matchesRoleKind} from '../../src/modules/master-data/role-matching.js';
import {recordAccess} from './center-commands.mjs';
import {authorizationValid} from '../../src/modules/training/domain.js';
import {PilotError} from '../lc74-store.mjs';
const who=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
export function mentorWorkspace(db,a,canCard){
 if(!a.permissions.some(k=>['authorization.read','role_assignment.read','credential.read','appointment.read'].includes(k)))throw new PilotError(403,'Реестр наставников недоступен');
 const items=[];
 for(const p of directoryPeople(db,a.day)){
  const person=who(a,p.id);if(!person)continue;
  const assignments=rows(db,"SELECT r.id,b.code,b.name FROM role_assignment r JOIN business_role b ON b.id=r.role_id WHERE r.person_id=? AND b.archived=0 AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>=?)",[p.id,a.day,a.day])
   .filter(x=>a.read('role_assignment.read',x.id)&&['mentor','instructor','internal_trainer'].some(k=>matchesRoleKind({...x,kind:p.roles.find(z=>z.id===x.id)?.kind},k)||p.roles.some(z=>z.code===x.code&&matchesRoleKind(z,k))));
  const credentials=rows(db,"SELECT id FROM mentor_credential WHERE person_id=?",[p.id]).filter(x=>a.read('credential.read',x.id));
  const appointments=rows(db,"SELECT id FROM mentor_appointment WHERE person_id=?",[p.id]).filter(x=>a.read('appointment.read',x.id));
  const authorizations=rows(db,"SELECT id FROM mentor_authorization WHERE person_id=?",[p.id]).flatMap(x=>{
   const v=a.read('authorization.read',x.id);return v?[{...v.data,operation:a.read('operation.read',v.data.operation_id)?.data.name??null,valid:!!authorizationValid(db,x.id,a.day)}]:[];
  });
  if(!assignments.length&&!credentials.length&&!appointments.length&&!authorizations.length)continue;
  const training=rows(db,"SELECT id,state FROM training_assignment WHERE mentor_id=? AND state IN('planned','in_progress')",[p.id]).filter(x=>recordAccess(db,a,'training',x.id));
  items.push({id:p.id,name:person.data.display_name,unit:person.data.unit??null,roles:assignments.map(x=>x.name),credentials:credentials.length,appointments:appointments.length,authorizations,training:training.length,can_card:canCard(p.id)});
 }
 return {day:a.day,items};
}
