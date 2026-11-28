import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startSopPublicationScheduler} from '../server/lc81/sop-publication-scheduler.mjs';
import {startNotificationBackground} from '../server/lc81/notification-scheduler.mjs';
import {setupApproval} from './lc83-approval-fixture.mjs';
import {makeSop,SQL} from './lc4-fixture.mjs';
import {uuid,one,rows,tx} from '../src/core/db.js';
import {saveReminderPolicy,discoverBackground,enqueueBackground,readyBackground,drainBackground,checkBackgroundIntegrity} from '../server/lc81/notification-background.mjs';
import {notificationFeed,readAllNotifications} from '../server/lc81/notifications.mjs';
import {compareApprovalSnapshots} from '../server/lc81/sop-approval.mjs';
import {copySecureCheckpoint} from '../server/lc81/maintenance.mjs';
import {openSecureQA} from '../server/lc81/store.mjs';
const status=code=>e=>e?.status===code||e?.statusCode===code;
test('LC83 mandatory independent votes, frozen round history, publication and restored checkpoint',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 const {store,users,detail,old}=x;
 let d=await x.draft('Первая учебная редакция'),id=d.revision_id;
 assert(x.effective().includes(old));assert(!x.effective().includes(id));
 await assert.rejects(x.submit(id),/паспорт|рабочее место/);
 d=await x.passport(d);
 const options=detail('author',id).options;
 for(const [stage,name] of [['safety','safety'],['engineering','engineering'],['twi','twi'],['director','director'],['publish','director']])assert(options[stage].some(p=>p.account_id===users[name].id),stage);
 assert(!options.safety.some(p=>p.account_id===users.outside.id||p.account_id===users.author.id));
 assert(!options.twi.some(p=>p.account_id===users.uncertified.id));
 assert(!options.director.some(p=>p.account_id===users.manager.id));
 await assert.rejects(x.submit(id,'parallel',{twi:'uncertified'}),/Недопустимый участник/);
 await assert.rejects(x.submit(id,'parallel',{safety:'outside'}),/Недопустимый участник/);
 await assert.rejects(x.submit(id,'parallel',{director:'author'}),/Недопустимый участник/);
 const first=await x.submit(id,'sequential');
 assert.deepEqual(detail('safety',id).can_decide,['safety']);
 assert.deepEqual(detail('engineering',id).can_decide,[]);
 assert.deepEqual(detail('director',id).can_decide,[]);
 assert.deepEqual(store.approvalList(users.observer.id,1,{}).items,[]);
 assert.throws(()=>detail('safety2',id),/недоступно/);
 await assert.rejects(store.approvalMaterial(users.safety2.id,1,id,first.id),/недоступны/);
 await assert.rejects(x.change('director',id,'director'),/текущего этапа/);
 await assert.rejects(x.change('manager',id,'safety'),/текущего этапа/);
 await assert.rejects(x.change('engineering',id,'engineering'),/текущего этапа/);
 await x.change('safety',id,'safety');
 await assert.rejects(x.change('engineering',id,'engineering','return',''),/причину/);
 const firstMaterial=await store.approvalMaterial(users.safety.id,1,id,first.id);
 assert(firstMaterial.comparison);assert.equal(firstMaterial.comparison.old_revision_id,old);assert.equal(firstMaterial.comparison.same_work_content,false);assert(firstMaterial.comparison.steps.some(x=>x.fields.includes('Действие')));
 assert((await store.approvalMaterial(users.safety.id,1,id,first.id,1,'previous')).bytes.length>0);
 await assert.rejects(store.approvalMaterial(users.observer.id,1,id,first.id,1,'previous'),/недоступны/);
 assert.equal(firstMaterial.steps[0].action,'Первая учебная редакция');
 const photo=await store.approvalMaterial(users.safety.id,1,id,first.id,1);assert(photo.bytes.length>0);
 await x.change('engineering',id,'engineering','return','Исправить техническое описание');
 assert.equal(detail('author',id).round.state,'returned');
 assert.equal(detail('author',id).round.decisions.length,2);
 d=await x.edit(d,'Вторая учебная редакция');d=await x.passport(d);
 const second=await x.submit(id,'parallel');
 assert.notEqual(first.id,second.id);assert.equal(detail('author',id).round.no,2);
 assert.equal(detail('author',id).round.decisions.length,0);
 const snapshot=await store.approvalMaterial(users.author.id,1,id,first.id);
 assert.equal(snapshot.steps[0].action,firstMaterial.steps[0].action);
 assert.equal(snapshot.comparison.old_sha,firstMaterial.comparison.old_sha);
 assert.notEqual(detail('author',id).round.source_sha256,detail('author',id,first.id).round.source_sha256);
 const stale=x.decision('safety',id,'safety');
 await x.change('engineering',id,'engineering');
 await assert.rejects(store.changeSopApproval(users.safety.id,1,stale),/изменились/);
 await x.change('safety',id,'safety');
 await assert.rejects(x.change('director',id,'director'),/текущего этапа/);
 await x.change('twi',id,'twi');
 assert.match(detail('author',id).status,/ожидает утверждения/);
 await x.change('director',id,'director');
 assert.equal(detail('author',id).round.state,'approved');
 assert(x.effective().includes(old));assert(!x.effective().includes(id));
 await assert.rejects(x.change('director',id,'publish','publish'),/оценка влияния/);
 assert(detail('manager',id).impact.can_review);
 assert(!detail('director',id).impact.can_review);
 assert(detail('manager',id).impact.scope.some(person=>person.basis.some(b=>b.kind==='training'&&b.id===x.assignment)),'Affected roster must include the actual training assignment');
 await assert.rejects(x.impact(id,'editorial'),/Рабочее содержание отличается/);
 const impact=await x.impact(id);assert.equal(impact.decision,'retrain');assert(impact.affected>0);
 assert(x.effective().includes(old));assert(!x.effective().includes(id));
 await x.change('director',id,'publish','publish');
 assert.equal(detail('author',id).round.state,'effective');
 assert(x.effective().includes(id));assert(!x.effective().includes(old));
 assert.equal(detail('author',id).round.decisions.length,5);
 assert.equal(detail('author',id).history.length,2);
 const queue=store.retrainingWorkspace(users.manager.id,1,{type:'all',state:'all',person_id:null,q:'',offset:0});
 assert(Array.isArray(queue.items));
 await assert.rejects(x.change('director',id,'publish','publish'),/текущего этапа/);
 await store.close();
 const backup=path.join(x.root,'lc83-copy');await copySecureCheckpoint(x.target,backup);
 const restored=await openSecureQA({dataDir:backup});try{
  const actor=restored.authenticate('author',x.password);assert(actor);
  const data=restored.approvalDetail(actor.id,1,id);assert.equal(data.round.state,'effective');assert.equal(data.history.length,2);assert(data.impact.record.activated_at);
  assert.equal((await restored.approvalMaterial(actor.id,1,id,first.id)).steps[0].action,'Первая учебная редакция');
 }finally{await restored.close()}
 console.log('LC83_ROUTE_RETURN_HISTORY_PUBLISH_RESTORE_OK');
});
test('LC83 revoked reviewer cannot vote or see assigned snapshot; publication requires current permissions',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 let d=await x.passport(await x.draft()),id=d.revision_id;
 const round=await x.submit(id);await x.change('safety',id,'safety');await x.change('engineering',id,'engineering');await x.change('twi',id,'twi');await x.change('director',id,'director');
 await x.impact(id);
 await x.store.revoke(x.admin.id,x.people.safety.grant.id);
 assert.throws(()=>x.detail('safety',id),/недоступно/);
 await assert.rejects(x.store.approvalMaterial(x.users.safety.id,1,id,round.id),/недоступны/);
 await assert.rejects(x.change('director',id,'publish','publish'),/полномочия изменились/);
 assert(x.effective().includes(x.old));assert(!x.effective().includes(id));
 await x.change('author',id,null,'cancel','Изменился состав согласующих');
 assert.equal(x.detail('author',id).round.state,'returned');
 const next=await x.submit(id,'parallel',{safety:'safety2'});assert.notEqual(round.id,next.id);
 assert.equal(x.detail('author',id).round.decisions.length,0);
 console.log('LC83_REVOKED_SCOPE_FAIL_CLOSED_OK');
});

