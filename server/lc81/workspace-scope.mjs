import {rows} from '../../src/core/primitives.js';
import {programResource,personWorkResource} from './read-policy.mjs';
export const siteWorkspace=(db,a,k)=>{const r=programResource(db);return !!r&&a.scope(k,r.units[0],r)};
export const personalPlanWorkspace=(db,a)=>{const id=a.personId,r=id&&personWorkResource(db,[id],a.day);return !!r&&a.scope('plan.read',id,{...r,self:id})};
export const historyWorkspace=(db,a)=>['audit.history.read','audit.read','audit.detail'].every(k=>siteWorkspace(db,a,k));
export const formsWorkspace=(db,a)=>siteWorkspace(db,a,'forms.read');
export function reportScope(db,a,k){
 const root=programResource(db);
 const all=!!root&&a.scope(k,root.units[0],root);
 const units=rows(db,'SELECT id,name FROM org_unit WHERE archived=0 ORDER BY name,id').filter(u=>a.read('org.read',u.id)&&a.scope(k,u.id,{data:{},self:null,assigned:[],units:[u.id]}));
 return {all,units};
}
