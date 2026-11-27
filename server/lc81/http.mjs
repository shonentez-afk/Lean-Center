import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {editorFrame} from './editor-frame.mjs';
import {PilotError} from '../lc74-store.mjs';
import {normalizeLogin,tokenDigest} from './credentials.mjs';
const COOKIE='__Host-lc81',SESSION_MS=8*60*60*1000,MAX_SESSIONS=256;
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const publicFiles=new Map(await Promise.all([
 ['/', './portal.html','text/html; charset=utf-8'],
 ['/portal.js','./portal.js','text/javascript; charset=utf-8'],
 ['/library-ui.js','./library-ui.js','text/javascript; charset=utf-8'],
 ['/training-ui.js','./training-ui.js','text/javascript; charset=utf-8'],
 ['/portal.css','./portal.css','text/css; charset=utf-8'],
 ['/assets/styles.css','../../src/ui/styles.css','text/css; charset=utf-8'],
 ['/assets/cloud-pilot.css','../../src/ui/cloud-pilot.css','text/css; charset=utf-8'],
 ['/assets/twi-workplace.webp','../../src/ui/brand/twi-workplace.webp','image/webp'],
 ['/assets/tn-two-line-light.svg','../../src/ui/brand/tn-two-line-light.svg','image/svg+xml'],
 ['/assets/tn-two-line-dark.svg','../../src/ui/brand/tn-two-line-dark.svg','image/svg+xml'],
 ['/assets/favicon.png','../../src/ui/brand/favicon.png','image/png'],
 ['/shared/navigation.js','../../src/ui/navigation.js','text/javascript; charset=utf-8'],
 ['/shared/registry-fields.js','../../src/ui/registry-fields.js','text/javascript; charset=utf-8'],
 ['/shared/form-guard.js','../../src/ui/form-guard.js','text/javascript; charset=utf-8'],
 ['/shared/cloud-save-state.js','../../src/ui/cloud-save-state.js','text/javascript; charset=utf-8']
].map(async ([url,file,type])=>[url,{type,bytes:await fs.readFile(fileURLToPath(new URL(file,import.meta.url)))}])));
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
function reply(res,status,value,type='application/json; charset=utf-8',headers={}){
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value),'utf8');
 res.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",...headers});res.end(bytes);
}
async function body(req,max=32768){
 must(/^application\/json(?:;|$)/i.test(req.headers['content-type']||''),415,'Ожидается JSON');
 const len=req.headers['content-length'];must(len===undefined||/^\d+$/.test(len)&&Number(len)<=max,413,'Запрос слишком большой');
 const parts=[];let n=0;for await(const b of req){n+=b.length;must(n<=max,413,'Запрос слишком большой');parts.push(b)}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)))}catch{throw new PilotError(400,'Неверный JSON')}
}
function rawCookie(req){
 const all=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
 const s=all.length===1?all[0].slice(COOKIE.length+1):'';
 return /^[a-f0-9]{64}$/.test(s)?s:null;
}
const cookie=(s,maxAge)=>COOKIE+'='+s+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
export function createSecureQAServer({store,origin}){
 const u=new URL(origin);must(u.protocol==='https:'&&u.origin===origin,503,'Требуется точный HTTPS origin');
 const sessions=new Map(),attempts=new Map();let active=0,loginBusy=0,libraryBusy=0;
 const prune=now=>{for(const [k,v] of sessions)if(v.expires<=now)sessions.delete(k);for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k)};
 const getSession=req=>{
  const raw=rawCookie(req),key=raw&&tokenDigest(raw),s=key&&sessions.get(key);
  must(s&&s.expires>Date.now(),401,'Необходим вход');
  const a=store.session(s.accountId,s.revision);if(!a){sessions.delete(key);throw new PilotError(401,'Сеанс завершён')}
  return {a,key};
 };
 const limiter=(name,ip)=>{
  const now=Date.now();prune(now);
  const ks=['login:'+name,'network:'+ip,'global'];const limits=[6,30,60];
  for(let i=0;i<ks.length;i++)must((attempts.get(ks[i])?.count||0)<limits[i],429,'Слишком много попыток; повторите позже');
  must(attempts.size<4096,429,'Слишком много попыток');
  for(const k of ks){const old=attempts.get(k);attempts.set(k,{count:(old?.count||0)+1,until:old?.until||now+300000})}
 };
 const server=http.createServer(async(req,res)=>{
  if(active>=24){reply(res,429,{error:'Сервер занят'});return}active++;
  try{
   const url=new URL(req.url,'http://localhost'),p=url.pathname;
   if(req.method==='GET'&&p==='/healthz'){reply(res,store.healthy?200:503,{ok:store.healthy,mode:'LC8.1-QA',complete:false});return}
   if(req.method==='GET'&&publicFiles.has(p)){const f=publicFiles.get(p);reply(res,200,f.bytes,f.type);return}
   // No legacy bearer authentication, full snapshot, source download or generic event package.
   must(!p.startsWith('/api/v1/'),404,'Маршрут недоступен в LC8.1');
   if(req.method==='POST')must(req.headers.origin===origin&&req.headers['x-lc81-request']==='1',403,'Запрос другого происхождения запрещён');
   if(req.method==='POST'&&p==='/api/lc81/login'){
    const b=await body(req);must(keys(b,['login','password']),400,'Неверные поля входа');
    const name=normalizeLogin(b.login)||'invalid';
    must(loginBusy<1,429,'Вход занят');loginBusy++;
    try{
     limiter(name,req.socket.remoteAddress||'unknown');
     const a=store.authenticate(b.login,b.password);must(a,401,'Неверный логин или пароль');
     const old=rawCookie(req);if(old)sessions.delete(tokenDigest(old));
     prune(Date.now());must(sessions.size<MAX_SESSIONS,429,'Слишком много активных сеансов');
     const raw=randomBytes(32).toString('hex');sessions.set(tokenDigest(raw),{accountId:a.id,revision:a.credential_revision,expires:Date.now()+SESSION_MS});
     reply(res,200,{user:a},undefined,{'Set-Cookie':cookie(raw,SESSION_MS/1000)});return;
    }finally{loginBusy--}
   }
   const {a,key}=getSession(req);
   if(req.method==='GET'&&p==='/api/lc81/session'){reply(res,200,{user:a,mode:'LC8.1-QA'});return}
   if(req.method==='POST'&&p==='/api/lc81/logout'){sessions.delete(key);reply(res,200,{ok:true},undefined,{'Set-Cookie':cookie('',0)});return}
   if(req.method==='GET'&&p==='/api/lc81/admin'){reply(res,200,store.adminData(a.id));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/reference'){const b=await body(req);must(keys(b,['type','payload']),400,'Неверные поля');reply(res,200,await store.createReference(a.id,b.type,b.payload));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/account'){reply(res,200,await store.createAccount(a.id,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/state'){const b=await body(req);must(keys(b,['id','state']),400,'Неверные поля');reply(res,200,await store.setState(a.id,b.id,b.state));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/policy'){reply(res,200,await store.setPolicy(a.id,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/grant'){reply(res,200,await store.grant(a.id,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/revoke'){const b=await body(req);must(keys(b,['id']),400,'Неверные поля');reply(res,200,await store.revoke(a.id,b.id));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/manager-policy'){reply(res,200,await store.upgradeManagerPolicy(a.id,await body(req)));return}
   if(req.method==='GET'&&p==='/editor/frame'){
    const kind=url.searchParams.get('kind'),tab=url.searchParams.get('tab')||null;
    must(['sop','frv'].includes(kind)&&a.permissions.some(x=>x===kind+'.create'||x===kind+'.edit_draft'||kind==='sop'&&x==='sop.revise'),403,'Редактор недоступен');
    const html=editorFrame(url.searchParams.get('session'),kind,tab);
    reply(res,200,html,'text/html; charset=utf-8',{'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"sandbox allow-scripts allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src data: blob:; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; child-src 'none'"});
    return;
   }
   if(req.method==='GET'&&p==='/api/lc81/training/options'){reply(res,200,store.trainingOptions(a.id,a.credential_revision,url.searchParams.get('operation_id')));return}
   if(req.method==='GET'&&p==='/api/lc81/training/detail'){reply(res,200,store.trainingDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/training/sop'){reply(res,200,store.trainingSop(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/training/create'){
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{reply(res,200,await store.createTraining(a.id,a.credential_revision,await body(req)));return}finally{libraryBusy--}
   }
   if(req.method==='POST'&&p==='/api/lc81/training/change'){reply(res,200,await store.changeTraining(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/program/options'){reply(res,200,store.programOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/program/detail'){reply(res,200,store.programDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/program/save'){reply(res,200,await store.saveProgram(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/program/retire'){reply(res,200,await store.retireProgram(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/enrollment/options'){reply(res,200,store.enrollmentOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/enrollment/detail'){reply(res,200,store.enrollmentDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/enrollment/create'){reply(res,200,await store.createEnrollment(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/enrollment/change'){reply(res,200,await store.changeEnrollment(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/preparation/options'){reply(res,200,store.preparationOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/preparation/fact-options'){reply(res,200,store.preparationFactOptions(a.id,a.credential_revision,url.searchParams.get('id'),url.searchParams.get('on')));return}
   if(req.method==='POST'&&p==='/api/lc81/preparation/fact'){reply(res,200,await store.recordPreparationFact(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/preparation/detail'){reply(res,200,store.preparationDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/preparation/create'){reply(res,200,await store.createPreparation(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/order/options'){reply(res,200,store.orderOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/order/detail'){reply(res,200,store.orderDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/order/register'){reply(res,200,await store.registerOrder(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/supplement/options'){reply(res,200,store.supplementOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/supplement/detail'){reply(res,200,store.supplementDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/supplement/create'){reply(res,200,await store.createSupplement(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/supplement/change'){reply(res,200,await store.changeSupplement(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/development/options'){reply(res,200,store.developmentOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/development/detail'){reply(res,200,store.developmentDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/development/create'){reply(res,200,await store.createDevelopment(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/development/change'){reply(res,200,await store.changeDevelopment(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/development/from-matrix'){reply(res,200,await store.developmentFromMatrix(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/bank/options'){reply(res,200,store.bankOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/bank/detail'){reply(res,200,store.bankDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/bank/save'){reply(res,200,await store.saveBank(a.id,a.credential_revision,await body(req,2*1024*1024)));return}
   if(req.method==='GET'&&p==='/api/lc81/quality/options'){reply(res,200,store.qualityOptions(a.id,a.credential_revision,url.searchParams.get('kind')));return}
   if(req.method==='GET'&&p==='/api/lc81/quality/detail'){reply(res,200,store.qualityDetail(a.id,a.credential_revision,url.searchParams.get('kind'),url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/quality/install'){reply(res,200,await store.installMentorMethod(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/quality/audit'){reply(res,200,await store.createAudit(a.id,a.credential_revision,await body(req,512*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/quality/self'){reply(res,200,await store.createSelf(a.id,a.credential_revision,await body(req,512*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/quality/void'){reply(res,200,await store.voidAudit(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/tasks/detail'){reply(res,200,store.taskDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/tasks/options'){reply(res,200,await store.taskOptions(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/tasks/create'){reply(res,200,await store.createTask(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/tasks/change'){reply(res,200,await store.changeTask(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/mentor/options'){reply(res,200,store.mentorOptions(a.id,a.credential_revision,url.searchParams.get('kind')));return}
   if(req.method==='POST'&&p==='/api/lc81/mentor/change'){reply(res,200,await store.changeMentor(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/competency/options'){reply(res,200,store.competencyOptions(a.id,a.credential_revision,url.searchParams.get('kind'),url.searchParams.get('person_id'),url.searchParams.get('skill_id')));return}
   if(req.method==='POST'&&p==='/api/lc81/competency/change'){reply(res,200,await store.competencyChange(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/assessment/detail'){reply(res,200,store.assessmentDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/matrix/info'){reply(res,200,store.matrixInfo(a.id,a.credential_revision,url.searchParams.get('unit_id'),url.searchParams.get('base_on'),Object.fromEntries(['shift_id','profession_id','workplace_id','category_id'].map(k=>[k,url.searchParams.get(k)]))));return}
   if(req.method==='GET'&&p==='/api/lc81/matrix/detail'){reply(res,200,store.matrixDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/matrix/save'){reply(res,200,await store.saveMatrix(a.id,a.credential_revision,await body(req,2*1024*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/matrix/retire'){reply(res,200,await store.retireMatrix(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/person/card'){reply(res,200,store.personCard(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/library/info'){reply(res,200,store.libraryInfo(a.id,url.searchParams.get('kind')));return}
   if(req.method==='GET'&&p==='/api/lc81/library/detail'){
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{reply(res,200,{data:await store.libraryDetail(a.id,a.credential_revision,url.searchParams.get('action'),url.searchParams.get('id'))});return}finally{libraryBusy--}
   }
   if(req.method==='POST'&&['/api/lc81/library/open','/api/lc81/library/save'].includes(p)){
    must(a.permissions.some(x=>['sop.create','sop.edit_draft','sop.revise','frv.create','frv.edit_draft'].includes(x)),403,'Редактор недоступен');
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{
     const result=p.endsWith('/open')?await store.openLibrary(a.id,a.credential_revision,await body(req)):await store.saveLibrary(a.id,a.credential_revision,await body(req,2*30*1024*1024+65536));
     reply(res,200,result);return;
    }finally{libraryBusy--}
   }
   if(req.method==='POST'&&p==='/api/lc81/library/passport'){reply(res,200,await store.passportLibrary(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/library/finalize'){reply(res,200,await store.finalizeLibrary(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/sop/photo'){
    const pos=url.searchParams.get('position');must(/^\d{1,4}$/.test(pos||''),404,'Фото недоступно');
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{const r=await store.sopPhoto(a.id,a.credential_revision,url.searchParams.get('revision_id'),Number(pos));reply(res,200,r.bytes,r.type);return}finally{libraryBusy--}
   }
   if(req.method==='GET'&&p==='/api/lc81/directory/info'){reply(res,200,store.directoryInfo(a.id,url.searchParams.get('type')));return}
   if(req.method==='POST'&&p==='/api/lc81/directory/change'){reply(res,200,await store.changeDirectory(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/tasks/implement'){reply(res,200,await store.implementOwnTask(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/resources'){
    const action=url.searchParams.get('action'),id=url.searchParams.get('id');
    if(id!==null){const data=store.readResource(a.id,action,id);must(data,404,'Запись недоступна');reply(res,200,{data});return}
    reply(res,200,{items:store.listResources(a.id,action)});return;
   }
   throw new PilotError(404,'Маршрут не найден');
  }catch(e){
   if(!res.headersSent&&!res.destroyed)reply(res,e instanceof PilotError?e.status:503,{error:e instanceof PilotError?e.message:'Операция не подтверждена'});
   else if(!res.destroyed)res.destroy();
  }finally{active--}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=3000;server.maxConnections=32;
 return server;
}
