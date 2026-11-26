import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,SQL,schema,migrations,date} from './lc4-fixture.mjs';
import {one,rows,uuid,openDb,bytesOf,meta,setMeta,Workspace,checkPackage,canonical,sha256,prepareSnapshot,readSnapshot,backup,restore} from '../src/core/db.js';
import {inspectSource} from '../src/modules/library/domain.js';
import {calculateEffect,measurementOf,effectEvidence,effectCurrent,effectOverview,effectPending,effectFacts,factCurrent,factNet,periodTargets,targetNeedsAttention} from '../src/modules/effect/domain.js';
import {employeeRelations} from '../src/modules/master-data/employee-records.js';
import {jiStages} from '../src/modules/training/domain.js';
import {twiOverview,twiComparison} from '../src/modules/training/twi-effectiveness.js';
import {twiBasis,twiBasisCurrent,twiEffectsFor} from '../src/modules/effect/domain.js';
import {economicReport,economicReportSheets,attainment} from '../src/modules/effect/reporting.js';
import * as net from '../src/storage/network.js';
const timePlan={deltaSeconds:30,cyclesPerYear:3600,hourRate:100,realization:50,investment:1000,annualCost:500};
const directPlan={annualGross:1000,investment:200,annualCost:100};
async function task(f,study=null){
 const id=(await f.save('action_item',{response_id:null,title:'QA улучшение',owner_id:f.mentor,subject_id:null,due_on:'2026-02-01',kind:'corrective',priority:'normal',...(study?{source_link:{kind:'frv_study',id:study}}:{})})).entity_id;
 return id
}
async function verifyTask(f,id){await f.save('action_item',{command:'implement',result:'QA факт'},id);await f.save('action_item',{command:'verify',verifier_id:f.actor,audit_id:null,outcome:'effective',evidence:'QA независимая проверка'},id)}
const plan=(f,study,action,extra={})=>({command:'create',study_id:study,action_id:action,owner_id:f.mentor,unit_id:f.unit,currency:'RUB',method:study?'time':'direct',title:'QA экономический эффект',plan:study?timePlan:directPlan,plan_basis:'QA объём и ставка',review_due:'2026-02-01',...extra});
test('LC6 annual model: signed savings, costs, ROI, zero investment, no invented payback',()=>{
 const x=calculateEffect('time',{...timePlan,deltaSeconds:60});assert.equal(x.hours,60);assert.equal(x.annualBenefit,3000);assert.equal(x.yearOne,1500);assert.equal(x.roi,150);assert.equal(x.payback,4.8);
 const y=calculateEffect('direct',directPlan);assert.equal(y.annualNet,900);assert.equal(y.roi,350);
 const z=calculateEffect('direct',{annualGross:-100,investment:0,annualCost:20});assert.equal(z.yearOne,-120);assert.equal(z.roi,null);assert.equal(z.payback,null);
 assert.throws(()=>calculateEffect('time',{...timePlan,realization:101}),/0–100/);assert.throws(()=>calculateEffect('time',{...timePlan,cyclesPerYear:1.5}),/целый/);assert.throws(()=>calculateEffect('direct',{...directPlan,investment:-1}),/затраты/);
});
test('LC6 v13 migration is additive; old rows and publication identity preserved',async()=>{
 const db=new SQL.Database();try{db.run(schema);for(const sql of migrations.slice(0,-1))db.run(sql);const database=uuid();setMeta(db,'database_id',database);const id=uuid();db.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[id,'LC6-M','QA']);const w=openDb(SQL,bytesOf(db));try{assert.equal(meta(db,'schema_version'),'13');assert.equal(meta(w,'schema_version'),'14');assert.equal(meta(w,'database_id'),database);assert.equal(one(w,'SELECT id FROM person').id,id);assert.equal(one(w,'SELECT count(*) n FROM economic_effect').n,0);assert.deepEqual(rows(w,'PRAGMA foreign_key_check'),[])}finally{w.close()}}finally{db.close()}
});
test('LC6 FRV plan, checked exact measurements, deduplication, period fact, confirmation and stale evidence',async()=>{
 const f=await fixture();try{
  const db=f.w.working,raw={schemaVersion:'FRV-1.3',study:{studyId:'LC6-QA',operationId:'QA'},comparisonApproved:true,cycles:[{phase:'baseline',observations:[{id:'o1',actionRaw:'Работа',valueType:'VA',durationSec:120}]},{phase:'improved',observations:[{id:'o2',actionRaw:'Работа',valueType:'VA',durationSec:60}]}]},text=JSON.stringify(raw),source={text,...await inspectSource(text,'frv')};f.sources.set(source.source.sha256,source);
  const study=(await f.save('frv_study',{command:'create',title:'QA ФРВ',operation_id:f.operation,observed_at:date,source:source.source,projection:source.projection})).entity_id;
  const action=await task(f,study),id=(await f.save('economic_effect',plan(f,study,null))).entity_id,get=()=>one(db,'SELECT * FROM economic_effect WHERE id=?',[id]);
  assert(effectPending(db,get()));await assert.rejects(f.save('economic_effect',plan(f,study,null)),/карточка эффекта/);await assert.rejects(f.save('economic_effect',plan(f,null,action)),/карточка эффекта|общую карточку/);
  const measure=()=>({command:'measure',inputs:{...timePlan,deltaSeconds:60},measurement:measurementOf(raw),reviewer_id:f.actor,evidence:'QA проверены замеры',actions:effectEvidence(db,get()),source:source.source});
  await assert.rejects(f.save('economic_effect',measure(),id),/связанные мероприятия/);
  await f.save('frv_study',{command:'finalize',actor_id:f.actor,note:'QA'},study);await verifyTask(f,action);
  const tampered=measure();tampered.measurement.before=121;await assert.rejects(f.save('economic_effect',tampered,id),/не совпадает/);
  const wrong=measure();wrong.inputs.deltaSeconds=61;await assert.rejects(f.save('economic_effect',wrong,id),/следовать из замеров/);
  await f.save('economic_effect',measure(),id);assert(effectCurrent(db,get()));assert(!effectPending(db,get()));
  await assert.rejects(f.save('economic_effect',{command:'plan',plan:timePlan,plan_basis:'QA'},id),/зафиксирован/);
  const p={command:'create',effect_id:id,actual_event_id:get().actual_event_id,period_from:'2026-01-01',period_to:'2026-01-15',gross_minor:40000,recurring_minor:5000,investment_minor:2000,registered_by:f.mentor,evidence:'QA акт №1'};
  const fact=(await f.save('economic_fact',p)).entity_id;
  assert.equal(effectOverview(db,{day:date}).currencies.length,0);assert.equal(effectOverview(db,{day:date}).drafts,1);
  await assert.rejects(f.save('economic_fact',{...p,period_from:'2026-01-15',period_to:date}),/пересекается/);
  await assert.rejects(f.save('economic_fact',{command:'confirm',verifier_id:f.mentor,note:'QA'},fact),/независимый/);
  await f.save('economic_fact',{command:'confirm',verifier_id:f.actor,note:'QA документы'},fact);
  const x=effectFacts(db,id)[0];assert.equal(factNet(x),33000);assert(factCurrent(db,get(),x));assert.equal(effectOverview(db,{day:date,from:'2026-01-01',to:date}).currencies[0].net,33000);assert.equal(effectOverview(db,{day:date,from:'2026-01-02',to:date}).currencies.length,0);
  assert(employeeRelations(db,f.mentor).development.some(x=>x.id===id));assert(employeeRelations(db,f.actor).development.some(x=>x.id===fact));
  await f.save('economic_effect',{command:'reschedule',review_due:'2026-03-01',reason:'QA повторный контроль'},id);assert(effectPending(db,get()));assert.equal(effectOverview(db,{day:date}).currencies[0].net,33000);
  await f.save('economic_effect',measure(),id);assert(factCurrent(db,get(),x));assert.equal(effectOverview(db,{day:date}).currencies[0].net,33000);
  const archive={id:uuid(),entity_type:'frv_study',entity_id:study,operation:'archive',expected_revision:one(db,'SELECT rev FROM frv_study WHERE id=?',[study]).rev,payload:null,occurred_at:date+'T01:00:00Z'};await f.w.applyContentEvents([archive],f.readContent);
  assert(!effectCurrent(db,get()));assert(effectPending(db,get()));assert(!factCurrent(db,get(),x));assert.equal(effectOverview(db,{day:date}).currencies.length,0);assert.equal(effectOverview(db,{day:date}).facts.length,1);
  const pkg=await f.w.package(),{hash,...body}=pkg,old={...body,schema_version:13};await assert.rejects(checkPackage({...old,hash:await sha256(canonical(old))}),/старой схемы содержит LC6/);
  await f.w.acceptOwn(f.readContent);assert.equal(f.w.pending.length,0);const snapshot=await prepareSnapshot(f.w),reopened=await readSnapshot(SQL,snapshot.manifest,snapshot.bytes);try{assert.equal(one(reopened,'SELECT state FROM economic_fact WHERE id=?',[fact]).state,'confirmed');assert.equal(effectOverview(reopened,{day:date}).facts.length,1);assert.deepEqual(rows(reopened,'PRAGMA foreign_key_check'),[])}finally{reopened.close()}
 }finally{f.w.close()}
});
test('LC6 direct action effect, currencies and voiding keep monetary facts separate',async()=>{
 const f=await fixture();try{
  const db=f.w.working,ids=[];
  for(const currency of ['RUB','EUR']){const a=await task(f);await verifyTask(f,a);const id=(await f.save('economic_effect',plan(f,null,a,{currency}))).entity_id,r=()=>one(db,'SELECT * FROM economic_effect WHERE id=?',[id]);await f.save('economic_effect',{command:'measure',inputs:directPlan,measurement:null,source:null,actions:effectEvidence(db,r()),reviewer_id:f.actor,evidence:'QA первичные расчёты'},id);
   const fact=(await f.save('economic_fact',{command:'create',effect_id:id,actual_event_id:r().actual_event_id,period_from:'2026-01-01',period_to:date,gross_minor:10000,recurring_minor:1000,investment_minor:500,registered_by:f.mentor,evidence:'QA документы'})).entity_id;await f.save('economic_fact',{command:'confirm',verifier_id:f.actor,note:'QA проверено'},fact);ids.push(fact)
  }
  assert.deepEqual(effectOverview(db,{day:date}).currencies.map(x=>[x.currency,x.net]),[['EUR',8500],['RUB',8500]]);
  await f.save('economic_fact',{command:'void',actor_id:f.actor,reason:'QA исправление документа'},ids[0]);assert.deepEqual(effectOverview(db,{day:date}).currencies.map(x=>x.currency),['EUR']);assert.equal(one(db,'SELECT void_reason FROM economic_fact WHERE id=?',[ids[0]]).void_reason,'QA исправление документа');assert.deepEqual(rows(db,'PRAGMA foreign_key_check'),[]);
 }finally{f.w.close()}
});

