import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import initSqlJs from 'sql.js';import {webcrypto} from 'node:crypto';if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {configureMigrations,createDb,openDb,bytesOf,Workspace,meta,list,uuid,makePackage,mergePackage,prepareSnapshot,readSnapshot,backup,restore,one,sha256,canonical} from '../src/core/db.js';
const SQL=await initSqlJs(),schema=fs.readFileSync('db/schema_v1.sql','utf8'),migration=fs.readFileSync('db/migrations/002_lc1.sql','utf8');
configureMigrations(fs.readFileSync('db/migrations/003_lc2.sql','utf8'),fs.readFileSync('db/migrations/004_lc3.sql','utf8'),fs.readFileSync('db/migrations/005_lc3_requirements.sql','utf8'),fs.readFileSync('db/migrations/006_stage43_checklist.sql','utf8'),fs.readFileSync('db/migrations/007_lc4_training.sql','utf8'),fs.readFileSync('db/migrations/008_lc4_corporate_forms.sql','utf8'),fs.readFileSync('db/migrations/009_lc42_methods.sql','utf8'),fs.readFileSync('db/migrations/010_lc43_matrix.sql','utf8'),fs.readFileSync('db/migrations/011_lc5_audit.sql','utf8'),fs.readFileSync('db/migrations/012_lc51_assessments.sql','utf8'),fs.readFileSync('db/migrations/013_lc52_integration.sql','utf8'),fs.readFileSync('db/migrations/014_lc6_effect.sql','utf8'),fs.readFileSync('db/migrations/015_lc63_twi_standard.sql','utf8'),fs.readFileSync('db/migrations/016_lc64_twi_workflows.sql','utf8'),fs.readFileSync('db/migrations/017_lc65_preparation_results.sql','utf8'));
const newWs=()=>new Workspace(SQL,createDb(SQL,schema,migration));
const person=(code,name=code)=>({employee_code:code,display_name:name});
const unit=(code,parent=null)=>({code,name:code,kind:'Участок',parent_id:parent});
const clone=w=>new Workspace(SQL,openDb(SQL,bytesOf(w.base)));
async function published(w){const s=await prepareSnapshot(w);return new Workspace(SQL,await readSnapshot(SQL,s.manifest,s.bytes))}
test('new DB schema and editable master data',async()=>{const w=newWs();const u=w.edit('org_unit',null,unit('U'));const p=w.edit('person',null,person('P'));w.edit('person_assignment',null,{person_id:p,unit_id:u,profession_id:null,shift_code:'1',valid_from:'2026-11-25',valid_to:null});assert.equal(list(w.working,'person').length,1);assert.equal(w.pending.length,3);assert.equal(await w.acceptOwn(),3);assert.equal(w.pending.length,0);assert.equal(list(w.base,'person').length,1);w.close()});
test('package is transactional, duplicate safe, stale edits conflict',async()=>{let m=newWs();const id=m.edit('person',null,person('P'));await m.acceptOwn();m=await published(m);const a=clone(m),b=clone(m);a.edit('person',id,person('P','A'));b.edit('person',null,person('Q'));b.edit('person',id,person('P','B'));const p=await a.package(),q=await b.package();assert.equal((await m.accept(p)).count,1);assert.equal((await m.accept(p)).duplicate,true);await assert.rejects(m.accept(q),/Конфликт версии/);assert.equal(list(m.base,'person').length,1);assert.equal(list(m.base,'person')[0].display_name,'A');assert.equal(one(m.base,'SELECT id FROM exchange_package WHERE id=?',[q.id]),null)});
test('events deduplicated across different package IDs and client refresh',async()=>{let m=await published(newWs());const a=clone(m);a.edit('person',null,person('X'));const p=await a.package(),q=await a.package();assert.equal((await m.accept(p)).count,1);assert.equal((await m.accept(q)).count,0);const s=await prepareSnapshot(m);a.replaceBase(await readSnapshot(SQL,s.manifest,s.bytes));assert.equal(a.pending.length,0);assert.equal(list(a.working,'person').length,1)});
test('local conflict retains pending data',async()=>{let m=newWs();const id=m.edit('person',null,person('P'));await m.acceptOwn();m=await published(m);const a=clone(m),b=clone(m);a.edit('person',id,person('P','Local'));b.edit('person',id,person('P','Remote'));await m.accept(await b.package());const s=await prepareSnapshot(m);a.replaceBase(await readSnapshot(SQL,s.manifest,s.bytes));assert.equal(a.conflicts.length,1);assert.equal(a.pending.length,1);assert.equal(list(a.working,'person')[0].display_name,'Remote');assert.equal(a.pending[0].payload.display_name,'Local')});
test('checksum and DB identity validation',async()=>{const a=newWs(),b=newWs();a.edit('person',null,person('A'));const p=await a.package();await assert.rejects(b.accept(p),/другой базы/);p.events[0].payload.display_name='Tampered';await assert.rejects(mergePackage(a.base,p),/Сумма|сумма/);const s=await prepareSnapshot(b);s.bytes[100]^=1;await assert.rejects(readSnapshot(SQL,s.manifest,s.bytes),/Повреждён/)});
test('backup restore preserves local pending and rejects corruption',async()=>{const a=newWs();a.edit('person',null,person('Z'));const b=await backup(a);const w=await restore(SQL,b);assert.equal(w.pending.length,1);assert.equal(list(w.working,'person')[0].display_name,'Z');b.pending[0].payload.display_name='changed';await assert.rejects(restore(SQL,b),/повреждена/)});
test('cycles, duplicate codes and overlapping assignments rejected',()=>{const w=newWs();const a=w.edit('org_unit',null,unit('A'));const b=w.edit('org_unit',null,unit('B',a));assert.throws(()=>w.edit('org_unit',a,unit('A',b)),/Цикл/);assert.throws(()=>w.edit('org_unit',null,unit('A')),/UNIQUE/);const p=w.edit('person',null,person('P'));const payload={person_id:p,unit_id:b,profession_id:null,shift_code:'1',valid_from:'2026-11-25',valid_to:null};w.edit('person_assignment',null,payload);assert.throws(()=>w.edit('person_assignment',null,payload),/Пересечение/)});
test('SQLite export retains foreign keys',()=>{const w=newWs();bytesOf(w.base);assert.equal(one(w.base,'PRAGMA foreign_keys').foreign_keys,1)});

