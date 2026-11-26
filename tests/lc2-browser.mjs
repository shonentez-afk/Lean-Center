import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC2 импорт '));const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({offline:true,acceptDownloads:true});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>typeof window.ExcelJS?.Workbook),'function');
 await page.getByRole('button',{name:'Импорт данных',exact:true}).click();
 await page.locator('select[name=import_type]').selectOption('person');
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать шаблон XLSX'}).click();const download=await dl;assert.match(download.suggestedFilename(),/\.xlsx$/);await download.saveAs(path.join(tmp,'template.xlsx'));
 const bytes=await page.evaluate(async()=>{const b=new ExcelJS.Workbook(),s=b.addWorksheet('Люди');s.addRow(['Табельный номер','ФИО']);s.addRow(['0007','Учебный импорт']);s.addRow(['0008','Вторая запись']);return Array.from(new Uint8Array(await b.xlsx.writeBuffer()))});
 const xlsx=path.join(tmp,'people.xlsx');await fs.writeFile(xlsx,Uint8Array.from(bytes));await page.locator('input[name=import_file]').setInputFiles(xlsx);
 await page.getByText('Excel открыт. Настройте соответствие колонок.',{exact:true}).waitFor();
 assert.equal(await page.locator('select[name=map_employee_code]').inputValue(),'1');assert.equal(await page.locator('select[name=map_display_name]').inputValue(),'2');
 await page.getByRole('button',{name:'Предварительная проверка'}).click();await page.getByText('Предпросмотр готов. Запись в базу ещё не выполнена.',{exact:true}).waitFor();
 await page.getByText('Создать: 2',{exact:true}).waitFor();await fs.mkdir('artifacts/lc2',{recursive:true});await page.screenshot({path:'artifacts/lc2/import-preview.png',fullPage:true});
 // Selecting a bad workbook must invalidate the previous, still valid preview.
 await page.locator('input[name=import_file]').setInputFiles({name:'broken.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('broken XLSX')});
 await page.locator('#status.error').waitFor();assert.equal(await page.getByRole('button',{name:/Импортировать \d+ изменений/}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Предварительная проверка'}).count(),0);
 await page.getByRole('button',{name:'Сотрудники',exact:true}).click();assert.equal(await page.getByRole('cell',{name:'0007',exact:true}).count(),0);
 await page.getByRole('button',{name:'Импорт данных',exact:true}).first().click();await page.locator('input[name=import_file]').setInputFiles(xlsx);
 await page.getByText('Excel открыт. Настройте соответствие колонок.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Предварительная проверка'}).click();await page.getByText('Создать: 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Импортировать 2 изменений'}).click();await page.getByText('Импортировано изменений: 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Сотрудники',exact:true}).click();await page.getByRole('cell',{name:'0007',exact:true}).waitFor();
 await page.getByRole('cell',{name:'Учебный импорт',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await page.getByRole('button',{name:'Сотрудники',exact:true}).click();await page.getByRole('cell',{name:'0007',exact:true}).waitFor();
 await page.getByRole('button',{name:'Импорт данных',exact:true}).first().click();await page.locator('input[name=import_file]').setInputFiles(xlsx);await page.getByText('Excel открыт. Настройте соответствие колонок.',{exact:true}).waitFor();await page.getByRole('button',{name:'Предварительная проверка'}).click();await page.getByText('Без изменений: 2',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Импортировать 0 изменений'}).isDisabled());
 await page.locator('summary').filter({hasText:'Справочники'}).first().click();await page.getByRole('button',{name:'Шкалы оценивания',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();await page.locator('input[name=name]').fill('Учебная шкала');await page.locator('textarea[name=levels]').fill('0: Не владеет\n1: Владеет');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('cell',{name:'Учебная шкала',exact:true}).waitFor();await page.screenshot({path:'artifacts/lc2/scales.png',fullPage:true});
 await page.getByRole('button',{name:'Импорт данных',exact:true}).first().click();
 // Reproduce the exact reported limit: three existing events + two real XLSX batches.
 for(const [offset,count] of [[0,997],[997,1000]]){const bytes=await page.evaluate(async ({offset,count})=>{const b=new ExcelJS.Workbook(),s=b.addWorksheet('Люди');s.addRow(['Табельный номер','ФИО']);for(let i=0;i<count;i++)s.addRow(['CAP-'+(offset+i),'QA '+(offset+i)]);return Array.from(new Uint8Array(await b.xlsx.writeBuffer()))},{offset,count});const out=path.join(tmp,'mass-'+offset+'.xlsx');await fs.writeFile(out,Uint8Array.from(bytes));await page.locator('input[name=import_file]').setInputFiles(out);await page.getByText('Excel открыт. Настройте соответствие колонок.',{exact:true}).waitFor();await page.getByRole('button',{name:'Предварительная проверка'}).click();await page.getByText('Создать: '+count,{exact:true}).waitFor({timeout:90000});await page.getByRole('button',{name:'Импортировать '+count+' изменений',exact:true}).click({timeout:90000});await page.getByText('Импортировано изменений: '+count,{exact:true}).waitFor({timeout:90000})}
 const overflow=await page.evaluate(async()=>{const b=new ExcelJS.Workbook(),s=b.addWorksheet('Люди');s.addRow(['Табельный номер','ФИО']);s.addRow(['CAP-OVER','QA превышение']);return Array.from(new Uint8Array(await b.xlsx.writeBuffer()))});await page.locator('input[name=import_file]').setInputFiles({name:'overflow.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(overflow)});await page.getByText('Excel открыт. Настройте соответствие колонок.',{exact:true}).waitFor();await page.getByRole('button',{name:'Предварительная проверка'}).click();await page.getByText('Создать: 1',{exact:true}).waitFor();await page.getByText(/Импорт заблокирован: Превышен лимит очереди/).waitFor();assert(await page.getByRole('button',{name:'Импортировать 1 изменений',exact:true}).isDisabled());await page.screenshot({path:'artifacts/lc2/import-full-queue.png',fullPage:true});
 await page.getByRole('button',{name:'Перейти к обмену изменениями',exact:true}).click();
 const pack=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать пакет изменений',exact:true}).click();const packPath=path.join(tmp,'full.leanpkg');await (await pack).saveAs(packPath);const exported=JSON.parse(await fs.readFile(packPath,'utf8'));assert.equal((exported.payload||exported).events.length,2000);assert(!(exported.payload||exported).events.some(e=>e.payload?.employee_code==='CAP-OVER'));
 assert.deepEqual(errors,[]);console.log('LC2 browser PASS: local ExcelJS template, XLSX mapping and preview, atomic import, leading zeros, reload, deduplication, scale');
 await ctx.close();
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
