// Local deployment rehearsal, never connects to a real host or existing data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {cloudIdentity} from '../tools/cloud-identity.mjs';
const origin='https://qa.example.invalid';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){
 const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});
 const port=s.address().port;await new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));return port;
}
test('pinned protected Amvera recipe: new storage, persistent state, offline backup and restore', {timeout:120000}, async()=>{
 const recipe=await fs.readFile('amvera.yml','utf8');
 assert.equal(recipe,await fs.readFile('deploy/lc81-amvera/amvera.yml','utf8'));
 assert.match(recipe,/scriptName: server\/lc81-main\.mjs/);
 assert.match(recipe,/persistenceMount: \/data/);
 assert.match(recipe,/containerPort: 8080/);
 const identity=cloudIdentity();
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-amvera-'));
 const dataDir=path.join(root,'data'),backup=path.join(root,'backup'),restored=path.join(root,'restored');
 const password=randomBytes(24).toString('base64url'),env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('LC81_')||key.startsWith('LC_PILOT_')||key.startsWith('LC_BOOTSTRAP_')||key==='PORT')delete env[key];
 let running=null;
 async function stop(){
  if(!running)return;
  const {child,done}=running;running=null;
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  let timer;try{
   const result=await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('QA shutdown timeout'))},15000)})]);
   assert.equal(result.code,0,'protected server must close gracefully');
  }finally{clearTimeout(timer)}
 }
 async function start(dir,init=false){
  const port=await freePort(),url='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server/lc81-main.mjs'],{env:{...env,PORT:String(port),LC81_QA:'1',LC81_DATA_DIR:dir,LC81_ORIGIN:origin,...(init?{LC81_INIT:'1',LC_BOOTSTRAP_ADMIN_PASSWORD:password,LC81_SITE_TIME_ZONE:'UTC'}:{})},stdio:['ignore','ignore','ignore']});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}))});
  // Avoid unhandled rejection while polling startup.
  done.catch(()=>{});
  running={child,done};
  let health=null;
  for(let i=0;i<150;i++){
   if(child.exitCode!==null||child.signalCode!==null)throw Error('Protected QA process exited before health');
   try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(1000)});if(r.ok){health=await r.json();break}}catch{}
   await pause(100);
  }
  assert(health,'protected health did not respond');
  assert.equal(health.ok,true);assert.equal(health.mode,'LC8.1-QA');assert.equal(health.complete,false);assert.equal(health.sourceCommit,identity.sourceCommit);
  async function req(route,cookie=null,body=undefined,csrf=true){
   const headers={};if(cookie)headers.Cookie=cookie;
   if(body!==undefined){headers['Content-Type']='application/json';if(csrf){headers.Origin=origin;headers['X-LC81-Request']='1'}}
   return fetch(url+route,{headers,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  }
  assert.equal((await req('/api/lc81/session')).status,401);
  assert.equal((await req('/api/v1/snapshot')).status,404);
  assert.equal((await req('/api/lc81/login',null,{login:'admin',password},false)).status,403);
  const r=await req('/api/lc81/login',null,{login:'admin',password});assert.equal(r.status,200);
  const cookie=r.headers.get('set-cookie');assert.match(cookie,/; Secure; HttpOnly; SameSite=Strict/);
  const session=await req('/api/lc81/session',cookie.split(';')[0]);assert.equal(session.status,200);assert.equal((await session.json()).user.admin,true);
  return {req,cookie:cookie.split(';')[0]};
 }
 function maintenance(mode,source,target){
  const r=spawnSync(process.execPath,['server/lc81-maintenance.mjs',mode,source,target],{env:{...env,LC81_QA:'1'},encoding:'utf8',timeout:30000});
  assert.equal(r.status,0,'offline '+mode+' must succeed');
 }
 async function admin(client){
  const r=await client.req('/api/lc81/admin',client.cookie);assert.equal(r.status,200);return r.json();
 }
 try{
  let client=await start(dataDir,true);
  const a=await admin(client);
  const created=await client.req('/api/lc81/admin/reference',client.cookie,{type:'org_unit',payload:{code:'QA-DEPLOY-PERSIST',name:'QA persistence witness',kind:'Участок',parent_id:a.site}});
  assert.equal(created.status,200);const id=(await created.json()).id;assert(id);
  await stop();
  // Reopen without initial secret or LC81_INIT.
  client=await start(dataDir);assert((await admin(client)).units.some(x=>x.id===id&&x.code==='QA-DEPLOY-PERSIST'));await stop();
  maintenance('backup',dataDir,backup);maintenance('restore-new',backup,restored);
  client=await start(restored);assert((await admin(client)).units.some(x=>x.id===id&&x.code==='QA-DEPLOY-PERSIST'));await stop();
  // Restore cannot overwrite an existing directory.
  const refusal=spawnSync(process.execPath,['server/lc81-maintenance.mjs','restore-new',backup,restored],{env:{...env,LC81_QA:'1'},encoding:'utf8',timeout:30000});assert.notEqual(refusal.status,0);
 }finally{try{await stop()}finally{await fs.rm(root,{recursive:true,force:true})}}
});

