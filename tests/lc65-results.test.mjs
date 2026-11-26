import {assertAnalyticsContracts} from './lc73b-analytics-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date,makeSop,SQL,schema,migrations} from './lc4-fixture.mjs';
import {one,rows,meta,uuid,setMeta,openDb,bytesOf,canonical,sha256,checkPackage} from '../src/core/db.js';
import {ji2Stages,validateJi2,jiConfig} from '../src/modules/training/ji-v03.js';
import {progressFor,enrollmentTasks} from '../src/modules/training/domain.js';
import {preparationControl,preparationStats,standardCalendar} from '../src/modules/training/standard-overview.js';
import {preparationProgress,THEORY_BLOCKS} from '../src/modules/training/preparation-results.js';
import {PRACTICAL_V03} from '../src/modules/training/standard-v03.js';
import {QUESTION_BANK_V03} from '../src/modules/training/question-bank-v03.js';
const config=(overrides={})=>({followups:3,segments:[],realShow:null,realTry:null,hazardous:false,...overrides});
test('LC6.5 migration from v16 adds facts and JI config without changing existing IDs',()=>{const d=new SQL.Database();d.run(schema);for(const m of migrations.slice(0,15))d.run(m);setMeta(d,'database_id',uuid());const id=uuid();d.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[id,'QA-65','QA']);const n=openDb(SQL,bytesOf(d));try{assert.equal(meta(d,'schema_version'),'16');assert.equal(meta(n,'schema_version'),'17');assert.equal(one(n,'SELECT id FROM person').id,id);assert.equal(one(n,'SELECT count(*) n FROM twi_preparation_fact').n,0);assert.deepEqual(rows(n,'PRAGMA foreign_key_check'),[])}finally{n.close();d.close()}});
test('JI-2 five variants; SMED 2+1 and 3+1; fractional covers all source steps; variable support',()=>{
 for(const v of ['classic','special','smed','hazardous','fractional']){const c=v==='smed'?config({realShow:2,realTry:3}):v==='fractional'?config({segments:[{from:1,to:2},{from:3,to:4}]}):config(),st=ji2Stages(v,c);assert.equal(st.filter(s=>s.phase==='followup').length,3);assert.equal(new Set(st.map(x=>x.code)).size,st.length)}
 const s=ji2Stages('smed',config({realShow:2,realTry:3}));assert.deepEqual(s.filter(x=>x.phase==='presentation').map(x=>x.execution),['simulation','real','simulation']);assert.deepEqual(s.filter(x=>x.phase==='practice').map(x=>x.execution),['simulation','simulation','real','simulation']);assert.equal(ji2Stages('fractional',config({segments:[{from:1,to:2},{from:3,to:4}]})).filter(x=>x.phase==='practice').length,8);
 assert.throws(()=>validateJi2('fractional',config({segments:[{from:1,to:2},{from:4,to:4}]}),4),/без пропусков/);assert.throws(()=>validateJi2('fractional',config({segments:[{from:1,to:2}]}),4),/охватывать/);assert.throws(()=>validateJi2('classic',config({followups:1})),/2 до 10/)
});
test('JI-2 source coverage, sequence, evidence and package boundary',async()=>{const f=await fixture();try{
 await assert.rejects(f.addAssignment({variant:'fractional',method_version:'JI-2',method_config:config({segments:[{from:1,to:2}]})}),/охватывать/);
 const c=config({segments:[{from:1,to:1}],followups:2}),id=await f.addAssignment({variant:'fractional',method_version:'JI-2',method_config:c});await f.approve(id);assert.deepEqual(jiConfig(f.getAssignment(id)),c);await assert.rejects(f.stage(id,'try1_part1'),/предыдущий этап/);
 for(const s of progressFor(f.w.working,f.getAssignment(id)).stages)await f.stage(id,s.code);assert.equal(progressFor(f.w.working,f.getAssignment(id)).followup,2);assert.equal(f.getAssignment(id).state,'completed');const saved=one(f.w.working,"SELECT steps_json FROM training_session WHERE assignment_id=? AND stage_code='show1_part1'",[id]);assert.deepEqual(JSON.parse(saved.steps_json).segment,{from:1,to:1});
 const pkg=await f.w.package(),{hash,...body}=pkg,old={...body,schema_version:16};await assert.rejects(checkPackage({...old,hash:await sha256(canonical(old))}),/LC6.5/)
 }finally{f.w.close()}});
