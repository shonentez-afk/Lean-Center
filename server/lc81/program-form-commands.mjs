// Populated preparation documents in the protected portal. Reuse LC4/LC6
// projections; no new qualification rules or mutable print-only results.
import {one,rows} from '../../src/core/db.js';
import {entryWorkbook,plusDays} from '../../src/modules/training/corporate-forms.js';
import {preparationPrintWorkbook} from '../../src/modules/training/standard-final-prints.js';
import {enrollmentTasks,progressFor} from '../../src/modules/training/training-facts.js';
import {preparationProgress,RESULT_LABELS,COMMISSION_ROLES} from '../../src/modules/training/preparation-results.js';
import {enrollmentResource,preparationResource,trainingAssignmentResource,personWorkResource,assessmentResource,programResource} from './read-policy.mjs';
import {enrollmentDetail,preparationDetail} from './program-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const deny='Не все исходные данные документа доступны';
const get=(db,t,id)=>one(db,'SELECT * FROM '+t+' WHERE id=?',[id]);
const labels={shift:'Факт смены стажировки',safety:'Протокол ОТ',internship:'Итог стажировки',questions:'Выдача вопросов',commission:'Решение комиссии'};
const blocks={technology:'Технология производства',quality:'Качество продукции',equipment:'Оборудование',lean:'Бережливое производство'};
const name=(a,id)=>{const x=a.read('person.read_directory',id)||a.read('person.read_basic',id);must(x,403,deny);return x.data.display_name};
export function programFormsAvailable(db,a){
 const site=programResource(db);
 return !!a.personId&&!!site&&a.scope('forms.export',site.units[0],site)&&a.scope('program.detail',site.units[0],site);
}
function guard(db,a,id,base){
 must(programFormsAvailable(db,a)&&base&&a.scope('forms.export',id,base),403,deny);
 const units=new Set(base.units);let count=0;
 const add=r=>{must(r,403,deny);for(const u of r.units)units.add(u)};
 const person=(pid,on)=>{if(!pid)return '';const n=name(a,pid);add(personWorkResource(db,[pid],a.day,on?[on]:[]));return n};
 const history=(pid,on)=>{
  person(pid,on);
  const found=rows(db,"SELECT * FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=?",[pid,on,on]);
  must(found.length===1,403,deny);
  const p=found[0],u=a.read('org.read',p.unit_id),pos=p.position_id?a.read('position.read',p.position_id):null;
  must(a.read('employment.read',p.id)&&u&&(!p.position_id||pos),403,deny);
  return {unit:u.data.name,position:pos?.data.name||''};
 };
 const revision=rid=>{
  const rev=a.read('sop.read_history',rid);
  must(rev&&a.read('operation.read',rev.data.operation_id),403,deny);
  return rev.data.code+' · '+rev.data.title+' · v'+rev.data.version_no;
 };
 const fact=()=>must(++count<=6000,413,'Слишком много фактических записей для документа');
 const assignment=(r,on,extra=[])=>{
  const res=trainingAssignmentResource(db,r.id,a.day,extra,on||r.assigned_on);
  must(a.read('training.read',r.id)&&res&&a.scope('training.detail',r.id,res),403,deny);
  add(res);person(r.trainee_id,on);person(r.mentor_id,on);
  if(r.supervisor_id)person(r.supervisor_id,on);
 };
 const assessment=r=>{
  if(!r)return;
  const res=assessmentResource(db,r,a.day);
  must(res&&a.read('assessment.read',r.id)&&a.scope('assessment.detail',r.id,res),403,deny);
  add(res);person(r.evaluator_id,r.assessed_at.slice(0,10));
 };
 return {add,person,history,revision,fact,assignment,assessment,finish:()=>must(a.scope('forms.export',id,{...base,self:null,assigned:[],units:[...units]}),403,'Требуется единая область доступа ко всем основаниям документа')};
}
function loadEnrollment(db,a,n,g){
 must(n,404,deny);enrollmentDetail(db,a,n.id);
 g.add(enrollmentResource(db,n,a.day));
 const p=get(db,'training_program',n.program_id);
 must(p&&a.read('program.read',p.id)&&a.scope('program.detail',p.id,programResource(db)),403,deny);
 const scope=g.history(n.trainee_id,n.start_on),mentorScope=g.history(n.mentor_id,n.start_on),managerScope=g.history(n.manager_id,n.start_on);
 const trainee=g.person(n.trainee_id,n.start_on),mentor=g.person(n.mentor_id,n.start_on),manager=g.person(n.manager_id,n.start_on);
 const tasks=enrollmentTasks(db,n),facts=[],evidence=[],revisions=new Map(),responsibles=new Map(),actual=new Map();
 must(tasks.length<=500,413,'Слишком много заданий для документа');
 for(const t of tasks){
  if(t.sop_revision_id){
   revisions.set(t.sop_revision_id,g.revision(t.sop_revision_id));
   if(t.shared){enrollmentDetail(db,a,t.shared.enrollmentId);g.add(enrollmentResource(db,get(db,'training_enrollment',t.shared.enrollmentId),a.day))}
   const linked=rows(db,'SELECT * FROM training_assignment WHERE enrollment_id=? AND program_task_id=?',[t.shared?.enrollmentId||n.id,t.shared?.taskId||t.id]);
   for(const r of linked){
    g.assignment(r,r.assigned_on);
    for(const f of rows(db,'SELECT * FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL ORDER BY held_at,id',[r.id])){
     g.fact();const on=f.held_at.slice(0,10);
     g.assignment(r,on,[f.mentor_id,f.witness_id].filter(Boolean));
     const actor=g.person(f.mentor_id,on);
     facts.push({date:on,minutes:f.duration_minutes,title:t.title});
     evidence.push([on,t.title,actor,f.stage_code,f.result,f.duration_minutes,f.notes||'',r.id,f.id]);
    }
   }
   if(t.assignment){const pr=progressFor(db,t.assignment);actual.set(t.id,pr.facts.filter(f=>pr.stages.some(s=>s.code===f.stage_code&&s.phase!=='followup')).reduce((sum,f)=>sum+f.duration_minutes,0)/60);responsibles.set(t.id,g.person(t.assignment.mentor_id,t.assignment.assigned_on))}
  }else{
   for(const f of rows(db,'SELECT * FROM training_task_result WHERE enrollment_id=? AND task_id=? ORDER BY held_on,id',[n.id,t.id])){
    g.fact();const actor=g.person(f.actor_id,f.held_on);facts.push({date:f.held_on,minutes:f.minutes,title:t.title});
    evidence.push([f.held_on,t.title,actor,'Задание',RESULT_LABELS[f.result]||f.result,f.minutes,f.evidence,'',f.id]);
   }
   if(t.result){actual.set(t.id,t.result.minutes/60);responsibles.set(t.id,g.person(t.result.actor_id,t.result.held_on))}
  }
 }
 return {n,p,scope,mentorScope,managerScope,trainee,mentor,manager,tasks,facts,evidence,revisions,responsibles,actual};
}
function table(book,title,headers,data,widths){
 const s=book.addWorksheet(title,{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 s.columns=widths.map(width=>({width}));s.addRow(headers);
 for(const row of data)s.addRow(row.map(v=>v??''));
 s.eachRow((r,i)=>{r.alignment={wrapText:true,vertical:'middle'};if(i===1){r.font={bold:true,color:{argb:'FF243746'}};r.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE2ECF0'}}}});
 s.views=[{state:'frozen',ySplit:1}];s.pageSetup.printTitlesRow='1:1';return s;
}
function factsSheet(book,v){
 return table(book,'Фактические записи',['Дата','Задание','Ответственный','Этап','Результат','Минут','Основание','Назначение','ID факта'],v.evidence,[15,45,28,24,20,10,55,38,38]);
}
export function entryForm(db,a,id,X){
 const n=get(db,'training_enrollment',id),p=n&&get(db,'training_program',n.program_id);
 must(p?.kind==='entry',422,'Приложение 1 формируется из плана ввода в профессию');
 const g=guard(db,a,id,enrollmentResource(db,n,a.day)),v=loadEnrollment(db,a,n,g);g.finish();
 const book=entryWorkbook(X,v.p,n,v.tasks,{scope:v.scope.unit,trainee:v.trainee,mentor:v.mentor,manager:v.manager,revision:r=>v.revisions.get(r)||'',responsible:t=>v.responsibles.get(t.id)||'',facts:v.facts,operationType:t=>t.sop_revision_id?(t.shared?'Базовая':v.p.standard_kind==='adaptation'?'Основная':''):''});
 factsSheet(book,v);return book;
}
export function preparationForms(db,a,id,X,ids){
 const b=get(db,'twi_preparation',id);
 must(b,404,deny);const detail=preparationDetail(db,a,id);
 must(detail.documents.every(x=>x.id),403,deny);
 const g=guard(db,a,id,preparationResource(db,b,a.day));
 const q=preparationProgress(db,b),docs=[b.adaptation_id,b.safety_id,b.internship_id].map(id=>loadEnrollment(db,a,get(db,'training_enrollment',id),g));
 for(const f of q.facts){
  g.fact();g.person(f.actor_id,f.fact_on);
  if(f.kind==='commission')for(const pid of Object.values(f.data.members))g.person(pid,f.fact_on);
  if(f.kind==='questions')must(a.read('bank.read',f.data.bank_id)&&a.scope('bank.detail',f.data.bank_id,programResource(db)),403,deny);
  if(f.kind==='shift')must(a.read('shift.read',f.data.shift_id),403,deny);
 }
 for(const s of [q.safety.evidence,q.internship.evidence,q.main])for(const o of s.operations){
  g.assessment(o.practical);g.assessment(o.qualification);
 }
 const record=x=>x?{date:x.fact_on,actor:g.person(x.actor_id,x.fact_on),result:RESULT_LABELS[x.data.result]||RESULT_LABELS[x.data.conclusion]||'',reference:x.data.reference||'',feedback:x.data.feedback||''}:null;
 const safety=record(q.safety.fact),intern=record(q.internship.fact),commission=record(q.commission),current=(x,v)=>x&&!v?{...x,result:'Требуется повторная проверка · '+x.result}:x;
 const assessments=[{title:'Проверка знаний требований ОТ',format:'Протокол',...current(safety,q.safety.current)},{title:'Овладение практическими навыками',format:'Чек-лист TWI / матрица',...current(intern,q.internship.current)},{title:'Теоретическая часть: технология, оборудование, качество, бережливое производство',format:'Проверка знаний',date:q.commission?.fact_on,actor:commission?.actor,result:q.commission?q.commission.data.theory.map(t=>blocks[t.block]+': '+RESULT_LABELS[t.result]).join('; '):'',reference:q.commission?.data.reference},{title:'ИТОГОВОЕ заключение',format:'Комиссия',...current(commission,q.current)}];
 const operationEvidence=(stage,label)=>stage.operations.map(o=>[label,o.task.title,o.assignment?.id,o.practical?.id,o.qualification?.id,o.level,o.validUntil,o.observed?(o.ok?'Подтверждено':'Не соответствует'):'Нет полного основания',o.exact?'Приложение 9':o.practical?'Другая методика':'Нет оценки']);
 const evidence=[...operationEvidence(q.safety.evidence,'ОТ'),...operationEvidence(q.internship.evidence,'Стажировка'),...operationEvidence(q.main,'Адаптация')];
 const members=q.commission?Object.entries(COMMISSION_ROLES).map(([k,v])=>[v,g.person(q.commission.data.members[k],q.commission.fact_on),'']):[];
 const questions=q.questions?q.questions.issued.flatMap(b=>b.questions.map(x=>[q.questions.fact.fact_on,q.questions.bank.version_no,blocks[b.id],x.number,x.text])):[];
 const shifts=JSON.parse(b.shifts_json),actualShifts=new Map(q.shifts.map(f=>[f.fact_on+':'+f.data.shift_id,f]));
 const planned=new Map(shifts.map(s=>[s.date+':'+s.shift_id,s]));
 for(const f of q.shifts)if(!planned.has(f.fact_on+':'+f.data.shift_id))planned.set(f.fact_on+':'+f.data.shift_id,{date:f.fact_on,shift_id:f.data.shift_id,extra:true});
 const shiftRows=[...planned].sort(([a],[b])=>a.localeCompare(b)).map(([k,s])=>{const f=actualShifts.get(k),v=a.read('shift.read',s.shift_id);must(v,403,deny);return [s.date,v.data.name,s.extra?'Вне плана':'План',f?RESULT_LABELS[f.data.result]:'Не зарегистрирована',f?.data.minutes,f?g.person(f.actor_id,f.fact_on):'',f?.data.note,f?.id]});
 const projected=ids.map(id=>{
  const v=docs[id-2],n=v.n;
  const staff=(s,p)=>[s,p.position].filter(Boolean).join(' · ');
  const fields={'Ф.И.О. сотрудника':v.trainee,'Должность':v.scope.position,'Ф.И.О. и должность наставника':staff(v.mentor,v.mentorScope),'Ф.И.О. и должность руководителя':staff(v.manager,v.managerScope),'Подразделение':v.scope.unit,'Период адаптации по профессии':n.start_on+' — '+n.due_on,'Период обучения по ОТ':n.start_on+' — '+n.due_on,'Период стажировки':n.start_on+' — '+n.due_on,'План / факт смен (не менее двух смен)':shifts.length+' / '+q.shifts.filter(x=>x.data.result==='completed').length};
  const tasks=v.tasks.map(t=>({part:t.part,title:t.title,sop:v.revisions.get(t.sop_revision_id)||'',hours:t.hours,planDate:plusDays(n.start_on,t.day_offset),responsible:v.responsibles.get(t.id)||v.mentor,actual:v.actual.get(t.id)??null,status:t.done?'Выполнено':'Не завершено'}));
  const results=q.facts.filter(x=>id===2||id===3&&x.kind==='safety'||id===4&&['shift','internship'].includes(x.kind)).map(x=>({date:x.fact_on,label:labels[x.kind],actor:g.person(x.actor_id,x.fact_on),text:[RESULT_LABELS[x.data.result]||x.data.result,RESULT_LABELS[x.data.conclusion],x.data.reference,x.data.feedback,x.data.note,x.data.minutes?x.data.minutes+' мин.':''].filter(Boolean).join(' · ')}));
  return {id,v,fields,tasks,assessments,results,outcome:id===3?current(safety,q.safety.current):id===4?current(intern,q.internship.current):null};
 });
 g.finish();
 return projected.map(({id,v,...data})=>{
  const book=preparationPrintWorkbook(X,id,data);factsSheet(book,v);
  if(id===2||id===4)table(book,'План и факт смен',['Дата','Смена','План','Результат','Минут','Ответственный','Основание','ID факта'],shiftRows,[15,24,16,24,10,28,55,38]);
  table(book,'Основания оценок',['Этап','Задание','Назначение','Практика','Квалификация','Уровень','Действует до','Состояние','Методика'],id===2?evidence:evidence.filter(x=>x[0]===(id===3?'ОТ':'Стажировка')),[20,45,38,38,38,12,16,30,24]);
  if(id===2){table(book,'Выданные вопросы',['Дата','Версия банка','Блок','№','Вопрос'],questions,[15,12,28,8,85]);table(book,'Комиссия',['Роль','Сотрудник','Подпись'],members,[35,35,25]);}
  return {id,book};
 });
}
