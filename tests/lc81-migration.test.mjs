import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {fixture,SQL,makeSop} from './lc4-fixture.mjs';
import {prepareSnapshot,readSnapshot,openDb,one,rows,uuid,meta} from '../src/core/db.js';
import {openPilot,copyPilotCheckpoint,PILOT_STATE} from '../server/lc74-store.mjs';
import {openSecureQA} from '../server/lc81/store.mjs';
import {migratePilotCopy,copySecureCheckpoint} from '../server/lc81/maintenance.mjs';
import {READ_ACTIONS,PERMISSIONS} from '../server/lc81/access-contract.mjs';
import {readManagerProjection} from '../server/lc81/read-policy.mjs';
const password=()=>randomBytes(24).toString('base64url');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function synthetic(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-migrate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=await fixture();t.after(()=>f.w.close());const w=f.w;
 const site=w.edit('org_unit',null,{code:'QA-SITE',name:'Учебное предприятие',kind:'Предприятие',parent_id:null});
 w.edit('org_unit',f.unit,{code:'QA',name:'Учебный участок',kind:'Участок',parent_id:site});
 const unitB=w.edit('org_unit',null,{code:'QA-B',name:'Учебный участок Б',kind:'Участок',parent_id:site});
 const personB=w.edit('person',null,{employee_code:'QA-B',display_name:'Учебный Б'});
 w.edit('person_assignment',null,{person_id:personB,unit_id:unitB,profession_id:null,position_id:null,shift_id:null,shift_code:null,valid_from:'2020-01-01',valid_to:null});
 const adminRole=w.edit('business_role',null,{code:'EXISTING-ADMIN',name:'Администратор'}),managerRole=w.edit('business_role',null,{code:'EXISTING-MANAGER',name:'Управляющий центром TWI'});
 const managerAssignment=w.edit('role_assignment',null,{person_id:f.actor,role_id:managerRole,valid_from:'2020-01-01',valid_to:null});
 const workerRole=one(w.working,"SELECT id FROM business_role WHERE code='TRAINEE'").id,workerAssignment=one(w.working,'SELECT id FROM role_assignment WHERE person_id=? AND role_id=?',[f.trainee,workerRole]).id;
 const assignment=await f.addAssignment();
 const task=async owner=>(await f.save('action_item',{response_id:null,title:'Учебное мероприятие',owner_id:owner,subject_id:null,due_on:'2027-01-31',kind:'corrective',priority:'normal'})).entity_id;
 const ownTask=await task(f.trainee),otherTask=await task(personB);
 const revision=await f.revise();
 await w.acceptOwn(f.readContent);
 const snapshot=await prepareSnapshot(w);
 const source=path.join(root,'legacy-copy'),target=path.join(root,'secure-copy');
 await copyPilotCheckpoint({SQL,snapshot,readSource:f.readContent,target:source});
 const sourceHash=sha(await fs.readFile(path.join(source,PILOT_STATE)));
 return {root,source,target,sourceHash,snapshot,site,unitB,personB,adminRole,managerRole,managerAssignment,workerRole,workerAssignment,assignment,ownTask,otherTask,revision,f};
}
test('migration keeps all existing v17 records and referenced sources, reuses role IDs and copies authenticated state',async t=>{
 const x=await synthetic(t),pass=password();
 const mapping={source:x.source,target:x.target,siteId:x.site,adminRoleId:x.adminRole,managerRoleId:x.managerRole,password:pass};
 await assert.rejects(migratePilotCopy({...mapping,target:x.source}));
 await assert.rejects(migratePilotCopy({...mapping,target:path.join(x.source,'nested')}));
 await assert.rejects(migratePilotCopy({...mapping,target:path.join(x.root,'bad-role'),adminRoleId:null}));
 const result=await migratePilotCopy(mapping);
 assert.equal(result.source_sha256,x.snapshot.manifest.snapshot_sha256);
 assert.equal(sha(await fs.readFile(path.join(x.source,PILOT_STATE))),x.sourceHash);
 const legacy=await readSnapshot(SQL,x.snapshot.manifest,x.snapshot.bytes);
 const checkpoint=await fs.readFile(path.join(x.target,'secure.lc81'));
 const secured=openDb(SQL,new Uint8Array(checkpoint.subarray('LC81QA1\n'.length+65)),{upgrade:false});
 try{
  for(const {name} of rows(legacy,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")){
   assert.match(name,/^[a-z0-9_]+$/);
   const canonical=db=>rows(db,'SELECT * FROM '+name).map(v=>JSON.stringify(v)).sort();
   assert.deepEqual(canonical(secured),canonical(legacy),'domain table '+name);
  }
  assert.equal(meta(secured,'database_id'),meta(legacy,'database_id'));
  assert.equal(one(secured,"SELECT count(*) n FROM lc81_account").n,1);
  assert.equal(one(secured,"SELECT count(*) n FROM lc81_grant").n,0);
 }finally{legacy.close();secured.close()}
 for(const [hash,src] of x.f.sources){assert.equal(await fs.readFile(path.join(x.target,'documents',hash+'.json'),'utf8'),src.text)}
 let store=await openSecureQA({dataDir:x.target});
 let manager,worker,workerPass=password(),savedDraft,savedRequest,fromFrv;
 try{
  const admin=store.authenticate('admin',pass);assert(admin?.admin);
  const d=store.adminData(admin.id);assert.deepEqual(d.protectedRoles,[x.adminRole,x.managerRole]);assert.equal(d.site,x.site);
  assert.equal(d.roles.filter(r=>r.name==='Управляющий центром TWI').length,1);
  // Exercise every projection against the actual migrated schema, without
  // assuming that every register already contains records.
  for(const action of READ_ACTIONS)assert(Array.isArray(store.listResources(admin.id,action)),action);
  const revisions=store.listResources(admin.id,'sop.read_history');assert(revisions.length>=2);
  assert.equal(store.listResources(admin.id,'sop.read_effective').length,1);
  assert.equal(store.listResources(admin.id,'sop.read_steps')[0].steps[0].action_text,'Новая учебная редакция');
  assert.equal(store.listResources(admin.id,'credential.read')[0].id,x.f.certificate);
  assert.equal(store.listResources(admin.id,'appointment.read')[0].id,x.f.appointment);
  manager=await store.createAccount(admin.id,{person_id:x.f.actor,login:'manager',password:password(),generate:false});
  await store.grant(admin.id,{account_id:manager.id,assignment_id:x.managerAssignment,scope:{kind:'unit_tree',unit_id:x.site},valid_to:null});
  assert.equal(store.listResources(manager.id,'person.read_basic').length,5);
  assert.equal(store.listResources(manager.id,'sop.read_history').length,revisions.length);
  assert.throws(()=>store.adminData(manager.id),/администратора/);
  const ms=store.session(manager.id,1);assert(ms);
  assert(ms.permissions.includes('person.create'));
  const command=(type,operation,id,expected_revision,fields)=>({type,operation,id,expected_revision,fields});
  const person=await store.changeDirectory(manager.id,1,command('person','create',null,0,{employee_code:'LC81-NEW',display_name:'Новый учебный сотрудник',unit_id:x.unitB}));
  assert.equal(store.readResource(manager.id,'person.read_directory',person.id).unit,'Учебный участок Б');
  assert.equal(store.readResource(manager.id,'person.read_directory',person.id).can_update,true);
  const update=await store.changeDirectory(manager.id,1,command('person','update',person.id,person.rev,{employee_code:'LC81-NEW',display_name:'Изменённый учебный сотрудник'}));
  assert.equal(update.rev,person.rev+1);
  await assert.rejects(store.changeDirectory(manager.id,1,command('person','update',person.id,person.rev,{employee_code:'LC81-NEW',display_name:'Устаревшая версия'})),/изменилась/);
  assert.equal(store.readResource(manager.id,'person.read_directory',person.id).display_name,'Изменённый учебный сотрудник');
  const equipment=await store.changeDirectory(manager.id,1,command('equipment','create',null,0,{unit_id:x.unitB,code:'LC81-EQ',name:'Учебное оборудование'}));
  const workplace=await store.changeDirectory(manager.id,1,command('workplace','create',null,0,{unit_id:x.unitB,code:'LC81-WP',name:'Учебное рабочее место'}));
  const operation=await store.changeDirectory(manager.id,1,command('operation','create',null,0,{unit_id:x.unitB,code:'LC81-OP',name:'Учебная операция',equipment_id:equipment.id,workplace_id:workplace.id,criticality:'normal'}));
  await assert.rejects(store.changeDirectory(manager.id,1,command('equipment','archive',equipment.id,equipment.rev,null)),/проверку/);
  await assert.rejects(store.changeDirectory(manager.id,1,command('operation','update',operation.id,operation.rev,{unit_id:x.f.unit,code:'LC81-OP',name:'Перенос',equipment_id:null,workplace_id:null,criticality:'normal'})),/Перенос/);
  await assert.rejects(store.changeDirectory(manager.id,1,command('business_role','create',null,0,{code:'ADMIN',name:'Подмена'})),/недоступен/);
  await assert.rejects(store.changeDirectory(manager.id,1,{...command('person','update',person.id,update.rev,{employee_code:'LC81-NEW',display_name:'Подмена'}),actor_id:admin.id}),/Неизвестный/);
  const photo=await store.sopPhoto(manager.id,1,x.revision.revision,1);
  assert.equal(photo.type,'image/png');assert.equal(photo.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  await assert.rejects(store.sopPhoto(manager.id,1,x.f.doc.id,1),/недоступно/,'superseded revision must not disclose its photo');
  await assert.rejects(store.sopPhoto(manager.id,1,x.revision.revision,2),/недоступно/);

  // Real LC3 commands and verified source bytes, not a parallel document model.
  const ctx=(kind,command,operation_id,id=null,revision_id=null,origin_id=null,origin_revision=null)=>({kind,command,id,revision_id,operation_id,origin_id,origin_revision});
  const req=(context,expected_revision,title,code,observed_at,text)=>({request_id:uuid(),context,expected_revision,title,code,observed_at,text});
  const op=x.f.operation,editContext=ctx('sop','revise',op,x.f.doc.entity_id,x.revision.revision);
  const original=await store.openLibrary(manager.id,1,editContext);
  assert.equal(original.text,x.revision.source.text);
  assert.equal((await store.libraryDetail(manager.id,1,'sop.read_twi',x.revision.revision)).exists,true);
  assert.equal((await store.libraryDetail(manager.id,1,'sop.read_linked_frv',x.revision.revision)).source,'linked_sop_not_measured');
  const draftSource=await makeSop('Учебная новая редакция LC81');
  const revised=await store.saveLibrary(manager.id,1,req(editContext,original.expected_revision,'Новая редакция',null,null,draftSource.text));
  assert.equal(store.readResource(manager.id,'sop.read_history',revised.revision_id).state,'draft');
  assert.equal(store.readResource(manager.id,'sop.read_effective',x.revision.revision).state,'effective');
  await assert.rejects(store.openLibrary(manager.id,1,editContext),/текущую редакцию/);
  const passport=await store.passportLibrary(manager.id,1,{id:revised.id,revision_id:revised.revision_id,expected_revision:revised.rev,print_format:'portrait',changed_on:'2026-01-20'});
  assert.equal(store.readResource(manager.id,'sop.read_history',revised.revision_id).print_format,'portrait');
  const saveContext=ctx('sop','save',op,revised.id,revised.revision_id);
  const editSource=await makeSop('Учебный изменённый шаг LC81');
  const edited=await store.saveLibrary(manager.id,1,req(saveContext,passport.rev,'Новая редакция',null,null,editSource.text));
  assert.equal(edited.revision_id,revised.revision_id);
  assert.equal(store.readResource(manager.id,'sop.read_history',edited.revision_id).print_format,null,'source edit resets passport');
  await assert.rejects(store.saveLibrary(manager.id,1,req(saveContext,passport.rev,'Устаревшее',null,null,editSource.text)),/изменился/);
  const createContext=ctx('sop','create',op);
  savedRequest=req(createContext,0,'Учебный новый СОП','LC81-NEW-SOP',null,draftSource.text);
  savedDraft=await store.saveLibrary(manager.id,1,savedRequest);
  const retry=await store.saveLibrary(manager.id,1,savedRequest);assert.equal(retry.id,savedDraft.id);assert.equal(retry.revision_id,savedDraft.revision_id);assert.equal(retry.duplicate,true);
  await assert.rejects(store.saveLibrary(manager.id,1,{...savedRequest,title:'Подмена'}),/ID уже использован/);
  await assert.rejects(store.saveLibrary(manager.id,1,{...req(createContext,0,'Плохой исходник','LC81-BAD',null,'{}')}),/не прошёл проверку/);
  await assert.rejects(store.openLibrary(manager.id,1,{...createContext,command:'approve'}),/Неверный контекст/);
  await assert.rejects(store.saveLibrary(manager.id,1,{...savedRequest,actor_id:admin.id}),/Неверные поля/);
  const frvRaw=JSON.stringify({schemaVersion:'FRV-1.3',study:{studyId:'QA-LC81-FRV',operationId:'Учебная операция',status:'Draft'},cycles:[{id:'c1',cycleNo:1,phase:'baseline',observations:[{id:'o1',actionRaw:'Учебный замер',valueType:'VA',durationSec:12,standardCandidate:true}]}],standard:{outdated:false,steps:[{action:'Учебный замер',plannedTimeSec:10,sourceObservationIds:['o1'],keyMoment:'КМ',reason:'Причина',valueType:'VA'}]}});
  const frvRequest=req(ctx('frv','create',op),0,'Учебное ФРВ',null,'2026-01-20',frvRaw);
  const frv=await store.saveLibrary(manager.id,1,frvRequest);
  assert.equal((await store.saveLibrary(manager.id,1,frvRequest)).id,frv.id);
  const frvContext=ctx('frv','save',op,frv.id);
  assert.equal((await store.openLibrary(manager.id,1,frvContext)).text,frvRaw);
  const finalized=await store.finalizeLibrary(manager.id,1,{id:frv.id,expected_revision:frv.rev,note:'Учебное завершение'});
  assert.equal(finalized.state,'final');
  assert.equal((await store.libraryDetail(manager.id,1,'frv.read_summary',frv.id)).baselineCount,1);
  await assert.rejects(store.openLibrary(manager.id,1,frvContext),/только черновик/);
  const originCtx=ctx('sop','create',op,null,null,frv.id,finalized.rev),origin=await store.openLibrary(manager.id,1,originCtx);
  assert.equal(JSON.parse(origin.text).constructor.steps[0].frvSource.observedTimeSec,12);
  fromFrv=await store.saveLibrary(manager.id,1,req(originCtx,0,'Проект из замеров','LC81-FRV-SOP',null,origin.text));
  assert.equal(store.readResource(manager.id,'sop.read_history',fromFrv.revision_id).state,'draft');
  // Cross-unit editor with the same action names still cannot open this operation.
  const editorRole=(await store.createReference(admin.id,'business_role',{code:'LC81-OTHER-EDITOR',name:'Редактор другого участка'})).id;
  const editorAssignment=(await store.createReference(admin.id,'role_assignment',{person_id:x.personB,role_id:editorRole,valid_from:'2020-01-01',valid_to:null})).id;
  const otherEditor=await store.createAccount(admin.id,{person_id:x.personB,login:'other-editor',password:password(),generate:false});
  await store.setPolicy(admin.id,{role_id:editorRole,revision:0,permissions:['operation.read','sop.read_history','sop.create','sop.edit_draft','sop.revise','frv.read','sop.from_frv']});
  await store.grant(admin.id,{account_id:otherEditor.id,assignment_id:editorAssignment,scope:{kind:'unit_tree',unit_id:x.unitB},valid_to:null});
  await assert.rejects(store.openLibrary(otherEditor.id,1,createContext),/Операция недоступна/);
  await assert.rejects(store.openLibrary(otherEditor.id,1,saveContext),/Операция недоступна/);
  await assert.rejects(store.saveLibrary(otherEditor.id,1,req(createContext,0,'Чужой СОП','LC81-DENIED',null,draftSource.text)),/Операция недоступна/);
  worker=await store.createAccount(admin.id,{person_id:x.f.trainee,login:'worker@example.invalid',password:workerPass,generate:false});
  const rights=['person.read_basic','task.read','task.implement_own','training.read'];
  await store.setPolicy(admin.id,{role_id:x.workerRole,revision:0,permissions:rights});
  await store.grant(admin.id,{account_id:worker.id,assignment_id:x.workerAssignment,scope:{kind:'self'},valid_to:null});
  const user=store.authenticate('worker@example.invalid',workerPass);assert.equal(user.id,worker.id);
  assert.equal(store.listResources(worker.id,'person.read_basic').length,1);
  assert.equal(store.listResources(worker.id,'training.read')[0].id,x.assignment);
  const tasks=store.listResources(worker.id,'task.read');
  assert.deepEqual(tasks.map(r=>r.id),[x.ownTask]);assert.equal(tasks[0].can_implement,true);
  assert.equal(store.readResource(worker.id,'task.read',x.otherTask),null);
  await assert.rejects(store.sopPhoto(worker.id,user.credential_revision,x.revision.revision,1),/недоступно/);
  await assert.rejects(store.changeDirectory(worker.id,user.credential_revision,{type:'person',operation:'update',id:x.personB,expected_revision:1,fields:{employee_code:'QA-B',display_name:'Чужая запись'}}),/недоступен/);

  await assert.rejects(store.implementOwnTask(worker.id,user.credential_revision,{id:x.otherTask,expected_revision:1,result:'Чужое'}),/своё/);
  await assert.rejects(store.implementOwnTask(admin.id,admin.credential_revision,{id:x.ownTask,expected_revision:tasks[0].rev,result:'От администратора'}),/своё/);
  const done=await store.implementOwnTask(worker.id,user.credential_revision,{id:x.ownTask,expected_revision:tasks[0].rev,result:'Учебное выполнено'});
  assert.equal(done.state,'implemented');assert.equal(store.readResource(worker.id,'task.read',x.ownTask).can_implement,false);
  await assert.rejects(store.implementOwnTask(worker.id,user.credential_revision,{id:x.ownTask,expected_revision:tasks[0].rev,result:'Повтор'}),/изменилась|проверки/);
  const log=store.adminData(admin.id).audit.find(r=>r.action==='task.implement_own');assert.equal(log.actor_account_id,worker.id);
 }finally{await store.close()}
 const backup=path.join(x.root,'backup'),restored=path.join(x.root,'restored');
 await copySecureCheckpoint(x.target,backup);await copySecureCheckpoint(backup,restored);
 assert.deepEqual(await fs.readFile(path.join(restored,'secure.lc81')),await fs.readFile(path.join(backup,'secure.lc81')));
 await assert.rejects(copySecureCheckpoint(x.target,restored));
 store=await openSecureQA({dataDir:restored});
 try{
  assert.equal(store.authenticate('worker@example.invalid',workerPass).id,worker.id);
  assert.equal(store.readResource(worker.id,'task.read',x.ownTask).state,'implemented');
  assert.equal(store.readResource(worker.id,'task.read',x.otherTask),null);
  assert.equal((await store.saveLibrary(manager.id,1,savedRequest)).id,savedDraft.id,'receipt survives restore');
  const imported=await store.openLibrary(manager.id,1,{kind:'sop',command:'save',operation_id:x.f.operation,id:fromFrv.id,revision_id:fromFrv.revision_id,origin_id:null,origin_revision:null});
  assert.equal(JSON.parse(imported.text).constructor.steps[0].frvSource.observedTimeSec,12);
 }finally{await store.close()}
 const privateCopy=await fs.readFile(path.join(restored,'secure.lc81'));
 const verified=openDb(SQL,new Uint8Array(privateCopy.subarray('LC81QA1\\n'.length+65)),{upgrade:false});
 try{assert(one(verified,'SELECT study_id FROM sop_frv_origin WHERE revision_id=?',[fromFrv.revision_id]));assert(one(verified,'SELECT count(*) n FROM lc81_library_receipt').n>=5)}finally{verified.close()}
 const srcFile=path.join(restored,'documents',x.f.source.source.sha256+'.json');
 await fs.writeFile(srcFile,'corrupted');
 await assert.rejects(openSecureQA({dataDir:restored}));
 await assert.rejects(copySecureCheckpoint(restored,path.join(x.root,'broken-backup')));
 assert.equal(sha(await fs.readFile(path.join(x.source,PILOT_STATE))),x.sourceHash);
});
