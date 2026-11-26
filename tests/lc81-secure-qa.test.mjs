import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openSecureQA,ADMIN_ROLE,MANAGER_ROLE} from '../server/lc81/store.mjs';
import {createSecureQAServer} from '../server/lc81/http.mjs';
import {generatePassword,hashPassword,verifyPassword,normalizeLogin} from '../server/lc81/credentials.mjs';
const origin='https://qa.example.invalid',day=new Date().toISOString().slice(0,10);
const secret=()=>randomBytes(24).toString('base64url');
test('login normalization, random salt and password verification',()=>{
 const p=generatePassword(),h=hashPassword(p),h2=hashPassword(p);
 assert.notEqual(h,h2);assert(!h.includes(p));assert(verifyPassword(p,h));assert(!verifyPassword(secret(),h));assert(!verifyPassword(p,null));
 assert.equal(normalizeLogin(' Worker@Example.invalid '),'worker@example.invalid');assert.equal(normalizeLogin('x@@example.invalid'),null);
 assert.throws(()=>hashPassword('short'));
});
async function harness(t){
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-')),dataDir=path.join(parent,'qa');
 const adminPassword=secret();let store,server,base;
 async function start(options={}){
  store=await openSecureQA({dataDir,...options});
  server=createSecureQAServer({store,origin});
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
 assert(a.user.admin);assert.equal(a.user.person_id,null);assert.equal(a.user.permissions.length,45);
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
 for(const cookie of [ac,wc,m.cookie])for(const route of ['/api/v1/head','/api/v1/snapshot','/api/v1/documents/'+'a'.repeat(64),'/api/lc81/password/reset','/api/lc81/password/change']){
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
