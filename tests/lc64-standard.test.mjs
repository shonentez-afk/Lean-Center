import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,SQL,schema,migrations,date} from './lc4-fixture.mjs';
import {rows,one,meta,uuid,setMeta,openDb,bytesOf,backup,restore,canonical,sha256,checkPackage} from '../src/core/db.js';
import {QUESTION_BANK_V03} from '../src/modules/training/question-bank-v03.js';
import {adaptationBounds,bankRows,bankChanges,bankControl,preparationRows,sharedTrainingTask,supplementRows,supplementStatus} from '../src/modules/training/standard-workflows.js';
import {enrollmentTasks} from '../src/modules/training/domain.js';
test('LC6.4 migration retains v15 database and creates three native workflow tables',()=>{
 const d=new SQL.Database();try{d.run(schema);for(const m of migrations.slice(0,14))d.run(m);setMeta(d,'database_id',uuid());const person=uuid();d.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[person,'QA-64','QA']);const n=openDb(SQL,bytesOf(d));try{assert.equal(meta(d,'schema_version'),'15');assert.equal(meta(n,'schema_version'),'16');assert.equal(one(n,'SELECT id FROM person').id,person);for(const t of ['twi_preparation','twi_knowledge_bank','twi_supplement'])assert.equal(one(n,'SELECT count(*) n FROM '+t).n,0);assert.deepEqual(rows(n,'PRAGMA foreign_key_check'),[])}finally{n.close()}}finally{d.close()}
});
test('LC6.4 original question bank: all 145 questions and independent 10 percent annual quotas',async()=>{
 assert.deepEqual(QUESTION_BANK_V03.blocks.map(b=>b.questions.length),[31,26,29,29,30]);
 const f=await fixture();try{const db=f.w.working,base=structuredClone(QUESTION_BANK_V03.blocks),p={profession_id:f.profession,author_id:f.actor,reviewed_on:'2025-12-31',previous_id:null,note:'QA исходная',blocks:base};const first=(await f.save('twi_knowledge_bank',p)).entity_id;
 const newer={...p,reviewed_on:date,previous_id:first,note:'QA ежегодная редакция'};await assert.rejects(f.save('twi_knowledge_bank',newer),/10%/);
 const changed=structuredClone(base);for(const b of changed)for(let i=0;i<Math.ceil(b.questions.length*.1);i++)b.questions[i].text+=' (QA новая редакция '+i+')';
 assert(bankChanges(base,changed).every(b=>b.ok));await f.save('twi_knowledge_bank',{...newer,blocks:changed});
 assert.equal(bankRows(db).length,2);assert.equal(bankControl(db,date)[0].status,'Актуализация подтверждена');assert(bankControl(db,'2027-01-01')[0].stale);
 const pkg=await f.w.package(),{hash,...body}=pkg,old={...body,schema_version:15};await assert.rejects(checkPackage({...old,hash:await sha256(canonical(old))}),/LC6.4/);
 const restored=await restore(SQL,await backup(f.w),f.readContent);assert.equal(bankRows(restored.working).length,2);restored.close()
 }finally{f.w.close()}
});
test('LC6.4 preparation: linked documents, duration and two shifts; one canonical assignment for common SOP',async()=>{
 assert.deepEqual(adaptationBounds('2026-01-20','transfer'),{min:'2026-02-19',max:'2026-02-19'});
 const f=await fixture();try{const db=f.w.working,blank=(part,title)=>({part,title,hours:1,day_offset:0,sop_revision_id:null,skill_id:null,scale_id:null,target_level:null}),common={...blank('practice','QA общая операция'),sop_revision_id:f.doc.id,skill_id:f.skill,scale_id:f.scale,target_level:2};
 const make=async(standard_kind,kind,tasks,due_on)=>(await f.save('training_enrollment',{program_id:(await f.save('training_program',{code:'QA-64-'+standard_kind,kind,standard_kind,title:'QA '+standard_kind,profession_id:f.profession,position_id:null,created_by:f.actor,tasks})).entity_id,trainee_id:f.trainee,mentor_id:f.mentor,manager_id:f.actor,start_on:date,due_on,reason:'QA'})).entity_id;
 const a=await make('adaptation','entry',[blank('general','QA'),blank('individual','QA'),common,blank('knowledge','QA')],'2026-02-19'),s=await make('safety','production',[blank('general','QA ОТ')],'2026-01-21'),j=await make('internship','internship',[common],'2026-01-25');
 const payload={trainee_id:f.trainee,manager_id:f.actor,category:'transfer',adaptation_id:a,safety_id:s,internship_id:j,note:'QA',shifts:[{date,shift_id:f.shift},{date:'2026-01-21',shift_id:f.shift}]};
 await assert.rejects(f.save('twi_preparation',{...payload,shifts:[payload.shifts[0]]}),/двух смен/);await assert.rejects(f.save('twi_preparation',{...payload,shifts:[payload.shifts[0],payload.shifts[0]]}),/Смены/);await f.save('twi_preparation',payload);
 const bundle=preparationRows(db,f.trainee)[0];assert.equal(bundle.documents.length,3);assert.equal(bundle.shared.length,1);const m=bundle.shared[0];
 assert.deepEqual(sharedTrainingTask(db,a,m.adaptation_task_id),{enrollmentId:j,taskId:m.internship_task_id});
 await assert.rejects(f.addAssignment({enrollment_id:a,program_task_id:m.adaptation_task_id,due_on:'2026-01-23'}),/Общая операция/);
 const id=await f.addAssignment({enrollment_id:j,program_task_id:m.internship_task_id,due_on:'2026-01-23'});const enrollment=one(db,'SELECT * FROM training_enrollment WHERE id=?',[a]);assert.equal(enrollmentTasks(db,enrollment).find(x=>x.id===m.adaptation_task_id).assignment.id,id);assert.equal(rows(db,'SELECT id FROM training_assignment').length,1)
 }finally{f.w.close()}
});
test('LC6.4 supplement: no duplicate tasks, threshold and manager decision, no automatic payment',async()=>{
 const f=await fixture();try{const db=f.w.working,task={code:'instruction',done_on:date,evidence:'QA факт'},p={person_id:f.mentor,manager_id:f.actor,role:'instructor',month:date.slice(0,7),tasks:[task]};
 await assert.rejects(f.save('twi_supplement',{...p,tasks:[task,task]}),/уникальна/);
 const id=(await f.save('twi_supplement',p)).entity_id;await assert.rejects(f.save('twi_supplement',{command:'approve',actor_id:f.actor,note:'QA'},id),/минимальный/);
 await f.save('twi_supplement',{command:'revise',tasks:[task,{code:'sop',done_on:date,evidence:'QA СОП'}]},id);
 const rec=supplementRows(db,f.mentor)[0];assert.equal(rec.state,'draft');assert.deepEqual(supplementStatus(rec.role,rec.tasks),{count:2,minimum:2,amount:5000,eligible:true});await assert.rejects(f.save('twi_supplement',{command:'approve',actor_id:f.mentor,note:'QA'},id),/Решение/);
 await f.save('twi_supplement',{command:'approve',actor_id:f.actor,note:'QA руководитель'},id);assert.equal(supplementRows(db)[0].state,'approved');await assert.rejects(f.save('twi_supplement',p),/уже существует/)
 }finally{f.w.close()}
});
