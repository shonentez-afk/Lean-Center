// LC7.4.0 experimental single-writer HTTP transport. The accepted domain engine is unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import initSqlJs from 'sql.js';
import {configureMigrations,createDb,openDb,meta,one,sha256,uuid,prepareSnapshot,readSnapshot,checkPackage,mergePackage,SCHEMA_VERSION,canonical} from '../src/core/db.js';
import {inspectSource,refsForDb,checkContent,validateRef,MAX_CONTENT} from '../src/modules/library/domain.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export const PILOT_DB_LIMIT=16*1024*1024, PILOT_DOCUMENT_LIMIT=256*1024*1024;
export class PilotError extends Error{
 constructor(status,message){super(message);this.status=status}
}
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const migrationFiles=['003_lc2','004_lc3','005_lc3_requirements','006_stage43_checklist','007_lc4_training','008_lc4_corporate_forms','009_lc42_methods','010_lc43_matrix','011_lc5_audit','012_lc51_assessments','013_lc52_integration','014_lc6_effect','015_lc63_twi_standard','016_lc64_twi_workflows','017_lc65_preparation_results'];
export async function pilotSql(){
 const read=p=>fs.readFile(path.join(root,p),'utf8');
 const [schema,migration,...rest]=await Promise.all([read('db/schema_v1.sql'),read('db/migrations/002_lc1.sql'),...migrationFiles.map(x=>read('db/migrations/'+x+'.sql'))]);
 configureMigrations(...rest);
 return {SQL:await initSqlJs(),schema,migration};
}
async function readBounded(file,max){
 const h=await fs.open(file,'r');
 try{const s=await h.stat();must(s.isFile()&&s.size>0&&s.size<=max,503,'Недопустимый размер файла хранилища');const b=await h.readFile();must(b.length===s.size,503,'Размер файла изменился при чтении');return b}finally{await h.close()}
}
async function syncDir(dir){const h=await fs.open(dir,'r');try{await h.sync()}finally{await h.close()}}
export async function atomicReplace(file,bytes){
 const tmp=file+'.'+uuid()+'.tmp';
 let h;
 try{
  h=await fs.open(tmp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;
  await fs.rename(tmp,file);await syncDir(path.dirname(file));
 }finally{if(h)await h.close();await fs.rm(tmp,{force:true})}
}
async function reconstruct(SQL,bytes){
 const db=openDb(SQL,new Uint8Array(bytes),{upgrade:false});
 try{
  must(Number(meta(db,'schema_version'))===SCHEMA_VERSION,503,'Неподдерживаемая схема серверного снимка');
  const p=one(db,'SELECT * FROM publication WHERE id=?',[meta(db,'publication_id')]);must(p,503,'Нет подтверждённого снимка');
  const manifest={format:'lean-snapshot-v1',id:p.id,database_id:meta(db,'database_id'),parent_id:p.parent_id,schema_version:p.schema_version,created_at:p.created_at,descriptor_hash:p.manifest_sha256,snapshot_sha256:await sha256(bytes),size:bytes.length};
  const verified=await readSnapshot(SQL,manifest,new Uint8Array(bytes));try{return {manifest,bytes:new Uint8Array(bytes),refs:refsForDb(verified)}}finally{verified.close()}
 }finally{db.close()}
}
export async function openPilot({dataDir,write=atomicReplace}){
 must(path.isAbsolute(dataDir),503,'Требуется абсолютный путь постоянного хранилища');
 const {SQL,schema,migration}=await pilotSql();
 await fs.mkdir(dataDir,{recursive:true});
 const lockPath=path.join(dataDir,'writer.lock'),statePath=path.join(dataDir,'state.sqlite'),docs=path.join(dataDir,'documents');
 // A second instance must fail closed. No timeout or automatic stale-lock removal.
 const lock=await fs.open(lockPath,'wx',0o600);
 try{await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));await lock.sync();await lock.close()}catch(e){await lock.close().catch(()=>{});await fs.rm(lockPath,{force:true});throw e}
 let current,closed=false,poisoned=false,tail=Promise.resolve(),queued=0;
 const release=()=>fs.rm(lockPath,{force:true});
 const docPath=ref=>path.join(docs,validateRef(ref).sha256+'.json');
 const readSource=async ref=>checkContent(ref,new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(docPath(ref),MAX_CONTENT)));
 try{
  let bytes;
  try{bytes=await readBounded(statePath,PILOT_DB_LIMIT)}catch(e){
   if(e.code!=='ENOENT')throw e;
   const existing=(await fs.readdir(dataDir)).filter(n=>n!=='writer.lock');
   must(existing.length===0,503,'Снимок отсутствует в непустом хранилище; требуется восстановление, не инициализация');
   const db=createDb(SQL,schema,migration);
   try{const s=await prepareSnapshot({SQL,base:db,pending:[]});await write(statePath,s.bytes);bytes=await readBounded(statePath,PILOT_DB_LIMIT)}finally{db.close()}
  }
  current=await reconstruct(SQL,bytes);
  await fs.mkdir(docs,{recursive:true});
  for(const ref of current.refs)await readSource(ref);
 }catch(e){await release();throw e}
 const ready=()=>must(!closed&&!poisoned,503,'Хранилище недоступно; требуется проверка и перезапуск');
 function enqueue(fn){
  ready();must(queued<8,429,'Очередь записи занята; повторите позже');queued++;
  const task=tail.then(()=>{must(!poisoned,503,'Хранилище требует проверки');return fn()});
  tail=task.catch(()=>{}).finally(()=>{queued--});return task
 }
 async function commit(p){
  return enqueue(async()=>{
   try{await checkPackage(p);must(p.schema_version===SCHEMA_VERSION&&p.base_publication_id!==null,422,'Требуется клиент схемы v17 и серверный снимок')}catch(e){if(e instanceof PilotError)throw e;throw new PilotError(422,'Пакет отклонён: '+e.message)}
   must(p.database_id===current.manifest.database_id,409,'Пакет другой базы');
   const db=await readSnapshot(SQL,current.manifest,current.bytes);
   try{
    let result,s,next;
    try{
     result=await mergePackage(db,p,readSource);
     if(result.duplicate)return {...result,publication_id:current.manifest.id};
     s=await prepareSnapshot({SQL,base:db,pending:[]});
     must(s.bytes.length<=PILOT_DB_LIMIT,413,'Лимит базы первого пилота 16 МиБ');
     next=await reconstruct(SQL,s.bytes);
     // Check all referenced source objects, not just those in this package.
     for(const ref of next.refs)await readSource(ref);
    }catch(e){if(e instanceof PilotError)throw e;throw new PilotError(/Конфликт версии|UNIQUE|Пересечение|Неизвестная исходная публикация/.test(e.message)?409:422,'Пакет отклонён: '+e.message)}
    try{
     await write(statePath,s.bytes);
     const back=await readBounded(statePath,PILOT_DB_LIMIT);
     must(await sha256(back)===next.manifest.snapshot_sha256,503,'Записанный снимок не прошёл SHA-256');
     current=next;
    }catch(e){poisoned=true;throw new PilotError(503,'Подтверждение записи недоступно; повторять только после проверки хранилища')}
    return {...result,publication_id:current.manifest.id};
   }finally{db.close()}
  })
 }
 async function putSource(sha,kind,text){
  return enqueue(async()=>{
   let parsed;
   try{parsed=await inspectSource(text,kind);must(parsed.source.sha256===sha,422,'SHA-256 исходника не совпадает')}catch(e){if(e instanceof PilotError)throw e;throw new PilotError(422,'Исходник отклонён: '+e.message)}
   const ref=parsed.source,file=docPath(ref);
   try{await readSource(ref);return {duplicate:true,ref}}catch(e){if(e.code!=='ENOENT')throw e}
   const entries=await fs.readdir(docs,{withFileTypes:true});
   let total=0;for(const x of entries){if(x.isFile())total+=(await fs.stat(path.join(docs,x.name))).size}
   must(total+ref.size<=PILOT_DOCUMENT_LIMIT,413,'Лимит документов первого пилота 256 МиБ');
   await write(file,Buffer.from(text,'utf8'));await readSource(ref);return {duplicate:false,ref}
  })
 }
 async function getSource(sha){
  ready();const ref=current.refs.find(r=>r.sha256===sha);must(ref,404,'Исходник не зарегистрирован в опубликованной базе');
  return readSource(ref)
 }
 return {
  get healthy(){return !closed&&!poisoned},
  snapshot(){ready();return {manifest:structuredClone(current.manifest),bytes:new Uint8Array(current.bytes)}},
  commit,putSource,getSource,
  async close(){if(closed)return;closed=true;await tail;await release()}
 };
}
