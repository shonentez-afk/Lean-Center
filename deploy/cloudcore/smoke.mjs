import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import path from 'node:path';

const dataDir=path.resolve('data');
const checkedSource=JSON.parse(await fs.readFile('tools/cloud-source.json','utf8')).sourceCommit;
const password=randomBytes(24).toString('base64url');
const origin='https://localhost:18081';
let phase='BOOTSTRAP';

async function withServer(initialize, check) {
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',resolve);
  });
  const {port}=probe.address();
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  const child=spawn(process.execPath,['server/lc81-main.mjs'],{
    env:{
      PATH:'/usr/bin:/bin',
      PORT:String(port),
      LC81_QA:'1',
      LC81_LOOPBACK_ONLY:'1',
      LC81_DATA_DIR:dataDir,
      LC81_ORIGIN:origin,
      ...(initialize?{
        LC81_INIT:'1',
        LC81_SITE_TIME_ZONE:'Asia/Krasnoyarsk',
        LC_BOOTSTRAP_ADMIN_PASSWORD:password
      }:{})
    },
    stdio:['ignore','ignore','pipe']
  });
  let diagnostic='';
  child.stderr.setEncoding('utf8').on('data',chunk=>{
    diagnostic=(diagnostic+chunk).slice(-4096);
  });
  const finished=new Promise(resolve=>{
    child.once('error',()=>resolve(null));
    child.once('close',code=>resolve(code));
  });

  function request(route,options={}) {
    return fetch('http://127.0.0.1:'+port+route,{...options,signal:AbortSignal.timeout(2000)});
  }

  try {
    let health;
    for(let attempt=0;attempt<80;attempt++) {
      if(child.exitCode!==null||child.signalCode!==null)break;
      try{
        const response=await request('/healthz');
        if(response.ok){health=await response.json();break}
      }catch{}
      await pause(250);
    }
    assert.deepEqual(health,{ok:true,mode:'LC8.1-QA',complete:false,sourceCommit:checkedSource});
    assert.equal((await request('/')).status,200);
    assert.equal((await request('/api/lc81/session')).status,401);
    const body=JSON.stringify({login:'admin',password});
    const headers={'Content-Type':'application/json','X-LC81-Request':'1'};
    assert.equal((await request('/api/lc81/login',{method:'POST',headers:{...headers,Origin:'https://qa.invalid'},body})).status,403);
    const login=await request('/api/lc81/login',{method:'POST',headers:{...headers,Origin:origin},body});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');
    assert.match(cookie,/; Secure; HttpOnly; SameSite=Strict/);
    const sessionHeaders={Cookie:cookie.split(';')[0]};
    const admin=await request('/api/lc81/admin',{headers:sessionHeaders});
    assert.equal(admin.status,200);
    await check(await admin.json(),(route,payload)=>request(route,{
      method:'POST',headers:{...headers,...sessionHeaders,Origin:origin},body:JSON.stringify(payload)
    }));
  } catch(error) {
    const code=diagnostic.match(/LC8\.1 QA startup refused: ([A-Z0-9_]+)\. No secrets logged\./)?.[1];
    if(code)process.stderr.write('LC81_STARTUP_'+code+'\n');
    throw error;
  } finally {
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
    try{assert.equal(await finished,0,'QA process must stop cleanly')}finally{clearTimeout(timer)}
  }
}

try {
  await fs.writeFile('admin-password',password+'\n',{mode:0o600,flag:'wx'});
  let id;
  await withServer(true,async(admin,write)=>{
    const result=await write('/api/lc81/admin/reference',{
      type:'org_unit',
      payload:{code:'QA-CLOUDCORE',name:'Учебный участок CloudCore',kind:'Участок',parent_id:admin.site}
    });
    assert.equal(result.status,200);
    id=(await result.json()).id;
    assert.ok(id);
  });
  phase='RESTART';
  await withServer(false,async admin=>{
    assert.ok(admin.units.some(unit=>unit.id===id&&unit.code==='QA-CLOUDCORE'));
  });
} catch {
  process.stderr.write('LC81_SMOKE_'+phase+'\n');
  process.exitCode=1;
}
