// Isolated QA server. One protected, atomically replaced SQLite checkpoint
// containing the accepted v17 domain schema and private service tables.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pilotSql,atomicReplace,PilotError,PILOT_DOCUMENT_LIMIT} from '../lc74-store.mjs';
import {createDb,openDb,verifyDb,applyEvent,one,rows,uuid,tx,bytesOf,meta,isId,readSnapshot} from '../../src/core/db.js';
import {hashPassword,verifyPassword,validHash,normalizeLogin,generatePassword,validPassword} from './credentials.mjs';
import {READ_ACTIONS,readAuthorized,readManagerProjection,canImplementOwnTask,canChangeDirectory} from './read-policy.mjs';
import {REFERENCE_CREATE_TYPES,RESOURCE_TABLES,PERMISSIONS,DIRECTORIES,DIRECTORY_COMMANDS} from './access-contract.mjs';
import {applyDirectoryCommand,directorySchema} from './directory-commands.mjs';
import {refsForDb,checkContent,MAX_CONTENT} from '../../src/modules/library/domain.js';
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
// Existing QA stores retain their original IDs; migration records explicit mappings.
const config=db=>({
 site:one(db,"SELECT value FROM lc81_meta WHERE key='site_id'")?.value||SITE,
 admin:one(db,"SELECT value FROM lc81_meta WHERE key='admin_role_id'")?.value||ADMIN_ROLE,
 manager:one(db,"SELECT value FROM lc81_meta WHERE key='manager_role_id'")?.value||MANAGER_ROLE
});
const employment=(db,id,d)=>rows(db,'SELECT id,unit_id,valid_from,valid_to FROM person_assignment WHERE person_id=?',[id]).filter(r=>period(r,d)&&rootUnit(db,r.unit_id)===config(db).site);
function account(db,id){
 const a=one(db,'SELECT * FROM lc81_account WHERE id=?',[id]);
 if(!a||a.state!=='active')return null;
 if(a.bootstrap===1)return roleRow(db,config(db).admin)?a:null;
 return activePerson(db,a.person_id)&&employment(db,a.person_id,day()).length===1?a:null;
}
function requireAdmin(db,id){const a=account(db,id);must(a?.bootstrap===1,403,'Требуются полномочия администратора');return a}
function sanitized(db,a){
 const p=a.person_id&&activePerson(db,a.person_id);
 return {id:a.id,person_id:a.person_id,login:a.login,state:a.state,display_name:p?.display_name||(a.bootstrap===1?'Администратор':'Сотрудник недоступен'),admin:a.bootstrap===1,credential_revision:a.credential_revision,permissions:a.state==='active'&&account(db,a.id)?permissionsFor(db,a):[]};
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
function readFor(db,a,action,id,d){
 return a.bootstrap===1?readManagerProjection(db,config(db).site,action,id,d):readAuthorized(db,security(db,a.id),a.id,action,id,d);
}
function directoryAllowed(db,a,action,anchorAction,id,d){
 return DIRECTORY_COMMANDS.includes(action)&&(a.bootstrap===1?!!readManagerProjection(db,config(db).site,anchorAction,id,d):canChangeDirectory(db,security(db,a.id),a.id,action,anchorAction,id,d));
}
function directoryView(db,a,action,data,d){
 const type=Object.keys(DIRECTORIES).find(t=>DIRECTORIES[t].read===action);
 if(!type)return data;
 const def=DIRECTORIES[type];
 return {...data,can_update:directoryAllowed(db,a,def.update,action,data.id,d),can_archive:!!def.archive&&directoryAllowed(db,a,def.archive,action,data.id,d)};
}
function projectView(db,a,action,data,d){
 if(action!=='task.read')return directoryView(db,a,action,data,d);
 return {...data,can_implement:a.bootstrap!==1&&['open','in_progress','ineffective'].includes(data.state)&&canImplementOwnTask(db,security(db,a.id),a.id,data.id,d)};
}
function permissionsFor(db,a){
 if(a.bootstrap===1)return [...READ_ACTIONS,...DIRECTORY_COMMANDS]; // Unbound bootstrap cannot perform personal decisions.
 const d=day(),s=security(db,a.id),out=new Set();
 for(const g of s.grants){
  if(g.revoked_at!==null||!period(g,d)||!roleRow(db,g.role_id))continue;
  const arow=one(db,'SELECT person_id,role_id,valid_from,valid_to FROM role_assignment WHERE id=?',[g.assignment_id]);
  if(!arow||arow.person_id!==a.person_id||arow.role_id!==g.role_id||!period(arow,d))continue;
  const policy=s.policies.find(p=>p.role_id===g.role_id&&p.revision===g.policy_revision);
  for(const p of policy?.permissions||[])out.add(p);
 }
 return PERMISSIONS.filter(p=>out.has(p));
}
function checkPrivate(db){
 verifyDb(db);
 must(one(db,"SELECT value FROM lc81_meta WHERE key='service_schema'")?.value==='1',503,'Неизвестная схема авторизации');
 const admins=rows(db,'SELECT * FROM lc81_account WHERE bootstrap=1');
 const cfg=config(db);
 must(isId(cfg.site)&&isId(cfg.admin)&&isId(cfg.manager)&&cfg.admin!==cfg.manager&&admins.length===1&&admins[0].state==='active'&&roleRow(db,cfg.admin)&&roleRow(db,cfg.manager)&&rootUnit(db,cfg.site)===cfg.site,503,'Нарушена целостность начального администратора');
 for(const a of rows(db,'SELECT login,password_hash FROM lc81_account'))must(normalizeLogin(a.login)===a.login&&validHash(a.password_hash),503,'Повреждены данные авторизации');
 for(const p of rows(db,'SELECT * FROM lc81_policy')){
  const ps=JSON.parse(p.permissions_json);must(Array.isArray(ps)&&new Set(ps).size===ps.length&&ps.every(x=>PERMISSIONS.includes(x))&&p.role_id!==cfg.admin,503,'Неверная политика');
 }
 must(!!one(db,'SELECT role_id FROM lc81_policy WHERE role_id=?',[cfg.manager]),503,'Нет политики управляющего');
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
async function checkSources(db,dir){
 let total=0;
 for(const r of refsForDb(db)){
  const file=path.join(dir,'documents',r.sha256+'.json'),stat=await fs.stat(file);
  must(stat.isFile()&&stat.size===r.size&&stat.size<=MAX_CONTENT,503,'Отсутствует или повреждён исходник');
  total+=stat.size;must(total<=PILOT_DOCUMENT_LIMIT,503,'Лимит вложений QA');
  await checkContent(r,new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file)));
 }
}
async function copySources(db,target,readSource,write=atomicReplace){
 await fs.mkdir(path.join(target,'documents'),{mode:0o700});
 let total=0;
 for(const r of refsForDb(db)){
  const text=await checkContent(r,await readSource(r.sha256));
  total+=r.size;must(total<=PILOT_DOCUMENT_LIMIT,503,'Лимит вложений QA');
  await write(path.join(target,'documents',r.sha256+'.json'),Buffer.from(text,'utf8'));
 }
 await checkSources(db,target);
}
function selectRole(db,mapped,fallback,code,name){
 if(mapped!==null&&mapped!==undefined){
  must(isId(mapped)&&roleRow(db,mapped),422,'Выберите существующую активную роль');
  return mapped;
 }
 // Do not infer security roles from job titles or silently duplicate names.
 const collision=rows(db,'SELECT id,code,name FROM business_role').some(r=>r.id===fallback||r.code.toLowerCase()===code.toLowerCase()||r.name.trim().toLowerCase()===name.toLowerCase());
 must(!collision,422,'Роль уже существует: требуется явное сопоставление ID');
 return domainCreate(db,'business_role',{code,name},fallback);
}
export async function openSecureQA({dataDir,initialize=false,login='admin',password,write=atomicReplace,seed=null}){
 must(path.isAbsolute(dataDir)&&dataDir!==path.parse(dataDir).root,503,'Требуется отдельная абсолютная папка QA');
 const {SQL,schema:domainSchema,migration}=await pilotSql();
 let fresh=false;
 try{await fs.mkdir(dataDir,{mode:0o700});fresh=true}catch(e){if(e.code!=='EEXIST')throw e}
 // An explicit init flag is required only for a newly created directory.
 // Never initialize an existing empty/corrupt directory or legacy volume.
 if(seed&&!fresh)throw new PilotError(409,'Миграция только в новую папку');
 if(fresh&&!initialize){await fs.rmdir(dataDir);throw new PilotError(503,'Первичный запуск требует явной инициализации')}
 if(fresh&&(!normalizeLogin(login)||!validPassword(password))){await fs.rmdir(dataDir);throw new PilotError(503,'Требуется начальный секрет администратора')}
 const lock=path.join(dataDir,'writer.lock'),file=path.join(dataDir,'secure.lc81'),marker=path.join(dataDir,'initialized');
 const h=await fs.open(lock,'wx',0o600);await h.close();
 let current,poisoned=false,closed=false,copying=false,tail=Promise.resolve(),queued=0;
 const release=()=>fs.rm(lock,{force:true});
 try{
  if(fresh){
   current=seed?await readSnapshot(SQL,seed.snapshot.manifest,seed.snapshot.bytes):createDb(SQL,domainSchema,migration);
   must(!one(current,"SELECT name FROM sqlite_master WHERE name LIKE 'lc81_%' LIMIT 1"),422,'Источник уже содержит закрытые таблицы');
   if(seed){
    must(isId(seed.siteId)&&rootUnit(current,seed.siteId)===seed.siteId&&one(current,"SELECT id FROM org_unit WHERE id=? AND kind='Предприятие'",[seed.siteId]),422,'Выберите корень предприятия');
    must(rows(current,'SELECT id FROM org_unit WHERE archived=0').every(u=>rootUnit(current,u.id)===seed.siteId),422,'Пока поддерживается миграция одного предприятия; другие корни не удаляются');
   }
   current.run(schema);
   tx(current,()=>{
    current.run("INSERT INTO lc81_meta VALUES('service_schema','1')");
    const site=seed?seed.siteId:domainCreate(current,'org_unit',{code:'LC81-QA',name:'Учебное предприятие',kind:'Предприятие',parent_id:null},SITE);
    const admin=selectRole(current,seed?.adminRoleId,ADMIN_ROLE,'LC81_ACCESS_ADMIN','Администратор');
    const manager=selectRole(current,seed?.managerRoleId,MANAGER_ROLE,'LC81_CENTER_MANAGER','Управляющий центром TWI');
    must(admin!==manager,422,'Административная и рабочая роли должны различаться');
    for(const [k,v] of [['site_id',site],['admin_role_id',admin],['manager_role_id',manager]])current.run('INSERT INTO lc81_meta VALUES(?,?)',[k,v]);
    if(seed)current.run("INSERT INTO lc81_meta VALUES('migrated_snapshot_sha256',?)",[seed.snapshot.manifest.snapshot_sha256]);
    current.run('INSERT INTO lc81_policy VALUES(?,1,?)',[manager,JSON.stringify(PERMISSIONS)]);
    const id=uuid();current.run('INSERT INTO lc81_account(id,person_id,login,password_hash,state,bootstrap,created_at) VALUES(?,NULL,?,?,\'active\',1,?)',[id,normalizeLogin(login),hashPassword(password),at()]);
    audit(current,id,seed?'bootstrap.migrated':'bootstrap',id);
   });
   checkPrivate(current);
   if(seed)await copySources(current,dataDir,seed.readSource,write);
   else await fs.mkdir(path.join(dataDir,'documents'),{mode:0o700});
   await write(file,pack(current));
   await write(marker,Buffer.from(meta(current,'database_id')+'\n'));
   current.close();current=null;
  }
  current=await unpack(SQL,file);
  must((await fs.readFile(marker,'utf8'))===meta(current,'database_id')+'\n',503,'Отсутствует или повреждён маркер инициализации');
  await checkSources(current,dataDir);
 }catch(e){current?.close();await release();throw e}
 const ready=()=>must(!closed&&!poisoned,503,'Защищённое хранилище требует проверки');
 const read=fn=>{ready();return fn(current)};
 function mutate(fn){
  ready();must(!copying&&queued<8,429,'Очередь сохранения занята');queued++;
  const task=tail.then(async()=>{
   ready();const candidate=openDb(SQL,bytesOf(current),{upgrade:false});
   try{
    const result=tx(candidate,()=>fn(candidate));checkPrivate(candidate);
    try{
     const packed=pack(candidate);await write(file,packed);
     const back=await unpack(SQL,file);try{must((await fs.readFile(file)).equals(packed),503,'Запись не подтверждена')}finally{back.close()}
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
    actions:PERMISSIONS,audit:auditView(db),site:config(db).site,protectedRoles:[config(db).admin,config(db).manager]};
  })},
  createReference(actor,type,payload){
   return mutate(db=>{
    requireAdmin(db,actor);
    must(REFERENCE_CREATE_TYPES.includes(type),403,'Неизвестное действие');
    must(payload&&typeof payload==='object'&&!Array.isArray(payload),400,'Неверные поля');
    // Only QA references; no generic writes, imports or business events.
    if(type==='org_unit')must(payload.parent_id&&rootUnit(db,payload.parent_id)===config(db).site&&payload.kind!=='Предприятие',400,'Подразделение вне учебной площадки');
    if(type==='business_role')must(typeof payload.code==='string'&&!payload.code.toUpperCase().startsWith('LC81_'),400,'Системный код защищён');
    if(type==='role_assignment')must(payload.role_id!==config(db).admin,403,'Системный администратор защищён');
    if(type==='person_assignment')must(rootUnit(db,payload.unit_id)===config(db).site,400,'Подразделение вне учебной площадки');
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
    must(roleRow(db,role_id)&&role_id!==config(db).admin&&role_id!==config(db).manager,403,'Системная политика защищена');
    must(Array.isArray(permissions)&&permissions.length<=PERMISSIONS.length&&new Set(permissions).size===permissions.length&&permissions.every(p=>PERMISSIONS.includes(p)),422,'Неизвестное право');
    const old=one(db,'SELECT revision FROM lc81_policy WHERE role_id=?',[role_id]);must(revision===(old?.revision||0),409,'Политика изменилась');
    db.run('INSERT INTO lc81_policy VALUES(?,?,?) ON CONFLICT(role_id) DO UPDATE SET revision=excluded.revision,permissions_json=excluded.permissions_json',[role_id,revision+1,JSON.stringify([...permissions].sort())]);
    audit(db,actor,'policy.update',role_id);return {revision:revision+1};
   });
  },
  grant(actor,input){
   return mutate(db=>{
    requireAdmin(db,actor);must(keys(input,['account_id','assignment_id','scope','valid_to']),400,'Неверные поля назначения');
    const a=account(db,input.account_id),d=day(),assignment=one(db,'SELECT * FROM role_assignment WHERE id=?',[input.assignment_id]);
    must(a&&a.bootstrap!==1&&assignment?.person_id===a.person_id&&assignment.role_id!==config(db).admin&&period(assignment,d)&&roleRow(db,assignment.role_id),422,'Не найдено действующее назначение роли');
    const emp=employment(db,a.person_id,d)[0],p=one(db,'SELECT * FROM lc81_policy WHERE role_id=?',[assignment.role_id]),s=input.scope;
    must(p&&s&&((keys(s,['kind'])&&['self','assigned'].includes(s.kind))||(keys(s,['kind','unit_id'])&&s.kind==='unit_tree'&&rootUnit(db,s.unit_id)===rootUnit(db,emp.unit_id))),422,'Нет политики или неверная область');
    if(assignment.role_id===config(db).manager)must(s.kind==='unit_tree'&&s.unit_id===config(db).site,422,'Управляющий назначается на площадку');
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
   const v=a.bootstrap===1?readManagerProjection(db,config(db).site,action,id,day()):readAuthorized(db,security(db,actor),actor,action,id,day());
   return v?projectView(db,a,action,v.data,day()):null;
  })},
  listResources(actor,action){return read(db=>{
   const a=account(db,actor);must(a,401,'Необходим вход');must(READ_ACTIONS.includes(action)&&permissionsFor(db,a).includes(action),404,'Раздел недоступен');
   const table=RESOURCE_TABLES[action];
   const s=security(db,actor);return rows(db,'SELECT id FROM '+table+' ORDER BY id').map(({id})=>a.bootstrap===1?readManagerProjection(db,config(db).site,action,id,day()):readAuthorized(db,s,actor,action,id,day())).filter(Boolean).map(v=>projectView(db,a,action,v.data,day()));
  })},
  directoryInfo(actor,type){
   return read(db=>{
    const a=account(db,actor);
    must(a&&Object.hasOwn(DIRECTORIES,type),404,'Справочник недоступен');
    const d=DIRECTORIES[type],date=day();
    must(permissionsFor(db,a).includes(d.read),404,'Справочник недоступен');
    const refs={};
    for(const [t,action] of [['org_unit','org.read'],['equipment','equipment.read'],['workplace','workplace.read']]){
     refs[t]=rows(db,'SELECT id FROM '+t+' WHERE archived=0 ORDER BY id').flatMap(({id})=>{
      const r=readFor(db,a,action,id,date);
      return r?[{id,label:r.data.name,unit_id:r.data.unit_id??null,can_create:type==='org_unit'||type==='person'||type==='equipment'||type==='workplace'||type==='operation'?t==='org_unit'&&directoryAllowed(db,a,d.create,'org.read',id,date):false}]:[];
     });
    }
    return {type,definition:directorySchema(type),refs,can_create:refs.org_unit.some(x=>x.can_create),day:date};
   });
  },
  changeDirectory(actor,revision,input){
   return mutate(db=>{
    const a=account(db,actor);must(a&&a.credential_revision===revision,401,'Сеанс завершён');
    const d=day();
    must(Object.hasOwn(DIRECTORIES,input?.type)&&permissionsFor(db,a).includes(DIRECTORIES[input.type].read),403,'Справочник недоступен');
    return applyDirectoryCommand(db,input,{day:d,at:at(),site:config(db).site,read:(action,id)=>readFor(db,a,action,id,d),allows:(action,anchorAction,id)=>directoryAllowed(db,a,action,anchorAction,id,d),audit:(action,target)=>audit(db,actor,action,target)});
   });
  },
  implementOwnTask(actor,revision,input){
   return mutate(db=>{
    const a=account(db,actor);
    must(a&&a.credential_revision===revision,401,'Сеанс завершён');
    must(keys(input,['id','expected_revision','result'])&&isId(input.id)&&Number.isSafeInteger(input.expected_revision)&&input.expected_revision>0&&typeof input.result==='string'&&input.result.trim().length>0&&input.result.length<=2000,400,'Неверные поля выполнения');
    const sec=security(db,actor),d=day();
    must(a.bootstrap!==1&&canImplementOwnTask(db,sec,actor,input.id,d)&&readAuthorized(db,sec,actor,'task.read',input.id,d),403,'Можно выполнить только своё назначенное мероприятие');
    const row=one(db,'SELECT id,rev FROM action_item WHERE id=?',[input.id]);
    must(row?.rev===input.expected_revision,409,'Запись изменилась; обновите данные');
    const eventId=uuid();
    try{applyEvent(db,{id:eventId,entity_type:'action_item',entity_id:input.id,operation:'update',expected_revision:row.rev,payload:{command:'implement',result:input.result.trim(),business_offset_minutes:0},occurred_at:at()})}catch{throw new PilotError(422,'Выполнение не прошло существующие проверки мероприятия')}
    audit(db,actor,'task.implement_own',eventId);
    return one(db,'SELECT id,state,rev FROM action_item WHERE id=?',[input.id]);
   });
  },
  // Offline administrative maintenance only. No HTTP route exports this file.
  async copyCheckpoint(target){
   ready();must(path.isAbsolute(target),400,'Абсолютный путь новой папки');
   must(queued===0&&!copying,409,'Остановите сервер перед копированием');
   copying=true;let created=false;
   try{
    await fs.mkdir(target,{mode:0o700});created=true; // EEXIST is deliberate
    const checkpoint=pack(current),id=meta(current,'database_id');
    await copySources(current,target,async sha=>new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(path.join(dataDir,'documents',sha+'.json'))));
    await atomicReplace(path.join(target,'secure.lc81'),checkpoint);
    await atomicReplace(path.join(target,'initialized'),Buffer.from(id+'\n'));
    const checked=await unpack(SQL,path.join(target,'secure.lc81'));
    try{await checkSources(checked,target);must(meta(checked,'database_id')===id,503,'Копия другой базы')}finally{checked.close()}
    must((await fs.readFile(path.join(target,'secure.lc81'))).equals(checkpoint),503,'Копия не подтверждена');
    return {database_id:id,sha256:digest(checkpoint)};
   }catch(e){if(created)await fs.rm(target,{recursive:true,force:true});throw e}finally{copying=false}
  },
  async close(){if(closed)return;closed=true;await tail;current.close();await release()}
 };
}