test('preparation §3.4: actual shifts, exact appendix 9, safety, advance questions and commission; no automatic admission',async()=>{
 const f=await fixture({installMethod:false});try{const db=f.w.working,method=(await f.save('checklist_version',PRACTICAL_V03)).entity_id;
 const operation=f.w.edit('operation',null,{unit_id:f.unit,workplace_id:f.workplace,equipment_id:null,code:'QA-OP2',name:'Основная операция',criticality:'normal'}),skill=f.w.edit('skill',null,{category_id:one(db,'SELECT category_id FROM skill WHERE id=?',[f.skill]).category_id,operation_id:operation,name:'Основной навык'});
 const source=await makeSop('Основная операция');f.sources.set(source.source.sha256,source);const doc=await f.save('document',{command:'create',code:'QA-LC65-2',title:'Основная операция',operation_id:operation,source:source.source,projection:source.projection});
 await f.save('document',{command:'passport',revision_id:doc.id,print_format:'portrait',changed_on:date},doc.entity_id);for(const command of ['submit','approve','effect'])await f.save('document',{command,revision_id:doc.id,actor_id:f.actor,note:''},doc.entity_id);
 const auth=(await f.save('mentor_authorization',{person_id:f.mentor,operation_id:operation,approved_by:f.actor,valid_from:'2020-01-01',valid_to:null,credential_id:f.certificate,appointment_id:f.appointment})).entity_id;
 const mkPerson=code=>f.w.edit('person',null,{employee_code:code,display_name:code});const trainer=mkPerson('QA-VT'),agent=mkPerson('QA-AGENT'),hr=mkPerson('QA-HR'),role=f.w.edit('business_role',null,{code:'INTERNAL_TRAINER',name:'Внутренний тренер'});f.w.edit('role_assignment',null,{person_id:trainer,role_id:role,valid_from:'2020-01-01',valid_to:null});await f.save('mentor_credential',{person_id:trainer,kind:'certificate',role:'internal_trainer',number:'QA-VT',issuer:'Учебный центр',issued_on:'2020-01-01',valid_until:null,evidence:'QA',registered_by:f.actor});
 const blank=(part,title)=>({part,title,hours:1,day_offset:0,sop_revision_id:null,skill_id:null,scale_id:null,target_level:null}),common={...blank('practice','Базовая операция'),sop_revision_id:f.doc.id,skill_id:f.skill,scale_id:f.scale,target_level:2},main={...blank('practice','Основная операция'),sop_revision_id:doc.id,skill_id:skill,scale_id:f.scale,target_level:2};
 const make=async(standard_kind,kind,tasks,due_on)=>(await f.save('training_enrollment',{program_id:(await f.save('training_program',{code:'QA65-'+standard_kind,kind,standard_kind,title:'QA '+standard_kind,profession_id:f.profession,position_id:null,created_by:f.actor,tasks})).entity_id,trainee_id:f.trainee,mentor_id:f.mentor,manager_id:f.actor,start_on:date,due_on,reason:'QA'})).entity_id;
 const a=await make('adaptation','entry',[blank('general','QA общая'),blank('individual','QA инд.'),common,main,blank('knowledge','QA теория')],'2026-02-19'),s=await make('safety','production',[blank('general','QA ОТ')],'2026-01-21'),j=await make('internship','internship',[common],'2026-01-25'),id=(await f.save('twi_preparation',{trainee_id:f.trainee,manager_id:f.actor,category:'transfer',adaptation_id:a,safety_id:s,internship_id:j,note:'QA',shifts:[{date,shift_id:f.shift},{date:'2026-01-21',shift_id:f.shift}]})).entity_id;
 const bundle=()=>one(db,'SELECT * FROM twi_preparation WHERE id=?',[id]),p=()=>preparationProgress(db,bundle());
 const fact=async(kind,actor_id,fact_on,data)=>f.save('twi_preparation_fact',{preparation_id:id,kind,actor_id,fact_on,data}),shift=d=>fact('shift',f.mentor,d,{shift_id:f.shift,result:'completed',minutes:480,note:'QA фактическая смена'});
 const bank=(await f.save('twi_knowledge_bank',{profession_id:f.profession,author_id:f.actor,reviewed_on:date,previous_id:null,note:'QA',blocks:QUESTION_BANK_V03.blocks})).entity_id;
 await fact('questions',f.mentor,date,{bank_id:bank,blocks:THEORY_BLOCKS.map(block=>({block,question_ids:[QUESTION_BANK_V03.blocks.find(b=>b.id===block).questions[0].id]})),note:'QA выдача'});
 const task=async(n,t)=>f.save('training_task_result',{enrollment_id:n,task_id:t.id,actor_id:f.actor,held_on:date,result:'completed',minutes:60,evidence:'QA',enrollment_rev:one(db,'SELECT rev FROM training_enrollment WHERE id=?',[n]).rev});
 for(const n of [a,s])for(const t of enrollmentTasks(db,one(db,'SELECT * FROM training_enrollment WHERE id=?',[n])).filter(t=>!t.sop_revision_id))await task(n,t);
 await shift(date);await shift(date);assert.equal(p().shifts.length,1);
 const outcome={result:'pass',reference:'QA протокол',feedback:'QA рекомендации'};await fact('safety',f.actor,date,outcome);
 const finish=async(n,conclusion='basic')=>f.save('training_enrollment',{command:'finish',actor_id:f.actor,conclusion,feedback:'QA итог'},n);
 const train=async(n,t,extra={})=>{const aid=await f.addAssignment({enrollment_id:n,program_task_id:t.id,due_on:'2026-01-24',method_version:'JI-2',method_config:config(),...extra});await f.approve(aid);for(const stage of progressFor(db,f.getAssignment(aid)).stages.filter(x=>x.phase!=='followup'))await f.stage(aid,stage.code);const practical=(await f.assess(aid,{method_id:method,responses:rows(db,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[method]).map(x=>({criterion_id:x.id,value:1,note:''}))})).entity_id;await f.qualify(aid,practical);return aid};
 const intern=await train(j,enrollmentTasks(db,one(db,'SELECT * FROM training_enrollment WHERE id=?',[j]))[0]);
 assert.equal(f.getAssignment(intern).state,'in_progress');await assert.rejects(fact('internship',f.actor,date,outcome),/двух фактически/);
 f.advanceTo('2026-01-21');await shift('2026-01-21');await fact('internship',f.actor,'2026-01-21',outcome);assert.equal(p().internship.pass,true);await finish(s);await finish(j);
 const mainTask=enrollmentTasks(db,one(db,'SELECT * FROM training_enrollment WHERE id=?',[a])).find(t=>t.skill_id===skill);
 await train(a,mainTask,{revision_id:doc.id,source:source.source,skill_id:skill,authorization_id:auth});assert.equal(p().main.ready,true);
 await assert.rejects(finish(a),/решение комиссии/);
 const decision={members:{manager:f.actor,mentor:f.mentor,trainer,agent,hr},theory:THEORY_BLOCKS.map(block=>({block,result:'pass',note:'QA'})),conclusion:'basic',reference:'QA-Комиссия',feedback:'QA развитие'};
 await assert.rejects(fact('commission',f.actor,'2026-01-21',{...decision,members:{...decision.members,hr:agent}}),/пять участников/);
 await fact('commission',f.actor,'2026-01-21',decision);assert(p().positive);await finish(a);assert.equal(p().status,'Комплект завершён');assert.equal(one(db,'SELECT count(*) n FROM admission_decision').n,0);
 const completed=preparationControl(db,'2026-01-21',{personId:f.trainee,role:'trainee'});assert.equal(completed.length,1);assert.equal(preparationStats(completed).complete,1);assert.equal(preparationStats(completed).shifts,2);assertAnalyticsContracts(db,'2026-01-21',f.unit,f.trainee);assert.equal(preparationControl(db,'2026-01-21',{personId:hr}).length,1);assert.equal(preparationControl(db,'2026-01-21',{personId:hr,role:'trainee'}).length,0);const calendar=standardCalendar(db,'2026-01-21',{personId:f.trainee,kind:'preparation'});assert.equal(calendar.length,5);assert.equal(new Set(calendar.map(x=>x.key)).size,5);assert.equal(calendar.filter(x=>x.type==='Смена стажировки'&&x.state==='Завершена').length,2);assert.equal(calendar.find(x=>x.type==='Решение комиссии').date,'2026-01-21');
 // correcting a shift invalidates the old conclusion rather than duplicating a fact or rewriting results
 await fact('shift',f.mentor,'2026-01-21',{shift_id:f.shift,result:'incomplete',minutes:100,note:'QA уточнение'});assert.equal(p().shifts.length,2);assert.equal(p().positive,false);assert.equal(p().status,'Требует повторной проверки');const review=preparationControl(db,'2026-02-20',{filter:'review',unitId:f.unit});assert.equal(review.length,1);assert.equal(preparationStats(review).review,1);assert.equal(preparationStats(review).shifts,1);assert.equal(preparationStats(review).overdue,1);assertAnalyticsContracts(db,'2026-02-20',f.unit,f.trainee);const revised=standardCalendar(db,'2026-02-20',{personId:f.trainee,kind:'preparation'});assert.equal(revised.filter(x=>x.type==='Смена стажировки').length,2);assert.equal(revised.find(x=>x.type==='Смена стажировки'&&x.date==='2026-01-21').state,'Не завершена');
 }finally{f.w.close()}});

