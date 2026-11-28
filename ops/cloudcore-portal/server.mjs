import http from 'node:http';
import {execFile} from 'node:child_process';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const root=path.join(process.env.HOME,'lean-center-cloudcore-qa');
const live=path.join(root,'private-devtunnel');
const portal=path.join(root,'private-portal');
const backups=path.join(root,'qa-backups');
const journal=path.join(portal,'events.jsonl');
const site='https://nl6smkdc-18081.eun1.devtunnels.ms/';
const origin=process.env.PORTAL_ORIGIN;
if(!/^https:\/\/[a-z0-9-]+-18083\.[a-z0-9-]+\.devtunnels\.ms$/.test(origin??'')){
  throw new Error('Invalid portal origin');
}
const host=new URL(origin).host;
const csrf=randomBytes(32).toString('hex');
const files=new Map();
for(const [route,name,type] of [
  ['/','index.html','text/html'],
  ['/portal.css','portal.css','text/css'],
  ['/portal.js','portal.js','text/javascript']
]){
  files.set(route,{bytes:await fs.readFile(fileURLToPath(new URL(name,import.meta.url))),type});
}
const actions={snapshot:'backup',restart:'restart'};
const backupName=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[a-zA-Z0-9]{8}$/;
const logType=new Set(['backup','restart']);
let operation=null;

async function readSmall(filename) {
  try{return (await fs.readFile(filename,'utf8')).trim();}catch{return '';}
}
async function tail(filename) {
  let file;
  try{
    file=await fs.open(filename,'r');
    const position=Math.max(0,(await file.stat()).size-16000);
    const buf=Buffer.alloc(16000);
    const {bytesRead}=await file.read(buf,0,buf.length,position);
    const lines=buf.subarray(0,bytesRead).toString('utf8').split('\n');
    return position ? lines.slice(1) : lines;
  }catch{
    return [];
  }finally{
    await file?.close();
  }
}
function dateFromName(name) {
  const m=backupName.exec(name);
  return m && new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])).toISOString();
}
async function backupList() {
  let entries;
  try{entries=await fs.readdir(backups,{withFileTypes:true});}catch{return [];}
  const names=entries.filter(e=>e.isDirectory()&&backupName.test(e.name))
    .map(e=>e.name).sort().reverse().slice(0,20);
  const records=await Promise.all(names.map(async name=>{
    try{
      const checkpoint=await fs.lstat(path.join(backups,name,'secure.lc81'));
      const marker=await fs.lstat(path.join(backups,name,'initialized'));
      if(checkpoint.isFile()&&marker.isFile())return {name,when:dateFromName(name),bytes:checkpoint.size};
    }catch{}
    return null;
  }));
  return records.filter(Boolean);
}
async function eventsList() {
  const [manual,scheduled,backupLog]=await Promise.all([
    tail(journal),
    tail(path.join(live,'backup.log')),
    fs.stat(path.join(live,'backup.log')).catch(()=>null)
  ]);
  const events=[];
  for(const line of manual){
    try{
      const event=JSON.parse(line);
      if(logType.has(event.type)&&['running','ok','failed'].includes(event.status)&&
        typeof event.when==='string'&&Number.isFinite(Date.parse(event.when))){
        events.push({type:event.type,status:event.status,when:event.when,via:'portal'});
      }
    }catch{}
  }
  for(const line of scheduled){
    if(line.startsWith('QA_BACKUP_PATH=')){
      const name=path.basename(line.slice('QA_BACKUP_PATH='.length));
      const when=dateFromName(name);
      if(when) events.push({type:'backup',status:'ok',when,via:'schedule'});
    }
  }
  const lastAttempt=scheduled.filter(line=>/^(QA_BACKUP_FAILED|QA_BACKUP_PATH=|QA_PROCESS_STARTED|FAILED_|START_TIMEOUT|STOP_TIMEOUT)/.test(line)).at(-1);
  if(lastAttempt&&/^(QA_BACKUP_FAILED|FAILED_|START_TIMEOUT|STOP_TIMEOUT)/.test(lastAttempt)&&backupLog){
    events.push({type:'backup',status:'failed',when:backupLog.mtime.toISOString(),via:'schedule'});
  }
  return events.sort((a,b)=>Date.parse(b.when)-Date.parse(a.when)).slice(0,14);
}
async function health() {
  try{
    const response=await fetch('http://127.0.0.1:18081/healthz',{signal:AbortSignal.timeout(1300)});
    const state=await response.json();
    if(response.ok&&state.ok===true&&state.mode==='LC8.1-QA'&&/^[a-f0-9]{40}$/.test(state.sourceCommit)){
      return {ok:true,sha:state.sourceCommit};
    }
  }catch{}
  return {ok:false,sha:null};
}
async function overview() {
  const [app,relay,active,items,events]=await Promise.all([
    health(),readSmall(path.join(live,'status')),readSmall(path.join(live,'active-release')),backupList(),eventsList()
  ]);
  const [sha,run]=active.split(' ');
  return {
    site,app:app.ok,relay:relay==='READY',sha:app.sha??(/^[a-f0-9]{40}$/.test(sha)?sha:null),
    run:/^[0-9]{1,9}$/.test(run)?run:null,backups:items,events,operation,csrf
  };
}
function writeEvent(event) {
  return fs.appendFile(journal,JSON.stringify(event)+'\n',{mode:0o600});
}
async function runAction(command) {
  const type=actions[command];
  const when=new Date().toISOString();
  operation={type,when};
  try{
    await writeEvent({type,when,status:'running'});
    let status='ok';
    try{
      await exec('/bin/bash',[path.join(live,'control-named.sh'),command],{
        cwd:live,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME},maxBuffer:16000
      });
    }catch{status='failed';}
    await writeEvent({type,when:new Date().toISOString(),status});
  }finally{operation=null;}
}
function reply(res,status,body,type='application/json') {
  const payload=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  res.writeHead(status,{
    'Content-Type':type+'; charset=utf-8','Content-Length':payload.length,
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()'
  });
  res.end(payload);
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==host){reply(res,421,{error:'Адрес не совпадает'});return;}
    if(req.method==='GET'){
      const file=files.get(req.url);
      if(file){reply(res,200,file.bytes,file.type);return;}
      if(req.url==='/api/overview'){reply(res,200,await overview());return;}
    }
    if(req.method==='POST'&&(req.url==='/api/snapshot'||req.url==='/api/restart')){
      const supplied=req.headers['x-lean-ops-csrf'];
      if(req.headers.origin!==origin||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')||
        typeof supplied!=='string'||! /^[a-f0-9]{64}$/.test(supplied)||
        !timingSafeEqual(Buffer.from(supplied),Buffer.from(csrf))){
        reply(res,403,{error:'Запрос отклонён. Обновите страницу.'});return;
      }
      if(req.headers['transfer-encoding']||(req.headers['content-length']&&req.headers['content-length']!=='0')){
        reply(res,400,{error:'Тело запроса не поддерживается'});return;
      }
      if(operation){reply(res,409,{error:'Операция уже выполняется'});return;}
      runAction(req.url.slice('/api/'.length)).catch(()=>{console.error('PORTAL_ACTION_LOG_FAILED');});
      reply(res,202,{accepted:true});return;
    }
    reply(res,404,{error:'Страница не найдена'});
  }catch{
    reply(res,503,{error:'Портал временно недоступен'});
  }
});
server.listen(18083,'127.0.0.1');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());
