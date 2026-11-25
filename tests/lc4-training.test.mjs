
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,SQL,schema,migrations,date,practicalMethod} from './lc4-fixture.mjs';
import {one,rows,meta,bytesOf,openDb,Workspace,restore,backup,uuid,setMeta,prepareSnapshot,readSnapshot} from '../src/core/db.js';
import {jiStages,progressFor,authorizationValid,admissionStatus,practicalResult,latestAssessment,matrixData,coverageData,enrollmentTasks,practicalMethods} from '../src/modules/training/domain.js';
import {refsForDb,refsForEvents} from '../src/modules/library/domain.js';

test('LC4.1 migration v7 to v8 retains identities and old data',()=>{
 const db=new SQL.Database();db.run(schema);for(const m of migrations.slice(0,-1))db.run(m);setMeta(db,'database_id',uuid());
 const id=uuid();db.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[id,'Q','Учебный']);
 const migrated=openDb(SQL,bytesOf(db));assert.equal(meta(db,'schema_version'),'7');assert.equal(meta(migrated,'schema_version'),'8');assert.equal(one(migrated,'SELECT id FROM person').id,id);assert.deepEqual(rows(migrated,'PRAGMA foreign_key_check'),[]);migrated.close();db.close()
});
test('role/certificate/order authorization and exact SOP source, no unreviewed or duplicate assignment',async()=>{
 const f=await fixture();try{
 assert.equal(authorizationValid(f.w.working,f.auth,date),true);
 await assert.rejects(f.addAssignment({mentor_id:f.other}),/правом/);
 await assert.rejects(f.addAssignment({plan_reviewed:false}),/актуальный план/);
 await assert.rejects(f.addAssignment({assigned_on:'2026-01-19'}),/вступлению СОП/);
 const id=await f.addAssignment();await assert.rejects(f.addAssignment(),/уже есть/);
 await assert.rejects(f.stage(id,'prepare'),/согласуйте/);
 await f.approve(id);await assert.rejects(f.stage(id,'show1'),/предыдущий/);
 await f.stage(id,'prepare',{result:'incomplete'});assert.equal(progressFor(f.w.working,f.getAssignment(id)).next.code,'prepare');
 await f.stage(id,'prepare');await f.stage(id,'prepare');assert.equal(progressFor(f.w.working,f.getAssignment(id)).facts.length,3);
 await f.save('mentor_credential',{command:'revoke',reason:'Учебный отзыв'},f.certificate);assert.equal(authorizationValid(f.w.working,f.auth,'9999-01-01'),false);
 await assert.rejects(f.addAssignment({skill_id:f.skill,assigned_on:'2027-01-01'}),/правом/);
 }finally{f.w.close()}
});
test('training stages, 5 followups, separate practical qualification and admission, matrix, exchange and backup',async()=>{
 const f=await fixture();try{
 const id=await f.addAssignment();await f.approve(id);
 for(const x of jiStages('classic').filter(x=>!['support','followup'].includes(x.phase)))await f.stage(id,x.code);
 assert.equal(progressFor(f.w.working,f.getAssignment(id)).intro,true);assert.equal(f.getAssignment(id).state,'in_progress');
 assert.equal(admissionStatus(f.w.working,f.trainee,f.operation,date).status,'Нет решения');
 await assert.rejects(f.admit(id),/Нужны/);
 const p=(await f.assess(id)).entity_id;assert.equal(practicalResult(JSON.parse(latestAssessment(f.w.working,id,'practical').responses_json)).fraction,10/11);
 assert.equal(practicalResult(Array.from({length:10},()=>({value:1}))).fraction,null);
 assert.equal(one(f.w.working,'SELECT count(*) n FROM assessment_item').n,0);
 await f.qualify(id,p);await assert.rejects(f.admit(id),/Нужны/);await f.verify(id,'safety');await f.verify(id,'theory');await f.admit(id);
 assert.equal(admissionStatus(f.w.working,f.trainee,f.operation,date).current,true);
 for(const x of jiStages('classic').filter(x=>['support','followup'].includes(x.phase)))await f.stage(id,x.code);
 const pr=progressFor(f.w.working,f.getAssignment(id));assert.equal(pr.followup,5);assert.equal(pr.complete,true);assert.equal(f.getAssignment(id).state,'completed');assert.equal(pr.facts.length,14);
 await f.save('role_requirement',{profession_id:f.profession,skill_id:f.skill,scale_id:f.scale,required_level:2,criticality:'normal',valid_from:'2020-01-01',valid_to:null});
 await f.save('coverage_requirement',{unit_id:f.unit,skill_id:f.skill,scale_id:f.scale,required_level:2,shift_code:'QA-A',min_people:2});
 const m=matrixData(f.w.working,date);assert.equal(m.cells.get(f.trainee+':'+f.skill).fact.level,2);assert.equal(m.cells.get(f.trainee+':'+f.skill).qualified,true);assert.equal(coverageData(f.w.working,date,m)[0].actual,1);
 assert.equal(coverageData(f.w.working,date,m)[0].deficit,1);
 const pkg=await f.w.package(),other=new Workspace(SQL,openDb(SQL,bytesOf(f.w.base)));
 assert(refsForEvents(pkg.events).some(x=>x.sha256===f.source.source.sha256));
 await assert.rejects(other.accept(pkg),/комплект/);assert.equal((await other.accept(pkg,f.readContent)).count,pkg.events.length);assert.equal((await other.accept(pkg)).duplicate,true);
 assert.equal(one(other.base,'SELECT count(*) n FROM training_session').n,14);
 const restored=await restore(SQL,await backup(f.w),f.readContent);assert.equal(admissionStatus(restored.working,f.trainee,f.operation,date).current,true);assert.equal(progressFor(restored.working,one(restored.working,'SELECT * FROM training_assignment WHERE id=?',[id])).followup,5);
 restored.close();other.close();await f.w.acceptOwn(f.readContent);
 const next=await prepareSnapshot(f.w),opened=await readSnapshot(SQL,next.manifest,next.bytes);assert.equal(meta(opened,'schema_version'),'8');assert.deepEqual(rows(opened,'PRAGMA foreign_key_check'),[]);opened.close();
 const r=await f.revise();assert.equal(admissionStatus(f.w.working,f.trainee,f.operation,date).current,false);assert.match(admissionStatus(f.w.working,f.trainee,f.operation,date).status,/прежней/);assert.equal(matrixData(f.w.working,date).cells.get(f.trainee+':'+f.skill).fact.level,2);assert.equal(coverageData(f.w.working,date)[0].actual,0);
 await assert.rejects(f.stage(id,'prepare'),/актуальное/);await f.addAssignment({revision_id:r.revision,source:r.source.source});assert.equal(one(f.w.working,'SELECT count(*) n FROM training_assignment').n,2)
 }finally{f.w.close()}
});
test('practical method version is independent; 11 answers mandatory; latest checks require explicit review',async()=>{
 const f=await fixture();try{
 const id=await f.addAssignment();await f.approve(id);for(const s of jiStages('classic').filter(x=>!['support','followup'].includes(x.phase)))await f.stage(id,s.code);
 await assert.rejects(f.assess(id,{responses:[]}),/11/);
 const p=(await f.assess(id,{conclusion:'not_meet'})).entity_id;await f.qualify(id,p);await f.verify(id,'safety');await f.verify(id,'theory');await assert.rejects(f.admit(id),/Нужны/);
 const p2=(await f.assess(id)).entity_id;await assert.rejects(f.admit(id),/Нужны/);await f.qualify(id,p2);await f.admit(id);
 await f.verify(id,'theory',{result:'fail'});assert.equal(admissionStatus(f.w.working,f.trainee,f.operation,date).current,false);
 assert.match(admissionStatus(f.w.working,f.trainee,f.operation,date).status,/Подтверждения изменились/);await assert.rejects(f.admit(id),/Нужны/);
 const previous=practicalMethods(f.w.working)[0];await f.save('checklist_version',{...practicalMethod,title:'Синтетическая редакция 2',source_sha256:'b'.repeat(64)});assert.equal(practicalMethods(f.w.working)[0].version_no,2);assert.equal(one(f.w.working,'SELECT method_id FROM assessment_session WHERE id=?',[p]).method_id,previous.id);
 }finally{f.w.close()}
});
test('program templates and personal task evidence: no duplicate assignment, explicit closure',async()=>{
 const f=await fixture();try{
 const task=part=>({part,title:'Учебное задание '+part,hours:1,day_offset:0,sop_revision_id:null,skill_id:null,scale_id:null,target_level:null});
 const tasks=['general','individual','practice','knowledge'].map(task);tasks[2]={...tasks[2],sop_revision_id:f.doc.id,skill_id:f.skill,scale_id:f.scale,target_level:2};
 const payload={code:'QA-PROG',kind:'internship',title:'Учебная программа',profession_id:f.profession,position_id:null,created_by:f.actor,tasks};
 await assert.rejects(f.save('training_program',{...payload,tasks:tasks.slice(0,3)}),/четыре/);
 const p=(await f.save('training_program',payload)).entity_id,n=(await f.save('training_enrollment',{program_id:p,trainee_id:f.trainee,mentor_id:f.mentor,manager_id:f.actor,start_on:date,due_on:'2027-01-31',reason:'Учебная программа'})).entity_id;
 const get=()=>one(f.w.working,'SELECT * FROM training_enrollment WHERE id=?',[n]);
 await assert.rejects(f.save('training_enrollment',{command:'finish',actor_id:f.actor,conclusion:'basic',feedback:'Учебная запись'},n),/задания/);
 for(const x of enrollmentTasks(f.w.working,get()).filter(x=>!x.sop_revision_id))await f.save('training_task_result',{enrollment_id:n,task_id:x.id,actor_id:f.actor,held_on:date,result:'completed',minutes:20,evidence:'Учебное задание выполнено',enrollment_rev:get().rev});
 const practice=enrollmentTasks(f.w.working,get()).find(x=>x.sop_revision_id),a=await f.addAssignment({enrollment_id:n,program_task_id:practice.id});
 await f.approve(a);for(const s of jiStages('classic'))await f.stage(a,s.code);
 assert.equal(enrollmentTasks(f.w.working,get()).every(t=>t.done),true);
 await f.save('training_enrollment',{command:'finish',actor_id:f.actor,conclusion:'basic',feedback:'Учебное заключение'},n);
 assert.equal(get().state,'completed');assert.equal(one(f.w.working,'SELECT count(*) n FROM admission_decision').n,0);
 const newp=await f.save('training_program',{...payload,title:'Новая версия'});assert.equal(one(f.w.working,'SELECT state FROM training_program WHERE id=?',[p]).state,'retired');assert.equal(get().program_id,p);assert.equal(one(f.w.working,'SELECT version_no FROM training_program WHERE id=?',[newp.entity_id]).version_no,2)
 }finally{f.w.close()}
});
test('a future plan may be approved before its start, while facts cannot precede it',async()=>{
 const f=await fixture();try{const id=await f.addAssignment({assigned_on:'2026-01-21'});await f.approve(id);assert(f.getAssignment(id).approval_json);await assert.rejects(f.stage(id,'prepare'),/фактическую дату/)}finally{f.w.close()}
});
test('four JI variants, safety gate and attendance is not authorization',async()=>{
 const f=await fixture();try{
 const variants=['classic','special','smed','hazardous'];for(const v of variants){const s=jiStages(v);assert.equal(s.filter(x=>x.phase==='followup').length,5);assert.equal(new Set(s.map(x=>x.code)).size,s.length)}
 const id=await f.addAssignment({variant:'hazardous'});await f.approve(id);await f.stage(id,'prepare');await f.stage(id,'show_explanation');await assert.rejects(f.stage(id,'try_preparatory'),/безопасности/);await f.verify(id,'safety');await f.stage(id,'try_preparatory');
 const c=(await f.save('mentor_credential',{person_id:f.other,kind:'attendance',role:'mentor',number:'QA-ATTEND',issuer:'Учебный центр',issued_on:'2020-01-01',valid_until:null,evidence:'Синтетическое свидетельство',registered_by:f.actor})).entity_id;
 await assert.rejects(f.save('mentor_appointment',{person_id:f.other,credential_id:c,role:'mentor',order_number:'QA-2',order_on:'2020-01-01',approved_by:f.actor,valid_from:'2020-01-01',valid_to:null,acknowledged_on:'2020-01-01',evidence:'Учебный приказ'}),/сертификат/);
 }finally{f.w.close()}
});
