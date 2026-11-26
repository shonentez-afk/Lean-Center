// Real built file:// UI with a deliberately simulated File System Access directory.
// Separate browser profiles share only this synthetic directory via a test binding.
// The test cannot prove real SMB/ACL or Windows network-failure semantics.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const browser=await chromium.launch({headless:true});
const entry=pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href;
const dirs=new Set(['']),files=new Map(),errors=[],requests=[];
let failNextManifest=false,failedPath=null;
const notFound=()=>({error:'NotFoundError',message:'QA simulated file not found'});
function call(op,key,create=false,payload=null){
 if(op==='dir'){if(!dirs.has(key)){if(!create)return notFound();dirs.add(key)}return {ok:true}}
 if(op==='file'){if(!files.has(key)){if(!create)return notFound();files.set(key,Buffer.alloc(0))}return {ok:true}}
 if(op==='read'){if(!files.has(key))return notFound();return {data:files.get(key).toString('base64')}}
 if(op==='write'){
  if(!files.has(key))return notFound();
  if(failNextManifest&&/^Database\/publication-[0-9a-f-]+\.json$/.test(key)){
   failNextManifest=false;failedPath=key;return {error:'UnknownError',message:'QA simulated close failure'}
  }
  files.set(key,Buffer.from(payload,'base64'));return {ok:true}
 }
 if(op==='entries'){
  const prefix=key?key+'/':'',items=[];
  for(const [kind,keys] of [['directory',dirs.keys()],['file',files.keys()]])for(const p of keys)if(p.startsWith(prefix)&&p!==key&&!p.slice(prefix.length).includes('/'))items.push([p.slice(prefix.length),kind]);
  return {items}
 }
 if(op==='remove'){if(!files.delete(key))return notFound();return {ok:true}}
 throw Error('Unexpected test operation '+op)
}
async function profile(){
 const ctx=await browser.newContext({offline:true,acceptDownloads:true});
 await ctx.exposeBinding('lcQaDirectory',(_source,...args)=>call(...args));
 await ctx.addInitScript(()=>{
  const join=(a,b)=>a?a+'/'+b:b;
  const rpc=async(...args)=>{const r=await window.lcQaDirectory(...args);if(r.error)throw new DOMException(r.message,r.error);return r};
  const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)};
  class QaFile{
   constructor(key){this.key=key;this.kind='file';this.name=key.split('/').at(-1)}
   async getFile(){const {data}=await rpc('read',this.key);return new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))])}
   async createWritable(){let bytes;return {write:async d=>{bytes=typeof d==='string'?new TextEncoder().encode(d):new Uint8Array(d)},close:async()=>{await rpc('write',this.key,false,base64(bytes))},abort:async()=>{}}}
  }
  class QaDirectory{
   constructor(key){this.__lcQaDirectoryKey=key;this.kind='directory';this.name=key.split('/').at(-1)||'QA simulated network'}
   async queryPermission(){return 'granted'}
   async requestPermission(){return 'granted'}
   async getDirectoryHandle(name,{create=false}={}){const k=join(this.__lcQaDirectoryKey,name);await rpc('dir',k,create);return new QaDirectory(k)}
   async getFileHandle(name,{create=false}={}){const k=join(this.__lcQaDirectoryKey,name);await rpc('file',k,create);return new QaFile(k)}
   async removeEntry(name){await rpc('remove',join(this.__lcQaDirectoryKey,name))}
   async *entries(){const {items}=await rpc('entries',this.__lcQaDirectoryKey);for(const [name,kind] of items){const k=join(this.__lcQaDirectoryKey,name);yield [name,kind==='file'?new QaFile(k):new QaDirectory(k)]}}
  }
  window.showDirectoryPicker=async()=>new QaDirectory('');
  // IndexedDB structured cloning stores the mock's own fields. Rehydrate only
  // this test sentinel; normal workspace/content transactions remain real.
  const desc=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'result');
  Object.defineProperty(IDBRequest.prototype,'result',{...desc,get(){const v=desc.get.call(this);return v?.kind==='directory'&&typeof v.__lcQaDirectoryKey==='string'?new QaDirectory(v.__lcQaDirectoryKey):v}});
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',q=>{if(/^https?:/i.test(q.url()))requests.push(q.url())});p.on('dialog',d=>d.accept());
 await p.goto(entry);await p.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();
 return {ctx,p}
}
const nav=(p,name)=>p.getByRole('button',{name,exact:true}).first().click();
const btn=(p,name)=>p.getByRole('button',{name,exact:true});
const status=(p,re)=>p.locator('#status').filter({hasText:re}).waitFor();
const storage=p=>nav(p,'Настройки и обмен');
const selectFolder=async p=>{await storage(p);await btn(p,'Выбрать сетевую папку').click();await status(p,/Выбрана папка: QA simulated network/)};
const warning=p=>p.locator('#lc-network-publication-warning');
const refresh=async(p,warn)=>{await storage(p);await btn(p,'Обновить из папки').click();await status(p,/Загружена опубликованная база/);if(warn){await warning(p).waitFor();assert.match(await warning(p).innerText(),/пустые манифесты.*: 1\./)}else assert.equal(await warning(p).count(),0)};
const addPerson=async(p,code)=>{await nav(p,'Сотрудники');await btn(p,'Добавить').click();await p.locator('input[name=employee_code]').fill(code);await p.locator('input[name=display_name]').fill('Сотрудник '+code);await btn(p,'Сохранить').click();await p.getByRole('cell',{name:code,exact:true}).waitFor()};
const checkPeople=async(p,hasB)=>{await nav(p,'Сотрудники');await p.getByRole('cell',{name:'QA-NET-A',exact:true}).first().waitFor();if(hasB)await p.getByRole('cell',{name:'QA-NET-B',exact:true}).first().waitFor();else assert.equal(await p.getByRole('cell',{name:'QA-NET-B',exact:true}).count(),0)};
const markers=()=>[...files].filter(([k])=>/^Database\/publication-[0-9a-f-]+\.json$/.test(k));
const committed=()=>markers().filter(([,b])=>b.length).map(([k,b])=>({key:k,...JSON.parse(b.toString('utf8'))}));
const source={schemaVersion:2,document:{id:'SOP-qa-net',status:'Опубликован',number:'15.1.2026 1',version:1},constructor:{schemaVersion:4,meta:{operation:'QA сетевой СОП'},steps:[{id:1,action:'Проверить',keyMoments:['Безопасность','Качество','Производительность','Затраты','Специальная методика'],reason:'Проверка',durationSeconds:15,hasPhoto:true,imageExt:'png',photoAnnotations:[]}],twi:{enabled:false}},photoAssets:{'1':{original:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4jkAAAAASUVORK5CYII=',rendered:null,ext:'png',annotations:[]}}};
const raw=JSON.stringify({...source,integrity:{algorithm:'SHA-256',sha256:createHash('sha256').update(JSON.stringify(source)).digest('hex')}},null,2);
const checkSource=async p=>{await nav(p,'Каталог СОП');await p.getByRole('row').filter({hasText:'QA-NET-SOP'}).getByRole('button',{name:'Открыть',exact:true}).click();await p.getByRole('heading',{name:/QA-NET-SOP/}).waitFor();const download=p.waitForEvent('download');await btn(p,'Скачать JSON').click();assert.equal(await fs.readFile(await (await download).path(),'utf8'),raw)};
try{
 const master=await profile(),m=master.p;await selectFolder(m);await addPerson(m,'QA-NET-A');
 // Include real detached SOP content in publication A.
 await nav(m,'Каталог СОП');const chooser=m.waitForEvent('filechooser');await btn(m,'Импорт JSON Stage43').click();await (await chooser).setFiles({name:'QA-NET-SOP.json',mimeType:'application/json',buffer:Buffer.from(raw)});await m.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();await m.locator('input[name=library_code]').fill('QA-NET-SOP');await btn(m,'Сохранить новый черновик').click();await m.getByRole('heading',{name:/QA-NET-SOP/}).waitFor();
 await storage(m);await m.getByRole('checkbox',{name:/Режим единственного издателя/}).check();await btn(m,'Принять свои изменения').click();await status(m,/Принято событий:/);await btn(m,'Опубликовать базу').click();await status(m,/База опубликована и проверена по SHA-256/);
 assert.equal(committed().length,1);const a=committed()[0];assert.equal(a.parent_id,null);assert([...files].some(([k,v])=>k.startsWith('Documents/')&&v.toString('utf8')===raw));
 const operator=await profile(),o=operator.p;await selectFolder(o);await refresh(o,false);await checkPeople(o,false);await checkSource(o);
 // Failure after the manifest file was created and its snapshot written.
 await addPerson(m,'QA-NET-B');await storage(m);await btn(m,'Принять свои изменения').click();await status(m,/Принято событий:/);failNextManifest=true;await btn(m,'Опубликовать базу').click();await status(m,/Публикация не подтверждена: QA simulated close failure/);
 assert(failedPath);assert.equal(files.get(failedPath).length,0);assert.equal(committed().length,1);const orphan=failedPath.replace('publication-','snapshot-').replace(/\.json$/,'.sqlite'),orphanBytes=Buffer.from(files.get(orphan));assert(orphanBytes.length>0);
 await refresh(o,true);await checkPeople(o,false);await checkSource(o);
 await o.reload();await o.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await status(o,/База обновлена из сетевой папки.*пустые манифесты/);await storage(o);await warning(o).waitFor();await checkPeople(o,false);
 // New profile cannot rely on a cached A or its source.
 const fresh=await profile(),f=fresh.p;await selectFolder(f);await refresh(f,true);await checkPeople(f,false);await checkSource(f);
 // No file was deleted or manually repaired before retry.
 await btn(m,'Опубликовать базу').click();await status(m,/База опубликована и проверена по SHA-256.*пустые манифесты/);await warning(m).waitFor();
 assert.equal(committed().length,2);const c=committed().find(x=>x.parent_id===a.id);assert(c);assert.equal(files.get(failedPath).length,0);assert.deepEqual(files.get(orphan),orphanBytes);
 for(const p of [o,f]){await refresh(p,true);await checkPeople(p,true);await checkSource(p)}
 // A nonempty damaged marker is still an error and the local C is retained.
 files.set(failedPath,Buffer.from('{'));await storage(o);await btn(o,'Обновить из папки').click();await status(o,/Повреждён непустой манифест/);await checkPeople(o,true);files.set(failedPath,Buffer.alloc(0));
 await refresh(o,true);await checkPeople(o,true);
 await fs.mkdir('artifacts/lc73b-runtime',{recursive:true});await storage(o);await o.screenshot({path:'artifacts/lc73b-runtime/network-recovery-warning.png',fullPage:true});
 await fs.writeFile('artifacts/lc73b-runtime/network-recovery.json',JSON.stringify({case:'LC73B-NET-01',simulation:'File System Access close failure (not real SMB)',oldProfile:true,cleanProfile:true,reload:true,detachedSource:true,retryWithoutDeletion:true,nonemptyCorruptionRejected:true},null,2)+'\n');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log('LC73B-NET-01 browser PASS: previous and clean profiles, reload warning, SOP source, C retry and corrupt manifest rejection');
}finally{await browser.close()}