test('manual conflict resolution creates a new versioned event',async()=>{let m=newWs();const id=m.edit('person',null,person('P'));await m.acceptOwn();m=await published(m);const a=clone(m),b=clone(m);a.edit('person',id,person('P','Local'));const old=a.pending[0].id;b.edit('person',id,person('P','Remote'));await m.accept(await b.package());const s=await prepareSnapshot(m);a.replaceBase(await readSnapshot(SQL,s.manifest,s.bytes));a.resolveConflict('reapply');assert.equal(a.conflicts.length,0);assert.notEqual(a.pending[0].id,old);assert.equal(a.pending[0].expected_revision,2);assert.equal(list(a.working,'person')[0].display_name,'Local')});
test('publisher recovers after a verified publication already includes accepted edits',async()=>{let m=await published(newWs());m.edit('person',null,person('A'));await m.acceptOwn();assert.equal(m.dirty,true);const s=await prepareSnapshot(m);m.replaceBase(await readSnapshot(SQL,s.manifest,s.bytes));assert.equal(m.dirty,false);assert.equal(list(m.base,'person').length,1)});

import * as net from '../src/storage/network.js';
const missing=()=>Object.assign(new Error('missing'),{name:'NotFoundError'});
class FileHandle {
 constructor(){this.kind='file';this.data=new Uint8Array()}
 async getFile(){return new Blob([this.data])}
 async createWritable(){let data;return {write:async d=>{data=typeof d==='string'?new TextEncoder().encode(d):new Uint8Array(d)},close:async()=>{this.data=data},abort:async()=>{}}}
}
class FolderHandle {
 constructor(name='test'){this.kind='directory';this.name=name;this.files=new Map()}
 async queryPermission(){return 'granted'}
 async requestPermission(){return 'granted'}
 async getFileHandle(name,{create=false}={}){if(!this.files.has(name)){if(!create)throw missing();this.files.set(name,new FileHandle())}const f=this.files.get(name);assert.equal(f.kind,'file');return f}
 async getDirectoryHandle(name,{create=false}={}){if(!this.files.has(name)){if(!create)throw missing();this.files.set(name,new FolderHandle(name))}const f=this.files.get(name);assert.equal(f.kind,'directory');return f}
 async removeEntry(name){if(!this.files.delete(name))throw missing()}
 async *entries(){yield* this.files.entries()}
}
test('network adapter publication, two client exchange and backup using simulated directory API',async()=>{const folder=new FolderHandle();assert.equal(await net.testFolder(folder),true);let master=newWs();let s=await prepareSnapshot(master);await net.publishSnapshot(folder,SQL,s);master.replaceBase((await net.latestSnapshot(folder,SQL)).db);const client=new Workspace(SQL,(await net.latestSnapshot(folder,SQL)).db);client.edit('person',null,person('NETWORK'));const p=await client.package();await net.sendPackage(folder,p);const incoming=await net.listPackages(folder);assert.equal(incoming.length,1);assert.equal((await master.accept(incoming[0].p)).count,1);s=await prepareSnapshot(master);await net.publishSnapshot(folder,SQL,s);master.replaceBase((await net.latestSnapshot(folder,SQL)).db);client.replaceBase((await net.latestSnapshot(folder,SQL)).db);assert.equal(client.pending.length,0);assert.equal(list(client.working,'person')[0].employee_code,'NETWORK');await net.saveBackup(folder,await backup(client));assert.equal((await folder.getDirectoryHandle('Backups')).files.size,1);await assert.rejects(net.publishSnapshot(folder,SQL,s),/обновилась/);assert.equal((await net.sendPackage(folder,p)).duplicate,true);assert.equal((await net.listPackages(folder)).length,1)});
test('network adapter refuses damaged snapshot and parallel publication',async()=>{const folder=new FolderHandle();const m=newWs();const s=await prepareSnapshot(m);await net.publishSnapshot(folder,SQL,s);const d=await folder.getDirectoryHandle('Database');const f=await d.getFileHandle('snapshot-'+s.manifest.id+'.sqlite');f.data[100]^=1;await assert.rejects(net.latestSnapshot(folder,SQL),/Повреждён/);f.data[100]^=1;const fork=await prepareSnapshot(m);await net.writeNew(d,'snapshot-'+fork.manifest.id+'.sqlite',fork.bytes);await net.writeNew(d,'publication-'+fork.manifest.id+'.json',canonical(fork.manifest));await assert.rejects(net.latestSnapshot(folder,SQL),/параллельные/)});

