import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {fixture,date} from './lc4-fixture.mjs';
import {one} from '../src/core/db.js';
import {draftDocx,readZip} from '../src/modules/training/local-docx.js';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC4 учебная база ')),f=await fixture();
const pos=f.w.edit('position',null,{code:'QA-POS',name:'Учебная должность'}),pa=one(f.w.working,'SELECT * FROM person_assignment WHERE person_id=?',[f.mentor]);
const oldAssignment={person_id:pa.person_id,unit_id:pa.unit_id,profession_id:pa.profession_id,position_id:pa.position_id,shift_id:pa.shift_id,shift_code:pa.shift_code,valid_from:pa.valid_from,valid_to:pa.valid_to};
f.w.edit('person_assignment',pa.id,{...oldAssignment,valid_to:'2026-01-19'});f.w.edit('person_assignment',null,{...oldAssignment,position_id:pos,valid_from:date,valid_to:null});
const sample=Array(56).fill('');sample[1]='ОБРАЗЕЦ';sample[8]='ПРИКАЗ';sample[38]='Директор';for(const i of [20,21,22,27,28,29])sample[i]='ФИО, должность';const orderFile=path.join(tmp,'qa-order.docx');await fs.writeFile(orderFile,draftDocx(sample));
const file=path.join(tmp,'training.leanbackup');await fs.writeFile(file,JSON.stringify(await f.backupBundle()));
const ids={trainee:f.trainee,mentor:f.mentor,actor:f.actor,revision:f.doc.id,skill:f.skill,scale:f.scale,shift:f.shift};f.w.close();
const browser=await chromium.launch({headless:true,...(process.env.RUNNER_OS==='Windows'?{channel:'msedge'}:{})});
try{
 const ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1366,height:850}}),page=await ctx.newPage(),errors=[],http=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(/^https?:/.test(r.url()))http.push(r.url())});
 const nav=async name=>{const target=page.locator('.sidebar .nav').filter({has:page.getByText(name,{exact:true})});if(!(await target.isVisible())){const group=target.locator('xpath=ancestor::details[1]');await group.locator('summary').click()}await target.click()};
 async function choose(label,query){await page.getByRole('button',{name:'Выбрать: '+label,exact:true}).click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill(query);await page.locator('.lc-picker-popup .lc-person-option').click()}
 const saved=async label=>{await page.getByRole('button',{name:label,exact:true}).click();await page.getByText('Запись сохранена. Ожидает публикации базы.',{exact:true}).waitFor();assert.equal(await page.locator('#status').getAttribute('class'),'status')};
 await page.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();
 await nav('Настройки и обмен');const restore=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Восстановить копию',exact:true}).click();await (await restore).setFiles(file);await page.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await nav('Инструктажи TWI');await page.getByRole('button',{name:'Назначить обучение',exact:true}).click();
 await page.locator('select[name=training_revision]').selectOption(ids.revision);await page.locator('input[name=assigned_on]').fill(date);await page.locator('input[name=due_on]').fill('2027-01-31');await page.getByText('План TWI: Сформирован · 15/15 полей',{exact:true}).waitFor();
 await page.locator('input[name=plan_reviewed]').check();await choose('Обучаемый','LC4-001');await choose('Инструктор','LC4-002');await choose('Ответственный за назначение','LC4-003');
 await page.locator('select[name=training_skill]').selectOption(ids.skill);await page.locator('select[name=training_target_scale]').selectOption(ids.scale);await page.locator('select[name=training_target_level]').selectOption('2');await page.locator('select[name=training_shift]').selectOption(ids.shift);await page.locator('textarea[name=training_reason]').fill('Учебное назначение');
 await saved('Сохранить назначение');await choose('Ответственный за СОП (НР)','LC4-003');await choose('Руководитель подразделения','LC4-003');await page.locator('input[name=approved_on]').fill(date);await saved('Зафиксировать согласование');
 await page.locator('.library-tabs').getByRole('button',{name:'Инструктаж',exact:true}).click();await page.getByRole('button',{name:'Показать план TWI и шаги СОП'}).click();await page.getByText('Учебный КМ',{exact:true}).waitFor();
 // The form defaults to 15 minutes, not the 10-minute core fixture.
 // Enter distinct durations explicitly and independently verify every saved fact.
 const stages=['prepare','show1','show2','show3','try1','try2','try3','try4'];
 const stageMinutes=[15,5,10,20,7,8,12,13],totalMinutes=stageMinutes.reduce((a,b)=>a+b,0);
 assert.equal(totalMinutes,90);
 let elapsed=0;
 for(const [i,code] of stages.entries()){
  await page.locator('select[name=session_stage]').selectOption(code);
  const minutes=page.locator('input[name=session_minutes]');
  if(i===0)assert.equal(await minutes.inputValue(),'15');
  await minutes.fill(String(stageMinutes[i]));
  const hh=String(8+Math.floor(elapsed/60)).padStart(2,'0'),mm=String(elapsed%60).padStart(2,'0');
  await page.locator('input[name=session_when]').fill(date+'T'+hh+':'+mm);elapsed+=stageMinutes[i];
  await page.locator('textarea[name=session_notes]').fill('Учебное наблюдение '+code);await page.locator('input[name=mentor_ack]').check();await page.locator('input[name=trainee_ack]').check();await saved('Записать этап')
 }
 await fs.mkdir('artifacts/lc4',{recursive:true});await page.screenshot({path:'artifacts/lc4/instruction.png',fullPage:true});
 await page.locator('.library-tabs').getByRole('button',{name:'Практика и допуск',exact:true}).click();
 for(const [kind,label] of [['safety','ОТ'],['theory','теории']]){
  const summary=page.locator('summary').filter({hasText:'Зарегистрировать проверку '+label});await summary.click();
  await page.locator('button[name=verify_'+kind+'_actor]').click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill('LC4-003');await page.locator('.lc-picker-popup .lc-person-option').click();await page.locator('input[name=verify_'+kind+'_date]').fill(date);await page.locator('textarea[name=verify_'+kind+'_evidence]').fill('Учебное основание');await page.locator('textarea[name=verify_'+kind+'_feedback]').fill('Учебная обратная связь');await saved('Сохранить проверку '+label)
 }
 await page.getByText('Новая практическая оценка',{exact:true}).click();await page.locator('button[name=practical_actor]').click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill('LC4-003');await page.locator('.lc-picker-popup .lc-person-option').click();await page.locator('input[name=practical_date]').fill(date);
 for(let i=1;i<=11;i++)await page.locator('select[name=practical_value_'+i+']').selectOption(i===11?'0':'1');
 await page.locator('select[name=practical_conclusion]').selectOption('basic');await page.locator('textarea[name=practical_feedback]').fill('Учебная обратная связь');await saved('Зафиксировать практическую оценку');
 await page.getByText('Подтвердить компетенцию',{exact:true}).click();await choose('Подтверждающий уровень','LC4-003');await page.locator('input[name=qualification_date]').fill(date);await page.locator('select[name=qualification_level]').selectOption('2');await page.locator('textarea[name=qualification_evidence]').fill('Учебное наблюдение');await page.locator('textarea[name=qualification_feedback]').fill('Учебная обратная связь');await saved('Сохранить подтверждение уровня');
 await page.getByText('Зарегистрировать решение о допуске',{exact:true}).click();await choose('Ответственный за решение о допуске','LC4-003');await page.locator('input[name=admission_date]').fill(date);await page.locator('select[name=admission_decision]').selectOption('granted');await page.locator('textarea[name=admission_evidence]').fill('Учебное основание');await page.locator('textarea[name=admission_feedback]').fill('Учебная обратная связь');await saved('Сохранить решение о допуске');await page.getByRole('cell',{name:'Допуск зарегистрирован',exact:true}).waitFor();await page.screenshot({path:'artifacts/lc4/admission.png',fullPage:true});
 await nav('Матрица компетенций');await page.getByRole('button',{name:/2 · Допуск зарегистрирован/}).waitFor();await page.screenshot({path:'artifacts/lc4/matrix.png',fullPage:true});await page.getByRole('button',{name:/2 · Допуск зарегистрирован/}).click();await page.getByRole('heading',{name:'Ученик Тестовый · Учебный навык',exact:true}).waitFor();
 await nav('Журнал заданий');await page.getByRole('cell',{name:'Подготовка',exact:true}).waitFor();
 const planDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать план / факт XLSX',exact:true}).click();const planFile=path.join(tmp,'plan.xlsx');await (await planDownload).saveAs(planFile);
 const planBytes=new Uint8Array(await fs.readFile(planFile));
 const exportedPlan=await page.evaluate(async a=>{
  const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));
  const s=w.getWorksheet('План и реализация'),d=w.getWorksheet('Назначения и факты'),cell=s.getCell('H7'),value=cell.value;
  return {title:s.getCell('A1').value,date:s.getCell('F7').value,start:s.getCell('G7').value,duration:value instanceof Date?(value.getTime()-Date.UTC(1899,11,30))/86400000:value,durationType:value instanceof Date?'Date':typeof value,format:cell.numFmt,signature:s.getCell('I7').value,traineeSignature:s.getCell('J7').value,detail:d.rowCount,minutes:Array.from({length:d.rowCount-1},(_,i)=>d.getCell(i+2,9).value),notes:Array.from({length:d.rowCount-1},(_,i)=>d.getCell(i+2,10).value)}
 },Array.from(planBytes));
 console.log('LC4.1 duration QA',JSON.stringify(exportedPlan));
 assert.equal(exportedPlan.date,date);assert.equal(exportedPlan.start,'08:00');assert.equal(exportedPlan.format,'[h]:mm');
 assert.equal(exportedPlan.detail,9);assert.deepEqual(exportedPlan.minutes,stageMinutes);
 assert.deepEqual(exportedPlan.notes,stages.map(code=>'Учебное наблюдение '+code));
 assert.equal(exportedPlan.minutes.reduce((a,b)=>a+b,0),totalMinutes);
 assert(Math.abs(exportedPlan.duration-totalMinutes/1440)<1e-8,'Duration roundtrip: '+JSON.stringify(exportedPlan));
 assert(!exportedPlan.signature);assert(!exportedPlan.traineeSignature);
 // Independently inspect the actual OOXML numeric value, not just ExcelJS's
 // interpretation of duration as a Date on a second read.
 const planParts=await readZip(planBytes),sheetXml=new TextDecoder().decode(planParts.find(x=>x.name==='xl/worksheets/sheet1.xml').bytes);
 const rawCell=sheetXml.match(/<c\b[^>]*\br="H7"[^>]*>\s*<v>([^<]+)<\/v>\s*<\/c>/);
 assert(rawCell,'Missing numeric duration H7 in XLSX XML');assert(Math.abs(Number(rawCell[1])-totalMinutes/1440)<1e-12,'Incorrect raw Excel duration: '+rawCell[1]);
 await page.screenshot({path:'artifacts/lc4/journal.png',fullPage:true});
 await nav('Наставники и ВТ');await page.getByRole('cell',{name:'Инструктор Тестовый',exact:true}).waitFor();
 await nav('Назначения');await page.getByRole('button',{name:'Групповой приказ',exact:true}).click();
 await page.locator('input[name=order_organization]').fill('Учебная организация');await page.locator('input[name=order_city]').fill('Учебный город');await page.locator('input[name=order_number]').fill('QA-GROUP');await page.locator('input[name=order_on]').fill(date);await page.locator('input[name=order_start]').fill(date);await choose('Директор / утверждающий','LC4-003');
 await page.locator('select[name=group_member_role]').selectOption('instructor');await choose('Сертифицированный сотрудник','Инстр');await page.locator('input[name=group_member_ack]').fill(date);
 await page.locator('input[name=order_pay_instructor]').fill('1000');await page.locator('input[name=order_pay_from]').fill(date);
 const chooser=page.waitForEvent('filechooser'),download=page.waitForEvent('download');await page.getByRole('button',{name:'Сформировать проект по оригиналу DOCX',exact:true}).click();await (await chooser).setFiles(orderFile);const output=path.join(tmp,'qa-draft.docx');await (await download).saveAs(output);const parts=await readZip(new Uint8Array(await fs.readFile(output))),xml=new TextDecoder().decode(parts.find(x=>x.name==='word/document.xml').bytes);assert.match(xml,/Инструктор Тестовый, Учебная должность/);assert.match(xml,/QA-GROUP/);assert.match(xml,/ПРОЕКТ · БЕЗ ПОДПИСИ/);assert.equal(await page.locator('input[name=order_number]').inputValue(),'QA-GROUP');
 await page.locator('textarea[name=group_order_evidence]').fill('Учебный подписанный приказ');await page.locator('input[name=group_order_confirm]').check();await saved('Зарегистрировать групповой приказ');await page.getByRole('heading',{name:'Групповой приказ QA-GROUP',exact:true}).waitFor();await page.getByRole('cell',{name:'Учебная должность',exact:true}).waitFor();await page.screenshot({path:'artifacts/lc4/group-order.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await nav('Практические оценки');await page.getByRole('cell',{name:'Допуск зарегистрирован',exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(http,[]);await ctx.close();
 console.log('LC4 browser PASS: assignment, approval, eight intro facts, knowledge checks, practical, qualification, admission, matrix, journal, reload');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
