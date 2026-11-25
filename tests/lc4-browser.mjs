import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {fixture,date} from './lc4-fixture.mjs';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC4 учебная база ')),f=await fixture();
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
 for(const code of ['prepare','show1','show2','show3','try1','try2','try3','try4']){
  await page.locator('select[name=session_stage]').selectOption(code);await page.locator('input[name=session_when]').fill(date+'T08:00');await page.locator('textarea[name=session_notes]').fill('Учебное наблюдение '+code);await page.locator('input[name=mentor_ack]').check();await page.locator('input[name=trainee_ack]').check();await saved('Записать этап')
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
 await nav('Журнал заданий');await page.getByRole('cell',{name:'Подготовка',exact:true}).waitFor();await page.screenshot({path:'artifacts/lc4/journal.png',fullPage:true});
 await nav('Наставники и ВТ');await page.getByRole('cell',{name:'Инструктор Тестовый',exact:true}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await nav('Практические оценки');await page.getByRole('cell',{name:'Допуск зарегистрирован',exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(http,[]);await ctx.close();
 console.log('LC4 browser PASS: assignment, approval, eight intro facts, knowledge checks, practical, qualification, admission, matrix, journal, reload');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
