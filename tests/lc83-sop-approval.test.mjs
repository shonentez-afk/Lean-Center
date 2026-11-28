import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';
import {startSopPublicationScheduler} from '../server/lc81/sop-publication-scheduler.mjs';
import {startNotificationBackground,startPushDelivery} from '../server/lc81/notification-scheduler.mjs';
import {createECDH,createPublicKey,verify,randomBytes} from 'node:crypto';
import {encryptPush,vapidFromPrivate,vapidAuthorization,pushEndpoint,publicIPv4,loadPushConfig} from '../server/lc81/web-push-transport.mjs';
import {deliverySeconds} from '../server/lc81/web-push.mjs';
import {setupApproval} from './lc83-approval-fixture.mjs';
import {makeSop,SQL} from './lc4-fixture.mjs';
import {uuid,one,rows,tx} from '../src/core/db.js';
import {saveReminderPolicy,discoverBackground,enqueueBackground,readyBackground,drainBackground,checkBackgroundIntegrity} from '../server/lc81/notification-background.mjs';
import {notificationFeed,readAllNotifications} from '../server/lc81/notifications.mjs';
import {compareApprovalSnapshots} from '../server/lc81/sop-approval.mjs';
import {copySecureCheckpoint} from '../server/lc81/maintenance.mjs';
import {openSecureQA} from '../server/lc81/store.mjs';
import {createSecureQAServer} from '../server/lc81/http.mjs';
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
 assert.equal(x.store.libraryCard(x.users.author.id,1,id).review_owner.origin,'organizer');
 assert.equal(x.store.libraryCard(x.users.author.id,1,id).review_owner.person_id,x.users.author.person_id);
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
 assert.deepEqual(status().policy,{rev:0,approval:null,familiarization:null,training:null,sop_review:null,audit:null,task:null,credential:null,admission:null});
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
 const snapshot=feed('author').snapshot;assert(snapshot.startsWith('v3.'));
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
 const reminder=of('author','familiarization_due')[0];assert(reminder);const mixed=feed('author').snapshot;assert(/^v[23]\./.test(mixed));
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
  // Recreate the exact earlier kind CHECK with the actual prior rows, then
  // exercise the in-transaction upgrade preserving read and failed history.
  const before=rows(db,'SELECT * FROM lc822_notification_job ORDER BY id'),newSql=one(db,"SELECT sql FROM sqlite_master WHERE name='lc822_notification_job'").sql;
  tx(db,()=>{
   db.run('ALTER TABLE lc822_notification_job RENAME TO qa_lc825_current');
   db.run(newSql.replace(",'sop_review_due','schedule_due','task_due','credential_due','appointment_due','authorization_due','admission_due'",""));
   db.run('INSERT INTO lc822_notification_job SELECT * FROM qa_lc825_current');
   db.run('DROP TABLE qa_lc825_current');
   db.run("UPDATE lc822_notification_policy SET settings_json=? WHERE id=1",[JSON.stringify({approval:null,familiarization:0,training:null})]);
  });
  assert(!one(db,"SELECT sql FROM sqlite_master WHERE name='lc822_notification_job'").sql.includes("'sop_review_due'"));
  checkBackgroundIntegrity(db);
  tx(db,()=>saveReminderPolicy(db,admin,clock,{expected_revision:1,approval:null,familiarization:0,training:null,sop_review:90,audit:null,task:null,credential:null,admission:null},()=>{}));
  assert.deepEqual(rows(db,'SELECT * FROM lc822_notification_job ORDER BY id'),before);
  checkBackgroundIntegrity(db);
  console.log('LC825_LEGACY_QUEUE_SCHEMA_AND_ORDINALS_OK');
  console.log('LC822_QUEUE_500_RECIPIENTS_1000_EVENTS_OK',JSON.stringify({queued,completed,retried,rounds,elapsed_ms:Date.now()-start,scope:'synthetic queue fixture; not VPS or full checkpoint load'}));
 }finally{db.close()}
});

