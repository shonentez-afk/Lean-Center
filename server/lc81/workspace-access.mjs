// A workspace is not an individual record. Check the same server-owned
// resource and scope at navigation and endpoint entry. Never widen grants.
import {READ_ACTIONS,DIRECTORIES,SITE_REFERENCE_TYPES} from './access-contract.mjs';
import {canReadRetraining} from './training-registers.mjs';
import {importTypes} from './import-commands.mjs';
import {siteWorkspace,personalPlanWorkspace,historyWorkspace,formsWorkspace,reportScope} from './workspace-scope.mjs';
const reportActions=['center.read','analytics.read','metrics.read'];
export function workspaceActions(db,a,admin=false){
 const p=new Set(a.permissions),has=k=>p.has(k),every=ks=>ks.every(has),any=ks=>ks.some(has);
 // Registries may legitimately be empty. Only the enterprise-wide catalogues
 // and composite workspaces require a stronger entry predicate.
 const siteReads=new Set([...SITE_REFERENCE_TYPES.map(t=>DIRECTORIES[t].read),'program.read','bank.read']);
 const available=new Set(READ_ACTIONS.filter(k=>has(k)&&(!siteReads.has(k)||siteWorkspace(db,a,k))));
 if(admin)available.add('admin');
 for(const k of ['sop.evaluation.read','assistant.read'])if(has(k))available.add(k);
 if(personalPlanWorkspace(db,a))available.add('plan.read');
 if(historyWorkspace(db,a))available.add('audit.history.read');
 if(formsWorkspace(db,a))available.add('forms.read');
 for(const k of reportActions)if(has(k)){const s=reportScope(db,a,k);if(s.all||s.units.length)available.add(k)}
 if(available.has('training.read'))available.add('instruction.view');
 if(['program.read','training.enrollment.read'].some(k=>available.has(k)))available.add('internship.view');
 if(any(['person.read_basic','person.read_directory'])&&any(['authorization.read','role_assignment.read','credential.read','appointment.read']))available.add('mentoring.view');
 if(importTypes(a).length)available.add('import.view');
 if(every(['training.read','training.detail','sop.read_history','operation.read','org.read']))available.add('journal.view');
 if(canReadRetraining(db,a))available.add('retraining.view');
 if(every(['sop.read_history','sop.create']))available.add('sop.constructor');
 for(const k of ['sop.read_twi','sop.read_linked_frv'])if(every(['sop.read_effective',k]))available.add(k);
 if(available.has('person.read_directory'))available.delete('person.read_basic');
 return [...available].sort();
}
