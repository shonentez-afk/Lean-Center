import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {PilotError} from './lc74-store.mjs';
import {MAX_PACKAGE} from '../src/core/db.js';
import {MAX_CONTENT} from '../src/modules/library/domain.js';
const digest=s=>createHash('sha256').update(s).digest();
export function parsePilotUsers(raw){
 let users;
 try{users=JSON.parse(raw||'null')}catch{throw Error('LC_PILOT_USERS: требуется JSON')}
 if(!users||typeof users!=='object'||Array.isArray(users)||Object.keys(users).length<1||Object.keys(users).length>20)throw Error('LC_PILOT_USERS: требуется 1–20 тестовых учётных записей');
 const keys=new Set();
 return Object.entries(users).map(([name,v])=>{
  if(!/^[a-zA-Z0-9_-]{1,40}$/.test(name)||!v||!['editor','viewer'].includes(v.role)||typeof v.token!=='string'||!/^[0-9a-f]{64}$/i.test(v.token)||keys.has(v.token))throw Error('LC_PILOT_USERS: неверная роль или уникальный 64-символьный hex-токен');
  keys.add(v.token);return {name,role:v.role,hash:digest(v.token)}
 })
}
function authenticate(req,users){
 const m=/^Bearer ([0-9a-f]{64})$/i.exec(req.headers.authorization||'');
 if(!m)throw new PilotError(401,'Необходим токен тестовой учётной записи');
 const hash=digest(m[1]),user=users.find(u=>timingSafeEqual(u.hash,hash));
 if(!user)throw new PilotError(401,'Неверный токен');
 return user
}
async function textBody(req,max){
 const len=req.headers['content-length'];
 if(len!==undefined&&(!/^\d+$/.test(len)||Number(len)>max))throw new PilotError(413,'Запрос превышает лимит');
 const chunks=[];let n=0;
 for await(const chunk of req){n+=chunk.length;if(n>max)throw new PilotError(413,'Запрос превышает лимит');chunks.push(chunk)}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))}catch{throw new PilotError(400,'Неверный UTF-8')}
}
function reply(res,status,body,type='application/json; charset=utf-8',csp="default-src 'none'; frame-ancestors 'none'; base-uri 'none'"){
 const b=Buffer.isBuffer(body)?body:Buffer.from(type.startsWith('application/json')?JSON.stringify(body):String(body));
 res.writeHead(status,{'Content-Type':type,'Content-Length':b.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':csp});res.end(b)
}
const landing='<!doctype html><html lang="ru"><meta charset="utf-8"><title>Центр TWI — LC7.4.0</title><h1>Центр TWI · серверный тестовый стенд</h1><p>Это экспериментальный API для синтетических данных, не рабочий интерфейс Центра TWI.</p><p>Доступность: <a href="/healthz">healthz</a>. Данные доступны только по токену.</p></html>';
// Serve only checked public build assets. Never serve data or repository files.
const cloudCsp="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; frame-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
export async function pilotAssets(root){
 const m=JSON.parse(await fs.readFile(path.join(root,'app-manifest.json'),'utf8'));
 if(m.version!=='lc7.4.2-cloud-pilot')throw Error('Expected dedicated cloud build');
 const files=new Map();
 for(const item of m.files){
  if(item.path!=='index.html'&&!/^versions\/lc7\.4\.2-cloud-pilot\/[a-zA-Z0-9._/-]+$/.test(item.path))continue;
  if(item.path.split('/').some(x=>x==='.'||x==='..'||!x))throw Error('Invalid asset path');
  const type=types[path.extname(item.path)];if(!type)continue;
  const file=path.resolve(root,item.path),bytes=await fs.readFile(file);
  if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Invalid cloud asset '+item.path);
  files.set('/'+item.path,{file,type})
 }
 if(!files.has('/index.html'))throw Error('Missing cloud index');
 files.set('/',files.get('/index.html'));
 return files
}
export function createPilotServer({store,users,assets=null}){
 let active=0,writes=0;
 const server=http.createServer(async(req,res)=>{
  if(active>=24){reply(res,429,{error:'Сервер занят'});return}
  active++;let reserved=false;
  const reserveWrite=()=>{if(writes>=2)throw new PilotError(429,'Очередь загрузки занята; повторите позже');writes++;reserved=true};
  try{
   const url=new URL(req.url,'http://localhost'),p=url.pathname;
   if(req.method==='GET'&&p==='/healthz'){reply(res,store.healthy?200:503,{ok:store.healthy,pilot:assets?'LC7.4.2':'LC7.4.0'});return}
   if(req.method==='GET'&&assets?.has(p)){const a=assets.get(p);reply(res,200,await fs.readFile(a.file),a.type,cloudCsp);return}
   if(req.method==='GET'&&p==='/'&&!assets){reply(res,200,landing,'text/html; charset=utf-8');return}
   const user=authenticate(req,users);
   if(req.method==='GET'&&p==='/api/v1/session'){reply(res,200,{user:user.name,role:user.role,pilot:true});return}
   if(req.method==='GET'&&p==='/api/v1/head'){reply(res,200,store.head());return}
   if(req.method==='GET'&&p==='/api/v1/snapshot'){
    const s=store.snapshot();reply(res,200,{manifest:s.manifest,sqlite_base64:Buffer.from(s.bytes).toString('base64')});return
   }
   const document=/^\/api\/v1\/documents\/([0-9a-f]{64})$/.exec(p);
   if(req.method==='GET'&&document){reply(res,200,await store.getSource(document[1]),'application/octet-stream');return}
   if(req.method==='POST'&&p==='/api/v1/packages'){
    if(user.role!=='editor')throw new PilotError(403,'Только редактор может сохранять изменения');
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new PilotError(415,'Ожидается application/json');
    reserveWrite();const text=await textBody(req,MAX_PACKAGE);
    let pkg;try{pkg=JSON.parse(text)}catch{throw new PilotError(400,'Неверный JSON пакета')}
    reply(res,200,await store.commit(pkg));return
   }
   if(req.method==='PUT'&&document){
    if(user.role!=='editor')throw new PilotError(403,'Только редактор может сохранять исходники');
    if(!['sop','frv'].includes(url.searchParams.get('kind')))throw new PilotError(400,'Неверный тип исходника');
    reserveWrite();const text=await textBody(req,MAX_CONTENT);
    reply(res,200,await store.putSource(document[1],url.searchParams.get('kind'),text));return
   }
   throw new PilotError(404,'Маршрут не найден')
  }catch(e){
   if(!res.headersSent&&!res.destroyed)reply(res,e instanceof PilotError?e.status:503,{error:e instanceof PilotError?e.message:'Ошибка хранилища; данные не подтверждены'});
   else if(!res.destroyed)res.destroy()
  }finally{active--;if(reserved)writes--}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=3000;server.maxConnections=32;
 return server
}
