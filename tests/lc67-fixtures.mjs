import {fixture,date,makeSop} from './lc4-fixture.mjs';
import {one,rows} from '../src/core/db.js';
import {progressFor,enrollmentTasks} from '../src/modules/training/domain.js';
import {PRACTICAL_V03} from '../src/modules/training/standard-v03.js';
import {QUESTION_BANK_V03} from '../src/modules/training/question-bank-v03.js';
const config={followups:3,segments:[],realShow:null,realTry:null,hazardous:false};
export async function preparedBundle(){
 const f=await fixture({installMethod:false});
 try{const db=f.w.working,method=(await f.save('checklist_version',PRACTICAL_V03)).entity_id;
 const operation=f.w.edit('operation',null,{unit_id:f.unit,workplace_id:f.workplace,equipment_id:null,code:'QA-OP2',name:'Основная операция',criticality:'normal'}),skill=f.w.edit('skill',null,{category_id:one(db,'SELECT category_id FROM skill WHERE id=?',[f.skill]).category_id,operation_id:operation,name:'Основной навык'});
 const source=await makeSop('Основная операция');f.sources.set(source.source.sha256,source);const doc=await f.save('document',{command:'create',code:'QA-LC65-2',title:'Основная операция',operation_id:operation,source:source.source,projection:source.projection});
 await f.save('document',{command:'passport',revision_id:doc.id,print_format:'portrait',changed_on:date},doc.entity_id);for(const command of ['submit','approve','effect'])await f.save('document',{command,revision_id:doc.id,actor_id:f.actor,note:''},doc.entity_id);
 const auth=(await f.save('mentor_authorization',{person_id:f.mentor,operation_id:operation,approved_by:f.actor,valid_from:'2020-01-01',valid_to:null,credential_id:f.certificate,appointment_id:f.appointment})).entity_id;
 const mkPerson=code=>f.w.edit('person',null,{employee_code:code,display_name:code});const trainer=mkPerson('QA-VT'),agent=mkPerson('QA-AGENT'),hr=mkPerson('QA-HR'),role=f.w.edit('business_role',null,{code:'INTERNAL_TRAINER',name:'Внутренний тренер'});f.w.edit('role_assignment',null,{person_id:trainer,role_id:role,valid_from:'2020-01-01',valid_to:null});await f.save('mentor_credential',{person_id:trainer,kind:'certificate',role:'internal_trainer',number:'QA-VT',issuer:'Учебный центр',issued_on:'2020-01-01',valid_until:null,evidence:'QA',registered_by:f.actor});
 const blank=(part,title)=>({part,title,hours:1,day_offset:0,sop_revision_id:null,skill_id:null,scale_id:null,target_level:null}),common={...blank('practice','Базовая операция'),sop_revision_id:f.doc.id,skill_id:f.skill,scale_id:f.scale,target_level:2},main={...blank('practice','Основная операция'),sop_revision_id:doc.id,skill_id:skill,scale_id:f.scale,target_level:2};
 const make=async(standard_kind,kind,tasks,due_on)=>(await f.save('training_enrollment',{program_id:(await f.save('training_program',{code:'QA65-'+standard_kind,kind,standard_kind,title:'QA '+standard_kind,profession_id:f.profession,position_id:null,created_by:f.actor,tasks})).entity_id,trainee_id:f.trainee,mentor_id:f.mentor,manager_id:f.actor,start_on:date,due_on,reason:'QA'})).entity_id;
 const a=await make('adaptation','entry',[blank('general','QA общая'),blank('individual','QA инд.'),common,main,blank('knowledge','QA теория')],'2026-02-19'),s=await make('safety','production',[blank('general','QA ОТ')],'2026-01-21'),j=await make('internship','internship',[common],'2026-01-25'),id=(await f.save('twi_preparation',{trainee_id:f.trainee,manager_id:f.actor,category:'transfer',adaptation_id:a,safety_id:s,internship_id:j,note:'QA',shifts:[{date,shift_id:f.shift},{date:'2026-01-21',shift_id:f.shift}]})).entity_id;

 const bank=(await f.save('twi_knowledge_bank',{profession_id:f.profession,author_id:f.actor,reviewed_on:date,previous_id:null,note:'QA',blocks:QUESTION_BANK_V03.blocks})).entity_id;
 const get=n=>one(db,'SELECT * FROM training_enrollment WHERE id=?',[n]);
 for(const n of [a,s])for(const t of enrollmentTasks(db,get(n)).filter(t=>!t.sop_revision_id))await f.save('training_task_result',{enrollment_id:n,task_id:t.id,actor_id:f.actor,held_on:date,result:'completed',minutes:60,evidence:'QA',enrollment_rev:get(n).rev});
 const train=async(n,t,extra={})=>{const aid=await f.addAssignment({enrollment_id:n,program_task_id:t.id,due_on:'2026-01-24',method_version:'JI-2',method_config:config,...extra});await f.approve(aid);for(const stage of progressFor(db,f.getAssignment(aid)).stages.filter(x=>x.phase!=='followup'))await f.stage(aid,stage.code);const practical=(await f.assess(aid,{method_id:method,responses:rows(db,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[method]).map(x=>({criterion_id:x.id,value:1,note:''}))})).entity_id;await f.qualify(aid,practical);return aid};
 await train(j,enrollmentTasks(db,get(j))[0]);await train(a,enrollmentTasks(db,get(a)).find(t=>t.skill_id===skill),{revision_id:doc.id,source:source.source,skill_id:skill,authorization_id:auth});
 return {backup:await f.backupBundle(),id,bank,shift:f.shift,trainee:f.trainee}
 }finally{f.w.close()}
}
