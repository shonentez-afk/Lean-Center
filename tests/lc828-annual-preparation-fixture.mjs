// Twelve independent personnel histories and three linked programs per
// trainee. All business records use the existing native domain events.
import assert from 'node:assert/strict';
import {one,rows} from '../src/core/db.js';
import {makeSop} from './lc4-fixture.mjs';
import {progressFor,enrollmentTasks,CORPORATE_SCALE_NAME,CORPORATE_SCALE_LEVELS} from '../src/modules/training/domain.js';
import {adaptationBounds} from '../src/modules/training/standard-workflows.js';
import {preparationProgress,THEORY_BLOCKS} from '../src/modules/training/preparation-results.js';
import {PRACTICAL_V03} from '../src/modules/training/standard-v03.js';
import {RC1_CRITERIA} from '../src/modules/training/builtin-forms.js';
import {QUESTION_BANK_V03} from '../src/modules/training/question-bank-v03.js';
const plus=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
export async function seedAnnualPreparations(f,months,{unitB,trainer}){
 const db=f.w.working,save=f.save,items=[];
 f.advanceTo(months[0]);
 const practicalMethod=(await save('checklist_version',PRACTICAL_V03)).entity_id;
 const auditMethod=(await save('checklist_version',{format:'lean-audit-checklist-v1',title:'D4.2 RC1 · 20 критериев',source_sha256:'d'.repeat(64),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)})).entity_id;
 const bank=(await save('twi_knowledge_bank',{profession_id:f.profession,author_id:f.actor,reviewed_on:months[0],previous_id:null,note:'Учебный банк D4.2',blocks:QUESTION_BANK_V03.blocks})).entity_id;
 const scale=f.w.edit('rating_scale',null,{name:CORPORATE_SCALE_NAME,version_no:'1',levels:CORPORATE_SCALE_LEVELS.map(([n,s])=>n+': '+s).join('\n')});
 const category=one(db,'SELECT category_id FROM skill WHERE id=?',[f.skill]).category_id;
 const operation=f.w.edit('operation',null,{unit_id:f.unit,workplace_id:f.workplace,equipment_id:null,code:'D42-MAIN',name:'Основная операция D4.2',criticality:'normal'});
 const skill=f.w.edit('skill',null,{category_id:category,operation_id:operation,name:'Основной навык D4.2'});
 const src=await makeSop('Основная операция D4.2');f.sources.set(src.source.sha256,src);
 const doc=await save('document',{command:'create',code:'D42-MAIN-SOP',title:'Основная операция D4.2',operation_id:operation,source:src.source,projection:src.projection});
 await save('document',{command:'passport',revision_id:doc.id,print_format:'portrait',changed_on:months[0]},doc.entity_id);
 for(const command of ['submit','approve','effect'])await save('document',{command,revision_id:doc.id,actor_id:f.actor,note:''},doc.entity_id);
 const auth=(await save('mentor_authorization',{person_id:f.mentor,operation_id:operation,approved_by:f.actor,valid_from:'2020-01-01',valid_to:null,credential_id:f.certificate,appointment_id:f.appointment})).entity_id;
 const blank=(part,title)=>({part,title,hours:1,day_offset:0,sop_revision_id:null,skill_id:null,scale_id:null,target_level:null});
 const common={...blank('practice','Базовая операция'),sop_revision_id:f.doc.id,skill_id:f.skill,scale_id:scale,target_level:2};
 const main={...blank('practice','Основная операция'),sop_revision_id:doc.id,skill_id:skill,scale_id:scale,target_level:2};
 const program=async(standard_kind,kind,tasks)=>(await save('training_program',{code:'D42-'+standard_kind,kind,standard_kind,title:'D4.2 '+standard_kind,profession_id:f.profession,position_id:null,created_by:f.actor,tasks})).entity_id;
 const programs={
  adaptation:await program('adaptation','entry',[blank('general','Общая часть'),blank('individual','Индивидуальная часть'),common,main,blank('knowledge','Проверка знаний')]),
  safety:await program('safety','production',[blank('general','Безопасность')]),
  internship:await program('internship','internship',[common])
 };
 const employment=(person_id,unit_id,valid_from,valid_to=null)=>({person_id,unit_id,profession_id:f.profession,position_id:null,shift_id:f.shift,shift_code:null,valid_from,valid_to});
 const newPerson=(code,name)=>f.w.edit('person',null,{employee_code:code,display_name:name});
 const agent=newPerson('D42-AGENT','Учебный агент перемен'),hr=newPerson('D42-HR','Учебный HR');
 for(const id of [agent,hr])f.w.edit('person_assignment',null,employment(id,f.unit,'2020-01-01'));
 const traineeRole=one(db,"SELECT id FROM business_role WHERE code='TRAINEE'").id;
 const get=n=>one(db,'SELECT * FROM training_enrollment WHERE id=?',[n]);
 const criteria=rows(db,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[practicalMethod]);
 assert.equal(criteria.length,11);
 assert.equal(rows(db,'SELECT id FROM checklist_criterion WHERE version_id=?',[auditMethod]).length,20);
 for(let i=0;i<months.length;i++){
  const month=months[i],day=plus(month,4),next=plus(day,1),suffix=month.slice(0,7),category=i%2?'transfer':'new';
  f.advanceTo(day);
  const trainee=newPerson('D42-'+suffix,'Обучаемый '+suffix);
  let former=null;
  if(category==='transfer'){
   const oldStart=plus(day,-180);former=f.w.edit('person_assignment',null,employment(trainee,unitB,oldStart));
   f.w.edit('person_assignment',former,employment(trainee,unitB,oldStart,plus(day,-1)));
  }
  const employmentId=f.w.edit('person_assignment',null,employment(trainee,f.unit,day));
  const roleAssignment=f.w.edit('role_assignment',null,{person_id:trainee,role_id:traineeRole,valid_from:day,valid_to:null});
  const enroll=async(kind,due_on)=>(await save('training_enrollment',{program_id:programs[kind],trainee_id:trainee,mentor_id:f.mentor,manager_id:f.actor,start_on:day,due_on,reason:'Учебная подготовка '+suffix})).entity_id;
  const a=await enroll('adaptation',adaptationBounds(day,category).min),s=await enroll('safety',plus(day,3)),j=await enroll('internship',plus(day,6));
  const id=(await save('twi_preparation',{trainee_id:trainee,manager_id:f.actor,category,adaptation_id:a,safety_id:s,internship_id:j,note:'Учебная программа '+suffix,shifts:[{date:day,shift_id:f.shift},{date:next,shift_id:f.shift}]})).entity_id;
  const p=()=>preparationProgress(db,one(db,'SELECT * FROM twi_preparation WHERE id=?',[id]));
  const fact=(kind,actor_id,fact_on,data)=>save('twi_preparation_fact',{preparation_id:id,kind,actor_id,fact_on,data});
  const shift=(d,result='completed',minutes=480)=>fact('shift',f.mentor,d,{shift_id:f.shift,result,minutes,note:'Учебная смена'});
  await fact('questions',f.mentor,day,{bank_id:bank,blocks:THEORY_BLOCKS.map(block=>({block,question_ids:[QUESTION_BANK_V03.blocks.find(b=>b.id===block).questions[0].id]})),note:'Учебная выдача заранее'});
  for(const n of [a,s])for(const t of enrollmentTasks(db,get(n)).filter(t=>!t.sop_revision_id))await save('training_task_result',{enrollment_id:n,task_id:t.id,actor_id:f.actor,held_on:day,result:'completed',minutes:60,evidence:'Учебный факт',enrollment_rev:get(n).rev});
  await shift(day);
  const outcome={result:'pass',reference:'D42-'+suffix,feedback:'Учебный результат'};
  await fact('safety',f.actor,day,outcome);
  const finish=n=>save('training_enrollment',{command:'finish',actor_id:f.actor,conclusion:'basic',feedback:'Учебный итог'},n);
  await finish(s);
  const train=async(n,t,on,extra={})=>{
   const aid=await f.addAssignment({trainee_id:trainee,enrollment_id:n,program_task_id:t.id,assigned_on:on,due_on:plus(day,5),scale_id:scale,method_version:'JI-2',method_config:{followups:2,segments:[],realShow:null,realTry:null,hazardous:false},...extra});
   await save('training_assignment',{command:'approve',responsible_id:f.actor,head_id:f.actor,approved_on:on,note:'Учебное согласование'},aid);
   const stages=progressFor(db,f.getAssignment(aid)).stages;
   for(const stage of stages.filter(q=>q.phase!=='followup'))await f.stage(aid,stage.code,{held_at:on+'T08:00'});
   const practical=(await f.assess(aid,{assessed_on:on,method_id:practicalMethod,responses:criteria.map(q=>({criterion_id:q.id,value:1,note:''}))})).entity_id;
   await f.qualify(aid,practical,{assessed_on:on});
   for(const stage of stages.filter(q=>q.phase==='followup'))await f.stage(aid,stage.code,{held_at:on+'T09:00'});
   assert.equal(f.getAssignment(aid).state,'completed');
   return aid;
  };
  let intern=null,mainAssignment=null,status='В процессе подготовки';
  if(i<10){
   intern=await train(j,enrollmentTasks(db,get(j))[0],day);
   assert.equal(p().shifts.filter(q=>q.data.result==='completed').length,1);
   await assert.rejects(fact('internship',f.actor,day,outcome),/двух фактически/);
   f.advanceTo(next);await shift(next);await fact('internship',f.actor,next,outcome);await finish(j);
   mainAssignment=await train(a,enrollmentTasks(db,get(a)).find(t=>t.skill_id===skill),next,{revision_id:doc.id,source:src.source,skill_id:skill,authorization_id:auth});
   await assert.rejects(finish(a),/решение комиссии/);
   await fact('commission',f.actor,next,{members:{manager:f.actor,mentor:f.mentor,trainer,agent,hr},theory:THEORY_BLOCKS.map(block=>({block,result:'pass',note:'Учебная теория'})),conclusion:'basic',reference:'D42-COM-'+suffix,feedback:'Учебные рекомендации'});
   await finish(a);assert.equal(p().status,'Комплект завершён');
   status='Комплект завершён';
   if(i>=8){f.advanceTo(plus(next,1));await shift(next,'incomplete',100);status='Требует повторной проверки'}
  }
  assert.equal(p().status,status);
  assert.equal(one(db,'SELECT count(*) n FROM admission_decision WHERE person_id=?',[trainee]).n,0,'Комиссия не выдаёт допуск автоматически');
  items.push({month,day,next,trainee,roleAssignment,employmentId,former,category,id,adaptation:a,safety:s,internship:j,intern,mainAssignment,status});
 }
 assert.deepEqual(rows(db,'PRAGMA foreign_key_check'),[]);
 assert.equal(items.filter(x=>x.status==='Комплект завершён').length,8);
 assert.equal(items.filter(x=>x.status==='Требует повторной проверки').length,2);
 return {items,months,from:months[0],to:plus(new Date(Date.UTC(Number(months.at(-1).slice(0,4)),Number(months.at(-1).slice(5,7)),1)).toISOString().slice(0,10),-1),traineeRole,programs,bank,auditMethod,practicalMethod,scale,profession:f.profession,shift:f.shift,baseRevision:f.doc.id,mainRevision:doc.id};
}