test('LC6.7 all five JI-2 variants persist facts, special demonstrator and hazardous safety gate',async()=>{const f=await fixture();try{for(const variant of ['classic','special','smed','hazardous','fractional']){const c=config({followups:2,...(variant==='smed'?{realShow:2,realTry:3}:variant==='fractional'?{segments:[{from:1,to:1}]}:variant==='hazardous'?{hazardous:true}:{})}),id=await f.addAssignment({variant,method_version:'JI-2',method_config:c});await f.approve(id);const stages=progressFor(f.w.working,f.getAssignment(id)).stages;let safety=false;for(const s of stages){let extra={};if(variant==='special'&&s.phase==='presentation'){await assert.rejects(f.stage(id,s.code,{witness_id:f.mentor}),/отдельного демонстратора/);extra.witness_id=f.other}if(variant==='hazardous'&&s.phase==='practice'&&!safety){await assert.rejects(f.stage(id,s.code),/проверки безопасности/);await f.verify(id,'safety');safety=true}await f.stage(id,s.code,extra)}assert.equal(f.getAssignment(id).state,'completed');const progress=progressFor(f.w.working,f.getAssignment(id));assert.equal(progress.completed,stages.length);assert.equal(progress.followup,2);assert.equal(progress.facts.length,stages.length);if(variant==='smed')assert.deepEqual(progress.facts.map(x=>JSON.parse(x.steps_json)).filter(x=>x.execution==='real').map(x=>x.stage),['show2','try3']);if(variant==='special')assert.equal(progress.facts.filter(x=>x.witness_id===f.other).length,3)}}finally{f.w.close()}});

