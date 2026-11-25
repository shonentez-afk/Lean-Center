
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,SQL,schema,migrations,date,practicalMethod} from './lc4-fixture.mjs';
import {one,rows,meta,bytesOf,openDb,Workspace,restore,backup,uuid,setMeta,prepareSnapshot,readSnapshot} from '../src/core/db.js';
import {jiStages,progressFor,authorizationValid,admissionStatus,practicalResult,latestAssessment,matrixData,coverageData,enrollmentTasks,practicalMethods} from '../src/modules/training/domain.js';
import {refsForDb,refsForEvents} from '../src/modules/library/domain.js';

test('LC4.2 migration v8 to v9 retains identities and old data',()=>{
 const db=new SQL.Database();db.run(schema);for(const m of migrations.slice(0,-1))db.run(m);setMeta(db,'database_id',uuid());
 const id=uuid();db.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[id,'Q','Учебный']);
 const migrated=openDb(SQL,bytesOf(db));assert.equal(meta(db,'schema_version'),'8');assert.equal(meta(migrated,'schema_version'),'9');assert.equal(one(migrated,'SELECT id FROM person').id,id);assert.deepEqual(rows(migrated,'PRAGMA foreign_key_check'),[]);migrated.close();db.close()
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
 const next=await prepareSnapshot(f.w),opened=await readSnapshot(SQL,next.manifest,next.bytes);assert.equal(meta(opened,'schema_version'),'9');assert.deepEqual(rows(opened,'PRAGMA foreign_key_check'),[]);opened.close();
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

import {calendarData,calendarFacts,matrixPoints,practicalCriteriaFromSheet,CORPORATE_LEVELS,productionRows} from '../src/modules/training/corporate-forms.js';
import {zipStored,readZip,draftDocx,orderPayment} from '../src/modules/training/local-docx.js';
test('LC4.1 source rows, calendar, points and print rows are separate and complete',async()=>{
 const values={A7:'Учебный раздел A',A10:'Учебный раздел B'};[8,9,11,12,13,14,15,16,17,18,19].forEach((r,i)=>values['A'+r]='Учебный критерий '+(i+1));
 const q=practicalCriteriaFromSheet({name:'Чек лист',getCell:id=>({text:values[id]||''})});assert.equal(q.length,11);assert.equal(q[2].section,'Учебный раздел B');assert.equal(q[10].question,'Учебный критерий 11');
 assert.equal(calendarData('2026-01-20',[{day_offset:0,hours:2},{day_offset:2,hours:1.5},{day_offset:2,hours:3}]).days[1].hours,4.5);
 const calendar=calendarFacts('2026-01-20',[{day_offset:0,hours:2,title:'QA'}],[{date:'2026-01-21',minutes:90,title:'QA'}]);assert.deepEqual(calendar.map(x=>[x.date,x.planned,x.actual]),[['2026-01-20',2,0],['2026-01-21',0,1.5]]);
 const p=[{id:'p1'},{id:'p2'}],s=[{id:'s'}],m={cells:new Map([['p1:s',{valid:true,revisionCurrent:true,fact:{scale_id:'a',level:2},goal:{scale_id:'a',required_level:3}}],['p2:s',{valid:false,revisionCurrent:true,fact:{scale_id:'b',level:4},goal:{scale_id:'a',required_level:2}}]])};
 const x=matrixPoints(m,p,s,'a',[{person_id:'p1',skill_id:'s',scale_id:'a',target_level:4}]);assert.equal(x.bySkill.get('s').actual,2);assert.equal(x.bySkill.get('s').need,2);assert.equal(x.bySkill.get('s').unknown,1);assert.equal(x.cells.get('p2:s').actual,null);
 const label={unit:()=>'',person:id=>id,revision:id=>id},items=[{id:'a',trainee_id:'p',mentor_id:'m',sop_revision_id:'s'},{id:'b'}],facts=[{assignment_id:'a',held_at:'2026-01-20T10:00',duration_minutes:60},{assignment_id:'a',held_at:'2026-01-20T11:00',duration_minutes:30}];
 const r=productionRows(items,facts,label);assert.equal(r.length,2);assert.equal(r[0].values[6],90/1440);assert.equal(r[0].facts.length,2);assert.equal(r[1].fact,null);assert.equal(r[0].values[7],'');
 const doc=draftDocx(['Учебный текст & символ <']);const z=await readZip(doc);assert.equal(z.length,3);assert.match(new TextDecoder().decode(z.find(x=>x.name==='word/document.xml').bytes),/&amp; символ &lt;/);
 assert.match(orderPayment({instructor_amount:4000,trainer_amount:null,supplement_from:'2026-01-20'}),/4000/);
});
test('LC4.1 group order creates all appointments atomically and preserves legacy certificate identity',async()=>{
 const f=await fixture();try{
 const pos=f.w.edit('position',null,{code:'QA-POS',name:'Учебная должность'});const a=one(f.w.working,'SELECT * FROM person_assignment WHERE person_id=?',[f.mentor]);
 const original={person_id:a.person_id,unit_id:a.unit_id,profession_id:a.profession_id,position_id:a.position_id,shift_id:a.shift_id,shift_code:a.shift_code,valid_from:a.valid_from,valid_to:a.valid_to};
 f.w.edit('person_assignment',a.id,{...original,valid_to:'2026-01-19'});
 f.w.edit('person_assignment',null,{...original,position_id:pos,valid_from:date,valid_to:null});
 const header={order_number:'QA-GROUP',order_on:date,organization:'Учебная организация',city:'Учебный город',approved_by:f.actor,valid_from:date,valid_to:null,supplement_from:date,instructor_amount:1000,trainer_amount:null,evidence:'Синтетический подписанный приказ'};
 const member={id:uuid(),credential_id:f.certificate,acknowledged_on:date};
 await assert.rejects(f.save('mentor_order',{...header,members:[member,{...member,id:uuid()}]}),/повторяется/);
 assert.equal(one(f.w.working,'SELECT count(*) n FROM mentor_order').n,0);
 const e=await f.save('mentor_order',{...header,members:[member]});
 assert.equal(one(f.w.working,'SELECT order_id FROM mentor_appointment WHERE id=?',[member.id]).order_id,e.entity_id);
 assert.equal(one(f.w.working,'SELECT position_name FROM mentor_appointment WHERE id=?',[member.id]).position_name,'Учебная должность');
 await assert.rejects(f.save('mentor_order',{...header,members:[{...member,id:uuid()}]}),/уже зарегистрирован/);
 const restored=await restore(SQL,await backup(f.w),f.readContent);assert.equal(one(restored.working,'SELECT instructor_amount FROM mentor_order').instructor_amount,1000);restored.close();
 }finally{f.w.close()}
});
test('LC4.1 separate internship and entry periods preserve original template and reject out-of-range dates',async()=>{
 const f=await fixture();try{
 const tasks=['general','individual','practice','knowledge'].map(part=>({part,title:'QA '+part,hours:1,day_offset:0,sop_revision_id:null,skill_id:null,scale_id:null,target_level:null}));
 const p=(await f.save('training_program',{code:'QA-PERIOD',kind:'internship',title:'Учебная программа',profession_id:f.profession,position_id:null,created_by:f.actor,tasks})).entity_id;
 const base={program_id:p,trainee_id:f.trainee,mentor_id:f.mentor,manager_id:f.actor,start_on:date,due_on:'2026-02-20',reason:'Учебная программа',internship_start:date,internship_end:'2026-01-25',entry_start:date,entry_end:'2026-02-20'};
 await assert.rejects(f.save('training_enrollment',{...base,entry_end:'2026-03-01'}),/общий срок/);
 const e=await f.save('training_enrollment',base),row=one(f.w.working,'SELECT * FROM training_enrollment WHERE id=?',[e.entity_id]);assert.equal(row.internship_end,'2026-01-25');assert.equal(row.entry_end,'2026-02-20')
 }finally{f.w.close()}
});

test('LC4.1 daily duration preserves all minutes including repeat facts, multiple days and elapsed time over 24 hours',()=>{
 const a={id:'a',trainee_id:'p',mentor_id:'m',sop_revision_id:'s'},b={id:'b'};
 const facts=[{assignment_id:'a',held_at:'2026-01-21T08:00',duration_minutes:15},{assignment_id:'a',held_at:'2026-01-20T08:00',duration_minutes:1440},{assignment_id:'a',held_at:'2026-01-20T08:00',duration_minutes:75},{assignment_id:'a',held_at:'2026-01-21T08:15',duration_minutes:5}];
 const result=productionRows([a,b],facts,{unit:()=>'',person:id=>id,revision:id=>id});
 assert.equal(result.length,3);assert.deepEqual(result.map(r=>r.facts.length),[2,2,0]);
 assert.deepEqual(result.map(r=>r.values[4]),['2026-01-20','2026-01-21',null]);
 assert.deepEqual(result.map(r=>r.values[6]),[1515/1440,20/1440,null]);
 assert.equal(result.flatMap(r=>r.facts).reduce((n,f)=>n+f.duration_minutes,0),1535);
 assert(result.every(r=>r.values[7]===''&&r.values[8]===''));
});

import {BUILTIN_SOP,BUILTIN_PRACTICAL,BUILTIN_SELF,RC1_CRITERIA,FORM_CATALOG} from '../src/modules/training/builtin-forms.js';
import {validateChecklist,evaluationResult,sopCriteria} from '../src/modules/library/sop-review.js';
import {validatePracticalMethod,validateMentorMethod,trainingMethods,AUDIT_CODE,SELF_CODE} from '../src/modules/training/domain.js';
import {builtinOrderDocx} from '../src/modules/training/local-docx.js';
test('LC4.2 built-in forms contain source criteria and no example responses; variable revisions retain history',async()=>{
 assert.equal(BUILTIN_SOP.criteria.length,20);assert.equal(BUILTIN_PRACTICAL.criteria.length,11);assert.equal(BUILTIN_SELF.criteria.length,20);assert.equal(RC1_CRITERIA.length,20);assert.equal(FORM_CATALOG.length,13);
 assert.match(BUILTIN_PRACTICAL.criteria[9].question,/безопасно/);assert.equal(BUILTIN_SOP.criteria[19].question,'Дата изменения СОП не превышает 12 месяцев на момент проверки');
 validateChecklist(BUILTIN_SOP);validatePracticalMethod(BUILTIN_PRACTICAL);validateMentorMethod(BUILTIN_SELF,BUILTIN_SELF.format);
 assert.equal(practicalResult([{value:1},{value:0}],2).fraction,.5);assert.equal(evaluationResult([{value:1},{value:0},{value:1}],3).fraction,2/3);
 const f=await fixture();try{
 const old=f.method,next={...BUILTIN_PRACTICAL,format:'lean-practical-checklist-v2',title:'QA новая версия',criteria:BUILTIN_PRACTICAL.criteria.slice(0,3)};
 const e=await f.save('checklist_version',next);assert.equal(practicalMethods(f.w.working)[0].id,e.entity_id);assert.equal(practicalMethods(f.w.working)[1].id,old);
 assert.equal(rows(f.w.working,'SELECT * FROM checklist_criterion WHERE version_id=?',[old]).length,11);
 const id=await f.addAssignment();await f.approve(id);for(const stage of jiStages('classic').filter(x=>!['support','followup'].includes(x.phase)))await f.stage(id,stage.code);
 await f.assess(id,{method_id:e.entity_id,responses:rows(f.w.working,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[e.entity_id]).map((x,i)=>({criterion_id:x.id,value:i?1:0,note:''}))});
 assert.equal(practicalResult(JSON.parse(latestAssessment(f.w.working,id,'practical').responses_json),3).fraction,2/3);
 const sop=(await f.save('checklist_version',BUILTIN_SOP)).entity_id;const newSop={...BUILTIN_SOP,format:'lean-sop-checklist-v2',title:'QA сокращённая методика',criteria:BUILTIN_SOP.criteria.slice(0,3)};await f.save('checklist_version',newSop);assert.equal(sopCriteria(f.w.working,sop).length,20);
 const self=(await f.save('checklist_version',BUILTIN_SELF)).entity_id;
 const answers=rows(f.w.working,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[self]).map(x=>({criterion_id:x.id,value:3,note:''}));
 await assert.rejects(f.save('mentor_self_evaluation',{person_id:f.mentor,method_id:self,evaluated_on:date,place:'QA',responses:answers.map(x=>({...x,value:0})),feedback:''}),/1–5/);
 await f.save('mentor_self_evaluation',{person_id:f.mentor,method_id:self,evaluated_on:date,place:'QA',responses:answers,feedback:''});assert.equal(one(f.w.working,'SELECT count(*) n FROM mentor_self_evaluation').n,1);
 const vt=f.w.edit('business_role',null,{code:'internal_trainer',name:'Внутренний тренер'});f.w.edit('role_assignment',null,{person_id:f.actor,role_id:vt,valid_from:'2020-01-01',valid_to:null});
 const audit=(await f.save('checklist_version',{format:'lean-audit-checklist-v1',title:'QA RC1',source_sha256:'a'.repeat(64),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)})).entity_id;
 const sess=one(f.w.working,'SELECT id FROM training_session WHERE assignment_id=? LIMIT 1',[id]);
 const payload={assignment_id:id,assignment_rev:f.getAssignment(id).rev,method_id:audit,auditor_id:f.actor,session_id:sess.id,observed_on:date,responses:rows(f.w.working,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[audit]).map(x=>({criterion_id:x.id,value:1,note:''})),feedback:'QA наблюдение'};
 const ae=await f.save('audit_session',payload);assert.equal(one(f.w.working,'SELECT count(*) n FROM audit_response').n,20);assert.equal(one(f.w.working,'SELECT assignment_id FROM audit_session WHERE id=?',[ae.entity_id]).assignment_id,id);
 await f.save('audit_session',{command:'void',reason:'QA отзыв'},ae.entity_id);assert.equal(one(f.w.working,'SELECT state FROM audit_session WHERE id=?',[ae.entity_id]).state,'void');
 const restored=await restore(SQL,await backup(f.w),f.readContent);assert.equal(one(restored.working,'SELECT count(*) n FROM mentor_self_evaluation').n,1);assert.equal(one(restored.working,'SELECT count(*) n FROM audit_response').n,20);restored.close()
 }finally{f.w.close()}
});
test('LC4.2 built-in order is an unsigned DOCX without external template',async()=>{
 const parts=await readZip(builtinOrderDocx({organization:'QA',city:'QA',order_on:date,order_number:'QA-1',approved_name:'Учебный',instructor_amount:null,trainer_amount:null,supplement_from:null},[{role:'instructor',person_name:'Учебный наставник',position_name:'Должность'}]));
 const xml=new TextDecoder().decode(parts.find(x=>x.name==='word/document.xml').bytes);assert.match(xml,/Учебный наставник, Должность/);assert.match(xml,/ПРОЕКТ · БЕЗ ПОДПИСИ/)
});
