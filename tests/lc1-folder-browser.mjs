import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'Lean Center тест '));
const dest=path.join(temp,'Сетевой диск','Lean Center');
const entry=path.join(dest,'index.html');
await fs.cp('dist/LeanCenter',dest,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[], requests=[];
async function newPage(){
 const context=await browser.newContext({acceptDownloads:true,offline:true});
 const page=await context.newPage();
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack)});
 page.on('request',req=>requests.push(req.url()));
 return {page,context};
}
async function home(page){
 await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>typeof window.echarts?.init),'function');
 assert.equal(await page.evaluate(()=>typeof window.initSqlJs),'function');
 await page.locator('.chart canvas').first().waitFor();
}
async function chartColor(page,expected){
 const actual=await page.evaluate(()=>window.echarts.getInstanceByDom(document.querySelector('.chart')).getOption().series[0].itemStyle.color);
 assert.equal(actual,expected);
}
async function storage(page){await page.getByRole('button',{name:'Настройки и обмен',exact:true}).click()}
async function person(page){await page.getByRole('button',{name:'Сотрудники',exact:true}).first().click();await page.getByRole('cell',{name:'QA Employee'}).waitFor()}
try{
 const {page,context}=await newPage();
 await page.goto(pathToFileURL(entry).href);
 await home(page);
 assert.equal(await page.evaluate(()=>window.LC_BUILD.version),'lc7.1.1-standard-dev');
 assert.equal(await page.evaluate(()=>document.querySelectorAll('script[src]').length),7);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('script:not([src])').length),0);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--tn-red').trim()),'#E30613');
 assert.match(await page.evaluate(()=>getComputedStyle(document.documentElement).fontFamily),/Proxima Nova Rg/);
 await chartColor(page,'#242E40');
 await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('dark')),true);await chartColor(page,'#A9BCD4');
 await page.getByRole('button',{name:'Светлая тема',exact:true}).click();await chartColor(page,'#242E40');
 await storage(page);
 await page.getByRole('button',{name:'Заполнить демо-данными'}).click();
 await page.getByText('Добавлены демонстрационные записи',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Сотрудники',exact:true}).first().click();
 await page.getByRole('cell',{name:'Учебный сотрудник 01'}).waitFor();
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await page.locator('input[name=employee_code]').fill('QA-001');
 await page.locator('input[name=display_name]').fill('QA Employee');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('cell',{name:'QA Employee'}).waitFor();
 await page.reload();await home(page);
 await fs.mkdir('artifacts/lc1-tn',{recursive:true});
 await page.screenshot({path:'artifacts/lc1-tn/dashboard.png',fullPage:true});
 await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();await page.screenshot({path:'artifacts/lc1-tn/dashboard-dark.png',fullPage:true});
 await page.getByRole('button',{name:'Светлая тема',exact:true}).click();
 await page.setViewportSize({width:390,height:844});try{await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+2,{},{timeout:4000})}catch(e){console.error(await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(n=>[n.tagName,n.className?.baseVal||n.className,Math.round(n.getBoundingClientRect().right)])})));throw e}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);await page.screenshot({path:'artifacts/lc1-tn/dashboard-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:720});
 await person(page);await page.screenshot({path:'artifacts/lc1-tn/registry.png',fullPage:true});
 // Two tabs share IndexedDB. Reject stale write, preserve draft, then merge only
 // edited fields into the fresh form; explicit Save is still required.
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(pathToFileURL(entry).href);await home(other);await person(other);
 const editQA=async p=>p.getByRole('row').filter({hasText:'QA Employee'}).getByRole('button',{name:'Изменить',exact:true}).click();
 await editQA(other);await other.locator('input[name=display_name]').fill('QA Employee draft');
 await editQA(page);await page.locator('input[name=employee_code]').fill('QA-001-A');await page.locator('input[name=display_name]').fill('QA Employee newer');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('cell',{name:'QA Employee newer',exact:true}).waitFor();
 await other.getByRole('button',{name:'Сохранить',exact:true}).click();await other.getByText(/Черновик сохранён в форме/).waitFor();assert.equal(await other.locator('input[name=display_name]').inputValue(),'QA Employee draft');
 const draftDownload=other.waitForEvent('download');await other.getByRole('button',{name:'Скачать черновик',exact:true}).click();const draftFile=path.join(temp,'conflict.json');await (await draftDownload).saveAs(draftFile);assert.equal(JSON.parse(await fs.readFile(draftFile,'utf8')).payload.display_name,'QA Employee draft');
 await other.getByRole('button',{name:'Загрузить актуальную копию и сверить',exact:true}).click();await other.getByText(/Сверьте конфликтующие поля/).waitFor();assert.equal(await other.locator('input[name=employee_code]').inputValue(),'QA-001-A');assert.equal(await other.locator('input[name=display_name]').inputValue(),'QA Employee draft');await other.getByRole('cell',{name:'QA Employee newer',exact:true}).waitFor();
 await other.locator('input[name=display_name]').fill('QA Employee');await other.getByRole('button',{name:'Сохранить',exact:true}).click();await person(other);await other.close();await page.reload();await home(page);await person(page);await page.getByRole('cell',{name:'QA-001-A',exact:true}).waitFor();
 // Simulate installing a new version next to the old one, switching only the
 // stable index.html, and keeping the local working state.
 const next=path.join(dest,'versions','lc7.1.1-standard-dev-test-update');
 await fs.cp(path.join(dest,'versions','lc7.1.1-standard-dev'),next,{recursive:true});
 const html=await fs.readFile(entry,'utf8');
 await fs.writeFile(entry,html.replaceAll('versions/lc7.1.1-standard-dev/','versions/lc7.1.1-standard-dev-test-update/'));
 await page.reload();await home(page);await person(page);
 await storage(page);
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Скачать резервную копию',exact:true}).click();
 const file=await download;assert.match(file.suggestedFilename(),/\.leanbackup$/);
 const backupPath=path.join(temp,'QA.leanbackup');await file.saveAs(backupPath);
 await context.close();
 // New browser profile: restore from a user-owned backup, not from an old origin.
 const second=await newPage();
 await second.page.goto(pathToFileURL(entry).href);await home(second.page);
 await storage(second.page);
 const chooser=second.page.waitForEvent('filechooser');
 await second.page.getByRole('button',{name:'Восстановить копию',exact:true}).click();
 await (await chooser).setFiles(backupPath);
 await second.page.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await person(second.page);
 await second.context.close();
 assert.deepEqual(errors,[]);
 assert.equal(requests.some(u=>/^https?:/i.test(u)),false,'External HTTP dependency');
 for(const p of ['app/config.js','vendor/sql-wasm-data.js','vendor/sql-wasm.js','vendor/echarts.min.js','vendor/exceljs.min.js','app/main.js','editor/Stage43-data.js','assets/styles.css'])
  assert(requests.some(u=>u.endsWith('/'+p)),'Missing local request '+p);
 assert.equal(requests.some(u=>u.endsWith('.wasm')),false,'WASM must not be fetched under file://');
 console.log('LC7.1.1-standard-dev folder offline file:// smoke PASS: Cyrillic paths, external scripts, CRUD, reload, stable entry update, backup/restore, no HTTP');
}finally{await browser.close();await fs.rm(temp,{recursive:true,force:true})}
