// Protected planning and centre projections. No SQL.js or raw journal is
// sent to the browser. Calculation and date semantics stay in LC5/LC7.
import {one,rows,uuid,isId,applyEvent} from '../../src/core/db.js';
import {scheduleKind,scheduleLabels,scheduleDisplayState,schedulePending,schedulePeople,plannedAuditFacts,plannedAssessmentFacts} from '../../src/modules/training/center-planning.js';
import {standardCalendar} from '../../src/modules/training/standard-overview.js';
import {actionRows,actionStatus} from '../../src/modules/training/audit-domain.js';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {matchesRoleKind} from '../../src/modules/master-data/role-matching.js';
import {centerProjection,personUnit} from '../../src/modules/training/center-overview.js';
import {centerAttention,scopedAttention} from '../../src/modules/training/center-attention.js';
import {metricScopeValid,METRIC_RELATIONS,RELATION_LABELS} from '../../src/modules/training/metric-catalog.js';
import {annualAuditCoverage} from '../../src/modules/training/audit-analytics.js';
import {effectOverview,effectFacts,twiBasis,effectPending,effectStatus} from '../../src/modules/effect/domain.js';
import {historyAllowed,isHistoricalRC1} from './rc1-history.mjs';
import {evaluationAccess} from './sop-evaluation-commands.mjs';
import {programResource,personWorkResource,scheduleResource,trainingAssignmentResource,assessmentResource,auditResource,selfResource,enrollmentResource,preparationResource,developmentResource,taskResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
import {civilPayload} from './site-clock.mjs';
import {personalPlanWorkspace,reportScope} from './workspace-scope.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const find=(db,t,id)=>isId(id)?one(db,'SELECT * FROM '+t+' WHERE id=?',[id]):null;
const who=(a,id)=>id&&(a.read('person.read_directory',id)||a.read('person.read_basic',id));
const name=(a,id)=>who(a,id)?.data.display_name??null;
const allowed=(a,k,id,r)=>!!r&&a.scope(k,id,r);
const unitResource=id=>({data:{},self:null,units:[id],assigned:[]});
const detail=(a,read,k,id,r)=>!!r&&!!a.read(read,id)&&allowed(a,k,id,r);
const site=(db,a,k)=>{const r=programResource(db);return !!r&&allowed(a,k,r.units[0],r)};
const has=(a,k)=>a.permissions.includes(k);
function emit(db,a,t,id,operation,rev,payload,action){
 const event=uuid();try{applyEvent(db,{id:event,entity_type:t,entity_id:id,operation,expected_revision:rev,payload:civilPayload(t,payload,a.offsetMinutes??0),occurred_at:a.at})}
 catch(e){throw new PilotError(422,'Планирование: '+String(e.message||'ошибка').split('\n')[0].slice(0,250))}
 a.audit(action,event);return {id,rev:one(db,'SELECT rev FROM '+t+' WHERE id=?',[id]).rev};
}
// Only a resolved source and its own separate read/detail grant can produce
// a link. Source ids and labels of a generic historic plan remain hidden.
export function recordAccess(db,a,type,id){
 const day=a.day;let r=null,read=null,permission=null;
 switch(type){
 case 'training':r=trainingAssignmentResource(db,id,day);read='training.read';permission='training.detail';break;
 case 'enrollment':r=enrollmentResource(db,find(db,'training_enrollment',id),day);read='training.enrollment.read';permission='training.enrollment.detail';break;
 case 'preparation':r=preparationResource(db,find(db,'twi_preparation',id),day);read='preparation.read';permission='preparation.detail';break;
 case 'assessment':r=assessmentResource(db,find(db,'assessment_session',id),day);read='assessment.read';permission='assessment.detail';break;
 case 'audit':{const v=find(db,'audit_session',id);if(v&&isHistoricalRC1(db,id))return historyAllowed(db,a,id)?{type:'rc1_history',id,resource:programResource(db)}:null;r=auditResource(db,v,day);read='audit.read';permission='audit.detail';break}
 case 'self':r=selfResource(db,find(db,'mentor_self_evaluation',id),day);read='self.read';permission='self.detail';break;
 case 'task':r=taskResource(db,find(db,'action_item',id),day);read='task.read';permission='task.detail';break;
 case 'development':r=developmentResource(db,find(db,'development_plan',id),day);read='development.read';permission='development.detail';break;
 case 'schedule':r=scheduleResource(db,find(db,'schedule_event',id),day);read='calendar.read';permission='calendar.detail';break;
 case 'bank':r=programResource(db);read='bank.read';permission='bank.detail';break;
 case 'person':return who(a,id)?{type,id,resource:personWorkResource(db,[id],day)}:null;
 case 'sop':return a.read('sop.read_history',id)?{type,id,resource:null}:null;
 case 'sop_evaluation':case 'weighted_sop':r=evaluationAccess(db,a,type,id);return r?{type,id,resource:r}:null;
 case 'frv':return a.read('frv.read',id)?{type,id,resource:null}:null;
 case 'supplement':return a.read('supplement.read',id)&&site(db,a,'supplement.detail')?{type,id,resource:null}:null;
 case 'roi':return financialRecordAllowed(db,a,id)?{type,id,resource:null}:null;
 default:return null;
 }
 return detail(a,read,permission,id,r)?{type,id,resource:r}:null;
}
const routeOf=x=>x?{type:x.type,id:x.id}:null;
const sourceOf=s=>scheduleKind(s)==='self_eval'?['person',s.source_id]:['audit','practical'].includes(scheduleKind(s))?['training',s.source_id]:[];
const factOf=s=>s.completed_audit_id?['audit',s.completed_audit_id]:s.completed_assessment_id?['assessment',s.completed_assessment_id]:s.completed_self_id?['self',s.completed_self_id]:[];
function sourceLink(db,a,s){const q=sourceOf(s);return q.length?recordAccess(db,a,...q):null}
function factLink(db,a,s){const q=factOf(s);return q.length?recordAccess(db,a,...q):null}
function scheduleCandidates(db,a,s){
 const type=scheduleKind(s);
 const list=type==='audit'?plannedAuditFacts(db,s,a.day):plannedAssessmentFacts(db,s,a.day);
 return list.flatMap(f=>{
  const link=recordAccess(db,a,type==='audit'?'audit':type==='practical'?'assessment':'self',f.id);
  if(!link)return [];
  const r=scheduleResource(db,s,a.day),joined={...r,units:[...new Set([...r.units,...link.resource.units])]};
  return allowed(a,'calendar.complete',s.id,joined)?[{id:f.id,label:(f.observed_at||f.date||'').slice(0,10)+' · '+scheduleLabels[type]}]:[];
 });
}
function scheduleTitle(db,a,s,source){
 if(!source)return scheduleLabels[scheduleKind(s)];
 if(source.type==='person')return name(a,s.source_id)||scheduleLabels[scheduleKind(s)];
 const t=find(db,'training_assignment',s.source_id),op=t&&a.read('operation.read',t.operation_id);
 return [op?.data.name,name(a,t?.trainee_id)].filter(Boolean).join(' · ')||scheduleLabels[scheduleKind(s)];
}
export function scheduleView(db,a,data){
 const s=find(db,'schedule_event',data.id),r=scheduleResource(db,s,a.day);
 if(!r||!allowed(a,'calendar.detail',s.id,r))return {...data,type:'other',title:'Плановое событие',can_detail:false};
 const source=sourceLink(db,a,s);
 return {...data,state:scheduleDisplayState(db,s),type:scheduleKind(s),title:scheduleTitle(db,a,s,source),owner:name(a,s.owner_id),can_detail:true};
}
export function calendarDetail(db,a,id){
 const s=find(db,'schedule_event',id),r=scheduleResource(db,s,a.day);
 must(s&&detail(a,'calendar.read','calendar.detail',id,r),404,'План недоступен');
 const source=sourceLink(db,a,s),fact=factLink(db,a,s),state=scheduleDisplayState(db,s),cap=k=>!!a.personId&&allowed(a,k,id,r);
 const complete=state==='planned'&&cap('calendar.complete')&&a.personId===s.owner_id&&!!source;
 return {id,rev:s.rev,title:scheduleTitle(db,a,s,source),type:scheduleKind(s),label:scheduleLabels[scheduleKind(s)],owner:name(a,s.owner_id),date:s.due_on,state,day:a.day,source:routeOf(source),fact:routeOf(fact),candidates:complete?scheduleCandidates(db,a,s):[],cap:{complete,cancel:state==='planned'&&cap('calendar.cancel'),replan:state==='needs_replan'&&cap('calendar.replan')&&!!source}};
}
const makePlan=(type,source,owner,due)=>({kind:type==='audit'?'audit':'assessment',source_type:type==='audit'?'training_assignment':type==='practical'?'practical_assignment':'self_person',source_id:source,owner_id:owner,due_on:due,state:'planned'});
function planResource(db,a,type,source,owner,due){return scheduleResource(db,makePlan(type,source,owner,due),a.day)}
const planAllowed=(a,id,r)=>allowed(a,'calendar.plan',id,r)&&allowed(a,'calendar.read',id,r);
// Directory kind intentionally groups internal trainers with instructors.
// Use the same stricter matcher as the original L1 fact registration.
function ownerRole(type,p){return type==='audit'?p.roles.some(r=>matchesRoleKind(r,'internal_trainer')):type==='self_eval'?p.roles.some(r=>['instructor','mentor'].includes(r.kind)):true}
export function calendarOptions(db,a,type,sourceId=null){
 must(a.personId&&has(a,'calendar.plan')&&has(a,'calendar.read')&&['audit','practical','self_eval'].includes(type),403,'Планирование недоступно');
 const people=directoryPeople(db,a.day).filter(p=>who(a,p.id)&&ownerRole(type,p)&&planAllowed(a,p.id,personWorkResource(db,[p.id],a.day)));
 if(type==='self_eval'){
  return {day:a.day,type,sources:people.filter(p=>planAllowed(a,p.id,planResource(db,a,type,p.id,p.id,a.day))).map(p=>({id:p.id,label:p.display_name}))};
 }
 const assignments=rows(db,"SELECT * FROM training_assignment WHERE state<>'cancelled' AND approval_json IS NOT NULL AND source_sha256 IS NOT NULL ORDER BY assigned_on DESC,id").filter(t=>recordAccess(db,a,'training',t.id)&&people.some(p=>p.id!==t.trainee_id&&(type!=='audit'||p.id!==t.mentor_id)&&planAllowed(a,t.id,planResource(db,a,type,t.id,p.id,a.day))));
 if(sourceId!==null)must(assignments.some(t=>t.id===sourceId),404,'Назначение недоступно');
 const t=assignments.find(x=>x.id===sourceId);
 return {day:a.day,type,sources:assignments.map(x=>({id:x.id,rev:x.rev,label:[a.read('operation.read',x.operation_id)?.data.name||'Операция',name(a,x.trainee_id)||'Обучаемый',x.assigned_on].join(' · ')})),owners:t?people.filter(p=>p.id!==t.trainee_id&&(type!=='audit'||p.id!==t.mentor_id)&&planAllowed(a,t.id,planResource(db,a,type,t.id,p.id,a.day))).map(p=>({id:p.id,name:p.display_name})):[]};
}
export function createSchedule(db,a,f){
 must(a.personId&&exact(f,['type','source_id','source_rev','owner_id','due_on'])&&['audit','practical','self_eval'].includes(f.type)&&isId(f.source_id)&&isId(f.owner_id)&&validDate(f.due_on)&&f.due_on>=a.day,400,'Неверный план');
 const options=calendarOptions(db,a,f.type,f.type==='self_eval'?null:f.source_id);
 const source=options.sources.find(x=>x.id===f.source_id);
 must(source&&(f.type==='self_eval'?f.owner_id===f.source_id&&f.source_rev===null:options.owners.some(x=>x.id===f.owner_id)),403,'Источник или ответственный недоступен');
 if(f.type!=='self_eval')must(source.rev===f.source_rev,409,'Назначение изменилось');
 const owner=directoryPeople(db,f.due_on).find(p=>p.id===f.owner_id);
 must(owner&&ownerRole(f.type,owner),422,'На плановую дату у ответственного нет действующего назначения нужной роли');
 must(planAllowed(a,f.source_id,planResource(db,a,f.type,f.source_id,f.owner_id,f.due_on)),403,'План выходит за область полномочий');
 const p=f.type==='audit'?{assignment_id:f.source_id,owner_id:f.owner_id,due_on:f.due_on}:{command:'plan_assessment',type:f.type,source_id:f.source_id,owner_id:f.owner_id,due_on:f.due_on};
 return emit(db,a,'schedule_event',uuid(),'create',0,p,'calendar.plan');
}
export function changeSchedule(db,a,f){
 must(a.personId&&exact(f,['id','expected_revision','command','fields'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&['complete','cancel','replan'].includes(f.command),400,'Неверная команда плана');
 const s=find(db,'schedule_event',f.id),r=scheduleResource(db,s,a.day),k='calendar.'+f.command;
 must(s&&detail(a,'calendar.read','calendar.detail',s.id,r)&&allowed(a,k,s.id,r),403,'План недоступен');
 must(s.rev===f.expected_revision,409,'План изменился');
 let p;
 if(f.command==='cancel'){must(exact(f.fields,[])&&s.state==='planned',422,'Отменяется только открытый план');p={command:'cancel'}}
 else if(f.command==='replan'){must(exact(f.fields,['due_on'])&&validDate(f.fields.due_on)&&f.fields.due_on>=a.day&&scheduleDisplayState(db,s)==='needs_replan'&&sourceLink(db,a,s),422,'Требуется новая дата аннулированного плана');p={command:'replan',due_on:f.fields.due_on}}
 else{
  must(a.personId===s.owner_id&&exact(f.fields,['fact_id'])&&sourceLink(db,a,s)&&scheduleCandidates(db,a,s).some(x=>x.id===f.fields.fact_id),403,'Выберите доступный факт того же ответственного и источника');
  p=scheduleKind(s)==='audit'?{command:'complete',audit_id:f.fields.fact_id}:{command:'complete_assessment',fact_id:f.fields.fact_id};
 }
 return emit(db,a,'schedule_event',s.id,'update',s.rev,p,k);
}
export function calendarWorkspace(db,a,{mode,from,to}){
 must(['calendar','plan'].includes(mode)&&validDate(from)&&validDate(to)&&from<=to&&Date.parse(to)-Date.parse(from)<=366*86400000,400,'Выберите период не более года');
 const personal=mode==='plan',self=personal?a.personId:null;
 if(personal){must(personalPlanWorkspace(db,a),403,'Личный план доступен только связанному сотруднику')}
 else must(has(a,'calendar.read'),403,'Календарь недоступен');
 const items=[],add=(x,r,people)=>{
  if(!x.date||x.date>to||x.date<from&&!(personal&&x.pending&&x.date<a.day))return;
  if(personal){if(!people.includes(self))return}
  else if(!r||!allowed(a,'calendar.read',x.anchor,r))return;
  const {anchor,...item}=x;items.push({...item,overdue:!!x.pending&&x.date<a.day});
 };
 for(const s of rows(db,'SELECT * FROM schedule_event ORDER BY due_on,id')){
  const v=a.read('calendar.read',s.id);if(!v||personal&&s.owner_id!==self)continue;
  const r=scheduleResource(db,s,a.day);
  if(!r){
   // A legacy self row already passed the original owner-only projection.
   if(s.owner_id===a.personId&&s.due_on<=to&&(s.due_on>=from||personal&&s.state==='planned'))items.push({key:'schedule:'+s.id,date:s.due_on,type:'Исторический план',title:'Плановое событие',owner:name(a,s.owner_id),state:s.state,pending:s.state==='planned',overdue:s.state==='planned'&&s.due_on<a.day,route:null});
   continue;
  }
  const view=scheduleView(db,a,v.data);
  add({anchor:s.id,key:'schedule:'+s.id,date:s.due_on,type:scheduleLabels[scheduleKind(s)],title:view.title,owner:view.owner??null,state:view.state,pending:schedulePending(db,s),route:view.can_detail?{type:'schedule',id:s.id}:null},r,[s.owner_id]);
 }
 const addRecord=(type,id,date,title,owner,people,state,pending,key=null)=>{
  const link=recordAccess(db,a,type,id);if(!link)return;
  add({anchor:id,key:key||type+':'+id,date,type:({training:'Инструктаж TWI',enrollment:'Персональная программа',task:'Мероприятие',development:'Цель развития',preparation:'Подготовка'})[type],title,owner:name(a,owner),state,pending,route:routeOf(link)},link.resource,people);
 };
 for(const t of rows(db,"SELECT * FROM training_assignment WHERE source_sha256 IS NOT NULL AND state<>'cancelled'")){
  const p=['planned','in_progress'].includes(t.state);
  addRecord('training',t.id,t.due_on,a.read('operation.read',t.operation_id)?.data.name||'Назначение обучения',t.mentor_id,[t.trainee_id,t.mentor_id,t.supervisor_id],t.state,p);
 }
 for(const n of rows(db,"SELECT n.*,p.title FROM training_enrollment n JOIN training_program p ON p.id=n.program_id WHERE n.state<>'cancelled'"))addRecord('enrollment',n.id,n.due_on,n.title,n.mentor_id,[n.trainee_id,n.mentor_id,n.manager_id],n.state,n.state==='active');
 for(const t of actionRows(db)){
  const s=actionStatus(db,t);if(s==='cancelled')continue;
  addRecord('task',t.id,t.due_on,t.title,t.owner_id,[t.owner_id],s,['open','in_progress','implemented','ineffective'].includes(s));
 }
 for(const g of rows(db,"SELECT g.*,p.person_id FROM development_goal g JOIN development_plan p ON p.id=g.plan_id WHERE p.state<>'cancelled' AND g.state<>'cancelled'"))addRecord('development',g.plan_id,g.due_on,g.title,g.person_id,[g.person_id],g.state,g.state==='open','goal:'+g.id);
 for(const x of standardCalendar(db,a.day,{kind:'preparation'})){
  const b=find(db,'twi_preparation',x.options.id),trainee=name(a,b?.trainee_id);
  const done=['Завершена','Завершено'].includes(x.state);
  addRecord('preparation',x.options.id,x.date,x.type+(trainee?' · '+x.title:''),x.ownerId,x.people,x.state,!done,x.key);
 }
 // Annual milestones are derived from the original corporate rules.
 const annualByPerson=new Map(annualAuditCoverage(db,a.day.slice(0,4),a.day).map(x=>[x.personId,x]));
 for(const x of standardCalendar(db,a.day,{kind:'normative'})){
  if(x.page==='audit'){
   const p=annualByPerson.get(x.options.personId);
   if(!p||!who(a,p.personId)||!p.certificates.every(c=>a.read('credential.read',c.id))||![...p.audits,...p.unlinked,...p.duplicates].every(q=>recordAccess(db,a,'audit',q.id)))continue;
   const r=personWorkResource(db,[p.personId],a.day);
   if(!r)continue;
   add({anchor:p.personId,key:x.key,date:x.date,type:x.type,title:name(a,p.personId),owner:name(a,x.ownerId),state:x.state,pending:true,route:{type:'person',id:p.personId}},{...r,self:p.personId},x.people);
  }else if(x.page==='knowledge_bank'){
   const link=recordAccess(db,a,'bank',x.options.id);if(!link)continue;
   add({anchor:link.id,key:x.key,date:x.date,type:x.type,title:x.title,owner:name(a,x.ownerId),state:x.state,pending:true,route:routeOf(link)},link.resource,x.people);
  }
 }
 // Derived deadlines keep the original reference, never duplicate schedules.
 for(const r of rows(db,"SELECT r.id,r.review_due,r.author_id,d.title,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.state='effective' AND d.archived=0 AND o.archived=0 AND r.review_due IS NOT NULL")){
  const v=a.read('sop.read_history',r.id);if(!v)continue;
  add({anchor:r.id,key:'sop:'+r.id,date:r.review_due,type:'Пересмотр СОП',title:v.data.title||r.title,owner:name(a,r.author_id),state:'Действует',pending:true,route:{type:'sop',id:r.id}},unitResource(r.unit_id),[r.author_id]);
 }
 for(const r of rows(db,"SELECT * FROM economic_effect WHERE state='active'")){
  if(!financialRecordAllowed(db,a,r.id))continue;
  const state=effectStatus(db,r);
  add({anchor:r.id,key:'roi:'+r.id,date:r.review_due,type:'Контроль экономического эффекта',title:r.title,owner:name(a,r.owner_id),state,pending:effectPending(db,r),route:{type:'roi',id:r.id}},unitResource(r.unit_id),[r.owner_id]);
 }
 items.sort((x,y)=>Number(y.overdue)-Number(x.overdue)||x.date.localeCompare(y.date)||x.key.localeCompare(y.key));
 return {day:a.day,from,to,mode,items,can_plan:!!a.personId&&has(a,'calendar.plan')&&has(a,'calendar.read')};
}

// Authorization is a separate layer over the existing calculation registry.
// Never recompute ratios from a partially visible numerator or denominator.
const scopePermissions=['center.read','analytics.read','metrics.read'];
const scopes=(db,a,k)=>rows(db,'SELECT id,name FROM org_unit WHERE archived=0 ORDER BY name,id').filter(u=>a.read('org.read',u.id)&&allowed(a,k,u.id,unitResource(u.id)));
export function centerOptions(db,a,k){
 must(scopePermissions.includes(k)&&has(a,k),403,'Раздел недоступен');
 const {units,all}=reportScope(db,a,k);
 must(all||units.length,403,'Нет области аналитики');
 return {day:a.day,units,all,default_unit:all?'':units[0].id};
}
const PER_SOURCE={
 preparation:['preparation.read','preparation.detail','training.enrollment.read','training.enrollment.detail','training.read','training.detail','assessment.read','assessment.detail'],
 training:['training.read','training.detail'],
 twi:['training.read','training.detail','assessment.read','assessment.detail','sop.read_effective'],
 audit:['audit.read','audit.detail'],
 self:['self.read','self.detail'],
 schedule:['calendar.read','calendar.detail'],
 practice:['assessment.read','assessment.detail','training.read','training.detail'],
 skill:['person.read_basic','skill.read','requirement.read','assessment.read','assessment.detail'],
 sop:['sop.read_history'],
 sop_eval:['sop.read_history','sop.evaluation.read'],
 frv:['frv.read'],
 task:['task.read','task.detail','audit.read','audit.detail','assessment.read','assessment.detail','training.read','training.detail','training.enrollment.read','training.enrollment.detail','development.read','development.detail'],
 roi:['roi.read','roi.detail','task.read','task.detail','audit.read','audit.detail','assessment.read','assessment.detail','training.read','training.detail','training.enrollment.read','training.enrollment.detail','frv.read','frv.read_summary','development.read','development.detail']
};
// Financial details are deliberately site-wide in this QA release. A
// unit-only grant can read the old registry but not amounts or evidence.
export function financialScope(db,a){
 return [...PER_SOURCE.roi,'person.read_basic','self.read','self.detail'].every(k=>site(db,a,k));
}
export function comparisonAllowed(db,a,scope,c){
 if(!financialScope(db,a))return false;
 const source=scope.kind==='assignment'?recordAccess(db,a,'training',scope.source_id):a.read('program.read',scope.source_id)&&site(db,a,'program.detail');
 if(!source)return false;
 return [...c.before,...c.after].every(x=>who(a,x.person)&&recordAccess(db,a,scope.kind==='assignment'?'training':'enrollment',x.id)&&(x.assignmentIds||[]).every(id=>recordAccess(db,a,'training',id)));
}
export function financialRecordAllowed(db,a,id){
 if(!financialScope(db,a)||!a.read('roi.read',id))return false;
 const r=find(db,'economic_effect',id);
 if(!r||!who(a,r.owner_id))return false;
 if(r.study_id?!recordAccess(db,a,'frv',r.study_id):!recordAccess(db,a,'task',r.action_id))return false;
 const actual=JSON.parse(r.actual_json||'null');
 if(actual&&(!who(a,actual.reviewer_id)||!actual.actions.every(x=>recordAccess(db,a,'task',x.id))))return false;
 const basis=twiBasis(db,id);
 if(basis&&(!who(a,basis.p.actor_id)||!comparisonAllowed(db,a,basis.p.scope,basis.p.comparison)))return false;
 if(!effectFacts(db,id).every(f=>[f.registered_by,f.verifier_id,f.void_by].filter(Boolean).every(p=>who(a,p))))return false;
 // Period-target reviews may link other work. Do not expose its evidence if
 // it is outside the explicitly resolved task scope.
 for(const e of rows(db,"SELECT payload_json FROM change_event WHERE entity_type='economic_effect' AND entity_id=? AND json_extract(payload_json,'$.command') IN('period_target','period_target_cancel','period_review')",[id])){
  const p=JSON.parse(e.payload_json);if(p.actor_id&&!who(a,p.actor_id)||p.action_id&&!recordAccess(db,a,'task',p.action_id))return false;
 }
 return true;
}
const groupFor=id=>id.startsWith('prep_')?'preparation':id.startsWith('training_')?'training':id.startsWith('twi_')?'twi':id==='audit_count'?'audit':id==='self_count'?'self':id==='assessment_planned'?'schedule':id.startsWith('practice_')?'practice':id==='skill_coverage'?'skill':id==='sop_review'?'sop':['sop_evaluations','sop_weighted'].includes(id)?'sop_eval':id==='frv_final'?'frv':id.startsWith('actions_')?'task':id.startsWith('effect_')?'roi':null;
function evidenceLink(db,a,e){
 const o=e.options||{};
 if(e.page==='sop_review')return recordAccess(db,a,o.kind,o.id);
 if(e.page==='audit'&&o.mode==='annual')return recordAccess(db,a,'person',o.personId);
 const pair=({preparation:['preparation',o.id],twi:['training',o.id],audit:['audit',o.auditId],practical:['assessment',o.assessmentId],self_eval:['self',o.id],calendar:['schedule',o.id],person:['person',o.personId],sop:['sop',o.revisionId],frv:['frv',o.studyId],actions:['task',o.id],roi:['roi',o.id],knowledge_bank:['bank',o.id],supplements:['supplement',o.id]})[e.page];
 return pair&&pair[1]?recordAccess(db,a,...pair):null;
}
function evidenceOK(db,a,e){
 if(!evidenceLink(db,a,e))return false;
 if(e.requirementId&&(!a.read('requirement.read',e.requirementId)||!a.read('skill.read',e.skillId)))return false;
 if(e.sourceAssessmentId&&!recordAccess(db,a,'assessment',e.sourceAssessmentId))return false;
 return true;
}
function safeEvidence(db,a,e){
 const link=evidenceLink(db,a,e);
 return {key:e.key,label:e.page==='preparation'&&!name(a,e.personId)?'Комплект подготовки':e.label,date:e.date,state:e.state,included:e.included!==false,person:name(a,e.personId),method:e.method||null,reason:e.reason||null,required_level:e.requiredLevel??null,observed_level:e.observedLevel??null,route:routeOf(link)};
}
function buildProjection(db,a,k,scope){
 const options=centerOptions(db,a,k);
 must(exact(scope,['unit_id','from','to'])&&(scope.unit_id===''||isId(scope.unit_id))&&metricScopeValid({day:a.day,from:scope.from,to:scope.to})&&validDate(scope.from),400,'Неверный период');
 must(scope.unit_id?options.units.some(u=>u.id===scope.unit_id):options.all,403,'Область аналитики недоступна');
 const root=programResource(db),unit=scope.unit_id||root?.units[0],r=unitResource(unit);
 const can=keys=>keys.every(x=>allowed(a,x,unit,r));
 const full=keys=>keys.every(x=>site(db,a,x));
 const p=centerProjection(db,{day:a.day,from:scope.from,to:scope.to,unitId:scope.unit_id},{withEvidence:true});
 const training=p.metrics.find(m=>m.id==='training_assigned');
 const cohortOK=can(PER_SOURCE.training)&&training.evidence.every(e=>evidenceOK(db,a,e));
 const permitted=m=>{
  const g=groupFor(m.id);if(!g)return false;
  if(['twi','skill','roi'].includes(g)&&!full(PER_SOURCE[g]))return false;
  if(g==='roi'&&(!financialScope(db,a)||!rows(db,'SELECT id FROM economic_effect WHERE (?=\'\' OR unit_id=?)',[scope.unit_id,scope.unit_id]).every(x=>financialRecordAllowed(db,a,x.id))))return false;
  if(!can(PER_SOURCE[g]))return false;
  if(g==='twi'){
   if(!cohortOK)return false;
   // Cohort members can depend on subsequent practical and qualification
   // facts. They are separately protected, not inferred from a roster.
   for(const e of training.evidence){
    const id=e.options?.id;
    if(!rows(db,"SELECT id FROM assessment_session WHERE assignment_id=? AND state='confirmed'",[id]).every(q=>recordAccess(db,a,'assessment',q.id)))return false;
   }
  }
  return m.evidence.every(e=>evidenceOK(db,a,e));
 };
 const metrics=p.metrics.map(m=>{
  const ok=permitted(m);
  const {evidence,options,scope:unused,...data}=m;
  return {...data,dimensions:ok?m.dimensions:[],value:ok?m.value:null,denominator:ok?m.denominator:null,availability:ok?m.availability:'restricted',evidence:ok?evidence:[]};
 });
 return {options,p,metrics,can,full,scope};
}
export function centerWorkspace(db,a,k,scope){
 const b=buildProjection(db,a,k,scope),{p,metrics,can,full}=b,available=id=>metrics.some(m=>m.id===id&&m.availability!=='restricted');
 const out={day:a.day,scope,metrics:metrics.map(({evidence,...m})=>m),relations:METRIC_RELATIONS.map(([from,to,kind])=>({from,to,kind,label:RELATION_LABELS[kind]})),cohortMonths:available('training_assigned')&&available('training_completed')?p.cohortMonths:null,auditMonths:available('audit_count')?p.auditMonths:null,auditGroups:available('audit_count')?p.auditGroups:null,currencies:null,annual:null,attention:[]};
 // Monetary totals are shown only when every effect card in the slice is
 // readable under a dedicated site-wide financial and source grant.
 if(full(PER_SOURCE.roi)&&['effect_facts','effect_pending','effect_drafts'].every(available)){
  const economics=effectOverview(db,{day:a.day,from:scope.from,to:scope.to,unitId:scope.unit_id});
  if(economics.effects.every(e=>recordAccess(db,a,'roi',e.id)))out.currencies=p.currencies;
 }
 if(full(['credential.read','audit.read','audit.detail','person.read_basic','training.read','training.detail'])){
  const year=a.day.slice(0,4),annual=annualAuditCoverage(db,year,a.day).filter(x=>!scope.unit_id||personUnit(db,x.personId,a.day)===scope.unit_id);
  if(annual.every(x=>who(a,x.personId)&&x.certificates.every(c=>a.read('credential.read',c.id))&&[...x.audits,...x.unlinked,...x.duplicates].every(q=>recordAccess(db,a,'audit',q.id))))out.annual=annual.map(x=>({person:name(a,x.personId),person_id:x.personId,required:x.required,actual:x.audits.length,remaining:x.remaining,status:x.status}));
 }
 if(k==='center.read'){
  const attention=scopedAttention(db,a.day,scope.unit_id,centerAttention(db,a.day),null);
  const ids={sop_overdue:'sop_review',training_overdue:'training_overdue',action_overdue:'actions_overdue',action_verify:'actions_open',audit_planned:'assessment_planned',practical_planned:'assessment_planned',self_planned:'assessment_planned',roi_pending:'effect_pending',roi_overdue:'effect_overdue',roi_drafts:'effect_drafts',roi_targets:'effect_targets',roi_deviations:'effect_deviations',prep_overdue:'prep_overdue',prep_review:'prep_review'};
  const extra={sop_passport:PER_SOURCE.sop,training_revision:PER_SOURCE.training,prep_finish:PER_SOURCE.preparation,supplements_draft:['supplement.read','supplement.detail'],bank_stale:['bank.read','bank.detail'],bank_unregistered:['bank.read','bank.detail']};
  for(const x of attention.items){
   let ok=ids[x.id]?available(ids[x.id]):extra[x.id]?can(extra[x.id]):false;
   if(x.id==='annual_l1')ok=out.annual!==null;
   if(['bank_stale','bank_unregistered'].includes(x.id))ok=full(extra[x.id]);
   if(x.evidenceMismatch)ok=false;
   const records=Array.isArray(x.records)?x.records:[];
   if(x.id!=='bank_unregistered'&&x.count!==records.length)ok=false;
   if(ok&&records.every(e=>evidenceOK(db,a,e)))out.attention.push({id:x.id,group:x.group,priority:x.priority,label:x.label,basis:x.basis,advice:x.advice,count:x.count,records:records.slice(0,20).map(e=>safeEvidence(db,a,e)),scope:x.scope});
  }
 }
 return out;
}
export function metricEvidence(db,a,k,scope,id,offset=0){
 must(Number.isSafeInteger(offset)&&offset>=0,400,'Неверная страница');
 const b=buildProjection(db,a,k,scope),m=b.metrics.find(x=>x.id===id);
 must(m&&m.availability!=='restricted',404,'Показатель недоступен');
 return {id:m.id,label:m.label,definition:m.definition,rules:m.rules,basis:m.basis,source:m.source,value:m.value,denominator:m.denominator,total:m.evidence.length,offset,items:m.evidence.slice(offset,offset+50).map(e=>safeEvidence(db,a,e))};
}
