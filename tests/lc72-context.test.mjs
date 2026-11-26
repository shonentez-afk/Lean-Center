import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,makeSop,SQL,schema,migrations,date} from './lc4-fixture.mjs';
import {rows,one,createDb} from '../src/core/db.js';
import {analyzeContext,contextSelection,contextLinks,helperLabel,isCurrentTarget} from '../src/modules/assistant/context.js';
import {cloudRequest,CENTER_MODEL,askCenterCloud} from '../src/modules/assistant/cloud.js';
import {RC1_CRITERIA} from '../src/modules/training/builtin-forms.js';
import {auditDetails} from '../src/modules/training/audit-domain.js';
const day='2026-01-22';
const get=(data,id)=>data.checks.find(x=>x.id===id);
const action=(f,title)=>({response_id:null,title,owner_id:f.mentor,subject_id:f.trainee,due_on:'2026-01-21',kind:'corrective',priority:'normal'});
test('LC7.2 empty, unavailable, and selection routing are distinct',()=>{
 const db=createDb(SQL,schema,migrations[0]);try{
  const missing=analyzeContext(db,day,contextSelection('person',{employeeId:'missing'}));assert.equal(missing.available,false);assert.deepEqual(missing.checks,[]);
  const section=analyzeContext(db,day,contextSelection('preparation'));assert.equal(section.kind,'section');assert(section.notices.some(x=>x.includes('Конкретная запись не выбрана')));
  assert.equal(contextSelection('audit',{route:{auditId:'qa'}}).kind,'audit');
  assert.equal(contextSelection('skills',{route:{matrixId:'qa'}}).kind,'matrix');
  assert.equal(contextSelection('sop_evaluation',{documentId:'qa',revisionId:'rev'}).kind,'sop');
 }finally{db.close()}
});
test('LC7.2 employee gap, assignment, selected revision, action, and ROI are read-only and linked',async()=>{
 const f=await fixture();try{
  const db=f.w.working;await f.save('role_requirement',{profession_id:f.profession,skill_id:f.skill,scale_id:f.scale,required_level:3,criticality:'important',valid_from:'2026-01-01',valid_to:null});
  const assignment=await f.addAssignment({due_on:'2026-01-21'});await f.approve(assignment);
  const task=(await f.save('action_item',action(f,'QA confidential action'))).entity_id;
  const effect=(await f.save('economic_effect',{command:'create',study_id:null,action_id:task,owner_id:f.mentor,unit_id:f.unit,currency:'RUB',method:'direct',title:'QA confidential effect',plan:{annualGross:1234,investment:200,annualCost:100},plan_basis:'QA evidence',review_due:'2026-01-21'})).entity_id;
  const before=db.export(),pending=f.w.pending.length;
  const employee=analyzeContext(db,day,contextSelection('person',{employeeId:f.trainee}));assert.equal(get(employee,'ctx_gap').count,1);assert.equal(get(employee,'training_overdue').count,1);assert.equal(get(employee,'action_overdue').count,1);
  const draft=contextLinks(employee).find(x=>x.page==='development'&&x.options.mode==='new');assert.equal(draft.options.personId,f.trainee);assert(draft.options.draftTitle);
  const training=analyzeContext(db,day,contextSelection('twi',{route:{id:assignment}}));assert(get(training,'ctx_ji').count>0);assert.equal(get(training,'ctx_admission').count,1);assert.equal(get(training,'training_overdue').count,1);
  const sop=analyzeContext(db,day,contextSelection('sop',{documentId:f.doc.entity_id,revisionId:f.doc.id}));assert.equal(sop.available,true);assert(!get(sop,'ctx_sop_state'));assert(sop.title.includes('QA-LC4'));
  const a=analyzeContext(db,day,contextSelection('actions',{route:{id:task}}));assert.equal(get(a,'action_overdue').count,1);assert.equal(a.title,'QA confidential action');
  const roi=analyzeContext(db,day,contextSelection('roi',{route:{id:effect}}));assert.equal(get(roi,'roi_pending').count,1);assert.equal(get(roi,'roi_overdue').count,1);
  const metrics=analyzeContext(db,day,contextSelection('metrics',{route:{from:'2026-01-01',to:day,unitId:f.unit}}));assert(metrics.metrics.length>0);assert(metrics.metrics.every(x=>x.definition&&x.target.page));
  assert.equal(f.w.pending.length,pending);assert.deepEqual(db.export(),before);
  await f.save('development_plan',{person_id:f.trainee,title:'QA plan',start_on:date,due_on:'2026-02-01'});const next=analyzeContext(db,day,contextSelection('person',{employeeId:f.trainee}));assert(!contextLinks(next).some(x=>x.page==='development'&&x.options.mode==='new'));assert(contextLinks(next).some(x=>x.page==='development'&&x.options.id));
 }finally{f.w.close()}
});
test('LC7.2 audit observations preserve method and reuse existing actions instead of duplicating drafts',async()=>{
 const f=await fixture();try{
  const db=f.w.working,role=f.w.edit('business_role',null,{code:'INTERNAL_TRAINER',name:'Внутренний тренер'});f.w.edit('role_assignment',null,{person_id:f.actor,role_id:role,valid_from:'2020-01-01',valid_to:null});
  const id=await f.addAssignment();await f.approve(id);await f.stage(id,'prepare');
  const method=(await f.save('checklist_version',{format:'lean-audit-checklist-v1',title:'QA RC1',source_sha256:'a'.repeat(64),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)})).entity_id,sess=one(db,'SELECT id FROM training_session WHERE assignment_id=?',[id]),q=rows(db,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[method]);
  const audit=(await f.save('audit_session',{assignment_id:id,assignment_rev:f.getAssignment(id).rev,method_id:method,auditor_id:f.actor,session_id:sess.id,observed_on:date,responses:q.map((x,i)=>({criterion_id:x.id,value:i===0?0:i===1?'not_observed':1,note:i===1?'QA':''})),feedback:'QA'})).entity_id;
  const ctx=contextSelection('audit',{route:{auditId:audit}}),first=analyzeContext(db,day,ctx),response=auditDetails(db,audit).questions[0].response_id;
  assert.equal(get(first,'ctx_audit_no').count,1);assert.equal(get(first,'ctx_audit_missing').count,1);assert.equal(get(first,'ctx_audit_no').links[0].options.responseId,response);
  const task=(await f.save('action_item',{response_id:response,title:'QA correction',owner_id:f.mentor,subject_id:f.mentor,due_on:'2026-02-01',kind:'instructor_training',priority:'normal'})).entity_id;
  const next=analyzeContext(db,day,ctx);assert.equal(get(next,'ctx_audit_no').links[0].options.id,task);assert(!contextLinks(next).some(x=>x.options.responseId===response));
  const metrics=analyzeContext(db,day,contextSelection('analytics',{route:{assessmentType:'audit',versionId:method,from:date,to:day,personId:f.mentor}}));assert.equal(metrics.title,'Аналитика L1 · выбранная методика');assert(metrics.facts.some(x=>x.value==='18 / 19'));
 }finally{f.w.close()}
});
test('LC7.2 cloud context is opt-in, validated and only carries integer counts and allowlisted topics',async()=>{
 const ids=['ctx_gap','training_overdue'],context={kind:'person',counts:[{id:'ctx_gap',count:2},{id:'training_overdue',count:1}]};
 assert(Array.isArray(JSON.parse(cloudRequest(ids).messages[1].content)));
 const packet=JSON.parse(cloudRequest(ids,CENTER_MODEL,context).messages[1].content);assert.equal(packet.context,'Сотрудник');assert.deepEqual(packet.rules.map(x=>[x.id,x.count]),[['ctx_gap',2],['training_overdue',1]]);
 for(const bad of [{...context,name:'QA Secret'},{...context,kind:'QA secret'},{...context,counts:[{id:'ctx_gap',count:1,personId:'secret'},context.counts[1]]},{...context,counts:[{id:'ctx_gap',count:1.5},context.counts[1]]},{...context,counts:[...context.counts].reverse()}])assert.throws(()=>cloudRequest(ids,CENTER_MODEL,bad),/Недопустимые обезличенные показатели/);
 const recommendations=[{id:'ctx_gap',text:'QA advice'}];
 const result=await askCenterCloud(ids,{context,fetcher:async(_url,opts)=>{assert.deepEqual(JSON.parse(opts.body),cloudRequest(ids,CENTER_MODEL,context));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({recommendations})}}]}))}});
 assert.deepEqual(result.recommendations,recommendations);
});

