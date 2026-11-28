// Protected LC5.2 journals and retraining queue. Existing domain algorithms,
// explicit per-record authorization, no new facts or automatic assignments.
import {one,rows,isId,uuid} from '../../src/core/db.js';
import {retrainingQueue} from '../../src/modules/training/center-overview.js';
import {revisionImpact,sameWorkContent} from '../../src/modules/training/revision-impact.js';
import {checkContent} from '../../src/modules/library/source-validation.js';
import {currentStandard,progressFor} from '../../src/modules/training/training-facts.js';
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
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
export const REVISION_IMPACT_SCHEMA=`CREATE TABLE IF NOT EXISTS lc81_revision_impact(
 id TEXT PRIMARY KEY,old_id TEXT NOT NULL REFERENCES document_revision(id),new_id TEXT NOT NULL REFERENCES document_revision(id),
 old_sha TEXT NOT NULL,new_sha TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN('editorial','retrain')),reason TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES person(id),reviewed_on TEXT NOT NULL,recorded_at TEXT NOT NULL,rev INTEGER NOT NULL,
 UNIQUE(old_id,new_id,rev));`;
export function revisionReviewContext(db,a,oldId,newId,{prepublication=false}={}){
 must(canReadRetraining(db,a)&&isId(oldId)&&isId(newId)&&oldId!==newId,404,'Редакции недоступны');
 const prev=currentStandard(db,oldId),next=currentStandard(db,newId);
 const op=next&&one(db,'SELECT unit_id FROM operation WHERE id=? AND archived=0',[next.operation_id]);
 must(prev&&next&&op&&prev.document_id===next.document_id&&prev.operation_id===next.operation_id&&(prepublication?prev.state==='effective'&&next.state==='approved':prev.state==='superseded'&&next.state==='effective')&&!next.archived&&a.read('sop.read_history',oldId)&&a.read(prepublication?'sop.read_history':'sop.read_effective',newId),409,'Состав редакций изменился или недоступен');
 const resource={data:{},self:null,units:[op.unit_id],assigned:[]};
 const can_review=!!a.personId&&a.scope('training.approve_responsible',next.operation_id,resource)&&site(db,a,'training.approve_responsible');
 const prior=prepublication&&one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc81_revision_impact'")?one(db,'SELECT * FROM lc81_revision_impact WHERE old_id=? AND new_id=? ORDER BY rev DESC LIMIT 1',[oldId,newId]):revisionImpact(db,oldId,newId,a.day);
 return {old_id:oldId,new_id:newId,old_source:prev.source,new_source:next.source,old_label:prev.code+' · v'+prev.version_no+' · '+prev.title,new_label:next.code+' · v'+next.version_no+' · '+next.title,can_review,prior:prior?{id:prior.id,rev:prior.rev,decision:prior.decision,reason:prior.reason,day:prior.reviewed_on}:null};
}
export async function inspectRevisionChange(context,readSource){
 const [a,b]=await Promise.all([context.old_source,context.new_source].map(async ref=>JSON.parse(await checkContent(ref,await readSource(ref)))));
 return sameWorkContent(a,b);
}
export function publicRevisionReview(c,same){
 const {old_source,new_source,...view}=c;
 return {...view,same_work_content:same};
}
export function saveRevisionReview(db,a,f,checked,same,{prepublication=false}={}){
 must(exact(f,['old_id','new_id','expected_revision','decision','reason'])&&isId(f.old_id)&&isId(f.new_id)&&Number.isSafeInteger(f.expected_revision)&&['editorial','retrain'].includes(f.decision)&&typeof f.reason==='string'&&f.reason.trim().length>0&&f.reason.length<=1200,400,'Укажите решение и обоснование');
 const c=revisionReviewContext(db,a,f.old_id,f.new_id,{prepublication});
 must(c.can_review,403,'Нет полномочий принимать решение по изменению СОП');
 must(c.old_source.sha256===checked.old_source.sha256&&c.new_source.sha256===checked.new_source.sha256&&(c.prior?.rev??0)===f.expected_revision,409,'Редакции или решение изменились');
 must(f.decision!=='editorial'||same,422,'Редакционную эквивалентность нельзя подтвердить: рабочее содержание отличается');
 db.run(REVISION_IMPACT_SCHEMA);const id=uuid(),rev=f.expected_revision+1;
 db.run('INSERT INTO lc81_revision_impact VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,c.old_id,c.new_id,c.old_source.sha256,c.new_source.sha256,f.decision,f.reason,a.personId,a.day,a.at,rev]);
 a.audit('training.revision_impact',id);
 return {id,rev,decision:f.decision};
}
// The prepublication roster is evidence from the existing registers, not
// a guess about every person who actually performs the operation.
export function prepublicationContext(db,a,oldId,newId){
 must(canReadRetraining(db,a)&&isId(newId),404,'Для оценки влияния нужны права на исходные регистры предприятия');
 const next=currentStandard(db,newId),op=next&&one(db,'SELECT unit_id FROM operation WHERE id=? AND archived=0',[next.operation_id]);
 must(next&&op&&!next.archived&&next.state==='approved'&&a.read('sop.read_history',newId),409,'Утверждённая редакция недоступна');
 const resource={data:{},self:null,units:[op.unit_id],assigned:[]};
 const can_review=!!a.personId&&a.scope('training.approve_responsible',next.operation_id,resource)&&site(db,a,'training.approve_responsible');
 must(can_review,403,'Нет полномочий принимать решение по изменению СОП');
 const prior=oldId?revisionReviewContext(db,a,oldId,newId,{prepublication:true}):{old_id:null,new_id:newId,old_source:null,new_source:next.source,can_review,prior:null};
 const facts=rows(db,`SELECT a.trainee_id person_id,a.skill_id,a.id fact_id,'training' kind FROM training_assignment a WHERE a.operation_id=? AND a.state<>'cancelled' AND a.assigned_on<=?
 UNION ALL SELECT s.person_id,i.skill_id,s.id,'assessment' FROM assessment_session s JOIN assessment_item i ON i.session_id=s.id WHERE s.operation_id=? AND s.state='confirmed' AND substr(s.assessed_at,1,10)<=?
 UNION ALL SELECT a.person_id,NULL,a.id,'admission' FROM admission_decision a WHERE a.operation_id=? AND a.decided_on<=?
 UNION ALL SELECT a.person_id,r.skill_id,r.id,'requirement' FROM person_assignment a JOIN role_requirement r ON r.profession_id=a.profession_id JOIN skill s ON s.id=r.skill_id WHERE s.operation_id=? AND s.archived=0 AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=? AND r.valid_from<=? AND coalesce(r.valid_to,'9999-12-31')>=?`,[next.operation_id,a.day,next.operation_id,a.day,next.operation_id,a.day,next.operation_id,a.day,a.day,a.day,a.day]);
 const grouped=new Map();
 for(const x of facts){
  if(!a.read('person.read_basic',x.person_id))continue;
  const emp=one(db,"SELECT a.id,a.unit_id FROM person_assignment a JOIN person p ON p.id=a.person_id WHERE p.id=? AND p.archived=0 AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=? ORDER BY a.valid_from DESC,a.id LIMIT 1",[x.person_id,a.day,a.day]);
  if(!emp||!a.read('org.read',emp.unit_id))continue;
  const skill=x.skill_id?a.read('skill.read',x.skill_id)?.data:null;
  if(x.skill_id&&!skill)continue;
  const key=x.person_id+':'+(x.skill_id||''),item=grouped.get(key)||{person_id:x.person_id,person:name(a,x.person_id),employment_id:emp.id,unit_id:emp.unit_id,skill_id:x.skill_id,skill:skill?.name??'Операция',basis:[]};
  const b={kind:x.kind,id:x.fact_id};if(!item.basis.some(y=>y.kind===b.kind&&y.id===b.id))item.basis.push(b);grouped.set(key,item);
 }
 const scope=[...grouped.values()].sort((x,y)=>(x.person_id+':'+(x.skill_id||'')).localeCompare(y.person_id+':'+(y.skill_id||'')));
 for(const x of scope)x.basis.sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id));
 return {...prior,scope};
}
export function retrainingWorkspace(db,a,f){
 // Latest facts and matrix gaps are cross-register calculations. Do not
 // publish a partial denominator or infer absence from an inaccessible record.
 must(canReadRetraining(db,a),403,'Для единой очереди нужны права на все исходные регистры предприятия');
 const match=filter(a,f,false),types=['all','revision','practical','audit','skill','self_eval','action'],states=['all','needs','linked','done','blocked','reviewed'];
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
  if(x.type==='revision'&&old&&current&&a.read('sop.read_effective',current.id)){
   const previous=currentStandard(db,old.id);
   if(previous?.state==='superseded'){
    const c=revisionReviewContext(db,a,old.id,current.id);
    item.review={old_id:old.id,new_id:current.id,can_review:c.can_review,prior:c.prior};
   }
  }
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
