import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {fixture,SQL} from './lc4-fixture.mjs';
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
 let manager,worker,workerPass=password();
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
 }finally{await store.close()}
 const srcFile=path.join(restored,'documents',x.f.source.source.sha256+'.json');
 await fs.writeFile(srcFile,'corrupted');
 await assert.rejects(openSecureQA({dataDir:restored}));
 await assert.rejects(copySecureCheckpoint(restored,path.join(x.root,'broken-backup')));
 assert.equal(sha(await fs.readFile(path.join(x.source,PILOT_STATE))),x.sourceHash);
});
