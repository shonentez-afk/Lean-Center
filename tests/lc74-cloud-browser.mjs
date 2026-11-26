import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {openPilot} from '../server/lc74-store.mjs';
import {createPilotServer,parsePilotUsers,pilotAssets} from '../server/lc74-http.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lc74-cloud-'));
const tokens=Object.fromEntries(['a','b','viewer'].map(x=>[x,randomBytes(32).toString('hex')]));
const users=parsePilotUsers(JSON.stringify(Object.fromEntries(Object.entries(tokens).map(([n,token])=>[n,{token,role:n==='viewer'?'viewer':'editor'}]))));
const store=await openPilot({dataDir:dir}),assets=await pilotAssets(path.resolve('dist/LeanCenterCloud')),server=createPilotServer({store,users,assets});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true}),errors=[];
const btn=(p,name)=>p.getByRole('button',{name,exact:true});
const nav=(p,name)=>btn(p,name).first().click();
const state=(p,re)=>p.locator('[data-lc-cloud-state]').first().filter({hasText:re}).waitFor({timeout:40000});
const person=(p,code)=>p.getByRole('cell',{name:code,exact:true}).first();
async function login(p,name){await p.locator('input[name=pilot_token]').fill(tokens[name]);await btn(p,'Войти').click();await p.getByRole('heading',{name:'Дашборд',exact:true}).waitFor({timeout:30000})}
async function profile(name){
 const ctx=await browser.newContext({acceptDownloads:true}),p=await ctx.newPage();
 p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 await ctx.route(/^https?:/,r=>r.request().url().startsWith(url+'/')?r.continue():r.abort());
 await p.goto(url);await login(p,name);return {ctx,p}
}
async function addPerson(p,code){
 await nav(p,'Сотрудники');await btn(p,'Добавить').click();await p.locator('input[name=employee_code]').fill(code);
 await p.locator('input[name=display_name]').fill('Учебный '+code);await btn(p,'Сохранить').click();await person(p,code).waitFor()
}
async function editPerson(p,code,name){
 await nav(p,'Сотрудники');await p.getByRole('row').filter({has:p.getByRole('cell',{name:code,exact:true})}).getByRole('button',{name:'Изменить',exact:true}).click();
 await p.locator('input[name=display_name]').fill(name)
}
const synced=p=>state(p,/Синхронизировано/);
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4jkAAAAASUVORK5CYII=';
const sop={schemaVersion:2,document:{id:'SOP-demo',status:'Draft',number:'DEMO-SOP',version:1},constructor:{schemaVersion:4,meta:{operation:'Учебная проверка'},steps:[{id:1,action:'Проверить',keyMoments:['Безопасность'],reason:'Учебная проверка',durationSeconds:15,hasPhoto:true,imageExt:'png',photoAnnotations:[]}],twi:{enabled:false}},photoAssets:{'1':{original:image,rendered:null,ext:'png',annotations:[]}}};
const raw=JSON.stringify({...sop,integrity:{algorithm:'SHA-256',sha256:createHash('sha256').update(JSON.stringify(sop)).digest('hex')}},null,2);
try{
 assert.equal((await fetch(url+'/api/v1/snapshot')).status,401);
 const a=await profile('a'),b=await profile('b'),v=await profile('viewer');
 await Promise.all([addPerson(a.p,'CLOUD-A'),addPerson(b.p,'CLOUD-B')]);
 await Promise.all([person(a.p,'CLOUD-B').waitFor({timeout:40000}),person(b.p,'CLOUD-A').waitFor({timeout:40000})]);
 await nav(v.p,'Сотрудники');await person(v.p,'CLOUD-A').waitFor({timeout:40000});await person(v.p,'CLOUD-B').waitFor({timeout:40000});
 await a.ctx.setOffline(true);await addPerson(a.p,'CLOUD-OFFLINE');await state(a.p,/не подтверждён/);
 assert.equal(await person(b.p,'CLOUD-OFFLINE').count(),0);
 await a.ctx.setOffline(false);await person(b.p,'CLOUD-OFFLINE').waitFor({timeout:40000});
 await Promise.all([editPerson(a.p,'CLOUD-A','Первый автор'),editPerson(b.p,'CLOUD-A','Второй автор')]);
 await b.ctx.setOffline(true);await btn(b.p,'Сохранить').click();await state(b.p,/не подтверждён/);
 await btn(a.p,'Сохранить').click();await a.p.getByRole('button',{name:'Первый автор',exact:true}).waitFor();await synced(a.p);
 await b.ctx.setOffline(false);await state(b.p,/Конфликт/);
 await nav(b.p,'Настройки и обмен');await b.p.getByRole('heading',{name:'Конфликты локальных изменений',exact:true}).waitFor();
 await btn(b.p,'Оставить опубликованное значение').click();await synced(b.p);
 await nav(a.p,'Каталог СОП');const fc=a.p.waitForEvent('filechooser');await btn(a.p,'Импорт JSON Stage43').click();
 await (await fc).setFiles({name:'DEMO-SOP.json',mimeType:'application/json',buffer:Buffer.from(raw)});
 await a.p.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();await a.p.locator('input[name=library_code]').fill('CLOUD-SOP');
 await btn(a.p,'Сохранить новый черновик').click();await a.p.getByRole('heading',{name:/CLOUD-SOP/}).waitFor();
 await nav(v.p,'Каталог СОП');await v.p.getByRole('row').filter({hasText:'CLOUD-SOP'}).getByRole('button',{name:'Открыть',exact:true}).click({timeout:40000});
 const dl=v.p.waitForEvent('download');await btn(v.p,'Скачать JSON').click();assert.equal(await fs.readFile(await (await dl).path(),'utf8'),raw);
 // Open the actual pinned editor via HTTP, modify the source and export XLSX.
 // The other account must not see an unconfirmed editor draft.
 await synced(a.p);
 await btn(a.p,'Открыть редактор').click();
 const frame=a.p.locator('#lc-editor-frame');await frame.waitFor();
 const editor=await (await frame.elementHandle()).contentFrame();assert(editor);
 await editor.waitForFunction(()=>document.getElementById('lc-editor-status')?.textContent.includes('Рабочая копия готова'),{},{timeout:30000});
 await a.p.getByText('Редактор готов',{exact:true}).waitFor();
 assert.equal(await editor.locator('#meta-operation').inputValue(),'Учебная проверка');
 assert.equal(await editor.evaluate(()=>state.steps[0].hasPhoto&&!!state.steps[0].imageData),true);
 await editor.locator('[data-step-field=action]').first().fill('Проверить после облачного изменения');
 await editor.locator('[data-step-field=action]').first().blur();
 // Export through the real editor; inspect the produced XLSX with its ExcelJS.
 const xlsx=a.p.waitForEvent('download',{timeout:85000});
 await editor.locator('#generateBtn').click();
 const xlsxBytes=await fs.readFile(await (await xlsx).path());
 assert.equal(xlsxBytes.subarray(0,2).toString(),'PK');
 const xlsxResult=await editor.evaluate(async a=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));const sh=w.getWorksheet('СОП');return {names:w.worksheets.map(x=>x.name),images:sh.getImages().length,hasAction:sh.getSheetValues().flat(3).some(x=>typeof x==='string'&&x.includes('Проверить после облачного изменения'))}},Array.from(xlsxBytes));
 assert(xlsxResult.names.includes('СОП'));assert(xlsxResult.images>=1);assert(xlsxResult.hasAction);
 const original=v.p.waitForEvent('download');await btn(v.p,'Скачать JSON').click();assert.equal(await fs.readFile(await (await original).path(),'utf8'),raw);
 await editor.locator('#lc-editor-send').click();
 await a.p.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();
 await btn(a.p,'Сохранить изменения черновика').click();
 await a.p.locator('#lc-editor-host').waitFor({state:'detached'});await synced(a.p);
 // The remote client gets the new revision of the draft, without losing the photograph.
 await v.p.getByText('Проверить после облачного изменения',{exact:true}).waitFor({timeout:40000});
 const updated=v.p.waitForEvent('download');await btn(v.p,'Скачать JSON').click();
 const edited=JSON.parse(await fs.readFile(await (await updated).path(),'utf8'));
 assert.equal(edited.constructor.steps[0].action,'Проверить после облачного изменения');assert(edited.photoAssets['1'].original.startsWith('data:image/'));
 // Viewer can read but not launch or persist edits.
 await nav(v.p,'Сотрудники');await btn(v.p,'Добавить').click();
 assert.equal(await btn(v.p,'Сохранить').isDisabled(),true);
 await v.p.reload();await v.p.locator('input[name=pilot_token]').waitFor();
 assert.equal(await v.p.evaluate(t=>JSON.stringify({...localStorage,...sessionStorage}).includes(t),tokens.viewer),false);
 await login(v.p,'viewer');await nav(v.p,'Сотрудники');await person(v.p,'CLOUD-OFFLINE').waitFor();
 await nav(v.p,'Настройки и обмен');assert.equal(await v.p.getByRole('checkbox',{name:/Режим единственного издателя/}).count(),0);
 assert.deepEqual(errors,[]);
 await fs.mkdir('artifacts/lc74',{recursive:true});await v.p.screenshot({path:'artifacts/lc74/cloud-storage.png',fullPage:true});
 await fs.writeFile('artifacts/lc74/cloud-browser.json',JSON.stringify({profiles:3,concurrentCreates:true,offline:true,conflict:true,exactSource:true,editorRoundTrip:true,realXlsx:true,viewerReadOnly:true,logout:true},null,2));
 console.log('LC7.4.2 real HTTP browser sync and editor PASS')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();await fs.rm(dir,{recursive:true,force:true})}
