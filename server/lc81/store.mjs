// Isolated QA server. One protected, atomically replaced SQLite checkpoint
// containing the accepted v17 domain schema and private service tables.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pilotSql,atomicReplace,PilotError} from '../lc74-store.mjs';
import {createDb,openDb,verifyDb,applyEvent,one,rows,uuid,tx,bytesOf,meta,isId} from '../../src/core/db.js';
import {hashPassword,verifyPassword,validHash,normalizeLogin,generatePassword,validPassword} from './credentials.mjs';
import {READ_ACTIONS,readAuthorized,readManagerProjection} from './read-policy.mjs';
export const ADMIN_ROLE='8c810000-0000-4000-8000-000000000001',MANAGER_ROLE='8c810000-0000-4000-8000-000000000002';
const SITE='8c810000-0000-4000-8000-000000000003';
const MAGIC=Buffer.from('LC81QA1\n'),MAX=24*1024*1024;
const schema=await fs.readFile(fileURLToPath(new URL('./security-schema.sql',import.meta.url)),'utf8');
const must=(ok,status,message)=>{if(!ok)throw new PilotError(status,message)};
const day=()=>new Date().toISOString().slice(0,10); // QA UTC; site clock contract remains open.
const at=()=>new Date().toISOString();
const period=(r,d)=>!!r&&r.valid_from<=d&&(r.valid_to===null||r.valid_to>=d);
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const audit=(db,actor,action,target)=>db.run('INSERT INTO lc81_audit VALUES(?,?,?,?,?)',[uuid(),actor,action,target,at()]);
function domainCreate(db,type,payload,id=uuid()){
 applyEvent(db,{id:uuid(),entity_type:type,entity_id:id,operation:'create',expected_revision:0,payload,occurred_at:at()});return id;
}
const roleRow=(db,id)=>one(db,'SELECT id,code,name FROM business_role WHERE id=? AND archived=0',[id]);
const activePerson=(db,id)=>one(db,'SELECT id,display_name FROM person WHERE id=? AND archived=0',[id]);
const rootUnit=(db,id)=>{
 const seen=new Set();
 while(isId(id)&&!seen.has(id)){seen.add(id);const r=one(db,'SELECT id,parent_id FROM org_unit WHERE id=? AND archived=0',[id]);if(!r)return null;if(r.parent_id===null)return r.id;id=r.parent_id}return null;
};
const employment=(db,id,d)=>rows(db,'SELECT id,unit_id,valid_from,valid_to FROM person_assignment WHERE person_id=?',[id]).filter(r=>period(r,d)&&rootUnit(db,r.unit_id));
function account(db,id){
 const a=one(db,'SELECT * FROM lc81_account WHERE id=?',[id]);
 if(!a||a.state!=='active')return null;
 if(a.bootstrap===1)return roleRow(db,ADMIN_ROLE)?a:null;
 return activePerson(db,a.person_id)&&employment(db,a.person_id,day()).length===1?a:null;
}
function requireAdmin(db,id){const a=account(db,id);must(a?.bootstrap===1,403,'Требуются полномочия администратора');return a}
function sanitized(db,a){
 const p=a.person_id&&activePerson(db,a.person_id);
 return {id:a.id,person_id:a.person_id,login:a.login,state:a.state,display_name:p?.display_name||'Администратор',admin:a.bootstrap===1,credential_revision:a.credential_revision};
}
function auditView(db){return rows(db,'SELECT id,actor_account_id,action,target_id,occurred_at FROM lc81_audit ORDER BY occurred_at DESC,id LIMIT 100')}
function security(db,accountId){
 const a=account(db,accountId);if(!a||a.bootstrap===1)return {accounts:[],policies:[],grants:[]};
 const emp=employment(db,a.person_id,day())[0];
 const policies=rows(db,'SELECT * FROM lc81_policy').map(({role_id,revision,permissions_json})=>({role_id,revision,permissions:JSON.parse(permissions_json)}));
 const grants=rows(db,"SELECT * FROM lc81_grant WHERE account_id=? AND state='active' AND employment_id=?",[a.id,emp.id]).filter(g=>{
  const s=JSON.parse(g.scope_json);
  return s.kind!=='unit_tree'||rootUnit(db,s.unit_id)===rootUnit(db,emp.unit_id);
 }).map(g=>({...g,scope:JSON.parse(g.scope_json)}));
 return {accounts:[a],policies,grants};
}
function checkPrivate(db){
 verifyDb(db);
 must(one(db,"SELECT value FROM lc81_meta WHERE key='service_schema'")?.value==='1',503,'Неизвестная схема авторизации');
 const admins=rows(db,'SELECT * FROM lc81_account WHERE bootstrap=1');
 must(admins.length===1&&admins[0].state==='active'&&roleRow(db,ADMIN_ROLE)?.code==='LC81_ACCESS_ADMIN'&&roleRow(db,MANAGER_ROLE)?.code==='LC81_CENTER_MANAGER'&&rootUnit(db,SITE)===SITE,503,'Нарушена целостность начального администратора');
 for(const a of rows(db,'SELECT login,password_hash FROM lc81_account'))must(normalizeLogin(a.login)===a.login&&validHash(a.password_hash),503,'Повреждены данные авторизации');
 for(const p of rows(db,'SELECT * FROM lc81_policy')){
  const ps=JSON.parse(p.permissions_json);must(Array.isArray(ps)&&new Set(ps).size===ps.length&&ps.every(x=>READ_ACTIONS.includes(x))&&p.role_id!==ADMIN_ROLE,503,'Неверная политика');
 }
 must(!!one(db,'SELECT role_id FROM lc81_policy WHERE role_id=?',[MANAGER_ROLE]),503,'Нет политики управляющего');
}
const digest=b=>createHash('sha256').update(b).digest('hex');
function pack(db){
 const b=Buffer.from(bytesOf(db));must(b.length<=MAX,503,'Лимит QA-хранилища');
 return Buffer.concat([MAGIC,Buffer.from(digest(b)+'\n'),b]);
}
async function unpack(SQL,file){
 const st=await fs.stat(file);must(st.isFile()&&st.size<=MAX+MAGIC.length+65&&st.size>MAGIC.length+165,503,'Размер QA-хранилища');
 const b=await fs.readFile(file),off=MAGIC.length+65,body=b.subarray(off);
 must(b.subarray(0,MAGIC.length).equals(MAGIC)&&b.subarray(MAGIC.length,off).toString()===digest(body)+'\n',503,'Повреждён контрольный снимок');
 const db=openDb(SQL,new Uint8Array(body),{upgrade:false});
 try{checkPrivate(db);return db}catch(e){db.close();throw e}
}
export async function openSecureQA({dataDir,initialize=false,login='admin',password,write=atomicReplace}){
 must(path.isAbsolute(dataDir)&&dataDir!==path.parse(dataDir).root,503,'Требуется отдельная абсолютная папка QA');
 const {SQL,schema:domainSchema,migration}=await pilotSql();
 let fresh=false;
 try{await fs.mkdir(dataDir,{mode:0o700});fresh=true}catch(e){if(e.code!=='EEXIST')throw e}
 // An explicit init flag is required only for a newly created directory.
 // Never initialize an existing empty/corrupt directory or legacy volume.
 if(fresh&&!initialize){await fs.rmdir(dataDir);throw new PilotError(503,'Первичный запуск требует явной инициализации')}
 if(fresh&&(!normalizeLogin(login)||!validPassword(password))){await fs.rmdir(dataDir);throw new PilotError(503,'Требуется начальный секрет администратора')}
 const lock=path.join(dataDir,'writer.lock'),file=path.join(dataDir,'secure.lc81'),marker=path.join(dataDir,'initialized');
 const h=await fs.open(lock,'wx',0o600);await h.close();
 let current,poisoned=false,closed=false,tail=Promise.resolve(),queued=0;
 const release=()=>fs.rm(lock,{force:true});
 try{
  if(fresh){
   current=createDb(SQL,domainSchema,migration);current.run(schema);
   tx(current,()=>{
    current.run("INSERT INTO lc81_meta VALUES('service_schema','1')");
    domainCreate(current,'org_unit',{code:'LC81-QA',name:'Учебное предприятие',kind:'Предприятие',parent_id:null},SITE);
    domainCreate(current,'business_role',{code:'LC81_ACCESS_ADMIN',name:'Администратор'},ADMIN_ROLE);
    domainCreate(current,'business_role',{code:'LC81_CENTER_MANAGER',name:'Управляющий центром TWI'},MANAGER_ROLE);
    current.run('INSERT INTO lc81_policy VALUES(?,1,?)',[MANAGER_ROLE,JSON.stringify(READ_ACTIONS)]);
    const id=uuid();current.run('INSERT INTO lc81_account(id,person_id,login,password_hash,state,bootstrap,created_at) VALUES(?,NULL,?,?,\'active\',1,?)',[id,normalizeLogin(login),hashPassword(password),at()]);
    audit(current,id,'bootstrap',id);
   });
   checkPrivate(current);
   await write(file,pack(current));
   await write(marker,Buffer.from(meta(current,'database_id')+'\n'));
   current.close();current=null;
  }
  current=await unpack(SQL,file);
  must((await fs.readFile(marker,'utf8'))===meta(current,'database_id')+'\n',503,'Отсутствует или повреждён маркер инициализации');
 }catch(e){current?.close();await release();throw e}
 const ready=()=>must(!closed&&!poisoned,503,'Защищённое хранилище требует проверки');
 const read=fn=>{ready();return fn(current)};
 function mutate(fn){
  ready();must(queued<8,429,'Очередь сохранения занята');queued++;
  const task=tail.then(async()=>{
   ready();const candidate=openDb(SQL,bytesOf(current),{upgrade:false});
   try{
    const result=tx(candidate,()=>fn(candidate));checkPrivate(candidate);
    try{
     const packed=pack(candidate);await write(file,packed);
     const back=await unpack(SQL,file);try{must(digest(bytesOf(back))===digest(bytesOf(candidate)),503,'Запись не подтверждена')}finally{back.close()}
    }catch(e){poisoned=true;throw new PilotError(503,'Запись не подтверждена; требуется проверка хранилища')}
    current.close();current=candidate;return result;
   }finally{if(candidate!==current)candidate.close()}
  });
  tail=task.catch(()=>{}).finally(()=>{queued--});return task;
 }
 return {
  get healthy(){return !closed&&!poisoned},
  authenticate(login,password){return read(db=>{
   const name=normalizeLogin(login);const a=name&&one(db,'SELECT * FROM lc81_account WHERE login=?',[name]);
   const ok=verifyPassword(password,a?.password_hash);
   return ok&&account(db,a.id)?sanitized(db,a):null;
  })},
  session(id,revision){return read(db=>{const a=account(db,id);return a&&a.credential_revision===revision?sanitized(db,a):null})},
  adminData(actor){return read(db=>{
   requireAdmin(db,actor);
   return {accounts:rows(db,'SELECT * FROM lc81_account ORDER BY login').map(a=>sanitized(db,a)),
    people:rows(db,'SELECT id,display_name,employee_code FROM person WHERE archived=0 ORDER BY display_name'),
    units:rows(db,'SELECT id,parent_id,name,code FROM org_unit WHERE archived=0 ORDER BY name'),
    roles:rows(db,'SELECT id,code,name FROM business_role WHERE archived=0 ORDER BY name'),
    assignments:rows(db,'SELECT id,person_id,role_id,valid_from,valid_to FROM role_assignment'),
    employment:rows(db,'SELECT id,person_id,unit_id,valid_from,valid_to FROM person_assignment'),
    policies:rows(db,'SELECT * FROM lc81_policy').map(p=>({role_id:p.role_id,revision:p.revision,permissions:JSON.parse(p.permissions_json)})),
    grants:rows(db,'SELECT id,account_id,role_id,assignment_id,employment_id,scope_json,policy_revision,state,valid_from,valid_to FROM lc81_grant').map(g=>({...g,scope:JSON.parse(g.scope_json)})),
    actions:READ_ACTIONS,audit:auditView(db),site:SITE,protectedRoles:[ADMIN_ROLE,MANAGER_ROLE]};
  })},
  createReference(actor,type,payload){
   return mutate(db=>{
    requireAdmin(db,actor);
    must(['person','org_unit','business_role','role_assignment','person_assignment'].includes(type),403,'Неизвестное действие');
    must(payload&&typeof payload==='object'&&!Array.isArray(payload),400,'Неверные поля');
    // Only QA references; no generic writes, imports or business events.
    if(type==='org_unit')must(payload.parent_id&&rootUnit(db,payload.parent_id)===SITE,400,'Подразделение вне учебной площадки');
    if(type==='business_role')must(typeof payload.code==='string'&&!payload.code.toUpperCase().startsWith('LC81_'),400,'Системный код защищён');
    if(type==='role_assignment')must(payload.role_id!==ADMIN_ROLE,403,'Системный администратор защищён');
    if(type==='person_assignment')must(rootUnit(db,payload.unit_id)===SITE,400,'Подразделение вне учебной площадки');
    let id;try{id=domainCreate(db,type,payload)}catch{throw new PilotError(422,'Запись не прошла доменную проверку')}
    audit(db,actor,'directory.create.'+type,id);return {id};
   });
  },
  createAccount(actor,input){
   return mutate(db=>{
    requireAdmin(db,actor);must(keys(input,['person_id','login','password','generate']),400,'Неверные поля аккаунта');
    const {person_id,generate}=input,name=normalizeLogin(input.login);
    must(isId(person_id)&&activePerson(db,person_id)&&employment(db,person_id,day()).length===1&&name,422,'Нужен активный сотрудник, одно назначение и уникальный логин');
    must(!one(db,'SELECT id FROM lc81_account WHERE person_id=? OR login=?',[person_id,name]),409,'Аккаунт или логин уже существует');
    must(typeof generate==='boolean'&&(generate?input.password===null:validPassword(input.password)),422,'Укажите стойкий пароль');
    const secret=generate?generatePassword():input.password,id=uuid();
    db.run("INSERT INTO lc81_account(id,person_id,login,password_hash,state,bootstrap,created_at) VALUES(?,?,?,?,'active',0,?)",[id,person_id,name,hashPassword(secret),at()]);
    audit(db,actor,'account.create',id);return {id,login:name,...(generate?{issued_password:secret}:{})};
   });
  },
  setState(actor,id,state){
   return mutate(db=>{
    requireAdmin(db,actor);const a=one(db,'SELECT * FROM lc81_account WHERE id=?',[id]);
    must(a&&a.bootstrap!==1&&['active','blocked'].includes(state),403,'Защищённый аккаунт или неверное состояние');
    db.run('UPDATE lc81_account SET state=?,credential_revision=credential_revision+1 WHERE id=?',[state,id]);
    audit(db,actor,'account.'+state,id);return {id,state};
   });
  },
  setPolicy(actor,input){
   return mutate(db=>{
    requireAdmin(db,actor);must(keys(input,['role_id','revision','permissions']),400,'Неверные поля политики');
    const {role_id,revision,permissions}=input;
    must(roleRow(db,role_id)&&role_id!==ADMIN_ROLE&&role_id!==MANAGER_ROLE,403,'Системная политика защищена');
    must(Array.isArray(permissions)&&permissions.length<=READ_ACTIONS.length&&new Set(permissions).size===permissions.length&&permissions.every(p=>READ_ACTIONS.includes(p)),422,'Неизвестное право');
    const old=one(db,'SELECT revision FROM lc81_policy WHERE role_id=?',[role_id]);must(revision===(old?.revision||0),409,'Политика изменилась');
    db.run('INSERT INTO lc81_policy VALUES(?,?,?) ON CONFLICT(role_id) DO UPDATE SET revision=excluded.revision,permissions_json=excluded.permissions_json',[role_id,revision+1,JSON.stringify([...permissions].sort())]);
    audit(db,actor,'policy.update',role_id);return {revision:revision+1};
   });
  },
  grant(actor,input){
   return mutate(db=>{
    requireAdmin(db,actor);must(keys(input,['account_id','assignment_id','scope','valid_to']),400,'Неверные поля назначения');
    const a=account(db,input.account_id),d=day(),assignment=one(db,'SELECT * FROM role_assignment WHERE id=?',[input.assignment_id]);
    must(a&&a.bootstrap!==1&&assignment?.person_id===a.person_id&&assignment.role_id!==ADMIN_ROLE&&period(assignment,d)&&roleRow(db,assignment.role_id),422,'Не найдено действующее назначение роли');
    const emp=employment(db,a.person_id,d)[0],p=one(db,'SELECT * FROM lc81_policy WHERE role_id=?',[assignment.role_id]),s=input.scope;
    must(p&&s&&((keys(s,['kind'])&&['self','assigned'].includes(s.kind))||(keys(s,['kind','unit_id'])&&s.kind==='unit_tree'&&rootUnit(db,s.unit_id)===rootUnit(db,emp.unit_id))),422,'Нет политики или неверная область');
    if(assignment.role_id===MANAGER_ROLE)must(s.kind==='unit_tree'&&s.unit_id===SITE,422,'Управляющий назначается на площадку');
    const end=input.valid_to;
    must(end===null||typeof end==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&Number.isFinite(Date.parse(end+'T00:00:00Z'))&&new Date(end+'T00:00:00Z').toISOString().slice(0,10)===end&&end>=d,422,'Неверный срок');
    const id=uuid();db.run("INSERT INTO lc81_grant(id,account_id,role_id,assignment_id,employment_id,scope_json,policy_revision,state,valid_from,valid_to,revoked_at,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,'active',?,?,NULL,?,?)",[id,a.id,assignment.role_id,assignment.id,emp.id,JSON.stringify(s),p.revision,d,end,actor,at()]);
    audit(db,actor,'grant.create',id);return {id};
   });
  },
  revoke(actor,id){
   return mutate(db=>{
    requireAdmin(db,actor);must(one(db,"SELECT id FROM lc81_grant WHERE id=? AND state='active'",[id]),404,'Назначение не найдено');
    db.run("UPDATE lc81_grant SET state='revoked',revoked_at=? WHERE id=?",[at(),id]);audit(db,actor,'grant.revoke',id);return {id};
   });
  },
  readResource(actor,action,id){return read(db=>{
   const a=account(db,actor);if(!a)return null;
   const v=a.bootstrap===1?readManagerProjection(db,SITE,action,id,day()):readAuthorized(db,security(db,actor),actor,action,id,day());
   return v?.data??null;
  })},
  listResources(actor,action){return read(db=>{
   const a=account(db,actor);must(a,401,'Необходим вход');must(READ_ACTIONS.includes(action),404,'Раздел не найден');
   const table={'person.read_basic':'person','sop.read_effective':'document_revision','training.read':'training_assignment','task.read':'action_item'}[action];
   const s=security(db,actor);return rows(db,'SELECT id FROM '+table+' ORDER BY id').map(({id})=>a.bootstrap===1?readManagerProjection(db,SITE,action,id,day()):readAuthorized(db,s,actor,action,id,day())).filter(Boolean).map(v=>v.data);
  })},
  async close(){if(closed)return;await tail;closed=true;current.close();await release()}
 };
}