test('LC823 RFC8291 ciphertext vector, VAPID ES256 and strict destination allowlist',()=>{
 // Public IETF test vector (RFC8291 section 5 and appendix A); no real
 // credentials or endpoints. Independent expected ciphertext.
 const ua='BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
 const auth='BTBZMqHH6r4Tts7J_aSIgg',sender=Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw','base64url'),salt=Buffer.from('DGv6ra1nlYgDCS1FRnbzlw','base64url');
 const body=encryptPush({p256dh:ua,auth},'When I grow up, I want to be a watermelon',{salt,senderPrivate:sender});
 const expected='DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
 assert.equal(body.toString('base64url'),expected);
 const cfg=vapidFromPrivate(sender.toString('base64url'),'mailto:qa@example.invalid');
 const endpoint='https://fcm.googleapis.com/fcm/send/qa-token',now=Date.parse('2026-11-28T10:00:00Z');
 const header=vapidAuthorization(cfg,endpoint,now),m=/^vapid t=([^.]+\.[^.]+)\.([^,]+), k=(.+)$/.exec(header);assert(m);assert.equal(m[3],cfg.public_key);
 const payload=JSON.parse(Buffer.from(m[1].split('.')[1],'base64url'));assert.equal(payload.aud,'https://fcm.googleapis.com');assert.equal(payload.exp,now/1000+3600);
 assert(verify('sha256',Buffer.from(m[1]),{key:createPublicKey(cfg.key),dsaEncoding:'ieee-p1363'},Buffer.from(m[2],'base64url')));
 for(const url of ['http://fcm.googleapis.com/fcm/send/qa','https://fcm.googleapis.com.evil.invalid/fcm/send/qa','https://127.0.0.1/fcm/send/qa','https://169.254.169.254/','https://fcm.googleapis.com:444/fcm/send/qa','https://user@fcm.googleapis.com/fcm/send/qa','https://fcm.googleapis.com/fcm/send/qa#secret','https://fcm.googleapis.com/other','https://example.invalid/'])assert.equal(pushEndpoint(url),null,url);
 for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','::ffff:127.0.0.1','192.0.2.1','198.51.100.1','203.0.113.1'])assert.equal(publicIPv4(ip),false);
 assert(publicIPv4('8.8.8.8'));assert(pushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/qa-token'));assert(pushEndpoint('https://wns2.notify.windows.com/channel?token=qa'));
 const env={LC82_PUSH_ENABLED:'1',LC82_PUSH_ORIGIN:'https://qa.invalid',LC82_PUSH_DATA_DIR:'/tmp/qa',LC82_PUSH_INSTANCE:'a'.repeat(64),LC82_VAPID_PRIVATE:sender.toString('base64url'),LC82_VAPID_SUBJECT:'mailto:qa@example.invalid'};
 assert.equal(loadPushConfig({},'https://qa.invalid','/tmp/qa'),null);
 assert.equal(loadPushConfig({...env,LC81_SCHEDULER_DISABLED:'1'},'https://qa.invalid','/tmp/qa'),null);
 assert.throws(()=>loadPushConfig(env,'https://copy.invalid','/tmp/qa'));
 assert.throws(()=>loadPushConfig(env,'https://qa.invalid','/tmp/other'));
 assert.notEqual(loadPushConfig(env,'https://qa.invalid','/tmp/qa').binding,loadPushConfig({...env,LC82_PUSH_INSTANCE:'b'.repeat(64)},'https://qa.invalid','/tmp/qa').binding);
 console.log('LC823_RFC8291_VAPID_DESTINATION_OK');
});
test('LC823 quiet hours use the enterprise clock and an overnight start day',()=>{
 const w={days:[1],start:'20:00',end:'08:00'},clock=at=>({configured:true,at,offset_minutes:0});
 assert.equal(deliverySeconds(w,clock('2026-11-30T19:59:00.000Z')),0);
 assert.equal(deliverySeconds(w,clock('2026-11-30T20:00:00.000Z')),300);
 assert.equal(deliverySeconds(w,clock('2026-12-01T07:59:30.000Z')),30);
 assert.equal(deliverySeconds(w,clock('2026-12-01T08:00:00.000Z')),0);
 assert.equal(deliverySeconds(w,clock('2026-12-01T21:00:00.000Z')),0);
 assert.equal(deliverySeconds(w,{...clock('2026-11-30T13:00:00.000Z'),offset_minutes:420}),300);
 assert.equal(deliverySeconds(null,{...clock('2026-11-30T20:00:00.000Z'),configured:false}),0);
 const dst={configured:true,at:'2026-03-29T00:59:30.000Z',offset_minutes:60,zone:'Europe/Berlin'};
 assert.equal(deliverySeconds({days:[7],start:'01:00',end:'04:00'},dst),29);
 console.log('LC823_QUIET_WINDOW_OVERNIGHT_OK');
});
test('LC823 device consent, live notice delivery, revoke, provider gone, interruption and isolated restore',async t=>{
 const ec=createECDH('prime256v1');ec.generateKeys();
 const privateKey=Buffer.concat([Buffer.alloc(32-ec.getPrivateKey().length),ec.getPrivateKey()]).toString('base64url');
 const cfg={...vapidFromPrivate(privateKey,'mailto:qa@example.invalid'),binding:'d'.repeat(64),origin:'https://qa.invalid'},sent=[];
 let response={status:201};
 const transport=async(config,device,notice_id,opts)=>{sent.push({device:device.id,notice_id,ttl:opts.ttl});return response};
 const x=await setupApproval({pushConfig:cfg,pushSender:transport});t.after(x.cleanup);
 const {store,users,admin}=x;
 const status=()=>store.notificationBackgroundStatus(admin.id,1).push;
 const sub=n=>{const key=createECDH('prime256v1');key.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/qa-'+n,expirationTime:null,keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}};
 const a={label:'Телефон QA',subscription:sub(1),confirmed:true},b={label:'ПК QA',subscription:sub(2),confirmed:true};
 assert.equal(status().enabled,false);assert.equal(store.pushDevices(users.safety.id,1).public_key,null);
 await assert.rejects(store.registerPushDevice(users.safety.id,1,a),/не включён/);
 await assert.rejects(store.setPushPolicy(users.safety.id,1,{expected_revision:0,enabled:true}),/администратора/);
 await store.setPushPolicy(admin.id,1,{expected_revision:0,enabled:true});
 assert.equal(store.pushDevices(users.safety.id,1).public_key,cfg.public_key);
 const prefs=store.notificationPreferences(users.safety.id,1);
 await store.saveNotificationPreferences(users.safety.id,1,{expected_revision:prefs.rev,reminders:prefs.reminders,push_types:{...prefs.push_types,approval:true},delivery_window:null});
 const id=(await x.passport(await x.draft('Web Push QA'))).revision_id;
 const first=await x.submit(id,'sequential');
 const d1=await store.registerPushDevice(users.safety.id,1,a),d2=await store.registerPushDevice(users.safety.id,1,b);
 assert.equal((await store.registerPushDevice(users.safety.id,1,a)).id,d1.id);
 assert.equal(store.pushDevices(users.safety.id,1).devices.length,2);
 assert(!JSON.stringify(store.pushDevices(users.safety.id,1)).includes('fcm.googleapis'));
 await assert.rejects(store.registerPushDevice(users.observer.id,1,a),/другого аккаунта/);
 await assert.rejects(store.revokePushDevice(users.observer.id,1,{id:d1.id}),/недоступно/);
 assert.equal((await store.runPushDelivery()).enqueued,0);assert.equal(sent.length,0);
 await x.change('safety',id,'safety','return','Новый раунд QA');
 const second=await x.submit(id,'sequential');assert.notEqual(first.id,second.id);
 const n=store.notificationFeed(users.safety.id,1,{filter:'actions'}).items[0];assert.equal(n.route.round_id,second.id);
 assert.equal((await store.runPushDelivery({enqueueOnly:true})).enqueued,2);assert.equal(status().counts.pending,2);
 await store.revokePushDevice(users.safety.id,1,{id:d2.id});
 assert.equal((await store.runPushDelivery()).finished,1);assert.equal(sent.length,1);assert.equal(sent[0].device,d1.id);assert.equal(sent[0].notice_id,n.id);assert(sent[0].ttl<=300);
 assert.equal(status().counts.accepted,1);assert.equal(status().counts.cancelled,1);
 assert.equal(store.notificationFeed(users.safety.id,1,{filter:'actions'}).items[0].read_at,null);
 assert.equal((await store.runPushDelivery()).enqueued,0);assert.equal(sent.length,1);
 await assert.rejects(store.readNotification(users.observer.id,1,{id:n.id}),/недоступно/);
 await store.readNotification(users.safety.id,1,{id:n.id});assert.equal(store.notificationFeed(users.safety.id,1,{filter:'actions'}).total,1);
 const d3=await store.registerPushDevice(users.safety.id,1,{label:'Потерянный телефон',subscription:sub(3),confirmed:true});
 await store.queuePushTest(users.safety.id,1,{id:d3.id});
 await assert.rejects(store.queuePushTest(users.safety.id,1,{id:d3.id}),/раза в минуту/);
 response={status:410};await store.runPushDelivery();
 assert.equal(store.pushDevices(users.safety.id,1).devices.find(v=>v.id===d3.id).state,'expired');
 assert.equal(sent.at(-1).notice_id,null);
 const d4=await store.registerPushDevice(users.safety.id,1,{label:'Повтор QA',subscription:sub(4),confirmed:true});
 await store.queuePushTest(users.safety.id,1,{id:d4.id});
 response={status:429,retry_after:120};await store.runPushDelivery();
 assert.equal(status().counts.retry,1);
 assert.equal(store.pushDevices(users.safety.id,1).devices.find(v=>v.id===d4.id).last_test_state,'retry');
 const retryCalls=sent.length;await store.runPushDelivery();assert.equal(sent.length,retryCalls);
 await store.queuePushTest(users.safety.id,1,{id:d1.id});
 assert.equal((await store.runPushDelivery({claimOnly:true})).claimed,1);
 assert.equal(status().counts.sending,1);const calls=sent.length;
 await store.close();const backup=path.join(x.root,'lc823-copy');await copySecureCheckpoint(x.target,backup);
 const isolated=await openSecureQA({dataDir:backup,pushSender:transport});
 try{assert.equal(isolated.notificationBackgroundStatus(admin.id,1).push.enabled,false);assert.equal((await isolated.runPushDelivery()).claimed,0);assert.equal(sent.length,calls)}finally{await isolated.close()}
 const restored=await openSecureQA({dataDir:x.target,pushConfig:cfg,pushSender:transport});
 try{
  await restored.runPushDelivery();
  assert.equal(restored.notificationBackgroundStatus(admin.id,1).push.counts.uncertain,1);assert.equal(sent.length,calls);
  await restored.setPushPolicy(admin.id,1,{expected_revision:1,enabled:false});
  assert.equal(restored.notificationBackgroundStatus(admin.id,1).push.counts.retry,0);
  assert.equal(restored.pushDevices(users.safety.id,1).enabled,false);
  assert.equal(restored.notificationFeed(users.safety.id,1,{filter:'actions'}).total,1);
  assert.equal((await restored.runPushDelivery()).enqueued,0);
 }finally{await restored.close()}
 console.log('LC823_DEVICES_QUEUE_REVOKE_PROVIDER_RESTORE_OK');
});

test('LC823 service worker keeps payload and click generic; scheduler drains on shutdown',async()=>{
 const handlers={},shown=[],windows=[],id=uuid();
 const self={location:{origin:'https://qa.invalid'},addEventListener:(k,fn)=>handlers[k]=fn,registration:{showNotification:async(title,opts)=>shown.push({title,opts})},clients:{openWindow:async url=>windows.push(url)}};
 vm.runInNewContext(await fs.readFile(new URL('../server/lc81/sw.js',import.meta.url),'utf8'),{self,URL});
 const fire=async(k,e)=>{let task;handlers[k]({...e,waitUntil:p=>task=p});await task};
 await fire('push',{data:{json:()=>({v:1,notice:id,title:'PRIVATE NAME',body:'SECRET SOP',url:'https://evil.invalid'})}});
 assert.equal(shown[0].title,'Lean Center');assert.equal(shown[0].opts.body,'У вас новое действие в портале');assert.equal(shown[0].opts.data.notice,id);
 assert(!JSON.stringify(shown).includes('PRIVATE NAME'));assert(!JSON.stringify(shown).includes('SECRET SOP'));
 await fire('push',{data:{json:()=>({v:1,notice:null})}});assert.equal(shown[1].opts.tag,'lc82-test');
 let closed=false;
 await fire('notificationclick',{notification:{data:{notice:id,url:'https://evil.invalid'},close:()=>closed=true}});
 assert(closed);assert.equal(windows[0],'https://qa.invalid/#lc82-notice='+id);
 await fire('notificationclick',{notification:{data:{notice:'https://evil.invalid'},close(){}}});assert.equal(windows[1],'https://qa.invalid/');
 assert(!handlers.fetch);
 let calls=0,start,release;const entered=new Promise(r=>start=r),gate=new Promise(r=>release=r),errors=[];
 const scheduler=startPushDelivery({async runPushDelivery(){calls++;start();await gate}},{intervalMs:5,onError:()=>errors.push('tick error')});
 try{await entered;await delay(25);assert.equal(calls,1);let drained=false;const stopped=scheduler.stop().then(()=>{drained=true});await delay(15);assert.equal(drained,false);release();await stopped;await delay(15);assert.equal(calls,1);assert.deepEqual(errors,[])}finally{release();await scheduler.stop()}
 console.log('LC823_SW_PRIVACY_AND_WORKER_DRAIN_OK');
});

test('LC824 domain events, mixed snapshot, late account, live Push ownership and access revocation',async t=>{
 const ec=createECDH('prime256v1');ec.generateKeys();
 const key=Buffer.concat([Buffer.alloc(32-ec.getPrivateKey().length),ec.getPrivateKey()]).toString('base64url');
 const cfg={...vapidFromPrivate(key,'mailto:qa@example.invalid'),binding:'e'.repeat(64),origin:'https://qa.invalid'},sent=[];
 const transport=async(config,device,notice_id,opts)=>{sent.push({device:device.id,notice_id});return {status:201}};
 const x=await setupApproval({pushConfig:cfg,pushSender:transport});t.after(x.cleanup);
 const {store,users,admin}=x;
 const data=store.adminData(admin.id),role=data.assignments.find(a=>a.person_id===users.author.person_id);assert(role);
 await store.setPolicy(admin.id,{role_id:role.role_id,revision:0,permissions:['task.read','task.detail','task.implement_own','task.start','plan.read','training.read','training.detail','operation.read']});
 const grant=await store.grant(admin.id,{account_id:users.author.id,assignment_id:role.id,scope:{kind:'self'},valid_to:null});
 const make=(title,owner_id=users.author.person_id)=>store.createTask(users.manager.id,1,{source:null,title,owner_id,due_on:x.day,kind:'corrective',priority:'normal'});
 const feed=(u=users.author,filter='all')=>store.notificationFeed(u.id,1,{filter,limit:50});
 const by=(id,u=users.author)=>feed(u).items.find(n=>n.kind==='task_assigned'&&n.route.id===id);
 assert(!feed().items.some(n=>n.kind==='training_assigned'&&n.route.id===x.assignment),'migrated history is not replayed');
 await store.setPushPolicy(admin.id,1,{expected_revision:0,enabled:true});
 const prefs=store.notificationPreferences(users.author.id,1);
 await store.saveNotificationPreferences(users.author.id,1,{expected_revision:prefs.rev,reminders:prefs.reminders,push_types:{...prefs.push_types,task:true},delivery_window:null});
 const earlier=await make('Поручение до подписки'),n1=by(earlier.id);assert(n1?.pending);
 const browser=createECDH('prime256v1');browser.generateKeys();
 const device=await store.registerPushDevice(users.author.id,1,{label:'Тестовый телефон',confirmed:true,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/qa-domain',expirationTime:null,keys:{p256dh:browser.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}});
 assert.equal((await store.runPushDelivery()).enqueued,0);assert.equal(sent.length,0);
 const snapshot=feed().snapshot;assert(snapshot.startsWith('v3.'));
 const later=await make('Поручение после снимка'),n2=by(later.id);assert(n2?.pending);
 await assert.rejects(store.readNotification(users.observer.id,1,{id:n2.id}),/недоступно/);
 await assert.rejects(store.readAllNotifications(users.observer.id,1,{snapshot}),/недоступен/);
 await store.readAllNotifications(users.author.id,1,{snapshot});
 assert(by(earlier.id).read_at);assert.equal(by(later.id).read_at,null);
 assert.equal((await store.runPushDelivery()).finished,1);assert.deepEqual(sent,[{device:device.id,notice_id:n2.id}]);
 assert.equal(by(later.id).read_at,null,'provider acceptance is not a read');
 await store.readNotification(users.author.id,1,{id:n2.id});assert(by(later.id).pending);
 assert(store.calendarWorkspace(users.author.id,1,{mode:'plan',from:x.day,to:x.day}).items.some(v=>v.route?.id===later.id&&v.pending));
 const third=await make('Поручение перед отзывом доступа'),n3=by(third.id);assert(n3);
 assert.equal((await store.runPushDelivery({enqueueOnly:true})).enqueued,1);
 await store.revoke(admin.id,grant.id);
 assert.equal(by(third.id),undefined);await assert.rejects(store.readNotification(users.author.id,1,{id:n3.id}),/недоступно/);
 await store.runPushDelivery();assert.equal(sent.length,1);
 assert.equal(store.notificationBackgroundStatus(admin.id,1).push.counts.cancelled,1);
 const mentor=data.people.find(p=>p.display_name==='Инструктор Тестовый');assert(mentor);
 const lateRole=data.assignments.find(a=>a.person_id===mentor.id);assert(lateRole);
 const lateTask=await make('Открытая задача до регистрации аккаунта',mentor.id);
 const cancelledTask=await make('Отменённая задача до регистрации аккаунта',mentor.id);
 await store.changeTask(users.manager.id,1,{id:cancelledTask.id,expected_revision:cancelledTask.rev,command:'cancel',fields:{reason:'Учебная отмена'}});
 await store.setPolicy(admin.id,{role_id:lateRole.role_id,revision:0,permissions:['task.read','task.detail','plan.read']});
 const late=await store.createAccount(admin.id,{person_id:mentor.id,login:'late-domain',password:x.password,generate:false});
 await store.grant(admin.id,{account_id:late.id,assignment_id:lateRole.id,scope:{kind:'self'},valid_to:null});
 assert(by(lateTask.id,late)?.pending);
 assert(!feed(late).items.some(n=>n.route.id===cancelledTask.id),'late account must not replay cancelled history');
 const saved=by(lateTask.id,late);await store.readNotification(late.id,1,{id:saved.id});
 await store.close();const backup=path.join(x.root,'lc824-copy');await copySecureCheckpoint(x.target,backup);
 const restored=await openSecureQA({dataDir:backup});try{
  const actor=restored.authenticate('late-domain',x.password),n=restored.notificationFeed(actor.id,1,{filter:'actions'}).items.find(n=>n.id===saved.id);
  assert(n?.read_at&&n.pending);
  assert.equal(restored.notificationBackgroundStatus(admin.id,1).push.enabled,false);
 }finally{await restored.close()}
 console.log('LC824_DOMAIN_MIXED_SNAPSHOT_LATE_ACCOUNT_PUSH_REVOKE_RESTORE_OK');
});

test('LC824 twelve-month native task history, mixed authenticated HTTP load and checkpoint restoration',async t=>{
 // Full protected store + real loopback HTTP, with a one-year synthetic
 // action history. This does NOT claim a full-year factory-wide dataset,
 // physical VPS performance, provider delivery or manually accepted UAT.
 const x=await setupApproval({annualHistory:true});t.after(x.cleanup);
 const {store,admin,users,history}=x;
 assert.equal(history.months.length,12);assert.equal(history.tasks,600);assert.equal(history.events,1200);
 const role=store.adminData(admin.id).assignments.find(a=>a.person_id===users.author.person_id);assert(role);
 await store.setPolicy(admin.id,{role_id:role.role_id,revision:0,permissions:['task.read','task.detail','task.implement_own','task.start','plan.read']});
 await store.grant(admin.id,{account_id:users.author.id,assignment_id:role.id,scope:{kind:'self'},valid_to:null});
 const from=history.months[0],to=x.day,plan={mode:'plan',from,to};
 // The interval is at most 366 days including this partial month. Start
 // on today's calendar date one year earlier for the current plan; older
 // completed history remains visible through the task registry.
 const boundary=new Date(Date.parse(to)-365*86400000).toISOString().slice(0,10);plan.from=boundary;
 const old=store.listResources(users.author.id,'task.read').filter(r=>r.title.startsWith('Год QA '));
 assert.equal(old.length,history.perAuthor);
 assert.equal(store.notificationFeed(users.author.id,1,{}).total,0);
 const start=performance.now(),created=[];
 for(let i=0;i<24;i++)created.push(await store.createTask(users.manager.id,1,{source:null,title:'Новая задача годовой базы '+i,owner_id:users.author.person_id,due_on:to,kind:'corrective',priority:'normal'}));
 const writes_ms=Math.round(performance.now()-start);
 assert.equal(store.notificationFeed(users.author.id,1,{limit:50}).total,24);
 const notice=store.notificationFeed(users.author.id,1,{limit:50}).items[0],target=created[0].id;
 const origin='https://qa.invalid',server=createSecureQAServer({store,origin});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const post=async(route,body,cookie=null)=>{
   const r=await fetch(url+'/api/lc81/'+route,{method:'POST',headers:{Origin:origin,'X-LC81-Request':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
   return {status:r.status,headers:r.headers,data:await r.json()};
  };
  const login=async name=>{const r=await post('login',{login:name,password:x.password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
  const cookie=await login('author'),other=await login('observer');
  const get=async(route,c=cookie)=>{const start=performance.now(),r=await fetch(url+'/api/lc81/'+route,{headers:{Cookie:c},signal:AbortSignal.timeout(60000)});return {status:r.status,retry:r.headers.get('retry-after'),data:await r.json(),ms:performance.now()-start}};
  assert.equal((await get('notifications?limit=50')).data.total,24);
  assert.equal((await get('notifications?limit=50',other)).data.total,0);
  assert.equal((await post('notifications/read',{id:notice.id},other)).status,404);
  assert.equal((await post('notifications/read',{id:notice.id},cookie)).status,200);
  assert.equal((await get('tasks/detail?id='+target)).data.id,target);
  const routes=['notifications?limit=30','calendar/view?'+new URLSearchParams(plan),'tasks/detail?id='+target,'session'];
  const results=[];
  for(const concurrent of [1,10,20,40]){
   const timing=[],statuses={},perRoute=Object.fromEntries(routes.map(r=>[r,0])),started=performance.now();
   await Promise.all(Array.from({length:concurrent},async(_,c)=>{
    for(let i=0;i<4;i++){
     const route=routes[(c+i)%routes.length],r=await get(route);timing.push(r.ms);statuses[r.status]=(statuses[r.status]||0)+1;
     assert([200,429].includes(r.status));if(r.status===429)assert(Number(r.retry)>0);else{perRoute[route]++;if(route.startsWith('notifications'))assert.equal(r.data.total,24)}
    }
   }));
   assert.equal(timing.length,concurrent*4);assert(Object.values(perRoute).every(n=>n>0));
   timing.sort((a,b)=>a-b);const q=n=>Math.round(timing[Math.ceil(timing.length*n)-1]*100)/100;
   results.push({concurrent,requests:timing.length,statuses,p50_ms:q(.5),p95_ms:q(.95),p99_ms:q(.99),elapsed_ms:Math.round(performance.now()-started)});
  }
  console.log('LC824_YEAR_HISTORY_HTTP_LOAD_OK',JSON.stringify({months:history.months,legacy_tasks:history.tasks,legacy_task_events:history.events,owner_tasks:history.perAuthor,new_tasks:24,writes_ms,results}));
 }finally{if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.()})}
 await store.close();const backup=path.join(x.root,'lc824-annual-copy');await copySecureCheckpoint(x.target,backup);
 const restored=await openSecureQA({dataDir:backup});try{
  const actor=restored.authenticate('author',x.password),feed=restored.notificationFeed(actor.id,1,{limit:50});
  assert.equal(feed.total,24);assert.equal(feed.unread,23);assert(feed.items.find(n=>n.id===notice.id).pending);
  assert.equal(restored.listResources(actor.id,'task.read').filter(r=>r.title.startsWith('Год QA ')).length,history.perAuthor);
 }finally{await restored.close()}
 console.log('LC824_YEAR_HISTORY_RESTORE_OK');
});

test('LC825 actualization ownership, reminder until effective revision, task deadline, push and restore',async t=>{
 const ec=createECDH('prime256v1');ec.generateKeys();const key=Buffer.concat([Buffer.alloc(32-ec.getPrivateKey().length),ec.getPrivateKey()]).toString('base64url');
 const cfg={...vapidFromPrivate(key,'mailto:qa@example.invalid'),binding:'f'.repeat(64),origin:'https://qa.invalid'},sent=[];
 const x=await setupApproval({pushConfig:cfg,pushSender:async(config,device,notice_id)=>{sent.push(notice_id);return {status:201}}});t.after(x.cleanup);
 const {store,users,admin,old,day}=x,until=new Date(Date.parse(day)+90*86400000).toISOString().slice(0,10);
 const feed=(u,kind,id)=>store.notificationFeed(u.id,1,{filter:'actions',limit:50}).items.find(n=>n.kind===kind&&n.route.id===id);
 const plan=u=>store.calendarWorkspace(u.id,1,{mode:'plan',from:day,to:until}).items;
 const owner=(u,id=old)=>store.libraryCard(u.id,1,id).review_owner;
 const assign=(u,person,rev,id=old)=>store.assignSopReviewOwner(u.id,1,{revision_id:id,expected_revision:rev,person_id:person,note:'Учебное назначение ответственного'});
 const settings={approval:null,familiarization:null,training:null,sop_review:90,audit:null,task:0,credential:null,admission:null};
 assert.equal(owner(users.manager).assigned,false,'unattributed legacy SOP cannot silently gain a recipient');
 assert.equal(store.notificationBackgroundStatus(admin.id,1).sop_review.unassigned,1);
 assert.equal(owner(users.manager).can_assign,true);
 await assert.rejects(assign(users.observer,users.observer.person_id,0),/недоступно/);
 await assign(users.manager,users.author.person_id,0);
 assert.equal(owner(users.author).person_id,users.author.person_id);
 assert.equal(owner(users.manager).rev,1);
 await assert.rejects(assign(users.manager,users.observer.person_id,0),/изменён/);
 assert.equal(store.notificationBackgroundStatus(admin.id,1).sop_review.unassigned,0);
 await store.setPushPolicy(admin.id,1,{expected_revision:0,enabled:true});
 const ap=store.notificationPreferences(users.author.id,1);
 await store.saveNotificationPreferences(users.author.id,1,{expected_revision:ap.rev,reminders:ap.reminders,push_types:{...ap.push_types,sop_review:true},delivery_window:null});
 const browser=createECDH('prime256v1');browser.generateKeys();
 await store.registerPushDevice(users.author.id,1,{label:'Учебный телефон',confirmed:true,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/qa-review',expirationTime:null,keys:{p256dh:browser.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}});
 await store.setNotificationPolicy(admin.id,1,{expected_revision:0,...settings});
 // For this fixture the legacy passport is 2026-01-20, review 2027-01-20.
 // The real current CI date is used; it may already be overdue in later runs.
 assert(owner(users.author).due_on<=until);
 const first=await store.runNotificationBackground();assert.equal(first.completed,1);
 const n=feed(users.author,'sop_review_due',old);assert(n?.pending);assert.equal(n.due_on,owner(users.author).due_on);assert.equal(n.category,'sop_review');
 assert(plan(users.author).some(p=>p.route?.id===old&&p.type==='Актуализация СОП'));
 assert.equal(feed(users.observer,'sop_review_due',old),undefined);
 assert.equal((await store.runPushDelivery()).finished,1);assert.deepEqual(sent,[n.id]);assert.equal(feed(users.author,'sop_review_due',old).read_at,null);
 await store.readNotification(users.author.id,1,{id:n.id});assert(feed(users.author,'sop_review_due',old).pending);
 assert.equal((await store.runNotificationBackground()).completed,0);
 // Reassignment retains the old job in history but removes its live route.
 await assign(users.manager,users.observer.person_id,1);
 assert.equal(feed(users.author,'sop_review_due',old),undefined);
 assert.equal((await store.runNotificationBackground()).completed,1);
 const n2=feed(users.observer,'sop_review_due',old);assert(n2?.pending);assert.notEqual(n.id,n2.id);
 assert(plan(users.observer).some(p=>p.route?.id===old));
 const prefs=store.notificationPreferences(users.observer.id,1);
 const saved=await store.saveNotificationPreferences(users.observer.id,1,{expected_revision:prefs.rev,reminders:{...prefs.reminders,sop_review:false},push_types:prefs.push_types,delivery_window:null});
 assert.equal(feed(users.observer,'sop_review_due',old),undefined);
 assert(plan(users.observer).some(p=>p.route?.id===old),'personal plan independent of optional reminders');
 await store.saveNotificationPreferences(users.observer.id,1,{expected_revision:saved.rev,reminders:{...saved.reminders,sop_review:true},push_types:saved.push_types,delivery_window:null});
 assert.equal(feed(users.observer,'sop_review_due',old).id,n2.id);
 const id=(await x.passport(await x.draft('Учебная актуализация СОП'))).revision_id;
 assert(feed(users.observer,'sop_review_due',old)?.pending,'a draft cannot close effective revision deadline');
 await x.submit(id);for(const stage of ['safety','engineering','twi','director'])await x.change(stage,id,stage);
 await x.impact(id);assert(feed(users.observer,'sop_review_due',old)?.pending);
 await x.change('director',id,'publish','publish');
 assert.equal(feed(users.observer,'sop_review_due',old),undefined);
 assert(!plan(users.observer).some(p=>p.route?.id===old));
 assert.equal(owner(users.observer,id).person_id,users.observer.person_id,'explicit document responsibility survives new revision');
 assert.equal(owner(users.observer,id).rev,2);assert(owner(users.observer,id).due_on>until);
 assert.equal((await store.runNotificationBackground()).completed,0);
 // Task deadline uses existing native state; optional reminder is separate
 // from the mandatory D1 event, and both disappear from actionable work.
 const role=store.adminData(admin.id).assignments.find(a=>a.person_id===users.author.person_id);
 await store.setPolicy(admin.id,{role_id:role.role_id,revision:0,permissions:['task.read','task.detail','task.implement_own','task.start','plan.read']});
 await store.grant(admin.id,{account_id:users.author.id,assignment_id:role.id,scope:{kind:'self'},valid_to:null});
 const task=await store.createTask(users.manager.id,1,{source:null,title:'Контрольный срок мероприятия',owner_id:users.author.person_id,due_on:day,kind:'corrective',priority:'normal'});
 assert.equal((await store.runNotificationBackground()).completed,1);
 const due=feed(users.author,'task_due',task.id);assert(due?.pending);
 await store.readNotification(users.author.id,1,{id:due.id});assert(feed(users.author,'task_due',task.id).pending);
 await store.implementOwnTask(users.author.id,1,{id:task.id,expected_revision:task.rev,result:'Учебное выполнение'});
 assert.equal(feed(users.author,'task_due',task.id),undefined);
 // Legacy clients can still change their original 3 policies without
 // overwriting the new categories. The queue retains old IDs and receipts.
 const policy=await store.setNotificationPolicy(admin.id,1,{expected_revision:1,approval:2,familiarization:null,training:null});
 assert.equal(policy.sop_review,90);assert.equal(policy.task,0);
 await store.close();const backup=path.join(x.root,'lc825-review-owner-copy');await copySecureCheckpoint(x.target,backup);
 const restored=await openSecureQA({dataDir:backup});try{
  const actor=restored.authenticate('observer',x.password),m=restored.authenticate('manager',x.password);
  assert.equal(restored.libraryCard(actor.id,1,id).review_owner.person_id,actor.person_id??users.observer.person_id);
  assert.equal(restored.libraryCard(m.id,1,id).review_owner.rev,2);
  assert.equal(restored.notificationBackgroundStatus(admin.id,1).policy.sop_review,90);
  assert(!restored.notificationFeed(actor.id,1,{filter:'actions'}).items.some(n=>n.kind==='sop_review_due'&&n.route.id===old));
 }finally{await restored.close()}
 console.log('LC825_SOP_OWNER_REASSIGN_READ_DRAFT_PUBLISH_TASK_RESTORE_OK');
});