test('LC5.4.1 pending suffix is exposed and restored after resolving a conflict',async()=>{
 let m=newWs();const id=m.edit('person',null,person('P'));await m.acceptOwn();m=await published(m);const a=clone(m),b=clone(m);
 try{a.edit('person',id,person('P','Local'));const q=a.edit('person',null,person('Q'));b.edit('person',id,person('P','Remote'));await m.accept(await b.package());const s=await prepareSnapshot(m);a.replaceBase(await readSnapshot(SQL,s.manifest,s.bytes));assert.equal(a.conflicts.length,1);assert.equal(a.blockedPending.length,1);assert.equal(a.blockedPending[0].entity_id,q);assert.equal(a.pending.length,2);assert.equal(one(a.working,'SELECT id FROM person WHERE id=?',[q]),null);a.resolveConflict('discard');assert.equal(a.conflicts.length,0);assert.equal(a.blockedPending.length,0);assert.equal(one(a.working,'SELECT id FROM person WHERE id=?',[q]).id,q);assert.equal(a.pending.length,1)}finally{a.close();b.close();m.close()}
});
test('LC5.4.1 resending an unchanged queue reuses the original verified network package',async()=>{
 const folder=new FolderHandle(),w=newWs();try{w.edit('person',null,person('A'));const first=await w.package(),again=await w.package();assert.notEqual(first.id,again.id);assert.equal((await net.sendPackage(folder,first)).duplicate,false);assert.deepEqual(await net.sendPackage(folder,again),{duplicate:true,id:first.id});assert.equal((await net.listPackages(folder)).length,1);w.edit('person',null,person('B'));const extended=await w.package();assert.equal((await net.sendPackage(folder,extended)).duplicate,false);assert.equal((await net.listPackages(folder)).length,2);assert.equal(w.pending.length,2)}finally{w.close()}
});