test('LC83 durable scheduled publication: future, cancellation, restart, exact once',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 const id=(await x.passport(await x.draft('Плановый ввод учебного СОП'))).revision_id;
 await x.submit(id);for(const stage of ['safety','engineering','twi','director'])await x.change(stage,id,stage);
 const schedule=(due_on,name='director')=>{
  const d=x.detail(name,id);
  return x.store.scheduleSopPublication(x.users[name].id,1,{revision_id:id,round_id:d.round.id,expected_revision:d.document_rev,expected_round_revision:d.round.rev,due_on,note:'Учебный план ввода'});
 };
 await assert.rejects(schedule(x.day),/оценка влияния/);
 await x.impact(id);
 await assert.rejects(schedule(x.day,'manager'),/текущего этапа/);
 const tomorrow=new Date(Date.parse(x.day)+86400000).toISOString().slice(0,10);
 const future=await schedule(tomorrow);assert.equal(future.state,'pending');
 assert.equal(x.store.familiarizationList(x.users.author.id,1,{kind:'mine',revision_id:id}).total,0);
 assert.deepEqual(await x.store.runDueSopPublications(),{executed:0,blocked:0,deferred:0});
 assert(x.effective().includes(x.old));assert(!x.effective().includes(id));
 await assert.rejects(x.change('director',id,'publish','publish'),/запланированный ввод/);
 await assert.rejects(schedule(x.day),/запланированный ввод/);
 await assert.rejects(x.impact(id),/Отмените запланированный ввод/);
 const d=x.detail('author',id);
 await x.store.cancelSopPublication(x.users.author.id,1,{revision_id:id,round_id:d.round.id,schedule_id:future.id,expected_revision:d.document_rev,expected_round_revision:d.round.rev,note:'Учебная отмена'});
 assert.equal(x.detail('author',id).publication.record.state,'cancelled');
 const due=await schedule(x.day);assert.equal(due.state,'pending');
 await x.store.close();
 const target=path.join(x.root,'scheduled-copy');await copySecureCheckpoint(x.target,target);
 const restarted=await openSecureQA({dataDir:target});try{
  assert(restarted.listResources(x.users.observer.id,'sop.read_effective').some(r=>r.revision_id===x.old));
  const failures=[],scheduler=startSopPublicationScheduler(restarted,{intervalMs:20,onError:()=>failures.push('tick error')});
  try{
   const deadline=Date.now()+15000;
   while(restarted.approvalDetail(x.users.author.id,1,id).publication.record.state==='pending'&&Date.now()<deadline)await delay(20);
  }finally{await scheduler.stop()}
  assert.deepEqual(failures,[]);
  assert.deepEqual(await restarted.runDueSopPublications(),{executed:0,blocked:0,deferred:0});
  const result=restarted.approvalDetail(x.users.author.id,1,id);
  assert.equal(result.round.state,'effective');assert.equal(result.publication.record.id,due.id);assert.equal(result.publication.record.state,'executed');assert.equal(result.publication.history.length,2);
  assert.equal(result.round.decisions.filter(v=>v.command==='publish').length,1);assert(result.impact.record.activated_at);
  assert.equal(restarted.familiarizationList(x.users.author.id,1,{kind:'mine',revision_id:id}).total,1);
  assert(restarted.listResources(x.users.observer.id,'sop.read_effective').some(r=>r.revision_id===id));
 }finally{await restarted.close()}
 console.log('LC83_SCHEDULE_FUTURE_CANCEL_RESTART_EXACT_ONCE_OK');
});
test('LC83 scheduled publication fails closed when reviewer grant is revoked',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 const id=(await x.passport(await x.draft('Блокировка планового ввода'))).revision_id;
 await x.submit(id);for(const stage of ['safety','engineering','twi','director'])await x.change(stage,id,stage);await x.impact(id);
 const d=x.detail('director',id);
 await x.store.scheduleSopPublication(x.users.director.id,1,{revision_id:id,round_id:d.round.id,expected_revision:d.document_rev,expected_round_revision:d.round.rev,due_on:x.day,note:'Учебный план'});
 await x.store.revoke(x.admin.id,x.people.safety.grant.id);
 assert.deepEqual(await x.store.runDueSopPublications(),{executed:0,blocked:1,deferred:0});
 assert.deepEqual(await x.store.runDueSopPublications(),{executed:0,blocked:0,deferred:0});
 assert.equal(x.detail('author',id).publication.record.state,'blocked');
 assert.equal(x.store.familiarizationList(x.users.author.id,1,{kind:'mine',revision_id:id}).total,0);
 assert.equal(x.detail('author',id).round.state,'approved');assert(x.effective().includes(x.old));assert(!x.effective().includes(id));
 console.log('LC83_SCHEDULE_REVOKED_GRANT_BLOCK_OK');
});

test('LC83 scheduler serializes ticks and drains the in-flight task before shutdown',async()=>{
 let calls=0,release,started;
 const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve),errors=[];
 const scheduler=startSopPublicationScheduler({async runDueSopPublications(){calls++;started();await gate}},{intervalMs:5,onError:()=>errors.push('tick error')});
 try{
  await entered;await delay(25);assert.equal(calls,1);
  let drained=false;const stopped=scheduler.stop().then(()=>{drained=true});
  await delay(15);assert.equal(drained,false);release();await stopped;
  await delay(15);assert.equal(calls,1);assert.deepEqual(errors,[]);
 }finally{release();await scheduler.stop()}
 console.log('LC83_SCHEDULER_SERIAL_DRAIN_OK');
});