test('Amvera generated recipe accepts the observed safe configuration and rejects the previous server',async()=>{
 const file='amvera.yml',original=await fs.readFile(file),identity=cloudIdentity();
 // Exact observed platform shape, including YAML document marker,
 // platform defaults and single-writer restart. Only scriptName was fixed.
 const observed=[
  '---','meta:','  environment: nodejs','  toolchain:',
  '    name: npm','    version: 22','build:','  skip: false',
  '  additionalCommands: node tools/build_folder.mjs --cloud',
  '  artifacts:',"    '*': /",'run:','  persistenceMount: /data',
  '  scriptName: server/lc81-main.mjs','  scriptArguments: null',
  '  nodeArguments: null','  command: null','  containerPort: 8080',
  '  singleton: true','  zeroDowntime: false',''
 ].join('\n');
 assert.equal(original.toString('utf8'),observed);
 const formatted=[
  '--- # generated','run:','    persistenceMount: "/data"','    containerPort: 8080',
  '    scriptName: server/lc81-main.mjs # QA','    command: null','    nodeArguments: null',
  '    scriptArguments: null','    zeroDowntime: false','    singleton: true','meta:',
  '    toolchain:', '        version: 22', "        name: 'npm'",
  '    environment: node','build:',
  '    additionalCommands: node tools/build_folder.mjs --cloud','    skip: false',
  '    artifacts:','        "*": /',''
 ].join('\r\n');
 try{
  for(const text of [observed,formatted,observed.trimEnd()]){await fs.writeFile(file,text);assert.deepEqual(cloudIdentity(),identity)}
  const variations=[
   observed.replace('server/lc81-main.mjs','server/main.mjs'),
   observed.replace('8080','9090'),observed.replace('/data','/tmp'),
   observed.replace('--cloud','--cloud && echo unsafe'),
   observed.replace('version: 22','version: 20'),
   observed.replace('containerPort: 8080','containerPort: 8080\n  containerPort: 8080'),
   observed.replace('environment: nodejs','environment: &e nodejs'),
   observed+'extra: value\n',
   observed.replace('singleton: true','singleton: false'),
   observed.replace('zeroDowntime: false','zeroDowntime: true'),
   observed.replace('command: null','command: node server/main.mjs'),
   observed.replace('nodeArguments: null','nodeArguments: --require evil.js'),
   observed.replace('scriptArguments: null','scriptArguments: extra'),
   observed.replace('skip: false','skip: true'),
   observed.replace("'*': /","'*': /tmp"),
   observed.replace("'*': /","'*': /\n    extra: /"),
   observed.replace('  singleton: true\n',''),
   observed.replace('  environment: nodejs','    environment: nodejs'),
   observed+'---\n'
  ];
  for(const text of variations){await fs.writeFile(file,text);assert.throws(()=>cloudIdentity(),/Cloud source changed: amvera.yml/)}
 }finally{await fs.writeFile(file,original)}
 assert.deepEqual(cloudIdentity(),identity);
});

test('Amvera restores only the verified canonical npm lock; all other source changes still fail closed',async()=>{
 const lock='package-lock.json',canonical='tools/lc81-amvera-package-lock.json',manifest='package.json';
 const original=await fs.readFile(lock),copy=await fs.readFile(canonical),pkg=await fs.readFile(manifest);
 assert(original.equals(copy));
 const identity=cloudIdentity();
 const changed=JSON.parse(original.toString('utf8'));changed.packages['node_modules/echarts'].version='0.0.0';
 const rewritten=JSON.stringify(changed,null,2)+'\n';
 try{
  await fs.writeFile(lock,rewritten);
  assert.throws(()=>cloudIdentity(),/Cloud source changed: package-lock.json/);
  await fs.writeFile(manifest,Buffer.concat([pkg,Buffer.from('\n')]));
  assert.throws(()=>cloudIdentity(process.cwd(),{restoreNpmLock:true}),/Cloud source changed: package.json/);
  assert.equal(await fs.readFile(lock,'utf8'),rewritten,'other invalid sources must prevent lock recovery');
  await fs.writeFile(manifest,pkg);
  await fs.writeFile(canonical,rewritten);
  assert.throws(()=>cloudIdentity(process.cwd(),{restoreNpmLock:true}),/Unverified LC8.1 canonical npm lock or recipe/);
  assert.equal(await fs.readFile(lock,'utf8'),rewritten);
  await fs.writeFile(canonical,copy);
  assert.deepEqual(cloudIdentity(process.cwd(),{restoreNpmLock:true}),identity);
  assert((await fs.readFile(lock)).equals(original));
  assert.deepEqual(cloudIdentity(),identity);
 }finally{
  await fs.writeFile(lock,original);await fs.writeFile(canonical,copy);await fs.writeFile(manifest,pkg);
 }
});

