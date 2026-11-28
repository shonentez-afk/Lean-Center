import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {editorFrame} from './editor-frame.mjs';
import {askEditorCloud,validateEditorCloud} from './editor-cloud.mjs';
import {askCenterCloud,CENTER_MODELS} from '../../src/modules/assistant/cloud.js';
import {PilotError} from '../lc74-store.mjs';
import {normalizeLogin,tokenDigest} from './credentials.mjs';
const COOKIE='__Host-lc81',SESSION_MS=8*60*60*1000,MAX_SESSIONS=256;
const sourceCommit=JSON.parse(await fs.readFile(new URL('../../tools/cloud-source.json',import.meta.url),'utf8')).sourceCommit;
if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('Missing LC8.1 source identity');
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const publicFiles=new Map(await Promise.all([
 ['/', './portal.html','text/html; charset=utf-8'],
 ['/portal.js','./portal.js','text/javascript; charset=utf-8'],
 ['/library-ui.js','./library-ui.js','text/javascript; charset=utf-8'],
 ['/training-ui.js','./training-ui.js','text/javascript; charset=utf-8'],
 ['/center-ui.js','./center-ui.js','text/javascript; charset=utf-8'],
 ['/assistant-ui.js','./assistant-ui.js','text/javascript; charset=utf-8'],
 ['/mobile-audit-ui.js','./mobile-audit-ui.js','text/javascript; charset=utf-8'],
 ['/final-ui.js','./final-ui.js','text/javascript; charset=utf-8'],
 ['/assets/echarts.min.js','../../node_modules/echarts/dist/echarts.min.js','text/javascript; charset=utf-8'],
 ['/shared/center-report.js','../../src/ui/center-report.js','text/javascript; charset=utf-8'],
 ['/analytics/palette.js','../../src/analytics/palette.js','text/javascript; charset=utf-8'],
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
export function createSecureQAServer({store,origin,cloudAiEnabled=false,editorAiEnabled=false,cloudFetcher=globalThis.fetch}){
 const u=new URL(origin);must(u.protocol==='https:'&&u.origin===origin,503,'Требуется точный HTTPS origin');
 const sessions=new Map(),attempts=new Map(),pendingChecks=new Map(),editorBudget=new Map();let active=0,loginBusy=0,libraryBusy=0,cloudBusy=0;
 const prune=now=>{for(const [k,v] of sessions)if(v.expires<=now)sessions.delete(k);for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);for(const [k,v] of editorBudget)if(v.until<=now)editorBudget.delete(k)};
 const getSession=(req,withWorkspace=false)=>{
  const raw=rawCookie(req),key=raw&&tokenDigest(raw),s=key&&sessions.get(key);
  must(s&&s.expires>Date.now(),401,'Необходим вход');
  const a=store.session(s.accountId,s.revision,withWorkspace);if(!a){sessions.delete(key);throw new PilotError(401,'Сеанс завершён')}
  return {a,key};
 };
 // Failed authentication budgets, not successful shift logins. Keep the
 // original thresholds and five-minute window. IP is the actual peer;
 // untrusted Forwarded/X-Forwarded-For headers cannot bypass the limit.
 const limitKeys=(kind,name,ip)=>[kind+':login:'+name,'auth:network:'+ip,'auth:global'];
 const limited=(keys)=>{
  const now=Date.now();prune(now);
  const limits=[6,30,60];
  let retry=0;
  for(let i=0;i<keys.length;i++){const x=attempts.get(keys[i]);if((x?.count||0)+(pendingChecks.get(keys[i])||0)>=limits[i])retry=Math.max(retry,x?Math.max(1,Math.ceil((x.until-now)/1000)):1)}
  if(attempts.size+keys.filter(k=>!attempts.has(k)).length>4096)retry=Math.max(retry,Math.max(1,Math.ceil((Math.min(...[...attempts.values()].map(x=>x.until))-now)/1000)));
  if(retry){const e=new PilotError(429,'Слишком много неудачных попыток; повторите через '+retry+' сек.');e.retryAfter=retry;throw e}
 };
 const reserve=keys=>{for(const k of keys)pendingChecks.set(k,(pendingChecks.get(k)||0)+1)};
 const release=keys=>{for(const k of keys){const n=(pendingChecks.get(k)||1)-1;if(n)pendingChecks.set(k,n);else pendingChecks.delete(k)}};
 const failed=keys=>{const now=Date.now();for(const k of keys){const x=attempts.get(k);attempts.set(k,{count:(x?.count||0)+1,until:x?.until||now+300000})}};

 const server=http.createServer(async(req,res)=>{
  if(active>=24){reply(res,429,{error:'Сервер занят'});return}active++;
  try{
   const url=new URL(req.url,'http://localhost'),p=url.pathname;
   if(req.method==='GET'&&p==='/healthz'){reply(res,store.healthy?200:503,{ok:store.healthy,mode:'LC8.1-QA',complete:false,sourceCommit});return}
   if(req.method==='GET'&&publicFiles.has(p)){const f=publicFiles.get(p);reply(res,200,f.bytes,f.type);return}
   // No legacy bearer authentication, full snapshot, source download or generic event package.
   must(!p.startsWith('/api/v1/'),404,'Маршрут недоступен в LC8.1');
   if(req.method==='POST')must(req.headers.origin===origin&&req.headers['x-lc81-request']==='1',403,'Запрос другого происхождения запрещён');
   if(req.method==='POST'&&p==='/api/lc81/login'){
    const b=await body(req);must(keys(b,['login','password']),400,'Неверные поля входа');
    const name=normalizeLogin(b.login)||'invalid';
    must(loginBusy<1,429,'Вход занят');loginBusy++;
    try{
     const keys=limitKeys('login',name,req.socket.remoteAddress||'unknown');limited(keys);
     const a=store.authenticate(b.login,b.password);if(!a){failed(keys);throw new PilotError(401,'Неверный логин или пароль')}
     const old=rawCookie(req);if(old)sessions.delete(tokenDigest(old));
     prune(Date.now());must(sessions.size<MAX_SESSIONS,429,'Слишком много активных сеансов');
     const raw=randomBytes(32).toString('hex');sessions.set(tokenDigest(raw),{accountId:a.id,revision:a.credential_revision,expires:Date.now()+SESSION_MS});
     reply(res,200,{user:a},undefined,{'Set-Cookie':cookie(raw,SESSION_MS/1000)});return;
    }finally{loginBusy--}
   }
   const {a,key}=getSession(req,p==='/api/lc81/session');
   if(req.method==='GET'&&p==='/api/lc81/session'){reply(res,200,{user:a,mode:'LC8.1-QA',sourceCommit});return}
   if(req.method==='POST'&&p==='/api/lc81/logout'){sessions.delete(key);reply(res,200,{ok:true},undefined,{'Set-Cookie':cookie('',0)});return}
   if(req.method==='POST'&&p==='/api/lc81/password/change'){
    const f=await body(req);must(keys(f,['current_password','new_password']),400,'Неверные поля пароля');
    const budgetKeys=limitKeys('password',a.id,req.socket.remoteAddress||'unknown');limited(budgetKeys);
    // Password changes are serialized by the checkpoint writer. Reserve a
    // slot before awaiting verification and charge only a failed secret.
    reserve(budgetKeys);
    let result;try{result=await store.changePassword(a.id,a.credential_revision,f)}catch(e){if(e instanceof PilotError&&e.status===403)failed(budgetKeys);throw e}finally{release(budgetKeys)}
    sessions.delete(key);
    reply(res,200,result,undefined,{'Set-Cookie':cookie('',0)});return;
   }
   if(req.method==='POST'&&['/api/lc81/admin/password-reset','/api/lc81/admin/login-change','/api/lc81/admin/role-end','/api/lc81/admin/employment-end','/api/lc81/admin/clock'].includes(p)){
    must(a.admin,403,'Требуются полномочия администратора');
    const methods={'password-reset':'resetPassword','login-change':'renameAccount','role-end':'endRole','employment-end':'endEmployment','clock':'configureClock'};
    const f=await body(req);reply(res,200,await store[methods[p.split('/').at(-1)]](a.id,a.credential_revision,f));return;
   }
   if(req.method==='GET'&&p==='/api/lc81/admin'){reply(res,200,{...store.adminData(a.id,a.credential_revision),integrations:{editor_ai:editorAiEnabled===true,center_ai:cloudAiEnabled===true}});return}
   if(req.method==='POST'&&p==='/api/lc81/admin/reference'){const b=await body(req);must(keys(b,['type','payload']),400,'Неверные поля');reply(res,200,await store.createReference(a.id,b.type,b.payload,a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/role-presets'){reply(res,200,await store.installRolePresets(a.id,await body(req),a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/provision'){reply(res,200,await store.provisionAccount(a.id,await body(req),a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/access'){reply(res,200,await store.assignAccess(a.id,await body(req),a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/account'){reply(res,200,await store.createAccount(a.id,await body(req),a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/state'){const b=await body(req);must(keys(b,['id','state'])||keys(b,['id','state','expected_revision'])&&Number.isSafeInteger(b.expected_revision),400,'Неверные поля');reply(res,200,await store.setState(a.id,b.id,b.state,a.credential_revision,b.expected_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/policy'){reply(res,200,await store.setPolicy(a.id,await body(req),a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/grant'){reply(res,200,await store.grant(a.id,await body(req),a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/revoke'){const b=await body(req);must(keys(b,['id']),400,'Неверные поля');reply(res,200,await store.revoke(a.id,b.id,a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/admin/manager-policy'){reply(res,200,await store.upgradeManagerPolicy(a.id,await body(req),a.credential_revision));return}
   if(req.method==='GET'&&p==='/editor/frame'){
    const kind=url.searchParams.get('kind'),tab=url.searchParams.get('tab')||null;
    must(['sop','frv'].includes(kind)&&(!!a.person_id||a.permissions.some(x=>x===kind+'.create'||x===kind+'.edit_draft'||kind==='sop'&&x==='sop.revise')),403,'Редактор недоступен');
    const html=editorFrame(url.searchParams.get('session'),kind,tab,editorAiEnabled===true);
    reply(res,200,html,'text/html; charset=utf-8',{'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"sandbox allow-scripts allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src data: blob:; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; child-src 'none'"});
    return;
   }
   if(req.method==='GET'&&p==='/api/lc81/training/plans'){reply(res,200,store.productionPlans(a.id,a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/training/plan-create'){reply(res,200,await store.createProductionPlan(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/training/plan-approve'){reply(res,200,await store.approveProductionPlan(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/training/protocol'){reply(res,200,await store.recordInstructionProtocol(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/training/result'){reply(res,200,await store.recordAssessmentResult(a.id,a.credential_revision,await body(req)));return}
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
   if(req.method==='GET'&&p==='/api/lc81/mobile-audit/options'){reply(res,200,store.mobileOptions(a.id,a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/mobile-audit/export'){reply(res,200,await store.exportMobile(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&['/api/lc81/mobile-audit/preview','/api/lc81/mobile-audit/commit','/api/lc81/mobile-audit/receipt'].includes(p)){
    const f=await body(req,6*1024*1024),method=p.endsWith('/preview')?'previewMobile':p.endsWith('/commit')?'commitMobile':'receiptMobile';
    reply(res,200,await store[method](a.id,a.credential_revision,f));return;
   }
   if(req.method==='GET'&&p==='/api/lc81/assistant/records'){reply(res,200,store.assistantRecords(a.id,a.credential_revision,url.searchParams.get('kind')));return}
   if(req.method==='GET'&&p==='/api/lc81/assistant/options'){reply(res,200,store.assistantOptions(a.id,a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/assistant/context'){
    const d=store.assistantContext(a.id,a.credential_revision,await body(req));
    reply(res,200,{...d,cloud_enabled:cloudAiEnabled===true,models:Object.entries(CENTER_MODELS).map(([id,m])=>({id,label:m.label}))});return;
   }
   if(req.method==='POST'&&p==='/api/lc81/assistant/preview'){
    must(cloudAiEnabled===true,403,'Внешний ИИ отключён');
    reply(res,200,{payload:store.assistantRequest(a.id,a.credential_revision,await body(req))});return;
   }
   if(req.method==='POST'&&p==='/api/lc81/editor/ai'){
    must(editorAiEnabled===true,403,'Внешний ИИ конструктора отключён администратором');
    const f=await body(req,512*1024);must(keys(f,['context','payload','confirmed'])&&f.confirmed===true,400,'Подтвердите отправку запроса ИИ');
    validateEditorCloud(f.payload);store.editorAiAccess(a.id,a.credential_revision,f.context);
    must(cloudBusy===0,429,'Облачный помощник занят; повторите запрос');
    const now=Date.now();prune(now);const budget=editorBudget.get(a.id)||{count:0,until:now+60000};
    must(budget.count<12&&editorBudget.size<4096,429,'Лимит запросов ИИ; повторите через минуту');
    budget.count++;editorBudget.set(a.id,budget);cloudBusy++;
    const controller=new AbortController(),cancel=()=>controller.abort();res.once('close',cancel);
    try{
     const result=await askEditorCloud(f.payload,{fetcher:cloudFetcher,signal:controller.signal});
     if(res.destroyed)return;
     const fresh=getSession(req);must(fresh.a.id===a.id&&fresh.a.credential_revision===a.credential_revision,401,'Сеанс изменился');
     store.editorAiAccess(a.id,a.credential_revision,f.context);reply(res,200,result);return;
    }finally{res.removeListener('close',cancel);cloudBusy--}
   }
   if(req.method==='POST'&&p==='/api/lc81/assistant/cloud'){
    must(cloudAiEnabled===true,403,'Внешний ИИ отключён');
    const f=await body(req);must(keys(f,['context','ids','model','confirmed'])&&f.confirmed===true,400,'Подтвердите точное содержимое запроса');
    const request={context:f.context,ids:f.ids,model:f.model};store.assistantRequest(a.id,a.credential_revision,request);
    must(cloudBusy===0,429,'Облачный помощник занят');cloudBusy++;
    const controller=new AbortController(),cancel=()=>controller.abort();res.once('close',cancel);
    try{
     let result;try{result=await askCenterCloud(f.ids,{model:f.model,context:null,fetcher:cloudFetcher,signal:controller.signal})}catch{throw new PilotError(502,'Облачный совет не получен или отменён; локальные рекомендации доступны')}
     if(res.destroyed)return;
     const fresh=getSession(req);must(fresh.a.id===a.id&&fresh.a.credential_revision===a.credential_revision,401,'Сеанс изменился');
     store.assistantRequest(a.id,a.credential_revision,request);reply(res,200,result);return;
    }finally{res.removeListener('close',cancel);cloudBusy--}
   }
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
   if(req.method==='GET'&&p==='/api/lc81/mentor/workspace'){reply(res,200,store.mentorWorkspace(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/mentor/options'){reply(res,200,store.mentorOptions(a.id,a.credential_revision,url.searchParams.get('kind')));return}
   if(req.method==='POST'&&p==='/api/lc81/mentor/change'){reply(res,200,await store.changeMentor(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/calendar/view'){reply(res,200,store.calendarWorkspace(a.id,a.credential_revision,Object.fromEntries(['mode','from','to','person_id'].map(k=>[k,url.searchParams.get(k)]))));return}
   if(req.method==='GET'&&p==='/api/lc81/calendar/options'){reply(res,200,store.calendarOptions(a.id,a.credential_revision,url.searchParams.get('type'),url.searchParams.get('source_id')));return}
   if(req.method==='GET'&&p==='/api/lc81/calendar/detail'){reply(res,200,store.calendarDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/calendar/create'){reply(res,200,await store.createSchedule(a.id,a.credential_revision,await body(req,128*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/calendar/change'){reply(res,200,await store.changeSchedule(a.id,a.credential_revision,await body(req,128*1024)));return}
   if(req.method==='GET'&&p==='/api/lc81/history/options'){reply(res,200,store.historyOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/history/list'){reply(res,200,store.historyList(a.id,a.credential_revision,Number(url.searchParams.get('offset')||0)));return}
   if(req.method==='GET'&&p==='/api/lc81/history/detail'){reply(res,200,store.historyDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/history/archive'){reply(res,200,store.historyArchive(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&['/api/lc81/history/preview','/api/lc81/history/import'].includes(p)){
    must(libraryBusy<1,429,'Импорт или документы обрабатываются');libraryBusy++;
    try{const f=await body(req,6*1024*1024),result=p.endsWith('/preview')?await store.previewHistory(a.id,a.credential_revision,f):await store.importHistory(a.id,a.credential_revision,f);reply(res,200,result);return}finally{libraryBusy--}
   }
   if(req.method==='GET'&&p==='/api/lc81/analytics/subjects'){reply(res,200,store.subjectOptions(a.id,a.credential_revision,url.searchParams.get('kind'),url.searchParams.get('sop_kind')||'sop_evaluation'));return}
   if(req.method==='POST'&&p==='/api/lc81/analytics/report'){reply(res,200,store.subjectReport(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/analytics/export'){const r=await store.exportSubject(a.id,a.credential_revision,await body(req));reply(res,200,r.bytes,r.mime,{'Content-Disposition':'attachment; filename="'+r.filename+'"'});return}
   if(req.method==='GET'&&p==='/api/lc81/analytics/frv'){reply(res,200,await store.frvReport(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/center/options'){reply(res,200,store.centerOptions(a.id,a.credential_revision,url.searchParams.get('kind')));return}
   if(req.method==='GET'&&p==='/api/lc81/center/view'){reply(res,200,store.centerWorkspace(a.id,a.credential_revision,url.searchParams.get('kind'),Object.fromEntries(['unit_id','from','to'].map(k=>[k,url.searchParams.get(k)]))));return}
   if(req.method==='GET'&&p==='/api/lc81/center/evidence'){reply(res,200,store.metricEvidence(a.id,a.credential_revision,url.searchParams.get('kind'),Object.fromEntries(['unit_id','from','to'].map(k=>[k,url.searchParams.get(k)])),url.searchParams.get('id'),Number(url.searchParams.get('offset')||0)));return}
   if(req.method==='GET'&&p==='/api/lc81/roi/options'){reply(res,200,store.roiOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/roi/detail'){reply(res,200,store.roiDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/roi/twi-options'){reply(res,200,store.roiTwiOptions(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/roi/twi-preview'){reply(res,200,await store.previewRoiTwi(a.id,a.credential_revision,await body(req,128*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/roi/create'){reply(res,200,await store.createRoi(a.id,a.credential_revision,await body(req,128*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/roi/change'){reply(res,200,await store.changeRoi(a.id,a.credential_revision,await body(req,128*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/roi/measure'){reply(res,200,await store.measureRoi(a.id,a.credential_revision,await body(req,128*1024)));return}
   if(req.method==='GET'&&p==='/api/lc81/competency/options'){reply(res,200,store.competencyOptions(a.id,a.credential_revision,url.searchParams.get('kind'),url.searchParams.get('person_id'),url.searchParams.get('skill_id')));return}
   if(req.method==='POST'&&p==='/api/lc81/competency/change'){reply(res,200,await store.competencyChange(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/assessment/detail'){reply(res,200,store.assessmentDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/matrix/suggest'){reply(res,200,store.suggestMatrix(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/matrix/overview-options'){reply(res,200,store.matrixOverviewOptions(a.id,a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/matrix/overview'){reply(res,200,store.matrixOverview(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/matrix/history'){
    const offset=url.searchParams.get('offset')??'0';must(/^\d{1,5}$/.test(offset),400,'Неверная страница');
    reply(res,200,store.matrixAssessmentHistory(a.id,a.credential_revision,url.searchParams.get('person_id'),url.searchParams.get('skill_id'),Number(offset)));return;
   }
   if(req.method==='GET'&&p==='/api/lc81/matrix/profile-options'){reply(res,200,store.profileOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/matrix/profile'){reply(res,200,store.professionProfile(a.id,a.credential_revision,url.searchParams.get('profession_id'),url.searchParams.get('scale_id'),url.searchParams.get('effective')));return}
   if(req.method==='POST'&&p==='/api/lc81/matrix/profile'){reply(res,200,await store.saveProfessionProfile(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/matrix/info'){reply(res,200,store.matrixInfo(a.id,a.credential_revision,url.searchParams.get('unit_id'),url.searchParams.get('base_on'),Object.fromEntries(['shift_id','profession_id','workplace_id','category_id'].map(k=>[k,url.searchParams.get(k)]))));return}
   if(req.method==='GET'&&p==='/api/lc81/matrix/detail'){reply(res,200,store.matrixDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/matrix/save'){reply(res,200,await store.saveMatrix(a.id,a.credential_revision,await body(req,2*1024*1024)));return}
   if(req.method==='POST'&&p==='/api/lc81/matrix/retire'){reply(res,200,await store.retireMatrix(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/person/card'){reply(res,200,store.personCard(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/library/info'){reply(res,200,store.libraryInfo(a.id,url.searchParams.get('kind')));return}
   if(req.method==='GET'&&p==='/api/lc81/library/card'){reply(res,200,store.libraryCard(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='GET'&&p==='/api/lc81/library/origin'){
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{reply(res,200,await store.libraryOrigin(a.id,a.credential_revision,url.searchParams.get('id')));return}finally{libraryBusy--}
   }
   if(req.method==='GET'&&p==='/api/lc81/library/detail'){
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{reply(res,200,{data:await store.libraryDetail(a.id,a.credential_revision,url.searchParams.get('action'),url.searchParams.get('id'))});return}finally{libraryBusy--}
   }
   if(req.method==='POST'&&['/api/lc81/library/open','/api/lc81/library/save'].includes(p)){
    must(!!a.person_id||a.permissions.some(x=>['sop.create','sop.edit_draft','sop.revise','frv.create','frv.edit_draft'].includes(x)),403,'Редактор недоступен');
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{
     const result=p.endsWith('/open')?await store.openLibrary(a.id,a.credential_revision,await body(req)):await store.saveLibrary(a.id,a.credential_revision,await body(req,2*30*1024*1024+65536));
     reply(res,200,p.endsWith('/open')?{...result,editor_ai_enabled:editorAiEnabled===true}:result);return;
    }finally{libraryBusy--}
   }
   if(req.method==='POST'&&p==='/api/lc81/library/passport'){reply(res,200,await store.passportLibrary(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='POST'&&p==='/api/lc81/library/finalize'){reply(res,200,await store.finalizeLibrary(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/sop/photo'){
    const pos=url.searchParams.get('position');must(/^\d{1,4}$/.test(pos||''),404,'Фото недоступно');
    must(libraryBusy<1,429,'Документы обрабатываются, повторите запрос');libraryBusy++;
    try{const r=await store.sopPhoto(a.id,a.credential_revision,url.searchParams.get('revision_id'),Number(pos));reply(res,200,r.bytes,r.type);return}finally{libraryBusy--}
   }
   if(req.method==='GET'&&p==='/api/lc81/training/journal'){reply(res,200,store.journalWorkspace(a.id,a.credential_revision,{person_id:url.searchParams.get('person_id')||null,from:url.searchParams.get('from'),to:url.searchParams.get('to'),q:url.searchParams.get('q')||'',offset:Number(url.searchParams.get('offset')||0)}));return}
   if(req.method==='GET'&&p==='/api/lc81/training/revision-change'){reply(res,200,await store.revisionChange(a.id,a.credential_revision,url.searchParams.get('old_id'),url.searchParams.get('new_id')));return}
   if(req.method==='POST'&&p==='/api/lc81/training/revision-change'){reply(res,200,await store.saveRevisionChange(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/training/retraining'){reply(res,200,store.retrainingWorkspace(a.id,a.credential_revision,{type:url.searchParams.get('type')||'all',state:url.searchParams.get('state')||'all',person_id:url.searchParams.get('person_id')||null,q:url.searchParams.get('q')||'',offset:Number(url.searchParams.get('offset')||0)}));return}
   if(req.method==='GET'&&p==='/api/lc81/sop-evaluation'){reply(res,200,store.sopEvaluationWorkspace(a.id,a.credential_revision,{kind:url.searchParams.get('kind')||'sop_evaluation',from:url.searchParams.get('from'),to:url.searchParams.get('to'),q:url.searchParams.get('q')||'',method:url.searchParams.get('method')||null,offset:Number(url.searchParams.get('offset')||0)}));return}
   if(req.method==='GET'&&p==='/api/lc81/sop-evaluation/options'){reply(res,200,store.sopEvaluationOptions(a.id,a.credential_revision));return}
   if(req.method==='GET'&&p==='/api/lc81/sop-evaluation/detail'){reply(res,200,store.sopEvaluationDetail(a.id,a.credential_revision,url.searchParams.get('kind'),url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/sop-evaluation/create'){reply(res,200,await store.createSopEvaluation(a.id,a.credential_revision,await body(req,300000)));return}
   if(req.method==='POST'&&p==='/api/lc81/sop-evaluation/install'){reply(res,200,await store.installSopMethod(a.id,a.credential_revision,await body(req)));return}
   if(req.method==='GET'&&p==='/api/lc81/import/types'){reply(res,200,store.importTypes(a.id,a.credential_revision));return}
   if(req.method==='POST'&&['/api/lc81/import/inspect','/api/lc81/import/preview','/api/lc81/import/commit'].includes(p)){
    const f=await body(req,3000000),method=p.endsWith('/inspect')?'inspectDirectoryFile':p.endsWith('/preview')?'previewDirectoryFile':'commitDirectoryFile';
    reply(res,200,await store[method](a.id,a.credential_revision,f));return;
   }
   if(req.method==='GET'&&p==='/api/lc81/forms'){reply(res,200,store.formsCatalog(a.id,a.credential_revision));return}
   if(req.method==='POST'&&p==='/api/lc81/forms/export'){const result=await store.exportForm(a.id,a.credential_revision,await body(req));reply(res,200,result.bytes,result.mime,{'Content-Disposition':'attachment; filename="'+result.filename+'"'});return}
   if(req.method==='GET'&&p==='/api/lc81/employment/detail'){reply(res,200,store.employmentDetail(a.id,a.credential_revision,url.searchParams.get('id')));return}
   if(req.method==='POST'&&p==='/api/lc81/employment/transfer'){reply(res,200,await store.transferEmployment(a.id,a.credential_revision,await body(req)));return}
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
   if(!res.headersSent&&!res.destroyed)reply(res,e instanceof PilotError?e.status:503,{error:e instanceof PilotError?e.message:'Операция не подтверждена'},undefined,e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});
   else if(!res.destroyed)res.destroy();
  }finally{active--}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=3000;server.maxConnections=32;
 return server;
}
