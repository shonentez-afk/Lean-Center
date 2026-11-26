import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openPilot,pilotSql,atomicReplace,PILOT_STATE,PILOT_PREVIOUS,readPilotState,restorePilotCheckpoint} from '../server/lc74-store.mjs';
import {parsePilotUsers,createPilotServer} from '../server/lc74-http.mjs';
import {Workspace,readSnapshot,one,list,uuid,now,sha256,canonical} from '../src/core/db.js';
import {inspectSource} from '../src/modules/library/domain.js';
const {SQL}=await pilotSql();
const tokens=Object.fromEntries(['a','b','v'].map(x=>[x,randomBytes(32).toString('hex')]));
const users=parsePilotUsers(JSON.stringify(Object.fromEntries(Object.entries(tokens).map(([name,token])=>[name,{token,role:name==='v'?'viewer':'editor'}]))));
const encodeUsers=v=>'HEX1'+Buffer.from(JSON.stringify(v),'utf8').toString('hex');
test('Amvera alphanumeric secret preserves authentication, roles and legacy JSON; invalid encoding fails closed',()=>{
 const records=Object.fromEntries(Object.entries(tokens).map(([name,token])=>[name,{token,role:name==='v'?'viewer':'editor'}]));
 const encoded=encodeUsers(records);
 assert.match(encoded,/^HEX1[0-9a-f]+$/);
 assert.deepEqual(parsePilotUsers(encoded),parsePilotUsers(JSON.stringify(records)));
 for(const bad of ['HEX1','HEX1f','HEX1gg','HEX1ff','HEX1'+'aa'.repeat(16385),encodeUsers(null),encodeUsers([]),encodeUsers({}),encodeUsers({a:{role:'admin',token:tokens.a}}),encodeUsers({a:{role:'editor',token:'abc'}}),encodeUsers({a:records.a,b:records.a}),encodeUsers({'bad name':records.a})]){
  assert.throws(()=>parsePilotUsers(bad),/LC_PILOT_USERS/)
 }
});
const person=(code,name=code)=>({employee_code:code,display_name:name});
async function withPilot(t,fn){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lc74-'));let store,server,base;
 async function start(options={}){
  store=await openPilot({dataDir:dir,...options});server=createPilotServer({store,users});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port
 }
 async function stop(){if(server){await new Promise(resolve=>server.close(resolve));server=null}if(store){await store.close();store=null}}
 async function request(user,route,options={}){
  const headers={...options.headers};if(user)headers.Authorization='Bearer '+(tokens[user]||user);
  const r=await fetch(base+route,{...options,headers});return r
 }
 async function snapshot(user='a'){const r=await request(user,'/api/v1/snapshot');assert.equal(r.status,200);const s=await r.json();return new Workspace(SQL,await readSnapshot(SQL,s.manifest,new Uint8Array(Buffer.from(s.sqlite_base64,'base64'))))}
 async function send(user,pkg){const r=await request(user,'/api/v1/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:canonical(pkg)});return {status:r.status,...await r.json()}}
 try{await start();await fn({dir,start,stop,request,snapshot,send,getStore:()=>store})}finally{await stop();await fs.rm(dir,{recursive:true,force:true})}
}
test('two editors share the accepted SQLite engine; duplicate retry, conflict rollback, restart and read-only user',async t=>withPilot(t,async({dir,start,stop,request,snapshot,send})=>{
 assert.equal((await request(null,'/api/v1/snapshot')).status,401);
 assert.equal((await request('wrong','/api/v1/snapshot')).status,401);
 assert.equal((await request(null,'/healthz')).status,200);
 await assert.rejects(openPilot({dataDir:dir}),/EEXIST/);
 const a=await snapshot('a'),b=await snapshot('b');
 try{
  const id=a.edit('person',null,person('QA-A'));b.edit('person',null,person('QA-B'));
  const p=await a.package(),q=await b.package();
  assert.equal((await send('v',p)).status,403);
  const results=await Promise.all([send('a',p),send('b',q)]);assert(results.every(r=>r.status===200&&r.count===1));
  const retry=await send('a',p);assert.equal(retry.status,200);assert.equal(retry.duplicate,true);
  const c=await snapshot('a'),d=await snapshot('b');
  try{
   assert.deepEqual(list(c.working,'person').map(x=>x.employee_code).sort(),['QA-A','QA-B']);
   c.edit('person',id,person('QA-A','Winner'));
   d.edit('person',null,person('ROLLBACK'));d.edit('person',id,person('QA-A','Loser'));
   assert.equal((await send('a',await c.package())).status,200);
   const conflict=await send('b',await d.package());assert.equal(conflict.status,409);
   const fresh=await snapshot('v');try{assert.equal(list(fresh.working,'person').length,2);assert.equal(one(fresh.working,'SELECT display_name FROM person WHERE id=?',[id]).display_name,'Winner');assert.equal(d.pending.length,2);assert.equal(one(fresh.working,'SELECT count(*) n FROM person WHERE employee_code=?',['ROLLBACK']).n,0)}finally{fresh.close()}
  }finally{c.close();d.close()}
  await stop();await start();
  const r=await snapshot('b');try{assert.equal(list(r.working,'person').length,2);assert.equal(one(r.working,'SELECT display_name FROM person WHERE id=?',[id]).display_name,'Winner')}finally{r.close()}
  assert.equal((await send('a',p)).duplicate,true);
 }finally{a.close();b.close()}
}));
test('exact detached SOP content required; upload verified, viewer can read only committed source',async t=>withPilot(t,async({request,snapshot,send})=>{
 const w=await snapshot();
 try{
  const body={schemaVersion:2,document:{id:'DEMO-SOP',status:'Draft',number:'QA',version:1},constructor:{schemaVersion:4,meta:{operation:'Учебная проверка'},steps:[{id:1,action:'Проверить',keyMoments:['Безопасность'],reason:'Учебный пример',durationSeconds:15,hasPhoto:false}],twi:{enabled:false}},photoAssets:{}};
  const text=JSON.stringify({...body,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(body))}});
  const s=await inspectSource(text,'sop'),route='/api/v1/documents/'+s.source.sha256;
  const e={id:uuid(),entity_id:uuid(),entity_type:'document',operation:'create',expected_revision:0,occurred_at:now(),payload:{command:'create',code:'DEMO-SOP',title:'Учебная проверка',operation_id:null,source:s.source,projection:s.projection}};
  await w.applyContentEvents([e],()=>text);const p=await w.package();
  assert.equal((await send('a',p)).status,422);
  assert.equal((await request('v',route+'?kind=sop',{method:'PUT',body:text})).status,403);
  assert.equal((await request('a',route+'?kind=sop',{method:'PUT',body:text+' '})).status,422);
  assert.equal((await request('a',route+'?kind=sop',{method:'PUT',body:text})).status,200);
  assert.equal((await request('v',route)).status,404);
  assert.equal((await send('a',p)).status,200);
  assert.equal(await (await request('v',route)).text(),text);
  const b=await snapshot('v');try{assert.equal(one(b.working,'SELECT count(*) n FROM document').n,1)}finally{b.close()}
 }finally{w.close()}
}));
test('failure before durable publication never acknowledges or overwrites last valid snapshot',async t=>withPilot(t,async({stop,start,snapshot,send,request})=>{
 const initial=await snapshot();const old=initial.state();initial.close();
 await stop();await start({write:async(file,bytes)=>{if(file.endsWith(PILOT_STATE))throw Error('injected disk failure');await atomicReplace(file,bytes)}});
 const w=await snapshot();try{w.edit('person',null,person('FAIL'));const p=await w.package();assert.equal((await send('a',p)).status,503);assert.equal((await request(null,'/healthz')).status,503);await stop();await start();const b=await snapshot();try{assert.deepEqual(b.state().base,old.base);assert.equal(list(b.working,'person').length,0)}finally{b.close()}assert.equal((await send('a',p)).status,200)}finally{w.close()}
}));
test('invalid/default credentials and corrupt storage fail closed',async()=>{
 assert.throws(()=>parsePilotUsers(''));assert.throws(()=>parsePilotUsers('{"a":{"role":"editor","token":"abc"}}'));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lc74-corrupt-'));
 try{await fs.writeFile(path.join(dir,PILOT_STATE),'bad');await assert.rejects(openPilot({dataDir:dir}));assert.equal(await fs.readFile(path.join(dir,PILOT_STATE),'utf8'),'bad')}finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('durable independent checksum detects modified otherwise valid SQLite; previous checkpoint retained',async t=>withPilot(t,async({dir,stop,snapshot,send})=>{
 const w=await snapshot();const old=w.state();w.edit('person',null,person('PERSIST'));
 assert.equal((await send('a',await w.package())).status,200);w.close();
 await stop();
 const previous=await readPilotState(SQL,path.join(dir,PILOT_PREVIOUS));
 assert.deepEqual(previous.bytes,old.base);
 const file=path.join(dir,PILOT_STATE),bytes=await fs.readFile(file);
 const good=await readPilotState(SQL,file),db=await readSnapshot(SQL,good.manifest,good.bytes);
 try{
  // Produce a valid SQLite database with changed contents but keep old recorded hash.
  db.run("UPDATE person SET display_name='Tampered' WHERE employee_code='PERSIST'");
  const modified=Buffer.from(db.export());assert.equal(modified.length,good.bytes.length);
  modified.copy(bytes,bytes.length-modified.length);await fs.writeFile(file,bytes)
 }finally{db.close()}
 await assert.rejects(openPilot({dataDir:dir}),/Повреждён снимок/);
 assert.deepEqual(await fs.readFile(file),bytes);
 assert.equal((await readPilotState(SQL,path.join(dir,PILOT_PREVIOUS))).manifest.id,previous.manifest.id);
}));
test('full checkpoint export and restore to a new directory, exact documents and no overwrite',async t=>withPilot(t,async({dir,snapshot,send,request,getStore})=>{
 const w=await snapshot();
 const s={schemaVersion:2,document:{id:'BACKUP-SOP',status:'Draft',number:'QA',version:1},constructor:{schemaVersion:4,meta:{operation:'Учебный бэкап'},steps:[{id:1,action:'Проверить',keyMoments:['КМ'],reason:'Причина',durationSeconds:1,hasPhoto:false}],twi:{enabled:false}},photoAssets:{}};
 const text=JSON.stringify({...s,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(s))}});
 const d=await inspectSource(text,'sop'),route='/api/v1/documents/'+d.source.sha256;
 const e={id:uuid(),entity_id:uuid(),entity_type:'document',operation:'create',expected_revision:0,occurred_at:now(),payload:{command:'create',code:'BACKUP-SOP',title:'Учебный бэкап',operation_id:null,source:d.source,projection:d.projection}};
 try{
  await w.applyContentEvents([e],()=>text);
  assert.equal((await request('a',route+'?kind=sop',{method:'PUT',body:text})).status,200);
  assert.equal((await send('a',await w.package())).status,200);
  const backupDir=path.join(dir,'export'),restoreDir=path.join(dir,'restore');
  const before=getStore().head(),m=await getStore().exportCheckpoint(backupDir);assert.deepEqual(m,before);
  await assert.rejects(getStore().exportCheckpoint(backupDir),/EEXIST/);
  assert.deepEqual(await restorePilotCheckpoint(backupDir,restoreDir),before);
  const restored=await openPilot({dataDir:restoreDir});try{assert.deepEqual(restored.head(),before);assert.equal(await restored.getSource(d.source.sha256),text)}finally{await restored.close()}
  await assert.rejects(restorePilotCheckpoint(backupDir,restoreDir),/EEXIST/);
  await fs.writeFile(path.join(backupDir,'documents',d.source.sha256+'.json'),text+' ');
  const rejected=path.join(dir,'bad-restore');await assert.rejects(restorePilotCheckpoint(backupDir,rejected),/повреждён/);
  await assert.rejects(fs.stat(rejected),/ENOENT/);assert.deepEqual(getStore().head(),before);
 }finally{w.close()}
}));
