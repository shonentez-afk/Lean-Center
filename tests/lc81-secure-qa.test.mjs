import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openSecureQA,ADMIN_ROLE,MANAGER_ROLE} from '../server/lc81/store.mjs';
import {readZip} from '../src/modules/training/local-docx.js';
import {createSecureQAServer} from '../server/lc81/http.mjs';
import {zoneOffset,normalizeZone,civilPayload} from '../server/lc81/site-clock.mjs';
import {economicEventDay} from '../src/core/business-clock.js';
import {generatePassword,hashPassword,verifyPassword,normalizeLogin} from '../server/lc81/credentials.mjs';
const origin='https://qa.example.invalid',day=new Date().toISOString().slice(0,10);
const secret=()=>randomBytes(24).toString('base64url');
test('login normalization, random salt and password verification',()=>{
 const p=generatePassword(),h=hashPassword(p),h2=hashPassword(p);
 assert.notEqual(h,h2);assert(!h.includes(p));assert(verifyPassword(p,h));assert(!verifyPassword(secret(),h));assert(!verifyPassword(p,null));
 assert.equal(normalizeLogin(' Worker@Example.invalid '),'worker@example.invalid');assert.equal(normalizeLogin('x@@example.invalid'),null);
 assert.throws(()=>hashPassword('short'));
});
async function harness(t,serverOptions={}){
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-')),dataDir=path.join(parent,'qa');
 const adminPassword=secret();let store,server,base;
 async function start(options={}){
  store=await openSecureQA({dataDir,...options});
  server=createSecureQAServer({store,origin,...serverOptions});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  base='http://127.0.0.1:'+server.address().port;
 }
 async function stop(){if(server){await new Promise(resolve=>server.close(resolve));server=null}if(store){await store.close();store=null}}
 t.after(async()=>{await stop();await fs.rm(parent,{recursive:true,force:true})});
 async function request(route,{cookie,body,csrf=true,method,auth,otherOrigin}={}){
  const headers={};if(cookie)headers.Cookie=cookie;if(auth)headers.Authorization=auth;
  const m=method||(body!==undefined?'POST':'GET');
  if(m==='POST'){headers['Content-Type']='application/json';if(csrf){headers.Origin=otherOrigin||origin;headers['X-LC81-Request']='1'}}
  const r=await fetch(base+route,{method:m,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie'),cache:r.headers.get('cache-control')};
 }
 async function login(login,password){
  const r=await request('/api/lc81/login',{body:{login,password}});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.match(r.cookie,/; Secure; HttpOnly; SameSite=Strict/);assert.equal(r.cache,'no-store');
  return {cookie:r.cookie.split(';')[0],user:r.data.user};
 }
 async function post(cookie,route,body){const r=await request('/api/lc81/admin/'+route,{cookie,body});assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
 async function admin(cookie){const r=await request('/api/lc81/admin',{cookie});assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
 await start({initialize:true,password:adminPassword});
 return {parent,dataDir,adminPassword,start,stop,request,login,post,admin,get store(){return store}};
}
test('first admin, explicit existing roles, scoped views, blocking and restart',async t=>{
 const h=await harness(t);
 assert.equal((await h.request('/api/lc81/session')).status,401);
 const a=await h.login('admin',h.adminPassword),ac=a.cookie;
 assert(a.user.admin);assert.equal(a.user.person_id,null);assert.equal(a.user.permissions.length,98);
 assert.equal((await h.request('/api/lc81/mobile-audit/options',{cookie:ac})).status,403);
 assert.equal((await h.request('/api/lc81/history/preview',{cookie:ac,body:{raw:{schemaVersion:3,audits:[]},offset:0}})).status,403);
 assert.equal((await h.request('/api/lc81/assistant/cloud',{cookie:ac,body:{confirmed:true}})).status,403);
 const templates=h.store.formsCatalog(a.user.id,1);
 assert.equal(templates.forms.length,17);
 for(const form of templates.forms){
  const file=await h.store.exportForm(a.user.id,1,{kind:'blank',appendix:form.id,id:null});
  assert.equal(file.filename,'TWI-03-'+form.id+'.'+(form.id===15?'docx':'xlsx'));
  const entries=await readZip(file.bytes),xml=new TextDecoder().decode(entries.find(x=>x.name===(form.id===15?'word/document.xml':'xl/workbook.xml')).bytes);
  assert(xml.length>100);assert(entries.some(x=>x.name==='[Content_Types].xml'));
 }
 await assert.rejects(h.store.exportForm(a.user.id,1,{kind:'blank',appendix:18,id:null}),/приложение/);
 let d=await h.admin(ac);assert.equal(d.accounts.length,1);assert.equal(d.people.length,0);assert(d.roles.some(r=>r.id===ADMIN_ROLE));assert(d.roles.some(r=>r.id===MANAGER_ROLE));
 const root=d.site;
 async function ref(type,payload){return (await h.post(ac,'reference',{type,payload})).id}
 const ua=await ref('org_unit',{code:'A',name:'Учебный A',kind:'Участок',parent_id:root}),ub=await ref('org_unit',{code:'B',name:'Учебный B',kind:'Участок',parent_id:root});
 async function person(code,unit){const id=await ref('person',{employee_code:code,display_name:'Учебный '+code});await ref('person_assignment',{person_id:id,unit_id:unit,profession_id:null,position_id:null,shift_id:null,shift_code:null,valid_from:day,valid_to:null});return id}
 const p1=await person('P1',ua),p2=await person('P2',ub),p3=await person('P3',ub);
 const role=await ref('business_role',{code:'WORKER',name:'Учебная роль'});
 const assignment=await ref('role_assignment',{person_id:p1,role_id:role,valid_from:day,valid_to:null});
 const assignment2=await ref('role_assignment',{person_id:p2,role_id:MANAGER_ROLE,valid_from:day,valid_to:null});
 const pw=secret(),pw2=secret();
 const worker=await h.post(ac,'account',{person_id:p1,login:'Worker@Example.invalid',password:pw,generate:false});
 const manager=await h.post(ac,'account',{person_id:p2,login:'manager',password:pw2,generate:false});
 const generated=await h.post(ac,'account',{person_id:p3,login:'user3',password:null,generate:true});
 assert(generated.issued_password);assert(!JSON.stringify(await h.admin(ac)).includes(generated.issued_password));
 assert.equal((await h.request('/api/lc81/admin/account',{cookie:ac,body:{person_id:p1,login:'another',password:secret(),generate:false}})).status,409);
 assert.equal((await h.request('/api/lc81/admin/account',{cookie:ac,body:{person_id:p3,login:'worker@example.invalid',password:secret(),generate:false}})).status,409);
 const w=await h.login('worker@example.invalid',pw),wc=w.cookie;
 assert.deepEqual(w.user.permissions,[]);
 const resource='/api/lc81/resources?action=person.read_basic';
 assert.equal((await h.request(resource,{cookie:wc})).status,404);
 await h.post(ac,'policy',{role_id:role,revision:0,permissions:['person.read_basic']});
 assert.equal((await h.request(resource,{cookie:wc})).status,404,'business assignment and policy alone do not grant access');
 const grant=await h.post(ac,'grant',{account_id:worker.id,assignment_id:assignment,scope:{kind:'unit_tree',unit_id:ua},valid_to:null});
 await h.post(ac,'grant',{account_id:manager.id,assignment_id:assignment2,scope:{kind:'unit_tree',unit_id:root},valid_to:null});
 const m=await h.login('manager',pw2);
 const visible=await h.request(resource,{cookie:wc});assert.equal(visible.status,200);assert.deepEqual(visible.data.items.map(x=>x.id),[p1]);assert.deepEqual(Object.keys(visible.data.items[0]).sort(),['display_name','id']);
 assert.equal((await h.request(resource+'&id='+p2,{cookie:wc})).status,404);
 assert.equal((await h.request(resource,{cookie:m.cookie})).data.items.length,3);
 for(const cookie of [wc,m.cookie]){
  assert.equal((await h.request('/api/lc81/admin',{cookie})).status,403);
  assert.equal((await h.request('/api/lc81/admin/state',{cookie,body:{id:a.user.id,state:'blocked'}})).status,403);
  assert.equal((await h.request('/api/lc81/admin/policy',{cookie,body:{role_id:role,revision:1,permissions:['person.read_basic']}})).status,403);
 }
 for(const cookie of [ac,wc,m.cookie])for(const route of ['/api/v1/head','/api/v1/snapshot','/api/v1/documents/'+'a'.repeat(64),'/api/lc81/password/reset']){
  assert.equal((await h.request(route,{cookie})).status,404);
  assert.equal((await h.request(route,{cookie,body:{}})).status,404);
 }
 assert.equal((await h.request('/api/v1/packages',{cookie:ac,body:{}})).status,404);
 assert.equal((await h.request('/api/v1/snapshot',{auth:'Bearer '+'a'.repeat(64)})).status,404);
 assert.equal((await h.request('/api/lc81/admin/state',{cookie:ac,body:{id:worker.id,state:'blocked'},csrf:false})).status,403);
 assert.equal((await h.request('/api/lc81/admin/state',{cookie:ac,body:{id:worker.id,state:'blocked'},otherOrigin:'https://other.invalid'})).status,403);
 assert.equal((await h.request('/api/lc81/admin/state',{cookie:ac,body:{id:a.user.id,state:'blocked'}})).status,403);
 assert.equal((await h.request('/api/lc81/admin/policy',{cookie:ac,body:{role_id:role,revision:1,permissions:['sop.approve_final']}})).status,422);
 assert.equal((await h.request('/api/lc81/admin/grant',{cookie:ac,body:{account_id:worker.id,assignment_id:assignment2,scope:{kind:'unit_tree',unit_id:root},valid_to:null}})).status,422);
 await h.post(ac,'policy',{role_id:role,revision:1,permissions:['person.read_basic']});
 assert.equal((await h.request(resource,{cookie:wc})).status,404,'policy revision invalidates old grant');
 const next=await h.post(ac,'grant',{account_id:worker.id,assignment_id:assignment,scope:{kind:'unit_tree',unit_id:ua},valid_to:null});
 assert.equal((await h.request(resource,{cookie:wc})).status,200);
 await h.post(ac,'revoke',{id:next.id});
 assert.equal((await h.request(resource,{cookie:wc})).status,404);
 await h.post(ac,'state',{id:worker.id,state:'blocked'});
 assert.equal((await h.request('/api/lc81/session',{cookie:wc})).status,401);
 assert.equal((await h.request('/api/lc81/login',{body:{login:'worker@example.invalid',password:pw}})).status,401);
 await h.post(ac,'state',{id:worker.id,state:'active'});
 assert.equal((await h.request('/api/lc81/session',{cookie:wc})).status,401,'unblocking never revives old session');
 const info=await h.admin(ac);assert(info.audit.some(x=>x.action==='grant.revoke'));assert(!JSON.stringify(info).includes('password_hash'));assert(!JSON.stringify(info).includes(pw));
 assert(!Buffer.from(await fs.readFile(path.join(h.dataDir,'secure.lc81'))).includes(Buffer.from(h.adminPassword)));
 await h.stop();await h.start({initialize:true,password:secret()});
 assert.equal((await h.request('/api/lc81/session',{cookie:ac})).status,401);
 const again=await h.login('admin',h.adminPassword);assert.equal(again.user.id,a.user.id);
 assert.equal((await h.admin(again.cookie)).accounts.length,4);
 assert.equal((await h.login('manager',pw2)).user.id,manager.id);
});
test('initialization and restart fail closed, existing storage never reboots',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-init-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const empty=path.join(root,'empty');await fs.mkdir(empty);
 await assert.rejects(openSecureQA({dataDir:empty,initialize:true,password:secret()}));
 const dir=path.join(root,'new');await assert.rejects(openSecureQA({dataDir:dir,initialize:true}));await assert.rejects(openSecureQA({dataDir:dir,password:secret()}));
 const s=await openSecureQA({dataDir:dir,initialize:true,password:secret()});
 await assert.rejects(openSecureQA({dataDir:dir,initialize:true,password:secret()}));await s.close();
 await fs.rm(path.join(dir,'secure.lc81'));await assert.rejects(openSecureQA({dataDir:dir,initialize:true,password:secret()}));
});
test('ambiguous write fails closed and previous committed accounts remain',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-failure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'qa'),password=secret();const s=await openSecureQA({dataDir:dir,initialize:true,password});const a=s.authenticate('admin',password);await s.close();
 const broken=await openSecureQA({dataDir:dir,write:async()=>{throw Error('injected disk error')}});
 await assert.rejects(broken.createReference(a.id,'person',{employee_code:'NO',display_name:'Не сохранено'}),/не подтверждена/);assert.equal(broken.healthy,false);await broken.close();
 const again=await openSecureQA({dataDir:dir});try{assert(again.authenticate('admin',password));assert.equal(again.adminData(a.id).people.length,0)}finally{await again.close()}
});
test('login rate limit and CSRF checks apply before authentication',async t=>{
 const h=await harness(t);
 assert.equal((await h.request('/api/lc81/login',{body:{login:'admin',password:h.adminPassword},csrf:false})).status,403);
 for(let i=0;i<6;i++)assert.equal((await h.request('/api/lc81/login',{body:{login:'admin',password:secret()}})).status,401);
 assert.equal((await h.request('/api/lc81/login',{body:{login:'admin',password:h.adminPassword}})).status,429);
});

test('scoped directory write through HTTP: no self escalation or cross-unit change',async t=>{
 const h=await harness(t),a=await h.login('admin',h.adminPassword),ac=a.cookie;
 const d=await h.admin(ac);
 const ref=async(type,payload)=>(await h.post(ac,'reference',{type,payload})).id;
 const u1=await ref('org_unit',{code:'A',name:'Участок A',kind:'Участок',parent_id:d.site}),u2=await ref('org_unit',{code:'B',name:'Участок B',kind:'Участок',parent_id:d.site});
 const create=async(unit,code)=>{const r=await h.request('/api/lc81/directory/change',{cookie:ac,body:{type:'person',operation:'create',id:null,expected_revision:0,fields:{employee_code:code,display_name:code,unit_id:unit}}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.id};
 const p1=await create(u1,'PERSON-A'),p2=await create(u2,'PERSON-B'),r=await ref('business_role',{code:'QA-EDIT',name:'Редактор участка'}),assignment=await ref('role_assignment',{person_id:p1,role_id:r,valid_from:day,valid_to:null});
 const pw=secret(),worker=await h.post(ac,'account',{person_id:p1,login:'unit-editor',password:pw,generate:false});
 await h.post(ac,'policy',{role_id:r,revision:0,permissions:['org.read','person.read_directory','person.update','person.create']});
 await h.post(ac,'grant',{account_id:worker.id,assignment_id:assignment,scope:{kind:'unit_tree',unit_id:u1},valid_to:null});
 const w=await h.login('unit-editor',pw),wc=w.cookie;
 const list=await h.request('/api/lc81/resources?action=person.read_directory',{cookie:wc});assert.equal(list.status,200);assert.deepEqual(list.data.items.map(x=>x.id),[p1]);
 assert.equal(list.data.items[0].can_update,true);
 const info=await h.request('/api/lc81/directory/info?type=person',{cookie:wc});assert.equal(info.status,200);assert.deepEqual(info.data.refs.org_unit.map(x=>x.id),[u1]);assert(info.data.can_create);
 const cmd=(id,rev,fields)=>({type:'person',operation:'update',id,expected_revision:rev,fields});
 const denied=await h.request('/api/lc81/directory/change',{cookie:wc,body:cmd(p2,1,{employee_code:'PERSON-B',display_name:'Чужая запись'})});assert.equal(denied.status,403);
 const allowed=await h.request('/api/lc81/directory/change',{cookie:wc,body:cmd(p1,1,{employee_code:'PERSON-A',display_name:'Новое имя'})});assert.equal(allowed.status,200);assert.equal(allowed.data.rev,2);
 assert.equal((await h.request('/api/lc81/directory/change',{cookie:wc,body:cmd(p1,1,{employee_code:'PERSON-A',display_name:'Старые данные'})})).status,409);
 assert.equal((await h.request('/api/lc81/directory/change',{cookie:wc,body:{type:'person',operation:'create',id:null,expected_revision:0,fields:{employee_code:'NO',display_name:'NO',unit_id:u2}}})).status,403);
 assert.equal((await h.request('/api/lc81/admin/manager-policy',{cookie:wc,body:{revision:1}})).status,403);
 assert.equal((await h.request('/api/lc81/admin',{cookie:wc})).status,403);
 assert.equal((await h.request('/api/lc81/sop/photo?revision_id='+p2+'&position=1',{cookie:wc})).status,404);
 assert.equal((await h.request('/api/v1/snapshot',{cookie:wc})).status,404);
});

test('protected cloud helper sends only previewed static rules to fixed provider',async t=>{
 const calls=[],h=await harness(t,{cloudAiEnabled:true,cloudFetcher:async(url,options)=>{
  const request=JSON.parse(options.body);calls.push({url,request});
  return new Response(JSON.stringify({model:'yandexgpt-lite/latest',choices:[{finish_reason:'stop',message:{content:JSON.stringify({recommendations:[{id:'ctx_metric_review',text:'Сверьте определения и исходные записи.'}]})}}]}),{headers:{'Content-Type':'application/json'}});
 }});
 const admin=await h.login('admin',h.adminPassword),ac=admin.cookie,data=await h.admin(ac);
 const ref=async(type,payload)=>(await h.post(ac,'reference',{type,payload})).id;
 const person=(await h.request('/api/lc81/directory/change',{cookie:ac,body:{type:'person',operation:'create',id:null,expected_revision:0,fields:{employee_code:'AI-QA-SECRET',display_name:'Учебный пользователь помощника',unit_id:data.site}}})).data.id;
 const role=await ref('business_role',{code:'AI-QA',name:'Проверка ИИ'}),assignment=await ref('role_assignment',{person_id:person,role_id:role,valid_from:day,valid_to:null});
 const pw=secret(),user=await h.post(ac,'account',{person_id:person,login:'assistant-qa',password:pw,generate:false});
 await h.post(ac,'policy',{role_id:role,revision:0,permissions:['assistant.read','assistant.cloud','org.read','analytics.read','training.read','training.detail']});
 const grant=await h.post(ac,'grant',{account_id:user.id,assignment_id:assignment,scope:{kind:'unit_tree',unit_id:data.site},valid_to:null});
 const session=await h.login('assistant-qa',pw),cookie=session.cookie;
 const context={type:'report',kind:'analytics.read',scope:{unit_id:'',from:day,to:day},group:'all'},request={context,ids:['ctx_metric_review'],model:'yandexgpt-lite'};
 const local=await h.request('/api/lc81/assistant/context',{cookie,body:context});
 assert.equal(local.status,200,JSON.stringify(local.data));assert(local.data.can_cloud);assert(local.data.checks.some(x=>x.id==='ctx_metric_review'));
 const preview=await h.request('/api/lc81/assistant/preview',{cookie,body:request});
 assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(calls.length,0);
 assert.equal((await h.request('/api/lc81/assistant/cloud',{cookie,body:{...request,confirmed:false}})).status,400);
 assert.equal((await h.request('/api/lc81/assistant/cloud',{cookie,body:{...request,ids:['ctx_audit_no'],confirmed:true}})).status,409);
 assert.equal(calls.length,0);
 const result=await h.request('/api/lc81/assistant/cloud',{cookie,body:{...request,confirmed:true}});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(calls.length,1);assert.deepEqual(calls[0].request,preview.data.payload);assert.equal(result.data.reported,'yandexgpt-lite');
 const raw=JSON.stringify(calls[0]);for(const x of [person,data.site,'AI-QA-SECRET',day,'Учебный пользователь помощника'])assert(!raw.includes(x));
 assert.equal((await h.request('/api/lc81/assistant/cloud',{cookie,body:{...request,confirmed:true},csrf:false})).status,403);
 await h.post(ac,'revoke',{id:grant.id});
 assert.equal((await h.request('/api/lc81/assistant/cloud',{cookie,body:{...request,confirmed:true}})).status,403);
 assert.equal(calls.length,1);
});

test('password lifecycle, current grants, role and employment end preserve history',async t=>{
 const h=await harness(t),admin=await h.login('admin',h.adminPassword),ac=admin.cookie,d=await h.admin(ac);
 const ref=async(type,payload)=>(await h.post(ac,'reference',{type,payload})).id;
 const p=(await h.request('/api/lc81/directory/change',{cookie:ac,body:{type:'person',operation:'create',id:null,expected_revision:0,fields:{employee_code:'LIFE-A',display_name:'Учебный сотрудник',unit_id:d.site}}})).data.id;
 const role=await ref('business_role',{code:'LIFE-ROLE',name:'Проверка кадров'}),assignment=await ref('role_assignment',{person_id:p,role_id:role,valid_from:day,valid_to:null});
 const pw=secret(),pw2=secret(),created=await h.post(ac,'account',{person_id:p,login:'life-user',password:pw,generate:false});
 await h.post(ac,'policy',{role_id:role,revision:0,permissions:['person.read_basic']});
 const grantInput={account_id:created.id,assignment_id:assignment,scope:{kind:'self'},valid_to:null};
 const grant=await h.post(ac,'grant',grantInput);
 assert.equal((await h.request('/api/lc81/admin/grant',{cookie:ac,body:grantInput})).status,409);
 assert.equal((await h.admin(ac)).grants.find(g=>g.id===grant.id).status,'effective');
 const u=await h.login('life-user',pw),u2=await h.login('life-user',pw),wc=u.cookie;
 assert.equal((await h.request('/api/lc81/admin/password-reset',{cookie:wc,body:{id:created.id,expected_revision:1,password:pw2,generate:false}})).status,403);
 assert.equal((await h.request('/api/lc81/password/change',{cookie:wc,body:{current_password:pw,new_password:pw2},csrf:false})).status,403);
 assert.equal((await h.request('/api/lc81/password/change',{cookie:wc,body:{current_password:secret(),new_password:pw2}})).status,403);
 assert.equal((await h.request('/api/lc81/password/change',{cookie:wc,body:{current_password:pw,new_password:pw}})).status,422);
 const changed=await h.request('/api/lc81/password/change',{cookie:wc,body:{current_password:pw,new_password:pw2}});
 assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal(changed.data.credential_revision,2);
 for(const cookie of [wc,u2.cookie])assert.equal((await h.request('/api/lc81/session',{cookie})).status,401);
 assert.equal((await h.request('/api/lc81/login',{body:{login:'life-user',password:pw}})).status,401);
 const fresh=await h.login('life-user',pw2);
 assert.equal(fresh.user.credential_revision,2);
 assert.equal((await h.request('/api/lc81/admin/password-reset',{cookie:ac,body:{id:created.id,expected_revision:1,password:null,generate:true}})).status,409);
 assert.equal((await h.request('/api/lc81/admin/password-reset',{cookie:ac,body:{id:admin.user.id,expected_revision:1,password:null,generate:true}})).status,403);
 const reset=await h.post(ac,'password-reset',{id:created.id,expected_revision:2,password:null,generate:true});
 assert(reset.issued_password);assert.equal(reset.credential_revision,3);assert.equal((await h.request('/api/lc81/session',{cookie:fresh.cookie})).status,401);
 const afterReset=await h.login('life-user',reset.issued_password);
 await h.post(ac,'login-change',{id:created.id,expected_revision:3,login:'LIFE-RENAMED'});
 assert.equal((await h.request('/api/lc81/session',{cookie:afterReset.cookie})).status,401);
 assert.equal((await h.request('/api/lc81/login',{body:{login:'life-user',password:reset.issued_password}})).status,401);
 const renamed=await h.login('life-renamed',reset.issued_password);
 const e=(await h.admin(ac)).employment.find(x=>x.person_id===p);
 const ending={id:e.id,expected_revision:e.rev,valid_to:day,reason:'Учебное окончание',block_now:true};
 assert.equal((await h.request('/api/lc81/admin/employment-end',{cookie:ac,body:ending})).status,422,'Role must first be closed');
 const closure={id:assignment,expected_revision:1,valid_to:day,reason:'Окончание роли',revoke_now:true};
 const ended=await h.post(ac,'role-end',closure);assert.equal(ended.rev,2);assert.equal(ended.revoked,1);
 assert.equal((await h.request('/api/lc81/admin/role-end',{cookie:ac,body:closure})).status,409);
 assert.equal((await h.request('/api/lc81/resources?action=person.read_basic',{cookie:renamed.cookie})).status,404);
 const end=await h.post(ac,'employment-end',ending);assert(end.blocked);
 assert.equal((await h.request('/api/lc81/session',{cookie:renamed.cookie})).status,401);
 const info=await h.admin(ac);assert.equal(info.assignments.find(x=>x.id===assignment).valid_to,day);assert.equal(info.employment.find(x=>x.id===e.id).valid_to,day);
 assert.equal(info.grants.find(x=>x.id===grant.id).status,'revoked');assert(info.audit.some(x=>x.reason==='Учебное окончание'));
 for(const token of [pw,pw2,reset.issued_password,h.adminPassword])assert(!JSON.stringify(info).includes(token)&&!(await fs.readFile(path.join(h.dataDir,'secure.lc81'))).includes(Buffer.from(token)));
 // Bootstrap can change its own password, but no other account can reset it.
 const ap=secret(),self=await h.request('/api/lc81/password/change',{cookie:ac,body:{current_password:h.adminPassword,new_password:ap}});
 assert.equal(self.status,200,JSON.stringify(self.data));assert.equal((await h.request('/api/lc81/admin',{cookie:ac})).status,401);
 const aa=await h.login('admin',ap);assert(aa.user.admin);
 await assert.rejects(h.store.createReference(admin.user.id,'business_role',{code:'STALE-ADMIN',name:'Stale'},1),/Сеанс завершён/);
 await h.stop();await h.start({initialize:true,password:secret()});assert.equal((await h.login('admin',ap)).user.id,admin.user.id);
});
test('site clock is explicit, immutable and preserves civil event offsets',async t=>{
 const instant=new Date('2026-11-27T20:15:00.000Z');
 assert.equal(zoneOffset('Asia/Novokuznetsk',instant),420);
 assert.equal(zoneOffset('America/New_York',new Date('2026-01-01T12:00:00Z')),-300);
 assert.equal(zoneOffset('America/New_York',new Date('2026-07-01T12:00:00Z')),-240);
 assert.equal(normalizeZone('Mars/Nowhere'),null);
 const payload=civilPayload('schedule_event',{assignment_id:'x',owner_id:'y',due_on:'2026-11-28'},420);
 assert.equal(economicEventDay({payload,occurred_at:instant.toISOString()}),'2026-11-28');
 assert.equal(economicEventDay({payload:{},occurred_at:instant.toISOString()}),'2026-11-27');
 assert.deepEqual(civilPayload('audit_session',{x:1},420),{x:1});
 const h=await harness(t),admin=await h.login('admin',h.adminPassword),ac=admin.cookie;
 assert.equal((await h.admin(ac)).clock.configured,false);
 assert.equal((await h.request('/api/lc81/admin/clock',{cookie:ac,body:{zone:'Mars/Nowhere',confirmed:true}})).status,422);
 assert.equal((await h.request('/api/lc81/admin/clock',{cookie:ac,body:{zone:'Asia/Novokuznetsk',confirmed:false}})).status,400);
 const configured=await h.post(ac,'clock',{zone:'Asia/Novokuznetsk',confirmed:true});assert.equal(configured.offset_minutes,420);assert(configured.configured);
 assert.equal((await h.request('/api/lc81/admin/clock',{cookie:ac,body:{zone:'UTC',confirmed:true}})).status,409);
 await h.stop();await assert.rejects(openSecureQA({dataDir:h.dataDir,siteTimeZone:'UTC'}),/Часовой пояс/);
 await h.start();assert.equal((await h.admin((await h.login('admin',h.adminPassword)).cookie)).clock.offset_minutes,420);
});