// Reproduce the commission failure using the actual directory and shared picker.
test('LC6.7 internal trainer picker recognizes specific role; ordinary instructor is not a VT',async()=>{
 const {directoryPeople}=await import('../src/modules/master-data/people-directory.js'),{filterPeople}=await import('../src/ui/people-picker.js'),{matchesRoleKind}=await import('../src/modules/master-data/role-matching.js');
 const f=await fixture();try{
  const vt=f.w.edit('business_role',null,{code:'INTERNAL_TRAINER',name:'Внутренний тренер'});
  f.w.edit('role_assignment',null,{person_id:f.other,role_id:vt,valid_from:'2026-01-01',valid_to:'2026-01-31'});
  const people=directoryPeople(f.w.working,date),eligible=filterPeople(people,'',['internal_trainer'],'internal_trainer');
  assert.deepEqual(eligible.map(x=>x.id),[f.other]);
  assert.equal(filterPeople(people,'LC4-004',['internal_trainer'],'internal_trainer')[0].id,f.other);
  assert.equal(filterPeople(people,'LC4-002',['internal_trainer'],'internal_trainer').length,0);
  assert(filterPeople(people,'',['instructor'],'instructor').some(x=>x.id===f.mentor));
  assert(filterPeople(people,'',['instructor'],'instructor').some(x=>x.id===f.other));
  assert.equal(filterPeople(directoryPeople(f.w.working,'2026-02-01'),'',['internal_trainer'],'internal_trainer').length,0);
  assert(matchesRoleKind({kind:'instructor',code:'internal-trainer',name:'ВТ'},'internal_trainer'));
  assert(!matchesRoleKind({kind:'instructor',code:'INSTRUCTOR',name:'Инструктор'},'internal_trainer'));
 }finally{f.w.close()}
});