test('LC7.3A assistant never silently substitutes a SOP revision; personal sections and same-card links are honest',async()=>{
 const f=await fixture();try{const db=f.w.working,older=f.doc.id,latest=(await f.revise()).revision;
  const getSop=revisionId=>analyzeContext(db,day,contextSelection('sop',{documentId:f.doc.entity_id,revisionId}));
  assert.equal(getSop(older).facts.find(x=>x.label==='Редакция').value,'1');assert.equal(getSop(latest).facts.find(x=>x.label==='Редакция').value,'2');assert.equal(getSop(older).facts.find(x=>x.label==='Статус').value,'Заменён');assert.equal(getSop(latest).facts.find(x=>x.label==='Статус').value,'Действует');assert.equal(getSop('missing').available,false);assert.equal(getSop(null).available,false);assert(getSop(null).scope.includes('редакция не выбрана'));assert(!getSop(null).facts.some(x=>x.label==='Редакция'));
  const task=(await f.save('action_item',action(f,'QA same card'))).entity_id,ctx=contextSelection('actions',{route:{id:task}}),a=analyzeContext(db,day,ctx);assert.equal(a.facts.find(x=>x.label==='Состояние').value,'Открыто');assert(contextLinks(a).some(x=>isCurrentTarget(ctx,x)));assert(!isCurrentTarget(ctx,{page:'actions',options:{id:'another'}}));
  for(const page of ['calendar','my_plan','journal']){const context=contextSelection(page,{route:{personId:f.trainee,month:'2026-01'}}),data=analyzeContext(db,day,context);assert.equal(helperLabel(context),'Обзор центра');assert(data.scope.includes('Весь центр'));assert(data.notices.some(x=>x.includes('не проверяет выбранный месяц')))}
 }finally{f.w.close()}
});