// LC73B-NET-01: close failure after creation of a zero-byte manifest.
test('LC73B-NET-01 interrupted publication does not block last committed snapshot or retry',async()=>{
 const folder=new FolderHandle(),master=newWs();let operator;
 try{
  master.edit('person',null,person('A'));await master.acceptOwn();const a=await prepareSnapshot(master);
  await net.publishSnapshot(folder,SQL,a);master.replaceBase((await net.latestSnapshot(folder,SQL)).db);
  operator=new Workspace(SQL,(await net.latestSnapshot(folder,SQL)).db);
  master.edit('person',null,person('B'));await master.acceptOwn();
  const b=await prepareSnapshot(master),d=await folder.getDirectoryHandle('Database'),badName='publication-'+b.manifest.id+'.json',get=d.getFileHandle.bind(d);
  d.getFileHandle=async(name,options)=>{const f=await get(name,options);if(name===badName&&options?.create){const create=f.createWritable.bind(f);f.createWritable=async()=>{const w=await create();return {...w,close:async()=>{throw Error('QA close failed')}}}}return f};
  await assert.rejects(net.publishSnapshot(folder,SQL,b),/Публикация не подтверждена.*QA close failed/);d.getFileHandle=get;
  assert.equal((await get(badName)).data.length,0);assert.equal((await get('snapshot-'+b.manifest.id+'.sqlite')).data.length,b.bytes.length);assert.equal(master.dirty,true);
  let warnings=[];const options={onIncomplete:names=>{warnings=names}};
  const last=await net.latestSnapshot(folder,SQL,null,options);assert.equal(last.manifest.id,a.manifest.id);assert.deepEqual(warnings,[badName]);operator.replaceBase(last.db);
  const fresh=await net.latestSnapshot(folder,SQL,null,options);try{assert.deepEqual(list(fresh.db,'person').map(x=>x.employee_code),['A'])}finally{fresh.db.close()}
  const c=await prepareSnapshot(master);assert.equal(c.manifest.parent_id,a.manifest.id);assert.notEqual(c.manifest.id,b.manifest.id);await net.publishSnapshot(folder,SQL,c,undefined,options);
  assert.deepEqual(warnings,[badName]);assert.equal((await get(badName)).data.length,0);assert.deepEqual((await get('snapshot-'+b.manifest.id+'.sqlite')).data,b.bytes);
  const latest=await net.latestSnapshot(folder,SQL,null,options);assert.equal(latest.manifest.id,c.manifest.id);operator.replaceBase(latest.db);assert.deepEqual(list(operator.working,'person').map(x=>x.employee_code).sort(),['A','B']);
  // Empty means zero bytes, not whitespace, invalid UTF-8, a truncated JSON,
  // or structurally invalid but parseable data.
  const marker=await get(badName);for(const invalid of [' ','{','{}','null']){marker.data=new TextEncoder().encode(invalid);await assert.rejects(net.latestSnapshot(folder,SQL),/Повреждён непустой манифест|Имя манифеста/)}
  marker.data=Uint8Array.of(255);await assert.rejects(net.latestSnapshot(folder,SQL),/Повреждён непустой манифест/);marker.data=new Uint8Array();
  const headFile=await get('snapshot-'+c.manifest.id+'.sqlite');headFile.data[100]^=1;await assert.rejects(net.latestSnapshot(folder,SQL),/Повреждён снимок/);headFile.data[100]^=1;
  const oldManifest=await get('publication-'+a.manifest.id+'.json'),oldBytes=oldManifest.data;
  const tampered={...a.manifest,created_at:'2000-01-01T00:00:00Z'};oldManifest.data=new TextEncoder().encode(canonical(tampered));await assert.rejects(net.latestSnapshot(folder,SQL),/контрольная сумма манифеста/);
  oldManifest.data=new Uint8Array();await assert.rejects(net.latestSnapshot(folder,SQL),/Разорвана цепочка публикаций/);oldManifest.data=oldBytes;
  // A known client may not downgrade to A if its previously committed C marker is lost.
  const headMarker=await get('publication-'+c.manifest.id+'.json'),headBytes=headMarker.data;headMarker.data=new Uint8Array();
  const fallback=await net.latestSnapshot(folder,SQL);assert.equal(fallback.manifest.id,a.manifest.id);assert.throws(()=>operator.replaceBase(fallback.db),/Снимок устарел/);assert.equal(meta(operator.base,'publication_id'),c.manifest.id);headMarker.data=headBytes;
  const fork=await prepareSnapshot(master);await net.writeNew(d,'snapshot-'+fork.manifest.id+'.sqlite',fork.bytes);await net.writeNew(d,'publication-'+fork.manifest.id+'.json',canonical(fork.manifest));await assert.rejects(net.latestSnapshot(folder,SQL),/параллельные/);
 }finally{operator?.close();master.close()}
});
test('LC73B-NET-01 first interrupted publication never becomes a base; missing snapshot fails closed',async()=>{
 const folder=new FolderHandle(),master=newWs();try{
  const first=await prepareSnapshot(master),d=await folder.getDirectoryHandle('Database',{create:true}),name='publication-'+first.manifest.id+'.json';
  await d.getFileHandle(name,{create:true});await assert.rejects(net.latestSnapshot(folder,SQL),/Пустой манифест без файла снимка/);
  await net.writeNew(d,'snapshot-'+first.manifest.id+'.sqlite',first.bytes);
  let warnings;assert.equal(await net.latestSnapshot(folder,SQL,null,{onIncomplete:n=>warnings=n}),null);assert.deepEqual(warnings,[name]);
  const next=await prepareSnapshot(master);await net.publishSnapshot(folder,SQL,next);const s=await net.latestSnapshot(folder,SQL);try{assert.equal(s.manifest.id,next.manifest.id)}finally{s.db.close()}
 }finally{master.close()}
});
