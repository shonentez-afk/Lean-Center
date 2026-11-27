// Protected program templates, personal enrolments, task facts and preparation
// links. The LC4/LC6 validators and enrollmentTasks remain authoritative.
import {one,rows,uuid,isId,foldKey,applyEvent} from '../../src/core/db.js';
import {programKinds,parts,conclusions} from '../../src/modules/training/domain.js';
import {PROGRAM_DOCS} from '../../src/modules/training/standard-workflows.js';
import {enrollmentTasks,sharedTrainingTask,latestTaskAssignment} from '../../src/modules/training/training-facts.js';
import {preparationProgress} from '../../src/modules/training/preparation-results.js';
import {programResource,enrollmentResource,preparationResource,personWorkResource,trainingAssignmentResource} from './read-policy.mjs';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {matchesRoleKind} from '../../src/modules/master-data/role-matching.js';
import {PilotError} from '../lc74-store.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const text=(s,n=500)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const nullableId=s=>s===null||isId(s);
const nullableDate=s=>s===null||date(s);
const taskId=s=>typeof s==='string'&&s.length<=100;
const readPerson=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
const name=(a,id)=>readPerson(a,id)?.data.display_name??null;
const allowed=(a,action,id,r)=>!!r&&a.allows(action,id,r);
const pRow=(db,id)=>isId(id)?one(db,'SELECT * FROM training_program WHERE id=?',[id]):null;
const nRow=(db,id)=>isId(id)?one(db,'SELECT * FROM training_enrollment WHERE id=?',[id]):null;
const pTasks=(db,id)=>rows(db,'SELECT * FROM training_program_task WHERE program_id=? ORDER BY position',[id]);
const plus=(d,n)=>{const v=new Date(d+'T00:00:00Z');v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10)};
const programLabel=p=>p.code+' · '+p.title+' · v'+p.version_no;
const kinds=Object.fromEntries(Object.entries(PROGRAM_DOCS).map(([k,v])=>[k,v.title]));
function emit(db,a,type,id,operation,rev,payload,action){
 const event=uuid();
 try{applyEvent(db,{id:event,entity_type:type,entity_id:id,operation,expected_revision:rev,payload,occurred_at:a.at})}
 catch(e){throw new PilotError(422,'Проверка программы: '+String(e.message||'ошибка').split('\n')[0].slice(0,250))}
 a.audit(action,event);
 return {id,rev:one(db,'SELECT rev FROM '+type+' WHERE id=?',[id]).rev};
}
function sitePermission(db,a,action){const r=programResource(db);return !!r&&allowed(a,action,r.units[0],r)}
function readableEnrollment(db,a,id){const n=nRow(db,id);must(n&&a.read('training.enrollment.read',id),404,'Персональная программа недоступна');return n}
function capEnrollment(db,a,n,action){return allowed(a,action,n.id,enrollmentResource(db,n,a.day))}
export function programView(db,a,action,data){
 if(action==='program.read')return {...data,can_detail:sitePermission(db,a,'program.detail')};
 if(action==='training.enrollment.read'){
  const n=nRow(db,data.id);return {...data,trainee_name:name(a,n.trainee_id),can_detail:capEnrollment(db,a,n,'training.enrollment.detail')};
 }
 const b=one(db,'SELECT * FROM twi_preparation WHERE id=?',[data.id]);
 return {...data,trainee_name:name(a,b.trainee_id),can_detail:allowed(a,'preparation.detail',b.id,preparationResource(db,b,a.day))};
}
export function programOptions(db,a){
 must(a.personId&&sitePermission(db,a,'program.create')&&sitePermission(db,a,'program.read'),403,'Конструктор программ недоступен');
 const refs=table=>rows(db,'SELECT id,name FROM '+table+' WHERE archived=0 ORDER BY name,id');
 const sops=rows(db,"SELECT r.id,d.operation_id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='effective' AND d.archived=0 AND d.kind='sop' ORDER BY d.code,r.id").flatMap(r=>{
  const v=a.read('sop.read_effective',r.id);return v&&a.read('operation.read',r.operation_id)?[{id:r.id,title:v.data.code+' · '+v.data.title,skills:rows(db,'SELECT id,name FROM skill WHERE archived=0 AND operation_id=? ORDER BY name',[r.operation_id])}]:[];
 });
 return {day:a.day,kinds,parts,professions:refs('profession'),positions:refs('position'),sops,scales:refs('rating_scale').map(s=>({...s,levels:rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[s.id])}))};
}
export function saveProgram(db,a,f){
 must(a.personId&&sitePermission(db,a,'program.create')&&sitePermission(db,a,'program.read'),403,'Конструктор программ недоступен');
 must(exact(f,['code','title','standard_kind','profession_id','position_id','tasks','previous_id','previous_rev'])&&text(f.code,100)&&f.code===f.code.trim()&&text(f.title)&&Object.hasOwn(PROGRAM_DOCS,f.standard_kind)&&nullableId(f.profession_id)&&nullableId(f.position_id)&&nullableId(f.previous_id)&&Number.isSafeInteger(f.previous_rev)&&f.previous_rev>=0&&Array.isArray(f.tasks)&&f.tasks.length>=1&&f.tasks.length<=100,400,'Неверные реквизиты программы');
 const previous=rows(db,'SELECT * FROM training_program').filter(p=>foldKey(p.code)===foldKey(f.code));
 const active=previous.find(p=>p.state==='active');
 must(f.previous_id===(active?.id??null)&&f.previous_rev===(active?.rev??0),409,'Версия программы изменилась. Откройте действующую версию');
 for(const t of f.tasks){
  must(exact(t,['part','title','hours','day_offset','sop_revision_id','skill_id','scale_id','target_level'])&&Object.hasOwn(parts,t.part)&&text(t.title)&&typeof t.hours==='number'&&Number.isFinite(t.hours)&&t.hours>=0&&t.hours<=1000&&Number.isSafeInteger(t.day_offset)&&t.day_offset>=0&&t.day_offset<=3660,400,'Неверное задание');
  if(t.sop_revision_id!==null){
   must(isId(t.sop_revision_id)&&isId(t.skill_id)&&isId(t.scale_id)&&Number.isSafeInteger(t.target_level),400,'Выберите СОП, навык, шкалу и уровень');
   const v=a.read('sop.read_effective',t.sop_revision_id);
   must(v&&a.read('operation.read',v.data.operation_id),403,'Редакция СОП недоступна');
  }else must(t.skill_id===null&&t.scale_id===null&&t.target_level===null,400,'Уровень требует СОП');
 }
 const payload={code:f.code,title:f.title,standard_kind:f.standard_kind,kind:PROGRAM_DOCS[f.standard_kind].kind,profession_id:f.profession_id,position_id:f.position_id,created_by:a.personId,tasks:f.tasks};
 return emit(db,a,'training_program',uuid(),'create',0,payload,'program.create');
}
export function retireProgram(db,a,f){
 must(a.personId&&sitePermission(db,a,'program.retire')&&sitePermission(db,a,'program.read'),403,'Закрытие программы недоступно');
 must(exact(f,['id','expected_revision','reason'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&text(f.reason),400,'Укажите основание закрытия');
 const p=pRow(db,f.id);must(p&&a.read('program.read',f.id),404,'Программа недоступна');must(p.rev===f.expected_revision&&p.state==='active',409,'Версия программы изменена');
 return emit(db,a,'training_program',p.id,'update',p.rev,{command:'retire',reason:f.reason},'program.retire');
}
export function programDetail(db,a,id){
 const p=pRow(db,id);must(p&&a.read('program.read',id)&&sitePermission(db,a,'program.detail'),404,'Программа недоступна');
 return {id:p.id,code:p.code,title:p.title,kind:p.kind,standard_kind:p.standard_kind,version_no:p.version_no,rev:p.rev,state:p.state,profession_id:p.profession_id,position_id:p.position_id,tasks:pTasks(db,p.id).map(({id,program_id,position,...t})=>({id,position,...t})),can_revise:!!a.personId&&p.state==='active'&&sitePermission(db,a,'program.create'),can_retire:!!a.personId&&p.state==='active'&&sitePermission(db,a,'program.retire')};
}
export function enrollmentOptions(db,a){
 must(a.personId&&a.permissions.includes('training.enrollment.create'),403,'Назначение программы недоступно');
 const action='training.enrollment.create',people=directoryPeople(db,a.day).filter(p=>readPerson(a,p.id)&&allowed(a,action,p.id,personWorkResource(db,[p.id],a.day)));
 const pick=(kinds)=>people.filter(p=>p.roles.some(r=>kinds.some(k=>matchesRoleKind(r,k)))).map(p=>({id:p.id,name:p.display_name}));
 return {day:a.day,programs:rows(db,"SELECT * FROM training_program WHERE state='active' ORDER BY code").filter(p=>a.read('program.read',p.id)).map(p=>({id:p.id,label:programLabel(p),kind:p.kind,standard_kind:p.standard_kind,version_no:p.version_no,rev:p.rev})),trainees:pick(['trainee']),mentors:pick(['mentor','instructor']),managers:people.map(p=>({id:p.id,name:p.display_name}))};
}
export function createEnrollment(db,a,f){
 const action='training.enrollment.create';
 must(a.personId&&exact(f,['program_id','program_rev','trainee_id','mentor_id','manager_id','start_on','due_on','reason','internship_start','internship_end','entry_start','entry_end'])&&isId(f.program_id)&&Number.isSafeInteger(f.program_rev)&&[f.trainee_id,f.mentor_id,f.manager_id].every(isId)&&f.trainee_id!==f.manager_id&&f.trainee_id!==a.personId&&date(f.start_on)&&date(f.due_on)&&f.start_on>=a.day&&f.due_on>=f.start_on&&text(f.reason)&&[f.internship_start,f.internship_end,f.entry_start,f.entry_end].every(nullableDate),400,'Неверные реквизиты персональной программы');
 const p=pRow(db,f.program_id);must(p&&a.read('program.read',p.id),404,'Шаблон недоступен');must(p.rev===f.program_rev&&p.state==='active',409,'Шаблон изменён');
 must([f.trainee_id,f.mentor_id,f.manager_id].every(id=>readPerson(a,id)),403,'Сотрудники недоступны');
 const {program_rev,...payload}=f,n={...payload,state:'active'},r=enrollmentResource(db,n,a.day);
 must(allowed(a,action,f.trainee_id,r)&&allowed(a,'training.enrollment.read',f.trainee_id,r),403,'Программа выходит за область полномочий');
 // All SOP tasks must still point to active revisions when assigning a new plan.
 for(const t of pTasks(db,p.id))if(t.sop_revision_id)must(a.read('sop.read_effective',t.sop_revision_id),422,'В шаблоне устаревший или недоступный СОП; обновите шаблон');
 return emit(db,a,'training_enrollment',uuid(),'create',0,payload,action);
}
export function changeEnrollment(db,a,f){
 must(a.personId&&exact(f,['id','expected_revision','command','fields'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&['result','finish','cancel'].includes(f.command),400,'Неверная команда программы');
 const n=readableEnrollment(db,a,f.id),action='training.enrollment.'+f.command;
 must(a.personId!==n.trainee_id&&capEnrollment(db,a,n,action)&&(f.command==='result'?[n.mentor_id,n.manager_id].includes(a.personId):a.personId===n.manager_id),403,'Действие выполняет назначенный наставник или руководитель с соответствующим правом');
 must(n.rev===f.expected_revision&&n.state==='active',409,'Программа изменена или закрыта');
 const v=f.fields;
 if(f.command==='result'){
  must(exact(v,['task_id','held_on','result','minutes','evidence'])&&taskId(v.task_id)&&date(v.held_on)&&v.held_on<=a.day&&['completed','incomplete'].includes(v.result)&&Number.isSafeInteger(v.minutes)&&v.minutes>=0&&v.minutes<=1440&&text(v.evidence),400,'Заполните фактический результат');
  const task=one(db,'SELECT id,sop_revision_id FROM training_program_task WHERE id=? AND program_id=?',[v.task_id,n.program_id]);
  must(task&&!task.sop_revision_id,422,'Задание по СОП закрывается фактом инструктажа');
  const e=emit(db,a,'training_task_result',uuid(),'create',0,{...v,enrollment_id:n.id,actor_id:a.personId,enrollment_rev:n.rev},action);
  return {...e,enrollment_rev:one(db,'SELECT rev FROM training_enrollment WHERE id=?',[n.id]).rev};
 }
 must(exact(v,['conclusion','feedback'])&&text(v.feedback)&&(f.command==='cancel'?v.conclusion===null:Object.hasOwn(conclusions,v.conclusion)),400,'Укажите решение и основание');
 return emit(db,a,'training_enrollment',n.id,'update',n.rev,{command:f.command,actor_id:a.personId,...v},action);
}
export function enrollmentDetail(db,a,id){
 const n=readableEnrollment(db,a,id);must(capEnrollment(db,a,n,'training.enrollment.detail'),404,'Карточка программы недоступна');
 const p=pRow(db,n.program_id),r=enrollmentResource(db,n,a.day),can=action=>!!a.personId&&n.state==='active'&&a.personId!==n.trainee_id&&capEnrollment(db,a,n,action);
 const tasks=enrollmentTasks(db,n).map(t=>{
  const v=t.sop_revision_id?a.read('sop.read_effective',t.sop_revision_id):null;
  const canTrain=!!v&&n.state==='active'&&!t.shared&&!t.assignment&&!!a.personId&&a.personId!==n.trainee_id&&allowed(a,'training.create',v.data.operation_id,r)&&allowed(a,'training.read',v.data.operation_id,r);
  const linked=t.assignment&&a.read('training.read',t.assignment.id)&&allowed(a,'training.detail',t.assignment.id,trainingAssignmentResource(db,t.assignment.id,a.day));
  return {id:t.id,position:t.position,part:t.part,title:t.title,hours:t.hours,planned_on:plus(n.start_on,t.day_offset),sop:!!t.sop_revision_id,done:t.done,shared:!!t.shared,assignment_id:linked?t.assignment.id:null,assignment_state:t.assignment?.state??null,result:t.result?{held_on:t.result.held_on,result:t.result.result,minutes:t.result.minutes,evidence:t.result.evidence}:null,
   link:canTrain?{enrollment_id:n.id,enrollment_rev:n.rev,program_task_id:t.id,trainee_id:n.trainee_id,operation_id:v.data.operation_id,revision_id:t.sop_revision_id,skill_id:t.skill_id,scale_id:t.scale_id,target_level:t.target_level,start_on:n.start_on,due_on:n.due_on}:null};
 });
 return {id:n.id,rev:n.rev,title:p.title,code:p.code,version_no:p.version_no,kind:p.kind,standard_kind:p.standard_kind,state:n.state,trainee:name(a,n.trainee_id),mentor:name(a,n.mentor_id),manager:name(a,n.manager_id),start_on:n.start_on,due_on:n.due_on,conclusion:n.conclusion,feedback:n.feedback,parts,conclusions,tasks,day:a.day,cap:{result:can('training.enrollment.result')&&[n.mentor_id,n.manager_id].includes(a.personId),finish:can('training.enrollment.finish')&&a.personId===n.manager_id,cancel:can('training.enrollment.cancel')&&a.personId===n.manager_id}};
}
export function preparationOptions(db,a){
 must(a.personId&&a.permissions.includes('preparation.create'),403,'Комплект подготовки недоступен');
 const docs=rows(db,"SELECT n.*,p.standard_kind,p.title FROM training_enrollment n JOIN training_program p ON p.id=n.program_id WHERE n.state<>'cancelled' AND p.standard_kind IN('adaptation','safety','internship') ORDER BY n.start_on,n.id").filter(n=>n.trainee_id!==a.personId&&readPerson(a,n.trainee_id)&&a.read('training.enrollment.read',n.id)&&allowed(a,'preparation.create',n.id,enrollmentResource(db,n,a.day))).map(n=>({id:n.id,rev:n.rev,trainee_id:n.trainee_id,trainee:name(a,n.trainee_id),kind:n.standard_kind,label:n.title+' · '+n.start_on+' — '+n.due_on}));
 return {day:a.day,docs,shifts:rows(db,'SELECT id,code,name FROM work_shift WHERE archived=0 ORDER BY code,id')};
}
export function createPreparation(db,a,f){
 must(a.personId&&exact(f,['trainee_id','category','adaptation_id','safety_id','internship_id','revisions','shifts','note'])&&isId(f.trainee_id)&&f.trainee_id!==a.personId&&['new','transfer'].includes(f.category)&&[f.adaptation_id,f.safety_id,f.internship_id].every(isId)&&exact(f.revisions,['adaptation','safety','internship'])&&Object.values(f.revisions).every(Number.isSafeInteger)&&Array.isArray(f.shifts)&&f.shifts.length>=2&&f.shifts.length<=366&&f.shifts.every(s=>exact(s,['date','shift_id'])&&date(s.date)&&isId(s.shift_id))&&typeof f.note==='string'&&f.note.length<=500,400,'Неверные реквизиты комплекта');
 const ns=[f.adaptation_id,f.safety_id,f.internship_id].map(id=>readableEnrollment(db,a,id));
 must(ns.every((n,i)=>n.rev===f.revisions[['adaptation','safety','internship'][i]]),409,'Документы подготовки изменились');
 must(readPerson(a,f.trainee_id),403,'Сотрудник недоступен');
 const {revisions,...data}=f,payload={...data,manager_id:a.personId},r=preparationResource(db,payload,a.day);
 must(allowed(a,'preparation.create',f.trainee_id,r)&&allowed(a,'preparation.read',f.trainee_id,r),403,'Комплект выходит за область полномочий');
 return emit(db,a,'twi_preparation',uuid(),'create',0,payload,'preparation.create');
}
export function preparationDetail(db,a,id){
 const b=isId(id)&&one(db,'SELECT * FROM twi_preparation WHERE id=?',[id]);
 must(b&&a.read('preparation.read',id)&&allowed(a,'preparation.detail',id,preparationResource(db,b,a.day)),404,'Комплект подготовки недоступен');
 const q=preparationProgress(db,b),docs=[b.adaptation_id,b.safety_id,b.internship_id].map((id,i)=>{
  const n=nRow(db,id),v=a.read('training.enrollment.read',id);
  return {kind:['adaptation','safety','internship'][i],state:n.state,id:v&&capEnrollment(db,a,n,'training.enrollment.detail')?id:null};
 });
 return {id:b.id,trainee:name(a,b.trainee_id),category:b.category,status:q.status,documents:docs,planned_shifts:JSON.parse(b.shifts_json).map(x=>({date:x.date,shift:one(db,'SELECT name FROM work_shift WHERE id=?',[x.shift_id])?.name??''})),completed_shifts:q.shifts.filter(x=>x.data.result==='completed').length};
}
