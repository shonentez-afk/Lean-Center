import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {SQL,schema,migrations} from './lc4-fixture.mjs';
import {createDb,Workspace,uuid,backup} from '../src/core/db.js';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'LC674 resilience ')),entry=pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href,browser=await chromium.launch({headless:true}),errors=[];
const home=async p=>p.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();
const nav=async(p,label)=>{const n=p.locator('.sidebar .nav').filter({has:p.getByText(label,{exact:true})});if(!await n.isVisible())await n.locator('xpath=ancestor::details[1]/summary').click();await n.click()};
const btn=(p,label)=>p.getByRole('button',{name:label,exact:true});
const fields=(p,k)=>p.locator('main form[data-registry-form] [name="'+k+'"]');
async function addPerson(p,code,name){await btn(p,'Добавить').click();await fields(p,'employee_code').fill(code);await fields(p,'display_name').fill(name)}
async function save(p){await btn(p,'Сохранить').click()}
async function restore(p,file){await nav(p,'Настройки и обмен');const fc=p.waitForEvent('filechooser');await btn(p,'Восстановить копию').click();await (await fc).setFiles(file);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor()}
async function start(ctx){const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(entry);await home(p);return p}
async function editor(p){await nav(p,'Конструктор СОП');await btn(p,'Создать СОП').click();const frame=p.locator('#lc-editor-frame');await frame.waitFor();const q=await (await frame.elementHandle()).contentFrame();await q.waitForFunction(()=>document.getElementById('lc-editor-status')?.textContent.includes('Рабочая копия готова'),{},{timeout:30000});await p.getByText('Редактор готов',{exact:true}).waitFor();return q}
try{
 await fs.mkdir('artifacts/lc674',{recursive:true});
 // Startup failure: RAM-only mode, explicit backup, unload warning, actual recovery elsewhere.
 const memory=await browser.newContext({offline:true,acceptDownloads:true});await memory.addInitScript(()=>Object.defineProperty(window,'indexedDB',{configurable:true,get(){throw Error('QA IndexedDB unavailable')}}));
 const p=await start(memory),dialogs=[];p.on('dialog',d=>{dialogs.push(d.type());d.accept()});
 await nav(p,'Сотрудники');await addPerson(p,'RAM-1','QA только память');await save(p);await p.locator('#status').getByText(/Изменения только в памяти. На диск не записаны/).waitFor();await p.getByRole('cell',{name:'RAM-1',exact:true}).waitFor();
 const dl=p.waitForEvent('download');await btn(p,'Скачать резервную копию из памяти').click();const ramFile=path.join(temp,'ram.leanbackup');await (await dl).saveAs(ramFile);await p.screenshot({path:'artifacts/lc674/ram-warning.png',fullPage:true});
 await p.reload();await home(p);assert(dialogs.includes('beforeunload'));await nav(p,'Сотрудники');assert.equal(await p.getByRole('cell',{name:'RAM-1',exact:true}).count(),0);await memory.close();
 const ctx=await browser.newContext({offline:true,acceptDownloads:true});const q=await start(ctx);let accept=true,seen=[];q.on('dialog',d=>{seen.push(d.type());accept?d.accept():d.dismiss()});await restore(q,ramFile);await nav(q,'Сотрудники');await q.getByRole('cell',{name:'RAM-1',exact:true}).waitFor();
 // Menu, app back, browser back, cancel and F5 protect changed fields only.
 await addPerson(q,'UNSAVED','QA unsaved');accept=false;await nav(q,'Дашборд');assert.equal(await fields(q,'employee_code').inputValue(),'UNSAVED');assert(seen.includes('confirm'));
 await btn(q,'← Назад').click();await q.waitForFunction(()=>document.querySelector('main form[data-registry-form] [name=employee_code]')?.value==='UNSAVED');
 await q.goBack().catch(()=>{});await q.waitForFunction(()=>document.querySelector('main form[data-registry-form] [name=employee_code]')?.value==='UNSAVED');
 await btn(q,'Отмена').click();assert.equal(await fields(q,'employee_code').inputValue(),'UNSAVED');
 accept=true;await q.reload();await home(q);assert(seen.includes('beforeunload'));await nav(q,'Сотрудники');assert.equal(await q.getByRole('cell',{name:'UNSAVED',exact:true}).count(),0);
 // Rejected transaction: no row, retained input, meaningful message and old record intact.
 await addPerson(q,'QA-REJECTED','QA failed write');await q.evaluate(()=>{window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='workspace')throw new DOMException('QA write failure','QuotaExceededError');return window.__put.call(this,value,key)}});
 await save(q);await q.getByText(/Локальная запись не выполнена. Изменения не записаны/).waitFor();assert.equal(await fields(q,'employee_code').inputValue(),'QA-REJECTED');assert.equal(await q.getByRole('cell',{name:'QA-REJECTED',exact:true}).count(),0);await q.evaluate(()=>IDBObjectStore.prototype.put=window.__put);await btn(q,'Отмена').click();
 await addPerson(q,'OK-1','QA saved');await save(q);await q.getByRole('cell',{name:'OK-1',exact:true}).waitFor();const n=seen.length;await nav(q,'Дашборд');assert.equal(seen.length,n);
 // A genuinely populated synthetic database: full-search across pages, two same names,
 // equivalent е/ё, and code lookup after reload.
 const db=createDb(SQL,schema,migrations[0]);db.run('BEGIN');try{for(let i=0;i<5000;i++)db.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[uuid(),'P-'+String(i).padStart(5,'0'),i>=4998?'Ёлкин QA':'Сотрудник '+String(i).padStart(5,'0')]);db.run('COMMIT')}catch(e){db.run('ROLLBACK');throw e}
 const w=new Workspace(SQL,db),scaleFile=path.join(temp,'scale.leanbackup');await fs.writeFile(scaleFile,JSON.stringify(await backup(w)));w.close();await restore(q,scaleFile);await nav(q,'Сотрудники');await q.getByText(/Показано 1–100 из 5000/).waitFor();assert.equal(await q.locator('main tbody tr').count(),100);
 await btn(q,'Следующая страница').click();await q.getByText(/Показано 101–200 из 5000/).waitFor();const search=q.getByPlaceholder('Поиск по справочнику');await search.fill('елкин');await q.getByText(/Показано 1–2 из 2/).waitFor();assert.equal(await q.locator('main tbody tr').count(),2);await search.fill('P-04999');await q.getByRole('cell',{name:'P-04999',exact:true}).waitFor();assert.equal(await q.locator('main tbody tr').count(),1);await q.screenshot({path:'artifacts/lc674/registry-search.png',fullPage:true});await q.reload();await home(q);await nav(q,'Сотрудники');await q.getByText(/из 5000/).waitFor();await ctx.close();
 // Two editors for one new SOP recovery key: stale tab must not overwrite first.
 const editors=await browser.newContext({offline:true,acceptDownloads:true});const a=await start(editors),b=await start(editors);for(const x of [a,b])x.on('dialog',d=>d.accept());const ea=await editor(a),eb=await editor(b);
 await ea.locator('#meta-operation').fill('QA FIRST SOP');await ea.waitForFunction(()=>document.getElementById('lc-sop-recovery-status')?.textContent.includes('Черновик СОП сохранён'));
 await eb.locator('#meta-operation').fill('QA SECOND SOP');await eb.waitForFunction(()=>document.getElementById('lc-sop-recovery-status')?.textContent.includes('Другой редактор изменил локальный черновик'));assert.equal(await eb.locator('#meta-operation').inputValue(),'QA SECOND SOP');
 const rescue=b.waitForEvent('download');await eb.locator('#lc-editor-download').click();const rescuePath=path.join(temp,'second.json');await (await rescue).saveAs(rescuePath);assert.equal(JSON.parse(await fs.readFile(rescuePath,'utf8')).constructor.meta.operation,'QA SECOND SOP');await b.screenshot({path:'artifacts/lc674/sop-conflict.png',fullPage:true});
 await a.reload();await home(a);const restored=await editor(a);assert.equal(await restored.locator('#meta-operation').inputValue(),'QA FIRST SOP');await restored.locator('#lc-sop-discard-recovery').click();await restored.waitForFunction(()=>document.getElementById('lc-sop-recovery-status')?.textContent.includes('Локальная копия удалена'));await editors.close();
 assert.deepEqual(errors,[]);console.log('LC6.7.4 resilience PASS: RAM backup, failed transaction, unsaved forms, 5000 rows, SOP recovery conflict');
}finally{await browser.close();await fs.rm(temp,{recursive:true,force:true})}