test('QA-04 helper and real approval share trimmed key moments predicate',async()=>{
 const f=await fixture();try{const db=f.w.working;
  for(const [i,kms,ok] of [[0,[],false],[1,[' ','\t'],false],[2,[' ','Проверить фиксацию','\t'],true]]){
   const s=await makeSop('QA КМ '+i,false,kms);f.sources.set(s.source.sha256,s);
   const doc=await f.save('document',{command:'create',code:'QA-KM-'+i,title:'QA КМ '+i,operation_id:f.operation,source:s.source,projection:s.projection});
   await f.save('document',{command:'passport',revision_id:doc.id,print_format:'portrait',changed_on:date},doc.entity_id);
   await f.save('document',{command:'submit',revision_id:doc.id,actor_id:f.actor,note:''},doc.entity_id);
   const data=()=>analyzeContext(db,day,contextSelection('sop',{documentId:doc.entity_id,revisionId:doc.id}));
   assert.equal(get(data(),'ctx_sop_steps')?.count||0,ok?0:1);assert.equal(data().facts.find(x=>x.label==='Редакция').value,'1');
   const approve=()=>f.save('document',{command:'approve',revision_id:doc.id,actor_id:f.actor,note:''},doc.entity_id);
   if(ok)await approve();else{await assert.rejects(approve(),/ключевые моменты/);assert.equal(data().facts.find(x=>x.label==='Статус').value,'На согласовании');assert(contextLinks(data()).some(x=>x.options.revisionId===doc.id))}
  }
 }finally{f.w.close()}
});