test('startup refusal explains configuration and storage problems without printing secrets or touching existing data',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-startup-diagnostics-'));
 const password=randomBytes(24).toString('base64url'),secretCanary='QA-secret-canary-'+password,env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('LC81_')||key.startsWith('LC_PILOT_')||key.startsWith('LC_BOOTSTRAP_')||key==='PORT')delete env[key];
 const fresh=path.join(root,'fresh'),empty=path.join(root,'empty'),locked=path.join(root,'locked'),corrupt=path.join(root,'corrupt');
 const settings={...env,LC81_QA:'1',LC81_DATA_DIR:fresh,LC81_ORIGIN:origin,LC81_INIT:'1',LC_BOOTSTRAP_ADMIN_PASSWORD:secretCanary};
 function refuse(overrides,code){
  const r=spawnSync(process.execPath,['server/lc81-main.mjs'],{env:{...settings,...overrides},encoding:'utf8',timeout:20000});
  assert.equal(r.status,1,'startup must refuse '+code);
  assert(r.stderr.includes('LC8.1 QA startup refused: '+code+'. No secrets logged.'),'missing safe startup code '+code);
  assert(!((r.stdout||'')+(r.stderr||'')).includes(secretCanary),'secret must never appear in diagnostics');
 }
 try{
  refuse({LC81_QA:'0'},'QA_MODE_REQUIRED');
  refuse({LC_PILOT_USERS:secretCanary},'LEGACY_ENV_PRESENT');
  refuse({LC81_DATA_DIR:'relative'},'DATA_PATH_INVALID');
  refuse({LC81_ORIGIN:'https://qa.example.invalid/'},'ORIGIN_INVALID');
  refuse({LC81_ORIGIN:'https://'+secretCanary+'@qa.example.invalid'},'ORIGIN_INVALID');
  refuse({LC81_SITE_TIME_ZONE:'not/a/zone'},'TIME_ZONE_INVALID');
  refuse({PORT:'invalid'},'PORT_INVALID');
  refuse({LC81_DATA_DIR:path.join(root,'absent','child')},'DATA_PARENT_MISSING');
  refuse({LC81_INIT:'0'},'INIT_REQUIRED');
  refuse({LC_BOOTSTRAP_ADMIN_LOGIN:'bad login'},'BOOTSTRAP_LOGIN_INVALID');
  refuse({LC_BOOTSTRAP_ADMIN_PASSWORD:'short'},'BOOTSTRAP_SECRET_INVALID');
  await assert.rejects(fs.stat(fresh),{code:'ENOENT'});
  await fs.mkdir(empty);refuse({LC81_DATA_DIR:empty},'STORAGE_INCOMPLETE');assert.deepEqual(await fs.readdir(empty),[]);
  await fs.mkdir(locked);await fs.writeFile(path.join(locked,'writer.lock'),'existing');
  refuse({LC81_DATA_DIR:locked},'STORAGE_LOCK_PRESENT');assert.equal(await fs.readFile(path.join(locked,'writer.lock'),'utf8'),'existing');
  await fs.mkdir(corrupt);await fs.writeFile(path.join(corrupt,'secure.lc81'),'bad');await fs.writeFile(path.join(corrupt,'initialized'),'existing');
  refuse({LC81_DATA_DIR:corrupt},'STORAGE_SIZE_INVALID');assert.equal(await fs.readFile(path.join(corrupt,'secure.lc81'),'utf8'),'bad');assert.equal(await fs.readFile(path.join(corrupt,'initialized'),'utf8'),'existing');
  assert.deepEqual((await fs.readdir(corrupt)).sort(),['initialized','secure.lc81']);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
