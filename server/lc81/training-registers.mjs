// Protected LC5.2 journals and retraining queue. Existing domain algorithms,
// explicit per-record authorization, no new facts or automatic assignments.
import {one,rows,isId} from '../../src/core/db.js';
import {retrainingQueue} from '../../src/modules/training/center-overview.js';
import {progressFor} from '../../src/modules/training/training-facts.js';
import {validDate} from '../../src/modules/library/sop-review.js';
import {trainingAssignmentResource,programResource,personWorkResource} from './read-policy.mjs';
import {recordAccess} from './center-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const who=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
const name=(a,id)=>who(a,id)?.data.display_name??null;
const site=(db,a,k)=>{const r=programResource(db);return !!r&&a.scope(k,r.units[0],r)};
const full=(a,k,id,r)=>!!r&&a.scope(k,id,{...r,self:null,assigned:[]});
const link=(db,a,type,id)=>id&&recordAccess(db,a,type,id)?{type,id}:null;
const revision=(a,id)=>{const x=id&&a.read('sop.read_history',id)?.data;return x?{id,operation_id:x.operation_id,label:x.code+' · '+x.title+' · v'+x.version_no}:null};
function filter(a,f,withDates){
 const valid=(!withDates||validDate(f.from)&&validDate(f.to)&&f.from<=f.to&&f.to<=a.day)&&typeof f.q==='string'&&f.q.length<=200&&Number.isSafeInteger(f.offset)&&f.offset>=0&&f.offset<=100000;
 must(valid,400,'Проверьте период, поиск и страницу');
 const query=f.q.trim().toLocaleLowerCase('ru-RU');
 return x=>!query||x.filter(v=>typeof v==='string').join(' ').toLocaleLowerCase('ru-RU').includes(query);
}
const page=(items,offset)=>({items:items.slice(offset,offset+100),total:items.length,offset,next:offset+100<items.length?offset+100:null});
export function journalWorkspace(db,a,f){
 must(a.permissions.includes('training.read')&&a.permissions.includes('training.detail'),403,'Журнал недоступен');
 must(f.person_id==null||isId(f.person_id)&&who(a,f.person_id),400,'Сотрудник недоступен');
 const match=filter(a,f,true),cache=new Map(),items=[];
 for(const x of rows(db,"SELECT s.id,s.assignment_id,s.mentor_id,s.witness_id,s.held_at,s.duration_minutes,s.stage_code,s.result,s.notes FROM training_session s JOIN training_assignment t ON t.id=s.assignment_id WHERE s.stage_code IS NOT NULL AND t.source_sha256 IS NOT NULL AND substr(s.held_at,1,10) BETWEEN ? AND ? ORDER BY s.held_at DESC,s.recorded_at DESC,s.id",[f.from,f.to])){
  if(f.person_id&&x.mentor_id!==f.person_id&&one(db,'SELECT trainee_id FROM training_assignment WHERE id=?',[x.assignment_id])?.trainee_id!==f.person_id)continue;
  if(!cache.has(x.assignment_id)){
   const t=one(db,'SELECT * FROM training_assignment WHERE id=?',[x.assignment_id]),read=recordAccess(db,a,'training',t.id),rev=revision(a,t.sop_revision_id),op=a.read('operation.read',t.operation_id)?.data;
   const trainee=name(a,t.trainee_id),unit=op&&a.read('org.read',op.unit_id)?.data.name;
   cache.set(t.id,read&&rev&&op&&trainee&&unit?{t,rev,unit,trainee,stages:progressFor(db,t).stages}:null);
  }
  const c=cache.get(x.assignment_id);if(!c)continue;
  const day=x.held_at.slice(0,10),r=trainingAssignmentResource(db,c.t.id,a.day,[x.mentor_id,x.witness_id].filter(Boolean),day),mentor=name(a,x.mentor_id);
  if(!mentor||!full(a,'training.detail',c.t.id,r))continue;
  const labels=JSON.parse(c.t.recorded_names_json||'{}'),item={id:x.id,assignment_id:c.t.id,date:x.held_at,unit:c.unit,trainee:labels.trainee||c.trainee,mentor:labels.instructor||mentor,sop:c.rev.label,stage:c.stages.find(s=>s.code===x.stage_code)?.label||x.stage_code,minutes:x.duration_minutes,result:x.result,note:x.notes||'',can_export:a.personId&&full(a,'forms.export',c.t.id,r)};
  if(match(Object.values(item)))items.push(item);
 }
 return {...page(items,f.offset),day:a.day,minutes:items.reduce((n,x)=>n+(Number(x.minutes)||0),0),from:f.from,to:f.to};
}
export const RETRAINING_RIGHTS=['training.read','training.detail','sop.read_history','sop.read_effective','operation.read','org.read','person.read_basic','assessment.read','assessment.detail','audit.read','audit.detail','skill.read','requirement.read','matrix.read','matrix.detail','self.read','self.detail','task.read','task.detail','development.read','development.detail','training.enrollment.read','training.enrollment.detail'];
export const canReadRetraining=(db,a)=>RETRAINING_RIGHTS.every(k=>site(db,a,k));
export function retrainingWorkspace(db,a,f){
 // Latest facts and matrix gaps are cross-register calculations. Do not
 // publish a partial denominator or infer absence from an inaccessible record.
 must(canReadRetraining(db,a),403,'Для единой очереди нужны права на все исходные регистры предприятия');
 const match=filter(a,f,false),types=['all','revision','practical','audit','skill','self_eval','action'],states=['all','needs','linked','done','blocked'];
 must(types.includes(f.type)&&states.includes(f.state)&&(f.person_id===null||isId(f.person_id)&&who(a,f.person_id)),400,'Неверные фильтры очереди');
 const items=[];
 for(const x of retrainingQueue(db,a.day)){
  if((f.type!=='all'&&x.type!==f.type)||(f.state!=='all'&&x.status!==f.state)||(f.person_id&&x.personId!==f.person_id))continue;
  const person=name(a,x.personId),unit=x.unitId&&a.read('org.read',x.unitId)?.data.name;if(!person||!unit)continue;
  const old=x.revisionId?revision(a,x.revisionId):null,current=x.currentId?revision(a,x.currentId):null;
  if(x.revisionId&&!old||x.currentId&&!current)continue;
  const source=x.type==='revision'?link(db,a,'training',x.id):x.type==='practical'?link(db,a,'assessment',x.id):x.type==='audit'?link(db,a,'audit',x.id):x.type==='self_eval'?link(db,a,'self',x.id):x.type==='action'?link(db,a,'task',x.id):null;
  const next=x.actionId?link(db,a,'task',x.actionId):x.nextId?link(db,a,'training',x.nextId):x.planId?link(db,a,'development',x.planId):null;
  if(x.type!=='skill'&&!source||(x.actionId||x.nextId||x.planId)&&!next)continue;
  const skill=x.skillId?a.read('skill.read',x.skillId)?.data:null;
  if(x.skillId&&!skill)continue;
  const item={type:x.type,person_id:x.personId,person,unit,status:x.status,due:x.due,source,next,description:x.question|| (x.type==='skill'?skill.name+' · цель '+x.required+' / факт '+(x.actual??'Не оценено'):old?.label||''),current:current?.label??null,create:null};
  if(x.status==='needs'&&a.personId){
   if(x.type==='revision'&&current&&a.read('sop.read_effective',current.id)){
    const r=personWorkResource(db,[x.personId],a.day,[],[current.operation_id]);
    if(r&&a.scope('training.create',current.operation_id,r)&&a.scope('training.read',current.operation_id,r))item.create={type:'training',retraining_source_id:x.id,operation_id:current.operation_id,trainee_id:x.personId,revision_id:current.id,skill_id:x.skillId,scale_id:x.scaleId,target_level:x.targetLevel,reason:'Изменение редакции СОП: '+old.label};
   }else if(x.type==='practical'&&a.permissions.includes('task.create'))item.create={type:'task',source:{kind:'practical',id:x.id,criterion_id:null}};
   else if(x.type==='audit'&&a.permissions.includes('task.create')){
    const q=one(db,'SELECT criterion_id FROM audit_response WHERE id=? AND audit_id=?',[x.responseId,x.id]);
    if(q)item.create={type:'task',source:{kind:'audit',id:x.id,criterion_id:q.criterion_id}};
   }else if(x.type==='skill'&&a.permissions.includes('development.create'))item.create={type:'development',person_id:x.personId,title:'Подтверждение навыка: '+skill.name};
  }
  if(match([person,unit,item.description,item.current,item.status,item.type]))items.push(item);
 }
 return {...page(items,f.offset),day:a.day};
}