test('LC834 personal familiarization is atomic, version-bound and independent of real training',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 const {store,users}=x;
 const d=await x.passport(await x.draft('Адресное ознакомление')),id=d.revision_id;
 const mine=()=>store.familiarizationList(users.author.id,1,{kind:'mine',revision_id:id});
 assert.equal(mine().total,0);
 await x.submit(id);
 for(const stage of ['safety','engineering','twi','director'])await x.change(stage,id,stage);
 await x.impact(id);
 assert.equal(mine().total,0);
 await x.change('director',id,'publish','publish');
 const initial=mine().items[0];assert(initial);assert.equal(mine().total,1);
 assert.equal(initial.state,'pending');assert.equal(initial.due_on,null);assert(initial.can_ack);
 assert.equal(store.familiarizationList(users.observer.id,1,{kind:'visible',revision_id:id}).total,0);
 assert.equal(store.familiarizationList(users.observer.id,1,{kind:'managed',revision_id:id}).total,0);
 const control=()=>store.familiarizationList(users.manager.id,1,{kind:'managed',revision_id:id}).items.find(v=>v.id===initial.id);
 assert(control()?.can_due);
 const ack=(v,override={})=>({id:v.id,expected_revision:v.rev,source_sha256:v.source_sha256,confirmed:true,...override});
 await assert.rejects(store.confirmSopFamiliarization(users.observer.id,1,ack(initial)),/недоступно/);
 await assert.rejects(store.confirmSopFamiliarization(users.author.id,1,ack(initial,{source_sha256:'0'.repeat(64)})),/изменились/);
 await assert.rejects(store.confirmSopFamiliarization(users.author.id,1,ack(initial,{confirmed:false})),/Подтвердите/);
 await assert.rejects(store.setSopFamiliarizationDeadline(users.author.id,1,{id:initial.id,expected_revision:initial.rev,due_on:x.day,note:'Учебный срок'}),/недоступно/);
 await store.setSopFamiliarizationDeadline(users.manager.id,1,{id:initial.id,expected_revision:initial.rev,due_on:x.day,note:'Учебный срок'});
 await assert.rejects(store.confirmSopFamiliarization(users.author.id,1,ack(initial)),/изменились/);
 const due=mine().items[0];assert.equal(due.due_on,x.day);
 await store.confirmSopFamiliarization(users.author.id,1,ack(due));
 const confirmed=mine().items[0];assert.equal(confirmed.state,'confirmed');assert(confirmed.confirmed_at);assert(!confirmed.can_ack);
 await assert.rejects(store.confirmSopFamiliarization(users.author.id,1,ack(due)),/изменились/);
 const row=control();assert.equal(row.state,'confirmed');assert.equal(row.training[0].state,'needs');
 const ctx=row.training[0].create;assert(ctx);assert.equal(ctx.retraining_source_id,x.assignment);
 const options=store.trainingOptions(users.manager.id,1,x.operation);
 const {familiarization_id,operation_id,trainee_id,revision_id,skill_id,scale_id,target_level,retraining_source_id,reason}=ctx;
 const create={familiarization_id,operation_id,trainee_id,revision_id,skill_id,scale_id,target_level,retraining_source_id,reason,authorization_id:options.mentors[0].id,assigned_on:x.day,due_on:new Date(Date.parse(x.day)+86400000).toISOString().slice(0,10),scenario:'changed_operation',variant:'classic',method_config:{followups:2,segments:[],realShow:null,realTry:null,hazardous:false},plan_reviewed:true};
 const assigned=await store.createTraining(users.manager.id,1,create);assert.equal(assigned.state,'planned');assert.equal(control().training[0].assignment_id,assigned.id);assert.equal(control().training[0].linked,true);
 await assert.rejects(store.createTraining(users.manager.id,1,create),/уже назначено/);
 assert.equal(control().training[0].state,'planned');
 const scope={unit_id:'',from:x.day,to:x.day};
 const dashboard=store.centerWorkspace(users.manager.id,1,'center.read',scope);
 const coverage=dashboard.metrics.find(v=>v.id==='lc83_familiarization_coverage');assert(coverage);assert.equal(coverage.value,1);assert.equal(coverage.denominator,1);
 const evidence=store.metricEvidence(users.manager.id,1,'metrics.read',scope,coverage.id,0);assert.equal(evidence.total,1);assert.equal(evidence.items[0].included,true);
 assert(store.libraryCard(users.author.id,1,id).can_familiarization);
 const card=store.personCard(users.manager.id,1,initial.person_id);assert(card.sections.some(s=>s.action==='sop.familiarization'&&s.items.some(v=>v.id===initial.id)));
 await store.close();const backup=path.join(x.root,'lc83-familiarization-copy');await copySecureCheckpoint(x.target,backup);
 const restored=await openSecureQA({dataDir:backup});try{
  const actor=restored.authenticate('author',x.password),m=restored.authenticate('manager',x.password);
  assert.equal(restored.familiarizationList(actor.id,1,{kind:'mine',revision_id:id}).items[0].state,'confirmed');
  assert.equal(restored.familiarizationList(m.id,1,{kind:'managed',revision_id:id}).items[0].training[0].assignment_id,assigned.id);
 }finally{await restored.close()}
 console.log('LC834_PERSONAL_CONFIRM_DEADLINE_TRAINING_METRICS_RESTORE_OK');
});
test('LC834 superseded pending receipt cannot be confirmed and new revision has independent receipt',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 async function publish(action,from){const d=await x.passport(await x.draft(action,from)),id=d.revision_id;await x.submit(id);for(const stage of ['safety','engineering','twi','director'])await x.change(stage,id,stage);await x.impact(id);await x.change('director',id,'publish','publish');return id}
 const first=await publish('Предыдущая адресная редакция',x.old);
 const mine=id=>x.store.familiarizationList(x.users.author.id,1,{kind:'mine',revision_id:id}).items[0];
 const pending=mine(first);assert(pending.can_ack);
 const second=await publish('Следующая адресная редакция',first);
 const old=mine(first),next=mine(second);
 assert.equal(old.state,'obsolete');assert.equal(old.current,false);assert.equal(next.state,'pending');assert.notEqual(old.id,next.id);
 await assert.rejects(x.store.confirmSopFamiliarization(x.users.author.id,1,{id:old.id,expected_revision:old.rev,source_sha256:old.source_sha256,confirmed:true}),/недоступно|изменились/);
 console.log('LC834_SUPERSEDED_RECEIPT_FAIL_CLOSED_OK');
});