const missing=()=>Object.assign(new Error('missing'),{name:'NotFoundError'});
class FileHandle{constructor(){this.kind='file';this.data=new Uint8Array()}async getFile(){return new Blob([this.data])}async createWritable(){let data;return {write:async d=>{data=typeof d==='string'?new TextEncoder().encode(d):new Uint8Array(d)},close:async()=>{this.data=data},abort:async()=>{}}}}
class Folder{constructor(){this.kind='directory';this.files=new Map()}async queryPermission(){return 'granted'}async requestPermission(){return 'granted'}async getFileHandle(n,{create=false}={}){if(!this.files.has(n)){if(!create)throw missing();this.files.set(n,new FileHandle())}const f=this.files.get(n);assert.equal(f.kind,'file');return f}async getDirectoryHandle(n,{create=false}={}){if(!this.files.has(n)){if(!create)throw missing();this.files.set(n,new Folder())}const f=this.files.get(n);assert.equal(f.kind,'directory');return f}async *entries(){yield* this.files.entries()}}
test('LC6.1 period coverage, signed deviations, recorded causes, stale review, consistent report and network publication',async()=>{
 const f=await fixture();let master,reader,restored;
 try{
  const db=f.w.working,a=await task(f);await verifyTask(f,a);
  const id=(await f.save('economic_effect',plan(f,null,a))).entity_id,r=()=>one(f.w.working,'SELECT * FROM economic_effect WHERE id=?',[id]);
  const goal={command:'period_target',from:'2026-01-01',to:date,target_minor:40000,basis:'QA план периода',actor_id:f.mentor};
  const target=(await f.save('economic_effect',goal,id)).id;
  await assert.rejects(f.save('economic_effect',goal,id),/пересекается/);
  const get=()=>periodTargets(f.w.working,r(),date).find(x=>x.id===target),scope={day:date,from:'2026-01-01',to:date};
  assert(!get().complete);assert.equal(get().delta,null);assert(targetNeedsAttention(get()));assert.equal(economicReport(effectOverview(db,scope)).incomplete,1);
  await f.save('economic_effect',{command:'measure',inputs:directPlan,measurement:null,source:null,actions:effectEvidence(db,r()),reviewer_id:f.actor,evidence:'QA проверка'},id);
  const input={command:'create',effect_id:id,actual_event_id:r().actual_event_id,registered_by:f.mentor,evidence:'QA факт',gross_minor:20000,recurring_minor:0,investment_minor:0};
  await assert.rejects(f.save('economic_fact',{...input,period_from:'2025-12-31',period_to:'2026-01-10'}),/границу цели/);
  const oneId=(await f.save('economic_fact',{...input,period_from:'2026-01-01',period_to:'2026-01-10'})).entity_id;
  await f.save('economic_fact',{command:'confirm',verifier_id:f.actor,note:'QA'},oneId);
  assert.equal(get().actual,20000);assert.equal(get().delta,null);
  const twoId=(await f.save('economic_fact',{...input,period_from:'2026-01-11',period_to:date,gross_minor:13000})).entity_id;
  await f.save('economic_fact',{command:'confirm',verifier_id:f.actor,note:'QA'},twoId);
  let t=get();assert(t.complete);assert.equal(t.delta,-7000);assert(t.shortfall);assert.equal(t.status,'Требуется разбор отклонения');
  const review={command:'period_review',target_id:target,actor_id:f.actor,cause:'volume',note:'QA снизился объём',action_id:a,signature:t.signature,actual_minor:t.actual};
  await assert.rejects(f.save('economic_effect',{...review,signature:'forged'},id),/полным актуальным/);
  await f.save('economic_effect',review,id);assert(get().currentReview);assert(!targetNeedsAttention(get()));
  const overview=effectOverview(db,scope),report=economicReport(overview),annual=economicReport(overview,{grain:'year'});
  assert.equal(overview.currencies[0].net,33000);assert.equal(report.series[0].net,33000);assert.equal(report.series[0].cumulative,33000);assert.equal(report.series[0].planned,40000);assert.equal(report.series[0].actual,33000);assert.equal(report.ranks[0].rank,1);assert.equal(report.causes[0].shortfall,7000);assert.equal(report.causes[0].cause,'volume');assert.equal(annual.series[0].key,'2026');assert.equal(attainment(33000,40000),82.5);assert.equal(attainment(33000,0),null);
  const sheets=economicReportSheets(report,overview,scope,(_kind,id)=>id);assert.equal(sheets.length,8);assert.equal(sheets.find(s=>s.name==='Валюты').rows[0][5],330);assert.equal(sheets.find(s=>s.name==='Динамика').rows[0][7],330);
  // Real network adapter over an in-memory directory, plus portable source bytes.
  const dir=new Folder();master=new Workspace(SQL,openDb(SQL,bytesOf(f.w.base)));const first=await prepareSnapshot(master);await net.publishSnapshot(dir,SQL,first);master.replaceBase((await net.latestSnapshot(dir,SQL)).db);
  const pkg=await f.w.package();await net.sendPackage(dir,pkg,f.readContent);assert.equal((await net.sendPackage(dir,await f.w.package(),f.readContent)).duplicate,true);await master.accept(pkg,ref=>net.readContent(dir,ref));
  const next=await prepareSnapshot(master);await net.publishSnapshot(dir,SQL,next,ref=>net.readContent(dir,ref));reader=new Workspace(SQL,(await net.latestSnapshot(dir,SQL)).db);
  assert.equal(economicReport(effectOverview(reader.working,scope)).matched[0].actual,33000);assert.equal(periodTargets(reader.working,one(reader.working,'SELECT * FROM economic_effect WHERE id=?',[id]),date)[0].currentReview,true);
  restored=await restore(SQL,await backup(reader),ref=>net.readContent(dir,ref));assert.equal(effectOverview(restored.working,scope).currencies[0].net,33000);assert.deepEqual(rows(restored.working,'PRAGMA foreign_key_check'),[]);
  await f.save('economic_fact',{command:'void',actor_id:f.actor,reason:'QA отменён документ'},twoId);assert(!get().complete);assert(!get().currentReview);assert.equal(get().delta,null);assert.equal(economicReport(effectOverview(f.w.working,scope)).matched.length,0);
  const replacement=(await f.save('economic_fact',{...input,period_from:'2026-01-11',period_to:date,gross_minor:10000})).entity_id;await f.save('economic_fact',{command:'confirm',verifier_id:f.actor,note:'QA исправлено'},replacement);
  assert(get().shortfall);assert(!get().currentReview);assert.equal(get().delta,-10000);assert.equal(economicReport(effectOverview(f.w.working,scope)).causes[0].cause,'unreviewed');
 }finally{restored?.close();reader?.close();master?.close();f.w.close()}
});
test('LC6.1 monthly and yearly aggregation keeps currencies, signed totals, ranks and target basis separate',()=>{
 const a={id:'a',currency:'RUB',unit_id:'u1',state:'active'},b={id:'b',currency:'RUB',unit_id:'u2',state:'active'},e={id:'e',currency:'EUR',unit_id:'u1',state:'active'};
 const f=(effect,to,gross)=>({effect,period_to:to,gross_minor:gross,recurring_minor:0,investment_minor:0,eligible:true});
 const facts=[f(a,'2026-01-31',10000),f(a,'2026-02-28',-2000),f(b,'2026-02-28',9000),f(e,'2026-02-28',5000),{...f(a,'2026-03-31',99999),eligible:false}];
 const x=economicReport({facts,targets:[]}),rub=x.series.filter(y=>y.currency==='RUB');assert.deepEqual(rub.map(y=>y.cumulative),[10000,17000]);assert.deepEqual(x.ranks.filter(y=>y.currency==='RUB').map(y=>[y.key,y.rank,y.net]),[['u2',1,9000],['u1',2,8000]]);assert.equal(x.series.find(y=>y.currency==='EUR').net,5000);assert.deepEqual(economicReport({facts,targets:[]},{grain:'year'}).series.map(y=>[y.currency,y.key,y.net]),[['EUR','2026',5000],['RUB','2026',17000]]);
});

