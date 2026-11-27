// Isolated QA server. One protected, atomically replaced SQLite checkpoint
// containing the accepted v17 domain schema and private service tables.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pilotSql,atomicReplace,PilotError,PILOT_DOCUMENT_LIMIT} from '../lc74-store.mjs';
import {createDb,openDb,verifyDb,applyEvent,one,rows,uuid,tx,bytesOf,meta,isId,readSnapshot} from '../../src/core/db.js';
import {hashPassword,verifyPassword,validHash,normalizeLogin,generatePassword,validPassword} from './credentials.mjs';
import {READ_ACTIONS,readAuthorized,readManagerProjection,canImplementOwnTask,canChangeDirectory,canReadSopPhoto,canUseLibrary,canReadLibraryAtOperation,canUseTrainingResource,bootstrapTrainingScope,canReadPersonCard,trainingAssignmentResource,matrixResource} from './read-policy.mjs';
import {REFERENCE_CREATE_TYPES,RESOURCE_TABLES,PERMISSIONS,DIRECTORIES,DIRECTORY_COMMANDS,DETAIL_ACTIONS,LIBRARY_COMMANDS,TRAINING_COMMANDS} from './access-contract.mjs';
import {trainingOptions,resolveTrainingCreate,createTraining,changeTraining,trainingDetail,trainingSop} from './training-commands.mjs';
import {matrixInfo,saveMatrix,retireMatrix,matrixDetail,suggestMatrix} from './matrix-commands.mjs';
import {personCard} from './person-card.mjs';
import {competencyOptions,competencyChange,competencyView,assessmentDetail} from './competency-commands.mjs';
import {mentorOptions,changeMentor,mentorView} from './mentor-commands.mjs';
import {developmentOptions,createDevelopment,developmentDetail,changeDevelopment,developmentFromMatrix,bankOptions,bankDetail,saveBank,developmentView} from './development-commands.mjs';
import {qualityOptions,installMentorMethod,createAudit,createSelf,voidAudit,qualityDetail,taskOptions,createTask,taskDetail,changeTask,qualityView} from './quality-commands.mjs';
import {workflowView,orderOptions,registerOrder,orderDetail,supplementOptions,createSupplement,supplementDetail,changeSupplement} from './mentor-workflows.mjs';
import {programView,programOptions,saveProgram,retireProgram,programDetail,enrollmentOptions,createEnrollment,changeEnrollment,enrollmentDetail,preparationOptions,createPreparation,preparationDetail,preparationFactOptions,recordPreparationFact} from './program-commands.mjs';
import {requestDigest,getReceipt,addReceipt} from './library-receipts.mjs';
import {resolveLibraryContext,contextStamp,checkedLibrarySource,sourceForEditor,inspectLibraryText,saveLibrary,passportLibrary,finalizeLibrary,detailDescriptor,projectLibraryDetail,libraryReadAction} from './library-commands.mjs';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {photoDescriptor,extractPhoto} from './sop-photo.mjs';
import {applyDirectoryCommand,directorySchema} from './directory-commands.mjs';
import {refsForDb,checkContent,MAX_CONTENT,verifyDomainEvents} from '../../src/modules/library/domain.js';
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
function photoAllowed(db,a,id,d){return !!readFor(db,a,'sop.read_steps',id,d)&&(a.bootstrap===1||canReadSopPhoto(db,security(db,a.id),a.id,id,d))}
function libraryAccess(db,a,d){
 return {read:(action,id)=>readFor(db,a,action,id,d),allows:(action,anchor,id)=>(LIBRARY_COMMANDS.includes(action)||DETAIL_ACTIONS.includes(action))&&(a.bootstrap===1?action!=='frv.finalize'&&!!readManagerProjection(db,config(db).site,anchor,id,d):canUseLibrary(db,security(db,a.id),a.id,action,anchor,id,d)),readScope:(kind,id)=>a.bootstrap===1?!!readManagerProjection(db,config(db).site,'operation.read',id,d):canReadLibraryAtOperation(db,security(db,a.id),a.id,kind,id,d),permissions:permissionsFor(db,a)};
}
function trainingAccess(db,a,d){
 return {accountId:a.id,personId:a.person_id,credentialRevision:a.credential_revision,day:d,at:at(),permissions:permissionsFor(db,a),
 read:(action,id)=>readFor(db,a,action,id,d),
 allows:(action,id,resource)=>a.bootstrap===1?DETAIL_ACTIONS.includes(action)&&bootstrapTrainingScope(db,config(db).site,resource):canUseTrainingResource(db,security(db,a.id),a.id,action,id,d,resource),
 audit:(action,target)=>audit(db,a.id,action,target),
 actorAccess:(id,revision)=>{const other=account(db,id);return other&&other.credential_revision===revision?trainingAccess(db,other,d):null}};
}
function cardAllowed(db,a,id,d){
 return a.bootstrap===1?!!readManagerProjection(db,config(db).site,'person.read_basic',id,d):canReadPersonCard(db,security(db,a.id),a.id,id,d);
}
function projectView(db,a,action,data,d){
 if(action==='person.read_basic'||action==='person.read_directory'){
  const view=directoryView(db,a,action,data,d);
  return cardAllowed(db,a,data.id,d)?{...view,can_card:true}:view;
 }
 if(action==='training.read'){
  const access=trainingAccess(db,a,d),resource=trainingAssignmentResource(db,data.id,d);
  return {...data,trainee_name:one(db,'SELECT display_name FROM person WHERE id=?',[data.trainee_id])?.display_name||'',operation_name:one(db,'SELECT name FROM operation WHERE id=?',[data.operation_id])?.name||'',can_detail:access.allows('training.detail',data.id,resource),can_sop:access.allows('training.read_sop',data.id,resource)};
 }
 if(['program.read','training.enrollment.read','preparation.read'].includes(action))return programView(db,trainingAccess(db,a,d),action,data);
 if(['skill.read','requirement.read','coverage.read','assessment.read'].includes(action))return competencyView(db,trainingAccess(db,a,d),action,data);
 if(['development.read','bank.read'].includes(action))return developmentView(db,trainingAccess(db,a,d),action,data);
 if(['audit.read','self.read'].includes(action))return qualityView(db,trainingAccess(db,a,d),action,data);
 if(['order.read','supplement.read'].includes(action))return workflowView(db,trainingAccess(db,a,d),action,data);
 if(['credential.read','appointment.read','authorization.read'].includes(action))return mentorView(db,trainingAccess(db,a,d),action.split('.')[0],data);
 if(action==='matrix.read'){
  const m=one(db,'SELECT * FROM competency_matrix WHERE id=?',[data.id]),r=matrixResource(db,m.unit_id,JSON.parse(m.roster_json),JSON.parse(m.columns_json),d,m.base_on);
  return {...data,can_detail:trainingAccess(db,a,d).allows('matrix.detail',data.id,r)};
 }
 if(action==='sop.read_history'){
  const v=libraryAccess(db,a,d),id=data.revision_id,active=!data.document_archived;
  return {...data,can_edit:active&&data.state==='draft'&&v.allows('sop.edit_draft',action,id),can_revise:active&&['effective','superseded','withdrawn'].includes(data.state)&&!one(db,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('draft','review','approved')",[data.document_id])&&v.allows('sop.revise',action,id),can_passport:active&&data.state==='draft'&&v.allows('sop.passport',action,id)};
 }
 if(action==='sop.read_effective'){
  const v=libraryAccess(db,a,d),id=data.revision_id;
  return {...data,can_twi:v.allows('sop.read_twi',action,id),can_linked_frv:v.allows('sop.read_linked_frv',action,id)};
 }
 if(action==='frv.read'){
  const v=libraryAccess(db,a,d);
  return {...data,can_edit:data.state==='draft'&&v.allows('frv.edit_draft',action,data.id),can_finalize:!!a.person_id&&data.state==='draft'&&v.allows('frv.finalize',action,data.id),can_summary:v.allows('frv.read_summary',action,data.id),can_create_sop:data.state!=='archived'&&v.permissions.includes('sop.read_history')&&v.readScope('sop',data.operation_id)&&!!v.read('operation.read',data.operation_id)&&v.allows('sop.create','operation.read',data.operation_id)&&v.allows('sop.from_frv',action,data.id)};
 }
 if(action==='sop.read_steps')return {...data,can_read_photo:photoAllowed(db,a,data.revision_id,d)};
 if(action!=='task.read')return directoryView(db,a,action,data,d);
 const view=qualityView(db,trainingAccess(db,a,d),action,data),t=one(db,'SELECT kind,followup_assignment_id,followup_enrollment_id FROM action_item WHERE id=?',[data.id]);
 return {...view,can_implement:a.bootstrap!==1&&['open','in_progress','ineffective'].includes(view.state)&&canImplementOwnTask(db,security(db,a.id),a.id,data.id,d)&&(t.kind!=='trainee_training'||!!t.followup_assignment_id)&&(t.kind!=='instructor_training'||!!t.followup_enrollment_id)};
}
function permissionsFor(db,a){
 if(a.bootstrap===1)return [...READ_ACTIONS,...DIRECTORY_COMMANDS,...DETAIL_ACTIONS,...LIBRARY_COMMANDS.filter(x=>x!=='frv.finalize')]; // Unbound bootstrap cannot perform personal decisions.
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
 function mutate(fn,beforeWrite=null){
  ready();must(!copying&&queued<8,429,'Очередь сохранения занята');queued++;
  const task=tail.then(async()=>{
   ready();const candidate=openDb(SQL,bytesOf(current),{upgrade:false});
   try{
    const result=tx(candidate,()=>fn(candidate));checkPrivate(candidate);
    if(beforeWrite)await beforeWrite(candidate);
    try{
     const packed=pack(candidate);await write(file,packed);
     const back=await unpack(SQL,file);try{must((await fs.readFile(file)).equals(packed),503,'Запись не подтверждена')}finally{back.close()}
    }catch(e){poisoned=true;throw new PilotError(503,'Запись не подтверждена; требуется проверка хранилища')}
    current.close();current=candidate;return result;
   }finally{if(candidate!==current)candidate.close()}
  });
  tail=task.catch(()=>{}).finally(()=>{queued--});return task;
 }
 const readFile=async ref=>{
  const name=path.join(dataDir,'documents',ref.sha256+'.json'),st=await fs.stat(name);
  must(st.isFile()&&st.size===ref.size&&st.size<=MAX_CONTENT,503,'Исходник не подтверждён');
  return new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(name));
 };
 async function persistSource(candidate,ref,text){
  const refs=refsForDb(candidate);
  must(refs.some(x=>x.sha256===ref.sha256)&&refs.reduce((n,x)=>n+x.size,0)<=PILOT_DOCUMENT_LIMIT,413,'Лимит исходников');
  const dir=path.join(dataDir,'documents'),name=path.join(dir,ref.sha256+'.json');
  let existing=false;
  try{await fs.stat(name);existing=true}catch(e){if(e.code!=='ENOENT')throw e}
  if(!existing){
   let total=0;
   for(const file of await fs.readdir(dir,{withFileTypes:true})){
    must(file.isFile(),503,'Неизвестный объект в хранилище');
    total+=(await fs.stat(path.join(dir,file.name))).size;
   }
   must(total+ref.size<=PILOT_DOCUMENT_LIMIT,413,'Лимит исходников, включая неподтверждённые файлы');
   await write(name,Buffer.from(text,'utf8'));
  }
  await checkContent(ref,await readFile(ref));
 }
 function checkedAccount(db,actor,revision){const a=account(db,actor);must(a&&a.credential_revision===revision,401,'Сеанс завершён');return a}
 const resolveCtx=(db,actor,revision,input)=>resolveLibraryContext(db,input,libraryAccess(db,checkedAccount(db,actor,revision),day()));
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
  trainingOptions(actor,revision,operationId=null){return read(db=>trainingOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),operationId))},
  async createTraining(actor,revision,input){
   const resolved=read(db=>resolveTrainingCreate(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day())));
   try{await verifyDomainEvents([{id:uuid(),entity_type:'training_assignment',entity_id:uuid(),operation:'create',expected_revision:0,payload:resolved.payload,occurred_at:at()}],ref=>readFile(ref))}
   catch(e){throw new PilotError(422,'Проверьте исходный СОП, актуальный план TWI и методику: '+String(e.message||'ошибка').split('\n')[0].slice(0,200))}
   return mutate(db=>{
    const access=trainingAccess(db,checkedAccount(db,actor,revision),day()),next=resolveTrainingCreate(db,input,access);
    must(next.source.sha256===resolved.source.sha256&&JSON.stringify(next.payload)===JSON.stringify(resolved.payload),409,'Назначение изменилось при проверке');
    return createTraining(db,next,access);
   });
  },
  changeTraining(actor,revision,input){return mutate(db=>changeTraining(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  trainingDetail(actor,revision,id){return read(db=>trainingDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  trainingSop(actor,revision,id){return read(db=>trainingSop(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  programOptions(actor,revision){return read(db=>programOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  saveProgram(actor,revision,input){return mutate(db=>saveProgram(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  retireProgram(actor,revision,input){return mutate(db=>retireProgram(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  programDetail(actor,revision,id){return read(db=>programDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  enrollmentOptions(actor,revision){return read(db=>enrollmentOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  createEnrollment(actor,revision,input){return mutate(db=>createEnrollment(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  changeEnrollment(actor,revision,input){return mutate(db=>changeEnrollment(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  enrollmentDetail(actor,revision,id){return read(db=>enrollmentDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  preparationOptions(actor,revision){return read(db=>preparationOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  createPreparation(actor,revision,input){return mutate(db=>createPreparation(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  preparationFactOptions(actor,revision,id,on){return read(db=>preparationFactOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id,on))},
  recordPreparationFact(actor,revision,input){return mutate(db=>recordPreparationFact(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  preparationDetail(actor,revision,id){return read(db=>preparationDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  orderOptions(actor,revision){return read(db=>orderOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  registerOrder(actor,revision,input){return mutate(db=>registerOrder(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  orderDetail(actor,revision,id){return read(db=>orderDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  supplementOptions(actor,revision){return read(db=>supplementOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  createSupplement(actor,revision,input){return mutate(db=>createSupplement(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  supplementDetail(actor,revision,id){return read(db=>supplementDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  changeSupplement(actor,revision,input){return mutate(db=>changeSupplement(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  developmentOptions(actor,revision){return read(db=>developmentOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  createDevelopment(actor,revision,input){return mutate(db=>createDevelopment(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  developmentDetail(actor,revision,id){return read(db=>developmentDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  changeDevelopment(actor,revision,input){return mutate(db=>changeDevelopment(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  developmentFromMatrix(actor,revision,input){return mutate(db=>developmentFromMatrix(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  bankOptions(actor,revision){return read(db=>bankOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  bankDetail(actor,revision,id){return read(db=>bankDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  saveBank(actor,revision,input){return mutate(db=>saveBank(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  qualityOptions(actor,revision,kind){return read(db=>qualityOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),kind))},
  installMentorMethod(actor,revision,input){return mutate(db=>installMentorMethod(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  createAudit(actor,revision,input){return mutate(db=>createAudit(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  createSelf(actor,revision,input){return mutate(db=>createSelf(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  voidAudit(actor,revision,input){return mutate(db=>voidAudit(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  qualityDetail(actor,revision,kind,id){return read(db=>qualityDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),kind,id))},
  taskOptions(actor,revision,source){return read(db=>taskOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),source))},
  createTask(actor,revision,input){return mutate(db=>createTask(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  taskDetail(actor,revision,id){return read(db=>taskDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  changeTask(actor,revision,input){return mutate(db=>changeTask(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  mentorOptions(actor,revision,kind){return read(db=>mentorOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),kind))},
  changeMentor(actor,revision,input){return mutate(db=>changeMentor(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  competencyOptions(actor,revision,kind,personId=null,skillId=null){return read(db=>competencyOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),kind,personId,skillId))},
  competencyChange(actor,revision,input){return mutate(db=>competencyChange(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  assessmentDetail(actor,revision,id){return read(db=>assessmentDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  suggestMatrix(actor,revision,input){return read(db=>suggestMatrix(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),input))},
  matrixInfo(actor,revision,unit=null,baseOn=null,filters={}){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day());return matrixInfo(db,a,unit,baseOn??a.day,filters)})},
  saveMatrix(actor,revision,input){return mutate(db=>saveMatrix(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  retireMatrix(actor,revision,input){return mutate(db=>retireMatrix(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day())))},
  matrixDetail(actor,revision,id){return read(db=>matrixDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day()),id))},
  personCard(actor,revision,id){return read(db=>{const a=checkedAccount(db,actor,revision),d=day();return personCard(db,trainingAccess(db,a,d),id,i=>cardAllowed(db,a,i,d))})},
  libraryInfo(actor,kind){
   return read(db=>{
    const a=account(db,actor);must(a&&['sop','frv'].includes(kind),404,'Раздел недоступен');
    const access=libraryAccess(db,a,day());
    must(access.permissions.includes(libraryReadAction(kind)),404,'Раздел недоступен');
    return {operations:rows(db,'SELECT id FROM operation WHERE archived=0 ORDER BY name').flatMap(({id})=>{
     const r=access.read('operation.read',id);
     return r&&access.readScope(kind,id)&&access.allows(kind+'.create','operation.read',id)?[{id,name:r.data.name,code:r.data.code}]:[];
    }),day:day()};
   });
  },
  async openLibrary(actor,revision,input){
   const ctx=read(db=>resolveCtx(db,actor,revision,input));
   let text;try{text=await sourceForEditor(ctx,readFile)}catch(e){if(e instanceof PilotError)throw e;throw new PilotError(422,'Не удалось подготовить проверенный исходник: '+String(e.message||'ошибка').split('\n')[0].slice(0,180))}
   return read(db=>{
    const next=resolveCtx(db,actor,revision,input);
    must(contextStamp(next)===contextStamp(ctx),409,'Документ изменился при открытии');
    const a=checkedAccount(db,actor,revision),d=day();
    // Only visible directory entries. Omit protected role names and unrelated personnel.
    const people=directoryPeople(db,d).filter(p=>readFor(db,a,'person.read_directory',p.id,d)).map(({id,employee_code,display_name,position,unit})=>({id,employee_code,display_name,position,unit,roles:[]}));
    return {context:ctx.input,expected_revision:ctx.expected,title:ctx.title,code:ctx.code,observed_at:ctx.observed_at,operation:ctx.operation,people,text};
   });
  },
  async saveLibrary(actor,revision,request){
   must(keys(request,['request_id','context','expected_revision','title','code','observed_at','text'])&&typeof request.text==='string'&&Buffer.byteLength(request.text,'utf8')<=MAX_CONTENT,400,'Неверные поля сохранения');
   const digest=requestDigest(request);
   const priorResult=db=>{
    const a=checkedAccount(db,actor,revision),prior=getReceipt(db,actor,request.request_id,digest);
    if(!prior)return null;
    const kind=request.context?.kind,access=libraryAccess(db,a,day());
    must(['sop','frv'].includes(kind)&&access.read(libraryReadAction(kind),kind==='sop'?prior.revision_id:prior.id),403,'Документ недоступен');
    return {...prior,duplicate:true};
   };
   const prior=read(priorResult);if(prior)return prior;
   const ctx=read(db=>resolveCtx(db,actor,revision,request.context));
   must(request.expected_revision===ctx.expected,409,'Документ изменился. Откройте актуальную редакцию.');
   // Revalidate the actual measured source when creating a draft from FRV.
   if(ctx.origin)try{await sourceForEditor(ctx,readFile)}catch(e){throw new PilotError(422,'Проект из ФРВ не подтверждён')}
   const inspected=await inspectLibraryText(ctx.input.kind,request.text);
   let replay=false;
   return mutate(db=>{
    const existing=priorResult(db);if(existing){replay=true;return existing}
    const current=resolveCtx(db,actor,revision,request.context);
    must(contextStamp(current)===contextStamp(ctx),409,'Документ изменился при сохранении');
    const result=saveLibrary(db,request,current,inspected,{at:at(),audit:(action,target)=>audit(db,actor,action,target)});
    addReceipt(db,actor,request.request_id,digest,result,at());return result;
   },candidate=>replay?undefined:persistSource(candidate,inspected.source,request.text));
  },
  passportLibrary(actor,revision,input){return mutate(db=>{
   const a=checkedAccount(db,actor,revision);
   return passportLibrary(db,input,{...libraryAccess(db,a,day()),at:at(),audit:(action,target)=>audit(db,actor,action,target)});
  })},
  finalizeLibrary(actor,revision,input){return mutate(db=>{
   const a=checkedAccount(db,actor,revision);
   return finalizeLibrary(db,input,{...libraryAccess(db,a,day()),personId:a.person_id,at:at(),audit:(action,target)=>audit(db,actor,action,target)});
  })},
  async libraryDetail(actor,revision,action,id){
   const desc=read(db=>detailDescriptor(db,action,id,libraryAccess(db,checkedAccount(db,actor,revision),day())));
   const data=await checkedLibrarySource(desc,readFile);
   return read(db=>{
    const latest=detailDescriptor(db,action,id,libraryAccess(db,checkedAccount(db,actor,revision),day()));
    must(latest.source.sha256===desc.source.sha256,409,'Материал изменился');
    return projectLibraryDetail(action,data.raw);
   });
  },
  async sopPhoto(actor,revision,id,position){
   must(isId(id)&&Number.isSafeInteger(position)&&position>=1&&position<=1000,404,'Фото недоступно');
   const descriptor=read(db=>{
    const a=account(db,actor);must(a&&a.credential_revision===revision&&photoAllowed(db,a,id,day()),404,'Фото недоступно');
    return photoDescriptor(db,id,position);
   });
   must(descriptor,404,'Фото недоступно');
   const file=path.join(dataDir,'documents',descriptor.source.sha256+'.json');
   const st=await fs.stat(file);must(st.isFile()&&st.size===descriptor.source.size&&st.size<=MAX_CONTENT,503,'Исходник не подтверждён');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file));
   const result=await extractPhoto(descriptor,text);
   // Authorization and effective revision may have changed during I/O.
   read(db=>{
    const a=account(db,actor),latest=photoDescriptor(db,id,position);
    must(a&&a.credential_revision===revision&&photoAllowed(db,a,id,day())&&latest?.source.sha256===descriptor.source.sha256&&latest.sourceId===descriptor.sourceId,404,'Фото недоступно');
   });
   return result;
  },
  upgradeManagerPolicy(actor,input){
   return mutate(db=>{
    requireAdmin(db,actor);must(keys(input,['revision']),400,'Неверные поля политики');
    const id=config(db).manager,old=one(db,'SELECT * FROM lc81_policy WHERE role_id=?',[id]);
    must(old&&old.revision===input.revision,409,'Политика изменилась');
    if(JSON.stringify([...JSON.parse(old.permissions_json)].sort())===JSON.stringify([...PERMISSIONS].sort()))return {revision:old.revision};
    db.run('UPDATE lc81_policy SET revision=revision+1,permissions_json=? WHERE role_id=?',[JSON.stringify(PERMISSIONS),id]);
    audit(db,actor,'policy.manager_upgrade',id);
    return {revision:old.revision+1};
   });
  },
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
      return r?[{id,label:r.data.name,unit_id:r.data.unit_id??null,can_create:t==='org_unit'&&directoryAllowed(db,a,d.create,'org.read',id,date)}]:[];
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
    const row=one(db,'SELECT * FROM action_item WHERE id=?',[input.id]);
    must(row?.rev===input.expected_revision,409,'Запись изменилась; обновите данные');
    must(row.kind!=='trainee_training'||row.followup_assignment_id,422,'Сначала свяжите мероприятие с повторным обучением');
    must(row.kind!=='instructor_training'||row.followup_enrollment_id,422,'Сначала свяжите мероприятие с программой переобучения инструктора');
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