test('LC834 final: explicit roster supplements, scoped leaders, personal plan and assistant projection',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 const {store,users}=x,id=(await x.passport(await x.draft('Окончательная проверка ознакомлений'))).revision_id;
 await x.submit(id);for(const stage of ['safety','engineering','twi','director'])await x.change(stage,id,stage);
 await x.impact(id);await x.change('director',id,'publish','publish');
 const list=(name,kind='managed')=>store.familiarizationList(users[name].id,1,{kind,revision_id:id});
 assert.equal(list('manager').total,1);
 assert.equal(list('leader').total,1);assert.equal(list('leader').items[0].can_due,false);assert.equal(list('leader').can_scope,false);
 assert.equal(list('outsideLeader').total,0);
 assert.throws(()=>store.familiarizationScopeOptions(users.leader.id,1,id),/недоступно/);
 const opts=store.familiarizationScopeOptions(users.manager.id,1,id);
 const observer=opts.people.find(p=>p.id===users.observer.person_id),manager=opts.people.find(p=>p.id===users.manager.person_id);
 assert(observer&&!observer.registered&&manager&&!manager.registered);
 const add={revision_id:id,person_id:observer.id,expected_revision:0,skill_id:x.skill,reason:'Ответственный подтвердил дополнительного исполнителя'};
 await assert.rejects(store.changeSopFamiliarizationScope(users.observer.id,1,add),/недоступно/);
 await assert.rejects(store.changeSopFamiliarizationScope(users.leader.id,1,add),/недоступно/);
 await assert.rejects(store.changeSopFamiliarizationScope(users.manager.id,1,{...add,reason:''}),/причину/);
 const added=await store.changeSopFamiliarizationScope(users.manager.id,1,add);assert(added.added);
 await assert.rejects(store.changeSopFamiliarizationScope(users.manager.id,1,add),/изменились/);
 await assert.rejects(store.changeSopFamiliarizationScope(users.manager.id,1,{...add,expected_revision:added.rev}),/уже включён/);
 const own=list('observer','mine').items[0];assert.equal(own.id,added.id);assert(own.can_ack);assert.equal(own.scope_history.length,0);
 const m=list('manager').items.find(v=>v.id===added.id);assert.equal(m.scope_history.length,1);assert.equal(m.training[0].create.skill_id,x.skill);assert.equal(m.training[0].create.scale_id,null);
 assert.equal(list('leader').total,2);assert.equal(list('outsideLeader').total,0);
 const due={id:own.id,expected_revision:own.rev,due_on:x.day,note:'Срок ознакомления'};
 await assert.rejects(store.setSopFamiliarizationDeadline(users.leader.id,1,due),/недоступно/);
 await store.setSopFamiliarizationDeadline(users.manager.id,1,due);
 const ack=list('observer','mine').items[0];await store.confirmSopFamiliarization(users.observer.id,1,{id:ack.id,expected_revision:ack.rev,source_sha256:ack.source_sha256,confirmed:true});
 const managerAdd=await store.changeSopFamiliarizationScope(users.manager.id,1,{...add,person_id:manager.id,skill_id:null,reason:'Дополнительный исполнитель без установленного навыка'});
 const plan={mode:'plan',from:x.day,to:x.day},items=store.calendarWorkspace(users.manager.id,1,plan).items;
 const noDate=items.find(v=>v.key==='familiarization:'+managerAdd.id);assert(noDate&&noDate.pending&&noDate.date===null&&!noDate.overdue);
 assert(!items.some(v=>v.key==='familiarization:'+added.id));
 const calendar=store.calendarWorkspace(users.manager.id,1,{mode:'calendar',from:x.day,to:x.day});assert(!calendar.items.some(v=>v.key==='familiarization:'+managerAdd.id));assert(calendar.items.some(v=>v.key==='familiarization:'+added.id));
 const scope={unit_id:'',from:x.day,to:x.day};
 const coverage=store.centerWorkspace(users.manager.id,1,'analytics.read',scope).metrics.find(m=>m.id==='lc83_familiarization_coverage');assert.equal(coverage.denominator,3);assert.equal(coverage.value,1);
 const local=store.assistantContext(users.manager.id,1,{type:'report',kind:'analytics.read',scope,group:'all'});assert(local.metrics.some(m=>m.id===coverage.id&&m.denominator===3));
 const after=list('manager').items.find(v=>v.id===managerAdd.id);assert.equal(after.training[0].state,'clarify');
 await store.changeSopFamiliarizationScope(users.manager.id,1,{...add,person_id:manager.id,expected_revision:after.rev,reason:'Уточнён необходимый навык'});
 assert.equal(list('manager').items.find(v=>v.id===managerAdd.id).training[0].create.skill_id,x.skill);
 assert.equal(x.detail('author',id).impact.record.affected,1);
 // Transfer the original, still-unconfirmed employee; do not silently
 // carry the old work assignment or allow the old section leader to see it.
 const original=list('manager').items.find(v=>v.person_id===users.author.person_id);
 const emp=store.listResources(users.manager.id,'employment.read').find(v=>v.person_id===users.author.person_id&&v.valid_to===null);
 await store.transferEmployment(users.manager.id,1,{id:emp.id,expected_revision:emp.rev,unit_id:x.unitB,profession_id:emp.profession_id,position_id:emp.position_id,shift_id:emp.shift_id,valid_from:x.day});
 const moved=list('author','mine').items[0];assert.equal(moved.state,'scope_changed');assert.equal(moved.can_ack,false);
 await assert.rejects(store.confirmSopFamiliarization(users.author.id,1,{id:moved.id,expected_revision:moved.rev,source_sha256:moved.source_sha256,confirmed:true}),/изменились/);
 assert(!list('leader').items.some(v=>v.id===original.id));assert.equal(list('outsideLeader').total,0);
 await store.changeSopFamiliarizationScope(users.manager.id,1,{revision_id:id,person_id:users.author.person_id,expected_revision:moved.rev,skill_id:null,reason:'Подтверждена связь с операцией после перемещения'});
 const reconciled=list('author','mine').items[0];assert.equal(reconciled.id,original.id);assert.equal(reconciled.state,'pending');assert(reconciled.can_ack);
 console.log('LC834_FINAL_SCOPE_PLAN_LEADER_ASSISTANT_OK');
});

