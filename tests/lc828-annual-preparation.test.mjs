import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {uuid} from '../src/core/db.js';
import {setupApproval} from './lc83-approval-fixture.mjs';
import {openSecureQA} from '../server/lc81/store.mjs';
import {copySecureCheckpoint} from '../server/lc81/maintenance.mjs';
import {createSecureQAServer} from '../server/lc81/http.mjs';
const denied=/недоступ|полномоч|область|доступ/i;
const prev=day=>new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
test('LC828 D4.2 twelve-month preparations, offline audits, personnel and concurrent writes',async t=>{
 const x=await setupApproval({annualPreparation:true});t.after(x.cleanup);
 const {store,users,admin,preparations:p,day}=x,manager=users.manager.id,leader=users.leader.id,outside=users.outsideLeader.id;
 assert.equal(p.items.length,12);assert.equal(p.items.filter(q=>q.former).length,6);
 const scope={unit_id:x.unit,from:p.from,to:p.to};
 const checkPreparation=(s,actor,row)=>{
  const d=s.preparationDetail(actor,1,row.id);assert.equal(d.status,row.status);assert.equal(d.category,row.category);assert.equal(d.documents.length,3);assert.equal(d.planned_shifts.length,2);
  assert.equal(d.completed_shifts,row.status==='Комплект завершён'?2:1);
  assert.equal(d.commission_current,row.status==='Комплект завершён');
  assert(d.questions_issued);assert(d.safety_current);
  for(const [kind,id] of [['adaptation',row.adaptation],['safety',row.safety],['internship',row.internship]]){
   const doc=s.enrollmentDetail(actor,1,id);assert.equal(doc.standard_kind,kind);
   assert.equal(doc.state,kind==='safety'||row.intern?'completed':'active');
   if(doc.state==='completed')assert(doc.tasks.every(q=>q.done));
   if(kind==='adaptation'){const shared=doc.tasks.find(q=>q.shared);assert(shared);assert.equal(shared.assignment_id,row.intern)}
  }
  if(row.intern){for(const id of [row.intern,row.mainAssignment]){const tr=s.trainingDetail(actor,1,id);assert.equal(tr.state,'completed');assert.equal(tr.qualification.level,2);assert.equal(tr.practical.negative.length,0);assert.match(tr.admission,/Нет решения|нет текущего решения/i)}}
  const card=s.personCard(actor,1,row.trainee);assert(card.sections.some(v=>v.action==='preparation.read'&&v.items.some(q=>q.id===row.id)));
  const employment=card.sections.find(v=>v.action==='employment.read').items;
  assert(employment.some(q=>q.id===row.employmentId));
  if(row.former)assert(employment.some(q=>q.id===row.former&&q.valid_to===prev(row.day)&&q.unit_id===x.unitB));
  return {id:d.id,status:d.status,commission:d.commission_current,shifts:d.completed_shifts,docs:d.documents};
 };
 const prepSnapshot=p.items.map(row=>checkPreparation(store,manager,row));
 const before=store.centerWorkspace(manager,1,'analytics.read',scope);
 const metrics=Object.fromEntries(before.metrics.map(q=>[q.id,q.value]));
 for(const [id,count] of Object.entries({prep_started:12,prep_completed:8,prep_review:2,training_assigned:20,training_completed:20,practice_count:20})){
  assert.equal(metrics[id],count,id);const evidence=store.metricEvidence(manager,1,'metrics.read',scope,id,0);assert.equal(evidence.value,count,id);assert.equal(evidence.items.filter(q=>q.included).length,count,id);
 }
 assert.throws(()=>store.preparationDetail(outside,1,p.items[0].id),denied);
 assert.throws(()=>store.enrollmentDetail(outside,1,p.items[0].adaptation),denied);
 console.log('LC828_D42_PREPARATION_YEAR_OK',JSON.stringify({months:p.months,employees:12,programs:36,completed:8,review:2,incomplete:2,completed_training:20,prior_transfers:6,metrics}));
 // Build mobile records from the actual exported standalone form config, then
 // import the year on the protected server without a fabricated DB mapping.
 const options=store.mobileOptions(manager,1),records=[];
 assert(options.methods.some(q=>q.id===p.auditMethod));
 for(const row of p.items.filter(q=>q.intern)){
  const a=options.assignments.find(q=>q.id===row.intern);assert(a);
  const html=await store.exportMobile(manager,1,{assignment_id:a.id,assignment_rev:a.rev,method_id:p.auditMethod,confirmed:true});
  assert.match(html.html,/Content-Security-Policy/);
  const marker=')({"database_id":',start=html.html.indexOf(marker)+2,end=html.html.indexOf(',(function assessmentAnalysis',start);assert(start>1&&end>start);
  const {criteria,label,...cfg}=JSON.parse(html.html.slice(start,end));assert.equal(criteria.length,20);
  records.push({...cfg,id:uuid(),observed_on:row.day,responses:criteria.map(q=>({criterion_id:q.id,value:1,note:''})),feedback:'Учебный мобильный аудит '+row.month});
 }
 const packet={type:'lean-l1-mobile-v1',schemaVersion:1,audits:records},preview=store.previewMobile(manager,1,packet).items;
 assert.equal(preview.length,10);assert(preview.every(q=>q.status==='ready'&&q.facts.length));
 const count=store.listResources(manager,'audit.read').length;
 assert.throws(()=>store.receiptMobile(manager,1,packet),/Нет принятых/);
 assert.throws(()=>store.previewMobile(outside,1,packet),denied);
 assert.equal(store.previewMobile(manager,1,{...packet,audits:[{...records[0],database_id:uuid()}]}).items[0].status,'invalid');
 const picks=preview.map(q=>({id:q.id,hash:q.hash,assignment_rev:q.assignment_rev,session_id:q.facts[0].id}));
 const another={...records[0],id:uuid()},bad={...packet,audits:[...records,another]},dup=store.previewMobile(manager,1,bad).items.at(-1);
 await assert.rejects(store.commitMobile(manager,1,{packet:bad,selected:[...picks,{...picks[0],id:another.id,hash:dup.hash}]}),/Конфликт/);
 assert.equal(store.listResources(manager,'audit.read').length,count,'No partial mobile commit');
 assert.deepEqual(await store.commitMobile(manager,1,{packet,selected:picks}),{imported:10});
 const receipt=store.receiptMobile(manager,1,packet);assert.equal(receipt.accepted.length,10);
 assert(store.previewMobile(manager,1,packet).items.every(q=>q.status==='duplicate'));
 assert.equal(store.previewMobile(manager,1,{...packet,audits:[{...records[0],feedback:'Учебная подмена'}]}).items[0].status,'conflict');
 await assert.rejects(store.commitMobile(manager,1,{packet,selected:picks}),/Изменилось/);
 for(const a of receipt.accepted)assert.equal(store.qualityDetail(manager,1,'audit',a.audit_id).stats.yes,20);
 assert.equal(store.metricEvidence(manager,1,'metrics.read',scope,'audit_count',0).value,10);
 console.log('LC828_D42_MOBILE_YEAR_OK',JSON.stringify({imported:10,duplicates:10,rejectedAtomicBatch:true}));
 // Four independent employee accounts, twelve writes in parallel, and CAS
 // conflicts from two browser sessions for the same owner.
 const permissions=['task.read','task.detail','task.implement_own','task.start','plan.read','training.read','training.detail','operation.read'];
 await store.setPolicy(admin.id,{role_id:p.traineeRole,revision:0,permissions});
 const workers=[];
 for(const [i,row] of p.items.slice(0,4).entries()){
  const login='d42-worker-'+i,account=await store.createAccount(admin.id,{person_id:row.trainee,login,password:x.password,generate:false});
  await store.grant(admin.id,{account_id:account.id,assignment_id:row.roleAssignment,scope:{kind:'self'},valid_to:null});
  workers.push({login,id:account.id,row});
 }
 const origin='https://qa.invalid',server=createSecureQAServer({store,origin}),timing=[],statuses={},created=[];
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/lc81/';
  async function login(name){const r=await fetch(url+'login',{method:'POST',headers:{Origin:origin,'X-LC81-Request':'1','Content-Type':'application/json'},body:JSON.stringify({login:name,password:x.password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
  const managerCookie=await login('manager');
  for(const w of workers){w.cookie=await login(w.login);w.secondCookie=await login(w.login)}
  const send=async(cookie,route,body)=>{const start=performance.now(),r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'X-LC81-Request':'1',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)}),data=await r.json();timing.push(performance.now()-start);statuses[r.status]=(statuses[r.status]||0)+1;return {status:r.status,data}};
  const inputs=workers.flatMap(w=>Array.from({length:3},(_,i)=>({w,title:'D4.2 одновременная запись '+w.login+' '+i})));
  const saved=await Promise.all(inputs.map(({w,title})=>send(managerCookie,'tasks/create',{source:null,title,owner_id:w.row.trainee,due_on:day,kind:'corrective',priority:'normal'})));
  for(const [i,r] of saved.entries()){assert.equal(r.status,200,JSON.stringify(r.data));created.push({...inputs[i],id:r.data.id,rev:r.data.rev})}
  assert.equal(new Set(created.map(q=>q.id)).size,12);
  for(const w of workers){
   const f=store.notificationFeed(w.id,1,{limit:50}).items.filter(q=>q.kind==='task_assigned');assert.equal(f.length,3);assert(f.every(q=>q.pending&&created.some(r=>r.w===w&&r.id===q.route.id)));
  }
  // Wrong user cannot read or change another worker's task.
  assert([403,404].includes((await send(workers[1].cookie,'tasks/detail?id='+created[0].id)).status));
  const start=q=>({id:q.id,expected_revision:q.rev,command:'start',fields:{}});
  assert([403,404].includes((await send(workers[1].cookie,'tasks/change',start(created[0]))).status));
  const races=await Promise.all(created.filter((_,i)=>i%3===0).map(async q=>{
   const r=await Promise.all([send(q.w.cookie,'tasks/change',start(q)),send(q.w.secondCookie,'tasks/change',start(q))]);
   assert.deepEqual(r.map(v=>v.status).sort(),[200,409]);return r.find(v=>v.status===200).data;
  }));
  assert.equal(races.length,4);
  const implemented=await Promise.all(created.map(q=>{
   const detail=store.taskDetail(q.w.id,1,q.id);
   return send(q.w.cookie,'tasks/implement',{id:q.id,expected_revision:detail.rev,result:'Учебный результат '+q.title});
  }));
  assert(implemented.every(q=>q.status===200),JSON.stringify(implemented.filter(q=>q.status!==200)));
  for(const q of created){const d=store.taskDetail(manager,1,q.id);assert.equal(d.state,'implemented');assert.equal(d.result,'Учебный результат '+q.title);const f=store.notificationFeed(q.w.id,1,{limit:50}).items.find(n=>n.kind==='task_assigned'&&n.route.id===q.id);assert(f&&!f.pending)}
  timing.sort((a,b)=>a-b);console.log('LC828_D42_CONCURRENT_WRITES_OK',JSON.stringify({independent:12,implemented:12,casConflicts:4,requests:timing.length,statuses,p95_ms:Math.round(timing[Math.ceil(.95*timing.length)-1]*100)/100}));
 }finally{if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.()})}
 // Current HR transfers use the protected transaction, not a SQL update.
 // Source and destination require a single combined authorization.
 const data=store.adminData(admin.id),leaderRole=data.assignments.find(q=>q.id===x.people.leader.assignment).role_id;
 const leaderPermissions=['person.read_basic','person.read_directory','org.read','employment.read','employment.detail','employment.transfer','training.read','training.detail','operation.read','sop.read_effective','sop.read_history'];
 await store.setPolicy(admin.id,{role_id:leaderRole,revision:1,permissions:leaderPermissions});
 for(const name of ['leader','outsideLeader'])await store.grant(admin.id,{account_id:users[name].id,assignment_id:x.people[name].assignment,scope:{kind:'unit_tree',unit_id:x.people[name].unit},valid_to:null});
 const moving=p.items.slice(0,4),moves=[];
 for(const row of moving){
  const before=store.readResource(manager,'employment.read',row.employmentId);assert.equal(before.valid_to,null);
  assert(store.readResource(leader,'person.read_basic',row.trainee));assert.equal(store.readResource(outside,'person.read_basic',row.trainee),null);
  const f={id:before.id,expected_revision:before.rev,unit_id:x.unitB,profession_id:before.profession_id,position_id:before.position_id,shift_id:before.shift_id,valid_from:day};
  await assert.rejects(store.transferEmployment(leader,1,f),denied);
  assert.equal(store.readResource(manager,'employment.read',before.id).valid_to,null);
  moves.push(f);
 }
 const moved=await Promise.all(moves.map(f=>store.transferEmployment(manager,1,f)));
 for(const [i,row] of moving.entries()){
  assert.equal(store.readResource(manager,'employment.read',row.employmentId).valid_to,prev(day));
  assert.equal(store.readResource(manager,'employment.read',moved[i].id).unit_id,x.unitB);
  assert.equal(store.readResource(leader,'person.read_basic',row.trainee),null);
  assert(store.readResource(outside,'person.read_basic',row.trainee));
  assert.throws(()=>store.trainingDetail(outside,1,row.intern),denied,'New unit cannot read historic training outside its scope');
  await assert.rejects(store.transferEmployment(manager,1,moves[i]),denied);
 }
 console.log('LC828_D42_EMPLOYMENT_SCOPE_OK',JSON.stringify({historical:6,live:4,deniedCrossScope:4}));
 const restoredMetrics=store.centerWorkspace(manager,1,'analytics.read',scope).metrics.map(q=>[q.id,q.value,q.denominator,q.availability]);
 await store.close();const target=path.join(x.root,'lc828-restored');await copySecureCheckpoint(x.target,target);
 const restored=await openSecureQA({dataDir:target});try{
  const actor=restored.authenticate('manager',x.password),out=restored.authenticate('outsideLeader',x.password),old=restored.authenticate('leader',x.password);assert(actor&&out&&old);
  assert.deepEqual(restored.centerWorkspace(actor.id,1,'analytics.read',scope).metrics.map(q=>[q.id,q.value,q.denominator,q.availability]),restoredMetrics);
  // All historical bundles retain their status even after the four transfers.
  for(const [i,row] of p.items.entries())assert.deepEqual(checkPreparation(restored,actor.id,row),prepSnapshot[i]);
  assert.deepEqual(restored.receiptMobile(actor.id,1,packet),receipt);
  for(const [i,row] of moving.entries()){
   assert.equal(restored.readResource(actor.id,'employment.read',moved[i].id).unit_id,x.unitB);
   assert.equal(restored.readResource(old.id,'person.read_basic',row.trainee),null);
   assert(restored.readResource(out.id,'person.read_basic',row.trainee));
   assert.throws(()=>restored.trainingDetail(out.id,1,row.intern),denied);
  }
  for(const q of created){assert.equal(restored.taskDetail(actor.id,1,q.id).state,'implemented');const w=restored.authenticate(q.w.login,x.password);assert.equal(restored.taskDetail(w.id,1,q.id).result,'Учебный результат '+q.title)}
 }finally{await restored.close()}
 console.log('LC828_D42_RESTORE_OK');
});
