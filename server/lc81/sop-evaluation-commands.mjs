// Corporate binary evaluations and Stage43 weighted snapshots remain
// distinct, immutable records. Never mix their denominators or criteria.
import {createHash} from 'node:crypto';
import {one,rows,isId,uuid,applyEvent} from '../../src/core/db.js';
import {sopMethods,sopCriteria,validDate} from '../../src/modules/library/sop-review.js';
import {corporateEvaluations,corporateAnswers,weightedHistory} from '../../src/modules/library/sop-assessment-review.js';
import {BUILTIN_SOP} from '../../src/modules/training/builtin-forms.js';
import {sopEvaluationResource,personWorkResource,programResource,taskResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const name=(a,id)=>(a.read('person.read_directory',id)||a.read('person.read_basic',id))?.data.display_name??null;
const scoped=(a,k,id,r)=>!!r&&a.scope(k,id,{...r,self:null,assigned:[]});
const site=(db,a,k)=>{const r=programResource(db);return !!r&&scoped(a,k,r.units[0],r)};
const key=e=>createHash('sha256').update(e.methodKey).digest('hex');
const source=(a,id)=>a.read('sop.read_history',id)?.data;
export function evaluationAccess(db,a,kind,id){
 if(!isId(id)||!['sop_evaluation','weighted_sop'].includes(kind))return null;
 const r=sopEvaluationResource(db,kind,id,a.day);
 return r&&source(a,r.revision_id)&&(!r.actor_id||name(a,r.actor_id))&&scoped(a,'sop.evaluation.read',id,r)?r:null;
}
function project(db,a,kind,e){
 const r=evaluationAccess(db,a,kind,e.id);
 if(!r)return null;
 const actor=e.actor_id?name(a,e.actor_id):null;
 if(e.actor_id&&!actor)return null;
 const sop=source(a,e.revision_id),weighted=kind==='weighted_sop';
 return {id:e.id,kind,date:e.date,revision_id:e.revision_id,document_id:sop.document_id,sop:sop.code+' · '+sop.title+' · v'+sop.version_no,actor,unit:a.read('operation.read',sop.operation_id)?.data.unit_id??null,method_key:weighted?key(e):e.method_id,method:weighted?'Набор требований '+key(e).slice(0,8):'Методика v'+e.method_version,score:e.score.fraction,yes:weighted?null:e.score.yes,total:weighted?e.questions.length:e.score.total};
}
export function sopEvaluationWorkspace(db,a,f){
 must(a.permissions.includes('sop.evaluation.read'),403,'Оценки СОП недоступны');
 must(['sop_evaluation','weighted_sop'].includes(f.kind)&&validDate(f.from)&&validDate(f.to)&&f.from<=f.to&&f.to<=a.day&&typeof f.q==='string'&&f.q.length<=200&&Number.isSafeInteger(f.offset)&&f.offset>=0&&f.offset<=100000&&(f.method===null||typeof f.method==='string'&&f.method.length<=100),400,'Неверные фильтры');
 const query=f.q.trim().toLocaleLowerCase('ru-RU'),raw=f.kind==='weighted_sop'?weightedHistory(db):corporateEvaluations(db);
 const data=raw.filter(e=>e.date>=f.from&&e.date<=f.to).map(e=>project(db,a,f.kind,e)).filter(Boolean);
 const methods=[...new Map(data.map(e=>[e.method_key,{id:e.method_key,label:e.method}])).values()];
 const selected=data.filter(e=>(!f.method||f.method===e.method_key)&&(!query||[e.sop,e.actor,e.method].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(query)));
 return {day:a.day,items:selected.slice(f.offset,f.offset+100),total:selected.length,offset:f.offset,next:f.offset+100<selected.length?f.offset+100:null,methods,can_create:!!a.personId&&a.permissions.includes('sop.evaluation.create'),can_install:!!a.personId&&site(db,a,'sop.method.install')};
}
export function sopEvaluationDetail(db,a,kind,id){
 must(evaluationAccess(db,a,kind,id),404,'Оценка СОП недоступна');
 const weighted=kind==='weighted_sop',e=(weighted?weightedHistory(db):corporateEvaluations(db)).find(x=>x.id===id),v=e&&project(db,a,kind,e);
 must(v,404,'Оценка СОП недоступна');
 const r=evaluationAccess(db,a,kind,id),can=!!a.personId&&!!e.actor_id&&scoped(a,'task.create',id,r);
 const questions=weighted?e.questions.map(q=>({id:String(q.id),position:q.id,question:q.req,value:q.score,weight:q.weight,note:q.comment,source:q.scoreSource,can_task:can&&q.scoreSource==='manual'&&q.score<1})):corporateAnswers(db,id).map(q=>({id:q.id,position:q.position,question:q.question,value:q.value,note:q.note,can_task:can&&q.value===0}));
 const tasks=rows(db,'SELECT id,title,due_on,state FROM action_item WHERE '+(weighted?'source_weighted_event_id':'source_evaluation_id')+'=? ORDER BY due_on,id',[id]).filter(t=>{const r=taskResource(db,one(db,'SELECT * FROM action_item WHERE id=?',[t.id]),a.day);return a.read('task.read',t.id)&&r&&a.scope('task.detail',t.id,r)});
 return {...v,place:weighted?null:e.place,questions,tasks};
}
function canEvaluate(db,a,r,on){
 const res=a.personId&&r&&personWorkResource(db,[a.personId],a.day,[on],[r.operation_id]);
 return !!r&&!!res&&!!a.read('operation.read',r.operation_id)&&scoped(a,'sop.evaluation.read',r.id,res)&&scoped(a,'sop.evaluation.create',r.id,res);
}
export function sopEvaluationOptions(db,a){
 must(a.personId&&a.permissions.includes('sop.evaluation.create'),403,'Оценка СОП недоступна');
 const revisions=rows(db,"SELECT r.id,r.state,d.operation_id,r.payload_json FROM document_revision r JOIN document d ON d.id=r.document_id WHERE d.kind='sop' AND d.archived=0 AND r.state IN('draft','effective') ORDER BY d.code,r.version_no").flatMap(r=>{
  const x=source(a,r.id);return x&&canEvaluate(db,a,r,a.day)?[{id:r.id,label:x.code+' · '+x.title+' · v'+x.version_no+' · '+(r.state==='draft'?'Черновик':'Действует'),source_sha256:JSON.parse(r.payload_json).source.sha256}]:[];
 });
 const methods=sopMethods(db).filter(m=>m.state==='active').map(m=>({id:m.id,version:m.version_no,criteria:sopCriteria(db,m.id).map(q=>({id:q.id,position:q.position,question:q.question}))}));
 return {day:a.day,revisions,methods,can_install:site(db,a,'sop.method.install')&&!methods.length};
}
function emit(db,a,type,p,action){
 const id=uuid(),event=uuid();
 try{applyEvent(db,{id:event,entity_type:type,entity_id:id,operation:'create',expected_revision:0,payload:p,occurred_at:a.at})}
 catch(e){throw new PilotError(422,'Проверка оценки СОП: '+String(e.message||'ошибка').split('\n')[0].slice(0,240))}
 a.audit(action,event);return {id,rev:1};
}
export function installSopMethod(db,a,f){
 must(a.personId&&site(db,a,'sop.method.install'),403,'Установка методики недоступна');
 must(exact(f,['kind'])&&f.kind==='builtin',400,'Выберите встроенную методику');
 must(!sopMethods(db).some(m=>m.state==='active'),409,'Действующая методика уже зарегистрирована');
 return emit(db,a,'checklist_version',BUILTIN_SOP,'sop.method.install');
}
export function createSopEvaluation(db,a,f){
 must(a.personId&&exact(f,['revision_id','method_id','source_sha256','evaluated_on','place','responses'])&&isId(f.revision_id)&&isId(f.method_id)&&validDate(f.evaluated_on)&&f.evaluated_on<=a.day&&typeof f.place==='string'&&f.place.trim().length>0&&f.place.length<=500&&Array.isArray(f.responses)&&f.responses.length<=100,400,'Неверная оценка СОП');
 const r=one(db,"SELECT r.*,d.operation_id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.kind='sop' AND d.archived=0 AND r.state IN('draft','effective')",[f.revision_id]);
 must(r&&source(a,r.id)&&canEvaluate(db,a,r,f.evaluated_on),403,'Редакция СОП недоступна');
 const hash=JSON.parse(r.payload_json).source.sha256;
 must(hash===f.source_sha256,409,'Исходный СОП изменился. Откройте актуальную редакцию');
 must(sopMethods(db).some(m=>m.id===f.method_id&&m.state==='active'),409,'Методика изменилась');
 return emit(db,a,'sop_evaluation',{...f,actor_id:a.personId,source_sha256:hash},'sop.evaluation.create');
}