test('LC835 and LC821: one personal approval plan, original events, scoped reading, exact round and restored inbox',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 const {store,users}=x,id=(await x.passport(await x.draft('Персональные поручения и уведомления'))).revision_id;
 const query={mode:'plan',from:x.day,to:x.day};
 const plan=name=>store.calendarWorkspace(users[name].id,1,query).items.filter(v=>v.route?.type==='sop_approval');
 const feed=(name,filter='all')=>store.notificationFeed(users[name].id,1,{filter});
 const active=(name,stage)=>plan(name).find(v=>v.route.stage===stage&&v.pending);
 await assert.rejects(store.submitSopApproval(users.author.id,1,{...x.route(id),note:'  '}),/резюме/);
 const first=await store.submitSopApproval(users.author.id,1,{...x.route(id,'sequential'),note:'Первое резюме изменений'});
 assert(store.authenticate('safety',x.password).workspace_actions.includes('plan.read'));
 assert.equal(plan('safety').length,1);assert(active('safety','safety'));
 assert.equal(plan('engineering').length,0);assert.equal(feed('engineering').total,0);
 assert.equal(feed('outside').total,0);assert.equal(feed('observer').total,0);
 assert.throws(()=>store.calendarWorkspace(users.safety.id,1,{...query,person_id:users.engineering.person_id}),/недоступен/);
 const n=feed('safety','actions').items[0];assert(n&&n.pending);assert.equal(n.route.round_id,first.id);assert.equal(n.route.id,id);
 assert.equal(n.route.stage,'safety');assert.equal(feed('safety').unread,1);
 await assert.rejects(store.readNotification(users.observer.id,1,{id:n.id}),/недоступно/);
 const read=await store.readNotification(users.safety.id,1,{id:n.id});
 assert(read.read_at);assert.equal(feed('safety').unread,0);
 assert.equal((await store.readNotification(users.safety.id,1,{id:n.id})).read_at,read.read_at);
 assert.equal(feed('safety','actions').total,1);assert(active('safety','safety'));
 assert.equal(x.detail('author',id,first.id).round.note,'Первое резюме изменений');
 const snapshot=feed('safety').snapshot;
 await x.change('safety',id,'safety');
 assert.equal(plan('safety').length,0);assert.equal(feed('safety','actions').total,0);
 assert(active('engineering','engineering'));assert.equal(feed('engineering','actions').total,1);
 await x.change('engineering',id,'engineering','return','Уточнить технологию');
 assert.equal(plan('engineering').length,0);assert(active('author','rework'));
 assert.equal(feed('author','actions').items[0].kind,'returned');
 await store.readAllNotifications(users.safety.id,1,{snapshot});
 assert.equal(feed('safety').unread,1,'return appended after the old snapshot must stay unread');
 assert(x.effective().includes(x.old));assert(!x.effective().includes(id));
 const second=await store.submitSopApproval(users.author.id,1,{...x.route(id,'parallel',{safety:'safety2'}),note:'Второе резюме после возврата'});
 assert.notEqual(second.id,first.id);assert.equal(x.detail('author',id,first.id).round.note,'Первое резюме изменений');
 assert.equal(x.detail('author',id,second.id).round.note,'Второе резюме после возврата');
 assert.deepEqual(x.detail('engineering',id,first.id).can_decide,[]);
 assert.equal(plan('author').filter(v=>v.route.stage==='rework').length,0);
 assert(active('safety2','safety'));assert(active('engineering','engineering'));assert(active('twi','twi'));
 assert.equal(plan('director').length,0);
 await store.revoke(x.admin.id,x.people.safety.grant.id);
 assert.equal(feed('safety').total,0);
 await assert.rejects(store.readNotification(users.safety.id,1,{id:n.id}),/недоступно/);
 await x.change('safety2',id,'safety');await x.change('engineering',id,'engineering');await x.change('twi',id,'twi');
 assert(active('director','director'));assert.equal(feed('director','actions').items[0].route.stage,'director');
 await x.change('director',id,'director');
 assert(active('director','publish'));assert.equal(feed('director','actions').items[0].route.stage,'publish');
 assert.equal(feed('director','actions').items.filter(v=>v.kind==='action_required').length,1);
 await x.impact(id);await x.change('director',id,'publish','publish');
 assert.equal(plan('director').length,0);assert.equal(feed('director','actions').total,0);
 const req=feed('author','actions').items.find(v=>v.kind==='familiarization_required');assert(req&&req.route.id===id);
 const receipt=store.familiarizationList(users.author.id,1,{kind:'mine',revision_id:id}).items[0];
 assert.equal(receipt.state,'pending');
 const oldSnapshot=feed('author').snapshot;
 await store.setSopFamiliarizationDeadline(users.manager.id,1,{id:receipt.id,expected_revision:receipt.rev,due_on:x.day,note:'Срок в приёмке'});
 await store.readAllNotifications(users.author.id,1,{snapshot:oldSnapshot});
 assert.equal(feed('author','unread').items.filter(v=>v.kind==='familiarization_deadline').length,1);
 assert(feed('author','actions').items.some(v=>v.id===req.id));
 const saved=feed('author').items.find(v=>v.id===req.id).read_at;assert(saved);
 const latest=store.familiarizationList(users.author.id,1,{kind:'mine',revision_id:id}).items[0];
 assert.equal(latest.state,'pending');await store.confirmSopFamiliarization(users.author.id,1,{id:latest.id,expected_revision:latest.rev,source_sha256:latest.source_sha256,confirmed:true});
 assert.equal(feed('author','actions').items.filter(v=>v.kind.startsWith('familiarization_')).length,0);
 assert(x.detail('author',id).actual_effective_at);
 await store.close();const backup=path.join(x.root,'lc821-inbox-copy');await copySecureCheckpoint(x.target,backup);
 const restored=await openSecureQA({dataDir:backup});try{
  const actor=restored.authenticate('author',x.password),v=restored.notificationFeed(actor.id,1,{filter:'all'});
  assert.equal(v.items.find(q=>q.id===req.id).read_at,saved);
  assert.equal(v.items.find(q=>q.id===req.id).pending,false);
 }finally{await restored.close()}
 console.log('LC835_LC821_PERSONAL_PLAN_INBOX_READ_SCOPE_RESTORE_OK');
});
test('LC835 conservative comparison recognizes inserted steps and does not equate visual alignment with editorial equivalence',async()=>{
 const src=await makeSop('Подготовка'),original=JSON.parse(src.text);
 const make=items=>{
  const raw=structuredClone(original),projection=structuredClone(src.projection);
  raw.constructor.steps=items.map(([id,action])=>({...structuredClone(original.constructor.steps[0]),id,action}));
  raw.photoAssets=Object.fromEntries(items.map(([id])=>[String(id),structuredClone(original.photoAssets['1'])]));
  projection.steps=items.map(([id,action])=>({...structuredClone(src.projection.steps[0]),source_id:String(id),action}));
  return {raw,projection};
 };
 const old=make([[1,'Подготовка'],[2,'Демонтаж'],[3,'Установка']]),next=make([[1,'Подготовка'],[4,'Проверка безопасности'],[2,'Демонтаж'],[3,'Установка']]);
 const a={revision_id:'old',version_no:1,source:src.source},b={revision_id:'new',version_no:2,source:src.source};
 const cmp=compareApprovalSnapshots(a,old,b,next);
 assert.equal(cmp.same_work_content,false);assert.equal(cmp.comparison,'aligned_conservative');
 assert(cmp.steps.some(v=>v.before_position===null&&v.after_position===2&&v.fields.includes('Добавлен шаг')));
 assert(cmp.steps.some(v=>v.before_position===2&&v.after_position===3&&v.fields.includes('Изменение позиции')));
 assert(!cmp.steps.some(v=>v.fields.includes('Действие')));
 const changed=make([[1,'Подготовка'],[2,'Демонтаж'],[3,'Установка']]);changed.raw.constructor.steps[1].reason='Новое основание';changed.projection.steps[1].reason='Новое основание';
 const diff=compareApprovalSnapshots(a,old,b,changed);
 assert(diff.steps.some(v=>v.before_position===2&&v.after_position===2&&v.fields.includes('Причина')));
 assert.equal(diff.same_work_content,false);
 console.log('LC835_CONSERVATIVE_STEP_ALIGNMENT_OK');
});

