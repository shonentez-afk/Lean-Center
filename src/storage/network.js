import {refsForEvents,refsForDb,validateRef,checkContent} from '../modules/library/domain.js';
import {invariant,uuid,sha256,canonical,readSnapshot,checkSnapshotManifest,checkPackage,isId,MAX_DB,MAX_PACKAGE} from '../core/db.js';
const textBytes=s=>new TextEncoder().encode(s);
export async function chooseFolder(){invariant(window.showDirectoryPicker,'Выбор папки запрещён браузером. Используйте ручной импорт и экспорт.');return window.showDirectoryPicker({id:'lean-center-network',mode:'readwrite'})}
export async function permission(h,request=false){if(!h)return false;let p=await h.queryPermission({mode:'readwrite'});if(p!=='granted'&&request)p=await h.requestPermission({mode:'readwrite'});return p==='granted'}
async function sub(h,name,create=false){return h.getDirectoryHandle(name,{create})}
export async function readFile(dir,name,max=MAX_DB){const f=await (await dir.getFileHandle(name)).getFile();invariant(f.size<=max,'Файл превышает лимит: '+name);return new Uint8Array(await f.arrayBuffer())}
export async function writeNew(dir,name,data){try{await dir.getFileHandle(name);throw new Error('Файл уже существует: '+name)}catch(e){if(e.name!=='NotFoundError')throw e}const f=await dir.getFileHandle(name,{create:true}),w=await f.createWritable();try{await w.write(data);await w.close()}catch(e){try{await w.abort()}catch{}throw e}const expected=typeof data==='string'?textBytes(data):data;const back=await readFile(dir,name,Math.max(MAX_DB,expected.length));invariant(await sha256(back)===await sha256(expected),'Запись не прошла контроль SHA-256: '+name)}
export async function testFolder(h){invariant(await permission(h,true),'Нет разрешения на запись');const name='.lean-test-'+uuid()+'.txt';await writeNew(h,name,'LEAN CENTER / TEST');await h.removeEntry(name);return true}
export async function readContent(h,ref){validateRef(ref);invariant(await permission(h,false),'Нет доступа к исходным файлам');const d=await sub(h,'Documents'),bytes=await readFile(d,ref.sha256+'.json',ref.size);return checkContent(ref,new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
export async function ensureContent(h,ref,read){validateRef(ref);invariant(await permission(h,true),'Нет доступа к папке');const d=await sub(h,'Documents',true),name=ref.sha256+'.json';let exists=true;try{await d.getFileHandle(name)}catch(e){if(e.name!=='NotFoundError')throw e;exists=false}
 if(exists){await readContent(h,ref);return}
 invariant(typeof read==='function','Нет исходного файла '+ref.sha256);const text=await checkContent(ref,await read(ref));try{await writeNew(d,name,text)}catch(e){if(!String(e.message).startsWith('Файл уже существует:'))throw e}await readContent(h,ref)
}
export async function sendPackage(h,p,read){
 invariant(await permission(h,true),'Нет доступа к папке');await checkPackage(p);
 // Verify detached documents even when this exact queue was already sent.
 for(const ref of refsForEvents(p.events))await ensureContent(h,ref,read);
 const d=await sub(h,'Exchange',true);
 const sameQueue=q=>q.database_id===p.database_id&&q.device_id===p.device_id&&q.base_publication_id===p.base_publication_id&&q.schema_version===p.schema_version&&canonical(q.events)===canonical(p.events);
 for(const item of await listPackages(h)){const q=item.p;if(!q)continue;
  if(q.id===p.id){await checkPackage(q);invariant(q.hash===p.hash,'Повтор ID пакета с иным содержимым');return {duplicate:true,id:q.id}}
  if(sameQueue(q)){try{await checkPackage(q)}catch{continue}return {duplicate:true,id:q.id}}
 }
 await writeNew(d,'change-'+p.id+'.leanpkg',canonical(p));return {duplicate:false,id:p.id}
}
export async function listPackages(h){invariant(await permission(h,false),'Нет доступа к папке');let d;try{d=await sub(h,'Exchange')}catch(e){if(e.name==='NotFoundError')return [];throw e}const result=[];for await(const [name,entry] of d.entries()){if(entry.kind!=='file'||!/^change-[0-9a-f-]+\.leanpkg$/i.test(name))continue;try{const p=JSON.parse(new TextDecoder().decode(await readFile(d,name,MAX_PACKAGE)));invariant(name==='change-'+p.id+'.leanpkg','Имя пакета не совпадает с ID');result.push({name,p})}catch(e){result.push({name,error:e.message})}}return result.sort((a,b)=>(a.p?.created_at||'').localeCompare(b.p?.created_at||''))}
// The manifest is the commit marker. Only an exactly zero-byte marker with
// its already-created snapshot is a candidate for incomplete publication.
// Never delete/overwrite it or infer a committed snapshot from the orphan.
export async function latestSnapshot(h,SQL,databaseId=null,{onIncomplete=()=>{}}={}){
 invariant(await permission(h,false),'Нет доступа к папке');let d;
 try{d=await sub(h,'Database')}catch(e){if(e.name==='NotFoundError'){onIncomplete([]);return null}throw e}
 const manifests=[],incomplete=[];
 for await(const [name,entry] of d.entries()){
  if(entry.kind!=='file'||!/^publication-[0-9a-f-]+\.json$/i.test(name))continue;
  const bytes=await readFile(d,name,65536);
  if(bytes.length===0){
   const id=name.slice('publication-'.length,-'.json'.length);
   invariant(isId(id),'Некорректное имя пустого манифеста: '+name);
   let snapshot;
   try{snapshot=await (await d.getFileHandle('snapshot-'+id+'.sqlite')).getFile()}catch(e){if(e.name==='NotFoundError')throw Error('Пустой манифест без файла снимка: '+name);throw e}
   invariant(snapshot.size>0&&snapshot.size<=MAX_DB,'Пустой манифест с некорректным файлом снимка: '+name);
   incomplete.push(name);continue
  }
  let m;
  try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch(e){throw Error('Повреждён непустой манифест: '+name,{cause:e})}
  invariant(m&&name==='publication-'+m.id+'.json','Имя манифеста не совпадает: '+name);
  await checkSnapshotManifest(m);
  if(!databaseId||m.database_id===databaseId)manifests.push(m)
 }
 incomplete.sort();onIncomplete([...incomplete]);
 if(!manifests.length)return null;
 invariant(new Set(manifests.map(m=>m.database_id)).size===1,'В папке несколько баз. Используйте отдельную папку для каждой.');
 const byId=new Map(manifests.map(m=>[m.id,m])),parents=new Set(manifests.map(m=>m.parent_id));
 // A committed child may never rely on an ignored empty or missing parent.
 for(const m of manifests)invariant(m.parent_id===null||byId.has(m.parent_id),'Разорвана цепочка публикаций: отсутствует подтверждённый предок '+m.parent_id);
 const heads=manifests.filter(m=>!parents.has(m.id));
 invariant(heads.length===1,'Обнаружены параллельные публикации или цикл; требуется разбор');
 const head=heads[0],seen=new Set();let node=head;
 while(node){invariant(!seen.has(node.id),'Цикл публикаций');seen.add(node.id);node=node.parent_id?byId.get(node.parent_id):null}
 invariant(seen.size===byId.size,'Разорвана цепочка публикаций');
 const bytes=await readFile(d,'snapshot-'+head.id+'.sqlite'),db=await readSnapshot(SQL,head,bytes);
 return {manifest:head,db,bytes}
}
export async function publishSnapshot(h,SQL,snapshot,read,options={}){
 invariant(await permission(h,true),'Нет доступа к папке');
 const current=await latestSnapshot(h,SQL,null,options);
 try{invariant(!current?snapshot.manifest.parent_id===null:current.manifest.database_id===snapshot.manifest.database_id&&current.manifest.id===snapshot.manifest.parent_id,'Сетевая база обновилась или это другая база. Сначала загрузите её.')}finally{current?.db.close()}
 const checked=await readSnapshot(SQL,snapshot.manifest,snapshot.bytes);
 try{for(const ref of refsForDb(checked))await ensureContent(h,ref,read)}finally{checked.close()}
 const d=await sub(h,'Database',true);
 await writeNew(d,'snapshot-'+snapshot.manifest.id+'.sqlite',snapshot.bytes);
 try{await writeNew(d,'publication-'+snapshot.manifest.id+'.json',canonical(snapshot.manifest))}
 catch(e){throw Error('Публикация не подтверждена: '+e.message+'. Проверьте состояние сетевой папки; неопубликованные изменения сохранены локально.',{cause:e})}
 const verified=await latestSnapshot(h,SQL,snapshot.manifest.database_id,options);
 try{invariant(verified?.manifest.id===snapshot.manifest.id,'Публикация не подтверждена')}finally{verified?.db.close()}
}
export async function saveBackup(h,obj){invariant(await permission(h,true),'Нет доступа к папке');const d=await sub(h,'Backups',true);await writeNew(d,'backup-'+uuid()+'.leanbackup',canonical(obj))}
