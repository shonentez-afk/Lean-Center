// Small-pilot load measurement using the real server process, not an in-memory mock.
// Client generator and browser are outside the measured server RSS.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {pilotSql} from '../server/lc74-store.mjs';
import {Workspace,readSnapshot,one,canonical,meta} from '../src/core/db.js';
const {SQL}=await pilotSql(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'lc74-load-'));
const tokens=Array.from({length:4},()=>randomBytes(32).toString('hex'));
const userConfig='HEX1'+Buffer.from(JSON.stringify(Object.fromEntries(tokens.map((token,i)=>['u'+i,{token,role:'editor'}]))),'utf8').toString('hex');
const sock=net.createServer();await new Promise(resolve=>sock.listen(0,'127.0.0.1',resolve));const port=sock.address().port;await new Promise(resolve=>sock.close(resolve));
const base='http://127.0.0.1:'+port;let child,timer,peakRSS=0,exitPromise,logTail='',retries=0,networkRetries=0;
const durations=[];
async function start(){
 child=spawn(process.execPath,['--max-old-space-size=192','server/main.mjs'],{env:{...process.env,PORT:String(port),LC_PILOT_DEMO:'1',LC_PILOT_AI:'1',LC_PILOT_DATA_DIR:dir,LC_PILOT_USERS:userConfig},stdio:['ignore','pipe','pipe']});
 exitPromise=once(child,'exit');child.stdout.on('data',b=>{logTail=(logTail+b).slice(-3000)});child.stderr.on('data',b=>{logTail=(logTail+b).slice(-3000)});
 const sample=async()=>{try{const txt=await fs.readFile('/proc/'+child.pid+'/status','utf8');const k=Number(/VmRSS:\s+(\d+)\s+kB/.exec(txt)?.[1]||0);peakRSS=Math.max(peakRSS,k*1024)}catch{}};
 timer=setInterval(sample,50);
 for(let i=0;i<200;i++){
  if(child.exitCode!==null)throw Error('Server startup failed: '+logTail);
  try{const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).aiEnabled===true)return}catch{}
  await sleep(100)
 }
 throw Error('Server startup timed out: '+logTail)
}
async function stop(){
 clearInterval(timer);if(!child)return;
 if(child.exitCode===null)child.kill('SIGTERM');
 const result=await Promise.race([exitPromise,sleep(12000).then(()=>null)]);
 if(!result){child.kill('SIGKILL');await exitPromise;throw Error('Graceful stop timed out')}
 assert.equal(result[0],0,logTail);child=null
}
async function req(i,route,options={}){
 return fetch(base+route,{...options,headers:{Authorization:'Bearer '+tokens[i],...(options.headers||{})},signal:AbortSignal.timeout(30000)})
}
async function workspace(i){
 const r=await req(i,'/api/v1/snapshot');assert.equal(r.status,200);
 const x=await r.json();return new Workspace(SQL,await readSnapshot(SQL,x.manifest,new Uint8Array(Buffer.from(x.sqlite_base64,'base64'))))
}
async function send(i,pkg){
 const body=canonical(pkg),begin=performance.now();
 for(let n=0;n<30;n++){
  let r,data;try{r=await req(i,'/api/v1/packages',{method:'POST',headers:{'Content-Type':'application/json'},body});data=await r.json()}catch(e){networkRetries++;if(child?.exitCode!==null)throw e;await sleep(Math.min(3000,250*2**Math.min(n,4))+i*50);continue}
  if([429,502,503,504].includes(r.status)){retries++;await sleep(Math.max(Number(r.headers.get('retry-after')||0)*1000,Math.min(3000,250*2**Math.min(n,4)))+i*50);continue}
  assert.equal(r.status,200,JSON.stringify(data));durations.push(performance.now()-begin);return data
 }
 throw Error('Too many queue retries')
}
try{
 await start();
 const all=await Promise.all(tokens.map((_,i)=>workspace(i)));
 try{
  for(let i=0;i<all.length;i++)for(let j=0;j<250;j++)all[i].edit('person',null,{employee_code:'LOAD-'+i+'-'+j,display_name:'Учебный сотрудник '+i+' '+j});
  const packages=await Promise.all(all.map(w=>w.package()));
  const results=await Promise.all(packages.map((p,i)=>send(i,p)));assert(results.every(x=>x.count===250));
  assert.equal((await send(0,packages[0])).duplicate,true)
 }finally{all.forEach(w=>w.close())}
 for(let n=0;n<5;n++){
  const clients=await Promise.all(tokens.map((_,i)=>workspace(i)));
  try{
   const packages=await Promise.all(clients.map((w,i)=>{const row=one(w.working,'SELECT id FROM person WHERE employee_code=?',['LOAD-'+i+'-'+n]);w.edit('person',row.id,{employee_code:'LOAD-'+i+'-'+n,display_name:'Обновлено '+i+' '+n});return w.package()}));
   const results=await Promise.all(packages.map((p,i)=>send(i,p)));assert(results.every(x=>x.count===1))
  }finally{clients.forEach(w=>w.close())}
 }
 const result=await workspace(0),head=await (await req(0,'/api/v1/head')).json();
 try{assert.equal(one(result.working,'SELECT count(*) n FROM person').n,1000);assert.equal(one(result.working,"SELECT count(*) n FROM person WHERE display_name LIKE 'Обновлено %'").n,20);assert.equal(meta(result.base,'publication_id'),head.id)}finally{result.close()}
 await stop();await start();
 const after=await (await req(1,'/api/v1/head')).json();assert.deepEqual(after,head);
 const sorted=durations.sort((a,b)=>a-b),pct=p=>Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]);
 const evidence={clients:4,employees:1000,updates:20,successfulPackages:24,duplicateRetry:true,backpressureRetries:retries,networkRetries,restartSameSnapshot:true,snapshotBytes:head.size,serverPeakRSSBytes:peakRSS,p50Ms:pct(.5),p95Ms:pct(.95),maxMs:pct(1),node:process.version,limitations:'Linux CI, not Amvera; no 0.25 vCPU or container memory quota simulation'};
 assert(peakRSS>0,'Expected Linux RSS measurement');
 await fs.mkdir('artifacts/lc74',{recursive:true});await fs.writeFile('artifacts/lc74/load.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{try{await stop()}finally{await fs.rm(dir,{recursive:true,force:true})}}