test('LC6.2 TWI cohort separates first practice, repeat practice, recorded and current admission, intro and follow-up time',async()=>{
 const f=await fixture();try{
  const id=await f.addAssignment();await f.approve(id);
  const intro=jiStages('classic').filter(x=>!['support','followup'].includes(x.phase));
  for(const x of intro)await f.stage(id,x.code,{duration_minutes:10});
  await f.assess(id,{conclusion:'not_meet'});const practical=(await f.assess(id)).entity_id;await f.qualify(id,practical);await f.verify(id,'safety');await f.verify(id,'theory');await f.admit(id);
  for(const x of jiStages('classic').filter(x=>['support','followup'].includes(x.phase)))await f.stage(id,x.code,{duration_minutes:5});
  const scope={day:date,from:date,to:date,unitId:f.unit},db=f.w.working,x=twiOverview(db,scope);
  assert.equal(x.stats.assignments,1);assert.equal(x.stats.people,1);assert.equal(x.stats.firstPass,0);assert.equal(x.stats.repeat,1);assert.equal(x.stats.recovered,1);assert.equal(x.stats.granted,1);assert.equal(x.stats.current,1);assert.equal(x.stats.medianDays,0);assert.equal(x.stats.meanMinutes,intro.length*10);assert.equal(x.minutes,intro.length*10+6*5);
  assert.equal(twiOverview(db,{...scope,personId:f.mentor,role:'mentor'}).stats.assignments,1);assert.equal(twiOverview(db,{...scope,personId:f.mentor,role:'trainee'}).stats.assignments,0);assert.equal(twiOverview(db,{...scope,personId:f.actor,role:'auditor'}).stats.assignments,0);
  assert.equal(twiOverview(db,{...scope,revisionId:f.doc.id}).stats.assignments,1);
  const r=await f.revise();assert.equal(twiOverview(db,scope).stats.current,0);assert.equal(twiOverview(db,scope).stats.granted,1);assert.equal(twiOverview(db,{...scope,revisionId:r.revision}).stats.assignments,0);
 }finally{f.w.close()}
});
test('LC6.2 comparable TWI program groups, verified ROI link, cross-card deduplication and stale evidence',async()=>{
 const f=await fixture();let restored;try{
  const db=f.w.working,taskId=await task(f);await verifyTask(f,taskId);
  const program=(await f.save('training_program',{code:'QA-TWI',kind:'entry',title:'QA подготовка',profession_id:f.profession,position_id:null,created_by:f.actor,tasks:[{part:'general',title:'QA задание',hours:1,day_offset:0,sop_revision_id:null,skill_id:null,scale_id:null,target_level:null}]})).entity_id;
  let clock=Date.parse('2026-01-21T09:00:00Z');
  async function later(t,p,id=null){const old=id?one(db,'SELECT * FROM '+t+' WHERE id=?',[id]):null,e={id:uuid(),entity_type:t,entity_id:id||uuid(),operation:old?'update':'create',expected_revision:old?.rev||0,payload:p,occurred_at:new Date(clock++).toISOString()};await f.w.applyContentEvents([e],f.readContent);return e}
  const enrollment=d=>({program_id:program,trainee_id:f.trainee,mentor_id:f.mentor,manager_id:f.actor,start_on:d,due_on:'2026-02-01',reason:'QA группа'});
  const record=async(save,d,min)=>{const id=(await save('training_enrollment',enrollment(d))).entity_id;await save('training_task_result',{enrollment_id:id,task_id:program+':1',actor_id:f.mentor,held_on:d,result:'completed',minutes:min,evidence:'QA факт задания',enrollment_rev:one(db,'SELECT rev FROM training_enrollment WHERE id=?',[id]).rev});await save('training_enrollment',{command:'finish',actor_id:f.actor,conclusion:'basic',feedback:'QA итог'},id);return id};
  const before=await record(f.save,date,60),after=await record(later,'2026-01-21',40);
  const scope={kind:'program',source_id:program,unit_id:f.unit,before_from:date,before_to:date,after_from:'2026-01-21',after_to:'2026-01-21'},comparison=twiComparison(db,scope,'2026-01-21');
  assert(comparison.comparable);assert.equal(comparison.deltaMinutes,20);assert.equal(comparison.baseline.meanMinutes,60);assert.equal(comparison.result.meanMinutes,40);assert.equal(comparison.before[0].id,before);assert.equal(comparison.after[0].id,after);
  const p={...plan(f,null,taskId),method:'time',plan:timePlan},id=(await later('economic_effect',p)).entity_id,r=()=>one(db,'SELECT * FROM economic_effect WHERE id=?',[id]);
  const basis={command:'twi_basis',scope,comparison,actor_id:f.actor,note:'QA одинаковая программа, сопоставимые условия'};
  await assert.rejects(later('economic_effect',{...basis,comparison:{...comparison,deltaMinutes:99}},id),/сопоставимые/);
  await later('economic_effect',basis,id);const b=twiBasis(db,id);assert(twiBasisCurrent(db,r(),b.id));assert(twiEffectsFor(db,'program',program).some(x=>x.id===id));assert(twiEffectsFor(db,'enrollment',after).some(x=>x.id===id));assert(twiEffectsFor(db,'person',f.trainee).some(x=>x.id===id));assert(employeeRelations(db,f.mentor).effectiveness.some(x=>x.id===id));
  const measure={command:'measure',inputs:{...timePlan,deltaSeconds:1200},measurement:null,source:null,reviewer_id:f.actor,evidence:'QA ставка и объём',actions:effectEvidence(db,r()),twi_basis_id:b.id};
  await assert.rejects(later('economic_effect',{...measure,inputs:{...timePlan,deltaSeconds:999}},id),/зафиксированного сравнения/);
  await later('economic_effect',measure,id);assert(effectCurrent(db,r()));
  const otherTask=await task(f),other=(await later('economic_effect',{...p,action_id:otherTask})).entity_id;await assert.rejects(later('economic_effect',basis,other),/уже учтены/);
  const fact=(await later('economic_fact',{command:'create',effect_id:id,actual_event_id:r().actual_event_id,period_from:date,period_to:'2026-01-21',gross_minor:10000,recurring_minor:0,investment_minor:0,registered_by:f.mentor,evidence:'QA денежный документ'})).entity_id;await later('economic_fact',{command:'confirm',verifier_id:f.actor,note:'QA проверено'},fact);
  assert.equal(effectOverview(db,{day:'2026-01-21'}).currencies[0].net,10000);
  restored=await restore(SQL,await backup(f.w),f.readContent);assert(twiBasisCurrent(restored.working,one(restored.working,'SELECT * FROM economic_effect WHERE id=?',[id]),b.id));
  await later('training_enrollment',enrollment('2026-01-21'));assert(!twiComparison(db,scope,'2026-01-21').comparable);assert(!effectCurrent(db,r()));assert.equal(effectOverview(db,{day:'2026-01-21'}).currencies.length,0);
  assert.equal(one(db,'SELECT state FROM economic_fact WHERE id=?',[fact]).state,'confirmed');
 }finally{restored?.close();f.w.close()}
});

// Keep the browser-facing module in the node regression graph: syntax/import errors must fail npm test.
test('LC6.2 TWI analytics view module loads', async () => {
 const view=await import('../src/modules/training/twi-effectiveness-view.js');
 assert.equal(typeof view.twiAnalyticsView,'function');
 assert.equal(typeof view.twiPerformancePane,'function');
});
