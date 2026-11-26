import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {fixture,date} from './lc4-fixture.mjs';
import {preparedBundle} from './lc67-fixtures.mjs';
import {ji2Stages} from '../src/modules/training/ji-v03.js';
import {THEORY_BLOCKS} from '../src/modules/training/preparation-results.js';
import {QUESTION_BANK_V03} from '../src/modules/training/question-bank-v03.js';
import {readZip} from '../src/modules/training/local-docx.js';

const variants=['classic','special','smed','hazardous','fractional'],scenario=process.argv[2]||'all';assert(['all','forms','commission',...variants].includes(scenario),'Unknown LC67 scenario: '+scenario);
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC67 final TWI ')),original=path.join(tmp,'variants.leanbackup'),preparedFile=path.join(tmp,'commission.leanbackup');let ids,prepared;
if(scenario!=='commission'){const f=await fixture({installMethod:false});try{ids={revision:f.doc.id,skill:f.skill,scale:f.scale,shift:f.shift};await fs.writeFile(original,JSON.stringify(await f.backupBundle()))}finally{f.w.close()}}
if(['all','commission'].includes(scenario)){prepared=await preparedBundle();await fs.writeFile(preparedFile,JSON.stringify(prepared.backup))}
await fs.mkdir('artifacts/lc67',{recursive:true});
const browser=await chromium.launch({headless:true});const errors=[];let page,ctx;
const input=(name,value)=>page.locator('[name="'+name+'"]').fill(String(value));
const select=(name,value)=>page.locator('select[name="'+name+'"]').selectOption(String(value));
const button=(label)=>page.locator('main').getByRole('button',{name:label,exact:true});
async function nav(name){const target=page.locator('.sidebar .nav').filter({has:page.getByText(name,{exact:true})});assert.equal(await target.count(),1,'Missing/ambiguous navigation: '+name);if(!await target.isVisible())await target.locator('xpath=ancestor::details[1]/summary').click();await target.click()}
async function choose(label,query){await button('Выбрать: '+label).click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill(query);await page.locator('.lc-picker-popup .lc-person-option').click()}
async function chooseNamed(field,query){await page.locator('button[name="'+field+'"]').click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill(query);const popup=page.locator('.lc-picker-popup'),option=popup.locator('.lc-person-option');await option.waitFor({timeout:5000}).catch(async e=>{throw Error('Не найден сотрудник '+query+' для поля '+field+': '+await popup.innerText(),{cause:e})});assert.equal(await option.count(),1,'Неоднозначный сотрудник '+query+' в поле '+field);await option.click()}
async function saved(label){await button(label).click();try{await page.getByText('Запись сохранена. Ожидает публикации базы.',{exact:true}).waitFor({timeout:15000})}catch(e){console.error('LC67 save failed',label,await page.locator('#status').textContent());throw e}}
async function restore(file){if(ctx)await ctx.close();ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1366,height:900}});page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await nav('Настройки и обмен');const fc=page.waitForEvent('filechooser');await button('Восстановить копию').click();await (await fc).setFiles(file);await page.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor()}
const tab=label=>page.locator('.library-tabs').getByRole('button',{name:label,exact:true});
const summary=label=>page.locator('main summary').and(page.getByText(label,{exact:true}));
async function openDetails(label){const s=summary(label);await s.waitFor();if(!await s.locator('xpath=..').evaluate(d=>d.open))await s.click()}
const config=v=>({followups:2,segments:v==='fractional'?[{from:1,to:1}]:[],realShow:v==='smed'?2:null,realTry:v==='smed'?3:null,hazardous:v==='hazardous'});
try{
 if(scenario==='all'||variants.includes(scenario))for(const variant of variants.filter(v=>scenario==='all'||v===scenario)){
  await restore(original);
  await nav('Инструктажи TWI');await button('Назначить обучение').click();await select('training_revision',ids.revision);await input('assigned_on',date);await input('due_on','2027-01-31');await page.getByText('План TWI: Сформирован · 15/15 полей',{exact:true}).waitFor();
  await page.locator('[name=plan_reviewed]').check();await choose('Обучаемый','LC4-001');await choose('Инструктор','LC4-002');await choose('Ответственный за назначение','LC4-003');await select('training_skill',ids.skill);await select('training_target_scale',ids.scale);await select('training_target_level','2');await select('training_shift',ids.shift);await select('training_variant',variant);await input('ji_followups',2);await input('training_reason','QA JI-2 '+variant);
  if(variant==='smed'){await select('ji_real_show',2);await select('ji_real_try',3)}if(variant==='fractional')await input('ji_segments','1');
  await saved('Сохранить назначение');await choose('Ответственный за СОП (НР)','LC4-003');await choose('Руководитель подразделения','LC4-003');await input('approved_on',date);await saved('Зафиксировать согласование');
  if(variant==='hazardous'){await tab('Практика и допуск').click();await openDetails('Зарегистрировать проверку ОТ');await chooseNamed('verify_safety_actor','LC4-003');await input('verify_safety_date',date);await input('verify_safety_evidence','QA проверка ОТ');await input('verify_safety_feedback','QA подтверждено');await saved('Сохранить проверку ОТ')}
  await tab('Инструктаж').click();
  for(const [i,stage] of ji2Stages(variant,config(variant)).entries()){
   await select('session_stage',stage.code);await input('session_when',(stage.phase==='followup'?(stage.code==='follow1'?'2026-01-21':'2026-01-23'):date)+'T'+String(8+Math.floor(i/6)).padStart(2,'0')+':'+String((i%6)*10).padStart(2,'0'));await input('session_minutes',10);await input('session_notes','QA '+stage.label);
   if(variant==='special'&&stage.phase==='presentation')await choose('Демонстратор / свидетель','LC4-004');
   await page.locator('[name=mentor_ack]').check();await page.locator('[name=trainee_ack]').check();await saved('Записать этап')
  }
  await page.getByText(/контрольные проверки: 2\/2/).waitFor();await fs.mkdir('artifacts/lc67',{recursive:true});await page.screenshot({path:'artifacts/lc67/ji-'+variant+'.png',fullPage:true});console.log('LC6.7 JI browser PASS',variant)
 }
 // Verify the native exports of every appendix through the real offline catalogue.
 if(['all','forms'].includes(scenario)){await restore(original);
 await nav('Бланки и методики');const catalog=page.locator('main').getByRole('table').first();assert.equal(await catalog.getByRole('row').count(),18);
 const expected={1:'План ввода',2:'План адаптации',3:'Программа ОТ',4:'Программа стажировки',5:'СОП',6:'План и реализация',7:'Матрица компетенций',8:'План и реализация',9:'Сводная ведомость',10:'Форма',11:'Фотография рабочего времени',12:'Инструктор',13:'Сводная ведомость',14:'Сводная ведомость',16:'Внутренние тренеры',17:'Структура программы'};
 for(let id=1;id<=17;id++){
  const r=catalog.getByRole('row').nth(id),download=page.waitForEvent('download');await r.getByRole('button',{name:id===15?'Шаблон приказа DOCX':'Шаблон XLSX',exact:true}).click();const out=path.join(tmp,'appendix-'+id+(id===15?'.docx':'.xlsx'));await (await download).saveAs(out);const bytes=new Uint8Array(await fs.readFile(out));
  if(id===15){const entries=await readZip(bytes),xml=new TextDecoder().decode(entries.find(x=>x.name==='word/document.xml').bytes);assert.match(xml,/ПРИКАЗЫВАЮ/);assert.match(xml,/5000/);assert.match(xml,/7000/);assert.match(xml,/ходатайство/);assert.doesNotMatch(xml,/4000 рублей/)}
  else{const result=await page.evaluate(async ({data,id,first})=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(data));const s=w.getWorksheet(first);if(!s)throw Error('Missing worksheet '+first);const values=[];s.eachRow(r=>r.eachCell(c=>{if(typeof c.value==='string')values.push(c.value)}));return {sheetNames:w.worksheets.map(s=>s.name),rowCount:s.rowCount,paperSize:s.pageSetup.paperSize,fitToWidth:s.pageSetup.fitToWidth,fitToHeight:s.pageSetup.fitToHeight,columnCount:s.columnCount,printArea:s.pageSetup.printArea,text:values.join('\n'),formulaCount:s.getRows(1,s.rowCount).reduce((n,r)=>n+r.values.filter(x=>typeof x==='object'&&x?.formula).length,0)}},{data:Array.from(bytes),id,first:expected[id]});assert(result.rowCount>=4);assert.doesNotMatch(result.text,/Иванов Петр Александрович|Иванов Иван Иванович|Петров П\.П\./);if([1,2,3,4,7,9,11,13,14].includes(id))assert(result.formulaCount>0,'No formula for '+id);if([1,5].includes(id)){assert.equal(result.paperSize,8);assert.equal(result.fitToWidth,1);assert.equal(result.fitToHeight,1);assert(result.printArea)}if(id===1){assert.equal(result.columnCount,29);assert.match(result.text,/Смена 24/)}if(id===5)assert.match(result.text,/Причина — почему именно так/);if([2,3,4].includes(id))assert(!result.sheetNames.includes('Результаты и основания'));if(id===12)assert(result.sheetNames.includes('Внутренний тренер'));if(id===10)assert.match(result.text,/Виды насыпного сырья/)}
 }
 console.log('LC6.7 all 17 appendix exports PASS');}
 // The core fixture has canonical training and practical/qualification evidence, but no preparation outcomes.
 // Register every result through the preparation card, then close all three documents.
 if(['all','commission'].includes(scenario)){await restore(preparedFile);await nav('Подготовка сотрудников');await button('Открыть').click();await page.getByRole('heading',{name:'Программа подготовки · Ученик Тестовый',exact:true}).waitFor();
 for(const d of [date,'2026-01-21']){await openDetails('Зарегистрировать / уточнить смену');await input('prep_fact_shift_date',d);await select('prep_fact_shift_id',prepared.shift);await input('prep_fact_shift_minutes',480);await input('prep_fact_shift_note','QA смена');await saved('Сохранить факт смены')}
 await page.getByText(/Завершено смен: 2 \/ минимум 2/).waitFor();
 for(const [kind,label] of [['safety','Зарегистрировать протокол ОТ'],['internship','Зарегистрировать итог стажировки']]){
  const d=page.locator('main details').filter({has:page.locator('[name="prep_'+kind+'_date"]')});assert.equal(await d.count(),1);if(!await d.evaluate(x=>x.open))await d.locator('summary').click();await input('prep_'+kind+'_date','2026-01-21');await input('prep_'+kind+'_reference','QA протокол '+kind);await input('prep_'+kind+'_feedback','QA обратная связь');await saved(label)
 }
 await openDetails('Выдать / обновить перечень вопросов');await select('prep_issue_bank',prepared.bank);await input('prep_issue_date',date);await input('prep_issue_note','QA вопросы выданы заранее');for(const id of THEORY_BLOCKS)await page.locator('select[name=prep_issue_'+id+']').selectOption([QUESTION_BANK_V03.blocks.find(x=>x.id===id).questions[0].id]);await saved('Зарегистрировать выдачу вопросов');
 await openDetails('Зарегистрировать решение комиссии');await input('prep_commission_date','2026-01-21');await chooseNamed('prep_commission_trainer','QA-VT');await chooseNamed('prep_commission_agent','QA-AGENT');await chooseNamed('prep_commission_hr','QA-HR');await input('prep_commission_date','2026-01-21');for(const id of THEORY_BLOCKS){await select('prep_theory_'+id,'pass');await input('prep_theory_note_'+id,'QA проверка '+id)}await select('prep_commission_conclusion','basic');await input('prep_commission_reference','QA комиссия');await input('prep_commission_feedback','QA развитие');await saved('Зарегистрировать решение комиссии');await page.getByText(/Действующее решение: Соответствует базовому уровню ЗУН/).waitFor();
 await page.screenshot({path:'artifacts/lc67/commission.png',fullPage:true});
 for(const i of [1,2,0]){
  await button('Открыть документ').nth(i).click();await openDetails('Итог программы');await choose('Ответственный за итог','LC4-003');await select('enroll_conclusion','basic');await input('enroll_feedback','QA итог');await saved('Завершить программу');await button('Открыть три документа').click()
 }
 await page.getByText(/Комплект завершён/).first().waitFor();await page.screenshot({path:'artifacts/lc67/preparation-completed.png',fullPage:true});console.log('LC6.7 preparation browser PASS: shifts, OT, internship, question issue, commission, three document closures')}
 assert.deepEqual(errors,[])
}catch(e){console.error('LC6.7 browser failure',e,await page?.locator('#status').textContent().catch(()=>''));await fs.mkdir('artifacts/lc67',{recursive:true});await page?.screenshot({path:'artifacts/lc67/failure-'+scenario+'.png',fullPage:true}).catch(()=>{});throw e}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