test('LC822 persistent reminder jobs: policy, live authorization, deadline replacement, late account and restart',async t=>{
 const x=await setupApproval();t.after(x.cleanup);
 const {store,users,admin}=x;
 const status=()=>store.notificationBackgroundStatus(admin.id,1),feed=name=>store.notificationFeed(users[name].id,1,{}),of=(name,kind)=>feed(name).items.filter(v=>v.kind===kind);
 assert.deepEqual(status().policy,{rev:0,approval:null,familiarization:null,training:null});
 assert.throws(()=>store.notificationBackgroundStatus(users.observer.id,1),/администратора/);
 await assert.rejects(store.setNotificationPolicy(users.observer.id,1,{expected_revision:0,approval:0,familiarization:0,training:0}),/администратора/);
 await assert.rejects(store.setNotificationPolicy(admin.id,1,{expected_revision:0,approval:31,familiarization:0,training:0}),/30 дней/);
 const role=store.adminData(admin.id).assignments.find(a=>a.person_id===users.author.person_id);
 assert(role);
 await store.setPolicy(admin.id,{role_id:role.role_id,revision:0,permissions:['training.read','training.detail','operation.read','plan.read']});
 await store.grant(admin.id,{account_id:users.author.id,assignment_id:role.id,scope:{kind:'self'},valid_to:null});
 const due=day=>store.changeTraining(users.manager.id,1,{id:x.assignment,expected_revision:store.trainingDetail(users.manager.id,1,x.assignment).rev,command:'reschedule',fields:{due_on:day,reason:'Проверка изменения срока'}});
 await due(x.day);
 const id=(await x.passport(await x.draft('Проверка очереди уведомлений'))).revision_id;
 const round=await x.submit(id,'sequential');
 assert.equal((await store.runNotificationBackground()).enqueued,0,'no guessed reminder thresholds');
 const settings=store.notificationPreferences(users.author.id,1);
 assert.equal(settings.internal_inbox,true);assert.equal(settings.push_available,false);
 const prefs={expected_revision:settings.rev,reminders:settings.reminders,push_types:{...settings.push_types,training:true},delivery_window:{days:[1,3],start:'20:00',end:'08:00'}};
 const saved=await store.saveNotificationPreferences(users.author.id,1,prefs);assert.equal(saved.rev,1);assert.deepEqual(saved.delivery_window,prefs.delivery_window);
 await assert.rejects(store.saveNotificationPreferences(users.author.id,1,prefs),/изменились/);
 await assert.rejects(store.saveNotificationPreferences(users.author.id,1,{...prefs,expected_revision:1,delivery_window:{days:[1,1],start:'20:00',end:'08:00'}}),/окно доставки/);
 const policy=await store.setNotificationPolicy(admin.id,1,{expected_revision:0,approval:0,familiarization:0,training:0});assert.equal(policy.rev,1);
 await assert.rejects(store.setNotificationPolicy(admin.id,1,{expected_revision:0,approval:0,familiarization:0,training:0}),/изменилась/);
 const queued=await store.runNotificationBackground({enqueueOnly:true});assert.equal(queued.enqueued,2);assert.equal(status().counts.pending,2);
 const tomorrow=new Date(Date.parse(x.day)+86400000).toISOString().slice(0,10);
 await due(tomorrow);await x.change('safety',id,'safety');
 const first=await store.runNotificationBackground();assert.equal(first.cancelled,2);assert.equal(first.completed,1);
 assert.equal(of('safety','approval_due').length,0);assert.equal(of('author','training_due').length,0);
 const eng=of('engineering','approval_due');assert.equal(eng.length,1);assert.equal(eng[0].route.round_id,round.id);assert.equal(eng[0].route.stage,'engineering');
 await store.readNotification(users.engineering.id,1,{id:eng[0].id});assert.equal(of('engineering','approval_due')[0].pending,true);
 const pol=await store.setNotificationPolicy(admin.id,1,{expected_revision:1,approval:0,familiarization:0,training:1});assert.equal(pol.rev,2);
 assert.equal((await store.runNotificationBackground()).completed,1);
 const training=of('author','training_due')[0];assert(training);assert.equal(training.route.id,x.assignment);assert.equal(training.due_on,tomorrow);
 const snapshot=feed('author').snapshot;assert(snapshot.startsWith('v2.'));
 assert.equal((await store.runNotificationBackground()).completed,0);
 // User opt-out is separate from task state and from mandatory notices.
 const current=store.notificationPreferences(users.author.id,1);
 const off=await store.saveNotificationPreferences(users.author.id,1,{expected_revision:current.rev,reminders:{...current.reminders,training:false},push_types:current.push_types,delivery_window:current.delivery_window});
 assert.equal(of('author','training_due').length,0);
 await store.saveNotificationPreferences(users.author.id,1,{expected_revision:off.rev,reminders:{...off.reminders,training:true},push_types:off.push_types,delivery_window:off.delivery_window});
 assert.equal(of('author','training_due').length,1);assert.equal(of('author','training_due')[0].id,training.id);
 await x.change('engineering',id,'engineering');await x.change('twi',id,'twi');await x.change('director',id,'director');await x.impact(id);await x.change('director',id,'publish','publish');
 assert.equal(of('author','training_due').length,0,'superseded SOP is not reminded as current TWI');
 await store.readAllNotifications(users.author.id,1,{snapshot});
 assert.equal(of('author','familiarization_required').length,1);assert.equal(of('author','familiarization_required')[0].read_at,null);
 const receipt=store.familiarizationList(users.author.id,1,{kind:'mine',revision_id:id}).items[0];
 await store.setSopFamiliarizationDeadline(users.manager.id,1,{id:receipt.id,expected_revision:receipt.rev,due_on:x.day,note:'Срок проверки'});
 assert.equal((await store.runNotificationBackground()).completed,1);
 const reminder=of('author','familiarization_due')[0];assert(reminder);const mixed=feed('author').snapshot;assert(mixed.startsWith('v2.'));
 await store.readAllNotifications(users.author.id,1,{snapshot:mixed});assert.equal(feed('author').unread,0);
 const newest=store.familiarizationList(users.author.id,1,{kind:'mine',revision_id:id}).items[0];
 await store.confirmSopFamiliarization(users.author.id,1,{id:newest.id,expected_revision:newest.rev,source_sha256:newest.source_sha256,confirmed:true});
 assert.equal(of('author','familiarization_due').length,0);
 // An unregistered real employee receives one current requirement after an
 // account appears, including restart between durable enqueue and execution.
 const mentor=store.adminData(admin.id).people.find(p=>p.display_name==='Инструктор Тестовый');assert(mentor);
 assert(!store.adminData(admin.id).accounts.some(a=>a.person_id===mentor.id));
 const extra=await store.changeSopFamiliarizationScope(users.manager.id,1,{revision_id:id,person_id:mentor.id,expected_revision:0,skill_id:null,reason:'Дополнительный исполнитель без аккаунта'});assert(extra.added);
 assert.equal(status().missing_accounts,1);
 const late=await store.createAccount(admin.id,{person_id:mentor.id,login:'late',password:x.password,generate:false});
 assert.equal(store.notificationFeed(late.id,1,{}).total,0);
 assert.equal((await store.runNotificationBackground({enqueueOnly:true})).enqueued,1);assert.equal(status().counts.pending,1);
 await store.close();const backup=path.join(x.root,'lc822-background-copy');await copySecureCheckpoint(x.target,backup);
 const restored=await openSecureQA({dataDir:backup});try{
  const actor=restored.authenticate('late',x.password),adminActor=restored.authenticate('admin',x.password),author=restored.authenticate('author',x.password);
  assert.equal(restored.notificationBackgroundStatus(adminActor.id,1).counts.pending,1);
  assert.equal(restored.notificationPreferences(author.id,1).delivery_window.start,'20:00');
  const done=await restored.runNotificationBackground();assert.equal(done.enqueued,0);assert.equal(done.completed,1);
  const notices=restored.notificationFeed(actor.id,1,{}).items;assert.equal(notices.length,1);assert.equal(notices[0].kind,'familiarization_required');assert.equal(notices[0].route.id,id);
  assert.equal(restored.familiarizationList(actor.id,1,{kind:'mine',revision_id:id}).items[0].state,'pending');
  await restored.runNotificationBackground();assert.equal(restored.notificationFeed(actor.id,1,{}).total,1);
  assert.equal(restored.notificationBackgroundStatus(adminActor.id,1).missing_accounts,0);
 }finally{await restored.close()}
 console.log('LC822_POLICY_LIVE_REMINDERS_CATCHUP_RESTART_OK');
});
test('LC822 scheduler is serial and shutdown drains outstanding work',async()=>{
 let calls=0,start,release;const entered=new Promise(r=>start=r),gate=new Promise(r=>release=r),errors=[];
 const scheduler=startNotificationBackground({async runNotificationBackground(){calls++;start();await gate}},{intervalMs:5,onError:()=>errors.push('tick error')});
 try{await entered;await delay(25);assert.equal(calls,1);let drained=false;const stopped=scheduler.stop().then(()=>{drained=true});await delay(15);assert.equal(drained,false);release();await stopped;await delay(15);assert.equal(calls,1);assert.deepEqual(errors,[])}finally{release();await scheduler.stop()}
 console.log('LC822_SCHEDULER_SERIAL_DRAIN_OK');
});

