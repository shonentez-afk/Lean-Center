#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 3 && "$2" =~ ^[a-f0-9]{40}$ && "$3" == https://nl6smkdc-18081.eun1.devtunnels.ms ]]
backup="$1"
sha="$2"
origin="$3"
release="$(cd -- "$(dirname -- "$(realpath -- "$0")")/../.." && pwd)"
root="$(dirname -- "$release")"
[[ "$(basename "$release")" == "$sha" && "$(dirname -- "$backup")" == "$root/qa-backups" && ! -L "$backup" ]]
work="$(mktemp -d /tmp/lean-qa-update.XXXXXXXX)"
trap 'rm -rf -- "$work"' EXIT
cd "$release"
env -i PATH=/usr/bin:/bin LC81_QA=1 .runtime/node server/lc81-maintenance.mjs restore-new "$backup" "$work/data" >/dev/null
diff -qr -- "$backup" "$work/data" >/dev/null
timeout --kill-after=8s 60s .runtime/node --input-type=module - "$work/data" "$origin" "$sha" <<'CANDIDATE_SMOKE'
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const [dataDir,origin,sourceCommit]=process.argv.slice(2);
const probe=net.createServer();
await new Promise((resolve,reject)=>{
  probe.once('error',reject);
  probe.listen(0,'127.0.0.1',resolve);
});
const {port}=probe.address();
await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
const child=spawn(process.execPath,['server/lc81-main.mjs'],{
  env:{
    PATH:'/usr/bin:/bin', PORT:String(port), LC81_QA:'1',
    LC81_LOOPBACK_ONLY:'1', LC81_DATA_DIR:dataDir, LC81_ORIGIN:origin
  },
  stdio:'ignore'
});
const finished=new Promise(resolve=>{
  child.once('error',()=>resolve(null));
  child.once('close',code=>resolve(code));
});
const request=(route,options={})=>fetch('http://127.0.0.1:'+port+route,{
  ...options,signal:AbortSignal.timeout(1500)
});
try{
  let health;
  for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!==null||child.signalCode!==null)break;
    try {
      const reply=await request('/healthz');
      if(reply.ok){health=await reply.json();break;}
    } catch {}
    await delay(250);
  }
  assert.deepEqual(health,{ok:true,mode:'LC8.1-QA',complete:false,sourceCommit});
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/api/lc81/session')).status,401);
  assert.equal((await request('/api/lc81/login',{
    method:'POST',
    headers:{Origin:'https://qa.invalid','Content-Type':'application/json','X-LC81-Request':'1'},
    body:'{}'
  })).status,403);
}catch{
  process.exitCode=1;
}finally{
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  try{if(await finished!==0)process.exitCode=1;}finally{clearTimeout(timer);}
}
CANDIDATE_SMOKE
diff -qr -- "$backup" "$work/data" >/dev/null
printf 'CLOUDCORE_QA_EXISTING_DATA_COMPATIBLE\n'
