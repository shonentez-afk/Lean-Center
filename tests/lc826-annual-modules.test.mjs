import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {setupApproval} from './lc83-approval-fixture.mjs';
import {openSecureQA} from '../server/lc81/store.mjs';
import {copySecureCheckpoint} from '../server/lc81/maintenance.mjs';
import {createSecureQAServer} from '../server/lc81/http.mjs';
import {reviewDue} from '../src/modules/library/sop-review.js';
const denied=/недоступ|полномоч|область|доступ/i;
const numbers=p=>p.metrics.map(m=>[m.id,m.value,m.denominator,m.availability]);
test('LC827 D4 linked twelve-month history, live approvals, scope, analytics, HTTP and restore',async t=>{
 const x=await setupApproval({annualModules:true});t.after(x.cleanup);
 const {store,users,admin,modules:m,day}=x,manager=users.manager.id,worker=users.author.id,other=users.observer.id;
 assert.equal(m.items.length,12);assert.equal(new Set(m.months).size,12);
 const scope={unit_id:x.unit,from:m.from,to:m.to};
 const plan={mode:'plan',from:new Date(Date.parse(day)-365*86400000).toISOString().slice(0,10),to:day};
 const checkYear=async(s,actor)=>{
  const listed=s.listResources(actor,'sop.read_effective');
  for(const row of m.items){
   assert(listed.some(v=>v.revision_id===row.revision));
   const card=s.libraryCard(actor,1,row.revision);
   assert.equal(card.origin.study_id,row.study);assert(card.origin.current);assert.equal(card.review_owner.due_on,row.reviewDue);
   assert.equal(card.review_owner.review_basis,'legacy_approval');
   const frv=await s.libraryDetail(actor,1,'frv.read_summary',row.study);assert.equal(frv.baselineCount,1);assert.equal(frv.improvedCount,1);assert.equal(frv.delta,60);
   const twi=await s.libraryDetail(actor,1,'sop.read_twi',row.revision);assert(twi.exists);assert(!twi.outdated);
   const training=s.trainingDetail(actor,1,row.assignment);assert.equal(training.state,'completed');assert(training.complete);assert.equal(training.qualification.level,row.level);assert.equal(training.practical.id,row.practical);
   const audit=s.qualityDetail(actor,1,'audit',row.audit);assert.equal(audit.questions.length,20);assert.equal(audit.stats.no,1);assert.equal(audit.stats.yes,19);
   assert.equal(s.qualityDetail(actor,1,'self',row.self).id,row.self);
   assert.equal(s.taskDetail(actor,1,row.improvement).state,'verified');
   assert.equal(s.roiDetail(actor,1,row.effect).facts[0].net_minor,33000);
  }
  const overview=s.centerWorkspace(actor,1,'analytics.read',scope),dash=s.centerWorkspace(actor,1,'center.read',scope);
  assert.deepEqual(numbers(overview),numbers(dash));
  assert.deepEqual(overview.cohortMonths,dash.cohortMonths);assert.deepEqual(overview.auditMonths,dash.auditMonths);
  const expected={training_assigned:12,training_completed:12,twi_granted:12,twi_current:12,audit_count:12,self_count:12,practice_count:12,sop_evaluations:12,frv_final:12,effect_facts:12};
  for(const [id,count] of Object.entries(expected)){
   const metric=overview.metrics.find(v=>v.id===id);assert(metric,id);assert.notEqual(metric.availability,'restricted',id);assert.equal(metric.value,count,id);
   const e=s.metricEvidence(actor,1,'metrics.read',scope,id,0);assert.equal(e.value,count,id);assert.equal(e.total,count,id);assert.equal(e.items.filter(v=>v.included).length,count,id);assert(e.items.every(v=>v.route),id);
  }
  assert(overview.currencies?.some(v=>v.currency==='RUB'&&v.net===396000));
  assert.equal(overview.cohortMonths.filter(q=>q.assignments===1&&q.completed===1).length,12);
  assert.equal(overview.auditMonths.filter(q=>q.count===1).length,12);
  const actions=overview.metrics.find(v=>v.id==='actions_verified');assert.equal(actions.value,12);assert.equal(actions.denominator,18);
  const card=s.personCard(actor,1,m.trainee);assert(card.sections.some(v=>v.action==='training.read'&&v.items.some(q=>q.id===m.items.at(-1).assignment)));
  return numbers(overview);
 };
 const initial=await checkYear(store,manager);
 const matrix=await store.saveMatrix(manager,1,{code:'D4-ANNUAL-MATRIX',title:'Годовая матрица D4',unit_id:x.unit,scale_id:m.scale,base_on:day,target_on:day,person_ids:[m.trainee,users.observer.person_id],columns:m.items.map(v=>({skill_id:v.skill,document_id:v.documentId})),previous_id:null,previous_rev:0});
 const checkMatrix=(s,actor)=>{
  const v=s.matrixDetail(actor,1,matrix.id);assert.equal(v.columns.length,12);assert.equal(v.roster.length,2);
  const ix=v.roster.findIndex(r=>r.person_id===m.trainee),ox=v.roster.findIndex(r=>r.person_id===users.observer.person_id);assert(ix>=0&&ox>=0);
  for(const [i,c] of v.columns.entries()){const row=m.items.find(q=>q.skill===c.skill_id);assert(row);assert.equal(v.cells[ix][i].actual,row.level);assert.equal(v.cells[ix][i].target,row.target);assert.equal(v.cells[ox][i].actual,null)}
  return v.cells;
 };
 const cells=checkMatrix(store,manager);
 // A different unit's head must not gain access to training evidence, matrix
 // or annual analytics, even though effective SOPs are enterprise-shared.
 const outsider=users.outsideLeader.id,first=m.items[0];
 assert(store.readResource(outsider,'sop.read_effective',first.revision));
 assert.throws(()=>store.trainingDetail(outsider,1,first.assignment),denied);
 assert.throws(()=>store.matrixDetail(outsider,1,matrix.id),denied);
 assert.throws(()=>store.centerWorkspace(outsider,1,'analytics.read',scope),denied);
 assert.throws(()=>store.qualityDetail(outsider,1,'audit',first.audit),denied);
 const role=store.adminData(admin.id).assignments.find(a=>a.person_id===m.trainee);assert(role);
 const permissions=['task.read','task.detail','task.implement_own','task.start','plan.read','training.read','training.detail','operation.read'];
 await store.setPolicy(admin.id,{role_id:role.role_id,revision:0,permissions});
 let grant=await store.grant(admin.id,{account_id:worker,assignment_id:role.id,scope:{kind:'self'},valid_to:null});
 assert.equal(store.notificationFeed(worker,1,{}).total,0,'migration does not fabricate earlier inbox events');
 const personal=()=>store.calendarWorkspace(worker,1,plan).items;
 for(const row of m.items)assert(personal().some(q=>q.route?.type==='task'&&q.route.id===row.task&&q.pending&&q.overdue));
 const live=await store.createTask(manager,1,{source:null,title:'D4 текущее мероприятие',owner_id:m.trainee,due_on:day,kind:'corrective',priority:'normal'});
 const feed=()=>store.notificationFeed(worker,1,{limit:50}).items;
 const notice=feed().find(n=>n.kind==='task_assigned'&&n.route.id===live.id);assert(notice?.pending);
 assert(!store.notificationFeed(other,1,{limit:50}).items.some(n=>n.route.id===live.id));
 await assert.rejects(store.readNotification(other,1,{id:notice.id}),denied);
 await store.readNotification(worker,1,{id:notice.id});assert(feed().find(n=>n.id===notice.id).pending);
 await store.revoke(admin.id,grant.id);
 assert(!feed().some(n=>n.id===notice.id));assert.throws(()=>store.taskDetail(worker,1,live.id),denied);
 grant=await store.grant(admin.id,{account_id:worker,assignment_id:role.id,scope:{kind:'self'},valid_to:null});
 assert(feed().some(n=>n.id===notice.id&&n.read_at&&n.pending));
 const id=(await x.passport(await x.draft('D4 новая редакция после годовой истории'))).revision_id;
 await x.submit(id);for(const stage of ['safety','engineering','twi','director'])await x.change(stage,id,stage);
 const approved=x.detail('manager',id).round.decisions.find(v=>v.stage==='Директор · утверждение'&&v.command==='approve').at.slice(0,10);
 await x.impact(id);await x.change('director',id,'publish','publish');
 const owner=store.libraryCard(manager,1,id).review_owner;assert.equal(owner.due_on,reviewDue(approved));assert.equal(owner.review_basis,'director_approval');
 assert(!x.effective().includes(x.old));assert(x.effective().includes(id));assert(x.effective().includes(first.revision));
 const receipt=store.familiarizationList(worker,1,{kind:'mine',revision_id:id}).items[0];assert(receipt?.can_ack);
 await store.confirmSopFamiliarization(worker,1,{id:receipt.id,expected_revision:receipt.rev,source_sha256:receipt.source_sha256,confirmed:true});
 assert.equal(store.familiarizationList(worker,1,{kind:'mine',revision_id:id}).items[0].state,'confirmed');
 const finalOverview=numbers(store.centerWorkspace(manager,1,'analytics.read',scope));
 for(const metric of ['training_assigned','training_completed','audit_count','self_count','practice_count','sop_evaluations','frv_final','effect_facts'])assert.deepEqual(finalOverview.find(q=>q[0]===metric),initial.find(q=>q[0]===metric),metric);
 console.log('LC827_D4_DOMAIN_YEAR_OK',JSON.stringify({months:m.months,sops:12,frv:12,twi_completed:12,practical:12,admissions:12,audits:12,self:12,sop_evaluations:12,linked_tasks:24,effect_facts:12,matrix_cells:24,live_approval:id,scope}));
 // A separate mixed-account, mixed-module read profile. Not a VPS benchmark.
 const origin='https://qa.invalid',server=createSecureQAServer({store,origin}),results=[];
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/lc81/';
  async function login(name){const r=await fetch(url+'login',{method:'POST',headers:{Origin:origin,'X-LC81-Request':'1','Content-Type':'application/json'},body:JSON.stringify({login:name,password:x.password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
  const cookies={manager:await login('manager'),author:await login('author'),outsideLeader:await login('outsideLeader')};
  const qs=o=>new URLSearchParams(o).toString();
  const routes=[
   ['manager','center/view?'+qs({kind:'analytics.read',...scope})],
   ['manager','matrix/detail?id='+matrix.id],
   ['manager','library/card?id='+first.revision],
   ['manager','training/detail?id='+first.assignment],
   ['manager','quality/detail?'+qs({kind:'audit',id:first.audit})],
   ['manager','roi/detail?id='+first.effect],
   ['author','calendar/view?'+qs(plan)],
   ['author','notifications?limit=50'],
   ['author','tasks/detail?id='+live.id],
   ['outsideLeader','session']
  ];
  const get=async([account,route])=>{const start=performance.now(),r=await fetch(url+route,{headers:{Cookie:cookies[account]},signal:AbortSignal.timeout(120000)}),body=await r.json();return {status:r.status,ms:performance.now()-start,body}};
  for(const route of routes)assert.equal((await get(route)).status,200,route[1]);
  assert([403,404].includes((await get(['outsideLeader','training/detail?id='+first.assignment])).status));
  for(const concurrent of [1,10,20,40]){
   const timing=[],statuses={},perRoute={},started=performance.now();
   // 1 client visits every route; 10/20/40 clients each visit a distinct
   // route per wave, with at least one request per endpoint.
   const run=async(i)=>{const route=routes[i%routes.length],r=await get(route);assert.equal(r.status,200,route[1]);timing.push(r.ms);statuses[r.status]=(statuses[r.status]||0)+1;(perRoute[route[1].split('?')[0]]??=[]).push(r.ms)};
   if(concurrent===1){for(let i=0;i<routes.length;i++)await run(i)}else await Promise.all(Array.from({length:concurrent},(_,i)=>run(i)));
   const p=(a,n)=>{a.sort((u,v)=>u-v);return Math.round(a[Math.ceil(a.length*n)-1]*100)/100};
   results.push({concurrent,requests:timing.length,statuses,p50_ms:p(timing,.5),p95_ms:p(timing,.95),p99_ms:p(timing,.99),elapsed_ms:Math.round(performance.now()-started),routes:Object.fromEntries(Object.entries(perRoute).map(([k,a])=>[k,{requests:a.length,p95_ms:p(a,.95)}]))});
  }
 }finally{if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.()})}
 console.log('LC827_D4_MIXED_HTTP_LOAD_OK',JSON.stringify(results));
 await store.close();
 const target=path.join(x.root,'lc827-full-year-restored');await copySecureCheckpoint(x.target,target);
 const restored=await openSecureQA({dataDir:target});try{
  const actor=restored.authenticate('manager',x.password),trainee=restored.authenticate('author',x.password);assert(actor&&trainee);
  // Current states may differ from the initial history after live changes;
  // the complete authorized metrics and exact matrix must match the checkpoint.
  assert.deepEqual(numbers(restored.centerWorkspace(actor.id,1,'analytics.read',scope)),finalOverview);
  assert.deepEqual(checkMatrix(restored,actor.id),cells);
  assert.equal(restored.libraryCard(actor.id,1,id).review_owner.due_on,owner.due_on);
  assert.equal(restored.familiarizationList(trainee.id,1,{kind:'mine',revision_id:id}).items[0].state,'confirmed');
  assert(restored.notificationFeed(trainee.id,1,{limit:50}).items.some(q=>q.id===notice.id&&q.read_at&&q.pending));
  for(const row of m.items){assert.equal(restored.trainingDetail(actor.id,1,row.assignment).qualification.level,row.level);assert.equal(restored.libraryCard(actor.id,1,row.revision).origin.study_id,row.study);assert.equal(restored.qualityDetail(actor.id,1,'audit',row.audit).stats.no,1);assert.equal(restored.roiDetail(actor.id,1,row.effect).facts[0].net_minor,33000)}
  const out=restored.authenticate('outsideLeader',x.password);assert.throws(()=>restored.matrixDetail(out.id,1,matrix.id),denied);
 }finally{await restored.close()}
 console.log('LC827_D4_FULL_YEAR_RESTORE_OK');
});
