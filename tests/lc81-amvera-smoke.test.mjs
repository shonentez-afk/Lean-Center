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