test('LC822 queue-scale fixture: 500 recipients, 1000 events, bounded retry, exact once and completion-ordered read-all',()=>{
 // This measures the queue and live familiarization projection in an
 // isolated synthetic SQL.js database, NOT real accounts, a VPS benchmark,
 // the full checkpoint writer, or Web Push. Integration permissions are
 // exercised separately in the actual protected-store tests above.
 const db=new SQL.Database(),start=Date.now();
 const clock={zone:'UTC',configured:true,day:'2026-11-28',at:'2026-11-28T10:00:00.000Z'};
 const at=()=>clock.at,people=new Map(),unit=uuid(),admin=uuid(),adminPerson=uuid();
 try{
  db.run("CREATE TABLE lc81_account(id TEXT PRIMARY KEY,person_id TEXT UNIQUE,state TEXT);CREATE TABLE person(id TEXT PRIMARY KEY,archived INTEGER);CREATE TABLE person_assignment(id TEXT PRIMARY KEY,person_id TEXT,unit_id TEXT,valid_from TEXT,valid_to TEXT);CREATE TABLE org_unit(id TEXT PRIMARY KEY);CREATE TABLE operation(id TEXT PRIMARY KEY,unit_id TEXT,archived INTEGER);CREATE TABLE document(id TEXT PRIMARY KEY,operation_id TEXT,archived INTEGER);CREATE TABLE document_revision(id TEXT PRIMARY KEY,document_id TEXT,state TEXT);CREATE TABLE lc83_sop_round(id TEXT PRIMARY KEY,revision_id TEXT,binding_json TEXT,binding_sha256 TEXT,state TEXT);CREATE TABLE lc83_sop_impact_plan(id TEXT PRIMARY KEY,decision TEXT);CREATE TABLE lc83_sop_familiarization_batch(round_id TEXT PRIMARY KEY,plan_id TEXT,source_sha TEXT,registered_at TEXT);CREATE TABLE lc83_sop_familiarization(id TEXT PRIMARY KEY,round_id TEXT,person_id TEXT,employment_id TEXT,unit_id TEXT,person_name TEXT,rev INTEGER,confirmed_at TEXT,confirmed_account TEXT);CREATE TABLE lc83_sop_familiarization_deadline(id TEXT PRIMARY KEY,receipt_id TEXT,rev INTEGER,due_on TEXT,note TEXT,account_id TEXT,recorded_at TEXT,UNIQUE(receipt_id,rev));CREATE TABLE lc83_sop_notice(id TEXT PRIMARY KEY,round_id TEXT,event_key TEXT,recipient_account_id TEXT,kind TEXT,occurred_at TEXT,UNIQUE(event_key,recipient_account_id,kind));CREATE INDEX qa_notice_recipient ON lc83_sop_notice(recipient_account_id)");
  db.run('INSERT INTO org_unit VALUES(?)',[unit]);db.run("INSERT INTO person VALUES(?,0)",[adminPerson]);db.run("INSERT INTO lc81_account VALUES(?,?,'active')",[admin,adminPerson]);
  const makeRound=()=>{
   const op=uuid(),doc=uuid(),revision=uuid(),round=uuid(),plan=uuid(),hash='a'.repeat(64),b=JSON.stringify({code:'QA',title:'Синтетическое СОП',version_no:1});
   db.run('INSERT INTO operation VALUES(?,?,0)',[op,unit]);db.run('INSERT INTO document VALUES(?,?,0)',[doc,op]);db.run("INSERT INTO document_revision VALUES(?,?,'effective')",[revision,doc]);
   db.run("INSERT INTO lc83_sop_round VALUES(?,?,?,?,'effective')",[round,revision,b,hash]);db.run("INSERT INTO lc83_sop_impact_plan VALUES(?,'retrain')",[plan]);db.run('INSERT INTO lc83_sop_familiarization_batch VALUES(?,?,?,?)',[round,plan,hash,at()]);
   return round;
  };
  const makeReceipt=(account,round,alreadyNotified=false)=>{
   const p=people.get(account),id=uuid();db.run('INSERT INTO lc83_sop_familiarization VALUES(?,?,?,?,?,?,2,NULL,NULL)',[id,round,p.person_id,p.employment_id,unit,'QA']);
   db.run('INSERT INTO lc83_sop_familiarization_deadline VALUES(?,?,2,?,?,?,?)',[uuid(),id,clock.day,'QA',admin,at()]);
   if(alreadyNotified)db.run("INSERT INTO lc83_sop_notice VALUES(?,?,?,?,'familiarization_required',?)",[uuid(),round,id,account,at()]);
   return id;
  };
  tx(db,()=>{
   const round=makeRound();
   for(let i=0;i<500;i++){
    const account=uuid(),person_id=uuid(),employment_id=uuid();people.set(account,{person_id,employment_id});
    db.run('INSERT INTO person VALUES(?,0)',[person_id]);db.run("INSERT INTO person_assignment VALUES(?,?,?,'2020-01-01',NULL)",[employment_id,person_id,unit]);db.run("INSERT INTO lc81_account VALUES(?,?,'active')",[account,person_id]);makeReceipt(account,round);
   }
  });
  const accessFor=id=>{const p=people.get(id);return p?{accountId:id,personId:p.person_id,day:clock.day,at:at(),zone:'UTC',clockConfigured:true,employmentFor:who=>who===p.person_id?p.employment_id:null,effective:()=>true,history:()=>true,impactActor:()=>null}:null};
  saveReminderPolicy(db,admin,clock,{expected_revision:0,approval:null,familiarization:0,training:null},()=>{});
  let completed=0,queued=0,retried=0,rounds=0,retryId=null;
  for(let i=0;i<40;i++){
   const candidates=discoverBackground(db,clock,accessFor);
   assert(candidates.length<=64);
   queued+=tx(db,()=>enqueueBackground(db,clock,accessFor,candidates));
   const ids=readyBackground(db,clock);assert(ids.length<=64);
   if(!ids.length&&!candidates.length)break;
   rounds++;
   if(i===0)retryId=ids[0];
   const r=tx(db,()=>drainBackground(db,clock,accessFor,ids,{beforeJob:i===0?j=>{if(j.id===retryId)throw Error('synthetic transient failure')}:null}));
   completed+=r.completed;retried+=r.retried;assert.equal(r.failed,0);assert.equal(r.cancelled,0);
   if(i===0){assert.equal(r.retried,1);assert(!readyBackground(db,clock).includes(retryId));assert.equal(one(db,'SELECT state FROM lc822_notification_job WHERE id=?',[retryId]).state,'retry')}
   clock.at=new Date(Date.parse(clock.at)+60000).toISOString();
  }
  assert.equal(queued,1000);assert.equal(completed,1000);assert.equal(retried,1);
  assert.equal(one(db,'SELECT attempts FROM lc822_notification_job WHERE id=?',[retryId]).attempts,2);
  assert.equal(one(db,'SELECT count(*) n FROM lc83_sop_notice').n,500);
  assert.equal(one(db,"SELECT count(*) n FROM lc822_notification_job WHERE notice_ordinal IS NOT NULL").n,500);
  assert.equal(one(db,"SELECT count(*) n FROM lc822_notification_job WHERE state<>'completed'").n,0);
  assert.deepEqual(discoverBackground(db,clock,accessFor),[]);assert.deepEqual(readyBackground(db,clock),[]);
  checkBackgroundIntegrity(db);
  for(const id of people.keys()){const feed=notificationFeed(db,accessFor(id),{});assert.equal(feed.total,2);assert.equal(feed.unread,2)}
  // Two same-recipient reminders are committed in the reverse enqueue
  // order. The earlier inserted job that completes after the snapshot must
  // not be marked read by an older read-all operation.
  const owner=people.keys().next().value;
  makeReceipt(owner,makeRound(),true);makeReceipt(owner,makeRound(),true);
  assert.equal(tx(db,()=>enqueueBackground(db,clock,accessFor,discoverBackground(db,clock,accessFor))),2);
  const two=rows(db,"SELECT id FROM lc822_notification_job WHERE state='pending' ORDER BY rowid").map(x=>x.id);assert.equal(two.length,2);
  assert.equal(tx(db,()=>drainBackground(db,clock,accessFor,[two[1]])).completed,1);
  const snapshot=notificationFeed(db,accessFor(owner),{}).snapshot;assert(snapshot.startsWith('v2.'));
  assert.equal(tx(db,()=>drainBackground(db,clock,accessFor,[two[0]])).completed,1);
  tx(db,()=>readAllNotifications(db,accessFor(owner),{snapshot}));
  const feed=notificationFeed(db,accessFor(owner),{filter:'unread'});
  assert.equal(feed.total,1);assert.equal(feed.items[0].id,two[0]);checkBackgroundIntegrity(db);
  const reopened=makeReceipt(owner,makeRound(),true),tomorrow='2026-11-29';
  assert.equal(tx(db,()=>enqueueBackground(db,clock,accessFor,discoverBackground(db,clock,accessFor))),1);
  const original=readyBackground(db,clock)[0];
  db.run('UPDATE lc83_sop_familiarization_deadline SET due_on=? WHERE receipt_id=?',[tomorrow,reopened]);
  assert.equal(tx(db,()=>drainBackground(db,clock,accessFor,[original])).cancelled,1);
  db.run('UPDATE lc83_sop_familiarization_deadline SET due_on=? WHERE receipt_id=?',[clock.day,reopened]);
  assert.equal(tx(db,()=>enqueueBackground(db,clock,accessFor,discoverBackground(db,clock,accessFor))),1);
  assert.deepEqual(readyBackground(db,clock),[original]);
  assert.equal(tx(db,()=>drainBackground(db,clock,accessFor,[original])).completed,1);
  // A permanently failing job is not retried indefinitely or exposed as
  // a successful notice. Repeated discovery does not recreate it.
  makeReceipt(owner,makeRound(),true);
  assert.equal(tx(db,()=>enqueueBackground(db,clock,accessFor,discoverBackground(db,clock,accessFor))),1);
  const bad=readyBackground(db,clock)[0];
  for(let i=0;i<4;i++){
   const r=tx(db,()=>drainBackground(db,clock,accessFor,[bad],{beforeJob:()=>{throw Error('synthetic persistent failure')}}));
   assert.equal(r[i===3?'failed':'retried'],1);
   const v=one(db,'SELECT * FROM lc822_notification_job WHERE id=?',[bad]);
   assert.equal(v.attempts,i+1);assert.equal(v.notice_ordinal,null);
   clock.at=v.next_attempt_at;
  }
  assert.equal(one(db,'SELECT state FROM lc822_notification_job WHERE id=?',[bad]).state,'failed');
  assert.deepEqual(discoverBackground(db,clock,accessFor),[]);assert.deepEqual(readyBackground(db,clock),[]);
  checkBackgroundIntegrity(db);
  console.log('LC822_QUEUE_500_RECIPIENTS_1000_EVENTS_OK',JSON.stringify({queued,completed,retried,rounds,elapsed_ms:Date.now()-start,scope:'synthetic queue fixture; not VPS or full checkpoint load'}));
 }finally{db.close()}
});
